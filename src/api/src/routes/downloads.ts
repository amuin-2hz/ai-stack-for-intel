import { readBody, sendJson } from "../serverUtils.js";
import { DownloadConflictError, startDownload } from "../downloadManager.js";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  workspaceRoot: string,
  logsRoot: string
) {
  route("POST", "/downloads", async (req: any, res: any) => {
    const body = await readBody<{ url?: string; alias?: string; provider?: string }>(req);
    if (!body.url) return sendJson(res, 400, { detail: "url is required" });
    try {
      sendJson(res, 202, await startDownload({ url: body.url, alias: body.alias, provider: body.provider }, workspaceRoot, logsRoot));
    } catch (error) {
      if (error instanceof DownloadConflictError) {
        return sendJson(res, error.statusCode, { detail: error.message, task: error.task });
      }
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
  });
}
