import type { Locale } from '../types';

import zhCN from './zh-CN';
import enUS from './en-US';

export const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN as unknown as Record<string, string>,
  'en-US': enUS as unknown as Record<string, string>,
};

export const statusCopy: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    ready: '就绪', configured: '已配置', running: '运行中', succeeded: '成功', failed: '失败',
    unsupported: '不支持', incomplete: '未完成', compatible: '兼容', possible: '可能兼容',
    needs_review: '需检查', not_started: '未启动', planned: '已规划', starting: '启动中',
    queued: '排队中', paused: '已暂停', canceling: '取消中', canceled: '已取消', stopped: '已停止', missing: '缺失', unknown: '未知', error: '错误',
    external: '外部工具', disabled: '未启用', already_running: '已在运行'
  },
  'en-US': {
    ready: 'Ready', configured: 'Configured', running: 'Running', succeeded: 'Succeeded', failed: 'Failed',
    unsupported: 'Unsupported', incomplete: 'Incomplete', compatible: 'Compatible', possible: 'Possible',
    needs_review: 'Needs Review', not_started: 'Not Started', planned: 'Planned', starting: 'Starting',
    queued: 'Queued', paused: 'Paused', canceling: 'Canceling', canceled: 'Canceled', stopped: 'Stopped', missing: 'Missing', unknown: 'Unknown', error: 'Error',
    external: 'External', disabled: 'Disabled', already_running: 'Already Running'
  }
};
