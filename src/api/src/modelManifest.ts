export interface RemoteModelFile {
  relative_path: string;
  size_bytes: number | null;
}

type HuggingFaceModelInfo = { siblings?: Array<{ rfilename?: string; size?: number }> };

export async function fetchHuggingFaceManifest(repoId: string): Promise<RemoteModelFile[]> {
  const payload = await fetchHuggingFaceModelInfo(repoId);
  if (!payload) return [];
  return (payload.siblings ?? [])
    .filter((file) => file.rfilename && !isExcludedSnapshotFile(file.rfilename))
    .map((file) => ({ relative_path: file.rfilename as string, size_bytes: Number.isFinite(Number(file.size)) ? Number(file.size) : null }));
}

export async function fetchHuggingFaceTotalBytes(repoId: string): Promise<number | undefined> {
  const files = await fetchHuggingFaceManifest(repoId);
  const total = files.reduce((sum, file) => sum + (Number(file.size_bytes) || 0), 0);
  return total || undefined;
}

async function fetchHuggingFaceModelInfo(repoId: string): Promise<HuggingFaceModelInfo | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(huggingFaceModelInfoUrl(repoId), { signal: controller.signal });
    if (!response.ok) return undefined;
    return await response.json() as HuggingFaceModelInfo;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function huggingFaceModelInfoUrl(repoId: string): string {
  return "https://huggingface.co/api/models/" + encodeURIComponent(repoId).replace(/%2F/g, "/") + "?blobs=true";
}

export function isExcludedSnapshotFile(name: string): boolean {
  return name.startsWith(".git/") || name.startsWith(".cache/") || name.includes("/.git/") || /\.(msgpack|h5|ckpt|tflite|pb|flax|ot)$/.test(name);
}
