import { ref, computed } from 'vue';
import type { Locale, ThemeMode } from '../types';
import { messages, statusCopy } from '../locales';

/* ── reactive state ──────────────────────────── */
export const locale = ref<Locale>((localStorage.getItem('locale') as Locale) || 'zh-CN');
export const themeMode = ref<ThemeMode>((localStorage.getItem('themeMode') as ThemeMode) || 'light');

/* ── i18n helpers ─────────────────────────────── */
export function t(key: string): string {
  return (messages[locale.value] as Record<string, string>)[key] ?? key;
}

export function statusText(status: string): string {
  return statusCopy[locale.value][status] ?? status;
}

/* ── formatters ───────────────────────────────── */
export function formatDuration(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? days + 'd ' + hours + 'h' : hours + 'h ' + minutes + 'm';
}

export function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return (value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
}

export function badgeColor(status: string) {
  if (['compatible', 'ready', 'configured', 'running', 'succeeded'].includes(status)) return 'green';
  if (['unsupported', 'incomplete', 'failed', 'missing', 'stopped', 'canceled', 'error'].includes(status)) return 'red';
  if (['paused', 'canceling'].includes(status)) return 'blue';
  return 'gold';
}

export function percent(used: number, total: number) {
  return total ? Math.round((used / total) * 100) : 0;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function shortModelPath(path: string) {
  const marker = '/models/';
  const index = path.lastIndexOf(marker);
  return index >= 0 ? '…' + path.slice(index) : path;
}

/* ── theme / locale setters ────────────────────── */
export function setLocale(next: Locale) {
  locale.value = next;
  localStorage.setItem('locale', next);
  document.documentElement.lang = next;
}

export function setTheme(next: ThemeMode) {
  themeMode.value = next;
  localStorage.setItem('themeMode', next);
  document.documentElement.dataset.theme = next;
}
