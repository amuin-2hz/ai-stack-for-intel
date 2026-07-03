import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { newId } from "./utils.js";
import type { ActiveDeploymentRecord, ChatMessage, ChatRecord, ContainerSettings, NetworkSettings, TaskRecord, WorkbenchSettings, WorkbenchState } from "./types.js";

const now = () => new Date().toISOString();


function defaultWorkbenchSettings(): WorkbenchSettings {
  const active = Number(process.env.FRONTEND_PORT ?? "8888");
  const desired = Number(process.env.MANAGEMENT_PORT ?? process.env.FRONTEND_PORT ?? "8888");
  return {
    management_port: desired,
    active_management_port: active,
    requires_restart: active !== desired,
    updated_at: now()
  };
}

function defaultNetworkSettings(): NetworkSettings {
  const active = process.env.AI_STACK_BIND_ADDR ?? "0.0.0.0";
  const enabled = process.env.LAN_ACCESS_ENABLED !== "0";
  const desired = enabled ? "0.0.0.0" : "127.0.0.1";
  return {
    lan_access_enabled: enabled,
    desired_bind_address: desired,
    active_bind_address: active,
    requires_restart: active !== desired,
    updated_at: now()
  };
}

function defaultContainerSettings(): Record<string, ContainerSettings> {
  return {
    vllm: { key: "vllm", public_port: 30000, management_mode: "resident", restart_policy: "no", auto_restart: false, updated_at: now() },
    trtllm: { key: "trtllm", public_port: 31000, management_mode: "resident", restart_policy: "no", auto_restart: false, updated_at: now() },
    pytorch: { key: "pytorch", public_port: 32000, management_mode: "resident", restart_policy: "unless-stopped", auto_restart: true, updated_at: now() }
  };
}

function createInitialState(): WorkbenchState {
  const chatId = newId("chat");
  return {
    current_chat_id: chatId,
    selected_model: process.env.DEFAULT_MODEL ?? "qwen3-8b",
    selected_sources: [],
    ingest_tasks: {},
    tasks: {},
    deployments: {},
    network: defaultNetworkSettings(),
    container_settings: defaultContainerSettings(),
    workbench: defaultWorkbenchSettings(),
    chats: {
      [chatId]: {
        id: chatId,
        name: "New Chat",
        messages: [],
        created_at: now(),
        updated_at: now()
      }
    }
  };
}

export class StateStore {
  private state: WorkbenchState | null = null;

  constructor(private readonly path: string) {}

  async load(): Promise<WorkbenchState> {
    if (this.state) return this.state;
    try {
      const content = await readFile(this.path, "utf-8");
      this.state = JSON.parse(content) as WorkbenchState;
      this.state.tasks ??= {};
      this.state.deployments ??= {};
      this.state.network ??= defaultNetworkSettings();
      this.state.workbench ??= defaultWorkbenchSettings();
      this.state.workbench.active_management_port = Number(process.env.FRONTEND_PORT ?? "8888");
      this.state.workbench.requires_restart = this.state.workbench.active_management_port !== this.state.workbench.management_port;
      this.state.container_settings = { ...defaultContainerSettings(), ...(this.state.container_settings ?? {}) };
      this.state.network.active_bind_address = process.env.AI_STACK_BIND_ADDR ?? "0.0.0.0";
      this.state.network.requires_restart = this.state.network.active_bind_address !== this.state.network.desired_bind_address;
    } catch {
      this.state = createInitialState();
      await this.save();
    }
    return this.state;
  }

  async save(): Promise<void> {
    if (!this.state) return;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.state, null, 2));
  }

  async getCurrentChatId(): Promise<string> {
    return (await this.load()).current_chat_id;
  }

  async setCurrentChatId(chatId: string): Promise<void> {
    const state = await this.load();
    if (!state.chats[chatId]) {
      state.chats[chatId] = this.makeChat(chatId);
    }
    state.current_chat_id = chatId;
    await this.save();
  }

  async listChats(): Promise<string[]> {
    const state = await this.load();
    return Object.values(state.chats)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((chat) => chat.id);
  }

  async getChat(chatId: string): Promise<ChatRecord> {
    const state = await this.load();
    if (!state.chats[chatId]) {
      state.chats[chatId] = this.makeChat(chatId);
      await this.save();
    }
    return state.chats[chatId];
  }

  async createChat(): Promise<ChatRecord> {
    const state = await this.load();
    const chat = this.makeChat(newId("chat"));
    state.chats[chat.id] = chat;
    state.current_chat_id = chat.id;
    await this.save();
    return chat;
  }

  async renameChat(chatId: string, name: string): Promise<void> {
    const chat = await this.getChat(chatId);
    chat.name = name;
    chat.updated_at = now();
    await this.save();
  }

  async deleteChat(chatId: string): Promise<void> {
    const state = await this.load();
    delete state.chats[chatId];
    if (!Object.keys(state.chats).length) {
      const chat = this.makeChat(newId("chat"));
      state.chats[chat.id] = chat;
      state.current_chat_id = chat.id;
    } else if (state.current_chat_id === chatId) {
      state.current_chat_id = Object.values(state.chats).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0].id;
    }
    await this.save();
  }

  async clearChats(): Promise<{ cleared: number; newChatId: string }> {
    const state = await this.load();
    const cleared = Object.keys(state.chats).length;
    const chat = this.makeChat(newId("chat"));
    state.chats = { [chat.id]: chat };
    state.current_chat_id = chat.id;
    await this.save();
    return { cleared, newChatId: chat.id };
  }

  async appendMessage(chatId: string, message: ChatMessage): Promise<void> {
    const chat = await this.getChat(chatId);
    chat.messages.push(message);
    chat.updated_at = now();
    if (message.type === "HumanMessage" && chat.name === "New Chat") {
      chat.name = message.content.slice(0, 42) || "New Chat";
    }
    await this.save();
  }

  async selectedSources(): Promise<string[]> {
    return (await this.load()).selected_sources;
  }

  async setSelectedSources(sources: string[]): Promise<void> {
    const state = await this.load();
    state.selected_sources = sources;
    await this.save();
  }

  async selectedModel(): Promise<string> {
    return (await this.load()).selected_model;
  }

  async setSelectedModel(model: string): Promise<void> {
    const state = await this.load();
    state.selected_model = model;
    await this.save();
  }

  async setIngestTask(taskId: string, status: string): Promise<void> {
    const state = await this.load();
    state.ingest_tasks[taskId] = status;
    await this.save();
  }

  async ingestStatus(taskId: string): Promise<string | undefined> {
    return (await this.load()).ingest_tasks[taskId];
  }

  async createTask(task: TaskRecord): Promise<TaskRecord> {
    const state = await this.load();
    state.tasks ??= {};
    state.tasks[task.id] = task;
    await this.save();
    return task;
  }

  async updateTask(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | undefined> {
    const state = await this.load();
    state.tasks ??= {};
    const current = state.tasks[taskId];
    if (!current) return undefined;
    state.tasks[taskId] = { ...current, ...patch, updated_at: patch.updated_at ?? new Date().toISOString() };
    for (const [key, value] of Object.entries(state.tasks[taskId])) {
      if (value === undefined) delete (state.tasks[taskId] as unknown as Record<string, unknown>)[key];
    }
    await this.save();
    return state.tasks[taskId];
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const state = await this.load();
    return state.tasks?.[taskId];
  }

  async listTasks(): Promise<TaskRecord[]> {
    const state = await this.load();
    return Object.values(state.tasks ?? {}).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async upsertDeployment(deployment: ActiveDeploymentRecord): Promise<ActiveDeploymentRecord> {
    const state = await this.load();
    state.deployments ??= {};
    state.deployments[deployment.deployment_id] = deployment;
    await this.save();
    return deployment;
  }

  async listActiveDeployments(): Promise<ActiveDeploymentRecord[]> {
    const state = await this.load();
    return Object.values(state.deployments ?? {}).sort((a, b) => a.service_type.localeCompare(b.service_type));
  }

  async getActiveDeployment(deploymentId: string): Promise<ActiveDeploymentRecord | undefined> {
    const state = await this.load();
    return state.deployments?.[deploymentId];
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    const state = await this.load();
    state.deployments ??= {};
    delete state.deployments[deploymentId];
    await this.save();
  }

  async networkSettings(): Promise<NetworkSettings> {
    const state = await this.load();
    state.network ??= defaultNetworkSettings();
    state.network.active_bind_address = process.env.AI_STACK_BIND_ADDR ?? "0.0.0.0";
    state.network.requires_restart = state.network.active_bind_address !== state.network.desired_bind_address;
    return state.network;
  }

  async setNetworkAccess(lanAccessEnabled: boolean): Promise<NetworkSettings> {
    const state = await this.load();
    const desired = lanAccessEnabled ? "0.0.0.0" : "127.0.0.1";
    state.network = {
      lan_access_enabled: lanAccessEnabled,
      desired_bind_address: desired,
      active_bind_address: process.env.AI_STACK_BIND_ADDR ?? "0.0.0.0",
      requires_restart: (process.env.AI_STACK_BIND_ADDR ?? "0.0.0.0") !== desired,
      updated_at: now()
    };
    await this.save();
    return state.network;
  }


  async workbenchSettings(): Promise<WorkbenchSettings> {
    const state = await this.load();
    state.workbench ??= defaultWorkbenchSettings();
    state.workbench.active_management_port = Number(process.env.FRONTEND_PORT ?? "8888");
    state.workbench.requires_restart = state.workbench.active_management_port !== state.workbench.management_port;
    return state.workbench;
  }

  async setManagementPort(port: number): Promise<WorkbenchSettings> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("management_port must be between 1024 and 65535");
    const state = await this.load();
    const active = Number(process.env.FRONTEND_PORT ?? "8888");
    state.workbench = {
      management_port: port,
      active_management_port: active,
      requires_restart: active !== port,
      updated_at: now()
    };
    await this.save();
    return state.workbench;
  }

  async listContainerSettings(): Promise<Record<string, ContainerSettings>> {
    const state = await this.load();
    state.container_settings = { ...defaultContainerSettings(), ...(state.container_settings ?? {}) };
    return state.container_settings;
  }

  async getContainerSettings(key: string): Promise<ContainerSettings> {
    const settings = await this.listContainerSettings();
    return settings[key] ?? { ...defaultContainerSettings().vllm, key };
  }

  async setContainerSettings(key: string, patch: Partial<ContainerSettings>): Promise<ContainerSettings> {
    const state = await this.load();
    state.container_settings = { ...defaultContainerSettings(), ...(state.container_settings ?? {}) };
    const current = state.container_settings[key] ?? { ...defaultContainerSettings().vllm, key };
    const publicPort = Number(patch.public_port ?? current.public_port);
    if (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535) throw new Error("public_port must be between 1024 and 65535");
    const managementMode = patch.management_mode === "once" ? "once" : "resident";
    const restartPolicy = patch.restart_policy === "always" || patch.restart_policy === "on-failure" || patch.restart_policy === "no" ? patch.restart_policy : patch.auto_restart === false || managementMode === "once" ? "no" : "unless-stopped";
    const next: ContainerSettings = {
      ...current,
      key,
      public_port: publicPort,
      management_mode: managementMode,
      restart_policy: restartPolicy,
      auto_restart: restartPolicy !== "no",
      updated_at: now()
    };
    state.container_settings[key] = next;
    await this.save();
    return next;
  }

  private makeChat(id: string): ChatRecord {
    return {
      id,
      name: "New Chat",
      messages: [],
      created_at: now(),
      updated_at: now()
    };
  }
}
