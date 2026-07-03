<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  MenuFoldOutlined, MenuUnfoldOutlined, SendOutlined,
  AudioOutlined, AudioMutedOutlined, PictureOutlined,
  PlayCircleOutlined, PauseCircleOutlined, ClearOutlined,
  LoadingOutlined, CheckCircleOutlined, SoundOutlined,
} from '@ant-design/icons-vue';
import ConversationSidebar from '../components/chat/ConversationSidebar.vue';
import ChatMessageArea from '../components/chat/ChatMessageArea.vue';
import ChatInput from '../components/chat/ChatInput.vue';
import AudioWaveSphere from '../components/chat/AudioWaveSphere.vue';
import { useChat } from '../composables/useChat';
import { locale } from '../composables/useLocale';
import { runningDeployments } from '../composables/useApp';
import { unlockSharedAudio } from '../composables/useSharedAudioContext';
import { apiUrl, wsUrl } from '../composables/apiBase';
import { computed } from 'vue';

const tabs = ['chat', 'vision', 'asr', 'tts'] as const;
type Tab = typeof tabs[number];
const tab = ref<Tab>('chat');
const sidebarOpen = ref(true);
const { activeConversation } = useChat();

function modelNameFor(type: string): string {
  const dep = runningDeployments.value.find(d => d.service_type === type);
  return dep?.openai_models[0] || dep?.model_id || type;
}

/** Concatenate multiple WAV buffers (each with 44-byte header) into a single WAV. */
function concatWavChunks(chunks: Uint8Array[]): ArrayBuffer {
  if (chunks.length === 1) return chunks[0].buffer.slice(0);

  // Read WAV header from first chunk
  const view = new DataView(chunks[0].buffer);
  const sampleRate = view.getUint32(24, true);   // offset 24
  const bitsPerSample = view.getUint16(34, true); // offset 34
  const channels = view.getUint16(22, true);      // offset 22
  const bytesPerSample = bitsPerSample / 8;

  // Extract raw PCM data (skip 44-byte header) from all chunks
  let totalDataLen = 0;
  const pcmParts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const data = chunk.slice(44);  // skip WAV header
    pcmParts.push(data);
    totalDataLen += data.byteLength;
  }

  // Build new WAV header
  const header = new ArrayBuffer(44);
  const h = new DataView(header);
  new Uint8Array(header).set(new TextEncoder().encode('RIFF'));
  h.setUint32(4, 36 + totalDataLen, true);
  new Uint8Array(header, 8, 4).set(new TextEncoder().encode('WAVE'));
  new Uint8Array(header, 12, 4).set(new TextEncoder().encode('fmt '));
  h.setUint32(16, 16, true);           // PCM chunk size
  h.setUint16(20, 1, true);            // PCM format
  h.setUint16(22, channels, true);
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  h.setUint16(32, channels * bytesPerSample, true); // block align
  h.setUint16(34, bitsPerSample, true);
  new Uint8Array(header, 36, 4).set(new TextEncoder().encode('data'));
  h.setUint32(40, totalDataLen, true);

  // Combine header + all PCM data
  const result = new Uint8Array(44 + totalDataLen);
  result.set(new Uint8Array(header), 0);
  let offset = 44;
  for (const pcm of pcmParts) {
    result.set(pcm, offset);
    offset += pcm.byteLength;
  }
  return result.buffer;
}

const tabLabels: Record<Tab, { icon: string; zh: string; en: string }> = {
  chat:   { icon: '💬', zh: '对话',   en: 'Chat' },
  vision: { icon: '👁️', zh: '视觉',   en: 'Vision' },
  asr:    { icon: '🎤', zh: '语音识别', en: 'ASR' },
  tts:    { icon: '🔊', zh: '语音合成', en: 'TTS' },
};

/* ── Vision ────────────────────────────────────── */
const vis = reactive({ image: null as { dataUrl: string } | null, prompt: '', result: '', loading: false });
const visInput = ref<HTMLInputElement | null>(null);
function visUpload(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  const r = new window.FileReader(); r.onload = () => { vis.image = { dataUrl: r.result as string } }; r.readAsDataURL(f);
}
function visDrop(e: DragEvent) { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (!f) return;
  const r = new window.FileReader(); r.onload = () => { vis.image = { dataUrl: r.result as string } }; r.readAsDataURL(f);
}
function visClear() { vis.image = null; vis.result = ''; vis.prompt = ''; }
async function visSend() {
  if (!vis.image || !vis.prompt.trim()) return; vis.loading = true; vis.result = '';
  try {
    const res = await fetch(apiUrl('/v1/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelNameFor('vision'), messages: [{ role: 'user', content: [{ type: 'text', text: vis.prompt.trim() }, { type: 'image_url', image_url: { url: vis.image.dataUrl } }] }], stream: false }) });
    vis.result = (await res.json())?.choices?.[0]?.message?.content ?? 'No response';
  } catch (e) { vis.result = String(e); } finally { vis.loading = false; }
}

/* ── ASR (press & hold → release → transcribe) ──── */
const asr = reactive({ recording: false, text: '', loading: false });
const MIN_RECORD_MS = 600; // ignore taps shorter than this
let mr: MediaRecorder | null = null;
let recordStart = 0;

async function asrStart() {
  if (asr.recording || asr.loading) return;
  asr.text = '';  // clear previous result
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const elapsed = Date.now() - recordStart;
      if (elapsed < MIN_RECORD_MS) return;  // too short, ignore
      const blob = new Blob(chunks, { type: 'audio/webm' });
      if (blob.size > 0) asrSend(blob);
    };
    mr.start();
    recordStart = Date.now();
    asr.recording = true;
  } catch { message.error(locale.value === 'zh-CN' ? '无法访问麦克风' : 'Cannot access microphone'); }
}

function asrStop() {
  if (!asr.recording) return;
  mr?.stop();
  asr.recording = false;
}

async function asrSend(blob: Blob) {
  asr.loading = true; asr.text = '';
  const audioBytes = new Uint8Array(await blob.arrayBuffer());
  // Log first + middle + last bytes to verify audio content differs between recordings
  const mid = Math.floor(audioBytes.length / 2);
  console.log('[ASR] Sending audio:', audioBytes.byteLength, 'bytes, type:', blob.type,
    'first:', Array.from(audioBytes.slice(0, 8)).map(b => b.toString(16).padStart(2,'0')).join(' '),
    'mid:', Array.from(audioBytes.slice(mid, mid + 8)).map(b => b.toString(16).padStart(2,'0')).join(' '),
    'hash:', Array.from(audioBytes.slice(mid, mid + 32)).reduce((h, b) => h ^ b, 0).toString(16).padStart(2,'0'));
  const audioWsUrl = wsUrl('/ws/audio/transcriptions');
  try {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(audioWsUrl);
      ws.onopen = async () => {
        ws.send(audioBytes);
        ws.send(JSON.stringify({ type: 'end', language: 'zh' }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[ASR] Response:', data.type, data.text?.substring(0, 50));
          if (data.type === 'result') { asr.text = data.text; ws.close(); resolve(); }
          else if (data.type === 'error') { asr.text = data.message; ws.close(); resolve(); }
        } catch { /* ignore non-JSON */ }
      };
      ws.onerror = () => { reject(new Error('WebSocket error')); };
      ws.onclose = () => resolve();
    });
  } catch (e) { asr.text = String(e); } finally { asr.loading = false; }
}

/* ── TTS (press Enter / click button → synth) ───── */
const tts = reactive({ text: '', audioUrl: '', loading: false, playing: false, progress: '' });
function unlockAudio() {
  unlockSharedAudio();
}
function onTtsInput() { /* typing new text — just reset UI if needed */ }
async function ttsSynth() {
  if (!tts.text.trim() || tts.loading) return;
  unlockAudio();
  tts.loading = true; tts.playing = false; tts.progress = '';
  if (tts.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(tts.audioUrl);
  tts.audioUrl = '';

  const audioWsUrl = wsUrl('/ws/audio/speech');
  const wavChunks: Uint8Array[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(audioWsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ input: tts.text.trim(), voice: 'Vivian', model: modelNameFor('tts') }));
      };
      ws.onmessage = async (event) => {
        // Binary message — direct WAV frame (kept for future use)
        if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
          const buf = event.data instanceof Blob
            ? new Uint8Array(await event.data.arrayBuffer())
            : new Uint8Array(event.data);
          wavChunks.push(buf);
          tts.progress = `${wavChunks.length} 句已生成...`;
          return;
        }
        // Text message — parse JSON (base64 chunks or done/error)
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'chunk') {
              // Base64-encoded WAV chunk (workaround for binary frame proxy issues)
              const binaryStr = atob(data.data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let j = 0; j < binaryStr.length; j++) {
                bytes[j] = binaryStr.charCodeAt(j);
              }
              wavChunks.push(bytes);
              tts.progress = `${data.index! + 1}/${data.total} 句已生成...`;
            } else if (data.type === 'done') {
              tts.progress = `共 ${data.segments || wavChunks.length} 句, ${(data.duration || 0).toFixed(1)}s 音频`;
              if (wavChunks.length > 0) {
                tts.playing = true;
                tts.audioUrl = URL.createObjectURL(new Blob([concatWavChunks(wavChunks)], { type: 'audio/wav' }));
              } else {
                message.error('TTS 完成但未收到音频数据');
              }
              ws.close();
              resolve();
            } else if (data.type === 'error') {
              message.error(data.message);
              ws.close();
              resolve();
            }
          } catch { /* ignore parse errors */ }
        }
      };
      ws.onerror = () => { reject(new Error('WebSocket connection failed')); };
      ws.onclose = () => resolve();
    });
  } catch (e) { message.error(String(e)); } finally {
    tts.loading = false;
  }
}
function onTtsEnded() { tts.playing = false; }
</script>

<template>
  <div :class="['chat-layout', { 'chat-layout--full': tab !== 'chat' }]">
    <!-- conversation sidebar -->
    <div v-if="tab === 'chat'" :class="['chat-sidebar-col', { collapsed: !sidebarOpen }]">
      <ConversationSidebar />
    </div>

    <div :class="['chat-main-col', { expanded: tab !== 'chat' || !sidebarOpen }]">
      <!-- Custom tab bar -->
      <div class="mode-bar">
        <a-button v-if="tab === 'chat'" size="small" type="text" @click="sidebarOpen = !sidebarOpen" class="mode-sidebar-btn">
          <template #icon><MenuFoldOutlined v-if="sidebarOpen" /><MenuUnfoldOutlined v-else /></template>
        </a-button>
        <nav class="mode-nav">
          <button v-for="t in tabs" :key="t" :class="['mode-tab', { active: tab === t }]" @click="tab = t">
            <span class="mode-tab-icon">{{ tabLabels[t].icon }}</span>
            <span class="mode-tab-text">{{ locale === 'zh-CN' ? tabLabels[t].zh : tabLabels[t].en }}</span>
          </button>
        </nav>
        <span v-if="tab === 'chat' && activeConversation" class="mode-conv-title">{{ activeConversation.title }}</span>
      </div>

      <!-- ═══ CHAT ═══ -->
      <div v-if="tab === 'chat'" class="mode-body mode-body--chat">
        <ChatMessageArea />
        <ChatInput />
      </div>

      <!-- ══════════════════════════════════════════════
           VISION — left: upload + prompt | right: result
           ══════════════════════════════════════════════ -->
      <div v-if="tab === 'vision'" class="mode-body mode-body--fill">
        <div class="vis-layout">
          <!-- LEFT: upload + input -->
          <div class="vis-left">
            <!-- Upload zone -->
            <div class="vis-upload" @dragover.prevent @drop="visDrop">
              <div v-if="!vis.image" class="vis-drop" @click="visInput?.click()">
                <PictureOutlined class="vis-drop-icon" />
                <span class="vis-drop-title">{{ locale === 'zh-CN' ? '点击或拖拽上传图片' : 'Click or drag to upload' }}</span>
                <span class="vis-drop-hint">PNG · JPEG · WebP</span>
                <input ref="visInput" type="file" accept="image/*" hidden @change="visUpload" />
              </div>
              <div v-else class="vis-preview">
                <img :src="vis.image.dataUrl" class="vis-preview-img" />
                <a-button size="small" @click="visClear"><template #icon><ClearOutlined /></template>{{ locale === 'zh-CN' ? '清除' : 'Clear' }}</a-button>
              </div>
            </div>

            <!-- Prompt + send -->
            <div class="vis-input-row">
              <a-textarea
                v-model:value="vis.prompt"
                :rows="3"
                :placeholder="locale === 'zh-CN' ? '描述你想了解的…' : 'What would you like to know?'"
                class="vis-textarea"
              />
              <a-button
                type="primary"
                :loading="vis.loading"
                :disabled="!vis.image || !vis.prompt.trim()"
                @click="visSend"
                class="vis-send-btn"
              >
                <template #icon><SendOutlined /></template>
                {{ locale === 'zh-CN' ? '询问' : 'Ask' }}
              </a-button>
            </div>
          </div>

          <!-- RIGHT: result -->
          <div class="vis-right">
            <div v-if="vis.loading" class="vis-result-loading">
              <LoadingOutlined class="vis-spin" />
              <span>{{ locale === 'zh-CN' ? '分析中…' : 'Analyzing…' }}</span>
            </div>
            <div v-else-if="vis.result" class="vis-result-card">
              <div class="vis-result-label">{{ locale === 'zh-CN' ? '回答' : 'Response' }}</div>
              <p class="vis-result-text">{{ vis.result }}</p>
            </div>
            <div v-else class="vis-result-empty">
              <SoundOutlined class="vis-empty-icon" />
              <span>{{ locale === 'zh-CN' ? '上传图片并提问，回答将显示在此处' : 'Upload an image and ask — results appear here' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════
           ASR — left: record controls | right: transcription
           ══════════════════════════════════════════════ -->
      <div v-if="tab === 'asr'" class="mode-body mode-body--fill">
        <div class="asr-layout">
          <!-- LEFT: mic button (press & hold) -->
          <div class="asr-left">
            <button
              :class="['mic-btn', { live: asr.recording }]"
              @pointerdown.prevent="asrStart"
              @pointerup.prevent="asrStop"
              @pointerleave.prevent="asrStop"
            >
              <AudioOutlined v-if="!asr.recording" class="mic-icon" />
              <AudioMutedOutlined v-else class="mic-icon" />
            </button>
            <p class="mic-hint">
              {{ asr.recording ? (locale === 'zh-CN' ? '录音中，松手发送…' : 'Recording — release to send…')
                : asr.loading ? (locale === 'zh-CN' ? '转写中…' : 'Transcribing…')
                : (locale === 'zh-CN' ? '按住录音，松手转写' : 'Hold to record, release to transcribe') }}
            </p>
          </div>

          <!-- RIGHT: transcription result -->
          <div class="asr-right">
            <div v-if="asr.loading" class="asr-result-loading">
              <LoadingOutlined class="asr-spin" />
              <span>{{ locale === 'zh-CN' ? '识别中…' : 'Recognizing…' }}</span>
            </div>
            <div v-else-if="asr.text" class="asr-result-card">
              <div class="asr-result-label">{{ locale === 'zh-CN' ? '转写结果' : 'Transcription' }}</div>
              <p class="asr-result-text">{{ asr.text }}</p>
            </div>
            <div v-else class="asr-result-empty">
              <SoundOutlined class="asr-empty-icon" />
              <span>{{ locale === 'zh-CN' ? '按住麦克风按钮开始录音，松手自动转写' : 'Hold mic to record, release to transcribe' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════
           TTS — top: wave sphere | bottom: input bar
           ══════════════════════════════════════════════ -->
      <div v-if="tab === 'tts'" class="mode-body mode-body--fill">
        <div class="tts-layout">
          <!-- TOP: Three.js wave sphere -->
          <AudioWaveSphere
            :audio-url="tts.audioUrl"
            :playing="tts.playing"
            @ended="onTtsEnded"
          />

          <!-- BOTTOM: input bar -->
          <div class="tts-input-bar">
            <div class="tts-input-row">
              <a-textarea
                v-model:value="tts.text"
                :rows="2"
                :placeholder="locale === 'zh-CN' ? '输入文字，回车合成语音…' : 'Type text, Enter to speak…'"
                class="tts-textarea"
                :auto-size="{ minRows: 1, maxRows: 4 }"
                @pressEnter="ttsSynth"
              />
              <div class="tts-actions">
                <a-button
                  type="primary"
                  size="large"
                  :loading="tts.loading"
                  :disabled="!tts.text.trim()"
                  @click="ttsSynth"
                >
                  <template #icon><SoundOutlined /></template>
                  {{ tts.loading ? (locale === 'zh-CN' ? '合成中…' : 'Generating…') : (locale === 'zh-CN' ? '合成播放' : 'Speak') }}
                </a-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
