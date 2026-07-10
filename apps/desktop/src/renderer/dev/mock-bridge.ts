// apps/desktop/src/renderer/dev/mock-bridge.ts
// 仅 dev/浏览器预览：真 preload bridge（window.openpet）缺席时装内存版，
// 让 renderer 在纯浏览器（Playwright MCP 截图）里可交互渲染，做设计图比对。
// 打包/Electron 下 window.openpet 存在 → installMockBridge no-op。
//
// 批次⑥ arch#4 重写：旧 M5 单 provider 方法（listProviders/saveKey/testConnection…）
// 已随协议删除——改 mock 最小新法集（工作台/mcp/kb/persona/character/trace/memory 空表 +
// 兜底 {ok:true}）。**dev 浏览器视觉 harness 专用，行为不承诺**：只保证各页打得开不炸。
import {
  ADAPTER_TEMPLATES,
  DEFAULT_PREFS,
  PROVIDER_TEMPLATES,
  type Prefs,
} from '@openpet/protocol';

type Cb = (payload: unknown) => void;

export interface MockBridge {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  on: (channel: string, cb: Cb) => () => void;
}

const MOCK_MANIFEST = {
  id: 'default',
  name: '小灵',
  version: '0.0.0',
  engine: 'vrm',
  model: 'model.vrm',
};

export function createMockBridge(): MockBridge {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  const subs = new Map<string, Set<Cb>>();
  const emit = (channel: string, payload: unknown): void => {
    for (const cb of subs.get(channel) ?? []) cb(payload);
  };
  return {
    rpc: async (method, params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case 'app.prefs.getAll':
          return { ...prefs };
        case 'app.prefs.set':
          (prefs as Record<string, unknown>)[p.key as string] = p.value;
          emit('app.prefs.changed', { key: p.key, value: p.value });
          return { ok: true };
        // --- Provider 工作台（空 sources/models；模板走真常量，建源表单可渲染） ---
        case 'provider.getConfig':
          return {
            sources: prefs['model.providerSources'],
            models: prefs['model.models'],
            templates: ADAPTER_TEMPLATES,
            providerTemplates: PROVIDER_TEMPLATES,
          };
        case 'provider.ollamaDetect':
          return { available: false, models: [] as string[] };
        case 'mcp.getConfig':
          return { servers: [], tools: [], status: {} };
        case 'im.getConfig':
          // 视觉 harness 样例：一张重连中+带错误、一张运行中（覆盖卡片 chip 分支）。
          return {
            platforms: [
              { id: 'qq-demo', type: 'onebot-v11', name: 'QQ 小号', enable: true,
                wsUrl: 'ws://127.0.0.1:3001', accessToken: '', botToken: '', apiBase: '' },
              { id: 'tg-demo', type: 'telegram', name: 'TG Bot', enable: true,
                wsUrl: '', accessToken: '', botToken: 'tok', apiBase: 'https://api.telegram.org' },
            ],
            statuses: [
              { platformId: 'qq-demo', status: 'reconnecting', errorCount: 2, lastError: 'connect failed: ECONNREFUSED 127.0.0.1:3001' },
              { platformId: 'tg-demo', status: 'running', errorCount: 0 },
            ],
          };
        case 'kb.list':
          return { kbs: [] };
        case 'plugins.list':
          return { desktop: [], star: [], python: { found: false } };
        case 'persona.getAll':
          return { personas: [], defaultId: '', bindings: {} };
        case 'memory.list':
          return { facts: [] };
        case 'trace.history':
          return { records: [] };
        case 'character.current':
          return { characterId: 'default', manifest: MOCK_MANIFEST };
        case 'character.list':
          return {
            characters: [
              { characterId: 'default', manifest: MOCK_MANIFEST, builtin: true, active: true },
            ],
          };
        case 'chat.snapshot':
          return { sessionId: p.sessionId ?? 'default', messages: [], streaming: false, seq: 0 };
        case 'app.storageUsage':
          return { dbBytes: 0, messageCount: 0, characterCount: 1 };
        case 'app.usageSummary':
          return { sinceTs: 0, tokensIn: 0, tokensOut: 0, messages: 0 };
        // ⑩.6 音色工坊（视觉 harness：暂存/测连/转写给形状正确的假值）
        case 'voice.saveRefAudio':
          return { file: 'ref.wav' };
        case 'voice.testEngine':
          return { ok: false, error: 'mock' };
        case 'voice.transcribe':
          return { text: '' };
        default:
          console.warn(`[mock-bridge] unhandled method ${method} → {ok:true} 兜底`);
          return { ok: true };
      }
    },
    on: (channel, cb) => {
      let set = subs.get(channel);
      if (!set) subs.set(channel, (set = new Set<Cb>()));
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
  };
}

export function installMockBridge(): void {
  if (typeof window === 'undefined') return;
  if ('openpet' in window) return; // 真 bridge 在 → 不动
  (window as unknown as { openpet: MockBridge }).openpet = createMockBridge();
}
