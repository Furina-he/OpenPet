import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCharacterService } from '../electron/main/character-service';

let root: string;

function writeManifest(id: string, manifest: unknown): void {
  mkdirSync(path.join(root, id), { recursive: true });
  writeFileSync(path.join(root, id, 'manifest.json'), JSON.stringify(manifest));
}

const VALID = {
  id: 'default',
  name: '小灵',
  version: '0.1.0',
  engine: 'vrm',
  model: 'model.vrm',
  actions: ['wave', 'nod'],
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'desksoul-chars-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createCharacterService', () => {
  it('loads and validates the default manifest', () => {
    writeManifest('default', VALID);
    const svc = createCharacterService(root);
    const cur = svc.current();
    expect(cur.characterId).toBe('default');
    expect(cur.manifest.model).toBe('model.vrm');
    expect(cur.manifest.actions).toEqual(['wave', 'nod']);
  });

  it('caches after first load (later file corruption invisible)', () => {
    writeManifest('default', VALID);
    const svc = createCharacterService(root);
    svc.current();
    writeFileSync(path.join(root, 'default', 'manifest.json'), '{broken');
    expect(svc.current().manifest.name).toBe('小灵');
  });

  it('throws on missing manifest', () => {
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow(/manifest/i);
  });

  it('throws on schema violation (model traversal)', () => {
    writeManifest('default', { ...VALID, model: '../escape.vrm' });
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow();
  });

  it('throws when manifest.id mismatches its directory name', () => {
    writeManifest('default', { ...VALID, id: 'other' });
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow(/id/i);
  });

  it('throws on broken JSON', () => {
    mkdirSync(path.join(root, 'default'), { recursive: true });
    writeFileSync(path.join(root, 'default', 'manifest.json'), '{not json');
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow();
  });
});
