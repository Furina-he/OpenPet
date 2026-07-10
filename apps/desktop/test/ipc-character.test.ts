import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCharacterService } from '../electron/main/character-service.js';
import { removeCharacter } from '../electron/main/character-ops.js';

// fixture 同 character-service.test.ts 的 makeRoots/MANIFEST（router 级测试不起 Electron）。
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

describe('character-ops.removeCharacter（批次④）', () => {
  it('内置拒卸；卸当前 → 先切 default + changed 通知；目录被删', () => {
    const { roots, svc, active } = makeSvc();
    mkdirSync(path.join(roots.imported, 'miko'));
    writeFileSync(path.join(roots.imported, 'miko', 'manifest.json'), MANIFEST('miko'));
    svc.invalidate();
    const changed: string[] = [];
    expect(() =>
      removeCharacter('default', {
        characters: svc,
        importedRoot: roots.imported,
        onChanged: (id) => changed.push(id),
      }),
    ).toThrow(/内置/);
    svc.switch('miko');
    removeCharacter('miko', {
      characters: svc,
      importedRoot: roots.imported,
      onChanged: (id) => changed.push(id),
    });
    expect(active.id).toBe('default');
    expect(changed).toEqual(['default']);
    expect(existsSync(path.join(roots.imported, 'miko'))).toBe(false);
  });
});
