import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";

import { initDb } from "./db.js";
import { migrateFromJson } from "./migrate.js";
import { createOpenAiProxy } from "./openaiProxy.js";
import { createDeploymentHelpers } from "./deploymentHelpers.js";
import { createWsHandler } from "./wsHandler.js";
import { proxyWebSocket } from "./httpProxy.js";
import { createRouter, sendJson, getPath } from "./serverUtils.js";
import { sendOpenAiError } from "./openaiProtocol.js";
import { requiresElectronPrivilege, isElectronRequest } from "./permissions.js";

/* ── route modules ─────────────────────────────── */
import { register as systemRoutes } from "./routes/system.js";
import { register as settingsRoutes } from "./routes/settings.js";
import { register as modelRoutes } from "./routes/models.js";
import { register as downloadRoutes } from "./routes/downloads.js";
import { register as taskRoutes } from "./routes/tasks.js";
import { register as engineRoutes } from "./routes/engines.js";
import { register as containerRoutes } from "./routes/containers.js";
import { register as deploymentRoutes } from "./routes/deployments.js";
import { register as openaiRoutes } from "./routes/openai.js";
import { register as legacyRoutes } from "./routes/legacy.js";
import { cleanupOrphanEngines, startEngine, enginePresets } from "./engineManager.js";
import { listModels, publishedModelNameFor } from "./modelRegistry.js";

/* ── constants ─────────────────────────────────── */
const port = Number(process.env.PORT ?? "8000");
const workspaceRoot = process.env.AI_STACK_BASE ?? process.cwd();
const modelsRoot = process.env.MODELS_ROOT ?? join(workspaceRoot, "models");
const stateRoot = process.env.STATE_ROOT ?? join(workspaceRoot, "state");
const uploadsRoot = process.env.UPLOADS_ROOT ?? join(stateRoot, "uploads");
const logsRoot = process.env.LOGS_ROOT ?? join(workspaceRoot, "logs");
const audioServiceUrl = process.env.AUDIO_SERVICE_URL ?? "http://127.0.0.1:32000";
const audioServiceWsUrl = process.env.AUDIO_SERVICE_WS_URL ?? "ws://127.0.0.1:32000/ws/realtime";

/* ── composed modules ──────────────────────────── */
const dh = createDeploymentHelpers({ modelsRoot, audioServiceUrl });
const oai = createOpenAiProxy({ modelsRoot, workspaceRoot, logsRoot, deploymentHelpers: dh });

/* ── router ────────────────────────────────────── */
const { route, match } = createRouter();

/* ── register all route groups ─────────────────── */
systemRoutes(route);
settingsRoutes(route);
modelRoutes(route, modelsRoot, workspaceRoot);
downloadRoutes(route, workspaceRoot, logsRoot);
taskRoutes(route, workspaceRoot, logsRoot);
engineRoutes(route, modelsRoot, workspaceRoot, logsRoot);
containerRoutes(route, workspaceRoot, logsRoot, stateRoot);
deploymentRoutes(route, dh, modelsRoot, workspaceRoot, logsRoot);
openaiRoutes(route, modelsRoot, dh, oai);
legacyRoutes(route, modelsRoot, uploadsRoot, audioServiceUrl);

/* ── HTTP server ───────────────────────────────── */
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  const parsedPath = getPath(req);
  const m = match(req.method ?? "GET", parsedPath);
  if (!m) return sendJson(res, 404, { detail: "Not found" });

  if (requiresElectronPrivilege(req.method ?? "GET", parsedPath)) {
    if (!isElectronRequest(req)) {
      return sendJson(res, 403, { detail: "This operation requires local Electron access." });
    }
  }

  try {
    await m.handler(req, res, m.params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // If the handler already produced a response, the failure happened after the
    // headers were on the wire. Attempting to write again raises
    // ERR_HTTP_HEADERS_SENT; just record it and leave the response alone.
    if (res.headersSent || res.writableEnded) {
      console.error(`[handler] ${req.method} ${parsedPath} failed after responding: ${message}`);
      return;
    }
    if (parsedPath.startsWith("/v1/") || parsedPath === "/v3/rerank") {
      sendOpenAiError(res, 500, message, { type: "server_error" });
      return;
    }
    sendJson(res, 500, { detail: message });
  }
});

/* ── WebSocket ────────────────────────────────── */
const wss = new WebSocketServer({ noServer: true });
const wsHandler = createWsHandler({
  wss,
  audioServiceWsUrl,
  proxyWebSocket: (req: IncomingMessage, socket: any, head: Buffer, target: string, w: WebSocketServer) =>
    proxyWebSocket(req, socket, head, target, w)
});

server.on("upgrade", (req, socket, head) => { wsHandler.handleUpgrade(req, socket, head); });
wss.on("connection", (ws, req) => { wsHandler.handleConnection(ws, req); });

/* ── init & start ──────────────────────────────── */
initDb();
const migrationResult = migrateFromJson(stateRoot);
if (migrationResult.migrated) console.log(`DB migration: ${migrationResult.detail}`);

// Clean up Python engine processes when API server exits (Ctrl+C / SIGTERM)
async function shutdown() {
  console.log("\nShutting down — stopping inference engines...");
  const { stopAllEngines } = await import("./engineManager.js");
  const count = await stopAllEngines();
  if (count > 0) console.log(`  Stopped ${count} engine(s)`);
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// One bad request must not take the API — and the inference engines it owns —
// down with it. Node terminates on an unhandled rejection/exception by default;
// keep the process alive and record the failure instead.
process.on("unhandledRejection", (reason) => {
  console.error(`[unhandledRejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});
process.on("uncaughtException", (error) => {
  console.error(`[uncaughtException] ${error.stack ?? error.message}`);
});

/** Eagerly start ASR and TTS engines so WebSocket endpoints are ready at launch. */
async function warmupEngines(
  modelsRoot: string,
  workspaceRoot: string,
  logsRoot: string
): Promise<void> {
  const engineTypes = ["asr", "tts"] as const;
  const models = await listModels(modelsRoot);

  for (const etype of engineTypes) {
    // Find a ready model matching this engine type
    const model = models.find(
      (m) => m.status.download === "ready" && m.capabilities.includes(etype)
    ) ?? models.find((m) => m.capabilities.includes(etype));

    if (!model) {
      console.log(`[warmup] No model found for ${etype}, skipping`);
      continue;
    }

    const preset = enginePresets.find((p) => p.type === etype);
    if (!preset) continue;

    try {
      console.log(`[warmup] Starting ${etype} engine (${model.display_name})...`);
      const engine = await startEngine({
        type: etype,
        model_id: model.id,
        model_name: publishedModelNameFor(model),
        model_path: model.local.path,
        port: preset.default_port,
        workspaceRoot,
        logsRoot,
      });
      console.log(`[warmup] ${etype} engine ready on port ${engine.port}`);
    } catch (err) {
      console.log(`[warmup] ${etype} engine start failed: ${err}`);
    }
  }
}

cleanupOrphanEngines().then(() => {
  server.listen(port, "0.0.0.0", () => {
    console.log(`AI Stack for Intel API listening on 0.0.0.0:${port}`);
    // Start slow audio engines after the HTTP API is reachable so the UI can poll immediately.
    void warmupEngines(modelsRoot, workspaceRoot, logsRoot);
  });
}).catch((error) => {
  console.error(`[startup] cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  server.listen(port, "0.0.0.0", () => {
    console.log(`AI Stack for Intel API listening on 0.0.0.0:${port}`);
    void warmupEngines(modelsRoot, workspaceRoot, logsRoot);
  });
});
