import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { updateTask } from "./store.js";
import type { TaskRecord } from "./types.js";

export interface ManagedCommand {
  taskId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  logPath: string;
  onOutputLine?: (line: string) => void | Promise<void>;
  onSuccess?: () => Promise<void>;
  onCancel?: () => Promise<void>;
  onFailure?: (error: string) => Promise<void>;
}

type ManagedHandle = {
  child: ChildProcess;
  paused: boolean;
  canceled: boolean;
  killTimer?: NodeJS.Timeout;
};

const managedTasks = new Map<string, ManagedHandle>();

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    try {
      child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

export async function runManagedCommand(command: ManagedCommand): Promise<void> {
  await mkdir(dirname(command.logPath), { recursive: true });
  const log = createWriteStream(command.logPath, { flags: "a" });
  const startedAt = new Date().toISOString();
  log.write("[" + startedAt + "] $ " + [command.command, ...command.args].join(" ") + "\n");
  await updateTask(command.taskId, { status: "running", started_at: startedAt, updated_at: startedAt });

  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  const handle: ManagedHandle = { child, paused: false, canceled: false };
  managedTasks.set(command.taskId, handle);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const consumeLines = (chunk: Buffer, source: "stdout" | "stderr") => {
    const text = chunk.toString();
    if (source === "stdout") stdoutBuffer += text;
    else stderrBuffer += text;
    const buffer = source === "stdout" ? stdoutBuffer : stderrBuffer;
    const parts = buffer.split(/\r?\n/);
    if (source === "stdout") stdoutBuffer = parts.pop() ?? "";
    else stderrBuffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line && command.onOutputLine) {
        void Promise.resolve(command.onOutputLine(line)).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          log.write("\n[" + new Date().toISOString() + "] output callback error: " + message + "\n");
        });
      }
    }
  };
  child.stdout.on("data", (chunk) => { log.write(chunk); consumeLines(chunk, "stdout"); });
  child.stderr.on("data", (chunk) => { log.write(chunk); consumeLines(chunk, "stderr"); });

  let closed = false;
  child.on("error", async (error) => {
    if (closed) return;
    const finishedAt = new Date().toISOString();
    log.write("\n[" + finishedAt + "] ERROR " + error.message + "\n");
    log.end();
    const currentHandle = managedTasks.get(command.taskId);
    managedTasks.delete(command.taskId);
    if (currentHandle?.killTimer) clearTimeout(currentHandle.killTimer);
    await updateTask(command.taskId, { status: "failed", error: error.message, finished_at: finishedAt, updated_at: finishedAt });
    if (command.onFailure) await command.onFailure(error.message);
    closed = true;
  });

  child.on("close", async (code) => {
    if (closed) return;
    const finishedAt = new Date().toISOString();
    const currentHandle = managedTasks.get(command.taskId);
    managedTasks.delete(command.taskId);
    if (currentHandle?.killTimer) clearTimeout(currentHandle.killTimer);
    const canceled = currentHandle?.canceled;
    const ok = code === 0;
    log.write("\n[" + finishedAt + "] exit " + code + "\n");
    log.end();
    if (canceled) {
      await updateTask(command.taskId, { status: "canceled", exit_code: code ?? null, finished_at: finishedAt, updated_at: finishedAt, error: undefined });
      if (command.onCancel) await command.onCancel();
    } else if (ok) {
      try {
        if (command.onSuccess) await command.onSuccess();
        await updateTask(command.taskId, { status: "succeeded", exit_code: code ?? null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: undefined });
      } catch (callbackError) {
        const message = callbackError instanceof Error ? callbackError.message : String(callbackError);
        await updateTask(command.taskId, { status: "failed", exit_code: code ?? null, error: message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        if (command.onFailure) await command.onFailure(message);
      }
    } else {
      const error = "Command exited with code " + code;
      await updateTask(command.taskId, { status: "failed", exit_code: code ?? null, finished_at: finishedAt, updated_at: finishedAt, error });
      if (command.onFailure) await command.onFailure(error);
    }
    closed = true;
  });
}

export function createTask(type: TaskRecord["type"], command: string, cwd: string, logPath: string, metadata: Record<string, unknown> = {}): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: "task_" + randomUUID(),
    type,
    status: "queued",
    command,
    cwd,
    log_path: logPath,
    metadata,
    created_at: now,
    updated_at: now
  };
}

export async function pauseManagedTask(taskId: string): Promise<{ ok: boolean; detail: string }> {
  const handle = managedTasks.get(taskId);
  if (!handle) return { ok: false, detail: "Task process is not active on this API instance." };
  if (handle.paused) return { ok: true, detail: "Task is already paused." };
  if (!signalProcessGroup(handle.child, "SIGSTOP")) return { ok: false, detail: "Failed to pause task process." };
  handle.paused = true;
  await updateTask(taskId, { status: "paused", updated_at: new Date().toISOString() });
  return { ok: true, detail: "Task paused." };
}

export async function resumeManagedTask(taskId: string): Promise<{ ok: boolean; detail: string }> {
  const handle = managedTasks.get(taskId);
  if (!handle) return { ok: false, detail: "Task process is not active on this API instance." };
  if (!signalProcessGroup(handle.child, "SIGCONT")) return { ok: false, detail: "Failed to resume task process." };
  handle.paused = false;
  await updateTask(taskId, { status: "running", updated_at: new Date().toISOString() });
  return { ok: true, detail: "Task resumed." };
}

export async function cancelManagedTask(taskId: string): Promise<{ ok: boolean; detail: string }> {
  const handle = managedTasks.get(taskId);
  if (!handle) return { ok: false, detail: "Task process is not active on this API instance." };
  handle.canceled = true;
  if (handle.paused) signalProcessGroup(handle.child, "SIGCONT");
  if (!signalProcessGroup(handle.child, "SIGTERM")) return { ok: false, detail: "Failed to cancel task process." };
  handle.killTimer = setTimeout(() => {
    if (managedTasks.get(taskId) === handle) signalProcessGroup(handle.child, "SIGKILL");
  }, 10000);
  await updateTask(taskId, { status: "canceling", updated_at: new Date().toISOString() });
  return { ok: true, detail: "Task cancellation requested." };
}
