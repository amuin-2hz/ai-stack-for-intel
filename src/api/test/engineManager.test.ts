/**
 * Author: zhenz
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveRuntimePython } from "../src/engineManager.js";

test("resolveRuntimePython prefers explicit runtime python path", async () => {
  const root = join(tmpdir(), "ai-stack-runtime-python-" + Date.now());
  const fakePython = join(root, "bin", "python");
  const previousRuntimePython = process.env.AI_STACK_RUNTIME_PYTHON;
  const previousRuntimeDir = process.env.AI_STACK_RUNTIME_DIR;

  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(fakePython, "#!/bin/sh\n", "utf-8");
  process.env.AI_STACK_RUNTIME_PYTHON = fakePython;
  delete process.env.AI_STACK_RUNTIME_DIR;

  try {
    assert.equal(await resolveRuntimePython(), fakePython);
  } finally {
    if (previousRuntimePython === undefined) {
      delete process.env.AI_STACK_RUNTIME_PYTHON;
    } else {
      process.env.AI_STACK_RUNTIME_PYTHON = previousRuntimePython;
    }
    if (previousRuntimeDir === undefined) {
      delete process.env.AI_STACK_RUNTIME_DIR;
    } else {
      process.env.AI_STACK_RUNTIME_DIR = previousRuntimeDir;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveRuntimePython falls back to python3 when runtime is unavailable", async () => {
  const previousRuntimePython = process.env.AI_STACK_RUNTIME_PYTHON;
  const previousRuntimeDir = process.env.AI_STACK_RUNTIME_DIR;

  process.env.AI_STACK_RUNTIME_PYTHON = join(tmpdir(), "missing-runtime-python");
  process.env.AI_STACK_RUNTIME_DIR = join(tmpdir(), "missing-runtime-dir");

  try {
    assert.equal(await resolveRuntimePython(), "python3");
  } finally {
    if (previousRuntimePython === undefined) {
      delete process.env.AI_STACK_RUNTIME_PYTHON;
    } else {
      process.env.AI_STACK_RUNTIME_PYTHON = previousRuntimePython;
    }
    if (previousRuntimeDir === undefined) {
      delete process.env.AI_STACK_RUNTIME_DIR;
    } else {
      process.env.AI_STACK_RUNTIME_DIR = previousRuntimeDir;
    }
  }
});
