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
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
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
    } catch {
      // 文件不存在或损坏：从空开始
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

  private async flush(): Promise<void> {
    const stored: Record<string, Record<string, StoredEntry>> = {};
    for (const [providerId, keys] of this.cache) {
      const entries: Record<string, StoredEntry> = {};
      for (const [keyName, value] of keys) {
        entries[keyName] = this.encrypt(value);
      }
      stored[providerId] = entries;
    }
    await fs.writeFile(this.filePath, JSON.stringify(stored, null, 2), 'utf-8');
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
