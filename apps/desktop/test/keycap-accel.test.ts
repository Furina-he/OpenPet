import { describe, it, expect } from 'vitest';
import { toAccelerator } from '../src/renderer/settings/keycap-accel';

describe('toAccelerator（KeyboardEvent→Electron accelerator）', () => {
  it('修饰 + 字母', () => {
    expect(
      toAccelerator({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'd' }),
    ).toBe('CommandOrControl+Shift+D');
  });
  it('纯修饰键返回空（未完成）', () => {
    expect(
      toAccelerator({
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        key: 'Control',
      }),
    ).toBe('');
  });
});
