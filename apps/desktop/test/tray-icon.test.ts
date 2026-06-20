import { describe, it, expect } from 'vitest';
import { trayIconKey } from '../electron/main/tray-icon';

describe('trayIconKey（J1 三态）', () => {
  it('异常 > 思考 > 默认', () => {
    expect(trayIconKey({ error: true, thinking: true })).toBe('error');
    expect(trayIconKey({ error: false, thinking: true })).toBe('thinking');
    expect(trayIconKey({ error: false, thinking: false })).toBe('default');
  });
});
