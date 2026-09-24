/**
 * ⑳ 2D 帧动画引擎（`engine: 'sprite'`）的图集描述——manifest / body.json 的 `sprite` 字段（归肉体）。
 *
 * 图集 = 一张 .png / .webp，按「格」切分；状态 = 一行内连续格（不跨行）。`layout: 'codex'` 原生兼容
 * Codex Pets 契约（8 列 × 9 行、格 192×208、9 个状态行、官方逐帧时长，真源 = openai/skills 的
 * hatch-pet `references/animation-rows.md`）；`custom` 由作者自定格与行。
 *
 * schema 只存作者原文（不挂 zod default）：换形象 / 编辑器写回时 manifest 保持作者写的样子；
 * 默认值与预设展开统一在 `resolveSprite` 里做，运行时与 Hub 读同一份展开结果。
 */
import { z } from 'zod';

/** 状态 / 情绪 / 动作名（与 manifest 词表同形；允许 `running-left` 这类连字符名）。 */
export const SPRITE_NAME_RE = /^[a-zA-Z][\w-]*$/;
const Name = z.string().regex(SPRITE_NAME_RE);

export const SPRITE_FRAME_MS = { min: 16, max: 5000 } as const;
export const SPRITE_SPEED = { min: 0.25, max: 4 } as const;
const FrameMs = z.number().min(SPRITE_FRAME_MS.min).max(SPRITE_FRAME_MS.max);

export const SpriteStateSchema = z
  .object({
    row: z.number().int().min(0).max(255),
    /** 起始列（默认 0）。 */
    col: z.number().int().min(0).max(255).optional(),
    frames: z.number().int().min(1).max(256),
    /** 单个数 = 每帧均匀；数组 = 逐帧（长度须 = frames）。 */
    durationsMs: z.union([FrameMs, z.array(FrameMs).min(1)]),
    /** 默认 true；false = 一次性行（播一轮）。 */
    loop: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    if (Array.isArray(s.durationsMs) && s.durationsMs.length !== s.frames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationsMs'],
        message: `durationsMs 数组长度（${s.durationsMs.length}）必须等于 frames（${s.frames}）`,
      });
    }
  });
export type SpriteState = z.infer<typeof SpriteStateSchema>;

/** 情绪 → 帧行：loop = 持续行；enter = 进入时先播一轮；speed = 播放倍速。 */
export const SpriteEmotionMapSchema = z
  .object({
    loop: Name.optional(),
    enter: Name.optional(),
    speed: z.number().min(SPRITE_SPEED.min).max(SPRITE_SPEED.max).optional(),
  })
  .refine((e) => e.loop !== undefined || e.enter !== undefined, {
    message: '情绪映射至少要有 loop 或 enter 之一',
  });
export type SpriteEmotionMap = z.infer<typeof SpriteEmotionMapSchema>;

export const SpriteSlotsSchema = z.object({
  idle: Name.optional(),
  idleLow: Name.optional(),
  idleHigh: Name.optional(),
  talk: Name.optional(),
  dragLeft: Name.optional(),
  dragRight: Name.optional(),
});
export type SpriteSlots = z.infer<typeof SpriteSlotsSchema>;
export const SPRITE_SLOT_KEYS = ['idle', 'idleLow', 'idleHigh', 'talk', 'dragLeft', 'dragRight'] as const;
export type SpriteSlotKey = (typeof SPRITE_SLOT_KEYS)[number];

const CellDim = z.number().int().min(8).max(1024);

export const SpriteSheetSchema = z.object({
  /** codex = 8×9 契约自动展开；custom（默认）须给 cell + states + slots.idle。 */
  layout: z.enum(['codex', 'custom']).optional(),
  /** 格尺寸；codex 缺省 = 图尺寸 ÷ (8, 9)（兼容 2× 高清图集）。 */
  cell: z.object({ width: CellDim, height: CellDim }).optional(),
  /** 状态表；同名覆盖预设。 */
  states: z.record(Name, SpriteStateSchema).optional(),
  /** 情绪映射；`null` = 删除预设映射（该情绪退回程序化）。 */
  emotions: z.record(Name, SpriteEmotionMapSchema.nullable()).optional(),
  /** 动作映射；映射到行 = 播该行，未映射 = 程序化曲线；`null` = 删除预设。 */
  actions: z.record(Name, Name.nullable()).optional(),
  slots: SpriteSlotsSchema.optional(),
  /** pixel = 最近邻 + 原生分辨率变换；smooth（默认）= 线性过滤。 */
  smoothing: z.enum(['pixel', 'smooth']).optional(),
  /** contain（默认）/ integer = 不超过 contain 的最大整数倍。 */
  fit: z.enum(['contain', 'integer']).optional(),
  /** 素材朝向（默认 front）。 */
  facing: z.enum(['front', 'left', 'right']).optional(),
  /** 仅 facing≠front：鼠标在背后一侧 → 水平翻转（默认 false）。 */
  flipToCursor: z.boolean().optional(),
  /** 程序化底噪（呼吸 / 微噪 / 重心；默认 true）。 */
  proceduralLife: z.boolean().optional(),
});
export type SpriteSheet = z.infer<typeof SpriteSheetSchema>;

// ---- codex 预设（与官方 animation-rows.md 逐字一致）----

const repeatThen = (n: number, ms: number, last: number): number[] => [
  ...Array.from({ length: n - 1 }, () => ms),
  last,
];

export interface ResolvedSpriteState {
  row: number;
  col: number;
  frames: number;
  /** 已展开为逐帧（长度 = frames）。 */
  durationsMs: number[];
  loop: boolean;
}

export const CODEX_LAYOUT: {
  columns: number;
  rows: number;
  cell: { width: number; height: number };
  sheet: { width: number; height: number };
  states: Record<string, ResolvedSpriteState>;
} = {
  columns: 8,
  rows: 9,
  cell: { width: 192, height: 208 },
  sheet: { width: 1536, height: 1872 },
  states: {
    idle: { row: 0, col: 0, frames: 6, durationsMs: [280, 110, 110, 140, 140, 320], loop: true },
    'running-right': { row: 1, col: 0, frames: 8, durationsMs: repeatThen(8, 120, 220), loop: true },
    'running-left': { row: 2, col: 0, frames: 8, durationsMs: repeatThen(8, 120, 220), loop: true },
    waving: { row: 3, col: 0, frames: 4, durationsMs: repeatThen(4, 140, 280), loop: false },
    jumping: { row: 4, col: 0, frames: 5, durationsMs: repeatThen(5, 140, 280), loop: false },
    failed: { row: 5, col: 0, frames: 8, durationsMs: repeatThen(8, 140, 240), loop: true },
    waiting: { row: 6, col: 0, frames: 6, durationsMs: repeatThen(6, 150, 260), loop: true },
    running: { row: 7, col: 0, frames: 6, durationsMs: repeatThen(6, 120, 220), loop: true },
    review: { row: 8, col: 0, frames: 6, durationsMs: repeatThen(6, 150, 280), loop: true },
  },
};

export interface ResolvedEmotionMap {
  loop?: string;
  enter?: string;
  speed: number;
}

/** codex 预设默认映射（openpet 语义 ↔ Codex 状态，spec §2.2）。 */
export const CODEX_DEFAULT_MAPPING: {
  emotions: Record<string, ResolvedEmotionMap>;
  actions: Record<string, string>;
  slots: Partial<Record<SpriteSlotKey, string>>;
} = {
  emotions: {
    thinking: { loop: 'review', speed: 1 },
    sad: { loop: 'failed', speed: 1 },
    confused: { enter: 'failed', speed: 1 },
    curious: { loop: 'waiting', speed: 1 },
    happy: { enter: 'jumping', speed: 1 },
    surprised: { enter: 'jumping', speed: 1 },
    sleepy: { loop: 'idle', speed: 0.6 },
  },
  actions: { searching: 'running', droop: 'failed', wave: 'waving', jump: 'jumping' },
  slots: { idle: 'idle', dragLeft: 'running-left', dragRight: 'running-right' },
};

// ---- 展开 ----

export interface ResolvedSprite {
  layout: 'codex' | 'custom';
  /** null = codex 未显式给格 → 由图尺寸 ÷ (8, 9) 求（frameRects）。 */
  cell: { width: number; height: number } | null;
  states: Record<string, ResolvedSpriteState>;
  emotions: Record<string, ResolvedEmotionMap>;
  actions: Record<string, string>;
  slots: { idle: string } & Partial<Record<Exclude<SpriteSlotKey, 'idle'>, string>>;
  smoothing: 'pixel' | 'smooth';
  fit: 'contain' | 'integer';
  facing: 'front' | 'left' | 'right';
  flipToCursor: boolean;
  proceduralLife: boolean;
}

export class SpriteResolveError extends Error {
  constructor(
    message: string,
    readonly path: (string | number)[] = [],
  ) {
    super(message);
    this.name = 'SpriteResolveError';
  }
}

/** 单个数 → 逐帧数组。 */
export function durationsOf(state: Pick<SpriteState, 'frames' | 'durationsMs'>): number[] {
  const d = state.durationsMs;
  return Array.isArray(d) ? [...d] : Array.from({ length: state.frames }, () => d);
}

function resolveState(s: SpriteState): ResolvedSpriteState {
  return {
    row: s.row,
    col: s.col ?? 0,
    frames: s.frames,
    durationsMs: durationsOf(s),
    loop: s.loop ?? true,
  };
}

/**
 * 预设展开 + 作者覆盖合并 + `null` 删除 + 映射目标存在性校验。
 * 非法（custom 缺格 / 缺状态 / 缺 idle 槽，或映射指向不存在的状态）→ 抛 `SpriteResolveError`。
 */
export function resolveSprite(sheet: SpriteSheet): ResolvedSprite {
  const layout = sheet.layout ?? 'custom';
  const codex = layout === 'codex';
  if (!codex) {
    if (!sheet.cell) throw new SpriteResolveError('custom 布局必须给 cell', ['cell']);
    if (!sheet.states || Object.keys(sheet.states).length === 0) {
      throw new SpriteResolveError('custom 布局必须给 states', ['states']);
    }
    if (!sheet.slots?.idle) throw new SpriteResolveError('custom 布局必须给 slots.idle', ['slots', 'idle']);
  }

  const states: Record<string, ResolvedSpriteState> = {};
  if (codex) {
    for (const [k, v] of Object.entries(CODEX_LAYOUT.states)) {
      states[k] = { ...v, durationsMs: [...v.durationsMs] };
    }
  }
  for (const [k, v] of Object.entries(sheet.states ?? {})) states[k] = resolveState(v);

  const emotions: Record<string, ResolvedEmotionMap> = {};
  if (codex) {
    for (const [k, v] of Object.entries(CODEX_DEFAULT_MAPPING.emotions)) emotions[k] = { ...v };
  }
  for (const [k, v] of Object.entries(sheet.emotions ?? {})) {
    if (v === null) {
      delete emotions[k];
      continue;
    }
    emotions[k] = {
      ...(v.loop !== undefined ? { loop: v.loop } : {}),
      ...(v.enter !== undefined ? { enter: v.enter } : {}),
      speed: v.speed ?? 1,
    };
  }

  const actions: Record<string, string> = codex ? { ...CODEX_DEFAULT_MAPPING.actions } : {};
  for (const [k, v] of Object.entries(sheet.actions ?? {})) {
    if (v === null) delete actions[k];
    else actions[k] = v;
  }

  const slotSrc: Partial<Record<SpriteSlotKey, string>> = codex ? { ...CODEX_DEFAULT_MAPPING.slots } : {};
  for (const key of SPRITE_SLOT_KEYS) {
    const v = sheet.slots?.[key];
    if (v !== undefined) slotSrc[key] = v;
  }
  const idle = slotSrc.idle;
  if (idle === undefined) throw new SpriteResolveError('缺少 slots.idle', ['slots', 'idle']);
  const slots: ResolvedSprite['slots'] = { idle };
  for (const key of SPRITE_SLOT_KEYS) {
    const v = slotSrc[key];
    if (key !== 'idle' && v !== undefined) slots[key] = v;
  }

  // 映射目标必须存在
  const need = (target: string, path: (string | number)[]): void => {
    if (!(target in states)) {
      throw new SpriteResolveError(`映射目标状态「${target}」不存在`, path);
    }
  };
  for (const [k, e] of Object.entries(emotions)) {
    if (e.loop !== undefined) need(e.loop, ['emotions', k, 'loop']);
    if (e.enter !== undefined) need(e.enter, ['emotions', k, 'enter']);
  }
  for (const [k, s] of Object.entries(actions)) need(s, ['actions', k]);
  for (const [k, s] of Object.entries(slots)) need(s, ['slots', k]);

  return {
    layout,
    cell: sheet.cell ? { ...sheet.cell } : null,
    states,
    emotions,
    actions,
    slots,
    smoothing: sheet.smoothing ?? 'smooth',
    fit: sheet.fit ?? 'contain',
    facing: sheet.facing ?? 'front',
    flipToCursor: sheet.flipToCursor ?? false,
    proceduralLife: sheet.proceduralLife ?? true,
  };
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteFrames {
  cell: { width: number; height: number };
  columns: number;
  rows: number;
  /** 每状态的帧矩形（越界帧已丢弃；durations 同步截断）。 */
  states: Record<string, { rects: FrameRect[]; durationsMs: number[]; loop: boolean }>;
  warnings: string[];
}

/**
 * 切帧（纯函数）：codex 未给格 → 图尺寸 ÷ (8, 9)；越界帧丢弃并记 warning
 * （`col + frames ≤ 列数` 需要图宽，归运行时）。比例不符只 warn 照常播放。
 */
export function frameRects(resolved: ResolvedSprite, sheetW: number, sheetH: number): SpriteFrames {
  const warnings: string[] = [];
  let cell = resolved.cell;
  if (!cell) {
    cell = {
      width: Math.floor(sheetW / CODEX_LAYOUT.columns),
      height: Math.floor(sheetH / CODEX_LAYOUT.rows),
    };
    if (sheetW % CODEX_LAYOUT.columns !== 0 || sheetH % CODEX_LAYOUT.rows !== 0) {
      warnings.push(`图集 ${sheetW}×${sheetH} 不能被 8×9 整除，按 ${cell.width}×${cell.height} 取格`);
    }
    if (sheetW * CODEX_LAYOUT.sheet.height !== sheetH * CODEX_LAYOUT.sheet.width) {
      warnings.push(`图集比例 ${sheetW}:${sheetH} 与 Codex 契约 1536:1872 不符`);
    }
  }
  const columns = cell.width > 0 ? Math.floor(sheetW / cell.width) : 0;
  const rows = cell.height > 0 ? Math.floor(sheetH / cell.height) : 0;
  const states: SpriteFrames['states'] = {};
  for (const [name, s] of Object.entries(resolved.states)) {
    const rects: FrameRect[] = [];
    const durationsMs: number[] = [];
    for (let i = 0; i < s.frames; i++) {
      const c = s.col + i;
      if (s.row >= rows || c >= columns) continue;
      rects.push({ x: c * cell.width, y: s.row * cell.height, w: cell.width, h: cell.height });
      durationsMs.push(s.durationsMs[i] ?? s.durationsMs[s.durationsMs.length - 1] ?? 100);
    }
    if (rects.length < s.frames) {
      warnings.push(`状态「${name}」越界：${s.frames} 帧中 ${s.frames - rects.length} 帧超出图集，已丢弃`);
    }
    states[name] = { rects, durationsMs, loop: s.loop };
  }
  return { cell, columns, rows, states, warnings };
}

/** 作者在 `sprite.emotions` / `sprite.actions` 里显式声明（非 null）的映射键——进 LLM 词表（vocabOf）。 */
export function spriteDeclaredVocab(sheet: SpriteSheet | undefined): {
  emotions: string[];
  actions: string[];
} {
  const keep = (r: Record<string, unknown> | undefined): string[] =>
    Object.entries(r ?? {})
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
  return { emotions: keep(sheet?.emotions), actions: keep(sheet?.actions) };
}
