import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listModels, parseModelSource } from "../src/modelRegistry.js";

test("listModels flags HF weights without config.json", async () => {
  const root = join(tmpdir(), "ai-stack-model-audit-" + Date.now());
  const modelDir = join(root, "qwen-missing-config");
  await mkdir(modelDir, { recursive: true });
  try {
    await writeFile(join(modelDir, "model.safetensors"), "weights", "utf-8");
    const models = await listModels(root);
    assert.equal(models.length, 1);
    assert.equal(models[0].local.format, "hf_safetensors");
    assert.equal(models[0].status.download, "needs_review");
    assert.ok(models[0].audit.issues.some((issue) => issue.code === "missing_config"));
    assert.equal(models[0].compatibility.chat.status, "unsupported");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listModels reports download staging directories as incomplete", async () => {
  const root = join(tmpdir(), "ai-stack-model-audit-" + Date.now());
  const modelDir = join(root, "active-download");
  await mkdir(join(modelDir, ".temp"), { recursive: true });
  try {
    await writeFile(join(modelDir, "config.json"), "{}", "utf-8");
    await writeFile(join(modelDir, ".temp", "model.safetensors"), "partial", "utf-8");
    const models = await listModels(root);
    assert.equal(models.length, 1);
    assert.equal(models[0].status.download, "incomplete");
    assert.ok(models[0].audit.issues.some((issue) => issue.code === "download_staging_present"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parseModelSource handles common Hugging Face and ModelScope URLs", () => {
  assert.deepEqual(parseModelSource("https://huggingface.co/Qwen/Qwen3-Embedding-8B"), {
    provider: "huggingface",
    repo_id: "Qwen/Qwen3-Embedding-8B",
    alias: "qwen3-embedding-8b",
    target_path: "models/qwen3-embedding-8b",
    original_url: "https://huggingface.co/Qwen/Qwen3-Embedding-8B"
  });
  assert.equal(parseModelSource("https://modelscope.cn/models/Qwen/Qwen3-Embedding-8B").provider, "modelscope");
  assert.equal(parseModelSource("hf://Qwen/Qwen3-Embedding-8B").repo_id, "Qwen/Qwen3-Embedding-8B");
});
