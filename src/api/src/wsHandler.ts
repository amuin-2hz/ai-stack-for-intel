import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { getCurrentChatId, getChat, appendMessage, getSelectedModel } from "./store.js";
import { listEngines } from "./engineManager.js";

function getPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

export function createWsHandler(deps: {
  wss: WebSocketServer;
  audioServiceWsUrl: string;
  proxyWebSocket: (
    req: IncomingMessage,
    socket: any,
    head: Buffer,
    target: string,
    wss: WebSocketServer
  ) => void;
}) {
  const { wss, audioServiceWsUrl, proxyWebSocket } = deps;

  /** Find a running engine's WebSocket URL by model capability. */
  function findEngineWsUrl(capability: "tts" | "asr"): string | null {
    const engine = listEngines().find(
      (e) => e.status === "running" && e.type === capability
    );
    if (!engine) return null;
    return `ws://127.0.0.1:${engine.port}`;
  }

  function handleUpgrade(
    req: IncomingMessage,
    socket: any,
    head: Buffer
  ): void {
    const path = getPath(req);

    // TTS streaming: /ws/audio/speech → Python TTS WebSocket engine
    if (path === "/ws/audio/speech") {
      const target = findEngineWsUrl("tts");
      if (target) {
        proxyWebSocket(req, socket, head, target, wss);
        return;
      }
      socket.destroy();
      return;
    }

    // ASR streaming: /ws/audio/transcriptions → Python ASR WebSocket engine
    if (path === "/ws/audio/transcriptions") {
      const target = findEngineWsUrl("asr");
      if (target) {
        proxyWebSocket(req, socket, head, target, wss);
        return;
      }
      socket.destroy();
      return;
    }

    // External audio service (realtime audio streaming)
    if (path.startsWith("/ws/audio/")) {
      proxyWebSocket(req, socket, head, audioServiceWsUrl, wss);
      return;
    }

    // Chat WebSocket
    if (!path.startsWith("/ws/chat/")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  function handleConnection(ws: WebSocket, req: IncomingMessage): void {
    void (async () => {
      const chatId = decodeURIComponent(
        getPath(req).split("/").pop() || getCurrentChatId() || "chat_default"
      );
      const chat = getChat(chatId);
      if (!chat) {
        ws.send(JSON.stringify({ type: "history", messages: [] }));
        return;
      }
      ws.send(JSON.stringify({ type: "history", messages: chat.messages }));
      ws.on("message", async (data) => {
        try {
          const payload = JSON.parse(data.toString()) as {
            message?: string;
          };
          const text = payload.message?.trim();
          if (!text) return;
          appendMessage(chatId, {
            type: "HumanMessage",
            content: text
          });
          ws.send(
            JSON.stringify({ type: "node_start", data: "generate" })
          );
          const answer = await makeAssistantReply(text);
          for (const token of chunkText(answer)) {
            ws.send(JSON.stringify({ type: "token", token }));
            await new Promise((resolve) => setTimeout(resolve, 8));
          }
          appendMessage(chatId, {
            type: "AssistantMessage",
            content: answer
          });
          ws.send(
            JSON.stringify({ type: "node_end", data: "generate" })
          );
          const updated = getChat(chatId);
          ws.send(
            JSON.stringify({
              type: "history",
              messages: updated?.messages ?? []
            })
          );
        } catch (error) {
          ws.send(
            JSON.stringify({
              type: "error",
              content:
                error instanceof Error ? error.message : String(error)
            })
          );
        }
      });
    })();
  }

  async function makeAssistantReply(text: string): Promise<string> {
    const model = getSelectedModel();
    return [
      `Node/TypeScript control plane is online.`,
      ``,
      `Selected model: ${model || "not selected"}.`,
      `Your message: ${text}`,
      ``,
      `Runtime inference is not connected yet; this compatibility reply confirms the WebSocket chat path has moved off Python.`
    ].join("\n");
  }

  function chunkText(text: string): string[] {
    return text.match(/.{1,18}(\s|$)/g) ?? [text];
  }

  return { handleUpgrade, handleConnection };
}
