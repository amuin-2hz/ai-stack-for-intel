<script setup lang="ts">
import { computed, ref } from 'vue';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons-vue';
import { copyText } from '../../composables/useApi';
import { locale } from '../../composables/useLocale';

const props = defineProps<{
  code: string;
  language?: string;
}>();

const copied = ref(false);

const displayLang = computed(() => props.language || 'text');

async function handleCopy() {
  await copyText(props.code);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}
</script>

<template>
  <div class="code-block">
    <div class="code-block-header">
      <span class="code-lang">{{ displayLang }}</span>
      <a-button size="small" type="text" @click="handleCopy">
        <template #icon><CheckOutlined v-if="copied" style="color:#52c41a" /><CopyOutlined v-else /></template>
        {{ copied ? (locale === 'zh-CN' ? '已复制' : 'Copied') : (locale === 'zh-CN' ? '复制代码' : 'Copy') }}
      </a-button>
    </div>
    <pre class="code-block-body"><code :class="language ? `language-${language}` : ''">{{ code }}</code></pre>
  </div>
</template>
