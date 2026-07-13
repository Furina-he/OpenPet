import { DEFAULT_PREFS, type Prefs } from '@openpet/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildClassifyMessages,
  createEmotionFallback,
  parseEmotionLabel,
} from '../electron/main/emotion-fallback.js';
import type { FetchLike } from '../electron/main/rerank-client.js';

const EMOS = ['happy', 'sad', 'shy'];
const TARGET = { apiBase: 'http://x', model: 'm', key: 'k', adapter: 'openai' };

function fakeFetch(reply: string, log: string[] = [], ok = true): FetchLike {
  return (async (_url: string, init?: { body?: string }) => {
    log.push(init?.body ?? '');
    return { ok, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  }) as unknown as FetchLike;
}

function make(over: {
  reply?: string;
  prefs?: Partial<Prefs>;
  target?: typeof TARGET | null;
  log?: string[];
  ok?: boolean;
}) {
  const broadcasts: Array<[string, unknown]> = [];
  const svc = createEmotionFallback({
    fetchImpl: fakeFetch(over.reply ?? 'happy', over.log ?? [], over.ok ?? true),
    resolveTarget: () => (over.target === undefined ? TARGET : over.target),
    getPrefs: () => ({ ...DEFAULT_PREFS, ...(over.prefs ?? {}) }),
    emotions: () => EMOS,
    broadcast: (ch, p) => broadcasts.push([ch, p]),
  });
  return { svc, broadcasts };
}

describe('parseEmotionLabel', () => {
  it('词表命中（大小写/引号/标点容错）', () => {
    expect(parseEmotionLabel('Happy', EMOS)).toBe('happy');
    expect(parseEmotionLabel('"shy"。\n', EMOS)).toBe('shy');
    expect(parseEmotionLabel(' sad ', EMOS)).toBe('sad');
  });
  it('neutral / 未命中 / 空 → null', () => {
    expect(parseEmotionLabel('neutral', EMOS)).toBeNull();
    expect(parseEmotionLabel('excited', EMOS)).toBeNull();
    expect(parseEmotionLabel('', EMOS)).toBeNull();
  });
});

describe('buildClassifyMessages', () => {
  it('system 含全词表 + neutral；user 截断 800', () => {
    const msgs = buildClassifyMessages('x'.repeat(900), EMOS);
    expect(msgs[0]?.content).toContain('happy, sad, shy, neutral');
    expect(msgs[1]?.content).toHaveLength(800);
  });
});

describe('createEmotionFallback.onTurnEnd', () => {
  it('命中 → 广播 behavior.applyEmotion {name, weight:1}', async () => {
    const { svc, broadcasts } = make({ reply: 'shy' });
    await svc.onTurnEnd('s1', '嗯……那个，要不要一起喝热可可？');
    expect(broadcasts).toEqual([['behavior.applyEmotion', { name: 'shy', weight: 1 }]]);
  });
  it('neutral / 胡言乱语 → 不广播', async () => {
    const a = make({ reply: 'neutral' });
    await a.svc.onTurnEnd('s1', '今天天气不错，适合出门散步。');
    const b = make({ reply: '这句话的情绪是开心的！' });
    await b.svc.onTurnEnd('s1', '今天天气不错，适合出门散步。');
    expect(a.broadcasts).toEqual([]);
    expect(b.broadcasts).toEqual([]);
  });
  it('pref 关 / 文本过短 / 无目标 / 非 openai adapter → 不发请求', async () => {
    const log: string[] = [];
    const off = make({ prefs: { 'general.emotionFallback': false }, log });
    await off.svc.onTurnEnd('s1', '这句话足够长了吧。');
    const short = make({ log });
    await short.svc.onTurnEnd('s1', '嗯。');
    const noTarget = make({ target: null, log });
    await noTarget.svc.onTurnEnd('s1', '这句话足够长了吧。');
    const wrongAdapter = make({ target: { ...TARGET, adapter: 'anthropic' }, log });
    await wrongAdapter.svc.onTurnEnd('s1', '这句话足够长了吧。');
    expect(log).toEqual([]);
  });
  it('请求体：temperature 0 + stream false + 词表 prompt', async () => {
    const log: string[] = [];
    const { svc } = make({ log });
    await svc.onTurnEnd('s1', '太好了，我们马上出发吧！');
    const body = JSON.parse(log[0] ?? '{}') as { temperature: number; stream: boolean };
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
  });
  it('HTTP 非 200 / fetch 抛异常 → 静默不抛不广播', async () => {
    const bad = make({ ok: false });
    await bad.svc.onTurnEnd('s1', '这句话足够长了吧。');
    expect(bad.broadcasts).toEqual([]);
    const broadcasts: Array<[string, unknown]> = [];
    const throwing = createEmotionFallback({
      fetchImpl: (async () => {
        throw new Error('net down');
      }) as unknown as FetchLike,
      resolveTarget: () => TARGET,
      getPrefs: () => DEFAULT_PREFS,
      emotions: () => EMOS,
      broadcast: (ch, p) => broadcasts.push([ch, p]),
    });
    await expect(throwing.onTurnEnd('s1', '这句话足够长了吧。')).resolves.toBeUndefined();
    expect(broadcasts).toEqual([]);
  });
});
