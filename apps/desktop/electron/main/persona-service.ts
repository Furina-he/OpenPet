/**
 * PersonaService —— persona.* RPC（§6 人设管理，照 AstrBot persona_mgr 裁剪版）。
 * CRUD 落 prefs（persona.list/defaultId/bindings）；resolveFor 是 ContextPipeline 的
 * 注入 API（非 RPC handler，ipc-router spread 时剔除）。生效优先级：角色绑定 > 默认 > null=内置人设。
 */
import { PersonaSchema, type Persona, type PrefKey, type Prefs } from '@openpet/protocol';

export interface PersonaServiceDeps {
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
}

export function createPersonaService(deps: PersonaServiceDeps) {
  const { getPrefs, setPref } = deps;
  const list = (): Persona[] => getPrefs()['persona.list'];

  return {
    'persona.getAll': async (_p: Record<string, never>) => ({
      personas: list(),
      defaultId: getPrefs()['persona.defaultId'],
      bindings: getPrefs()['persona.bindings'],
    }),

    'persona.upsert': async (p: { persona: Persona }) => {
      const persona = PersonaSchema.parse(p.persona);
      const cur = list();
      const idx = cur.findIndex((x) => x.id === persona.id);
      setPref(
        'persona.list',
        idx >= 0 ? cur.map((x) => (x.id === persona.id ? persona : x)) : [...cur, persona],
      );
      return { ok: true as const, id: persona.id };
    },

    'persona.delete': async (p: { id: string }) => {
      setPref('persona.list', list().filter((x) => x.id !== p.id));
      if (getPrefs()['persona.defaultId'] === p.id) setPref('persona.defaultId', '');
      const bindings = { ...getPrefs()['persona.bindings'] };
      let changed = false;
      for (const [cid, pid] of Object.entries(bindings)) {
        if (pid === p.id) {
          delete bindings[cid];
          changed = true;
        }
      }
      if (changed) setPref('persona.bindings', bindings);
      return { ok: true as const };
    },

    'persona.setDefault': async (p: { id: string }) => {
      setPref('persona.defaultId', p.id);
      return { ok: true as const };
    },

    'persona.bind': async (p: { characterId: string; personaId: string }) => {
      const bindings = { ...getPrefs()['persona.bindings'] };
      if (p.personaId === '') delete bindings[p.characterId];
      else bindings[p.characterId] = p.personaId;
      setPref('persona.bindings', bindings);
      return { ok: true as const };
    },

    /** 内部注入 API：生效 persona。序 = 绑定 > 包声明(packFallback) > 用户默认 > null（spec §4）。
     *  返回带可选 id（用户 persona 有、包声明无）——批次③既有 `.id` 断言零改动。 */
    resolveFor(
      characterId: string,
      packFallback?: { systemPrompt: string; beginDialogs: string[] } | null,
    ): { id?: string; systemPrompt: string; beginDialogs: string[] } | null {
      const p = getPrefs();
      const byId = (pid: string): Persona | null =>
        p['persona.list'].find((x) => x.id === pid) ?? null;
      const bound = p['persona.bindings'][characterId];
      if (bound) {
        const hit = byId(bound);
        if (hit) return hit; // 绑定失效 → 顺位往下落
      }
      if (packFallback) return packFallback;
      const d = p['persona.defaultId'];
      return d ? byId(d) : null;
    },
  };
}
