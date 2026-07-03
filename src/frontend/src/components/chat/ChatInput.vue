<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { SendOutlined, AudioOutlined, PictureOutlined } from '@ant-design/icons-vue';
import { useChat } from '../../composables/useChat';
import { locale } from '../../composables/useLocale';

const { isStreaming, sendMessage, cancelStream } = useChat();

const inputText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const emit = defineEmits<{
  send: [text: string];
  stop: [];
}>();

function handleSend() {
  const text = inputText.value.trim();
  if (!text || isStreaming.value) return;
  inputText.value = '';
  sendMessage(text);
  // Reset textarea height
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
  }
}

function handleStop() {
  cancelStream();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}
</script>

<template>
  <div class="chat-input-bar">
    <div class="chat-input-row">
      <!-- Phase 3: Audio button -->
      <a-tooltip :title="locale === 'zh-CN' ? '语音输入 (即将推出)' : 'Voice input (coming soon)'">
        <a-button class="input-tool-btn" size="small" type="text" disabled>
          <template #icon><AudioOutlined /></template>
        </a-button>
      </a-tooltip>
      <!-- Phase 3: Image button -->
      <a-tooltip :title="locale === 'zh-CN' ? '图片上传 (即将推出)' : 'Image upload (coming soon)'">
        <a-button class="input-tool-btn" size="small" type="text" disabled>
          <template #icon><PictureOutlined /></template>
        </a-button>
      </a-tooltip>
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="chat-textarea"
        :placeholder="locale === 'zh-CN' ? '输入消息… (Enter 发送, Shift+Enter 换行)' : 'Type a message… (Enter to send, Shift+Enter for newline)'"
        rows="1"
        :disabled="isStreaming"
        @keydown="handleKeydown"
        @input="autoResize"
      ></textarea>
      <a-button
        v-if="!isStreaming"
        class="send-btn"
        type="primary"
        shape="circle"
        size="small"
        :disabled="!inputText.trim()"
        @click="handleSend"
      >
        <template #icon><SendOutlined /></template>
      </a-button>
      <a-button
        v-else
        class="stop-btn"
        danger
        shape="circle"
        size="small"
        @click="handleStop"
      >
        <template #icon><span style="display:block;width:10px;height:10px;background:#fff;border-radius:2px;margin:auto"></span></template>
      </a-button>
    </div>
    <div class="chat-input-hint">
      {{ locale === 'zh-CN' ? 'AI Stack for Intel 可能生成不准确的信息，请核实关键内容。' : 'AI Stack for Intel may produce inaccurate information. Verify important content.' }}
    </div>
  </div>
</template>
