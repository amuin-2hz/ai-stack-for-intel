import { readRawBodyBuffer, parseMultipart, sendJson } from "../serverUtils.js";
import { listEngines } from "../engineManager.js";
import { listModels, publishedModelNameFor } from "../modelRegistry.js";
import {
  parseOpenAiJsonBody,
  sendOpenAiError,
  validateAudioSpeechBody,
  validateAudioTranscriptionBody,
  validateChatCompletionBody,
  validateEmbeddingsBody
} from "../openaiProtocol.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  modelsRoot: string,
  dh: any,
  oai: any
) {
  route("GET", "/v1/models", async (_req: any, res: any) => {
    const registryModels = await listModels(modelsRoot);
    const readyModels = registryModels.filter((model) => model.status.download === "ready");
    const activeEngines = listEngines().filter((engine) => engine.status === "running");
    const data = new Map<string, { id: string; object: string; owned_by: string }>();

    for (const model of readyModels) {
      data.set(publishedModelNameFor(model), {
        id: publishedModelNameFor(model),
        object: "model",
        owned_by: model.capabilities[0] ?? "local-runtime"
      });
    }

    for (const engine of activeEngines) {
      data.set(engine.model_name, {
        id: engine.model_name,
        object: "model",
        owned_by: engine.type
      });
    }

    sendJson(res, 200, { object: "list", data: [...data.values()] });
  });

  route("POST", "/v1/chat/completions", async (req: any, res: any) => {
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    const validation = validateChatCompletionBody(parsed.body);
    if (!validation.ok) {
      sendOpenAiError(res, validation.status, validation.message, validation.options);
      return;
    }
    await oai.proxyOpenAiRequest(res, parsed.body, "/chat/completions", parsed.rawBody);
  });

  route("POST", "/v1/embeddings", async (req: any, res: any) => {
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    const validation = validateEmbeddingsBody(parsed.body);
    if (!validation.ok) {
      sendOpenAiError(res, validation.status, validation.message, validation.options);
      return;
    }
    await oai.proxyOpenAiRequest(res, parsed.body, "/embeddings", parsed.rawBody);
  });

  route("POST", "/v1/rerank", async (req: any, res: any) => {
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    await oai.proxyOpenAiRequest(res, parsed.body, "/rerank", parsed.rawBody);
  });

  route("POST", "/v3/rerank", async (req: any, res: any) => {
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    await oai.proxyOpenAiRequest(res, parsed.body, "/rerank", parsed.rawBody);
  });

  route("POST", "/v1/audio/transcriptions", async (req: any, res: any) => {
    const contentType: string = req.headers["content-type"] || "";

    // Handle multipart/form-data (browser uploads via FormData)
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      const boundary = boundaryMatch ? boundaryMatch[1].replace(/^["']|["']$/g, "") : "";
      if (!boundary) {
        sendOpenAiError(res, 400, "Missing multipart boundary.", {
          code: "invalid_multipart_body"
        });
        return;
      }

      const buffer = await readRawBodyBuffer(req);
      const { fields, files } = parseMultipart(buffer, boundary);

      const audioFile = files.find((f) => f.name === "file") || files[0];
      if (!audioFile) {
        sendOpenAiError(res, 400, "No audio file was provided.", {
          param: "file",
          code: "missing_audio_file"
        });
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
        language: (fields.language as string) || "zh",
        prompt: fields.prompt as string | undefined,
        response_format: (fields.response_format as string) || "json",
        temperature: fields.temperature as string | undefined
      };
      const validation = validateAudioTranscriptionBody(body);
      if (!validation.ok) {
        unlink(tmpPath).catch(() => {});
        sendOpenAiError(res, validation.status, validation.message, validation.options);
        return;
      }

      // Forward to ASR engine
      await oai.proxyOpenAiRequest(res, body, "/audio/transcriptions");

      // Best-effort cleanup after response sent
      unlink(tmpPath).catch(() => {});
      return;
    }

    // JSON body fallback (for direct API clients)
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    const validation = validateAudioTranscriptionBody(parsed.body);
    if (!validation.ok) {
      sendOpenAiError(res, validation.status, validation.message, validation.options);
      return;
    }
    await oai.proxyOpenAiRequest(res, parsed.body, "/audio/transcriptions", parsed.rawBody);
  });

  route("POST", "/v1/audio/speech", async (req: any, res: any) => {
    const parsed = await parseOpenAiJsonBody(req, res);
    if (!parsed) return;
    const validation = validateAudioSpeechBody(parsed.body);
    if (!validation.ok) {
      sendOpenAiError(res, validation.status, validation.message, validation.options);
      return;
    }
    await oai.proxyOpenAiRequest(res, parsed.body, "/audio/speech", parsed.rawBody);
  });
}
