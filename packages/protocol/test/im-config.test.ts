import { describe, it, expect } from 'vitest';
import {
  ImPlatformSchema,
  validateImPlatform,
  imOrigin,
  parseImOrigin,
  isImSession,
} from '../src/im-config.js';

describe('im-config', () => {
  it('平台 schema 默认值齐全', () => {
    const p = ImPlatformSchema.parse({ id: 'a', type: 'telegram', name: 'TG' });
    expect(p.enable).toBe(true);
    expect(p.apiBase).toBe('https://api.telegram.org');
    expect(p.wsUrl).toBe('');
  });
  it('validate 按 type 校验必填', () => {
    const tg = ImPlatformSchema.parse({ id: 'a', type: 'telegram', name: 'x' });
    expect(() => validateImPlatform(tg)).toThrow(/botToken/);
    const ob = ImPlatformSchema.parse({ id: 'b', type: 'onebot-v11', name: 'x' });
    expect(() => validateImPlatform(ob)).toThrow(/wsUrl/);
    expect(() => validateImPlatform({ ...ob, wsUrl: 'ws://127.0.0.1:3001' })).not.toThrow();
  });
  it('origin 组装/反解/识别', () => {
    const o = imOrigin('qq1', 'group', '123');
    expect(o).toBe('im:qq1:group:123');
    expect(parseImOrigin(o)).toEqual({ platformId: 'qq1', kind: 'group', chatId: '123' });
    expect(parseImOrigin('default')).toBeNull();
    expect(isImSession(o)).toBe(true);
    expect(isImSession('default')).toBe(false);
  });
});
