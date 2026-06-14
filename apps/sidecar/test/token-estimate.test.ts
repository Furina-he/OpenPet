import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessagesTokens } from '../src/workers/token-estimate.js';

describe('token estimate', () => {
  it('estimates a non-zero count for text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('estimates messages with per-message overhead', () => {
    expect(estimateMessagesTokens([{ role: 'user', content: 'hi' }])).toBeGreaterThan(0);
  });

  it('longer text estimates to more tokens', () => {
    expect(estimateTokens('a much longer sentence with many words')).toBeGreaterThan(
      estimateTokens('hi'),
    );
  });
});
