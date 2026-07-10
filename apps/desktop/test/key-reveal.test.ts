import { describe, it, expect, vi } from 'vitest';
import { maskKey, KeyReveal } from '../src/renderer/settings/key-reveal';

describe('maskKey', () => {
  it('短串全遮', () => expect(maskKey('abcd', false)).toBe('••••'));
  it('长串留首尾 4', () => expect(maskKey('sk-ant-0123456789', false)).toBe('sk-a•••••••••6789'));
  it('revealed 原样', () => expect(maskKey('sk-ant', true)).toBe('sk-ant'));
});

describe('KeyReveal 5s 遮回', () => {
  it('reveal → revealed=true，holdMs 后回 false；再 reveal 重置计时', () => {
    let cb: (() => void) | null = null;
    const timer = {
      set: (f: () => void) => {
        cb = f;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clear: vi.fn(),
    };
    const r = new KeyReveal(5000, timer);
    r.reveal();
    expect(r.revealed).toBe(true);
    cb!(); // 模拟 5s 到点
    expect(r.revealed).toBe(false);
    r.reveal();
    r.reveal(); // 第二次应先 clear 前一个计时
    expect(timer.clear).toHaveBeenCalled();
  });
});
