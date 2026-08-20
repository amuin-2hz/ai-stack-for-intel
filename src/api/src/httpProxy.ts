import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";

export interface ProxyResult {
  ok: boolean;
  status: number;
  body: Buffer;
  contentType?: string;
}

export type AudioWebSocketMode = "transcription" | "speech";

function jsonProxyResult(status: number, payload: unknown): ProxyResult {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    ok: status < 400,
    status,
    body,
    contentType: "application/json; charset=utf-8"
  };
}

/**
 * Merge PCM WAV messages emitted by the streaming TTS engine into one WAV.
 * Each sentence arrives as a complete WAV, so their data chunks must be
 * combined under a single header instead of concatenating whole files.
 */
export function mergeWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error("No WAV chunks received");

  let firstHeader: Buffer | null = null;
  let firstFormat: Buffer | null = null;
  let dataSizeOffset = -1;
  const audioParts: Buffer[] = [];

  for (const buffer of buffers) {
    if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("TTS engine returned an invalid WAV chunk");
    }

    let offset = 12;
    let format: Buffer | null = null;
    let audio: Buffer | null = null;
    let currentDataSizeOffset = -1;
    let currentDataStart = -1;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;
      if (chunkEnd > buffer.length) throw new Error("TTS engine returned a truncated WAV chunk");

      if (chunkId === "fmt ") format = buffer.subarray(chunkStart, chunkEnd);
      if (chunkId === "data") {
        currentDataSizeOffset = offset + 4;
        currentDataStart = chunkStart;
        audio = buffer.subarray(chunkStart, chunkEnd);
        break;
      }
      offset = chunkEnd + (chunkSize % 2);
    }

    if (!format || !audio || currentDataStart < 0) {
      throw new Error("TTS WAV chunk is missing fmt or data");
    }
    if (firstFormat && !format.equals(firstFormat)) {
      throw new Error("TTS WAV chunks use incompatible audio formats");
    }
    if (!firstHeader) {
      firstHeader = Buffer.from(buffer.subarray(0, currentDataStart));
      firstFormat = Buffer.from(format);
      dataSizeOffset = currentDataSizeOffset;
    }
    audioParts.push(audio);
  }

  const header = firstHeader as Buffer;
  const audio = Buffer.concat(audioParts);
  header.writeUInt32LE(header.length + audio.length - 8, 4);
  header.writeUInt32LE(audio.length, dataSizeOffset);
  return Buffer.concat([header, audio]);
}

/** Bridge OpenAI-style HTTP audio requests to the WebSocket-only engines. */
export function requestAudioWebSocket(
  url: string,
  body: Record<string, unknown>,
  mode: AudioWebSocketMode,
  timeout: number
): Promise<ProxyResult> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const wavChunks: Buffer[] = [];
    let settled = false;

    const finish = (result: ProxyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(jsonProxyResult(504, { error: { message: `Audio request timed out after ${timeout}ms` } }));
      socket.terminate();
    }, timeout);

    socket.on("open", () => socket.send(JSON.stringify(body)));
    socket.on("message", (data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        finish(jsonProxyResult(502, { error: { message: "Audio engine returned invalid JSON" } }));
        return;
      }

      const type = String(message.type ?? "");
      if (type === "error") {
        const detail = String(message.message ?? message.detail ?? "Audio engine request failed");
        finish(jsonProxyResult(502, { error: { message: detail } }));
        return;
      }

      if (mode === "transcription" && type === "result") {
        const { type: _type, ...payload } = message;
        finish(jsonProxyResult(200, payload));
        return;
      }

      if (mode === "speech" && type === "chunk") {
        const encoded = message.data;
        if (typeof encoded !== "string") {
          finish(jsonProxyResult(502, { error: { message: "TTS engine returned an invalid audio chunk" } }));
          return;
        }
        wavChunks.push(Buffer.from(encoded, "base64"));
        return;
      }

      if (mode === "speech" && type === "done") {
        try {
          const wav = mergeWavBuffers(wavChunks);
          finish({ ok: true, status: 200, body: wav, contentType: "audio/wav" });
        } catch (error) {
          finish(jsonProxyResult(502, {
            error: { message: error instanceof Error ? error.message : String(error) }
          }));
        }
      }
    });
    socket.on("error", (error) => {
      finish(jsonProxyResult(502, { error: { message: error.message } }));
    });
    socket.on("close", () => {
      if (!settled) {
        finish(jsonProxyResult(502, { error: { message: "Audio engine closed the connection before completing the request" } }));
      }
    });
  });
}

export function proxyHttp(
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string> = {},
  timeout = 120_000
): Promise<ProxyResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client(url, { method, headers, timeout }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        resolve({
          ok: Boolean(response.statusCode && response.statusCode < 400),
          status: response.statusCode ?? 502,
          body: Buffer.concat(chunks),
          contentType: Array.isArray(response.headers["content-type"])
            ? response.headers["content-type"][0]
            : response.headers["content-type"]
        })
      );
    });
    request.on("error", (error) =>
      resolve({ ok: false, status: 502, body: Buffer.from(error.message) })
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, status: 504, body: Buffer.from(`Request timed out after ${timeout}ms`) });
    });
    if (body) request.write(body);
    request.end();
  });
}

export function proxyWebSocket(
  req: IncomingMessage,
  socket: any,
  head: Buffer,
  target: string,
  wss: WebSocketServer
): void {
  let closed = false;
  const label = `[WS-PROXY ${target.replace('ws://127.0.0.1:', '')}]`;
  console.log(`${label} New proxy: browser → ${target}`);
  const upstream = new WebSocket(target);
  let upstreamOpen = false;
  let msgQueue: Array<{ data: any; isBinary: boolean }> = [];

  function flushQueue() {
    while (msgQueue.length > 0) {
      const m = msgQueue.shift()!;
      try { upstream.send(m.data, { binary: m.isBinary }); } catch { /* gone */ }
    }
  }

  wss.handleUpgrade(req, socket, head, (downstream) => {
    const safeSend = (ws: WebSocket, data: any, isBinary = false) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      try { ws.send(data, { binary: isBinary }); } catch { /* connection already gone */ }
    };
    upstream.on("open", () => {
      upstreamOpen = true;
      console.log(`${label} Upstream open, flushing ${msgQueue.length} queued messages`);
      flushQueue();
      upstream.on("message", (msg, isBinary) => {
        const preview = isBinary
          ? `BINARY ${(msg as Buffer).length}B`
          : `TEXT ${String(msg).substring(0, 100)}`;
        console.log(`${label} Python → Browser: ${preview}`);
        safeSend(downstream, msg, isBinary);
      });
      downstream.on("close", () => { closed = true; upstream.close(); });
      upstream.on("close", () => { closed = true; downstream.close(); });
    });
    upstream.on("error", (_error) => {
      if (closed) return;
      console.log(`${label} Upstream error: ${_error}`);
      safeSend(downstream, JSON.stringify({ type: "error", detail: "Upstream connection failed" }));
      downstream.close();
    });

    // Queue browser messages until upstream is ready
    downstream.on("message", (msg, isBinary) => {
      const preview = isBinary
        ? `BINARY ${(msg as Buffer).length}B`
        : `TEXT ${String(msg).substring(0, 100)}`;
      console.log(`${label} Browser → Python: ${preview}`);
      if (upstreamOpen) {
        safeSend(upstream, msg, isBinary);
      } else {
        console.log(`${label} Queuing browser msg (upstream not open yet): ${isBinary ? 'BINARY' : 'TEXT'} ${isBinary ? (msg as Buffer).length : String(msg).substring(0, 80)}`);
        msgQueue.push({ data: msg, isBinary });
      }
    });
  });
}

export function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
