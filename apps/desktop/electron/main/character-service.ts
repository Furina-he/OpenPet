/**
 * CharacterService —— 角色包 Main 侧加载/列表/切换（纯 Node，无 Electron 依赖）。
 *
 * 双根：builtinRoot（随 app 分发，dev=apps/desktop/characters）+ importedRoot
 * （userData/characters，导入包）。activeId 持久化在 prefs（注入读写闭包）。
 * current()：load(activeId)，失败回退 default（包被手删不崩）。
 * 切换/导入/卸载后 invalidate() 清缓存；坏包 list 时跳过 + warn（E1 ⚠ 态 follow-up）。
 * ⑩.7 写侧：updateManifest（仅 userData 根，id/engine/model 不可变，原子写）/
 * duplicate（复制后编辑）/ exportPack（.dspack 导出，与 pack-import 结构互逆）。
 */
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { CharacterManifestSchema, type CharacterManifest } from '@openpet/protocol';
import { RpcError } from './router.js';

export interface LoadedCharacter {
  characterId: string;
  manifest: CharacterManifest;
  /** 包目录大小（E2 信息区）；load 时随缓存计算。 */
  sizeBytes: number;
  /** 安装时间 = 包目录 birthtime（Windows 有效；异常回退 mtime）。 */
  installedAt: number;
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
  // --- ⑩.7 E4 写侧（仅 userData 根可写；内置只读）---
  /** 整包替换 manifest.json：Zod 全校验 + id/engine/model 不可变 + 原子写（tmp+rename）。 */
  updateManifest(id: string, next: unknown): CharacterManifest;
  /** 目录复制到 userData 根 `<id>-copy`（冲突自增）+ manifest id/name 重写；内置可为源。 */
  duplicate(id: string): { newId: string };
  /** 目录 zip 打包到 targetPath（manifest.json 在 zip 根，与 pack-import 期待一致）。 */
  exportPack(id: string, targetPath: string): void;
}

export function createCharacterService(deps: CharacterServiceDeps): CharacterService {
  let cache = new Map<string, LoadedCharacter>();

  function rootOf(id: string): string | null {
    if (existsSync(path.join(deps.builtinRoot, id, 'manifest.json'))) return deps.builtinRoot;
    if (existsSync(path.join(deps.importedRoot, id, 'manifest.json'))) return deps.importedRoot;
    return null;
  }

  function dirSize(dir: string): number {
    let total = 0;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      total += ent.isDirectory() ? dirSize(p) : statSync(p).size;
    }
    return total;
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
    const dir = path.join(root, id);
    const st = statSync(dir);
    const loaded = {
      characterId: id,
      manifest,
      sizeBytes: dirSize(dir),
      installedAt: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs,
    };
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
    updateManifest(id, next) {
      const root = rootOf(id);
      if (!root) throw new RpcError(-32602, `character not found: ${id}`);
      if (root !== deps.importedRoot) throw new RpcError(-32602, '内置角色只读，请复制后编辑');
      const file = path.join(root, id, 'manifest.json');
      const prev = CharacterManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      const manifest = CharacterManifestSchema.parse(next);
      if (manifest.id !== id || manifest.engine !== prev.engine || manifest.model !== prev.model) {
        throw new RpcError(-32602, 'id / engine / model 不可变更（改模型请重新制包）');
      }
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
      renameSync(tmp, file);
      cache.delete(id);
      return manifest;
    },
    duplicate(id) {
      const root = rootOf(id);
      if (!root) throw new RpcError(-32602, `character not found: ${id}`);
      let newId = `${id}-copy`;
      for (let n = 2; rootOf(newId) !== null; n++) newId = `${id}-copy${n}`;
      const dest = path.join(deps.importedRoot, newId);
      cpSync(path.join(root, id), dest, { recursive: true });
      const file = path.join(dest, 'manifest.json');
      const m = CharacterManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      const copy = { ...m, id: newId, name: `${m.name}（副本）` };
      writeFileSync(file, JSON.stringify(copy, null, 2), 'utf8');
      return { newId };
    },
    exportPack(id, targetPath) {
      const root = rootOf(id);
      if (!root) throw new RpcError(-32602, `character not found: ${id}`);
      const zip = new AdmZip();
      zip.addLocalFolder(path.join(root, id)); // 内容置于 zip 根（manifest.json 在根）
      zip.writeZip(targetPath);
    },
  };
}
