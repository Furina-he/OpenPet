import { describe, it, expect } from 'vitest';
import { nextIgnore } from '../src/renderer/character/hysteresis';

const T = { enter: 26, exit: 13 };

describe('nextIgnore (双阈值迟滞)', () => {
  it('initial state: solid when alpha >= enter, through when below', () => {
    expect(nextIgnore(30, null, T)).toBe(false);
    expect(nextIgnore(20, null, T)).toBe(true);
  });

  it('stays solid inside the hysteresis band (exit <= alpha < enter)', () => {
    expect(nextIgnore(20, false, T)).toBe(false);
  });

  it('leaves solid only when alpha < exit', () => {
    expect(nextIgnore(10, false, T)).toBe(true);
    expect(nextIgnore(13, false, T)).toBe(false);
  });

  it('from through-state, enters solid only at alpha >= enter', () => {
    expect(nextIgnore(20, true, T)).toBe(true);
    expect(nextIgnore(28, true, T)).toBe(false);
    expect(nextIgnore(26, true, T)).toBe(false);
  });
});
