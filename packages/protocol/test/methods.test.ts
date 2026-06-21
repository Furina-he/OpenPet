import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods';
import { ChatStartFrame } from '../src/schemas.js';

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

describe('app.window.openHub', () => {
  it('registers with empty params', () => {
    expect(Methods['app.window.openHub'].params.safeParse({}).success).toBe(true);
    expect(Methods['app.window.openHub'].result.safeParse({ ok: true }).success).toBe(true);
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

describe('provider.* method registry (AstrBot 对齐)', () => {
  it('registers new two-layer methods, drops legacy key/list methods', () => {
    expect('provider.getConfig' in Methods).toBe(true);
    expect('provider.upsertSource' in Methods).toBe(true);
    expect('provider.testModel' in Methods).toBe(true);
    expect('provider.setDefault' in Methods).toBe(true);
    expect('provider.saveKey' in Methods).toBe(false);
    expect('provider.listProviders' in Methods).toBe(false);
  });
  it('provider.setDefault params validate capability + modelId', () => {
    expect(
      Methods['provider.setDefault'].params.safeParse({ capability: 'chat', modelId: 'a/b' }).success,
    ).toBe(true);
    expect(
      Methods['provider.setDefault'].params.safeParse({ capability: 'nope', modelId: 'a/b' }).success,
    ).toBe(false);
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

describe('ChatStartFrame adapter (Provider 工作台)', () => {
  it('accepts optional adapter', () => {
    const f = ChatStartFrame.parse({
      kind: 'chat.start',
      requestId: 'r',
      sessionId: 's',
      adapter: 'openai',
    });
    expect(f.adapter).toBe('openai');
  });
  it('rejects an unknown adapter', () => {
    expect(
      ChatStartFrame.safeParse({
        kind: 'chat.start',
        requestId: 'r',
        sessionId: 's',
        adapter: 'cohere',
      }).success,
    ).toBe(false);
  });
});

describe('chat.done error kind (M5)', () => {
  it('carries optional error + errorKind', () => {
    expect(
      Methods['chat.done'].params.safeParse({
        sessionId: 's',
        finishReason: 'error',
        error: 'boom',
        errorKind: 'auth',
      }).success,
    ).toBe(true);
    expect(Methods['chat.done'].params.safeParse({ sessionId: 's', finishReason: 'stop' }).success).toBe(
      true,
    );
    expect(
      Methods['chat.done'].params.safeParse({ sessionId: 's', finishReason: 'error', errorKind: 'bogus' })
        .success,
    ).toBe(false);
  });
});

describe('app.* data management (M6)', () => {
  it('registers app.storageUsage and app.exportData', () => {
    expect(Methods).toHaveProperty('app.storageUsage');
    expect(Methods).toHaveProperty('app.exportData');
  });

  it('app.storageUsage takes empty params and returns a non-negative usage shape', () => {
    expect(Methods['app.storageUsage'].params.safeParse({}).success).toBe(true);
    expect(
      Methods['app.storageUsage'].result.safeParse({ dbBytes: 0, messageCount: 0, characterCount: 0 })
        .success,
    ).toBe(true);
    expect(
      Methods['app.storageUsage'].result.safeParse({ dbBytes: -1, messageCount: 0, characterCount: 0 })
        .success,
    ).toBe(false);
  });

  it('app.exportData requires a non-empty outPath and returns ok+bytes', () => {
    expect(
      Methods['app.exportData'].params.safeParse({ outPath: 'C:/x/backup.dsbak' }).success,
    ).toBe(true);
    expect(Methods['app.exportData'].params.safeParse({ outPath: '' }).success).toBe(false);
    expect(Methods['app.exportData'].result.safeParse({ ok: true, bytes: 1024 }).success).toBe(true);
    expect(Methods['app.exportData'].result.safeParse({ ok: false, bytes: 0 }).success).toBe(false);
  });
});

describe('app.prefs.* methods', () => {
  it('registers getAll/set/changed', () => {
    expect(Methods['app.prefs.getAll']).toBeDefined();
    expect(
      Methods['app.prefs.set'].params.safeParse({ key: 'display.theme', value: 'dark' }).success,
    ).toBe(true);
    expect(Methods['app.prefs.set'].params.safeParse({ key: 'display.theme' }).success).toBe(false);
    expect(
      Methods['app.prefs.changed'].params.safeParse({ key: 'display.theme', value: 'dark' }).success,
    ).toBe(true);
  });
});
