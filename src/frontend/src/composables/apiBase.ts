export const API_ORIGIN = 'http://127.0.0.1:8000';

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : '/' + path;
  if (window.location.protocol === 'file:') return API_ORIGIN + normalized;
  return '/api' + normalized;
}

export function wsUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : '/' + path;
  if (window.location.protocol === 'file:') return 'ws://127.0.0.1:8000' + normalized;
  if (location.port === '58888' || location.port === '5173') return 'ws://127.0.0.1:8000' + normalized;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${normalized}`;
}
