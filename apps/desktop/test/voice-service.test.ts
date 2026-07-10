import { describe, it, expect, vi } from 'vitest';
import { PrefsSchema, type Prefs } from '@openpet/protocol';
import { createVoiceService, type FetchLike } from '../electron/main/voice-service.js';

/** fake fetch：捕获调用并返回预设（默认 mp3 字节 / transcription JSON）。 */
function fakeFetch(overrides?: {
  status?: number;
  bytes?: Uint8Array;
  json?: unknown;
}): { impl: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const status = overrides?.status ?? 200;
  const bytes = overrides?.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      json: async () => overrides?.json ?? { text: '你好' },
      text: async () => 'err-body',
    };
  };
  return { impl, calls };
}

function prefsWith(overrides: Record<string, unknown> = {}, opts?: { ttsKey?: string }): Prefs {
  return PrefsSchema.parse({
    'model.providerSources': [
      {
        id: 'src-tts',
        adapter: 'openai',
        capability: 'tts',
        apiBase: 'http://x/v1',
        key: opts?.ttsKey ?? 'sk-test',
        enabled: true,
        config: { voice: 'miko' },
      },
      {
        id: 'src-stt',
        adapter: 'openai',
        capability: 'stt',
        apiBase: 'http://x/v1',
        key: 'sk-stt',
        enabled: true,
      },
    ],
    'model.models': [
      { id: 'm-tts', sourceId: 'src-tts', model: 'tts-1', enabled: true },
      { id: 'm-stt', sourceId: 'src-stt', model: 'whisper-1', enabled: true },
    ],
    'model.defaultTtsModelId': 'm-tts',
    'model.defaultSttModelId': 'm-stt',
    ...overrides,
  });
}

function makeService(args?: {
  prefs?: Prefs;
  fetch?: ReturnType<typeof fakeFetch>;
  lastText?: string | null;
}) {
  const fetch = args?.fetch ?? fakeFetch();
  const prefs = args?.prefs ?? prefsWith();
  const broadcasts: Array<{ channel: string; params: unknown }> = [];
  const service = createVoiceService({
    getPrefs: () => prefs,
    broadcast: (channel, params) => broadcasts.push({ channel, params }),
    lastAssistantText: vi.fn(() => args?.lastText ?? null),
    fetchImpl: fetch.impl,
  });
  return { service, fetch, broadcasts };
}

describe('voice.speak（TTS）', () => {
  it('POST /audio/speech：bearer 头 + model/input/voice 体 + 广播 voice.audio base64', async () => {
    const bytes = new Uint8Array([0xff, 0xf3, 0x40, 0x00]);
    const fetch = fakeFetch({ bytes });
    const { service, broadcasts } = makeService({ fetch });

    const r = await service['voice.speak']({ text: '早上好' });
    expect(r).toEqual({ ok: true });

    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0]!;
    expect(call.url).toBe('http://x/v1/audio/speech');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['authorization']).toBe('Bearer sk-test');
    expect(call.init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(call.init.body as string);
    expect(body).toEqual({ model: 'tts-1', input: '早上好', voice: 'miko', response_format: 'mp3' });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.channel).toBe('voice.audio');
    expect(broadcasts[0]!.params).toEqual({
      dataBase64: Buffer.from(bytes).toString('base64'),
      mime: 'audio/mpeg',
    });
  });

  it('source.config 无 voice → 默认 alloy', async () => {
    const prefs = prefsWith();
    (prefs['model.providerSources'][0]! as { config?: unknown }).config = {};
    const { service, fetch } = makeService({ prefs });
    await service['voice.speak']({ text: 'hi' });
    expect(JSON.parse(fetch.calls[0]!.init.body as string).voice).toBe('alloy');
  });

  it('key 为空（本地端点）→ 无 authorization 头', async () => {
    const { service, fetch } = makeService({ prefs: prefsWith({}, { ttsKey: '' }) });
    await service['voice.speak']({ text: 'hi' });
    expect(fetch.calls[0]!.init.headers['authorization']).toBeUndefined();
  });

  it('未配置默认 TTS 模型 → RPC reject 且不广播', async () => {
    const { service, fetch, broadcasts } = makeService({
      prefs: prefsWith({ 'model.defaultTtsModelId': '' }),
    });
    await expect(service['voice.speak']({ text: 'hi' })).rejects.toThrow(/未配置 TTS/);
    expect(fetch.calls).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('非 2xx → reject（含 status）且不广播', async () => {
    const { service, broadcasts } = makeService({ fetch: fakeFetch({ status: 401 }) });
    await expect(service['voice.speak']({ text: 'hi' })).rejects.toThrow(/401/);
    expect(broadcasts).toHaveLength(0);
  });
});

describe('speakSession（autoSpeak 旁路）', () => {
  it('autoSpeak=false → 不发请求', async () => {
    const { service, fetch } = makeService({
      prefs: prefsWith({ 'voice.autoSpeak': false }),
      lastText: '回复文本',
    });
    await service.speakSession('s1');
    expect(fetch.calls).toHaveLength(0);
  });

  it('autoSpeak=true 且有 assistant 文本 → 发请求 + 广播带 sessionId', async () => {
    const { service, fetch, broadcasts } = makeService({
      prefs: prefsWith({ 'voice.autoSpeak': true }),
      lastText: '回复文本',
    });
    await service.speakSession('s1');
    expect(fetch.calls).toHaveLength(1);
    expect(JSON.parse(fetch.calls[0]!.init.body as string).input).toBe('回复文本');
    expect(broadcasts[0]!.params).toMatchObject({ sessionId: 's1' });
  });

  it('autoSpeak=true 但无 assistant 文本 → 不发', async () => {
    const { service, fetch } = makeService({
      prefs: prefsWith({ 'voice.autoSpeak': true }),
      lastText: null,
    });
    await service.speakSession('s1');
    expect(fetch.calls).toHaveLength(0);
  });

  it('未配置 TTS → 静默不广播不 throw', async () => {
    const { service, fetch, broadcasts } = makeService({
      prefs: prefsWith({ 'voice.autoSpeak': true, 'model.defaultTtsModelId': '' }),
      lastText: '回复文本',
    });
    await expect(service.speakSession('s1')).resolves.toBeUndefined();
    expect(fetch.calls).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('请求失败 → 静默不 throw', async () => {
    const { service } = makeService({
      prefs: prefsWith({ 'voice.autoSpeak': true }),
      fetch: fakeFetch({ status: 500 }),
      lastText: '回复文本',
    });
    await expect(service.speakSession('s1')).resolves.toBeUndefined();
  });
});

describe('voice.transcribe（ASR）', () => {
  it('POST /audio/transcriptions：multipart 含 file+model，仅 authorization 头，返回 text', async () => {
    const { service, fetch } = makeService();
    const r = await service['voice.transcribe']({
      dataBase64: Buffer.from('fake-webm').toString('base64'),
      mime: 'audio/webm',
    });
    expect(r).toEqual({ text: '你好' });

    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0]!;
    expect(call.url).toBe('http://x/v1/audio/transcriptions');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['authorization']).toBe('Bearer sk-stt');
    expect(call.init.headers['content-type']).toBeUndefined(); // FormData 自带边界
    expect(call.init.body).toBeInstanceOf(FormData);
    const form = call.init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe('audio/webm');
  });

  it('wav 上传时 multipart 文件名后缀跟随 mime', async () => {
    const { service, fetch } = makeService();
    await service['voice.transcribe']({ dataBase64: 'AA==', mime: 'audio/wav' });
    const form = fetch.calls[0]!.init.body as FormData;
    expect((form.get('file') as File).name).toBe('audio.wav');
  });

  it('未配置默认 STT 模型 → reject', async () => {
    const { service } = makeService({ prefs: prefsWith({ 'model.defaultSttModelId': '' }) });
    await expect(
      service['voice.transcribe']({ dataBase64: 'AA==', mime: 'audio/webm' }),
    ).rejects.toThrow(/未配置 STT/);
  });

  it('非 2xx → reject', async () => {
    const { service } = makeService({ fetch: fakeFetch({ status: 500 }) });
    await expect(
      service['voice.transcribe']({ dataBase64: 'AA==', mime: 'audio/webm' }),
    ).rejects.toThrow(/500/);
  });
});

// ---- MiMo（小米）专有协议：STT/TTS 走多模态 /chat/completions（照 AstrBot mimo_*_api_source）----
const MIMO_SOURCES = [
  {
    id: 'mimo_tts',
    adapter: 'openai',
    capability: 'tts',
    apiBase: 'https://api.xiaomimimo.com/v1',
    key: 'sk-mimo',
    enabled: true,
    icon: 'mimo',
    config: { model: 'mimo-v2.5-tts', voice: 'mimo_default', format: 'wav' },
  },
  {
    id: 'mimo_stt',
    adapter: 'openai',
    capability: 'stt',
    apiBase: 'https://api.xiaomimimo.com/v1',
    key: 'sk-mimo',
    enabled: true,
    icon: 'mimo',
    config: { model: 'mimo-v2.5-asr' },
  },
];
const MIMO_MODELS = [
  { id: 'mimo_tts/mimo-v2.5-tts', sourceId: 'mimo_tts', model: 'mimo-v2.5-tts', enabled: true },
  { id: 'mimo_stt/mimo-v2.5-asr', sourceId: 'mimo_stt', model: 'mimo-v2.5-asr', enabled: true },
];

function mimoPrefs(overrides: Record<string, unknown> = {}): Prefs {
  return PrefsSchema.parse({
    'model.providerSources': MIMO_SOURCES,
    'model.models': MIMO_MODELS,
    'model.defaultTtsModelId': 'mimo_tts/mimo-v2.5-tts',
    'model.defaultSttModelId': 'mimo_stt/mimo-v2.5-asr',
    ...overrides,
  });
}

describe('MiMo TTS（chat/completions 多模态）', () => {
  const audioB64 = Buffer.from('fake-wav-bytes').toString('base64');
  const mimoTtsJson = { choices: [{ message: { audio: { data: audioB64 } } }] };

  it('POST /chat/completions：seed user + assistant 文本 + audio 参数，广播 wav', async () => {
    const fetch = fakeFetch({ json: mimoTtsJson });
    const { service, broadcasts } = makeService({ prefs: mimoPrefs(), fetch });

    await service['voice.speak']({ text: '早上好' });

    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(call.init.headers['authorization']).toBe('Bearer sk-mimo');
    expect(call.init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe('mimo-v2.5-tts');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user'); // seed text（照 AstrBot）
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '早上好' });
    expect(body.audio).toEqual({ format: 'wav', voice: 'mimo_default' });

    expect(broadcasts[0]!.channel).toBe('voice.audio');
    expect(broadcasts[0]!.params).toEqual({ dataBase64: audioB64, mime: 'audio/wav' });
  });

  it('voicedesign 模型不带 audio.voice（照 AstrBot）', async () => {
    const prefs = mimoPrefs({
      'model.models': [
        {
          id: 'mimo_tts/mimo-voicedesign',
          sourceId: 'mimo_tts',
          model: 'mimo-voicedesign',
          enabled: true,
        },
      ],
      'model.defaultTtsModelId': 'mimo_tts/mimo-voicedesign',
    });
    const fetch = fakeFetch({ json: mimoTtsJson });
    const { service } = makeService({ prefs, fetch });
    await service['voice.speak']({ text: 'hi' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.audio).toEqual({ format: 'wav' });
  });

  it('响应缺 audio.data → reject', async () => {
    const fetch = fakeFetch({ json: { choices: [{ message: {} }] } });
    const { service } = makeService({ prefs: mimoPrefs(), fetch });
    await expect(service['voice.speak']({ text: 'hi' })).rejects.toThrow(/audio/i);
  });
});

describe('MiMo STT（chat/completions input_audio，2026-07 V2.5 协议）', () => {
  const mimoSttJson = { choices: [{ message: { content: '  你好呀  ' } }] };
  // 合法 WAV 头（RIFF....WAVE）：MiMo 分支有魔数校验（照 AstrBot _validate_wav_payload）
  const wavB64 = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WAVE'),
    Buffer.alloc(8),
  ]).toString('base64');

  it('asr 模型：bare audio 单消息 + data URL，返回 trim 后 content', async () => {
    const fetch = fakeFetch({ json: mimoSttJson });
    const { service } = makeService({ prefs: mimoPrefs(), fetch });

    const r = await service['voice.transcribe']({ dataBase64: wavB64, mime: 'audio/wav' });
    expect(r).toEqual({ text: '你好呀' });

    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(call.init.headers['content-type']).toBe('application/json'); // JSON，非 multipart
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe('mimo-v2.5-asr');
    expect(body.max_completion_tokens).toBe(1024);
    // ASR 专用模型（模型名含 asr）：仅一条 user 消息、纯音频，不带 system/text 指令
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wavB64}` } },
        ],
      },
    ]);
  });

  it('多模态模型（无 asr 字样）：system 指令 + input_audio+text', async () => {
    const prefs = mimoPrefs({
      'model.models': [
        { id: 'mimo_stt/mimo-v2.5', sourceId: 'mimo_stt', model: 'mimo-v2.5', enabled: true },
      ],
      'model.defaultSttModelId': 'mimo_stt/mimo-v2.5',
    });
    const fetch = fakeFetch({ json: mimoSttJson });
    const { service } = makeService({ prefs, fetch });
    await service['voice.transcribe']({ dataBase64: wavB64, mime: 'audio/wav' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content[0].type).toBe('input_audio');
    expect(body.messages[1].content[1].type).toBe('text');
  });

  it('content 为空时兜底 reasoning_content（V2.5 行为）', async () => {
    const fetch = fakeFetch({
      json: { choices: [{ message: { content: '', reasoning_content: ' 转写结果 ' } }] },
    });
    const { service } = makeService({ prefs: mimoPrefs(), fetch });
    const r = await service['voice.transcribe']({ dataBase64: wavB64, mime: 'audio/wav' });
    expect(r).toEqual({ text: '转写结果' });
  });

  it('非 WAV 数据 → 本地拒绝（不发请求）', async () => {
    const fetch = fakeFetch({ json: mimoSttJson });
    const { service } = makeService({ prefs: mimoPrefs(), fetch });
    await expect(
      service['voice.transcribe']({
        dataBase64: Buffer.from('not-a-wav').toString('base64'),
        mime: 'audio/webm',
      }),
    ).rejects.toThrow(/WAV/);
    expect(fetch.calls).toHaveLength(0);
  });

  it('响应 content/reasoning_content 均空 → reject', async () => {
    const fetch = fakeFetch({ json: { choices: [{ message: { content: '' } }] } });
    const { service } = makeService({ prefs: mimoPrefs(), fetch });
    await expect(
      service['voice.transcribe']({ dataBase64: wavB64, mime: 'audio/wav' }),
    ).rejects.toThrow(/转写/);
  });
});
