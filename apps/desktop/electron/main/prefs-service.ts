/**
 * PrefsService —— app.prefs.* handler 工厂（getAll/set）。纯函数集合，注入
 * PrefsStore + broadcast + effects；由 ipc-router spread 进 createRouter（仿 provider-service）。
 *
 * set 契约（"即时生效"）：按 key 对应字段深校验 → 落盘 → 广播 app.prefs.changed
 *（renderer 据此换肤等）→ 施加 Main 侧副作用（M7a 为空）。
 */
import { PrefsSchema, type PrefKey } from '@openpet/protocol';
import type { ZodTypeAny } from 'zod';
import type { PrefsStore } from './prefs/store.js';
import type { PrefEffects } from './prefs/effects.js';
import { RpcError } from './router.js';

export interface PrefsServiceDeps {
  store: PrefsStore;
  broadcast: (channel: string, params: unknown) => void;
  effects: PrefEffects;
}

export function createPrefsService(deps: PrefsServiceDeps) {
  const shape = PrefsSchema.shape as Record<string, ZodTypeAny>;
  return {
    'app.prefs.getAll': async (_p: Record<string, never>) => deps.store.getAll(),
    'app.prefs.set': async (p: { key: string; value: unknown }) => {
      const field = shape[p.key];
      if (!field) throw new RpcError(-32602, `unknown pref key: ${p.key}`);
      const parsed = field.safeParse(p.value);
      if (!parsed.success) {
        throw new RpcError(-32602, `invalid value for ${p.key}: ${parsed.error.message}`);
      }
      const key = p.key as PrefKey;
      deps.store.set(key, parsed.data as never);
      deps.broadcast('app.prefs.changed', { key: p.key, value: parsed.data });
      (deps.effects[key] as ((v: unknown) => void) | undefined)?.(parsed.data);
      return { ok: true as const };
    },
  };
}
