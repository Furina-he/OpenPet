import { safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs/promises';

interface StoredEntry {
  iv: string;
  data: string;
  useSafeStorage: boolean;
}

export class Keychain {
  private cache = new Map<string, Map<string, string>>();
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  private ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const stored: Record<string, Record<string, StoredEntry>> = JSON.parse(content);
      for (const [providerId, keys] of Object.entries(stored)) {
        const map = new Map<string, string>();
        for (const [keyName, entry] of Object.entries(keys)) {
          const decrypted = this.decrypt(entry);
          if (decrypted !== null) map.set(keyName, decrypted);
        }
        this.cache.set(providerId, map);
      }
    } catch (err) {
      // ENOENT = 首次运行（正常）；其他错误（损坏/IO）应记录，不可静默吞掉
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[Keychain] failed to load ${this.filePath}:`, err);
      }
    }
  }

  async get(providerId: string, keyName: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.cache.get(providerId)?.get(keyName) ?? null;
  }

  async set(providerId: string, keyName: string, value: string): Promise<void> {
    await this.ensureLoaded();
    let map = this.cache.get(providerId);
    if (!map) {
      map = new Map();
      this.cache.set(providerId, map);
    }
    map.set(keyName, value);
    await this.flush();
  }

  async delete(providerId: string, keyName: string): Promise<void> {
    await this.ensureLoaded();
    const map = this.cache.get(providerId);
    if (!map) return;
    map.delete(keyName);
    if (map.size === 0) this.cache.delete(providerId);
    await this.flush();
  }

  private flushChain: Promise<void> = Promise.resolve();

  private flush(): Promise<void> {
    // 串行化：每次 flush 接在上一次之后，避免并发 writeFile 交错
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    const stored: Record<string, Record<string, StoredEntry>> = {};
    for (const [providerId, keys] of this.cache) {
      const entries: Record<string, StoredEntry> = {};
      for (const [keyName, value] of keys) {
        entries[keyName] = this.encrypt(value);
      }
      stored[providerId] = entries;
    }
    // 原子写：先写 temp 再 rename（rename 在同一文件系统上是原子的）
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(stored, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private encrypt(plaintext: string): StoredEntry {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext);
      return { iv: '', data: encrypted.toString('base64'), useSafeStorage: true };
    }
    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      data: Buffer.concat([encrypted, tag]).toString('base64'),
      useSafeStorage: false,
    };
  }

  private decrypt(entry: StoredEntry): string | null {
    try {
      if (entry.useSafeStorage) {
        return safeStorage.decryptString(Buffer.from(entry.data, 'base64'));
      }
      const key = this.deriveKey();
      const iv = Buffer.from(entry.iv, 'base64');
      const combined = Buffer.from(entry.data, 'base64');
      const encrypted = combined.subarray(0, -16);
      const tag = combined.subarray(-16);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private deriveKey(): Buffer {
    // 兜底密钥从机器标识派生（safeStorage 不可用时；不够安全但优于明文）
    const id = os.hostname() + os.userInfo().username;
    return createHash('sha256').update(id).digest();
  }
}
