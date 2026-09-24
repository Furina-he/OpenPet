import { z } from 'zod';
import { CueSchema } from './interaction-cues.js';
import { BeginDialogsSchema } from './persona-config.js';
import { PackLorebookSchema } from './lorebook.js';
import { SpriteResolveError, SpriteSheetSchema, resolveSprite, type SpriteSheet } from './sprite-body.js';

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

/**
 * 引擎相关约束（manifest 与 .dsbody 共用同一条）：
 * - live2d：model 必须指向 Cubism 设置文件；
 * - sprite（⑳）：`sprite` 必填、model 是 .png / .webp 图集、`resolveSprite` 展开通过
 *   （custom 缺格/状态/idle、映射指向不存在的状态 → 拒绝）。
 */
function refineEngineModel(
  m: { engine: 'vrm' | 'live2d' | 'sprite'; model: string; sprite?: SpriteSheet | undefined },
  ctx: z.RefinementCtx,
): void {
  if (m.engine === 'live2d' && !m.model.endsWith('.model3.json')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: 'live2d 角色的 model 必须指向 .model3.json 设置文件',
    });
  }
  if (m.engine !== 'sprite') return;
  if (!/\.(png|webp)$/i.test(m.model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: 'sprite 角色的 model 必须指向 .png / .webp 图集',
    });
  }
  if (!m.sprite) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sprite'],
      message: 'sprite 角色必须声明 sprite 图集描述',
    });
    return;
  }
  try {
    resolveSprite(m.sprite);
  } catch (e) {
    if (!(e instanceof SpriteResolveError)) throw e;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sprite', ...e.path], message: e.message });
  }
}

/**
 * manifest 字段真源（未挂 superRefine 的裸对象）——`BodyPackSchema` 由它 pick 派生，
 * 切分线测试也读它的 `.shape` 枚举全字段。业务代码请用 `CharacterManifestSchema`。
 */
export const CharacterManifestObjectSchema = z
  .object({
    id: z.string().regex(CHARACTER_ID_RE),
    name: z.string().min(1),
    version: z.string().min(1),
    /** 三引擎（§7）：vrm(three) / live2d(pixi, Cubism 4/5 moc3) / sprite(pixi, ⑳ 逐帧图集)。 */
    engine: z.enum(['vrm', 'live2d', 'sprite']),
    /** 包内相对路径（asset://<id>/<model> 的 path 部分）；sprite = 图集本身。 */
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
    /**
     * ⑱ VRMA 动画片段通道：动作名 → 包内 `.vrma` 相对路径。`playAction(name)` 命中则走
     * AnimationMixer，否则程序化曲线（零回归）；文件缺失/解析失败 warn + 回退，永不崩。
     */
    actionClips: z
      .record(
        z.string().regex(NAME_RE),
        z
          .string()
          .refine(isSafeRelPath, { message: 'actionClips entry must be a safe relative path' })
          .refine((p) => p.toLowerCase().endsWith('.vrma'), {
            message: 'actionClips entry must point to a .vrma file',
          }),
      )
      .optional(),
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
    /** ⑳ 帧动画图集描述（engine=sprite 必填；此时 emotions/actions/actionClips/live2d* 被忽略）。 */
    sprite: SpriteSheetSchema.optional(),
  });

export const CharacterManifestSchema = CharacterManifestObjectSchema.superRefine(refineEngineModel);

export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;

/**
 * ⑰ 灵魂 / 肉体切分线（唯一真源）——「一个角色 = 灵魂（怎么说话）+ 肉体（怎么动）+ 声音（怎么响）」。
 *
 * `composeFromDonor`（灵魂包安装）与 `swapBody`（换形象）是同一条线的正反两向操作，
 * 两处都必须读这里的常量，不许各写一份对照表。新增 manifest 字段必须归类到三者之一，
 * 否则 `character-manifest.test.ts` 的覆盖测试会红。
 */
/** 肉体字段：随形象包走（换形象即整组替换）。 */
export const BODY_FIELDS = [
  'engine',
  'model',
  'emotions',
  'actions',
  'actionClips',
  'cues',
  'live2dEmotions',
  'live2dMotions',
  'sprite',
  'preview',
] as const;
/** 灵魂字段：随角色本体走（换形象时原地保留；`voice` 是第三层「声音」，不随肉体变）。 */
export const SOUL_FIELDS = [
  'name',
  'version',
  'persona',
  'lorebook',
  'voice',
  'author',
  'description',
  'license',
  'tags',
] as const;
/** 身份字段：既非灵魂也非肉体——`id` 不变才有「换皮不换人」（记忆/会话按 id 索引）。 */
export const IDENTITY_FIELDS = ['id'] as const;

export type BodyField = (typeof BODY_FIELDS)[number];
export type SoulField = (typeof SOUL_FIELDS)[number];

/** 取子集且丢掉 undefined 键（exactOptionalPropertyTypes 下可直接展开进 parse）。 */
function pickDefined<T extends object, K extends keyof T>(
  src: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 肉体字段子集（来源可以是 manifest 也可以是 `.dsbody` 的 body.json）。 */
export function pickBodyFields(
  src: Partial<Pick<CharacterManifest, BodyField>>,
): Partial<Pick<CharacterManifest, BodyField>> {
  return pickDefined(src, BODY_FIELDS);
}

/** 灵魂字段子集。 */
export function pickSoulFields(
  src: Partial<Pick<CharacterManifest, SoulField>>,
): Partial<Pick<CharacterManifest, SoulField>> {
  return pickDefined(src, SOUL_FIELDS);
}

/** manifest → { body, soul } 两半（换形象 = 保留 soul + 换掉 body）。 */
export function splitManifest(m: CharacterManifest): {
  body: Partial<Pick<CharacterManifest, BodyField>>;
  soul: Partial<Pick<CharacterManifest, SoulField>>;
} {
  return { body: pickBodyFields(m), soul: pickSoulFields(m) };
}

/**
 * ⑰ `.dsbody` 肉体包根部 `body.json`（spec §1）——字段全部 pick 自 manifest，无新语义。
 * 装进 `userData/bodies/<id>`（不进角色列表：无灵魂的肉体不是可切换角色）。
 */
export const BodyPackSchema = CharacterManifestObjectSchema.pick({
  id: true,
  name: true,
  version: true,
  engine: true,
  model: true,
  emotions: true,
  actions: true,
  actionClips: true,
  cues: true,
  live2dEmotions: true,
  live2dMotions: true,
  sprite: true,
  preview: true,
  author: true,
  description: true,
  license: true,
  tags: true,
}).superRefine(refineEngineModel);

export type BodyPack = z.infer<typeof BodyPackSchema>;
