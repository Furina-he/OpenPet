import { describe, it, expect } from 'vitest';
import {
  NOTCH,
  WheelScaler,
  scaleLabel,
  stepScale,
} from '../../src/renderer/character/scale-wheel';
import { snapScale } from '../../electron/main/window-scale';

describe('WheelScaler（Ctrl+滚轮累积）', () => {
  it('像素模式：deltaY 累积 100 = 一格，上滚（负）为放大', () => {
    const w = new WheelScaler();
    expect(NOTCH).toBe(100);
    expect(w.feed(-100, 0)).toBe(1);
    expect(w.feed(100, 0)).toBe(-1);
    expect(w.feed(-40, 0)).toBe(0);
    expect(w.feed(-40, 0)).toBe(0);
    expect(w.feed(-40, 0)).toBe(1); // 累积 120 → 一格，余 20
  });

  it('高 DPI 下单格 deltaY 为 125 / 150：单个事件至多记一格（不隔几格跳两档）', () => {
    const w = new WheelScaler();
    expect(Array.from({ length: 8 }, () => w.feed(-125, 0))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Array.from({ length: 4 }, () => w.feed(150, 0))).toEqual([-1, -1, -1, -1]);
  });

  it('行模式 3 行一格；页模式 1 页一格', () => {
    const w = new WheelScaler();
    expect(w.feed(-3, 1)).toBe(1);
    expect(w.feed(-1, 1)).toBe(0);
    expect(w.feed(-2, 1)).toBe(1);
    expect(w.feed(1, 2)).toBe(-1);
  });

  it('触控板 / 双指捏合的小增量累积；反向滚动先抵消', () => {
    const w = new WheelScaler();
    let steps = 0;
    for (let i = 0; i < 25; i++) steps += w.feed(-4, 0);
    expect(steps).toBe(1);
    expect(w.feed(-60, 0)).toBe(0);
    expect(w.feed(30, 0)).toBe(0); // 累积 60 → 30
    expect(w.feed(-70, 0)).toBe(1);
  });

  it('reset 清零累积（手势结束）', () => {
    const w = new WheelScaler();
    w.feed(-90, 0);
    w.reset();
    expect(w.feed(-20, 0)).toBe(0);
  });
});

describe('stepScale（目标值：常规 5% / 像素清晰档）', () => {
  const normal = { pixelSnap: false, presets: [0.5, 0.75, 1, 1.25, 1.5, 2], maxScale: 2 };
  const px = { pixelSnap: true, presets: [0.6667, 1.3333, 2], maxScale: 2 };

  it('常规：±5%、夹 [0.5, maxScale]、无浮点毛刺', () => {
    expect(stepScale(1, 1, normal)).toBe(1.05);
    expect(stepScale(1.05, 2, normal)).toBe(1.15);
    expect(stepScale(0.55, -3, normal)).toBe(0.5);
    expect(stepScale(1.95, 3, normal)).toBe(2);
  });

  it('常规：到顶取 maxScale（可不在网格上），往回滚先回网格', () => {
    const small = { ...normal, maxScale: 728 / 480 };
    expect(stepScale(1.5, 1, small)).toBe(728 / 480);
    expect(stepScale(728 / 480, -1, small)).toBe(1.45);
  });

  it('常规：与 Main snapScale 同口径（渲染端算的目标 = Main 吸附后的实际值，手势中不漂）', () => {
    for (const maxScale of [2, 728 / 480, 1.1]) {
      let s = 1;
      for (const steps of [1, 1, 3, -2, 5, 7, -9, -1, 4]) {
        s = stepScale(s, steps, { ...normal, maxScale });
        expect(snapScale(s, { pixelArt: false, dpr: 1, maxFit: maxScale })).toBe(s);
      }
    }
  });

  it('像素：在清晰档间跳，超出 maxScale 的档不去', () => {
    expect(stepScale(0.6667, 1, px)).toBe(1.3333);
    expect(stepScale(1.3333, 5, px)).toBe(2);
    expect(stepScale(1.3333, -9, px)).toBe(0.6667);
    expect(stepScale(1.3333, 1, { ...px, maxScale: 1.5 })).toBe(1.3333);
  });

  it('像素：当前值不在档上（换屏前的旧值）→ 按方向落到相邻清晰档', () => {
    expect(stepScale(1, 1, px)).toBe(1.3333);
    expect(stepScale(1, -1, px)).toBe(0.6667);
    expect(stepScale(1, 2, px)).toBe(2);
  });

  it('0 步不动', () => {
    expect(stepScale(1.15, 0, normal)).toBe(1.15);
    expect(stepScale(1.3333, 0, px)).toBe(1.3333);
  });
});

describe('scaleLabel（缩放胶囊文案）', () => {
  it('常规 = 百分比；像素 = 设备倍数 + 百分比', () => {
    expect(scaleLabel(1.2, false, 1)).toBe('120%');
    expect(scaleLabel(728 / 480, false, 1)).toBe('152%');
    expect(scaleLabel(1.3333, true, 1.5)).toBe('2× · 133%');
    expect(scaleLabel(1, true, 1)).toBe('1× · 100%');
  });
});
