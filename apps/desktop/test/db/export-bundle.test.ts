import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { exportDsbak } from '../../electron/main/db/export-bundle.js';
import { MemoryStore } from '../../electron/main/db/memory-store.js';
import { SqliteStore, loadBetterSqlite } from '../../electron/main/db/sqlite-store.js';
import { SCHEMA_VERSION } from '../../electron/main/db/schema.js';

let sqliteAvailable = false;
try {
  loadBetterSqlite();
  sqliteAvailable = true;
} catch {
  sqliteAvailable = false;
}

describe('exportDsbak', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a zip with manifest.json carrying usage metadata, and never secrets', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsbak-'));
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    const out = join(dir, 'backup.dsbak');
    await exportDsbak(store, out, { now: () => 12345 });

    expect(existsSync(out)).toBe(true);
    const zip = new AdmZip(out);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    expect(names).not.toContain('secrets.kc');
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION); // 随 schema 演进（勿硬编码；批次⑥ memory_fact → 3）
    expect(manifest.messageCount).toBe(1);
    expect(manifest.exportedAt).toBe(12345);
    expect(manifest.characterIds).toContain('default');
  });

  it.skipIf(!sqliteAvailable)('embeds a sessions.db snapshot when a sqlite backend is given', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsbak-sqlite-'));
    const dbPath = join(dir, 'sessions.db');
    const store = new SqliteStore(dbPath);
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    const out = join(dir, 'backup.dsbak');
    await exportDsbak(store, out, { now: () => 1, sqlitePath: dbPath });
    store.close();

    const names = new AdmZip(out).getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    expect(names).toContain('sessions.db');
  });
});
