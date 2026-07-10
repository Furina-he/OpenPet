/** ⑩.7 写侧安全单测：updateManifest 原子写 / duplicate 冲突自增 / export→import round-trip。 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCharacterService } from '../electron/main/character-service.js';
import { installPack } from '../electron/main/pack-import.js';

const MANIFEST = (id: string, name = id): string =>
  JSON.stringify({ id, name, version: '1.0.0', engine: 'vrm', model: 'model.vrm' });

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function makeSvc() {
  const base = mkdtempSync(path.join(tmpdir(), 'ds-edit-'));
  cleanups.push(base);
  const builtin = path.join(base, 'builtin');
  const imported = path.join(base, 'imported');
  mkdirSync(path.join(builtin, 'default'), { recursive: true });
  writeFileSync(path.join(builtin, 'default', 'manifest.json'), MANIFEST('default', '小灵'));
  writeFileSync(path.join(builtin, 'default', 'model.vrm'), 'FAKE_VRM');
  mkdirSync(path.join(imported, 'miko'), { recursive: true });
  writeFileSync(path.join(imported, 'miko', 'manifest.json'), MANIFEST('miko', '巫女'));
  writeFileSync(path.join(imported, 'miko', 'model.vrm'), 'FAKE_VRM_MIKO');
  const active = { id: 'default' };
  const svc = createCharacterService({
    builtinRoot: builtin,
    importedRoot: imported,
    activeId: () => active.id,
    setActiveId: (id) => {
      active.id = id;
    },
  });
  return { base, builtin, imported, svc };
}

const NEXT = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'miko',
  name: '巫女·改',
  version: '1.1.0',
  engine: 'vrm',
  model: 'model.vrm',
  author: 'tester',
  tags: ['测试'],
  ...over,
});

describe('updateManifest（安全边界 + 原子写）', () => {
  it('userData 角色可改：写回生效且缓存刷新', () => {
    const { imported, svc } = makeSvc();
    const m = svc.updateManifest('miko', NEXT());
    expect(m.name).toBe('巫女·改');
    const onDisk = JSON.parse(readFileSync(path.join(imported, 'miko', 'manifest.json'), 'utf8'));
    expect(onDisk.author).toBe('tester');
    expect(svc.list().find((c) => c.characterId === 'miko')?.manifest.version).toBe('1.1.0');
    expect(existsSync(path.join(imported, 'miko', 'manifest.json.tmp'))).toBe(false);
  });
  it('内置角色拒绝编辑', () => {
    const { svc } = makeSvc();
    expect(() => svc.updateManifest('default', NEXT({ id: 'default' }))).toThrow(/内置|只读/);
  });
  it('未知角色拒绝', () => {
    const { svc } = makeSvc();
    expect(() => svc.updateManifest('ghost', NEXT({ id: 'ghost' }))).toThrow(/not found/i);
  });
  it.each([
    ['id', { id: 'other' }],
    ['engine', { engine: 'live2d', model: 'a.model3.json' }],
    ['model', { model: 'other.vrm' }],
  ])('不可变字段 %s 变更拒绝且原文件无损', (_field, over) => {
    const { imported, svc } = makeSvc();
    const before = readFileSync(path.join(imported, 'miko', 'manifest.json'), 'utf8');
    expect(() => svc.updateManifest('miko', NEXT(over))).toThrow();
    expect(readFileSync(path.join(imported, 'miko', 'manifest.json'), 'utf8')).toBe(before);
  });
  it('坏 manifest（schema 违约）拒绝且原文件无损', () => {
    const { imported, svc } = makeSvc();
    const before = readFileSync(path.join(imported, 'miko', 'manifest.json'), 'utf8');
    expect(() => svc.updateManifest('miko', NEXT({ model: '../evil.vrm' }))).toThrow();
    expect(() => svc.updateManifest('miko', { id: 'miko' })).toThrow();
    expect(readFileSync(path.join(imported, 'miko', 'manifest.json'), 'utf8')).toBe(before);
  });
});

describe('duplicate（复制后编辑入口）', () => {
  it('内置 → userData：newId=<id>-copy，name 加副本，文件齐', () => {
    const { imported, svc } = makeSvc();
    const { newId } = svc.duplicate('default');
    expect(newId).toBe('default-copy');
    const m = JSON.parse(readFileSync(path.join(imported, newId, 'manifest.json'), 'utf8'));
    expect(m.id).toBe('default-copy');
    expect(m.name).toContain('副本');
    expect(readFileSync(path.join(imported, newId, 'model.vrm'), 'utf8')).toBe('FAKE_VRM');
    expect(svc.list().map((c) => c.characterId)).toContain('default-copy');
  });
  it('冲突自增 -copy2/-copy3', () => {
    const { svc } = makeSvc();
    expect(svc.duplicate('miko').newId).toBe('miko-copy');
    expect(svc.duplicate('miko').newId).toBe('miko-copy2');
    expect(svc.duplicate('miko').newId).toBe('miko-copy3');
  });
  it('未知角色拒绝', () => {
    const { svc } = makeSvc();
    expect(() => svc.duplicate('ghost')).toThrow(/not found/i);
  });
});

describe('exportPack（导出再导入 round-trip）', () => {
  it('zip 根含 manifest.json，installPack 可复原', () => {
    const { base, svc } = makeSvc();
    const out = path.join(base, 'miko.dspack');
    svc.exportPack('miko', out);
    expect(existsSync(out)).toBe(true);
    const reRoot = path.join(base, 'reimported');
    mkdirSync(reRoot, { recursive: true });
    const m = installPack(out, reRoot, () => false);
    expect(m.id).toBe('miko');
    expect(readFileSync(path.join(reRoot, 'miko', 'model.vrm'), 'utf8')).toBe('FAKE_VRM_MIKO');
  });
  it('未知角色拒绝', () => {
    const { base, svc } = makeSvc();
    expect(() => svc.exportPack('ghost', path.join(base, 'x.dspack'))).toThrow(/not found/i);
  });
});

describe('listFiles（E4 preview 下拉数据源）', () => {
  it('递归列相对路径，不含 manifest.json', () => {
    const { imported, svc } = makeSvc();
    mkdirSync(path.join(imported, 'miko', 'img'), { recursive: true });
    writeFileSync(path.join(imported, 'miko', 'img', 'card.png'), 'PNG');
    expect(svc.listFiles('miko')).toEqual(['img/card.png', 'model.vrm']);
    expect(() => svc.listFiles('ghost')).toThrow(/not found/i);
  });
});
