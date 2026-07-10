import { describe, expect, it } from 'vitest';
import { CharacterManifestSchema, Methods } from '../src/index.js';

const BASE = { id: 'miko', name: '巫女', version: '1.0.0', engine: 'vrm', model: 'model.vrm' };

describe('⑩.7 manifest 元数据扩展（E2 信息区）', () => {
  it('author/description/license/tags 可选字段往返', () => {
    const m = CharacterManifestSchema.parse({
      ...BASE,
      author: 'openpet',
      description: '测试角色包',
      license: 'MIT',
      tags: ['可爱', 'vrm'],
    });
    expect(m.author).toBe('openpet');
    expect(m.description).toBe('测试角色包');
    expect(m.license).toBe('MIT');
    expect(m.tags).toEqual(['可爱', 'vrm']);
  });

  it('全缺省仍解析（向后兼容）', () => {
    const m = CharacterManifestSchema.parse(BASE);
    expect(m.author).toBeUndefined();
    expect(m.tags).toBeUndefined();
  });

  it('tags：拒绝空串项与超 20 项', () => {
    expect(CharacterManifestSchema.safeParse({ ...BASE, tags: [''] }).success).toBe(false);
    expect(
      CharacterManifestSchema.safeParse({ ...BASE, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
    expect(
      CharacterManifestSchema.safeParse({ ...BASE, tags: Array.from({ length: 20 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(true);
  });
});

describe('⑩.7 角色写侧 5 RPC schema', () => {
  it('methods 注册齐全', () => {
    for (const m of [
      'character.updateManifest',
      'character.duplicate',
      'character.export',
      'character.revealInFolder',
      'character.testGreeting',
    ] as const)
      expect(Methods[m]).toBeDefined();
  });

  it('updateManifest params 校验 manifest 形状', () => {
    const P = Methods['character.updateManifest'].params;
    expect(P.safeParse({ id: 'miko', manifest: BASE }).success).toBe(true);
    expect(P.safeParse({ id: 'miko', manifest: { ...BASE, model: '../evil.vrm' } }).success).toBe(
      false,
    );
    expect(P.safeParse({ id: '', manifest: BASE }).success).toBe(false);
  });

  it('duplicate 返回 newId；export 返回 path 或 canceled', () => {
    expect(Methods['character.duplicate'].result.safeParse({ newId: 'miko-copy' }).success).toBe(
      true,
    );
    const E = Methods['character.export'].result;
    expect(E.safeParse({ canceled: true }).success).toBe(true);
    expect(E.safeParse({ canceled: false, path: 'D:/out/miko.dspack' }).success).toBe(true);
    expect(E.safeParse({}).success).toBe(false);
  });

  it('revealInFolder/testGreeting 形状', () => {
    expect(Methods['character.revealInFolder'].params.safeParse({ id: 'miko' }).success).toBe(true);
    expect(Methods['character.testGreeting'].result.safeParse({ ok: true }).success).toBe(true);
  });
});
