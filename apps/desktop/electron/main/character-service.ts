/**
 * CharacterService —— 角色包 manifest 的 Main 侧加载/校验/缓存（纯 Node，无 Electron 依赖）。
 *
 * `character.current` 的后端：读 `<charactersRoot>/<id>/manifest.json` → Zod 校验
 * （CharacterManifestSchema 含路径安全 refine）→ id 与目录名一致性 → 缓存。
 * 失败 throw（ipcMain.handle 化为 rejected promise；渲染端 catch → fallback 脸）。
 * MVP 单角色 'default'；多角色/切换是 V1（角色管理 E 系列）的事。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CharacterManifestSchema, type CharacterManifest } from '@desksoul/protocol';

export interface LoadedCharacter {
  characterId: string;
  manifest: CharacterManifest;
}

export interface CharacterService {
  current(): LoadedCharacter;
}

export function createCharacterService(
  charactersRoot: string,
  defaultId = 'default',
): CharacterService {
  let cache: LoadedCharacter | null = null;

  function load(id: string): LoadedCharacter {
    const file = path.join(charactersRoot, id, 'manifest.json');
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      throw new Error(`character manifest unreadable: ${file} (${String(e)})`);
    }
    const manifest = CharacterManifestSchema.parse(JSON.parse(raw));
    if (manifest.id !== id) {
      throw new Error(`manifest id "${manifest.id}" mismatches directory "${id}"`);
    }
    return { characterId: id, manifest };
  }

  return {
    current() {
      cache ??= load(defaultId);
      return cache;
    },
  };
}
