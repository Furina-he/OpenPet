import AdmZip from 'adm-zip';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../electron/main/db/schema.js';
import { stageDsbakImport, applyPendingImport } from '../electron/main/db/import-data.js';
import { exportDsbak, listMemoryFiles } from '../electron/main/db/export-bundle.js';
import { MemoryStore } from '../electron/main/db/index.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-imp-'));
  cleanups.push(d);
  return d;
};
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function makeDsbak(schemaVersion = SCHEMA_VERSION): string {
  const zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({ schemaVersion, exportedAt: 1, characterIds: ['default'], messageCount: 0 }),
    ),
  );
  zip.addFile('sessions.db', Buffer.from('fake-sqlite-bytes'));
  const f = path.join(tmp(), 'b.dsbak');
  zip.writeZip(f);
  return f;
}

describe('import-data（批次⑥ D7）', () => {
  it('stage：校验 manifest+db → 落 <sqlitePath>.import', () => {
    const sqlitePath = path.join(tmp(), 'sessions.db');
    stageDsbakImport(makeDsbak(), sqlitePath);
    expect(existsSync(`${sqlitePath}.import`)).toBe(true);
  });
  it('schemaVersion 超前 / 缺 sessions.db → 抛错', () => {
    const sqlitePath = path.join(tmp(), 'sessions.db');
    expect(() => stageDsbakImport(makeDsbak(SCHEMA_VERSION + 1), sqlitePath)).toThrow(/版本/);
    const zip = new AdmZip();
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({ schemaVersion: 1, exportedAt: 1, characterIds: [], messageCount: 0 }),
      ),
    );
    const bad = path.join(tmp(), 'bad.dsbak');
    zip.writeZip(bad);
    expect(() => stageDsbakImport(bad, sqlitePath)).toThrow(/sessions\.db/);
  });
  it('applyPendingImport：启动换库（旧库转 .bak-<ts>）；无 pending 时 no-op', () => {
    const dir = tmp();
    const sqlitePath = path.join(dir, 'sessions.db');
    writeFileSync(sqlitePath, 'old');
    writeFileSync(`${sqlitePath}.import`, 'new');
    applyPendingImport(sqlitePath, () => 123);
    expect(existsSync(`${sqlitePath}.import`)).toBe(false);
    expect(existsSync(`${sqlitePath}.bak-123`)).toBe(true);
    expect(applyPendingImport(sqlitePath, () => 124)).toBe(false); // no-op
  });
});

describe('⑲ .dsbak 纳入 memory/ 目录', () => {
  it('导出含 memory 条目（跳过 .tmp）；导入 stage → .import 目录；applyPendingImport 原子替换 + 旧目录 .bak', async () => {
    const dir = tmp();
    const memoryRoot = path.join(dir, 'memory');
    const wiki = new MemoryWiki(memoryRoot, { now: () => Date.UTC(2026, 8, 22, 12) });
    wiki.ensureLayout('default');
    wiki.applyOps(
      [{ op: 'create_page', kind: 'people', slug: 'a', title: 'A', keys: ['a'], content: '甲' }],
      'default',
    );
    writeFileSync(path.join(memoryRoot, 'user', 'junk.md.tmp'), 'x');
    const out = path.join(dir, 'out.dsbak');
    await exportDsbak(new MemoryStore(), out, { memoryRoot });
    const names = new AdmZip(out).getEntries().map((e) => e.entryName);
    expect(names).toContain('memory/index.md');
    expect(names).toContain('memory/user/profile.md');
    expect(names).toContain('memory/user/people/a.md');
    expect(names).toContain('memory/characters/default/timeline.md');
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);

    // 导入到另一个根：逐文件相等
    const dir2 = tmp();
    const root2 = path.join(dir2, 'memory');
    const sqlitePath = path.join(dir2, 'sessions.db');
    // out 无 sessions.db（纯内存导出）→ 需补一个才能 stage；用 makeDsbak 的思路再打一份含 db 的包
    const zip = new AdmZip(out);
    zip.addFile('sessions.db', Buffer.from('fake'));
    const out2 = path.join(dir, 'out2.dsbak');
    zip.writeZip(out2);
    stageDsbakImport(out2, sqlitePath, root2);
    expect(existsSync(path.join(`${root2}.import`, 'user', 'people', 'a.md'))).toBe(true);
    writeFileSync(path.join(dir2, 'old.txt'), 'x');
    const wiki2 = new MemoryWiki(root2);
    wiki2.ensureLayout('other'); // 现有目录 → 应转 .bak
    expect(applyPendingImport(sqlitePath, () => 555, root2)).toBe(true);
    expect(existsSync(`${root2}.bak-555`)).toBe(true);
    expect(existsSync(`${root2}.import`)).toBe(false);
    for (const rel of listMemoryFiles(memoryRoot)) {
      expect(readFileSync(path.join(root2, rel), 'utf8'), rel).toBe(
        readFileSync(path.join(memoryRoot, rel), 'utf8'),
      );
    }
    expect(existsSync(path.join(root2, 'characters', 'other'))).toBe(false);
  });

  it('旧备份无 memory/ → 不动现有 wiki（清掉残留 .import）', () => {
    const dir = tmp();
    const root = path.join(dir, 'memory');
    const sqlitePath = path.join(dir, 'sessions.db');
    mkdirSync(`${root}.import`, { recursive: true });
    stageDsbakImport(makeDsbak(), sqlitePath, root);
    expect(existsSync(`${root}.import`)).toBe(false);
    expect(applyPendingImport(sqlitePath, () => 1, root)).toBe(true); // 只换了库
    expect(existsSync(root)).toBe(false);
  });
});
