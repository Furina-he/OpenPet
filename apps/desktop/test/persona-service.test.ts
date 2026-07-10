import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type PrefKey, type Prefs } from '@openpet/protocol';
import { createPersonaService } from '../electron/main/persona-service.js';

function makeDeps() {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  return {
    prefs,
    deps: {
      getPrefs: () => prefs,
      setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => {
        prefs[key] = value;
      },
    },
  };
}
const P1 = { id: 'p1', name: '猫娘', systemPrompt: '你是猫娘。', beginDialogs: ['你好', '喵~'] };

describe('persona-service（§6）', () => {
  it('upsert 新增与更新；getAll 返回三元组', async () => {
    const { deps } = makeDeps();
    const svc = createPersonaService(deps);
    await svc['persona.upsert']({ persona: P1 });
    await svc['persona.upsert']({ persona: { ...P1, name: '猫娘2' } });
    const all = await svc['persona.getAll']({});
    expect(all.personas).toHaveLength(1);
    expect(all.personas[0]!.name).toBe('猫娘2');
    expect(all.defaultId).toBe('');
    expect(all.bindings).toEqual({});
  });
  it('setDefault + bind + resolveFor 优先级：绑定 > 默认 > null', async () => {
    const { deps } = makeDeps();
    const svc = createPersonaService(deps);
    await svc['persona.upsert']({ persona: P1 });
    await svc['persona.upsert']({ persona: { ...P1, id: 'p2', name: '管家' } });
    expect(svc.resolveFor('default')).toBeNull();
    await svc['persona.setDefault']({ id: 'p1' });
    expect(svc.resolveFor('default')?.id).toBe('p1');
    await svc['persona.bind']({ characterId: 'default', personaId: 'p2' });
    expect(svc.resolveFor('default')?.id).toBe('p2');
    await svc['persona.bind']({ characterId: 'default', personaId: '' }); // 解绑回落默认
    expect(svc.resolveFor('default')?.id).toBe('p1');
  });
  it('delete 连带清 defaultId 与 bindings 引用', async () => {
    const { deps } = makeDeps();
    const svc = createPersonaService(deps);
    await svc['persona.upsert']({ persona: P1 });
    await svc['persona.setDefault']({ id: 'p1' });
    await svc['persona.bind']({ characterId: 'default', personaId: 'p1' });
    await svc['persona.delete']({ id: 'p1' });
    const all = await svc['persona.getAll']({});
    expect(all.personas).toEqual([]);
    expect(all.defaultId).toBe('');
    expect(all.bindings).toEqual({});
    expect(svc.resolveFor('default')).toBeNull();
  });
  it('批次④ 生效序：绑定 > 包声明 > 用户默认；绑定失效顺位落包', async () => {
    const { deps } = makeDeps();
    const svc = createPersonaService(deps);
    await svc['persona.upsert']({ persona: P1 }); // p1
    const pack = { systemPrompt: '包人设', beginDialogs: [] as string[] };
    // 无绑定无默认 → 包
    expect(svc.resolveFor('default', pack)?.systemPrompt).toBe('包人设');
    // 用户默认存在但包声明优先级更高
    await svc['persona.setDefault']({ id: 'p1' });
    expect(svc.resolveFor('default', pack)?.systemPrompt).toBe('包人设');
    expect(svc.resolveFor('default')?.id).toBe('p1'); // 无包 → 默认（批次③行为不变）
    // 绑定最高
    await svc['persona.bind']({ characterId: 'default', personaId: 'p1' });
    expect(svc.resolveFor('default', pack)?.systemPrompt).toBe('你是猫娘。');
    // 绑定指向已删 persona → 顺位落包
    await svc['persona.delete']({ id: 'p1' });
    await svc['persona.bind']({ characterId: 'default', personaId: 'ghost' });
    expect(svc.resolveFor('default', pack)?.systemPrompt).toBe('包人设');
  });
});
