import { describe, it, expect } from 'vitest';
import { defineProvider } from '../src/define-provider.js';
import type { ChatProvider } from '../src/types.js';

describe('defineProvider', () => {
  it('returns a ChatProvider with required fields', () => {
    const provider = defineProvider({
      id: 'test-provider',
      name: 'Test Provider',
      capabilities: { tools: false, vision: false },
      async *chat() {
        yield { type: 'delta', text: 'hello' };
        yield { type: 'done', finishReason: 'stop' };
      },
    });
    expect(provider.id).toBe('test-provider');
    expect(provider.name).toBe('Test Provider');
    expect(provider.capabilities.tools).toBe(false);
  });
});
