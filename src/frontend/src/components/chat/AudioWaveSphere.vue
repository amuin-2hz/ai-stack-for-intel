<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as THREE from 'three';
import { getSharedAudioContext } from '../../composables/useSharedAudioContext';

const props = defineProps<{
  audioUrl: string;
  playing: boolean;
}>();

const emit = defineEmits<{
  (e: 'ended'): void;
}>();

const container = ref<HTMLDivElement | null>(null);
const idle = ref(true);

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let mainGroup: THREE.Group | null = null;
let nebulaPoints: THREE.Points | null = null;
let nebulaBasePos: Float32Array | null = null;
let starField: THREE.Points | null = null;
let coreMesh: THREE.Mesh | null = null;

let analyser: AnalyserNode | null = null;
let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let sourceNode: AudioBufferSourceNode | null = null;
let animId = 0;
let freqData: Uint8Array | null = null;
let smoothedBands: number[] = [];

const PARTICLE_COUNT = 2200;
const NEBULA_RADIUS = 2.0;
const STAR_COUNT = 600;

let darkMode = true;

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

// ── Color palette by theme ────────────────────────
// Dark: cyan   hue 0.53–0.58  sat 0.45–0.95  lit 0.30–0.85
// Light: blue→violet  hue 0.58–0.72  sat 0.55–0.95  lit 0.25–0.70
function nebulaColor(distNorm: number): THREE.Color {
  if (darkMode) {
    // Cyan glow
    const hue = 0.53 + distNorm * 0.05;
    const sat = 0.45 + (1 - distNorm) * 0.5;
    const lit = 0.3 + (1 - distNorm) * 0.55;
    return new THREE.Color().setHSL(hue, sat, lit);
  } else {
    // Black → dark gray smoke
    const sat = 0.02 + distNorm * 0.08;
    const lit = 0.05 + (1 - distNorm) * 0.3;
    return new THREE.Color().setHSL(0.6, sat, lit);
  }
}

function starColor(): THREE.Color {
  if (darkMode) {
    return new THREE.Color().setHSL(0.54 + Math.random() * 0.08, 0.35, 0.45 + Math.random() * 0.45);
  } else {
    // Gray → dark gray, low saturation
    return new THREE.Color().setHSL(0.6, 0.03 + Math.random() * 0.08, 0.1 + Math.random() * 0.35);
  }
}

// Live hue for animation
function animHue(_energy: number, _bass: number): number {
  return darkMode ? 0.53 : 0.6;
}
function animSat(energy: number): number {
  return darkMode ? 0.45 + energy * 0.5 : 0.03 + energy * 0.12;
}
function animLit(energy: number, bass: number): number {
  const brightness = darkMode
    ? 0.3 + energy * 0.6 + bass * 0.25
    : 0.05 + energy * 0.35 + bass * 0.2;
  return Math.min(0.95, brightness);
}

// ── Regenerate all static color buffers ───────────
function recolorNebula() {
  if (!nebulaPoints) return;
  const colorArr = nebulaPoints.geometry.attributes.color.array as Float32Array;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const bx = nebulaBasePos![i * 3];
    const by = nebulaBasePos![i * 3 + 1];
    const bz = nebulaBasePos![i * 3 + 2];
    const dist = Math.sqrt(bx * bx + by * by + bz * bz);
    const distNorm = dist / NEBULA_RADIUS;
    const col = nebulaColor(distNorm);
    colorArr[i * 3] = col.r;
    colorArr[i * 3 + 1] = col.g;
    colorArr[i * 3 + 2] = col.b;
  }
  nebulaPoints.geometry.attributes.color.needsUpdate = true;
}

function recolorStars() {
  if (!starField) return;
  const starCols = starField.geometry.attributes.color.array as Float32Array;
  for (let i = 0; i < STAR_COUNT; i++) {
    const sc = starColor();
    starCols[i * 3] = sc.r;
    starCols[i * 3 + 1] = sc.g;
    starCols[i * 3 + 2] = sc.b;
  }
  starField.geometry.attributes.color.needsUpdate = true;
}

// ── Build scene ───────────────────────────────────
function initScene() {
  if (!container.value) return;
  darkMode = isDark();
  const w = container.value.clientWidth;
  const h = container.value.clientHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, w / Math.max(h, 1), 0.2, 40);
  camera.position.set(0, 0.05, 5.0);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.value.appendChild(renderer.domElement);

  mainGroup = new THREE.Group();
  scene.add(mainGroup);

  // ═══════════════════════════════════════════════
  //  NEBULA
  // ═══════════════════════════════════════════════
  const nebulaGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  nebulaBasePos = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const t = Math.random();
    const r = NEBULA_RADIUS * Math.pow(t, 0.55);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const irregularity = 1 + (Math.random() - 0.5) * 0.3;
    const rr = r * irregularity;
    const flatten = 1 - Math.abs(Math.cos(phi)) * 0.3;

    const x = rr * Math.sin(phi) * Math.cos(theta) * flatten;
    const y = rr * Math.sin(phi) * Math.sin(theta);
    const z = rr * Math.cos(phi) * flatten;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    nebulaBasePos[i * 3] = x;
    nebulaBasePos[i * 3 + 1] = y;
    nebulaBasePos[i * 3 + 2] = z;

    const distNorm = r / NEBULA_RADIUS;
    const col = nebulaColor(distNorm);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    sizes[i] = (0.025 + (1 - distNorm) * 0.08) * (0.5 + Math.random() * 0.5);
  }

  nebulaGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nebulaGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nebulaGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const nebulaMat = new THREE.PointsMaterial({
    size: 0.045,
    vertexColors: true,
    blending: darkMode ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    transparent: true,
    opacity: darkMode ? 0.85 : 0.55,
    sizeAttenuation: true,
  });

  nebulaPoints = new THREE.Points(nebulaGeo, nebulaMat);
  mainGroup.add(nebulaPoints);

  // ═══════════════════════════════════════════════
  //  STAR FIELD
  // ═══════════════════════════════════════════════
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCols = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const theta2 = Math.random() * Math.PI * 2;
    const phi2 = Math.acos(2 * Math.random() - 1);
    const r2 = NEBULA_RADIUS * 1.15 + Math.random() * NEBULA_RADIUS * 0.9;
    starPos[i * 3] = r2 * Math.sin(phi2) * Math.cos(theta2);
    starPos[i * 3 + 1] = r2 * Math.sin(phi2) * Math.sin(theta2);
    starPos[i * 3 + 2] = r2 * Math.cos(phi2);
    const sc = starColor();
    starCols[i * 3] = sc.r;
    starCols[i * 3 + 1] = sc.g;
    starCols[i * 3 + 2] = sc.b;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCols, 3));

  const starMat = new THREE.PointsMaterial({
    size: 0.022,
    vertexColors: true,
    blending: darkMode ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    transparent: true,
    opacity: darkMode ? 0.5 : 0.25,
    sizeAttenuation: true,
  });
  starField = new THREE.Points(starGeo, starMat);
  mainGroup.add(starField);

  // Core
  const coreGeo = new THREE.SphereGeometry(0.03, 16, 16);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: darkMode ? 0.6 : 0.35,
    depthWrite: false,
  });
  coreMesh = new THREE.Mesh(coreGeo, coreMat);
  mainGroup.add(coreMesh);

  smoothedBands = new Array(256).fill(0);
  animate();
}

// ── Animation ─────────────────────────────────────
function animate() {
  if (!renderer || !scene || !camera || !mainGroup) return;
  animId = requestAnimationFrame(animate);

  const time = Date.now() * 0.001;
  mainGroup.rotation.y += 0.0012;
  mainGroup.rotation.x = Math.sin(time * 0.22) * 0.07;
  mainGroup.rotation.z = Math.cos(time * 0.16) * 0.04;

  if (analyser && freqData && nebulaPoints && nebulaBasePos) {
    analyser.getByteFrequencyData(freqData);

    for (let i = 0; i < freqData.length; i++) {
      smoothedBands[i] += (freqData[i] / 255 - smoothedBands[i]) * 0.18;
    }

    const bass = freqData.slice(0, 8).reduce((a, v) => a + v, 0) / (8 * 255);

    const posArr = nebulaPoints.geometry.attributes.position.array as Float32Array;
    const colorArr = nebulaPoints.geometry.attributes.color.array as Float32Array;
    const sizeArr = nebulaPoints.geometry.attributes.size.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const bx = nebulaBasePos[i * 3];
      const by = nebulaBasePos[i * 3 + 1];
      const bz = nebulaBasePos[i * 3 + 2];
      const dist = Math.sqrt(bx * bx + by * by + bz * bz) || 0.001;
      const nx = bx / dist, ny = by / dist, nz = bz / dist;

      const bandIdx = Math.floor(((Math.atan2(by, bx) + Math.PI) / (Math.PI * 2)) * 255);
      const energy = smoothedBands[Math.min(bandIdx, 254)];

      const wave = Math.sin(time * 2.8 + bx * 3.9 + bz * 2.3) * 0.5 + 0.5;
      const displace = energy * 0.6 * (0.55 + 0.45 * wave)
        + bass * 0.14 * wave
        + Math.sin(time * 1.1 + i * 0.07) * 0.012;

      posArr[i * 3] = bx + nx * displace;
      posArr[i * 3 + 1] = by + ny * displace;
      posArr[i * 3 + 2] = bz + nz * displace;

      const col = new THREE.Color().setHSL(animHue(energy, bass), animSat(energy), animLit(energy, bass));
      colorArr[i * 3] = col.r;
      colorArr[i * 3 + 1] = col.g;
      colorArr[i * 3 + 2] = col.b;

      sizeArr[i] = (0.025 + (1 - dist / NEBULA_RADIUS) * 0.08) * (0.45 + energy * 0.85 + bass * 0.35);
    }

    nebulaPoints.geometry.attributes.position.needsUpdate = true;
    nebulaPoints.geometry.attributes.color.needsUpdate = true;
    nebulaPoints.geometry.attributes.size.needsUpdate = true;

    (nebulaPoints.material as THREE.PointsMaterial).opacity = (darkMode ? 0.75 : 0.5) + bass * 0.3;
    if (starField) {
      (starField.material as THREE.PointsMaterial).opacity = (darkMode ? 0.45 : 0.22) + bass * 0.25;
    }
    if (coreMesh) {
      (coreMesh.material as THREE.MeshBasicMaterial).opacity = (darkMode ? 0.55 : 0.18) + bass * 0.25;
      coreMesh.scale.setScalar(1 + bass * 3);
    }

    idle.value = bass < 0.008;
  } else {
    idle.value = true;
  }

  renderer.render(scene, camera);
}

// ── Theme observer ────────────────────────────────
let themeObserver: MutationObserver | null = null;

function onThemeChange() {
  const wasDark = darkMode;
  darkMode = isDark();
  if (wasDark === darkMode) return;
  if (!nebulaPoints || !starField || !coreMesh) return;

  recolorNebula();
  recolorStars();

  // Swap blending mode + opacity
  (nebulaPoints.material as THREE.PointsMaterial).blending = darkMode ? THREE.AdditiveBlending : THREE.NormalBlending;
  (nebulaPoints.material as THREE.PointsMaterial).opacity = darkMode ? 0.85 : 0.55;
  (nebulaPoints.material as THREE.PointsMaterial).needsUpdate = true;

  (starField.material as THREE.PointsMaterial).blending = darkMode ? THREE.AdditiveBlending : THREE.NormalBlending;
  (starField.material as THREE.PointsMaterial).opacity = darkMode ? 0.5 : 0.25;
  (starField.material as THREE.PointsMaterial).needsUpdate = true;

  (coreMesh.material as THREE.MeshBasicMaterial).opacity = darkMode ? 0.6 : 0.2;
}

// ── Audio setup ───────────────────────────────────
// Uses decodeAudioData + AudioBufferSourceNode instead of HTMLAudioElement
// to completely bypass browser autoplay restrictions. The AudioContext was
// created/resumed during the user gesture (via unlockSharedAudio), so
// source.start() works reliably.

async function setupAudio(url: string, autoPlay = false) {
  // Stop and clean up previous playback
  stopSource();
  audioBuffer = null;
  analyser = null; freqData = null;
  if (!url) return;

  // Use the shared AudioContext (unlocked during user gesture)
  audioCtx = getSharedAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }

  // Fetch the blob URL and decode the WAV data
  try {
    console.log('[AudioWaveSphere] setupAudio called, url size:', url?.length, 'autoPlay:', autoPlay, 'ctx state:', audioCtx.state);
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    console.log('[AudioWaveSphere] fetched', arrayBuffer.byteLength, 'bytes');
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    console.log('[AudioWaveSphere] decoded: duration=', audioBuffer.duration.toFixed(1), 's, sr=', audioBuffer.sampleRate, 'ch=', audioBuffer.numberOfChannels);

    // Create analyser node for Three.js visualization
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.connect(audioCtx.destination);

    idle.value = true;

    if (autoPlay) {
      console.log('[AudioWaveSphere] autoPlay=true, calling playSource');
      playSource();
    } else {
      console.log('[AudioWaveSphere] autoPlay=false, waiting for playing prop');
    }
  } catch (e) {
    console.warn('AudioWaveSphere: setup failed:', e);
  }
}

function playSource() {
  console.log('[AudioWaveSphere] playSource called, buffer:', !!audioBuffer, 'ctx:', !!audioCtx, 'analyser:', !!analyser, 'ctx state:', audioCtx?.state);
  if (!audioBuffer || !audioCtx || !analyser) {
    console.warn('[AudioWaveSphere] playSource aborted - missing:', {buffer: !audioBuffer, ctx: !audioCtx, analyser: !analyser});
    return;
  }
  stopSource(); // stop any previous source
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(analyser);
  sourceNode.onended = () => {
    console.log('[AudioWaveSphere] playback ended');
    sourceNode = null;
    emit('ended');
  };
  sourceNode.start(0);
  console.log('[AudioWaveSphere] source.start() called');
  idle.value = false;
}

function stopSource() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch { /* already stopped */ }
    sourceNode = null;
  }
}

function handleResize() {
  if (!container.value || !renderer || !camera) return;
  const w = container.value.clientWidth;
  const h = container.value.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}

watch(() => props.audioUrl, (url) => { if (url) setupAudio(url, props.playing); });
watch(() => props.playing, (p) => {
  if (!audioBuffer) return;
  if (p) {
    playSource();
  } else {
    stopSource();
  }
});

onMounted(() => {
  nextTick(() => { initScene(); if (props.audioUrl) setupAudio(props.audioUrl); });
  themeObserver = new MutationObserver(onThemeChange);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(animId);
  themeObserver?.disconnect();
  window.removeEventListener('resize', handleResize);
  // Don't close shared AudioContext — it persists for future TTS playback
  stopSource();
  audioBuffer = null;
  nebulaPoints?.geometry.dispose();
  starField?.geometry.dispose();
  coreMesh?.geometry.dispose();
  renderer?.dispose();
  if (container.value) { const cv = container.value.querySelector('canvas'); if (cv) cv.remove(); }
});
</script>

<template>
  <div ref="container" class="wave-sphere-container" />
</template>

<style scoped>
.wave-sphere-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  border-radius: 16px;
}
</style>
