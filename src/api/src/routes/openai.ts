import { readBody, readRawBody, readRawBodyBuffer, parseMultipart, sendJson } from "../serverUtils.js";
import { listEngines } from "../engineManager.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  dh: any,
  oai: any
) {
  route("GET", "/v1/models", async (_req: any, res: any) => {
    const engines = listEngines();
    const data: Array<{ id: string; object: string; owned_by: string }> = engines
      .filter((e) => e.status === "running")
      .map((e) => ({ id: e.model_name, object: "model", owned_by: e.type }));

    sendJson(res, 200, { object: "list", data });
  });

  route("POST", "/v1/chat/completions", async (req: any, res: any) => {
    const rawBody = await readRawBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    await oai.proxyOpenAiRequest(res, body, "/chat/completions", rawBody);
  });

  route("POST", "/v1/embeddings", async (req: any, res: any) => {
    const rawBody = await readRawBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    await oai.proxyOpenAiRequest(res, body, "/embeddings", rawBody);
  });

  route("POST", "/v1/audio/transcriptions", async (req: any, res: any) => {
    const contentType: string = req.headers["content-type"] || "";

    // Handle multipart/form-data (browser uploads via FormData)
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      const boundary = boundaryMatch ? boundaryMatch[1].replace(/^["']|["']$/g, "") : "";
      if (!boundary) {
        sendJson(res, 400, { error: { message: "Missing multipart boundary" } });
        return;
      }

      const buffer = await readRawBodyBuffer(req);
      const { fields, files } = parseMultipart(buffer, boundary);

      const audioFile = files.find((f) => f.name === "file") || files[0];
      if (!audioFile) {
        sendJson(res, 400, { error: { message: "No audio file in upload" } });
        return;
      }

      // Save audio to temp file — the ASR engine needs a file path
      const ext = audioFile.filename.includes(".") ? audioFile.filename.split(".").pop()! : "webm";
      const tmpPath = join(tmpdir(), `asr_${randomUUID()}.${ext}`);
      await writeFile(tmpPath, audioFile.data);

      // Build JSON body for the ASR engine
      const body: Record<string, unknown> = {
        model: (fields.model as string) || "asr",
        audio_path: tmpPath,
        language: (fields.language as string) || "zh"
      };

      // Forward to ASR engine
      await oai.proxyOpenAiRequest(res, body, "/audio/transcriptions");

      // Best-effort cleanup after response sent
      unlink(tmpPath).catch(() => {});
      return;
    }

    // JSON body fallback (for direct API clients)
    const rawBody = await readRawBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    await oai.proxyOpenAiRequest(res, body, "/audio/transcriptions", rawBody);
  });

  route("POST", "/v1/audio/speech", async (req: any, res: any) => {
    const rawBody = await readRawBody(req);
    const body = rawBody ? JSON.parse(rawBody) : {};
    await oai.proxyOpenAiRequest(res, body, "/audio/speech", rawBody);
  });
}
