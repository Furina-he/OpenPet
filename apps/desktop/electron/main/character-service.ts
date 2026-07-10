/**
 * CharacterService —— 角色包 Main 侧加载/列表/切换（纯 Node，无 Electron 依赖）。
 *
 * 双根：builtinRoot（随 app 分发，dev=apps/desktop/characters）+ importedRoot
 * （userData/characters，导入包）。activeId 持久化在 prefs（注入读写闭包）。
 * current()：load(activeId)，失败回退 default（包被手删不崩）。
 * 切换/导入/卸载后 invalidate() 清缓存；坏包 list 时跳过 + warn（E1 ⚠ 态 follow-up）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CharacterManifestSchema, type CharacterManifest } from '@openpet/protocol';

export interface LoadedCharacter {
  characterId: string;
  manifest: CharacterManifest;
}

export interface CharacterServiceDeps {
  builtinRoot: string;
  importedRoot: string;
  activeId: () => string;
  setActiveId: (id: string) => void;
}

export interface CharacterService {
  current(): LoadedCharacter;
  list(): Array<LoadedCharacter & { builtin: boolean }>;
  /** 校验可加载 → 写 activeId → 缓存失效。未知/坏包抛错。 */
  switch(id: string): LoadedCharacter;
  isBuiltin(id: string): boolean;
  /** id 所在根目录（导入/卸载/asset 解析辅助）；不存在 → null。 */
  rootOf(id: string): string | null;
  invalidate(): void;
}

export function createCharacterService(deps: CharacterServiceDeps): CharacterService {
  let cache = new Map<string, LoadedCharacter>();

  function rootOf(id: string): string | null {
    if (existsSync(path.join(deps.builtinRoot, id, 'manifest.json'))) return deps.builtinRoot;
    if (existsSync(path.join(deps.importedRoot, id, 'manifest.json'))) return deps.importedRoot;
    return null;
  }

  function load(id: string): LoadedCharacter {
    const hit = cache.get(id);
    if (hit) return hit;
    const root = rootOf(id);
    if (!root) throw new Error(`character not found: ${id}`);
    const file = path.join(root, id, 'manifest.json');
    const manifest = CharacterManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (manifest.id !== id) {
      throw new Error(`manifest id "${manifest.id}" mismatches directory "${id}"`);
    }
    const loaded = { characterId: id, manifest };
    cache.set(id, loaded);
    return loaded;
  }

  function scanRoot(root: string, builtin: boolean): Array<LoadedCharacter & { builtin: boolean }> {
    if (!existsSync(root)) return [];
    const out: Array<LoadedCharacter & { builtin: boolean }> = [];
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      try {
        out.push({ ...load(ent.name), builtin });
      } catch (e) {
        console.warn(`[character] skip broken pack "${ent.name}": ${String(e)}`);
      }
    }
    return out;
  }

  return {
    current() {
      try {
        return load(deps.activeId());
      } catch {
        return load('default'); // 包被手删/坏包：回退内置（default 必在）
      }
    },
    list() {
      const builtin = scanRoot(deps.builtinRoot, true);
      const seen = new Set(builtin.map((c) => c.characterId));
      const imported = scanRoot(deps.importedRoot, false).filter((c) => !seen.has(c.characterId));
      return [...builtin, ...imported];
    },
    switch(id: string) {
      cache.delete(id); // 强制重读（编辑过的包也能刷新）
      const loaded = load(id);
      deps.setActiveId(id);
      return loaded;
    },
    isBuiltin: (id) => existsSync(path.join(deps.builtinRoot, id, 'manifest.json')),
    rootOf,
    invalidate() {
      cache = new Map();
    },
  };
}
