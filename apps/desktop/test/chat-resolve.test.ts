import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../electron/main/chat-resolve';
import type { ChatTarget } from '@openpet/protocol';

describe('resolveSendTarget (两层)', () => {
  it('显式 providerId 优先（单项 chain，无 model/adapter/baseUrl）', () => {
    expect(resolveSendTarget('openai-main', [], undefined)).toEqual({ chain: ['openai-main'] });
  });

  it('resolved 命中 → chain=[sourceId] + model/adapter/baseUrl', () => {
    const resolved: ChatTarget = {
      sourceId: 'openai-main',
      adapter: 'openai',
      apiBase: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    };
    expect(resolveSendTarget(undefined, ['fallback'], resolved)).toEqual({
      chain: ['openai-main'],
      model: 'gpt-4o',
      adapter: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('无 resolved（null/undefined）→ 回退静态 chain', () => {
    expect(resolveSendTarget(undefined, ['openai-main'], null)).toEqual({ chain: ['openai-main'] });
    expect(resolveSendTarget(undefined, [], undefined)).toEqual({ chain: [] });
  });
});
