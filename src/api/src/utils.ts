import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { extname } from "node:path";

export function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  return slug || "model";
}

export function newId(prefix = ""): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function shortId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function isWeightFile(path: string): boolean {
  const suffixes = [".safetensors", ".bin", ".gguf", ".pt", ".pth", ".onnx", ".engine", ".xml"];
  const extension = extname(path);
  return suffixes.includes(extension) || suffixes.some((suffix) => path.endsWith(suffix));
}

export async function safeSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export function runCommand(command: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, stdout: "", stderr: "Command timed out." });
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}


export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
