import { readFile } from "node:fs/promises";
import { readBody, sendJson } from "../serverUtils.js";
import { getTask, listModelFilesForTask, listTasks, updateTask } from "../store.js";
import { cleanupDownloadTemp } from "../downloadManager.js";
import { syncDownloadTaskFiles } from "../taskProgress.js";
import { diagnoseTask } from "../taskDiagnostics.js";
import { reconcileTask } from "../taskReconciler.js";
import { cancelManagedTask, pauseManagedTask, resumeManagedTask } from "../taskRunner.js";
import { listContainers } from "../containerTasks.js";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  workspaceRoot: string,
  logsRoot: string
) {
  route("GET", "/tasks", async (_req: any, res: any) => {
    const tasks = await Promise.all(listTasks().map((t: any) => taskWithFiles(t, workspaceRoot)));
    sendJson(res, 200, { tasks });
  });

  route("GET", "/tasks/:task_id", async (_req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    sendJson(res, 200, await taskWithFiles(task, workspaceRoot));
  });

  route("GET", "/tasks/:task_id/logs", async (_req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    const logs = await readFile(task.log_path, "utf-8").catch((e: any) => (e as Error).message);
    sendJson(res, 200, { task_id: task.id, log_path: task.log_path, logs });
  });

  route("POST", "/tasks/:task_id/pause", async (_req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    if (task.type !== "download") return sendJson(res, 400, { detail: "Only download tasks can be paused." });
    const result = await pauseManagedTask(task.id);
    sendJson(res, result.ok ? 200 : 409, result);
  });

  route("POST", "/tasks/:task_id/resume", async (_req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    if (task.type !== "download") return sendJson(res, 400, { detail: "Only download tasks can be resumed." });
    const result = await resumeManagedTask(task.id);
    sendJson(res, result.ok ? 200 : 409, result);
  });

  route("POST", "/tasks/:task_id/repair", async (req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    const body = await readBody<{ action?: string }>(req);
    if (!body.action) return sendJson(res, 400, { detail: "action is required" });
    try {
      const enriched = await taskWithFiles(task, workspaceRoot);
      if (!repairActionAllowed(enriched, body.action)) {
        return sendJson(res, 400, { detail: "Repair action is not available for this task diagnostic." });
      }
      sendJson(res, 200, await runRepairAction(task, body.action, workspaceRoot, logsRoot));
    } catch (error) {
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
  });

  route("POST", "/tasks/:task_id/cancel", async (_req: any, res: any, params: any) => {
    const task = getTask(params.task_id);
    if (!task) return sendJson(res, 404, { detail: "Unknown task: " + params.task_id });
    if (task.type !== "download") return sendJson(res, 400, { detail: "Only download tasks can be canceled." });
    const result = await cancelManagedTask(task.id);
    if (!result.ok && /not active/i.test(result.detail)) {
      const cleaned_temp_path = await cleanupDownloadTemp(task.metadata, workspaceRoot);
      await updateTask(task.id, { status: "canceled", finished_at: new Date().toISOString(), error: undefined });
      return sendJson(res, 200, { ok: true, detail: "Task process is not active; cleaned any staged download files.", cleaned_temp_path });
    }
    sendJson(res, result.ok ? 200 : 409, result);
  });
}

async function taskWithFiles(task: any, workspaceRoot: string) {
  const reconciled = await reconcileTask(task, workspaceRoot);
  if (!reconciled) return reconciled;
  const diagnostic = await diagnoseTask(reconciled);
  const base = diagnostic ? { ...reconciled, diagnostic } : reconciled;
  if (base.type !== "download") return base;
  await syncDownloadTaskFiles(base as any, workspaceRoot);
  return { ...base, model_files: listModelFilesForTask(base.id) };
}

async function runRepairAction(task: any, action: string, workspaceRoot: string, logsRoot: string) {
  if (action === "view_logs") {
    return { action, executable: true, logs_url: "/tasks/" + encodeURIComponent(task.id) + "/logs" };
  }
  if (action === "inspect_model_files") {
    const modelId = String(task.metadata?.model_id ?? task.metadata?.alias ?? "");
    return modelId
      ? { action, executable: true, model_files_url: "/models/" + encodeURIComponent(modelId) + "/files" }
      : { action, executable: false, detail: "No model id or alias is available on this task." };
  }
  if (action === "redownload_model") {
    const cleaned_temp_path = await cleanupDownloadTemp(task.metadata, workspaceRoot);
    return { action, executable: true, cleaned_temp_path, detail: "Staged download files were cleaned. Start the download again from the model URL." };
  }
  if (action === "lower_context_length") {
    return { action, executable: false, detail: "Lower context length/max tokens and retry." };
  }
  if (action === "choose_smaller_model") {
    return { action, executable: false, detail: "Choose a smaller or quantized model from the model library." };
  }
  if (action === "check_network") {
    return { action, executable: false, detail: "Check proxy/network settings, then retry." };
  }
  if (action === "stop_other_runtimes") {
    const payload = await listContainers();
    const stopped: any[] = [];
    return { action, executable: true, stopped, detail: "Use /engines endpoints to manage engine processes." };
  }
  return { action, executable: false, detail: "Unsupported repair action: " + action };
}

function repairActionAllowed(task: any, action?: string): boolean {
  if (!action) return false;
  if (action === "view_logs") return true;
  // Docker-specific actions are not available in LocalRuntime
  const unsupportedActions = [
    "change_port", "change_image", "pull_image",
    "stop_other_runtimes", "restart_runtime", "stop_conflicting_service",
    "start_docker", "check_docker_socket", "reset_runtime_params"
  ];
  if (unsupportedActions.includes(action)) return false;
  return Boolean(task?.diagnostic?.repair_actions?.some((item: any) => item.action === action));
}
