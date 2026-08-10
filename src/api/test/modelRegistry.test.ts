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


test("listModels distinguishes raw text generation from agent-ready chat", async () => {
  const root = join(tmpdir(), "ai-stack-chat-audit-" + Date.now());
  const baseDir = join(root, "qwen-base");
  const instructDir = join(root, "qwen-instruct");
  const jinjaDir = join(root, "qwen-jinja-template");
  await mkdir(baseDir, { recursive: true });
  await mkdir(instructDir, { recursive: true });
  await mkdir(jinjaDir, { recursive: true });
  try {
    for (const dir of [baseDir, instructDir, jinjaDir]) {
      await writeFile(join(dir, "openvino_model.xml"), "<xml />", "utf-8");
      await writeFile(join(dir, "openvino_model.bin"), "weights", "utf-8");
      await writeFile(join(dir, "config.json"), JSON.stringify({ model_type: "qwen2", architectures: ["Qwen2ForCausalLM"] }), "utf-8");
    }
    await writeFile(join(instructDir, "tokenizer_config.json"), JSON.stringify({ chat_template: "{% for message in messages %}{{ message.content }}{% endfor %}" }), "utf-8");
    await writeFile(join(jinjaDir, "chat_template.jinja"), "{{ messages }}", "utf-8");

    const models = await listModels(root);
    const base = models.find((model) => model.id === "qwen-base");
    const instruct = models.find((model) => model.id === "qwen-instruct");
    const jinja = models.find((model) => model.id === "qwen-jinja-template");

    assert.equal(base?.compatibility.chat.status, "possible");
    assert.ok(base?.audit.issues.some((issue) => issue.code === "chat_template_unverified"));
    assert.equal(instruct?.compatibility.chat.status, "compatible");
    assert.equal(jinja?.compatibility.chat.status, "compatible");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("listModels recognizes Qwen3-ASR thinker exports", async () => {
  const root = join(tmpdir(), "ai-stack-qwen3-asr-audit-" + Date.now());
  const modelDir = join(root, "qwen3-asr-1.7b-ov-int8");
  const thinkerDir = join(modelDir, "thinker");
  await mkdir(thinkerDir, { recursive: true });
  try {
    await writeFile(join(modelDir, "config.json"), JSON.stringify({ model_type: "qwen3_asr" }), "utf-8");
    await writeFile(join(thinkerDir, "openvino_thinker_language_model.xml"), "<xml />", "utf-8");
    await writeFile(join(thinkerDir, "openvino_thinker_language_model.bin"), "weights", "utf-8");

    const models = await listModels(root);
    assert.equal(models[0].capabilities[0], "asr");
    assert.equal(models[0].compatibility.asr.status, "compatible");
    assert.match(models[0].compatibility.asr.reason, /isolated OpenVINO helper runtime/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
