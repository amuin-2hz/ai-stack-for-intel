<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import { useChat } from '../../composables/useChat';
import ChatMessage from './ChatMessage.vue';
import WelcomeBanner from './WelcomeBanner.vue';

const { activeConversation, isStreaming } = useChat();

const scrollContainer = ref<HTMLElement | null>(null);
const isNearBottom = ref(true);

const messages = computed(() => activeConversation.value?.messages ?? []);

function checkScrollPosition() {
  const el = scrollContainer.value;
  if (!el) return;
  const threshold = 80;
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottom(force = false) {
  const el = scrollContainer.value;
  if (!el) return;
  if (force || isNearBottom.value || isStreaming.value) {
    el.scrollTop = el.scrollHeight;
  }
}

// Watch for message changes (new messages, streaming content)
watch(
  () => [messages.value.length, messages.value[messages.value.length - 1]?.content],
  () => {
    nextTick(() => scrollToBottom());
  },
  { deep: false }
);

// Watch streaming state
watch(isStreaming, (streaming) => {
  if (streaming) {
    nextTick(() => scrollToBottom(true));
  }
});

onMounted(() => {
  nextTick(() => scrollToBottom(true));
  scrollContainer.value?.addEventListener('scroll', checkScrollPosition, { passive: true });
});
</script>

<template>
  <div ref="scrollContainer" class="chat-message-area">
    <WelcomeBanner v-if="!messages.length" />
    <template v-else>
      <ChatMessage
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :isStreaming="isStreaming && msg.role === 'assistant' && msg === messages[messages.length - 1]"
      />
    </template>
  </div>
</template>
