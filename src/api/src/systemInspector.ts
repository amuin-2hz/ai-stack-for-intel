/**
 * System inspector — adapted for LocalRuntime.
 * Checks NPU/GPU/CPU availability via OpenVINO, Intel GPU tools, and sysfs.
 * Replaces NVIDIA/Docker-specific checks.
 */

import { cpus, freemem, hostname, loadavg, networkInterfaces, platform, release, totalmem, uptime } from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { runCommand } from "./utils.js";
import { detectDevices, resolveRuntimePython } from "./engineManager.js";

export const servicePorts = {
  chat: Number(process.env.CHAT_ENGINE_PORT ?? "31000"),
  vision: Number(process.env.VISION_ENGINE_PORT ?? "31001"),
  asr: Number(process.env.ASR_ENGINE_PORT ?? "31002"),
  tts: Number(process.env.TTS_ENGINE_PORT ?? "31003"),
  embedding: Number(process.env.EMBEDDING_ENGINE_PORT ?? "31004"),
  rerank: Number(process.env.RERANK_ENGINE_PORT ?? "31005")
};

export async function systemCheck(): Promise<Record<string, unknown>> {
  const ports: Record<string, unknown> = {};
  for (const [name, port] of Object.entries(servicePorts)) {
    ports[name] = {
      port,
      in_allowed_range: port >= 31000 && port <= 60000,
      available: await portAvailable(port)
    };
  }

  return {
    product: {
      name: "AI Stack for Intel",
      short_name: "AI Stack for Intel"
    },
    management_url: "http://localhost:58888",
    backend_url: "http://localhost:8000",
    service_ports: ports,
    lan_addresses: lanAddresses(),
    device: await inspectDevice(),
    openvino: await openvinoStatus(),
    // Compatibility with old frontend expecting "docker" field
    docker: { ok: true, detail: "AI Stack for Intel uses Python subprocess engines (OpenVINO). No Docker required." },
    status: runtimeStatus()
  };
}

/* ── helpers ──────────────────────────────────────── */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

async function inspectDevice(): Promise<Record<string, unknown>> {
  const cpuInfo = await inspectCpu();
  const osRelease = await parseOsRelease();
  const productName = await readFirst(["/sys/class/dmi/id/product_name"]);
  const productVersion = await readFirst(["/sys/class/dmi/id/product_version"]);
  const boardName = await readFirst(["/sys/class/dmi/id/board_name"]);

  return {
    hostname: hostname(),
    vendor: await readFirst(["/sys/class/dmi/id/sys_vendor"]),
    model: normalizeDeviceModel(productName, productVersion, boardName),
    board: boardName,
    os: {
      platform: platform(),
      kernel: release(),
      name: osRelease.PRETTY_NAME ?? osRelease.NAME ?? "unknown",
      arch: process.arch,
      version: osRelease.VERSION_ID ?? osRelease.VERSION ?? "",
      build: osRelease.BUILD_ID ?? ""
    },
    cpu: cpuInfo,
    memory: { total_bytes: totalmem(), free_bytes: freemem() },
    storage: await inspectStorage(),
    devices: await detectDevices()
  };
}

async function inspectCpu(): Promise<Record<string, unknown>> {
  const cpuList = cpus();
  const cpuinfo = await readFirst(["/proc/cpuinfo"], false);
  const modelName = cpuinfo?.match(/(?:model name|Hardware)\s*:\s*(.+)/i)?.[1]?.trim();
  const nodeModel = cpuList[0]?.model && cpuList[0].model !== "unknown" ? cpuList[0].model : undefined;
  const model = modelName || nodeModel || "unknown";
  return { model, cores: cpuList.length };
}

function runtimeStatus(): Record<string, unknown> {
  const loads = loadavg();
  const coreCount = cpus().length || 1;
  return {
    uptime_seconds: Math.round(uptime()),
    load_average: loads,
    cpu_load_percent: Math.round(Math.min(100, (loads[0] / coreCount) * 100))
  };
}

async function inspectStorage(): Promise<Record<string, unknown>> {
  const targets = [process.env.AI_STACK_BASE ?? process.cwd(), "/"];
  const result = await runCommand("df", ["-kP", ...targets], 5000);
  if (!result.ok || !result.stdout) return { available: false, detail: result.stderr || "df unavailable" };
  const rows = result.stdout.split("\n").slice(1).filter(Boolean).map((line) => {
    const parts = line.trim().split(/\s+/);
    const [filesystem, blocks, used, available, capacity, ...mountedParts] = parts;
    return {
      filesystem,
      mount: mountedParts.join(" "),
      total_bytes: Number(blocks) * 1024,
      used_bytes: Number(used) * 1024,
      free_bytes: Number(available) * 1024,
      used_percent: Number((capacity ?? "0").replace("%", ""))
    };
  });
  return { available: true, volumes: rows };
}

function normalizeDeviceModel(productName?: string, productVersion?: string, boardName?: string): string {
  const parts = [productName, productVersion].filter(
    (part) => part && part !== "Default string" && part !== "To be filled by O.E.M."
  );
  if (parts.length) return parts.join(" ");
  return boardName || "unknown";
}

/* ── OpenVINO status (replaces nvidiaStatus) ─────── */
async function openvinoStatus(): Promise<Record<string, unknown>> {
  try {
    const pythonExecutable = await resolveRuntimePython();
    const result = await runCommand(pythonExecutable, [
      "-c",
      "import openvino as ov; c=ov.Core(); print('version='+ov.__version__+' devices='+','.join(c.available_devices))"
    ], 10000);
    if (result.ok && result.stdout) {
      const versionMatch = result.stdout.match(/version=(\S+)/);
      const devicesMatch = result.stdout.match(/devices=(.+)/);
      return {
        ok: true,
        version: versionMatch?.[1] ?? "unknown",
        devices: devicesMatch?.[1]?.split(",") ?? [],
        installed: true
      };
    }
  } catch { /* ignore */ }

  // Try reading NPU firmware
  try {
    const npuFirmware = await readdir("/lib/firmware/intel", { withFileTypes: true }).catch(() => []);
    if (npuFirmware.length) {
      return { ok: true, version: "firmware-only", devices: [], installed: false, firmware_present: npuFirmware.length };
    }
  } catch { /* ignore */ }

  return { ok: false, detail: "OpenVINO Python package not found. Install: pip install openvino openvino-genai" };
}

/* ── port check ──────────────────────────────────── */
async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

async function parseOsRelease(): Promise<Record<string, string>> {
  const text = await readFirst(["/host/etc/os-release", "/etc/os-release"], false);
  const out: Record<string, string> = {};
  for (const line of (text ?? "").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return out;
}

async function readFirst(paths: string[], trim = true): Promise<string | undefined> {
  for (const path of paths) {
    try {
      const value = await readFile(path, "utf8");
      const cleaned = trim ? value.trim() : value;
      if (cleaned) return cleaned;
    } catch { /* Try next */ }
  }
  return undefined;
}
