/**
 * ⑩.7 E4 编辑器草稿态纯逻辑（SFC 薄渲染）：
 * 草稿 = manifest 深克隆（表单直接改）；normalizeDraft 收口成合法 manifest 形状
 * （trim/空值删除）；isDirty 按规范化后比对；validateDraft 只做客户端速查，
 * Zod 全校验与 id/engine/model 不可变断言在 Main（character-service.updateManifest）。
 */
import type { CharacterManifest } from '@openpet/protocol';

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
  return errs;
}
