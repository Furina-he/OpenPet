import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods';

describe('method registry', () => {
  it('defines sys.ping params and result schemas', () => {
    const spec = Methods['sys.ping'];
    expect(spec.params.parse({ nonce: 'abc' })).toEqual({ nonce: 'abc' });
    expect(spec.result.parse({ pong: 'ok', echoNonce: 'abc' })).toEqual({
      pong: 'ok',
      echoNonce: 'abc',
    });
  });

  it('rejects sys.ping params missing nonce', () => {
    expect(() => Methods['sys.ping'].params.parse({})).toThrow();
  });

  it('defines chat.send params and result schemas', () => {
    const spec = Methods['chat.send'];
    expect(spec.params.parse({ sessionId: 's1', text: 'hi' })).toEqual({
      sessionId: 's1',
      text: 'hi',
    });
    expect(spec.result.parse({ ok: true })).toEqual({ ok: true });
  });

  it('rejects chat.send result with ok=false', () => {
    expect(() => Methods['chat.send'].result.parse({ ok: false })).toThrow();
  });

  it('defines chat.stream notification params', () => {
    expect(
      Methods['chat.stream'].params.parse({ sessionId: 's1', text: '嗯…', seq: 1 }),
    ).toEqual({ sessionId: 's1', text: '嗯…', seq: 1 });
  });

  it('constrains chat.done finishReason to the allowed set', () => {
    expect(Methods['chat.done'].params.parse({ sessionId: 's1', finishReason: 'cancel' })).toEqual({
      sessionId: 's1',
      finishReason: 'cancel',
    });
    expect(() =>
      Methods['chat.done'].params.parse({ sessionId: 's1', finishReason: 'boom' }),
    ).toThrow();
  });

  it('defines behavior.applyEmotion params', () => {
    expect(Methods['behavior.applyEmotion'].params.parse({ name: 'shy', weight: 1 })).toEqual({
      name: 'shy',
      weight: 1,
    });
  });

  it('allows null durationMs on behavior.playAction', () => {
    expect(Methods['behavior.playAction'].params.parse({ name: 'wave', durationMs: null })).toEqual(
      { name: 'wave', durationMs: null },
    );
    expect(
      Methods['behavior.playAction'].params.parse({ name: 'fidget', durationMs: 1800 }),
    ).toEqual({ name: 'fidget', durationMs: 1800 });
  });
});

describe('chat.snapshot (M2)', () => {
  it('validates params with optional bounded limit', () => {
    const m = Methods['chat.snapshot'];
    expect(m.params.safeParse({ sessionId: 's1' }).success).toBe(true);
    expect(m.params.safeParse({ sessionId: 's1', limit: 50 }).success).toBe(true);
    expect(m.params.safeParse({ sessionId: 's1', limit: 0 }).success).toBe(false);
    expect(m.params.safeParse({ sessionId: 's1', limit: 201 }).success).toBe(false);
  });

  it('validates result shape incl. unsealed streaming message', () => {
    const m = Methods['chat.snapshot'];
    const r = m.result.parse({
      sessionId: 's1',
      messages: [
        { role: 'user', text: 'hi', finishReason: null },
        { role: 'assistant', text: '嗯…', finishReason: null },
      ],
      streaming: true,
      seq: 3,
    });
    expect(r.messages).toHaveLength(2);
    expect(() =>
      m.result.parse({ sessionId: 's1', messages: [], streaming: false, seq: -1 }),
    ).toThrow();
  });
});

describe('chat.stream seq (M2)', () => {
  it('requires a non-negative integer seq', () => {
    const m = Methods['chat.stream'];
    expect(m.params.safeParse({ sessionId: 's1', text: 'a', seq: 1 }).success).toBe(true);
    expect(m.params.safeParse({ sessionId: 's1', text: 'a' }).success).toBe(false);
    expect(m.params.safeParse({ sessionId: 's1', text: 'a', seq: 1.5 }).success).toBe(false);
  });
});

describe('plugin.* methods (M2)', () => {
  it('validates registerSkill', () => {
    const m = Methods['plugin.registerSkill'];
    expect(m.params.safeParse({ skillId: 'demo', title: 'Demo' }).success).toBe(true);
    expect(m.params.safeParse({ skillId: '', title: 'Demo' }).success).toBe(false);
    expect(m.result.parse({ ok: true })).toEqual({ ok: true });
  });

  it('validates permissionRequest with optional reason', () => {
    const m = Methods['plugin.permissionRequest'];
    expect(m.params.safeParse({ permission: 'net.fetch' }).success).toBe(true);
    expect(m.params.safeParse({ permission: 'net.fetch', reason: 'call api' }).success).toBe(true);
    expect(m.params.safeParse({}).success).toBe(false);
    expect(m.result.parse({ granted: false })).toEqual({ granted: false });
  });

  it('validates invokeTool with arbitrary args', () => {
    const m = Methods['plugin.invokeTool'];
    expect(m.params.safeParse({ toolId: 'echo', args: { x: 1 } }).success).toBe(true);
    expect(m.params.safeParse({ toolId: 'echo' }).success).toBe(true);
    expect(m.params.safeParse({ toolId: '' }).success).toBe(false);
  });
});

describe('app.window.* methods', () => {
  it('validates setClickThrough params', () => {
    const m = Methods['app.window.setClickThrough'];
    expect(m.params.safeParse({ ignore: true }).success).toBe(true);
    expect(m.params.safeParse({ ignore: 'yes' }).success).toBe(false);
    expect(m.params.safeParse({}).success).toBe(false);
  });

  it('validates moveBy params', () => {
    const m = Methods['app.window.moveBy'];
    expect(m.params.safeParse({ dx: 3, dy: -2 }).success).toBe(true);
    expect(m.params.safeParse({ dx: 3 }).success).toBe(false);
    expect(m.params.safeParse({ dx: 'a', dy: 0 }).success).toBe(false);
  });
});

describe('character.* + behavior.lookAt (M4)', () => {
  it('character.current takes empty params and returns manifest envelope', () => {
    expect(Methods['character.current'].params.safeParse({}).success).toBe(true);
    const r = Methods['character.current'].result.safeParse({
      characterId: 'default',
      manifest: {
        id: 'default',
        name: '小灵',
        version: '0.1.0',
        engine: 'vrm',
        model: 'model.vrm',
      },
    });
    expect(r.success).toBe(true);
  });

  it('character.setScale bounds scale to [0.5, 2]', () => {
    expect(Methods['character.setScale'].params.safeParse({ scale: 1 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 0.5 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 2 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 0.4 }).success).toBe(false);
    expect(Methods['character.setScale'].params.safeParse({ scale: 2.1 }).success).toBe(false);
  });

  it('character.idleTimeout requires positive integer idleMs', () => {
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 90000 }).success).toBe(true);
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 0 }).success).toBe(false);
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 1.5 }).success).toBe(false);
  });

  it('behavior.lookAt is a notification with screen coords', () => {
    expect(Methods['behavior.lookAt'].params.safeParse({ x: 100, y: -3 }).success).toBe(true);
    expect(Methods['behavior.lookAt'].params.safeParse({ x: 'a', y: 0 }).success).toBe(false);
  });
});

describe('provider.* methods (M5)', () => {
  it('registers the provider namespace', () => {
    for (const m of [
      'provider.saveKey',
      'provider.deleteKey',
      'provider.listProviders',
      'provider.testConnection',
      'provider.listModels',
      'provider.ollamaDetect',
    ]) {
      expect(Methods).toHaveProperty(m);
    }
  });
  it('provider.saveKey params accept providerId + key', () => {
    expect(
      Methods['provider.saveKey'].params.safeParse({ providerId: 'openai', key: 'sk-x' }).success,
    ).toBe(true);
    expect(Methods['provider.saveKey'].params.safeParse({ providerId: 'openai' }).success).toBe(
      false,
    );
  });
  it('provider.testConnection result carries ok + optional errorKind', () => {
    expect(
      Methods['provider.testConnection'].result.safeParse({ ok: false, errorKind: 'auth' }).success,
    ).toBe(true);
    expect(Methods['provider.testConnection'].result.safeParse({ ok: true }).success).toBe(true);
  });
  it('provider.ollamaDetect result lists available + models', () => {
    expect(
      Methods['provider.ollamaDetect'].result.safeParse({ available: true, models: ['llama3'] })
        .success,
    ).toBe(true);
  });
  it('chat.send accepts optional providerId', () => {
    expect(
      Methods['chat.send'].params.safeParse({ sessionId: 's', text: 't', providerId: 'openai' })
        .success,
    ).toBe(true);
  });
});
