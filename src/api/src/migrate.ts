import { readFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./db.js";

export function migrateFromJson(stateRoot: string): { migrated: boolean; detail: string } {
  const jsonPath = join(stateRoot, "workbench-state.json");
  if (!existsSync(jsonPath)) return { migrated: false, detail: "No legacy state file found." };

  const raw = readFileSync(jsonPath, "utf-8");
  const state = JSON.parse(raw);
  const db = getDb();

  const insertTask = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, type, status, metadata, log_path, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDeployment = db.prepare(
    `INSERT OR REPLACE INTO deployments (deployment_id, model_id, service_type, openai_model, container_name, status, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertChat = db.prepare(
    `INSERT OR REPLACE INTO chats (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (chat_id, type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const upsertSetting = db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`
  );

  const migrate = db.transaction(() => {
    if (state.tasks) {
      for (const t of Object.values(state.tasks) as any[]) {
        insertTask.run(t.id, t.type ?? "unknown", t.status ?? "unknown",
          JSON.stringify(t.metadata ?? {}), t.log_path ?? null, t.error ?? null,
          t.created_at, t.updated_at);
      }
    }
    if (state.deployments) {
      for (const d of Object.values(state.deployments) as any[]) {
        insertDeployment.run(d.deployment_id, d.model_id, d.service_type,
          d.openai_model, d.container_name ?? null, d.status ?? "configured",
          JSON.stringify(d.config ?? {}), d.created_at, d.updated_at);
      }
    }
    if (state.chats) {
      for (const c of Object.values(state.chats) as any[]) {
        insertChat.run(c.id, c.name, c.created_at, c.updated_at);
        if (c.messages) {
          for (const m of c.messages) {
            insertMessage.run(c.id, m.type, m.content,
              JSON.stringify(m.metadata ?? {}), m.created_at ?? c.updated_at);
          }
        }
      }
    }
    if (state.workbench) {
      upsertSetting.run("workbench", JSON.stringify(state.workbench), new Date().toISOString());
    }
    if (state.network) {
      upsertSetting.run("network", JSON.stringify(state.network), new Date().toISOString());
    }
    if (state.container_settings) {
      upsertSetting.run("container_settings", JSON.stringify(state.container_settings), new Date().toISOString());
    }
  });

  migrate();
  renameSync(jsonPath, jsonPath + ".bak");
  return { migrated: true, detail: `Migrated to SQLite. Backup: ${jsonPath}.bak` };
}
