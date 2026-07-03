import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcludedSnapshotFile } from "../src/modelManifest.js";

test("isExcludedSnapshotFile skips cache, git, and duplicate framework artifacts", () => {
  assert.equal(isExcludedSnapshotFile(".git/config"), true);
  assert.equal(isExcludedSnapshotFile(".cache/huggingface/foo"), true);
  assert.equal(isExcludedSnapshotFile("nested/.git/config"), true);
  assert.equal(isExcludedSnapshotFile("model.ckpt"), true);
  assert.equal(isExcludedSnapshotFile("weights.safetensors"), false);
  assert.equal(isExcludedSnapshotFile("config.json"), false);
});
