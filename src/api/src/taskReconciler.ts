import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { enrichTaskProgress } from "./taskProgress.js";
import { runCommand } from "./utils.js";
import { updateTask } from "./store.js";
import type { TaskRecord } from "./types.js";

/**
 * Check whether a `.download-complete` marker file exists at the target path.
 * Download scripts touch this marker AFTER moving files from `.temp` → final
 * location, which is the authoritative signal that download is truly finished.
 */
async function hasDownloadCompleteMarker(targetPath: string): Promise<boolean> {
  try {
    await access(join(targetPath, ".download-complete"));
    return true;
  } catch {
    return false;
  }
}

/**
 * If the download target has a `.download-complete` marker, write "succeeded"
 * to the database immediately. This is the definitive signal from the download
 * script that files are fully downloaded and moved to the final directory.
 */
async function tryCommitDownloadSuccess(
  task: TaskRecord,
  workspaceRoot: string
): Promise<TaskRecord | undefined> {
  if (task.type !== "download") return undefined;
  if (task.status === "succeeded") return undefined;

  const targetPath = typeof task.metadata?.target_path === "string"
    ? resolve(workspaceRoot, task.metadata.target_path)
    : undefined;
  if (!targetPath) return undefined;

  const markerPresent = await hasDownloadCompleteMarker(targetPath);
  if (!markerPresent) return undefined;

  // Write success to DB — the definitive write triggered by the marker file.
  const updated = await updateTask(task.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error: undefined
  });
  if (updated) return await enrichTaskProgress(updated, workspaceRoot);
  const enriched2 = await enrichTaskProgress(task, workspaceRoot);
  return { ...enriched2, status: "succeeded" } as TaskRecord;
}

export async function reconcileTask(
  task: TaskRecord | undefined,
  workspaceRoot: string
) {
  if (!task) return task;

  const normalizedFailed = await normalizeFailedRuntimePlan(task);
  if (normalizedFailed) return normalizedFailed;

  // Priority 1: .download-complete marker → definitive DB write
  const committed = await tryCommitDownloadSuccess(task, workspaceRoot);
  if (committed) return committed;

  const enriched = await enrichTaskProgress(task, workspaceRoot);

  // Priority 2: heuristic complete_on_disk fallback
  if (task.type === "download" && enriched.complete_on_disk && task.status !== "succeeded") {
    const updated = await updateTask(task.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error: undefined
    });
    return updated
      ? await enrichTaskProgress(updated, workspaceRoot)
      : { ...enriched, status: "succeeded" };
  }

  // Don't mark download as failed just because process exited
  if (task.status === "running" && !(await isTaskProcessActive(task))) {
    if (task.type === "download") {
      return enriched;
    }
    const updated = await updateTask(task.id, {
      status: "failed",
      metadata: metadataWithFailedRuntimeStage(task),
      finished_at: new Date().toISOString(),
      error: "Task process was interrupted or the management service restarted before completion."
    });
    return updated
      ? await enrichTaskProgress(updated, workspaceRoot)
      : { ...enriched, status: "failed", error: "Task process was interrupted or the management service restarted before completion." };
  }

  // Skip log error scan for download tasks
  if (task.status === "succeeded" && task.log_path && task.type !== "download") {
    const logErrors = await scanLogForErrors(task.log_path);
    if (logErrors) {
      const updated = await updateTask(task.id, {
        status: "failed", error: logErrors,
        metadata: metadataWithFailedRuntimeStage(task),
        finished_at: task.finished_at ?? new Date().toISOString()
      });
      return updated
        ? await enrichTaskProgress(updated, workspaceRoot)
        : { ...enriched, status: "failed", error: logErrors };
    }
  }
  return enriched;
}

async function normalizeFailedRuntimePlan(task: TaskRecord): Promise<TaskRecord | undefined> {
  if (task.status !== "failed") return undefined;
  const plan = task.metadata?.runtime_plan;
  if (!plan || typeof plan !== "object") return undefined;
  const existingPlan = plan as { current_stage?: unknown; stage_statuses?: Record<string, string> };
  const currentStage = typeof existingPlan.current_stage === "string" ? existingPlan.current_stage : undefined;
  if (!currentStage || existingPlan.stage_statuses?.[currentStage] === "failed") return undefined;
  const updated = await updateTask(task.id, { metadata: metadataWithFailedRuntimeStage(task) });
  return updated;
}

function metadataWithFailedRuntimeStage(task: TaskRecord): Record<string, unknown> {
  const plan = task.metadata?.runtime_plan;
  if (!plan || typeof plan !== "object") return task.metadata;
  const existingPlan = plan as { current_stage?: unknown; stage_statuses?: Record<string, string> };
  const currentStage = typeof existingPlan.current_stage === "string" ? existingPlan.current_stage : undefined;
  if (!currentStage) return task.metadata;
  return {
    ...task.metadata,
    runtime_plan: {
      ...existingPlan,
      stage_statuses: { ...(existingPlan.stage_statuses ?? {}), [currentStage]: "failed" }
    }
  };
}

async function scanLogForErrors(logPath: string): Promise<string | null> {
  try {
    const content = await readFile(logPath, "utf-8");
    const errorLines: string[] = [];
    for (const line of content.split("\n")) {
      if (
        /\b(ERROR|FATAL|Error:|error:|Traceback|exception|failed|Failed)\b/.test(line) &&
        !/\b(exit 0|succeeded|download completed|Download finished|100%|model ready)\b/i.test(line)
      ) {
        errorLines.push(line.trim());
      }
    }
    if (errorLines.length > 0) {
      return "Log contains error indicators: " + errorLines.slice(0, 3).join(" | ") + (errorLines.length > 3 ? " ..." : "");
    }
  } catch { /* log file not readable */ }
  return null;
}

async function isTaskProcessActive(task: {
  command: string; metadata: Record<string, unknown>; type: string;
}): Promise<boolean> {
  const result = await runCommand("ps", ["-eo", "args="], 3000);
  if (!result.ok || !result.stdout) return true;
  const haystack = result.stdout;
  const tokens = [
    task.command,
    String(task.metadata?.repo_id ?? ""),
    String(task.metadata?.alias ?? ""),
    String(task.metadata?.model_id ?? ""),
    String(task.metadata?.name ?? "")
  ].filter((token) => token.length > 4);
  return tokens.some((token) => haystack.includes(token));
}
