import { z } from 'zod';
import { CueSchema } from './interaction-cues.js';
import { BeginDialogsSchema } from './persona-config.js';
import { PackLorebookSchema } from './lorebook.js';

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

/** 包声明人设（F-AI-05/F-CH-08）；生效序 = 用户绑定 > 包声明 > 用户默认 > 内置（spec §4）。 */
export const PackPersonaSchema = z.object({
  systemPrompt: z.string().min(1),
  beginDialogs: BeginDialogsSchema,
  /** ⑫ 开场白（ST first_mes/alternate_greetings）：切换到该角色时气泡随机一条（宏展开；不进 LLM 上下文、不落库，spec §6）。 */
  greetings: z.array(z.string().min(1).max(4000)).max(10).optional(),
  /** ⑭ 风格锚（ST post_history_instructions）：组装时以 system 消息插在 history 后（近生成点）。 */
  styleAnchor: z.string().min(1).max(2000).optional(),
});
export type PackPersona = z.infer<typeof PackPersonaSchema>;

export const CharacterManifestSchema = z
  .object({
    id: z.string().regex(CHARACTER_ID_RE),
    name: z.string().min(1),
    version: z.string().min(1),
    /** 双引擎二选一（§7）：vrm(three) / live2d(pixi, Cubism 4/5 moc3)。 */
    engine: z.enum(['vrm', 'live2d']),
    /** 包内相对路径（asset://<id>/<model> 的 path 部分）。 */
    model: z.string().refine(isSafeRelPath, { message: 'model must be a safe relative path' }),
    /** 情绪名 → VRM expression 权重组合；缺省用运行时内置表（live2d 忽略）。 */
    emotions: z
      .record(
        z.string().regex(NAME_RE),
        z.record(z.string().regex(NAME_RE), z.number().min(0).max(1)),
      )
      .optional(),
    /** 动作词表；缺省 DEFAULT_ACTIONS（persona-prompt-template）（live2d 忽略）。 */
    actions: z.array(z.string().regex(NAME_RE)).optional(),
    /** 交互 cue 覆盖表；按 on 与 DEFAULT_CUES 合并（包优先，F-IT-07）。 */
    cues: z.array(CueSchema).optional(),
    /** E1 卡片立绘（包内相对路径，asset:// 引用）；缺省首字占位。 */
    preview: z
      .string()
      .refine(isSafeRelPath, { message: 'preview must be a safe relative path' })
      .optional(),
    persona: PackPersonaSchema.optional(),
    /** ⑫ 世界书（ST character_book 最小子集）；命中注入 system「世界设定」块。 */
    lorebook: PackLorebookSchema.optional(),
    // --- 元数据（⑩.7 E2 信息区；全 optional 向后兼容）---
    author: z.string().min(1).optional(),
    description: z.string().optional(),
    license: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).max(20).optional(),
    /** 角色绑定音色（音色库 voiceId，F-VC-05）；生效序最优先（voice-config）。 */
    voice: z.string().min(1).optional(),
    /** Live2D：情绪名 → 表情名（.exp3.json 的 Name；单表情，无权重混合）。 */
    live2dEmotions: z.record(z.string().regex(NAME_RE), z.string().min(1)).optional(),
    /** Live2D：动作名 → motion 组(+序号)；缺省尝试同名组。 */
    live2dMotions: z
      .record(
        z.string().regex(NAME_RE),
        z.object({ group: z.string().min(1), index: z.number().int().nonnegative().optional() }),
      )
      .optional(),
  })
  .superRefine((m, ctx) => {
    if (m.engine === 'live2d' && !m.model.endsWith('.model3.json')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'live2d 角色的 model 必须指向 .model3.json 设置文件',
      });
    }
  });

export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;
