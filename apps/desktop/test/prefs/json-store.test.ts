import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonPrefsStore } from '../../electron/main/prefs/json-store';

let dir: string | null = null;
function tmpFile(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'ds-prefs-'));
  return path.join(dir, 'prefs.json');
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('JsonPrefsStore', () => {
  it('returns defaults when the file does not exist', () => {
    const s = new JsonPrefsStore(tmpFile());
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('persists a set atomically and survives reopen', () => {
    const file = tmpFile();
    const s = new JsonPrefsStore(file);
    s.set('display.theme', 'dark');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))['display.theme']).toBe('dark');
    const reborn = new JsonPrefsStore(file);
    expect(reborn.getAll()['display.theme']).toBe('dark');
  });

  it('falls back to defaults on a corrupt file (no throw)', () => {
    const file = tmpFile();
    writeFileSync(file, '{ this is not json', 'utf8');
    const s = new JsonPrefsStore(file);
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('back-fills missing keys from defaults for a partial file', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ 'display.theme': 'light' }), 'utf8');
    const s = new JsonPrefsStore(file);
    expect(s.getAll()['display.theme']).toBe('light');
    expect(s.getAll()['display.alwaysOnTop']).toBe(true);
  });
});
