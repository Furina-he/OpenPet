/**
 * D5 音色工坊纯逻辑（向导草稿 ↔ VoiceProfile / 卡片 VM / 上传预检 / 绑定选项）；SFC 薄渲染。
 * 校验单一真源 = VoiceProfileSchema（draftToProfile 只做形状组装 + safeParse）。
 */
import {
  isMimoSource,
  VoiceProfileSchema,
  type ModelEntry,
  type ProviderSource,
  type VoiceEngine,
  type VoiceKind,
  type VoiceProfile,
} from '@openpet/protocol';

export const MAX_REF_AUDIO_BYTES = 10 * 1024 * 1024;

/** GPT-SoVITS 官方仓库（向导教程外链，经 app.openExternal）。 */
export const GSV_TUTORIAL_URL = 'https://github.com/RVC-Boss/GPT-SoVITS';

/** 快捷 chip 词表（设计 Tab 拼接进描述）。 */
export const STYLE_CHIPS = [
  '女声',
  '男声',
  '少女',
  '青年',
  '御姐',
  '低沉',
  '温柔',
  '元气',
  '慵懒',
  '沙哑',
] as const;
export const DIALECT_CHIPS = ['粤语', '四川话', '东北话', '上海话', '台湾腔'] as const;
/** openai 兼容端点常见音色名（预设 Tab chip）。 */
export const OPENAI_VOICE_CHIPS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export const MIMO_VOICE_CHIPS = ['mimo_default'] as const;

export interface VoiceCardVm {
  id: string;
  name: string;
  kind: VoiceKind;
  engine: VoiceEngine;
  isDefault: boolean;
  /** 卡片副标题：preset=voiceName / design=描述截断 / clone=参考来源。 */
  detail: string;
}

export function toCardVm(v: VoiceProfile, defaultId: string): VoiceCardVm {
  const detail =
    v.kind === 'preset'
      ? (v.voiceName ?? '')
      : v.kind === 'design'
        ? [v.stylePrompt, v.dialect].filter(Boolean).join(' · ')
        : (v.referenceId ?? v.refAudioFile ?? '');
  return { id: v.id, name: v.name, kind: v.kind, engine: v.engine, isDefault: v.id === defaultId, detail };
}

/** 默认音色置顶，其余保持创建序（稳定）。 */
export function sortCards(cards: VoiceCardVm[]): VoiceCardVm[] {
  return [...cards].sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
}

/** 向导草稿：三 Tab 共用 name，其余按 kind 分组；全字符串便于 v-model。 */
export interface WizardDraft {
  kind: VoiceKind;
  name: string;
  presetEngine: 'openai' | 'mimo';
  voiceName: string;
  /** 预设：显式绑定的 TTS 模型（model.models 条目 id；'' = 未选）。 */
  modelId: string;
  stylePrompt: string;
  dialect: string;
  seedText: string;
  /** 设计：显式绑定的 MiMo 源 id（'' = 未选）。 */
  sourceId: string;
  cloneEngine: 'gptsovits' | 'fishaudio';
  refText: string;
  /** voice.saveRefAudio 返回的暂存文件名；'' = 未上传/未录制。 */
  refAudioFile: string;
  referenceId: string;
}

export function emptyDraft(): WizardDraft {
  return {
    kind: 'preset',
    name: '',
    presetEngine: 'openai',
    voiceName: '',
    modelId: '',
    stylePrompt: '',
    dialect: '',
    seedText: '',
    sourceId: '',
    cloneEngine: 'gptsovits',
    refText: '',
    refAudioFile: '',
    referenceId: '',
  };
}

/** 按当前 Tab 组装 VoiceProfile（未保存草稿试听也用它；id 由调用方注入）。 */
export function draftToProfile(
  d: WizardDraft,
  newId: () => string,
): { ok: true; profile: VoiceProfile } | { ok: false; error: string } {
  const base = { id: newId(), name: d.name.trim(), kind: d.kind };
  const shape =
    d.kind === 'preset'
      ? {
          ...base,
          engine: d.presetEngine,
          voiceName: d.voiceName.trim() || undefined,
          modelId: d.modelId || undefined,
        }
      : d.kind === 'design'
        ? {
            ...base,
            engine: 'mimo',
            stylePrompt: d.stylePrompt.trim() || undefined,
            dialect: d.dialect.trim() || undefined,
            seedText: d.seedText.trim() || undefined,
            sourceId: d.sourceId || undefined,
          }
        : {
            ...base,
            engine: d.cloneEngine,
            refText: d.refText.trim() || undefined,
            refAudioFile: d.refAudioFile || undefined,
            referenceId:
              d.cloneEngine === 'fishaudio' && d.referenceId.trim()
                ? d.referenceId.trim()
                : undefined,
          };
  const parsed = VoiceProfileSchema.safeParse(shape);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first?.path.join('.') ?? ''}: ${first?.message ?? 'invalid'}` };
  }
  return { ok: true, profile: parsed.data };
}

/** chip 拼接：已含则不重复；空格分隔（MiMo style 内容以空格连接）。 */
export function appendChip(text: string, chip: string): string {
  if (text.includes(chip)) return text;
  const t = text.trimEnd();
  return t ? `${t} ${chip}` : chip;
}

/** 上传预检（前端提前给人话；服务端 saveRefAudio 同口径二次校验）。 */
export function validateRefUpload(name: string, size: number): 'type' | 'size' | null {
  if (!/\.(wav|mp3)$/i.test(name)) return 'type';
  if (size > MAX_REF_AUDIO_BYTES) return 'size';
  return null;
}

/** 生成音色 id（vp_ 前缀；注入随机源便于测试）。 */
export function newVoiceId(random: () => string = () => crypto.randomUUID()): string {
  return `vp_${random().replace(/-/g, '').slice(0, 12)}`;
}

// ---- 显式连接绑定（真窗反馈：只列可用项，选项即回答"用的什么模型"）----

const sourceLabel = (s: ProviderSource): string => s.name ?? s.id;

export interface TtsModelOption {
  value: string;
  label: string;
  /** 源是否 MiMo（决定预设的 voiceName chip 词表与协议）。 */
  mimo: boolean;
}

/** 预设 Tab 下拉：启用的 TTS 源下所有启用模型（源+模型任一停用即不出现）。 */
export function ttsModelOptions(
  sources: ProviderSource[],
  models: ModelEntry[],
): TtsModelOption[] {
  const ttsSources = new Map(
    sources.filter((s) => s.capability === 'tts' && s.enabled).map((s) => [s.id, s]),
  );
  return models
    .filter((m) => m.enabled && ttsSources.has(m.sourceId))
    .map((m) => {
      const s = ttsSources.get(m.sourceId)!;
      return { value: m.id, label: `${sourceLabel(s)} · ${m.model}`, mimo: isMimoSource(s) };
    });
}

/** 设计 Tab 下拉：仅 MiMo TTS 源（voicedesign 只有 MiMo 能跑）。 */
export function mimoSourceOptions(
  sources: ProviderSource[],
): Array<{ value: string; label: string }> {
  return sources
    .filter((s) => s.capability === 'tts' && s.enabled && isMimoSource(s))
    .map((s) => ({ value: s.id, label: sourceLabel(s) }));
}

/** 音色卡/向导状态行的绑定说明：这个音色实际会用哪个连接+模型。defaultLabel = i18n「默认 TTS」。 */
export function bindingLabel(
  v: Pick<VoiceProfile, 'kind' | 'engine' | 'modelId' | 'sourceId'>,
  sources: ProviderSource[],
  models: ModelEntry[],
  designModel: string,
  defaultLabel: string,
): string {
  if (v.kind === 'clone') return v.engine === 'gptsovits' ? 'GPT-SoVITS' : 'fish.audio';
  if (v.kind === 'design') {
    const s = v.sourceId ? sources.find((x) => x.id === v.sourceId) : undefined;
    return `${s ? sourceLabel(s) : defaultLabel} · ${designModel}`;
  }
  const m = v.modelId ? models.find((x) => x.id === v.modelId) : undefined;
  const s = m ? sources.find((x) => x.id === m.sourceId) : undefined;
  return m && s ? `${sourceLabel(s)} · ${m.model}` : defaultLabel;
}
