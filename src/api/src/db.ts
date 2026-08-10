import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DATA_DIR = process.env.AI_STACK_DATA_DIR ?? join(homedir(), ".local", "share", "ai-stack");
const DB_PATH = process.env.AI_STACK_DB_PATH ?? join(DATA_DIR, "data.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

export function initDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'queued',
      metadata    TEXT,
      log_path    TEXT,
      error       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployments (
      deployment_id TEXT PRIMARY KEY,
      model_id      TEXT NOT NULL,
      service_type  TEXT NOT NULL,
      openai_model  TEXT NOT NULL,
      container_name TEXT,
      status        TEXT NOT NULL DEFAULT 'configured',
      config        TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_files (
      model_id         TEXT NOT NULL,
      relative_path    TEXT NOT NULL,
      status           TEXT NOT NULL,
      size_bytes       INTEGER,
      downloaded_bytes INTEGER,
      task_id          TEXT,
      error            TEXT,
      updated_at       TEXT NOT NULL,
      PRIMARY KEY (model_id, relative_path)
    );

    CREATE INDEX IF NOT EXISTS idx_model_files_task_id ON model_files(task_id);

    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Engine configurations replace container_configs for LocalRuntime
    CREATE TABLE IF NOT EXISTS engine_configs (
      key           TEXT PRIMARY KEY,
      engine_type   TEXT NOT NULL DEFAULT 'chat',
      device        TEXT NOT NULL DEFAULT 'GPU',
      port          INTEGER NOT NULL,
      auto_start    INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL
    );
  `);

  // Seed default engines
  const defaults = [
    { key: "chat", engine_type: "chat", port: 31000, device: "GPU" },
    { key: "vision", engine_type: "vision", port: 31001, device: "GPU" },
    { key: "asr", engine_type: "asr", port: 31002, device: "NPU" },
    { key: "tts", engine_type: "tts", port: 31003, device: "GPU" },
    { key: "embedding", engine_type: "embedding", port: 31004, device: "GPU" },
    { key: "rerank", engine_type: "rerank", port: 31005, device: "GPU" },
  ];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO engine_configs (key, engine_type, device, port, auto_start, updated_at)
     VALUES (@key, @engine_type, @device, @port, 0, datetime('now'))`
  );
  for (const d of defaults) {
    insert.run({ key: d.key, engine_type: d.engine_type, device: d.device, port: d.port });
  }
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}
