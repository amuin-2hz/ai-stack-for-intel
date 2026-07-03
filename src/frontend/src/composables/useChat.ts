import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { streamChatCompletion } from './useApi';
import { t } from './useLocale';
import { runningDeployments } from './useApp';
import type { Conversation, ChatMessage } from '../types';

/* ── localStorage persistence ────────────────── */
const STORAGE_KEY = 'localruntime-conversations';
const MAX_CONVERSATIONS = 100;

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(list: Conversation[]): void {
  try {
    // LRU eviction
    if (list.length > MAX_CONVERSATIONS) {
      list = list.slice(list.length - MAX_CONVERSATIONS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage full — silently fail
  }
}

function generateId(): string {
  return 'conv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function messageId(): string {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/* ── reactive state ──────────────────────────── */
const conversations = ref<Conversation[]>(loadConversations());
const activeConversationId = ref<string | null>(null);
const isStreaming = ref(false);
const streamingContent = ref('');

/* ── computed ─────────────────────────────────── */
const activeConversation = computed(() =>
  conversations.value.find((c) => c.id === activeConversationId.value) ?? null,
);

const conversationList = computed(() =>
  [...conversations.value].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  ),
);

/* ── helper ──────────────────────────────────── */
function persist(): void {
  saveConversations(conversations.value);
}

/* ── actions ──────────────────────────────────── */
function getDefaultModel(): string {
  // Use the first running deployment's model, or fall back to empty
  const running = runningDeployments.value;
  if (running.length > 0) {
    return running[0].openai_models[0] || running[0].runtime || '';
  }
  return '';
}

function createConversation(modelId?: string): Conversation {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: generateId(),
    title: t('newChat'),
    modelId: modelId || getDefaultModel(),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  conversations.value.push(conv);
  persist();
  return conv;
}

function deleteConversation(id: string): void {
  conversations.value = conversations.value.filter((c) => c.id !== id);
  if (activeConversationId.value === id) {
    activeConversationId.value = conversations.value[0]?.id ?? null;
  }
  persist();
}

function setActiveConversation(id: string): void {
  const exists = conversations.value.find((c) => c.id === id);
  if (exists) {
    activeConversationId.value = id;
  }
}

function clearConversation(id: string): void {
  const conv = conversations.value.find((c) => c.id === id);
  if (conv) {
    conv.messages = [];
    conv.updatedAt = new Date().toISOString();
    persist();
  }
}

function renameConversation(id: string, title: string): void {
  const conv = conversations.value.find((c) => c.id === id);
  if (conv && title.trim()) {
    conv.title = title.trim();
    conv.updatedAt = new Date().toISOString();
    persist();
  }
}

async function sendMessage(content: string): Promise<void> {
  let conv = activeConversation.value;

  // Auto-create conversation if none active
  if (!conv) {
    conv = createConversation();
    activeConversationId.value = conv.id;
    // Auto-title from first message
    conv.title = content.slice(0, 40) + (content.length > 40 ? '…' : '');
  }

  // Add user message
  const userMsg: ChatMessage = {
    id: messageId(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
  conv.messages.push(userMsg);
  conv.updatedAt = new Date().toISOString();

  // Create placeholder for assistant response
  const assistantMsg: ChatMessage = {
    id: messageId(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  };
  conv.messages.push(assistantMsg);
  persist();

  // Stream
  isStreaming.value = true;
  streamingContent.value = '';

  const historyMessages = conv.messages
    .filter((m) => m.id !== assistantMsg.id) // exclude the empty placeholder
    .map((m) => ({ role: m.role, content: m.content }));

  await streamChatCompletion(
    {
      model: conv.modelId,
      messages: historyMessages,
      stream: true,
    },
    {
      onToken: (token) => {
        streamingContent.value += token;
        assistantMsg.content = streamingContent.value;
      },
      onDone: () => {
        isStreaming.value = false;
        streamingContent.value = '';
        conv.updatedAt = new Date().toISOString();

        // Auto-title if this is the first exchange
        if (conv.messages.filter((m) => m.role === 'user').length === 1) {
          const firstContent = conv.messages.find((m) => m.role === 'user')?.content ?? '';
          conv.title = firstContent.slice(0, 40) + (firstContent.length > 40 ? '…' : '');
        }

        persist();
      },
      onError: (error) => {
        isStreaming.value = false;
        assistantMsg.content = t('streamError') + ': ' + error.message;
        conv.updatedAt = new Date().toISOString();
        persist();
      },
    },
  );
}

function cancelStream(): void {
  // The AbortController is managed inside streamChatCompletion.
  // External abort is handled by the returned controller.
  // For now we set streaming to false as a fallback.
  isStreaming.value = false;
}

/* ── export ──────────────────────────────────── */
export function useChat() {
  return {
    // state
    conversations,
    activeConversationId,
    isStreaming,
    streamingContent,
    // computed
    activeConversation,
    conversationList,
    // actions
    createConversation,
    deleteConversation,
    setActiveConversation,
    clearConversation,
    renameConversation,
    sendMessage,
    cancelStream,
  };
}
