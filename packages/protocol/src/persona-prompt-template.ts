/**
 * Persona 系统提示的「行为标签」注入段（tech-design §4.1 System Prompt 注入策略）。
 *
 * M3 只负责把模板收口进 protocol 包；M6 ContextAssembler 组装 system prompt 时
 * 按角色包的实际表情/动作词表调用 buildBehaviorPrompt。few-shot 示例导出为常量，
 * 测试用它喂回 BehaviorParser 做自洽校验——模板与解析器永不漂移。
 *
 * 注意：<say:.../> 是 V1+ 语音标签，解析器支持但消费端丢弃（stub），
 * 模板刻意不教——教了只会让模型输出被静默吞掉的标签。
 */
import { BEHAVIOR_LIMITS } from './behavior-parser.js';
import { moodBand } from './mood.js';
import type { PersonaStateBlob } from './state.js';
import type { CharacterManifest } from './character-manifest.js';
import { spriteDeclaredVocab } from './sprite-body.js';

export interface BehaviorPromptOptions {
  /** 角色可用的表情名（VRM BlendShape，由角色包提供；缺省 8 基础表情）。 */
  emotions?: readonly string[];
  /** 角色可用的动作 clip 名。 */
  actions?: readonly string[];
}

export const DEFAULT_EMOTIONS: readonly string[] = [
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'shy',
  'curious',
  'sleepy',
];

export const DEFAULT_ACTIONS: readonly string[] = [
  'wave',
  'nod',
  'shake',
  'fidget',
  'stretch',
  'sigh',
  'jump',
  'tilt',
];

/**
 * ⑳ 角色词表唯一真源（Main 组 prompt / 表情兜底 / 试讲，渲染端 listEmotions/listActions 同源）。
 * - vrm / live2d：`emotions 键 ?? DEFAULT_EMOTIONS`、`actions ?? DEFAULT_ACTIONS`（与本批前逐字一致）；
 * - sprite：默认词表 ∪ 作者在 `sprite.emotions/actions` 显式声明的映射键——程序化兜底保证默认词表全部
 *   有表现；预设映射里的系统 cue 专用词（thinking/confused/searching/droop）不进 LLM 词表。
 */
export function vocabOf(
  m: Pick<CharacterManifest, 'engine' | 'emotions' | 'actions' | 'sprite'>,
): { emotions: readonly string[]; actions: readonly string[] } {
  if (m.engine === 'sprite') {
    const declared = spriteDeclaredVocab(m.sprite);
    return {
      emotions: [...new Set([...DEFAULT_EMOTIONS, ...declared.emotions])],
      actions: [...new Set([...DEFAULT_ACTIONS, ...declared.actions])],
    };
  }
  return {
    emotions: m.emotions ? Object.keys(m.emotions) : DEFAULT_EMOTIONS,
    actions: m.actions ?? DEFAULT_ACTIONS,
  };
}

/** few-shot 示例（与 tech-design §4.1 示例同源）；必须能被 BehaviorParser 零告警解析。 */
export const BEHAVIOR_FEWSHOTS: readonly string[] = [
  '[intent mood=shy energy=low]\n嗯……<emo:shy/>我在想，<act:fidget dur=1800/>要不要请你喝杯热可可？<emo:happy/>',
  '[intent mood=happy energy=high]\n真的吗！<emo:happy/><act:jump/>太好了！<wait ms=400/>那我们现在就开始吧！',
];

/** 生成嵌入 Persona system prompt 的行为标签规约 + few-shot 段落。 */
export function buildBehaviorPrompt(opts: BehaviorPromptOptions = {}): string {
  const emotions = opts.emotions ?? DEFAULT_EMOTIONS;
  const actions = opts.actions ?? DEFAULT_ACTIONS;
  return [
    '## 行为标签（可选）',
    '',
    '你可以在回复中嵌入以下标签，让你的桌面形象随文字实时做出表情和动作。不使用任何标签也完全可以。',
    '',
    '- 回复最开头（任何正文之前）可以声明本次回复的基调：`[intent mood=心情 energy=low|mid|high]`，每条回复至多一次、只能放在最前面。',
    `- \`<emo:名字/>\` 或 \`<emo:名字 w=0.7/>\`：切换表情；w 是 0~${BEHAVIOR_LIMITS.emotionWeightMax} 的强度，省略时为 1。可用表情：${emotions.join(', ')}。`,
    `- \`<act:名字/>\` 或 \`<act:名字 dur=1500/>\`：播放一个动作；dur 是毫秒，最长 ${BEHAVIOR_LIMITS.actionDurationMaxMs}，省略时用动画自身长度。可用动作：${actions.join(', ')}。`,
    `- \`<wait ms=500/>\`：让文字停顿一下再继续，最长 ${BEHAVIOR_LIMITS.waitMaxMs} 毫秒。`,
    '- 标签必须独立完整地写出，不要嵌套、不要写成对的开闭标签、不要发明新标签。',
    '',
    '### 示例',
    '',
    ...BEHAVIOR_FEWSHOTS.flatMap((shot) => [shot, '']),
  ].join('\n');
}

/** ⑱ mood 三档 → 语气句（system prompt 中文口径同现有；neutral 不加）。 */
export const MOOD_SENTENCES = {
  high: '你现在心情不错，语气可以更轻快',
  low: '你现在有点低落，语气可以更慢、更收敛，但不要抱怨',
} as const;

export function moodSentence(moodValue: number | undefined): string | null {
  if (moodValue === undefined || !Number.isFinite(moodValue)) return null;
  const band = moodBand(moodValue);
  return band === 'neutral' ? null : MOOD_SENTENCES[band];
}

export interface SystemPromptOptions {
  name: string;
  /** 角色当前 persona state（亲密度/上次情绪）；缺省不注入「关系记忆」段。 */
  persona?: PersonaStateBlob;
  /** ⑱ 当前心情 [-1,1]（MoodState.current()）；三档非 neutral 时在【关系记忆】追加语气句。 */
  moodValue?: number;
  /** §6 用户自定义人设正文；缺省用内置一句。行为标签规约/关系记忆段不受影响（桌宠边界）。 */
  personaPrompt?: string;
  emotions?: readonly string[];
  actions?: readonly string[];
}

/**
 * 组装注入 ChatRequest 的 system prompt（M6 ContextAssembler 调用）：
 * 人设正文（§6 自定义或内置一句）+ persona 摘要（可选）+ 行为标签规约 + few-shot（buildBehaviorPrompt）。
 * 输出整体可被 BehaviorParser 零告警解析（few-shot 与解析器同源）。
 */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const intro =
    opts.personaPrompt && opts.personaPrompt.trim().length > 0
      ? opts.personaPrompt.trim()
      : `你是${opts.name}，用户的桌面 AI 伙伴。用自然、有温度的口吻陪伴用户。`;
  const parts: string[] = [intro];
  const mood = moodSentence(opts.moodValue);
  if (opts.persona) {
    const p = opts.persona;
    const bits = [`你与用户的亲密度 ${p.affinity}/100`, `已经互动了 ${p.turns} 轮`];
    if (p.lastMood) bits.push(`上次对话你的心情是「${p.lastMood}」`);
    if (mood) bits.push(mood);
    parts.push(`【关系记忆】${bits.join('，')}。`);
  } else if (mood) {
    parts.push(`【关系记忆】${mood}。`);
  }
  parts.push(
    buildBehaviorPrompt({
      ...(opts.emotions ? { emotions: opts.emotions } : {}),
      ...(opts.actions ? { actions: opts.actions } : {}),
    }),
  );
  return parts.join('\n\n');
}
