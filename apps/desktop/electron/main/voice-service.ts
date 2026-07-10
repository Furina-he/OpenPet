/**
 * F-VC 语音运行时（TTS/ASR）— Main 直调。
 *
 * 两种协议：
 *  - openai 兼容：POST /audio/speech（TTS 二进制）、/audio/transcriptions（multipart）。
 *  - MiMo（小米）：STT/TTS 都走多模态 /chat/completions（照 AstrBot
 *    mimo_stt_api_source / mimo_tts_api_source）——TTS = user(seed)+assistant(文本)+audio 参数，
 *    响应 message.audio.data；STT = input_audio(base64 wav)+转写指令，响应 message.content。
 *
 * 为什么在 Main 而不进 provider worker：TTS/STT 是单次请求-响应（无流式背压/取消），
 * 且二进制音频过 worker fetch-proxy（面向 SSE 文本）有损坏风险；密钥本就在 Main 注入。
 * fetchImpl 由装配方注入（生产 = Electron net.fetch 适配，走系统代理；测试 = fake）。
 * 音频经 IPC 用 base64 string（Zod 可表达；单句 TTS 体积可接受）。
 */
import { resolveChatTarget, type Prefs, type ProviderSource } from '@openpet/protocol';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string | FormData },
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

  const emitAudio = (dataBase64: string, mime: string, sessionId?: string): void => {
    deps.broadcast('voice.audio', {
      ...(sessionId ? { sessionId } : {}),
      dataBase64,
      mime,
    });
  };

  const speakOpenai = async (t: VoiceTarget, text: string, sessionId?: string): Promise<void> => {
    const res = await postJson(t, '/audio/speech', {
      model: t.model,
      input: text,
      voice: configStr(t.source, 'voice') ?? 'alloy',
      response_format: 'mp3',
    });
    if (!res.ok) throw new Error(`TTS 请求失败（HTTP ${res.status}）`);
    emitAudio(Buffer.from(await res.arrayBuffer()).toString('base64'), 'audio/mpeg', sessionId);
  };

  const speakMimo = async (t: VoiceTarget, text: string, sessionId?: string): Promise<void> => {
    const format = configStr(t.source, 'format') ?? 'wav';
    const audio: Record<string, string> = { format };
    // voicedesign 模型不支持 audio.voice 参数（照 AstrBot）
    if (!t.model.includes('voicedesign')) {
      audio['voice'] = configStr(t.source, 'voice') ?? 'mimo_default';
    }
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
    emitAudio(data, format === 'mp3' ? 'audio/mpeg' : 'audio/wav', sessionId);
  };

  const speak = async (text: string, sessionId?: string): Promise<void> => {
    const t = resolveTarget('tts');
    if (!t) throw new Error('未配置 TTS 模型（模型 API → 默认 TTS）');
    await (isMimo(t.source) ? speakMimo(t, text, sessionId) : speakOpenai(t, text, sessionId));
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
    /** autoSpeak 旁路入口（chat.done(stop) 挂）：关/未配置/失败一律静默，不影响文本回复。 */
    async speakSession(sessionId: string): Promise<void> {
      if (!deps.getPrefs()['voice.autoSpeak']) return;
      const text = deps.lastAssistantText(sessionId);
      if (text) await speak(text, sessionId).catch(() => {});
    },
  };
}
