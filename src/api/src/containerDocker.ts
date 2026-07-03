import { runCommand, shellQuote } from "./utils.js";
import type { ContainerRecord } from "./containerPresets.js";

/* ── Docker container listing ──────────────────── */
export async function dockerContainers(): Promise<Array<{ name: string; image: string; status: string; state: ContainerRecord["state"]; ports: string }>> {
  const result = await runCommand("docker", ["ps", "-a", "--format", "{{json .}}"], 8000);
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split("\n").filter(Boolean).flatMap((line: string) => {
    try {
      const row = JSON.parse(line) as Record<string, string>;
      const state: ContainerRecord["state"] =
        row.State === "running" ? "running" :
        row.State === "exited" ? "stopped" : "unknown";
      return [{ name: row.Names ?? "", image: row.Image ?? "", status: row.Status ?? row.State ?? "unknown", state, ports: row.Ports ?? "" }];
    } catch { return []; }
  }).filter((row) => row.name);
}

/* ── Image helpers ─────────────────────────────── */
export async function imageExists(image: string): Promise<boolean> {
  if (!image) return false;
  const result = await runCommand("docker", ["image", "inspect", image], 5000);
  return result.ok;
}

export function testCommandFor(key: string, image: string): string {
  if (key === "vllm")
    return "docker run --rm --gpus all --entrypoint vllm " + shellQuote(image) + " --version";
  if (key === "trtllm")
    return "docker run --rm --entrypoint python " + shellQuote(image) + " -c " + shellQuote("import tensorrt_llm; print(\"tensorrt_llm=\" + getattr(tensorrt_llm, \"__version__\", \"unknown\"))");
  if (key === "pytorch")
    return "docker run --rm " + shellQuote(image) + " python3 -c " + shellQuote("import torch; print(\"torch=\" + torch.__version__)");
  return "docker image inspect " + shellQuote(image);
}

/* ── Container actions ─────────────────────────── */
export async function dockerContainerLogs(name: string, lines = 200): Promise<{ name: string; logs: string }> {
  const result = await runCommand("docker", ["logs", "--tail", String(lines), name], 8000);
  return { name, logs: result.stdout || result.stderr || "" };
}

export async function dockerContainerAction(name: string, action: "start" | "stop" | "restart"): Promise<{ name: string; action: string; ok: boolean; detail: string }> {
  if (["vllm-service", "trtllm-service"].includes(name)) {
    const exists = (await dockerContainers()).some((row) => row.name === name);
    if (!exists) {
      return {
        name, action, ok: false,
        detail: name === "vllm-service"
          ? "vLLM fixed runtime has not been created yet. Load a compatible model into the vLLM runtime first."
          : "TensorRT-LLM fixed runtime has not been created yet. Load a compatible model/profile into the TensorRT-LLM runtime first."
      };
    }
  }
  const result = await runCommand("docker", [action, name], 15000);
  return { name, action, ok: result.ok, detail: result.stdout || result.stderr };
}

export async function dockerDeleteContainer(key: string, presetImage: string, presetNames: string[]): Promise<{ key: string; ok: boolean; steps: string[] }> {
  const steps: string[] = [];
  let allOk = true;

  for (const name of presetNames) {
    const existing = await dockerContainers();
    const match = existing.find((c) => c.name === name);
    if (match) {
      if (match.state === "running") {
        const stop = await runCommand("docker", ["stop", name], 15000);
        steps.push(`stop ${name}: ${stop.ok ? "ok" : stop.stderr}`);
        if (!stop.ok) allOk = false;
      }
      const rm = await runCommand("docker", ["rm", name], 10000);
      steps.push(`rm ${name}: ${rm.ok ? "ok" : rm.stderr}`);
      if (!rm.ok) allOk = false;
    } else {
      steps.push(`container ${name}: not found (skip)`);
    }
  }

  if (presetImage && await imageExists(presetImage)) {
    const rmi = await runCommand("docker", ["rmi", presetImage], 30000);
    steps.push(`rmi ${presetImage}: ${rmi.ok ? "ok" : rmi.stderr}`);
    if (!rmi.ok) allOk = false;
  } else {
    steps.push(`image ${presetImage}: not found (skip)`);
  }

  const volumePrune = await runCommand("docker", ["volume", "prune", "-f", "--filter", "label=com.docker.compose.project=chatbot-net"], 15000);
  steps.push(`volume prune: ${volumePrune.ok ? "ok" : volumePrune.stderr}`);

  return { key, ok: allOk, steps };
}
