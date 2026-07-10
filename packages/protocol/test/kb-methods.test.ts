import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods.js';
import { PrefsSchema } from '../src/prefs.js';
import { ProviderInboundFrame, ProviderOutboundFrame } from '../src/schemas.js';

describe('prefs kb 键', () => {
  it('默认空 kb.list + knowledgeBase=true', () => {
    const p = PrefsSchema.parse({});
    expect(p['kb.list']).toEqual([]);
    expect(p['privacy.knowledgeBase']).toBe(true);
  });
});
describe('kb.* 方法', () => {
  it('8 方法齐备', () => {
    for (const m of [
      'kb.list',
      'kb.create',
      'kb.delete',
      'kb.update',
      'kb.addDocument',
      'kb.listDocuments',
      'kb.deleteDocument',
      'kb.search',
    ])
      expect(m in Methods).toBe(true);
  });
});
describe('embed 帧', () => {
  it('embed.request 入 Inbound，embed.result 入 Outbound', () => {
    expect(
      ProviderInboundFrame.safeParse({
        kind: 'embed.request',
        requestId: 'r',
        model: 'm',
        inputs: ['a'],
      }).success,
    ).toBe(true);
    expect(
      ProviderOutboundFrame.safeParse({
        kind: 'embed.result',
        requestId: 'r',
        vectors: [[0.1, 0.2]],
      }).success,
    ).toBe(true);
  });
});
