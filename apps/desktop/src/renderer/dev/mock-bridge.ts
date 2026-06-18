// apps/desktop/src/renderer/dev/mock-bridge.ts
// 仅 dev/浏览器预览：真 preload bridge（window.desksoul）缺席时装内存版，
// 让 renderer 在纯浏览器（Playwright MCP 截图）里可交互渲染，做设计图比对。
// 打包/Electron 下 window.desksoul 存在 → installMockBridge no-op。
import { DEFAULT_PREFS, type Prefs } from '@desksoul/protocol';

type Cb = (payload: unknown) => void;

export interface MockBridge {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  on: (channel: string, cb: Cb) => () => void;
}

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
        case 'character.current':
          return { characterId: 'default', manifest: { name: '小灵' } };
        case 'chat.snapshot':
          return { sessionId: p.sessionId ?? 'default', messages: [], streaming: false, seq: 0 };
        default:
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
  if ('desksoul' in window) return; // 真 bridge 在 → 不动
  (window as unknown as { desksoul: MockBridge }).desksoul = createMockBridge();
}
