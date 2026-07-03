import { message } from 'ant-design-vue';
import { t } from './useLocale';
import { apiUrl } from './apiBase';

/* ── non-streaming fetch wrapper ──────────────── */
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail ?? payload.error?.message ?? 'Request failed');
  return payload as T;
}

/* ── SSE streaming chat client ────────────────── */
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export async function streamChatCompletion(
  params: {
    model: string;
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    stream: true;
  },
  callbacks: StreamCallbacks,
): Promise<AbortController> {
  const controller = new AbortController();

  try {
    const response = await fetch(apiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let detail = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.detail ?? parsed.error?.message ?? detail;
      } catch { /* use raw status */ }
      throw new Error(detail);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last partial line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6); // Remove 'data: ' prefix
        if (data === '[DONE]') {
          reader.cancel();
          callbacks.onDone();
          return controller;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) callbacks.onToken(content);
        } catch {
          // Skip unparseable chunks
        }
      }
    }

    // Stream ended without [DONE]
    callbacks.onDone();
    return controller;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      callbacks.onDone();
    } else {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
    return controller;
  }
}

/* ── clipboard ────────────────────────────────── */
export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    message.success(t('copied'));
  } catch {
    message.error(t('copyFailed'));
  }
}
