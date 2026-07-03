import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => Promise<void>;

export interface RouteEntry {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export function defineRoute(
  method: string,
  path: string,
  handler: Handler
): RouteEntry {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:[^/]+/g, (match) => {
      keys.push(match.slice(1));
      return "([^/]+)";
    })}$`
  );
  return { method, pattern, keys, handler };
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string
): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(body);
}

export async function readBody<T = Record<string, unknown>>(
  req: IncomingMessage
): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** Read request body as raw Buffer — needed for multipart file uploads. */
export async function readRawBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Parse a simple multipart/form-data body.
 * Returns an object with string fields and file buffers.
 */
export function parseMultipart(
  buffer: Buffer,
  boundary: string
): { fields: Record<string, string>; files: Array<{ name: string; filename: string; contentType: string; data: Buffer }> } {
  const fields: Record<string, string> = {};
  const files: Array<{ name: string; filename: string; contentType: string; data: Buffer }> = [];

  const boundaryDelim = Buffer.from("--" + boundary);
  const endDelim = Buffer.from("--" + boundary + "--");
  const crlf = Buffer.from("\r\n");
  const doubleCrlf = Buffer.from("\r\n\r\n");

  // Split by boundary
  let pos = buffer.indexOf(boundaryDelim);
  if (pos === -1) return { fields, files };

  while (pos !== -1) {
    // Move past boundary + optional CRLF
    let start = pos + boundaryDelim.length;
    if (buffer.subarray(start, start + 2).equals(crlf)) start += 2;

    // Find end of this part (next boundary or end delimiter)
    const nextBoundary = buffer.indexOf(boundaryDelim, start);
    const nextEnd = buffer.indexOf(endDelim, start);
    let end: number;
    if (nextBoundary === -1) end = nextEnd;
    else if (nextEnd === -1) end = nextBoundary;
    else end = Math.min(nextBoundary, nextEnd);
    if (end === -1) break;

    // Trim trailing CRLF
    let partEnd = end;
    if (partEnd >= 2 && buffer.subarray(partEnd - 2, partEnd).equals(crlf)) partEnd -= 2;

    const part = buffer.subarray(start, partEnd);
    if (part.length === 0) {
      pos = nextBoundary !== -1 ? nextBoundary : -1;
      continue;
    }

    // Find header/body separator
    const headerEnd = part.indexOf(doubleCrlf);
    if (headerEnd === -1) {
      pos = nextBoundary !== -1 ? nextBoundary : -1;
      continue;
    }

    const headerText = part.subarray(0, headerEnd).toString("utf-8");
    const body = part.subarray(headerEnd + 4);

    // Parse headers
    const headers: Record<string, string> = {};
    for (const line of headerText.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }

    // Parse Content-Disposition for name and filename
    const disp = headers["content-disposition"] || "";
    const nameMatch = disp.match(/name="([^"]*)"/);
    const filenameMatch = disp.match(/filename="([^"]*)"/);
    const contentType = headers["content-type"] || "application/octet-stream";

    const fieldName = nameMatch ? nameMatch[1] : "";

    if (filenameMatch) {
      files.push({
        name: fieldName,
        filename: filenameMatch[1],
        contentType,
        data: body
      });
    } else if (fieldName) {
      fields[fieldName] = body.toString("utf-8").trim();
    }

    pos = nextBoundary !== -1 ? nextBoundary : -1;
  }

  return { fields, files };
}

export function getPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

export function createRouter(routes: RouteEntry[] = []) {
  function route(
    method: string,
    path: string,
    handler: Handler
  ): void {
    routes.push(defineRoute(method, path, handler));
  }

  function match(
    method: string,
    path: string
  ): { handler: Handler; params: Record<string, string> } | null {
    const matched = routes.find(
      (candidate) =>
        candidate.method === method && candidate.pattern.test(path)
    );
    if (!matched) return null;
    const matchResult = path.match(matched.pattern);
    const params = Object.fromEntries(
      matched.keys.map((key, index) => [
        key,
        decodeURIComponent(matchResult?.[index + 1] ?? "")
      ])
    );
    return { handler: matched.handler, params };
  }

  return { route, match };
}
