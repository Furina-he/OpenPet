/**
 * ⑩.7 E4 编辑器草稿态纯逻辑（SFC 薄渲染）：
 * 草稿 = manifest 深克隆（表单直接改）；normalizeDraft 收口成合法 manifest 形状
 * （trim/空值删除）；isDirty 按规范化后比对；validateDraft 只做客户端速查，
 * Zod 全校验与 id/engine/model 不可变断言在 Main（character-service.updateManifest）。
 */
import {
  CODEX_DEFAULT_MAPPING,
  DEFAULT_ACTIONS,
  DEFAULT_EMOTIONS,
  SpriteResolveError,
  resolveSprite,
  type CharacterManifest,
  type SpriteSheet,
  type SpriteSlotKey,
} from '@openpet/protocol';
import { ACTION_NAMES } from '../character/actions';

export type EditorDraft = CharacterManifest;

export function cloneManifest(m: CharacterManifest): EditorDraft {
  return JSON.parse(JSON.stringify(m)) as EditorDraft;
}

const trimOrDrop = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/** 规范化草稿 → 可提交 manifest：trim、空 optional/空数组/空对象删除。 */
export function normalizeDraft(d: EditorDraft): CharacterManifest {
  const out: CharacterManifest = {
    id: d.id,
    name: d.name.trim(),
    version: d.version.trim(),
    engine: d.engine,
    model: d.model,
  };
  const author = trimOrDrop(d.author);
  if (author) out.author = author;
  const description = trimOrDrop(d.description);
  if (description) out.description = description;
  const license = trimOrDrop(d.license);
  if (license) out.license = license;
  const tags = (d.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tags.length > 0) out.tags = tags;
  const preview = trimOrDrop(d.preview);
  if (preview) out.preview = preview;
  const voice = trimOrDrop(d.voice);
  if (voice) out.voice = voice;
  if (d.persona && d.persona.systemPrompt.trim()) {
    out.persona = {
      systemPrompt: d.persona.systemPrompt.trim(),
      beginDialogs: d.persona.beginDialogs.map((s) => s.trim()),
    };
    // ⑭ 风格锚：E4 不编辑但必须原样保留（否则保存即丢）。
    const styleAnchor = trimOrDrop(d.persona.styleAnchor);
    if (styleAnchor) out.persona.styleAnchor = styleAnchor;
    // ⑫ 开场白：丢空串；空数组收敛为 undefined。
    const greetings = (d.persona.greetings ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    if (greetings.length > 0) out.persona.greetings = greetings;
  }
  // ⑫ 世界书：丢空 content 条目 + keys trim；空 entries 收敛（整个 lorebook 删除）。
  if (d.lorebook) {
    const entries = d.lorebook.entries
      .map((e) => ({
        ...e,
        content: e.content.trim(),
        keys: e.keys.map((k) => k.trim()).filter((k) => k.length > 0),
      }))
      .filter((e) => e.content.length > 0);
    if (entries.length > 0) out.lorebook = { ...d.lorebook, entries };
  }
  if (d.emotions && Object.keys(d.emotions).length > 0) out.emotions = d.emotions;
  if (d.live2dEmotions && Object.keys(d.live2dEmotions).length > 0)
    out.live2dEmotions = d.live2dEmotions;
  if (d.actions && d.actions.length > 0) out.actions = d.actions;
  if (d.live2dMotions && Object.keys(d.live2dMotions).length > 0)
    out.live2dMotions = d.live2dMotions;
  // ⑱ VRMA 片段 / ⑳ 帧动画图集：E4 不改几何，原样保留（sprite 映射经 normalizeSprite 收敛）。
  if (d.actionClips && Object.keys(d.actionClips).length > 0) out.actionClips = d.actionClips;
  if (d.sprite) out.sprite = normalizeSprite(d.sprite);
  if (d.cues && d.cues.length > 0) {
    out.cues = d.cues.map((c) => {
      const say = (c.say ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
      return {
        on: c.on,
        ...(c.emotion ? { emotion: c.emotion } : {}),
        ...(c.action ? { action: c.action } : {}),
        ...(say.length > 0 ? { say } : {}),
        ...(c.cooldownMs !== undefined ? { cooldownMs: c.cooldownMs } : {}),
        ...(c.probability !== undefined ? { probability: c.probability } : {}),
        ...(c.proactive !== undefined ? { proactive: c.proactive } : {}),
      };
    });
  }
  return out;
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return val;
  });
}

export function isDirty(original: CharacterManifest, draft: EditorDraft): boolean {
  return stableStringify(normalizeDraft(cloneManifest(original))) !== stableStringify(normalizeDraft(draft));
}

/** 词表名形状（同 character-manifest 的 NAME_RE；那边未导出，此处仅客户端速查）。 */
const NAME_RE = /^[a-zA-Z][\w-]*$/;

/** 客户端速查：字段名 → i18n key（settings.editor.errors.*）。 */
export function validateDraft(d: EditorDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!d.name.trim()) errs['name'] = 'settings.editor.errors.nameRequired';
  if (!d.version.trim()) errs['version'] = 'settings.editor.errors.versionRequired';
  const tags = (d.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > 20) errs['tags'] = 'settings.editor.errors.tagsTooMany';
  for (const [emo, weights] of Object.entries(d.emotions ?? {})) {
    if (!NAME_RE.test(emo)) errs['emotions'] = 'settings.editor.errors.vocabName';
    for (const [expr, w] of Object.entries(weights)) {
      if (!NAME_RE.test(expr)) errs['emotions'] = 'settings.editor.errors.vocabName';
      if (typeof w !== 'number' || Number.isNaN(w) || w < 0 || w > 1) {
        errs['emotions'] = 'settings.editor.errors.emotionWeight';
      }
    }
  }
  for (const emo of Object.keys(d.live2dEmotions ?? {})) {
    if (!NAME_RE.test(emo)) errs['emotions'] = 'settings.editor.errors.vocabName';
  }
  if ((d.actions ?? []).some((a) => !NAME_RE.test(a)))
    errs['actions'] = 'settings.editor.errors.vocabName';
  for (const key of Object.keys(d.live2dMotions ?? {})) {
    if (!NAME_RE.test(key)) errs['actions'] = 'settings.editor.errors.vocabName';
  }
  if (d.engine === 'sprite') {
    try {
      if (!d.sprite) throw new SpriteResolveError('missing sprite');
      resolveSprite(normalizeSprite(d.sprite));
    } catch (e) {
      if (!(e instanceof SpriteResolveError)) throw e;
      errs['sprite'] = 'settings.editor.errors.spriteInvalid';
    }
  }
  return errs;
}

// ---- ⑳ 帧动画映射编辑（草稿只存作者原文；预设展开归 resolveSprite）----

/** 深拷贝 + 空 emotions / actions / slots / states 剥离；`null`（删除预设）保留。 */
export function normalizeSprite(s: SpriteSheet): SpriteSheet {
  const out = JSON.parse(JSON.stringify(s)) as SpriteSheet;
  if (out.emotions && Object.keys(out.emotions).length === 0) delete out.emotions;
  if (out.actions && Object.keys(out.actions).length === 0) delete out.actions;
  if (out.states && Object.keys(out.states).length === 0) delete out.states;
  if (out.slots) {
    for (const k of Object.keys(out.slots) as SpriteSlotKey[]) {
      if (!out.slots[k]) delete out.slots[k];
    }
    if (Object.keys(out.slots).length === 0) delete out.slots;
  }
  return out;
}

const presetOf = <T>(s: SpriteSheet, table: Record<string, T>, name: string): T | undefined =>
  s.layout === 'codex' ? table[name] : undefined;

/** 编辑表的情绪行：默认词表 + 当前生效映射 + 作者原文（含 null 删除项），去重保序。 */
export function spriteEmotionNames(s: SpriteSheet): string[] {
  const preset = s.layout === 'codex' ? Object.keys(CODEX_DEFAULT_MAPPING.emotions) : [];
  return [...new Set([...DEFAULT_EMOTIONS, ...preset, ...Object.keys(s.emotions ?? {})])];
}

/** 编辑表的动作行：程序化动作全集（含系统 cue 词）+ 预设 + 作者原文。 */
export function spriteActionNames(s: SpriteSheet): string[] {
  const preset = s.layout === 'codex' ? Object.keys(CODEX_DEFAULT_MAPPING.actions) : [];
  return [...new Set([...DEFAULT_ACTIONS, ...ACTION_NAMES, ...preset, ...Object.keys(s.actions ?? {})])];
}

export interface SpriteEmotionValue {
  loop?: string;
  enter?: string;
  speed?: number;
}

/**
 * 设情绪映射（写作者原文）：与预设相同 → 删键（继承预设）；清空且有预设 → `null`（删除预设）；
 * 清空且无预设 → 删键。speed 1 视为缺省。
 */
export function setSpriteEmotion(s: SpriteSheet, name: string, v: SpriteEmotionValue | null): void {
  const loop = v?.loop || undefined;
  const enter = v?.enter || undefined;
  const speed = v?.speed !== undefined && v.speed !== 1 ? v.speed : undefined;
  const rec = (s.emotions ??= {});
  const preset = presetOf(s, CODEX_DEFAULT_MAPPING.emotions, name);
  if (!loop && !enter) {
    if (preset) rec[name] = null;
    else delete rec[name];
    return;
  }
  const same =
    preset !== undefined &&
    preset.loop === loop &&
    preset.enter === enter &&
    (preset.speed === 1 ? undefined : preset.speed) === speed;
  if (same) {
    delete rec[name];
    return;
  }
  rec[name] = {
    ...(loop ? { loop } : {}),
    ...(enter ? { enter } : {}),
    ...(speed !== undefined ? { speed } : {}),
  };
}

/** 设动作映射：state 空 = 程序化（有预设则写 null）；与预设相同 → 删键。 */
export function setSpriteAction(s: SpriteSheet, name: string, state: string | null): void {
  const rec = (s.actions ??= {});
  const preset = presetOf(s, CODEX_DEFAULT_MAPPING.actions, name);
  if (!state) {
    if (preset) rec[name] = null;
    else delete rec[name];
    return;
  }
  if (preset === state) delete rec[name];
  else rec[name] = state;
}

/** 设槽位：空 / 与预设相同 → 删键（继承预设）。 */
export function setSpriteSlot(s: SpriteSheet, key: SpriteSlotKey, state: string | null): void {
  const slots = (s.slots ??= {});
  const preset = presetOf(s, CODEX_DEFAULT_MAPPING.slots, key);
  if (!state || preset === state) delete slots[key];
  else slots[key] = state;
}
