import { describe, it, expect } from 'vitest';
import { migrateUserData } from '../electron/main/user-data-migrate.js';

function fakeFs(dirs: Record<string, boolean>) {
  const ops: string[] = [];
  const fs = {
    existsSync: (p: string) => dirs[p] ?? false,
    readdirSync: (p: string) => (dirs[p] ? ['prefs.json'] : []),
    renameSync: (a: string, b: string) => {
      ops.push(`rename ${a} -> ${b}`);
    },
    cpSync: (a: string, b: string) => {
      ops.push(`cp ${a} -> ${b}`);
    },
  };
  return { ops, fs };
}

describe('migrateUserData', () => {
  it('新目录不存在且旧目录存在 → 整目录 rename', () => {
    const h = fakeFs({ '/appdata/OLD': true });
    migrateUserData(['/appdata/OLD'], '/appdata/openpet', h.fs as never);
    expect(h.ops).toEqual(['rename /appdata/OLD -> /appdata/openpet']);
  });
  it('rename 抛 EXDEV → 递归复制兜底', () => {
    const h = fakeFs({ '/appdata/OLD': true });
    h.fs.renameSync = () => {
      const e = new Error('x') as never as { code: string };
      e.code = 'EXDEV';
      throw e;
    };
    migrateUserData(['/appdata/OLD'], '/appdata/openpet', h.fs as never);
    expect(h.ops).toEqual(['cp /appdata/OLD -> /appdata/openpet']);
  });
  it('新目录已存在（含内容）→ 不动', () => {
    const h = fakeFs({ '/appdata/openpet': true, '/appdata/OLD': true });
    migrateUserData(['/appdata/OLD'], '/appdata/openpet', h.fs as never);
    expect(h.ops).toEqual([]);
  });
  it('旧目录都不存在（全新安装）→ 不动', () => {
    const h = fakeFs({});
    migrateUserData(['/appdata/OLD'], '/appdata/openpet', h.fs as never);
    expect(h.ops).toEqual([]);
  });
});
