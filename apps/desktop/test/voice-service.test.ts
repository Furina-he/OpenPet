import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { decode as msgpackDecode } from '@msgpack/msgpack';
import { PrefsSchema, type Prefs, type VoiceProfile } from '@openpet/protocol';
import { createVoiceService, type FetchLike } from '../electron/main/voice-service.js';

/** fake fetch：捕获调用并返回预设（默认 mp3 字节 / transcription JSON）。 */
function fakeFetch(overrides?: {
  status?: number;
  bytes?: Uint8Array;
  json?: unknown;
  reject?: Error;
}): { impl: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const status = overrides?.status ?? 200;
  const bytes = overrides?.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (overrides?.reject) throw overrides.reject;
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

/** 参考音频文件的内存实现（注入替代 userData/voices 目录 fs）。 */
function memFiles(initial: Record<string, Buffer> = {}) {
  const files = new Map<string, Buffer>(Object.entries(initial));
  const key = (id: string, file: string) => `${id}/${file}`;
  return {
    files,
    read: (id: string, file: string) => files.get(key(id, file)) ?? null,
    write: (id: string, file: string, data: Buffer) => void files.set(key(id, file), data),
    move: (fromId: string, file: string, toId: string) => {
      const b = files.get(key(fromId, file));
      if (!b) throw new Error(`missing ${key(fromId, file)}`);
      files.delete(key(fromId, file));
      files.set(key(toId, file), b);
    },
    removeDir: (id: string) => {
      for (const k of [...files.keys()]) if (k.startsWith(`${id}/`)) files.delete(k);
    },
  };
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
  characterVoice?: string;
  files?: Record<string, Buffer>;
}) {
  const fetch = args?.fetch ?? fakeFetch();
  const prefs = args?.prefs ?? prefsWith();
  const store = memFiles(args?.files);
  const broadcasts: Array<{ channel: string; params: unknown }> = [];
  const service = createVoiceService({
    getPrefs: () => prefs,
    broadcast: (channel, params) => broadcasts.push({ channel, params }),
    lastAssistantText: vi.fn(() => args?.lastText ?? null),
    fetchImpl: fetch.impl,
    getActiveCharacterVoice: () => args?.characterVoice,
    voicesDir: '/vd',
    readVoiceFile: store.read,
    writeVoiceFile: store.write,
    moveVoiceFile: store.move,
    removeVoiceDir: store.removeDir,
  });
  return { service, fetch, broadcasts, files: store.files };
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
    expect(body).toEqual({
      model: 'tts-1',
      input: '早上好',
      voice: 'miko',
      speed: 1,
      response_format: 'mp3',
    });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.channel).toBe('voice.audio');
    expect(broadcasts[0]!.params).toEqual({
      dataBase64: Buffer.from(bytes).toString('base64'),
      mime: 'audio/mpeg',
      rate: 1, // openai 语速已在服务端 speed 应用，播放端不再变速
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
    expect(broadcasts[0]!.params).toEqual({ dataBase64: audioB64, mime: 'audio/wav', rate: 1 });
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

// ---- ⑩.6 音色工坊：VoiceProfile 四引擎分派 + 新 RPC（spec §3）----

const vpOpenai: VoiceProfile = {
  id: 'vp_oa',
  name: 'openai 预设',
  kind: 'preset',
  engine: 'openai',
  voiceName: 'nova',
};
const vpOpenai2: VoiceProfile = { ...vpOpenai, id: 'vp_oa2', voiceName: 'shimmer' };
const vpMimoPreset: VoiceProfile = {
  id: 'vp_mp',
  name: 'mimo 预设',
  kind: 'preset',
  engine: 'mimo',
  voiceName: 'mimo_cute',
};
const vpDesign: VoiceProfile = {
  id: 'vp_md',
  name: '设计音色',
  kind: 'design',
  engine: 'mimo',
  stylePrompt: '温柔少女',
  dialect: '粤语',
};
const vpGsv: VoiceProfile = {
  id: 'vp_gs',
  name: '本地克隆',
  kind: 'clone',
  engine: 'gptsovits',
  refAudioFile: 'ref.wav',
  refText: '参考音频文本',
};
const vpFish: VoiceProfile = {
  id: 'vp_fi',
  name: '云克隆',
  kind: 'clone',
  engine: 'fishaudio',
  refAudioFile: 'ref.wav',
  refText: '参考音频文本',
};
const vpFishRef: VoiceProfile = {
  id: 'vp_fr',
  name: '平台模型',
  kind: 'clone',
  engine: 'fishaudio',
  referenceId: '626bb6d3f3364c9cbc3aa6a67300a664',
};

describe('音色工坊：生效序接入', () => {
  it('defaultVoiceId 命中 → openai 预设音色 voiceName + speed=rate，广播 rate=1', async () => {
    const { service, fetch, broadcasts } = makeService({
      prefs: prefsWith({
        'voice.voices': [vpOpenai],
        'voice.defaultVoiceId': 'vp_oa',
        'voice.rate': 1.5,
      }),
    });
    await service['voice.speak']({ text: '早上好' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body).toEqual({
      model: 'tts-1',
      input: '早上好',
      voice: 'nova',
      speed: 1.5,
      response_format: 'mp3',
    });
    expect(broadcasts[0]!.params).toMatchObject({ rate: 1 });
  });

  it('角色 manifest.voice 优先于 defaultVoiceId', async () => {
    const { service, fetch } = makeService({
      prefs: prefsWith({ 'voice.voices': [vpOpenai, vpOpenai2], 'voice.defaultVoiceId': 'vp_oa' }),
      characterVoice: 'vp_oa2',
    });
    await service['voice.speak']({ text: 'hi' });
    expect(JSON.parse(fetch.calls[0]!.init.body as string).voice).toBe('shimmer');
  });

  it('音色库无命中 → 旧 source.config.voice 仍生效（回归）', async () => {
    const { service, fetch } = makeService({
      prefs: prefsWith({ 'voice.voices': [vpOpenai], 'voice.defaultVoiceId': '' }),
    });
    await service['voice.speak']({ text: 'hi' });
    expect(JSON.parse(fetch.calls[0]!.init.body as string).voice).toBe('miko');
  });
});

describe('音色工坊：MiMo preset/design 分派', () => {
  const audioB64 = Buffer.from('fake-wav').toString('base64');
  const mimoJson = { choices: [{ message: { audio: { data: audioB64 } } }] };

  it('mimo preset：audio.voice = profile.voiceName；广播 rate 跟随 prefs（播放端兜底变速）', async () => {
    const fetch = fakeFetch({ json: mimoJson });
    const { service, broadcasts } = makeService({
      prefs: mimoPrefs({
        'voice.voices': [vpMimoPreset],
        'voice.defaultVoiceId': 'vp_mp',
        'voice.rate': 1.5,
      }),
      fetch,
    });
    await service['voice.speak']({ text: '早上好' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.audio).toEqual({ format: 'wav', voice: 'mimo_cute' });
    expect(broadcasts[0]!.params).toMatchObject({ rate: 1.5 });
  });

  it('mimo design：model=designModel，assistant=<style>描述 方言</style>+文本，无 seed 则单消息，无 audio.voice', async () => {
    const fetch = fakeFetch({ json: mimoJson });
    const { service } = makeService({
      prefs: mimoPrefs({ 'voice.voices': [vpDesign], 'voice.defaultVoiceId': 'vp_md' }),
      fetch,
    });
    await service['voice.speak']({ text: '早上好' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.model).toBe('mimo-v2.5-tts-voicedesign');
    expect(body.messages).toEqual([
      { role: 'assistant', content: '<style>温柔少女 粤语</style>早上好' },
    ]);
    expect(body.audio).toEqual({ format: 'wav' });
  });

  it('mimo design：seedText 非空 → 前置 user 轮', async () => {
    const fetch = fakeFetch({ json: mimoJson });
    const { service } = makeService({
      prefs: mimoPrefs({
        'voice.voices': [{ ...vpDesign, seedText: '你好呀' }],
        'voice.defaultVoiceId': 'vp_md',
      }),
      fetch,
    });
    await service['voice.speak']({ text: 'hi' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.messages[0]).toEqual({ role: 'user', content: '你好呀' });
    expect(body.messages).toHaveLength(2);
  });

  it('mimo design：描述含「唱歌」→ 前缀只留 <style>唱歌</style>（照 AstrBot）', async () => {
    const fetch = fakeFetch({ json: mimoJson });
    const { service } = makeService({
      prefs: mimoPrefs({
        'voice.voices': [{ ...vpDesign, stylePrompt: '欢快地唱歌', dialect: '' }],
        'voice.defaultVoiceId': 'vp_md',
      }),
      fetch,
    });
    await service['voice.speak']({ text: '啦啦啦' });
    const body = JSON.parse(fetch.calls[0]!.init.body as string);
    expect(body.messages[0]!.content).toBe('<style>唱歌</style>啦啦啦');
  });
});

describe('音色工坊：GPT-SoVITS（本地 api_v2）', () => {
  it('POST {apiBase}/tts：JSON 形状 + ref_audio_path 绝对路径 + speed_factor=rate；不依赖 TTS provider', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const fetch = fakeFetch({ bytes });
    const { service, broadcasts } = makeService({
      prefs: prefsWith({
        'model.defaultTtsModelId': '', // 无 provider 绑定也能走本地引擎
        'voice.voices': [vpGsv],
        'voice.defaultVoiceId': 'vp_gs',
        'voice.rate': 1.5,
      }),
      fetch,
      files: { 'vp_gs/ref.wav': Buffer.from('wav-bytes') },
    });
    await service['voice.speak']({ text: '早上好' });
    const call = fetch.calls[0]!;
    expect(call.url).toBe('http://127.0.0.1:9880/tts');
    expect(call.init.headers['content-type']).toBe('application/json');
    expect(call.init.headers['authorization']).toBeUndefined();
    expect(JSON.parse(call.init.body as string)).toEqual({
      text: '早上好',
      text_lang: 'zh',
      ref_audio_path: path.join('/vd', 'vp_gs', 'ref.wav'),
      prompt_text: '参考音频文本',
      prompt_lang: 'zh',
      speed_factor: 1.5,
    });
    expect(broadcasts[0]!.params).toEqual({
      dataBase64: Buffer.from(bytes).toString('base64'),
      mime: 'audio/wav',
      rate: 1, // speed_factor 服务端已应用
    });
  });

  it('参考音频文件缺失 → reject 且不发请求', async () => {
    const { service, fetch } = makeService({
      prefs: prefsWith({ 'voice.voices': [vpGsv], 'voice.defaultVoiceId': 'vp_gs' }),
    });
    await expect(service['voice.speak']({ text: 'hi' })).rejects.toThrow(/参考音频/);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('音色工坊：fish.audio（msgpack）', () => {
  const fishPrefs = (voices: VoiceProfile[], defaultId: string) =>
    prefsWith({
      'model.defaultTtsModelId': '',
      'voice.voices': voices,
      'voice.defaultVoiceId': defaultId,
      'voice.engines.fishaudio.key': 'fk-test',
      'voice.rate': 1.5,
    });

  it('POST {apiBase}/v1/tts：msgpack references 内联参考音频 + bearer；广播 rate 跟随 prefs', async () => {
    const fetch = fakeFetch({ bytes: new Uint8Array([7]) });
    const { service, broadcasts } = makeService({
      prefs: fishPrefs([vpFish], 'vp_fi'),
      fetch,
      files: { 'vp_fi/ref.wav': Buffer.from('wav-bytes') },
    });
    await service['voice.speak']({ text: '早上好' });
    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.fish-audio.cn/v1/tts');
    expect(call.init.headers['authorization']).toBe('Bearer fk-test');
    expect(call.init.headers['content-type']).toBe('application/msgpack');
    const req = msgpackDecode(call.init.body as Uint8Array) as {
      text: string;
      format: string;
      references: Array<{ audio: Uint8Array; text: string }>;
    };
    expect(req.text).toBe('早上好');
    expect(req.format).toBe('wav');
    expect(req.references).toHaveLength(1);
    expect(Array.from(req.references[0]!.audio)).toEqual([...Buffer.from('wav-bytes')]);
    expect(req.references[0]!.text).toBe('参考音频文本');
    expect(broadcasts[0]!.params).toMatchObject({ mime: 'audio/wav', rate: 1.5 });
  });

  it('referenceId 优先：请求带 reference_id、不含 references', async () => {
    const fetch = fakeFetch({ bytes: new Uint8Array([7]) });
    const { service } = makeService({ prefs: fishPrefs([vpFishRef], 'vp_fr'), fetch });
    await service['voice.speak']({ text: 'hi' });
    const req = msgpackDecode(fetch.calls[0]!.init.body as Uint8Array) as Record<string, unknown>;
    expect(req['reference_id']).toBe('626bb6d3f3364c9cbc3aa6a67300a664');
    expect(req['references']).toBeUndefined();
  });

  it('非 2xx → reject', async () => {
    const { service } = makeService({
      prefs: fishPrefs([vpFishRef], 'vp_fr'),
      fetch: fakeFetch({ status: 402 }),
    });
    await expect(service['voice.speak']({ text: 'hi' })).rejects.toThrow(/402/);
  });
});

describe('voice.previewProfile（试听未保存草稿）', () => {
  it('克隆草稿参考音频在 _staging → 兜底读取；广播不带 sessionId', async () => {
    const fetch = fakeFetch({ bytes: new Uint8Array([7]) });
    const { service, broadcasts } = makeService({
      prefs: prefsWith({
        'model.defaultTtsModelId': '',
        'voice.engines.fishaudio.key': 'fk',
      }),
      fetch,
      files: { '_staging/ref.wav': Buffer.from('staged') },
    });
    const r = await service['voice.previewProfile']({ profile: vpFish, text: '试听一下' });
    expect(r).toEqual({ ok: true });
    const req = msgpackDecode(fetch.calls[0]!.init.body as Uint8Array) as {
      references: Array<{ audio: Uint8Array }>;
    };
    expect(Array.from(req.references[0]!.audio)).toEqual([...Buffer.from('staged')]);
    expect(broadcasts[0]!.params).not.toHaveProperty('sessionId');
  });

  it('形状非法的 profile → reject', async () => {
    const { service } = makeService();
    await expect(
      service['voice.previewProfile']({
        profile: { ...vpDesign, stylePrompt: undefined } as unknown as VoiceProfile,
        text: 'hi',
      }),
    ).rejects.toThrow();
  });
});

describe('voice.saveRefAudio / commitRefAudio / removeVoiceDir', () => {
  it('保存 ≤10MB wav → 暂存 _staging 并返回文件名', async () => {
    const { service, files } = makeService();
    const r = await service['voice.saveRefAudio']({
      dataBase64: Buffer.from('wav-data').toString('base64'),
      mime: 'audio/wav',
    });
    expect(r).toEqual({ file: 'ref.wav' });
    expect(files.get('_staging/ref.wav')).toEqual(Buffer.from('wav-data'));
  });

  it('mp3 后缀跟随 mime；>10MB 拒绝；不支持的 mime 拒绝', async () => {
    const { service, files } = makeService();
    expect(await service['voice.saveRefAudio']({ dataBase64: 'AA==', mime: 'audio/mpeg' })).toEqual(
      { file: 'ref.mp3' },
    );
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
    await expect(
      service['voice.saveRefAudio']({ dataBase64: big, mime: 'audio/wav' }),
    ).rejects.toThrow(/10MB/);
    expect(files.has('_staging/ref.wav')).toBe(false);
    await expect(
      service['voice.saveRefAudio']({ dataBase64: 'AA==', mime: 'audio/webm' }),
    ).rejects.toThrow(/wav|mp3/i);
  });

  it('commitRefAudio：_staging → <voiceId>/；removeVoiceDir 清目录', async () => {
    const { service, files } = makeService({ files: { '_staging/ref.wav': Buffer.from('x') } });
    expect(await service['voice.commitRefAudio']({ voiceId: 'vp_new', file: 'ref.wav' })).toEqual({
      ok: true,
    });
    expect(files.has('_staging/ref.wav')).toBe(false);
    expect(files.has('vp_new/ref.wav')).toBe(true);

    expect(await service['voice.removeVoiceDir']({ id: 'vp_new' })).toEqual({ ok: true });
    expect(files.has('vp_new/ref.wav')).toBe(false);
  });
});

describe('voice.stopPlayback（bargeIn 停播）', () => {
  it('广播 voice.stop 空参', async () => {
    const { service, broadcasts } = makeService();
    expect(await service['voice.stopPlayback']({})).toEqual({ ok: true });
    expect(broadcasts).toEqual([{ channel: 'voice.stop', params: {} }]);
  });
});

describe('voice.testEngine（测连）', () => {
  it('gptsovits：GET {apiBase}/tts 有响应即通（400 也算）；连接失败给人话', async () => {
    const fetch400 = fakeFetch({ status: 400 });
    const { service } = makeService({ fetch: fetch400 });
    expect(await service['voice.testEngine']({ engine: 'gptsovits' })).toEqual({ ok: true });
    expect(fetch400.calls[0]!.url).toBe('http://127.0.0.1:9880/tts');
    expect(fetch400.calls[0]!.init.method).toBe('GET');

    const { service: s2 } = makeService({
      fetch: fakeFetch({ reject: new Error('ECONNREFUSED') }),
    });
    const r2 = await s2['voice.testEngine']({ engine: 'gptsovits' });
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/ECONNREFUSED/);
  });

  it('fishaudio：GET {apiBase}/model 带 bearer；2xx 通、401 报 HTTP 状态', async () => {
    const fetch = fakeFetch({ json: { total: 0, items: [] } });
    const { service } = makeService({
      prefs: prefsWith({ 'voice.engines.fishaudio.key': 'fk' }),
      fetch,
    });
    expect(await service['voice.testEngine']({ engine: 'fishaudio' })).toEqual({ ok: true });
    expect(fetch.calls[0]!.url).toBe('https://api.fish-audio.cn/model');
    expect(fetch.calls[0]!.init.headers['authorization']).toBe('Bearer fk');

    const { service: s2 } = makeService({
      prefs: prefsWith({ 'voice.engines.fishaudio.key': 'bad' }),
      fetch: fakeFetch({ status: 401 }),
    });
    const r2 = await s2['voice.testEngine']({ engine: 'fishaudio' });
    expect(r2).toEqual({ ok: false, error: 'HTTP 401' });
  });
});
