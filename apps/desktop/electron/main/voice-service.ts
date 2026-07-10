/**
 * F-VC 语音运行时（TTS/ASR）— Main 直调。
 *
 * TTS 四引擎（⑩.6 音色工坊，spec §3）：
 *  - openai 兼容：POST /audio/speech（voice/speed，二进制）；连接沿用 D3 TTS provider 绑定。
 *  - MiMo（小米）：多模态 /chat/completions（照 AstrBot mimo_tts_api_source）——
 *    preset = seed user + assistant 文本 + audio.voice；design = voicedesign 模型 +
 *    assistant `<style>描述 方言</style>` 前缀（唱歌特例）+ 可选 seedText user 轮。
 *  - GPT-SoVITS：本地 api_v2 POST {apiBase}/tts（ref_audio_path 传 userData 绝对路径）→ wav。
 *  - fish.audio：POST {apiBase}/v1/tts **msgpack**（references 内联参考音频 / reference_id）→ wav。
 * 音色生效序 = resolveVoiceProfile（角色 manifest.voice > 默认音色 > 旧 source.config.voice > 引擎缺省）。
 * STT 双协议不变（openai multipart / MiMo input_audio）。
 *
 * 为什么在 Main 而不进 provider worker：TTS/STT 是单次请求-响应（无流式背压/取消），
 * 且二进制音频过 worker fetch-proxy（面向 SSE 文本）有损坏风险；密钥本就在 Main 注入。
 * fetchImpl 由装配方注入（生产 = Electron net.fetch 适配，走系统代理；测试 = fake）。
 * 音频经 IPC 用 base64 string（Zod 可表达；单句 TTS 体积可接受）。
 */
import path from 'node:path';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import {
  resolveChatTarget,
  resolveVoiceProfile,
  VoiceProfileSchema,
  type Prefs,
  type ProviderSource,
  type VoiceProfile,
} from '@openpet/protocol';

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | FormData | Uint8Array;
  },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface VoiceServiceDeps {
  getPrefs: () => Prefs;
  broadcast: (channel: string, params: unknown) => void;
  /** 取某会话最后一条 assistant 干净文本（autoSpeak 用）；ipc-router 注入 store 读取闭包。 */
  lastAssistantText: (sessionId: string) => string | null;
  fetchImpl: FetchLike;
  /** 当前角色 manifest.voice（voiceId；ipc-router 闭包注入），生效序最优先。 */
  getActiveCharacterVoice: () => string | undefined;
  /** userData/voices 绝对根（gptsovits ref_audio_path 拼绝对路径用）。 */
  voicesDir: string;
  /** 参考音频文件存取（注入以便测试内存实现）；read 不存在返回 null。 */
  readVoiceFile: (id: string, file: string) => Buffer | null;
  writeVoiceFile: (id: string, file: string, data: Buffer) => void;
  moveVoiceFile: (fromId: string, file: string, toId: string) => void;
  removeVoiceDir: (id: string) => void;
}

interface VoiceTarget {
  apiBase: string;
  model: string;
  source: ProviderSource;
}

/** MiMo 判别：具名模板带 icon:'mimo'；手填官方域名也识别。provider_type 化收口留 follow-up。 */
const isMimo = (s: ProviderSource): boolean =>
  s.icon === 'mimo' || s.apiBase.includes('xiaomimimo.com');

// MiMo 常量照 AstrBot mimo_api_common.py
const MIMO_TTS_SEED_TEXT = 'Hello, MiMo, have you had lunch?';
const MIMO_STT_SYSTEM_PROMPT =
  'You are a speech transcription assistant. ' +
  'Transcribe the spoken content from the audio exactly and return only the transcription text.';
const MIMO_STT_USER_PROMPT =
  'Please transcribe the content of the audio and return only the transcription text.';

/** 参考音频暂存目录名（向导保存前落这里，保存时 commitRefAudio 搬进 <voiceId>/）。 */
const STAGING_ID = '_staging';
const MAX_REF_AUDIO_BYTES = 10 * 1024 * 1024;

/** MiMo voicedesign 风格前缀（照 AstrBot _build_style_prefix；唱歌特例只留标签）。 */
const buildStylePrefix = (stylePrompt: string, dialect: string): string => {
  const content = [stylePrompt.trim(), dialect.trim()].filter(Boolean).join(' ').trim();
  if (!content) return '';
  if (content.includes('唱歌')) return '<style>唱歌</style>';
  return `<style>${content}</style>`;
};

/** MiMo 仅接受 wav/mp3；非 WAV 会得到不透明的 HTTP 400——本地魔数校验提前给出人话
 *  （照 AstrBot _validate_wav_payload；命中 = renderer 的 wav 转换降级发了原始 webm）。 */
const assertWavPayload = (dataBase64: string): void => {
  let header = Buffer.alloc(0);
  try {
    header = Buffer.from(dataBase64.slice(0, 64), 'base64');
  } catch {
    // 非法 base64 → header 留空，走下方统一报错
  }
  const isWav =
    header.length >= 12 &&
    header.subarray(0, 4).toString('latin1') === 'RIFF' &&
    header.subarray(8, 12).toString('latin1') === 'WAVE';
  if (!isWav) throw new Error('MiMo STT 仅接受 WAV 音频（录音的 WAV 转换未生效，收到非 WAV 数据）');
};

export function createVoiceService(deps: VoiceServiceDeps) {
  const resolveTarget = (kind: 'tts' | 'stt'): VoiceTarget | null => {
    const p = deps.getPrefs();
    const target = resolveChatTarget(
      p['model.providerSources'],
      p['model.models'],
      p[kind === 'tts' ? 'model.defaultTtsModelId' : 'model.defaultSttModelId'],
    );
    if (!target) return null;
    const source = p['model.providerSources'].find((s) => s.id === target.sourceId);
    if (!source) return null;
    return { apiBase: target.apiBase, model: target.model, source };
  };

  const requireTtsTarget = (): VoiceTarget => {
    const t = resolveTarget('tts');
    if (!t) throw new Error('未配置 TTS 模型（模型 API → 默认 TTS）');
    return t;
  };

  const authHeaders = (key: string): Record<string, string> =>
    key ? { authorization: `Bearer ${key}` } : {};

  const configStr = (s: ProviderSource, key: string): string | undefined => {
    const v = s.config?.[key];
    return typeof v === 'string' ? v : undefined;
  };

  const postJson = async (t: VoiceTarget, path: string, body: unknown) => {
    return deps.fetchImpl(`${t.apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(t.source.key) },
      body: JSON.stringify(body),
    });
  };

  /** rate = 播放端兜底变速；引擎已在服务端应用语速的传 1（否则双重加速）。 */
  const emitAudio = (dataBase64: string, mime: string, rate: number, sessionId?: string): void => {
    deps.broadcast('voice.audio', {
      ...(sessionId ? { sessionId } : {}),
      dataBase64,
      mime,
      rate,
    });
  };

  const speakOpenai = async (
    t: VoiceTarget,
    text: string,
    voiceName: string,
    rate: number,
    sessionId?: string,
  ): Promise<void> => {
    const res = await postJson(t, '/audio/speech', {
      model: t.model,
      input: text,
      voice: voiceName,
      speed: rate,
      response_format: 'mp3',
    });
    if (!res.ok) throw new Error(`TTS 请求失败（HTTP ${res.status}）`);
    // speed 已在服务端应用 → 播放端不再变速
    emitAudio(Buffer.from(await res.arrayBuffer()).toString('base64'), 'audio/mpeg', 1, sessionId);
  };

  const speakMimoPreset = async (
    t: VoiceTarget,
    text: string,
    voiceName: string,
    rate: number,
    sessionId?: string,
  ): Promise<void> => {
    const format = configStr(t.source, 'format') ?? 'wav';
    const audio: Record<string, string> = { format };
    // voicedesign 模型不支持 audio.voice 参数（照 AstrBot）
    if (!t.model.includes('voicedesign')) audio['voice'] = voiceName;
    const res = await postJson(t, '/chat/completions', {
      model: t.model,
      messages: [
        { role: 'user', content: MIMO_TTS_SEED_TEXT },
        { role: 'assistant', content: text },
      ],
      audio,
    });
    if (!res.ok) throw new Error(`TTS 请求失败（HTTP ${res.status}）`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { audio?: { data?: unknown } } }>;
    };
    const data = json.choices?.[0]?.message?.audio?.data;
    if (typeof data !== 'string' || !data) throw new Error('MiMo TTS 未返回 audio.data');
    emitAudio(data, format === 'mp3' ? 'audio/mpeg' : 'audio/wav', rate, sessionId);
  };

  /** MiMo voicedesign 文字描述设计音色（照 AstrBot mimo_tts_api_source 的 style/seed 语义）。 */
  const speakMimoDesign = async (
    t: VoiceTarget,
    profile: VoiceProfile,
    text: string,
    rate: number,
    sessionId?: string,
  ): Promise<void> => {
    const messages: Array<{ role: string; content: string }> = [];
    const seed = profile.seedText?.trim();
    if (seed) messages.push({ role: 'user', content: seed });
    const prefix = buildStylePrefix(profile.stylePrompt ?? '', profile.dialect ?? '');
    messages.push({ role: 'assistant', content: `${prefix}${text}` });
    const res = await postJson(t, '/chat/completions', {
      model: deps.getPrefs()['voice.engines.mimo.designModel'],
      messages,
      audio: { format: 'wav' }, // voicedesign 不支持 audio.voice
    });
    if (!res.ok) throw new Error(`TTS 请求失败（HTTP ${res.status}）`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { audio?: { data?: unknown } } }>;
    };
    const data = json.choices?.[0]?.message?.audio?.data;
    if (typeof data !== 'string' || !data) throw new Error('MiMo TTS 未返回 audio.data');
    emitAudio(data, 'audio/wav', rate, sessionId);
  };

  /** 参考音频定位：先 <profileId>/ 再 _staging/（向导试听未保存草稿）；都缺 → null。 */
  const findRefAudioId = (profileId: string, file: string): string | null => {
    if (deps.readVoiceFile(profileId, file)) return profileId;
    if (deps.readVoiceFile(STAGING_ID, file)) return STAGING_ID;
    return null;
  };

  const speakGptsovits = async (
    profile: VoiceProfile,
    text: string,
    rate: number,
    sessionId?: string,
  ): Promise<void> => {
    const file = profile.refAudioFile ?? '';
    const refId = findRefAudioId(profile.id, file);
    if (!refId) throw new Error(`参考音频文件缺失（${profile.name}/${file}）`);
    const apiBase = deps.getPrefs()['voice.engines.gptsovits.apiBase'];
    const res = await deps.fetchImpl(`${apiBase}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        text_lang: 'zh',
        ref_audio_path: path.join(deps.voicesDir, refId, file),
        prompt_text: profile.refText ?? '',
        prompt_lang: 'zh',
        speed_factor: rate,
      }),
    });
    if (!res.ok) throw new Error(`GPT-SoVITS 请求失败（HTTP ${res.status}）`);
    // speed_factor 已在服务端应用
    emitAudio(Buffer.from(await res.arrayBuffer()).toString('base64'), 'audio/wav', 1, sessionId);
  };

  const speakFishaudio = async (
    profile: VoiceProfile,
    text: string,
    rate: number,
    sessionId?: string,
  ): Promise<void> => {
    const p = deps.getPrefs();
    let req: Record<string, unknown>;
    if (profile.referenceId) {
      req = { text, format: 'wav', reference_id: profile.referenceId };
    } else {
      const file = profile.refAudioFile ?? '';
      const refId = findRefAudioId(profile.id, file);
      const bytes = refId ? deps.readVoiceFile(refId, file) : null;
      if (!bytes) throw new Error(`参考音频文件缺失（${profile.name}/${file}）`);
      req = { text, format: 'wav', references: [{ audio: bytes, text: profile.refText ?? '' }] };
    }
    const res = await deps.fetchImpl(`${p['voice.engines.fishaudio.apiBase']}/v1/tts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/msgpack',
        ...authHeaders(p['voice.engines.fishaudio.key']),
      },
      body: msgpackEncode(req),
    });
    if (!res.ok) throw new Error(`fish.audio 请求失败（HTTP ${res.status}）`);
    emitAudio(Buffer.from(await res.arrayBuffer()).toString('base64'), 'audio/wav', rate, sessionId);
  };

  /** 按音色档案分派（openai/mimo 连接沿用 D3 TTS provider 绑定；gptsovits/fishaudio 走引擎卡配置）。 */
  const speakProfile = async (
    profile: VoiceProfile,
    text: string,
    sessionId?: string,
  ): Promise<void> => {
    const rate = deps.getPrefs()['voice.rate'];
    switch (profile.engine) {
      case 'openai':
        return speakOpenai(requireTtsTarget(), text, profile.voiceName ?? 'alloy', rate, sessionId);
      case 'mimo': {
        const t = requireTtsTarget();
        return profile.kind === 'design'
          ? speakMimoDesign(t, profile, text, rate, sessionId)
          : speakMimoPreset(t, text, profile.voiceName ?? 'mimo_default', rate, sessionId);
      }
      case 'gptsovits':
        return speakGptsovits(profile, text, rate, sessionId);
      case 'fishaudio':
        return speakFishaudio(profile, text, rate, sessionId);
    }
  };

  const speak = async (text: string, sessionId?: string): Promise<void> => {
    const p = deps.getPrefs();
    const target = resolveTarget('tts');
    const legacyVoice = target ? configStr(target.source, 'voice') : undefined;
    const resolved = resolveVoiceProfile(
      deps.getActiveCharacterVoice(),
      p['voice.defaultVoiceId'],
      p['voice.voices'],
      legacyVoice,
    );
    if (resolved && resolved.via !== 'legacy') {
      return speakProfile(resolved.profile, text, sessionId);
    }
    // legacy / 引擎缺省：沿用 provider 绑定旧链（无音色库时行为不变）
    if (!target) throw new Error('未配置 TTS 模型（模型 API → 默认 TTS）');
    const rate = p['voice.rate'];
    const legacyName = resolved?.via === 'legacy' ? resolved.voiceName : undefined;
    await (isMimo(target.source)
      ? speakMimoPreset(target, text, legacyName ?? 'mimo_default', rate, sessionId)
      : speakOpenai(target, text, legacyName ?? 'alloy', rate, sessionId));
  };

  const transcribeOpenai = async (
    t: VoiceTarget,
    p: { dataBase64: string; mime: string },
  ): Promise<string> => {
    const form = new FormData();
    const ext = p.mime.includes('wav') ? 'wav' : p.mime.includes('mp') ? 'mp3' : 'webm';
    form.append(
      'file',
      new Blob([Buffer.from(p.dataBase64, 'base64')], { type: p.mime }),
      `audio.${ext}`,
    );
    form.append('model', t.model);
    const res = await deps.fetchImpl(`${t.apiBase}/audio/transcriptions`, {
      method: 'POST',
      // content-type 不手写：FormData 序列化时自带 multipart 边界
      headers: authHeaders(t.source.key),
      body: form,
    });
    if (!res.ok) throw new Error(`STT 请求失败（HTTP ${res.status}）`);
    const json = (await res.json()) as { text?: unknown };
    return typeof json.text === 'string' ? json.text : '';
  };

  const transcribeMimo = async (
    t: VoiceTarget,
    p: { dataBase64: string; mime: string },
  ): Promise<string> => {
    assertWavPayload(p.dataBase64);
    const audioContent = {
      type: 'input_audio',
      input_audio: { data: `data:audio/wav;base64,${p.dataBase64}` },
    };
    // ASR 专用模型（模型名含 asr，官方语音识别文档）吃 bare audio；
    // 多模态模型（音频理解文档）必须附带文本指令，否则 API 拒绝。照 AstrBot c9eed7b。
    const messages = t.model.toLowerCase().includes('asr')
      ? [{ role: 'user', content: [audioContent] }]
      : [
          { role: 'system', content: MIMO_STT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [audioContent, { type: 'text', text: MIMO_STT_USER_PROMPT }],
          },
        ];
    const res = await postJson(t, '/chat/completions', {
      model: t.model,
      messages,
      max_completion_tokens: 1024,
    });
    if (!res.ok) throw new Error(`STT 请求失败（HTTP ${res.status}）`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
    };
    const message = json.choices?.[0]?.message ?? {};
    // V2.5 可能把转写文本放 reasoning_content（照 AstrBot b8f4c7d）
    const content = [message.content, message.reasoning_content].find(
      (v): v is string => typeof v === 'string' && !!v.trim(),
    );
    if (!content) throw new Error('MiMo STT 转写为空');
    return content.trim();
  };

  const transcribe = async (p: { dataBase64: string; mime: string }): Promise<string> => {
    const t = resolveTarget('stt');
    if (!t) throw new Error('未配置 STT 模型（模型 API → 默认 STT）');
    return isMimo(t.source) ? transcribeMimo(t, p) : transcribeOpenai(t, p);
  };

  return {
    'voice.speak': async (p: { text: string }) => {
      await speak(p.text);
      return { ok: true as const };
    },
    'voice.transcribe': async (p: { dataBase64: string; mime: string }) => ({
      text: await transcribe(p),
    }),
    /** 试听音色草稿（不落库直接合成播；向导迭代设计/克隆用）。 */
    'voice.previewProfile': async (p: { profile: VoiceProfile; text: string }) => {
      await speakProfile(VoiceProfileSchema.parse(p.profile), p.text);
      return { ok: true as const };
    },
    /** 引擎测连：gptsovits 探活（任何 HTTP 响应算通，GET /tts 无参会 400）；fishaudio 轻量鉴权。 */
    'voice.testEngine': async (p: {
      engine: 'gptsovits' | 'fishaudio';
    }): Promise<{ ok: boolean; error?: string }> => {
      const prefs = deps.getPrefs();
      try {
        if (p.engine === 'gptsovits') {
          await deps.fetchImpl(`${prefs['voice.engines.gptsovits.apiBase']}/tts`, {
            method: 'GET',
            headers: {},
          });
          return { ok: true };
        }
        const res = await deps.fetchImpl(`${prefs['voice.engines.fishaudio.apiBase']}/model`, {
          method: 'GET',
          headers: authHeaders(prefs['voice.engines.fishaudio.key']),
        });
        return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    /** 参考音频暂存（≤10MB wav/mp3）；保存音色时 commitRefAudio 搬进 <voiceId>/。 */
    'voice.saveRefAudio': async (p: { dataBase64: string; mime: string }) => {
      const buf = Buffer.from(p.dataBase64, 'base64');
      if (buf.byteLength > MAX_REF_AUDIO_BYTES) throw new Error('参考音频超过 10MB 上限');
      const ext = p.mime.includes('wav')
        ? 'wav'
        : /mp3|mpeg/.test(p.mime)
          ? 'mp3'
          : null;
      if (!ext) throw new Error('参考音频仅支持 wav / mp3');
      const file = `ref.${ext}`;
      deps.writeVoiceFile(STAGING_ID, file, buf);
      return { file };
    },
    'voice.commitRefAudio': async (p: { voiceId: string; file: string }) => {
      deps.moveVoiceFile(STAGING_ID, p.file, p.voiceId);
      return { ok: true as const };
    },
    /** 删除音色即清目录（参考音频随音色生命周期）。 */
    'voice.removeVoiceDir': async (p: { id: string }) => {
      deps.removeVoiceDir(p.id);
      return { ok: true as const };
    },
    /** bargeIn：录音端调用，广播停播（character 窗停 activeVoice）。 */
    'voice.stopPlayback': async (_p: Record<string, never>) => {
      deps.broadcast('voice.stop', {});
      return { ok: true as const };
    },
    /** autoSpeak 旁路入口（chat.done(stop) 挂）：关/未配置/失败一律静默，不影响文本回复。 */
    async speakSession(sessionId: string): Promise<void> {
      if (!deps.getPrefs()['voice.autoSpeak']) return;
      const text = deps.lastAssistantText(sessionId);
      if (text) await speak(text, sessionId).catch(() => {});
    },
  };
}
