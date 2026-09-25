import { describe, it, expect } from 'vitest';
import {
  HitGate,
  bufferPixel,
  clientFromScreen,
} from '../../src/renderer/character/hit-recheck';

describe('clientFromScreen（屏幕光标 − 窗口原点）', () => {
  it('窗口原点随缩放移动：同一个静止光标换算出不同的 client 坐标', () => {
    const cursor = { x: 1700, y: 900 };
    // 100% VRM 默认位：窗口 (1576, 536) 320×480
    expect(clientFromScreen(cursor, { x: 1576, y: 536 })).toEqual({ x: 124, y: 364 });
    // 以脚底为锚缩到 50%：窗口挪到 (1586, 656) 300×360 → 光标没动，client 变了
    expect(clientFromScreen(cursor, { x: 1586, y: 656 })).toEqual({ x: 114, y: 244 });
  });
});

describe('bufferPixel（client → 画布局部 → ×pixelRatio → GL 翻 y）', () => {
  const box = { left: 70, top: 120, width: 160, height: 240 };

  it('画布四角', () => {
    const buf = { width: 240, height: 360 };
    expect(bufferPixel({ x: 70, y: 120 }, box, 1.5, buf)).toEqual({ x: 0, y: 359 });
    expect(bufferPixel({ x: 229.9, y: 359.9 }, box, 1.5, buf)).toEqual({ x: 239, y: 0 });
  });

  it('画布外（透明舞台边）→ null = 透明', () => {
    const buf = { width: 160, height: 240 };
    expect(bufferPixel({ x: 20, y: 200 }, box, 1, buf)).toBeNull();
    expect(bufferPixel({ x: 100, y: 60 }, box, 1, buf)).toBeNull();
    expect(bufferPixel({ x: 230, y: 200 }, box, 1, buf)).toBeNull();
    expect(bufferPixel({ x: 100, y: 360 }, box, 1, buf)).toBeNull();
  });

  it('回归：100% 画布铺满整窗时与旧换算（S1）同一像素', () => {
    const full = { left: 0, top: 0, width: 320, height: 480 };
    const buf = { width: 400, height: 600 };
    const legacy = (x: number, y: number) => ({
      x: Math.floor(x * 1.25),
      y: Math.floor(600 - y * 1.25),
    });
    for (const [x, y] of [
      [100.4, 200.4],
      [1.3, 477.1],
      [318.7, 3.3],
    ] as const) {
      expect(bufferPixel({ x, y }, full, 1.25, buf)).toEqual(legacy(x, y));
    }
  });

  it('缩放后静止光标：旧窗口下在角色身上，新窗口下落进舞台边 → 判透明', () => {
    const cursor = { x: 1600, y: 700 };
    const before = clientFromScreen(cursor, { x: 1576, y: 536 }); // (24, 164)
    const full = { left: 0, top: 0, width: 320, height: 480 };
    expect(bufferPixel(before, full, 1, { width: 320, height: 480 })).not.toBeNull();
    const after = clientFromScreen(cursor, { x: 1586, y: 656 }); // (14, 44)
    expect(bufferPixel(after, box, 1, { width: 160, height: 240 })).toBeNull();
  });
});

describe('HitGate（冻结 / 解冻状态机）', () => {
  it('拖拽或滚轮手势任一进行中即冻结穿透切换', () => {
    const g = new HitGate();
    expect(g.frozen).toBe(false);
    g.set('wheel', true);
    expect(g.frozen).toBe(true);
  });

  it('全部结束才解冻；解冻那一下返回 true（调用方立即重判）', () => {
    const g = new HitGate();
    expect(g.set('wheel', true)).toBe(false);
    expect(g.set('drag', true)).toBe(false);
    expect(g.set('wheel', false)).toBe(false); // 拖拽仍在
    expect(g.frozen).toBe(true);
    expect(g.set('drag', false)).toBe(true);
    expect(g.frozen).toBe(false);
    expect(g.set('drag', false)).toBe(false); // 本就没冻结：不重复重判
  });

  it('全局穿透（A3）锁定期间同样不切；解锁即要求重判', () => {
    const g = new HitGate();
    g.set('locked', true);
    expect(g.frozen).toBe(true);
    expect(g.set('locked', false)).toBe(true);
  });
});
