import { z } from 'zod';

/**
 * 角色包 manifest —— Main（校验/asset 协议）与 Character Renderer（运行时词表）
 * 共享的单一真源（tech-design §7「资产加载安全」）。
 *
 * id 同时是 asset:// URL 的 host：标准 scheme 的 host 会被小写化，因此禁大写。
 */
export const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const NAME_RE = /^[a-zA-Z][\w-]*$/;

/**
 * 包内相对路径白名单形状：非空、不含 `\`、无空段/`.`/`..` 段、不以 `/` 开头。
 * 盘符（`C:` 等）被「段含 `:` 即非法」排除（URL/路径段不允许 `:`）。
 */
export function isSafeRelPath(p: string): boolean {
  if (p.length === 0 || p.includes('\\') || p.startsWith('/')) return false;
  const segs = p.split('/');
  return segs.every((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes(':'));
}

export const CharacterManifestSchema = z.object({
  id: z.string().regex(CHARACTER_ID_RE),
  name: z.string().min(1),
  version: z.string().min(1),
  /** 双引擎二选一（§7）；live2d 留 V1+，schema 先收口为 vrm 字面量。 */
  engine: z.literal('vrm'),
  /** 包内相对路径（asset://<id>/<model> 的 path 部分）。 */
  model: z.string().refine(isSafeRelPath, { message: 'model must be a safe relative path' }),
  /** 情绪名 → VRM expression 权重组合；缺省用运行时内置表。 */
  emotions: z
    .record(
      z.string().regex(NAME_RE),
      z.record(z.string().regex(NAME_RE), z.number().min(0).max(1)),
    )
    .optional(),
  /** 动作词表；缺省 DEFAULT_ACTIONS（persona-prompt-template）。 */
  actions: z.array(z.string().regex(NAME_RE)).optional(),
});

export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;
