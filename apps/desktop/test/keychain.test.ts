import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

// mock electron：safeStorage 不可用 → Keychain 走 AES-GCM 兜底路径
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => '',
  },
}));

import { Keychain } from '../electron/main/keychain.js';

describe('Keychain', () => {
  let testDir: string;
  let kcPath: string;

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `keychain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
    kcPath = path.join(testDir, 'secrets.kc');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('stores and retrieves a secret', async () => {
    const kc = new Keychain(kcPath);
    await kc.set('test-provider', 'api-key', 'sk-test123');
    expect(await kc.get('test-provider', 'api-key')).toBe('sk-test123');
  });

  it('returns null for non-existent key', async () => {
    const kc = new Keychain(kcPath);
    expect(await kc.get('nonexistent', 'key')).toBeNull();
  });

  it('deletes a secret', async () => {
    const kc = new Keychain(kcPath);
    await kc.set('test', 'key', 'value');
    await kc.delete('test', 'key');
    expect(await kc.get('test', 'key')).toBeNull();
  });

  it('persists across instances (reload from disk)', async () => {
    const kc1 = new Keychain(kcPath);
    await kc1.set('p', 'api-key', 'secret-value');

    // 新实例从磁盘读取，验证加密往返
    const kc2 = new Keychain(kcPath);
    expect(await kc2.get('p', 'api-key')).toBe('secret-value');
  });
});
