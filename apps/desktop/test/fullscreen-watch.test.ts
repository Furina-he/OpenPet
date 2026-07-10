import { describe, it, expect, vi } from 'vitest';
import { isLikelyFullscreen, createFullscreenWatch } from '../electron/main/fullscreen-watch';

describe('fullscreen-watch（best-effort）', () => {
  it('isLikelyFullscreen：前台窗矩形≈工作区视为全屏', () => {
    expect(isLikelyFullscreen({ x: 0, y: 0, w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toBe(true);
    expect(isLikelyFullscreen({ x: 100, y: 100, w: 800, h: 600 }, { w: 1920, h: 1080 })).toBe(false);
  });
  it('createFullscreenWatch：状态变化才回调', () => {
    const states = [false, false, true, true, false];
    let i = 0;
    const onChange = vi.fn();
    const w = createFullscreenWatch({ probe: () => states[i++] ?? false, onChange });
    for (let k = 0; k < states.length; k++) w.tick();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false]); // 仅变化沿
    w.stop();
  });
});
