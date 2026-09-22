import { describe, it, expect, vi } from 'vitest';
import { MOOD_SENTENCES, PrefsSchema, type Prefs } from '@openpet/protocol';
import { createContextPipeline } from '../electron/main/context-pipeline.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';
import {
  createVoiceService,
  effectiveRate,
  voiceRateFactor,
  type FetchLike,
} from '../electron/main/voice-service.js';
import { InteractionService } from '../electron/main/interaction-service.js';
import { MoodState } from '../electron/main/mood-state.js';
import { DEFAULT_CUES } from '@openpet/protocol';

describe('⑱ mood → 灵魂：组装链心情句', () => {
  const build = async (mood: number | undefined) => {
    const trace: Array<[string, unknown]> = [];
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      ...(mood !== undefined ? { mood: () => mood } : {}),
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi', trace: (a, f) => trace.push([a, f]) });
    return { system: req.messages[0]!.content, trace };
  };

  it('mood 0.8 → 轻快句进 system prompt + trace context.mood', async () => {
    const { system, trace } = await build(0.8);
    expect(system).toContain(MOOD_SENTENCES.high);
    expect(trace.find(([a]) => a === 'context.mood')?.[1]).toEqual({ value: 0.8 });
  });

  it('mood −0.8 → 低落句；0 → 不加；缺省供给 → 不加不 trace', async () => {
    expect((await build(-0.8)).system).toContain(MOOD_SENTENCES.low);
    const neutral = await build(0);
    expect(neutral.system).not.toContain(MOOD_SENTENCES.high);
    expect(neutral.system).not.toContain(MOOD_SENTENCES.low);
    const none = await build(undefined);
    expect(none.trace.some(([a]) => a === 'context.mood')).toBe(false);
  });

  it('InteractionService.moodValue() 暴露 lazy 半衰心情（ChatService 供给源）', () => {
    let pref = { value: 0.5, updatedAt: 0 };
    const svc = new InteractionService({
      cues: () => DEFAULT_CUES,
      broadcast: () => {},
      getPrefs: () => PrefsSchema.parse({}),
      mood: new MoodState({ getPref: () => pref, setPref: (v) => (pref = v), now: () => 0 }),
    });
    expect(svc.moodValue()).toBeCloseTo(0.5, 9);
  });
});

describe('⑱ mood + energy → 声音：语速因子', () => {
  it('因子表：high 1.06 / low 0.94 / mid 1；mood<−0.3 再 ×0.97', () => {
    expect(voiceRateFactor('high', 0)).toBeCloseTo(1.06, 9);
    expect(voiceRateFactor('low', 0)).toBeCloseTo(0.94, 9);
    expect(voiceRateFactor('mid', 0)).toBe(1);
    expect(voiceRateFactor(undefined, 0)).toBe(1);
    expect(voiceRateFactor('high', -0.8)).toBeCloseTo(1.06 * 0.97, 9);
    expect(voiceRateFactor(undefined, -0.8)).toBeCloseTo(0.97, 9);
  });

  const prefs = (over: Partial<Prefs>): Prefs => PrefsSchema.parse(over);

  it('effectiveRate：门开 = rate×因子夹 [0.5,2]；门关 = 原 rate', () => {
    const now = Date.now();
    const p = prefs({ 'voice.rate': 1.5, 'pet.mood': { value: -0.9, updatedAt: now } });
    expect(effectiveRate(p, 'high')).toBeCloseTo(1.5 * 1.06 * 0.97, 6);
    expect(effectiveRate(prefs({ 'voice.rate': 2, 'pet.mood': { value: 0, updatedAt: now } }), 'high')).toBe(2);
    expect(
      effectiveRate(prefs({ 'voice.rate': 1.5, 'pet.moodAffectsVoice': false, 'pet.mood': { value: -0.9, updatedAt: now } }), 'high'),
    ).toBe(1.5);
  });

  it('voice.speak（openai 兼容）请求体 speed = 生效语速', async () => {
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        json: async () => ({}),
        text: async () => '',
      };
    };
    const p = prefs({
      'model.providerSources': [
        { id: 's', adapter: 'openai', capability: 'tts', apiBase: 'http://x/v1', key: 'k', enabled: true },
      ],
      'model.models': [{ id: 'm', sourceId: 's', model: 'tts-1', enabled: true }],
      'model.defaultTtsModelId': 'm',
      'voice.rate': 1,
      'pet.mood': { value: 0, updatedAt: Date.now() },
    });
    const svc = createVoiceService({
      getPrefs: () => p,
      broadcast: () => {},
      lastAssistantText: vi.fn(() => null),
      fetchImpl,
      lastEnergy: () => 'low',
      getActiveCharacterVoice: () => undefined,
      voicesDir: '/vd',
      readVoiceFile: () => null,
      writeVoiceFile: () => {},
      moveVoiceFile: () => {},
      removeVoiceDir: () => {},
    });
    await svc['voice.speak']({ text: '你好' });
    expect((calls[0]!.body as { speed: number }).speed).toBeCloseTo(0.94, 9);
  });
});
