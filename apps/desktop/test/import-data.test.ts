import AdmZip from 'adm-zip';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../electron/main/db/schema.js';
import { stageDsbakImport, applyPendingImport } from '../electron/main/db/import-data.js';

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
