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
      downstream.on("message", (msg, isBinary) => {
        const preview = isBinary
          ? `BINARY ${(msg as Buffer).length}B`
          : `TEXT ${String(msg).substring(0, 100)}`;
        console.log(`${label} Browser → Python: ${preview}`);
        safeSend(upstream, msg, isBinary);
      });
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
