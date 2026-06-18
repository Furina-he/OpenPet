import { describe, it, expect } from 'vitest';
import { initialRoute } from '../../src/renderer/dev/route';

describe('initialRoute', () => {
  it('reads ?page= when present', () => {
    expect(initialRoute('?page=system.display', 'overview')).toBe('system.display');
  });
  it('falls back to default when absent', () => {
    expect(initialRoute('', 'system.display')).toBe('system.display');
  });
});
