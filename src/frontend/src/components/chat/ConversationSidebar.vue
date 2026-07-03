<script setup lang="ts">
import { computed, ref } from 'vue';
import { DeleteOutlined, EditOutlined, MessageOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons-vue';
import { Modal, Input, message } from 'ant-design-vue';
import { useChat } from '../../composables/useChat';
import { locale } from '../../composables/useLocale';
import type { Conversation } from '../../types';

const { conversations, conversationList, activeConversationId, createConversation, deleteConversation, setActiveConversation, renameConversation } = useChat();

const searchQuery = ref('');
const editingId = ref<string | null>(null);
const editingTitle = ref('');

const filteredList = computed(() => {
  if (!searchQuery.value.trim()) return conversationList.value;
  const q = searchQuery.value.toLowerCase();
  return conversationList.value.filter(c => c.title.toLowerCase().includes(q));
});

// Group by date
const groupedConversations = computed(() => {
  const now = new Date();
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of filteredList.value) {
    const d = new Date(conv.updatedAt);
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) today.push(conv);
    else if (diffDays === 1) yesterday.push(conv);
    else if (diffDays < 7) thisWeek.push(conv);
    else older.push(conv);
  }

  const groups: { label: string; items: Conversation[] }[] = [];
  const t = (key: string) => locale.value === 'zh-CN' ? { today: '今天', yesterday: '昨天', thisWeek: '本周', older: '更早' }[key]! : { today: 'Today', yesterday: 'Yesterday', thisWeek: 'This Week', older: 'Older' }[key]!;
  if (today.length) groups.push({ label: t('today'), items: today });
  if (yesterday.length) groups.push({ label: t('yesterday'), items: yesterday });
  if (thisWeek.length) groups.push({ label: t('thisWeek'), items: thisWeek });
  if (older.length) groups.push({ label: t('older'), items: older });
  return groups;
});

function handleNew() {
  const conv = createConversation();
  setActiveConversation(conv.id);
}

function handleDelete(conv: Conversation, e: Event) {
  e.stopPropagation();
  Modal.confirm({
    title: locale.value === 'zh-CN' ? '删除对话' : 'Delete Conversation',
    content: locale.value === 'zh-CN' ? `确定删除「${conv.title}」？` : `Delete "${conv.title}"?`,
    okText: locale.value === 'zh-CN' ? '删除' : 'Delete',
    cancelText: locale.value === 'zh-CN' ? '取消' : 'Cancel',
    okType: 'danger',
    onOk: () => deleteConversation(conv.id),
  });
}

function startRename(conv: Conversation, e: Event) {
  e.stopPropagation();
  editingId.value = conv.id;
  editingTitle.value = conv.title;
}

function finishRename() {
  if (editingId.value && editingTitle.value.trim()) {
    renameConversation(editingId.value, editingTitle.value.trim());
  }
  editingId.value = null;
  editingTitle.value = '';
}
</script>

<template>
  <div class="conv-sidebar">
    <div class="conv-sidebar-header">
      <a-button type="primary" block @click="handleNew">
        <template #icon><PlusOutlined /></template>
        {{ locale === 'zh-CN' ? '新建对话' : 'New Chat' }}
      </a-button>
    </div>
    <div v-if="conversations.length > 5" class="conv-search">
      <a-input v-model:value="searchQuery" size="small" :placeholder="locale === 'zh-CN' ? '搜索对话…' : 'Search chats…'" allow-clear>
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </div>
    <div class="conv-list">
      <template v-if="filteredList.length">
        <div v-for="group in groupedConversations" :key="group.label" class="conv-group">
          <div class="conv-group-label">{{ group.label }}</div>
          <div
            v-for="conv in group.items"
            :key="conv.id"
            :class="['conv-item', { active: conv.id === activeConversationId }]"
            @click="setActiveConversation(conv.id)"
          >
            <MessageOutlined class="conv-icon" />
            <div class="conv-body">
              <div v-if="editingId === conv.id" class="conv-title-edit">
                <a-input
                  v-model:value="editingTitle"
                  size="small"
                  @blur="finishRename"
                  @pressEnter="finishRename"
                  :autoFocus="true"
                  @click.stop
                />
              </div>
              <div v-else class="conv-title">{{ conv.title }}</div>
              <div class="conv-meta">
                {{ conv.messages.length }} {{ locale === 'zh-CN' ? '条消息' : 'msgs' }}
              </div>
            </div>
            <div class="conv-actions">
              <a-button size="small" type="text" @click="(e: Event) => startRename(conv, e)" :title="locale === 'zh-CN' ? '重命名' : 'Rename'">
                <template #icon><EditOutlined /></template>
              </a-button>
              <a-button size="small" type="text" danger @click="(e: Event) => handleDelete(conv, e)" :title="locale === 'zh-CN' ? '删除' : 'Delete'">
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </div>
          </div>
        </div>
      </template>
      <a-empty v-else :description="locale === 'zh-CN' ? '暂无对话' : 'No conversations'" style="padding:24px 0" :image-style="{ height: '48px' }" />
    </div>
  </div>
</template>
