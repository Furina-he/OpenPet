import { describe, it, expect } from 'vitest';
import { durationMs, placeBubble } from '../../src/renderer/character/bubble-timer';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
/** 100% VRM 默认位：窗口 = 模型框 320×480。 */
const FULL = {
  bubbleW: 200,
  bubbleH: 80,
  windowW: 320,
  windowH: 480,
  windowScreen: { x: 1576, y: 536 },
  workArea: WA,
};
/** 50%：窗口 300×360，模型框 (70, 120, 160, 240)。 */
const HALF = { ...FULL, windowW: 300, windowH: 360, windowScreen: { x: 1586, y: 656 } };

describe('bubble-timer（A2 消失时长 + 定位）', () => {
  it('durationMs：3/5/8 转毫秒，always → null（常驻）', () => {
    expect(durationMs('3')).toBe(3000);
    expect(durationMs('5')).toBe(5000);
    expect(durationMs('8')).toBe(8000);
    expect(durationMs('always')).toBeNull();
  });

  it('100% VRM / Live2D：轮廓顶 = 0 → top 12、水平居中（零回归）', () => {
    expect(placeBubble({ ...FULL, boxTop: 0 })).toEqual({ left: 60, top: 12 });
  });

  it('50%：气泡落在头顶上方的舞台边里，完整不压脸', () => {
    const p = placeBubble({ ...HALF, boxTop: 120 });
    expect(p).toEqual({ left: 50, top: 32 });
    expect(p.top + 80).toBeLessThanOrEqual(120);
  });

  it('贴轮廓随文本增高上移，最高不越过窗口顶 12', () => {
    expect(placeBubble({ ...HALF, boxTop: 120, bubbleH: 150 }).top).toBe(12);
  });

  it('只看轮廓顶，不读气泡上一次的位置（修上下交替：同一输入永远同一结果）', () => {
    const a = placeBubble({ ...FULL, boxTop: 0 });
    const b = placeBubble({ ...FULL, boxTop: 0 });
    expect(b).toEqual(a);
  });

  it('窗口在屏顶（舞台边伸出工作区顶）：气泡不出屏，放不下就压在头上', () => {
    const p = placeBubble({ ...HALF, boxTop: 120, windowScreen: { x: 800, y: -120 } });
    expect(p.top).toBe(120);
  });

  it('被拖到屏顶外很远：也不出窗口底', () => {
    const p = placeBubble({ ...HALF, boxTop: 120, windowScreen: { x: 800, y: -1000 } });
    expect(p.top).toBe(360 - 80 - 12);
  });

  it('横向夹进工作区可见部分：贴右屏边左移、贴左屏边右移', () => {
    expect(placeBubble({ ...HALF, boxTop: 120, windowScreen: { x: 1700, y: 656 } }).left).toBe(20);
    expect(placeBubble({ ...HALF, boxTop: 120, windowScreen: { x: -100, y: 656 } }).left).toBe(100);
  });

  it('可见部分比气泡还窄：左对齐可见区（先保开头能读）', () => {
    expect(placeBubble({ ...HALF, boxTop: 120, windowScreen: { x: 1800, y: 656 } }).left).toBe(0);
  });

  it('无工作区信息：只按窗口居中', () => {
    expect(placeBubble({ ...HALF, boxTop: 120, workArea: null })).toEqual({ left: 50, top: 32 });
  });
});
