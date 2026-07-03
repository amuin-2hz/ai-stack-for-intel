import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectDownloadFileRecords } from "../src/taskProgress.js";

test("collectDownloadFileRecords reports staged files as downloading", async () => {
  const root = await mkdir(join(tmpdir(), "ai-stack-download-"), { recursive: true }).then(() => tmpdir());
  const dir = join(root, "ai-stack-download-files-" + Date.now());
  await mkdir(join(dir, ".temp", "nested"), { recursive: true });
  try {
    await writeFile(join(dir, ".temp", "nested", "model.safetensors"), "12345", "utf-8");
    const records = await collectDownloadFileRecords("demo", dir, "task_demo", "running");
    assert.equal(records.length, 1);
    assert.equal(records[0].relative_path, "nested/model.safetensors");
    assert.equal(records[0].status, "downloading");
    assert.equal(records[0].downloaded_bytes, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("collectDownloadFileRecords reports final files as downloaded and ignores marker", async () => {
  const dir = join(tmpdir(), "ai-stack-download-files-" + Date.now());
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, "config.json"), "{}", "utf-8");
    await writeFile(join(dir, ".download-complete"), "", "utf-8");
    const records = await collectDownloadFileRecords("demo", dir, "task_demo", "succeeded");
    assert.equal(records.length, 1);
    assert.equal(records[0].relative_path, "config.json");
    assert.equal(records[0].status, "downloaded");
    assert.equal(records[0].size_bytes, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
