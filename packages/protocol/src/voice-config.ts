// ⑩.6 音色工坊（F-VC-05）：VoiceProfile 单一真源 + 生效序纯函数。
import { z } from 'zod';

export const VoiceEngineSchema = z.enum(['openai', 'mimo', 'gptsovits', 'fishaudio']);
export type VoiceEngine = z.infer<typeof VoiceEngineSchema>;

export const VoiceKindSchema = z.enum(['preset', 'design', 'clone']);
export type VoiceKind = z.infer<typeof VoiceKindSchema>;

/** fish.audio 平台模型 ID：32 位 hex（照 AstrBot fishaudio_tts_api_source 校验）。 */
export const FISHAUDIO_REFERENCE_ID_RE = /^[a-fA-F0-9]{32}$/;

/** MiMo（小米）源判别：具名模板带 icon:'mimo'；手填官方域名也识别（voice-service/工坊共用）。 */
export function isMimoSource(s: { icon?: string; apiBase: string }): boolean {
  return s.icon === 'mimo' || s.apiBase.includes('xiaomimimo.com');
}

/**
 * 音色档案（工坊页创建/管理；聊天朗读、试听、角色绑定都消费它）：
 *  - preset：现成音色名（openai alloy… / MiMo mimo_default…）；
 *  - design：MiMo voicedesign 文字描述设计（仅 engine=mimo）；
 *  - clone：参考音频克隆——gptsovits(本地 api_v2) / fishaudio(云端 references 或平台 referenceId)。
 * 参考音频文件存 userData/voices/<id>/，refAudioFile 只存文件名部分。
 */
export const VoiceProfileSchema = z
  .object({
    id: z.string().min(1), // vp_ 前缀 nanoid
    name: z.string().min(1),
    kind: VoiceKindSchema,
    engine: VoiceEngineSchema,
    // kind=preset
    voiceName: z.string().min(1).optional(),
    // kind=design（engine=mimo）
    stylePrompt: z.string().min(1).optional(),
    dialect: z.string().optional(),
    seedText: z.string().optional(),
    // kind=clone
    refText: z.string().min(1).optional(),
    refAudioFile: z.string().min(1).optional(),
    referenceId: z.string().regex(FISHAUDIO_REFERENCE_ID_RE).optional(),
    // 连接绑定（真窗反馈：显式选模型，不再只靠默认 TTS 隐式绑定）：
    // preset → modelId（model.models 条目 id）；design → sourceId（MiMo 源 id）。
    // 缺省或失效 → 回退 D3 默认 TTS 绑定（兼容旧音色）。
    modelId: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.kind === 'preset') {
      if (!v.voiceName) issue('voiceName', 'preset 音色必须提供 voiceName');
      if (v.engine !== 'openai' && v.engine !== 'mimo')
        issue('engine', 'preset 音色仅支持 openai / mimo 引擎');
    } else if (v.kind === 'design') {
      if (!v.stylePrompt) issue('stylePrompt', 'design 音色必须提供 stylePrompt');
      if (v.engine !== 'mimo') issue('engine', 'design 音色仅支持 mimo（voicedesign）引擎');
    } else {
      // clone：参考音频路线需 refAudioFile+refText；fishaudio 平台模型路线仅 referenceId
      if (v.engine !== 'gptsovits' && v.engine !== 'fishaudio')
        issue('engine', 'clone 音色仅支持 gptsovits / fishaudio 引擎');
      if (v.referenceId && v.engine !== 'fishaudio')
        issue('referenceId', 'referenceId 仅 fishaudio 支持');
      if (v.refAudioFile) {
        if (!v.refText) issue('refText', '参考音频必须配参考文本（克隆质量关键）');
      } else if (!(v.engine === 'fishaudio' && v.referenceId)) {
        issue('refAudioFile', 'clone 音色必须提供参考音频（或 fishaudio referenceId）');
      }
    }
  });
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

/** 生效序解析结果：命中音色库 / 旧 source.config.voice 兼容 / null=引擎缺省。 */
export type ResolvedVoice =
  | { via: 'character' | 'default'; profile: VoiceProfile }
  | { via: 'legacy'; voiceName: string };

/**
 * 音色生效序（spec §1）：角色 manifest.voice > voice.defaultVoiceId >
 * 旧 provider source config.voice（作 preset 名兜底）> null（引擎缺省）。
 * 空串/指向已删音色一律视为未设、降级下一层。
 */
export function resolveVoiceProfile(
  characterVoiceId: string | undefined,
  defaultVoiceId: string,
  voices: readonly VoiceProfile[],
  legacySourceVoice: string | undefined,
): ResolvedVoice | null {
  const find = (id: string | undefined): VoiceProfile | undefined =>
    id ? voices.find((v) => v.id === id) : undefined;
  const byCharacter = find(characterVoiceId);
  if (byCharacter) return { via: 'character', profile: byCharacter };
  const byDefault = find(defaultVoiceId);
  if (byDefault) return { via: 'default', profile: byDefault };
  if (legacySourceVoice) return { via: 'legacy', voiceName: legacySourceVoice };
  return null;
}
