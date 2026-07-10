import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/renderer/theme/theme-resolver';

describe('resolveTheme', () => {
  it("maps 'light'/'dark' straight through", () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it("'system' follows the OS preference", () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
