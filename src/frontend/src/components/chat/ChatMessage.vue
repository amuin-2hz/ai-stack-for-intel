<script setup lang="ts">
import { computed } from 'vue';
import { CopyOutlined, SoundOutlined } from '@ant-design/icons-vue';
import ChatMessageMarkdown from './ChatMessageMarkdown.vue';
import { copyText } from '../../composables/useApi';
import { locale, formatDuration } from '../../composables/useLocale';
import type { ChatMessage as ChatMessageType } from '../../types';

const props = defineProps<{
  message: ChatMessageType;
  isStreaming: boolean;
}>();

const isUser = computed(() => props.message.role === 'user');
const isAssistant = computed(() => props.message.role === 'assistant');
const isEmpty = computed(() => props.message.content.length === 0 && props.isStreaming);
const timeLabel = computed(() => {
  try {
    return new Date(props.message.timestamp).toLocaleTimeString(
      locale.value === 'zh-CN' ? 'zh-CN' : 'en-US',
      { hour: '2-digit', minute: '2-digit' }
    );
  } catch { return ''; }
});

function handleCopy() {
  copyText(props.message.content);
}
</script>

<template>
  <div :class="['chat-message', isUser ? 'chat-message--user' : 'chat-message--assistant']">
    <div class="chat-message-avatar">
      <span v-if="isUser">👤</span>
      <span v-else>🤖</span>
    </div>
    <div class="chat-message-body">
      <div class="chat-message-header">
        <span class="chat-message-role">{{ isUser ? (locale === 'zh-CN' ? '你' : 'You') : 'AI Stack for Intel' }}</span>
        <span class="chat-message-time">{{ timeLabel }}</span>
      </div>
      <div class="chat-message-content">
        <template v-if="isUser">
          <div class="chat-message-text">{{ message.content }}</div>
        </template>
        <template v-else-if="isEmpty">
          <div class="streaming-indicator">
            <span class="streaming-dot"></span>
            <span class="streaming-dot"></span>
            <span class="streaming-dot"></span>
          </div>
        </template>
        <template v-else>
          <ChatMessageMarkdown :content="message.content" />
          <div v-if="isStreaming && message.content" class="streaming-cursor">▍</div>
        </template>
      </div>
      <div v-if="isAssistant && !isEmpty" class="chat-message-actions">
        <a-button size="small" type="text" @click="handleCopy">
          <template #icon><CopyOutlined /></template>
        </a-button>
        <!-- Phase 3: TTS button -->
      </div>
    </div>
  </div>
</template>
