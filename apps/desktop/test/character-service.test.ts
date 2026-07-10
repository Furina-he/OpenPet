import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCharacterService } from '../electron/main/character-service.js';

const MANIFEST = (id: string, name = id): string =>
  JSON.stringify({ id, name, version: '1.0.0', engine: 'vrm', model: 'model.vrm' });

function makeRoots(): { builtin: string; imported: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'ds-chars-'));
  const builtin = path.join(base, 'builtin');
  const imported = path.join(base, 'imported');
  mkdirSync(path.join(builtin, 'default'), { recursive: true });
  writeFileSync(path.join(builtin, 'default', 'manifest.json'), MANIFEST('default', '小灵'));
  mkdirSync(imported, { recursive: true });
  return { builtin, imported };
}
const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function makeSvc(roots = makeRoots(), active = { id: 'default' }) {
  cleanups.push(path.dirname(roots.builtin));
  return {
    roots,
    active,
    svc: createCharacterService({
      builtinRoot: roots.builtin,
      importedRoot: roots.imported,
      activeId: () => active.id,
      setActiveId: (id) => {
        active.id = id;
      },
    }),
  };
}

describe('character-service 多角色（批次④）', () => {
  it('list 扫双根并标 builtin；坏包跳过不炸', () => {
    const { roots, svc } = makeSvc();
    mkdirSync(path.join(roots.imported, 'miko'));
    writeFileSync(path.join(roots.imported, 'miko', 'manifest.json'), MANIFEST('miko'));
    mkdirSync(path.join(roots.imported, 'broken'));
    writeFileSync(path.join(roots.imported, 'broken', 'manifest.json'), '{bad json');
    const list = svc.list();
    expect(list.map((c) => c.characterId).sort()).toEqual(['default', 'miko']);
    expect(list.find((c) => c.characterId === 'default')?.builtin).toBe(true);
    expect(list.find((c) => c.characterId === 'miko')?.builtin).toBe(false);
  });
  it('switch 校验可载 + 写 activeId + current 跟随；未知 id 抛', () => {
    const { roots, svc, active } = makeSvc();
    mkdirSync(path.join(roots.imported, 'miko'));
    writeFileSync(path.join(roots.imported, 'miko', 'manifest.json'), MANIFEST('miko', '巫女'));
    svc.switch('miko');
    expect(active.id).toBe('miko');
    expect(svc.current().manifest.name).toBe('巫女');
    expect(() => svc.switch('ghost')).toThrow();
  });
  it('activeId 指向已删包 → current 回退 default 不炸', () => {
    const { svc, active } = makeSvc();
    active.id = 'gone';
    expect(svc.current().characterId).toBe('default');
  });
  it('invalidate 后重读磁盘（导入后可见）', () => {
    const { roots, svc } = makeSvc();
    expect(svc.list()).toHaveLength(1);
    mkdirSync(path.join(roots.imported, 'miko'));
    writeFileSync(path.join(roots.imported, 'miko', 'manifest.json'), MANIFEST('miko'));
    svc.invalidate();
    expect(svc.list()).toHaveLength(2);
    expect(svc.isBuiltin('default')).toBe(true);
    expect(svc.isBuiltin('miko')).toBe(false);
  });
});

// 旧单角色负路径用例并入（M3 起）：current() 对 default 自身坏包仍须抛错（渲染端 fallback 脸）。
describe('character-service 加载校验（既有语义）', () => {
  function makeBareRoots(): { builtin: string; imported: string } {
    const base = mkdtempSync(path.join(tmpdir(), 'ds-chars-'));
    cleanups.push(base);
    const builtin = path.join(base, 'builtin');
    const imported = path.join(base, 'imported');
    mkdirSync(builtin, { recursive: true });
    mkdirSync(imported, { recursive: true });
    return { builtin, imported };
  }
  function bareSvc(roots: { builtin: string; imported: string }) {
    return createCharacterService({
      builtinRoot: roots.builtin,
      importedRoot: roots.imported,
      activeId: () => 'default',
      setActiveId: () => {},
    });
  }
  const writeDefault = (roots: { builtin: string }, manifest: unknown): void => {
    mkdirSync(path.join(roots.builtin, 'default'), { recursive: true });
    writeFileSync(
      path.join(roots.builtin, 'default', 'manifest.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  };
  const VALID = {
    id: 'default',
    name: '小灵',
    version: '0.1.0',
    engine: 'vrm',
    model: 'model.vrm',
    actions: ['wave', 'nod'],
  };

  it('caches after first load (later file corruption invisible)', () => {
    const roots = makeBareRoots();
    writeDefault(roots, VALID);
    const svc = bareSvc(roots);
    svc.current();
    writeFileSync(path.join(roots.builtin, 'default', 'manifest.json'), '{broken');
    expect(svc.current().manifest.name).toBe('小灵');
  });
  it('throws on missing manifest', () => {
    const svc = bareSvc(makeBareRoots());
    expect(() => svc.current()).toThrow(/not found/i);
  });
  it('throws on schema violation (model traversal)', () => {
    const roots = makeBareRoots();
    writeDefault(roots, { ...VALID, model: '../escape.vrm' });
    expect(() => bareSvc(roots).current()).toThrow();
  });
  it('throws when manifest.id mismatches its directory name', () => {
    const roots = makeBareRoots();
    writeDefault(roots, { ...VALID, id: 'other' });
    expect(() => bareSvc(roots).current()).toThrow(/id/i);
  });
  it('throws on broken JSON', () => {
    const roots = makeBareRoots();
    writeDefault(roots, '{not json');
    expect(() => bareSvc(roots).current()).toThrow();
  });
});
