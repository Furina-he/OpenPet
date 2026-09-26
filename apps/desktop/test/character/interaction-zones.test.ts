import { describe, it, expect } from 'vitest';
import {
  tapZone,
  classifyPress,
  windowContour,
} from '../../src/renderer/character/interaction-zones';

describe('interaction-zones（A1 命中分区 + 按压判定）', () => {
  it('tapZone：上 38% 为头，其余为身', () => {
    expect(tapZone(10, 480)).toBe('head'); // y=10/480 ≈ 2%
    expect(tapZone(170, 480)).toBe('head'); // ≈35%
    expect(tapZone(200, 480)).toBe('body'); // ≈42%
    expect(tapZone(470, 480)).toBe('body');
  });
  it('classifyPress：短按未移动=tap；超时或移动=非 tap', () => {
    expect(classifyPress({ downT: 0, upT: 150, moved: false }, 200)).toBe('tap');
    expect(classifyPress({ downT: 0, upT: 300, moved: false }, 200)).toBe('none'); // 超长按（拖拽阈）
    expect(classifyPress({ downT: 0, upT: 100, moved: true }, 200)).toBe('none'); // 移动过
  });
});

describe('㉓ windowContour（轮廓 = 精灵轮廓 + 模型框偏移 ?? 模型框，窗口坐标）', () => {
  it('回归：100% 模型框 = 整窗 → 分区与旧的整窗口口径逐点一致', () => {
    const box = windowContour({ x: 0, y: 0, width: 320, height: 480 }, null);
    expect(box).toEqual({ top: 0, bottom: 480 });
    for (let y = 0; y <= 480; y += 5) expect(tapZone(y, 480, box)).toBe(tapZone(y, 480));
  });

  it('50%：模型框在舞台边下方 → 头身按模型框分（舞台边不算头）', () => {
    const box = windowContour({ x: 70, y: 120, width: 160, height: 240 }, null);
    expect(box).toEqual({ top: 120, bottom: 360 });
    expect(tapZone(200, 360, box)).toBe('head'); // (200-120)/240 ≈ 0.33
    expect(tapZone(220, 360, box)).toBe('body'); // ≈ 0.42
  });

  it('精灵轮廓（容器 = 模型框坐标）加模型框偏移换成窗口坐标', () => {
    expect(
      windowContour({ x: 30, y: 129, width: 240, height: 231 }, { top: 40, bottom: 231 }),
    ).toEqual({ top: 169, bottom: 360 });
  });
});
