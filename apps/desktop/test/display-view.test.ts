import { describe, it, expect } from 'vitest';
import type { CharacterLayout } from '@openpet/protocol';
import {
  SCREEN_PREVIEW_W,
  pctLabel,
  pixelStopsView,
  screenPreview,
  sliderView,
} from '../src/renderer/settings/display-view';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };

function layout(over: Partial<CharacterLayout> = {}): CharacterLayout {
  return {
    scale: 1,
    maxScale: 2,
    pixelSnap: false,
    dpr: 1,
    presets: [0.5, 0.75, 1, 1.25, 1.5, 2],
    window: { width: 320, height: 480 },
    model: { x: 0, y: 0, width: 320, height: 480 },
    screen: { workArea: WA, windowBounds: { x: 1576, y: 536, width: 320, height: 480 } },
    ...over,
  };
}

describe('screenPreview（D4 屏幕示意：工作区缩略框 + 模型框等比）', () => {
  it('工作区等比缩到 160 宽；模型框按同一比例落位', () => {
    const p = screenPreview(layout());
    const k = SCREEN_PREVIEW_W / 1920;
    expect(p.width).toBe(160);
    expect(p.height).toBe(Math.round(1040 * k));
    expect(p.model.left).toBeCloseTo(1576 * k, 6);
    expect(p.model.top).toBeCloseTo(536 * k, 6);
    expect(p.model.width).toBeCloseTo(320 * k, 6);
    expect(p.model.height).toBeCloseTo(480 * k, 6);
  });

  it('模型框 ≠ 窗口（50% 有舞台边）：用模型框不用窗口', () => {
    const p = screenPreview(
      layout({
        scale: 0.5,
        window: { width: 300, height: 360 },
        model: { x: 70, y: 120, width: 160, height: 240 },
        screen: { workArea: WA, windowBounds: { x: 1666, y: 656, width: 300, height: 360 } },
      }),
    );
    const k = 160 / 1920;
    expect(p.model.left).toBeCloseTo((1666 + 70) * k, 6);
    expect(p.model.top).toBeCloseTo((656 + 120) * k, 6);
    expect(p.model.width).toBeCloseTo(160 * k, 6);
  });

  it('副屏（工作区原点非零）按工作区相对坐标算', () => {
    const side = { x: 1920, y: 0, width: 2560, height: 1400 };
    const p = screenPreview(
      layout({ screen: { workArea: side, windowBounds: { x: 3000, y: 600, width: 320, height: 480 } } }),
    );
    expect(p.model.left).toBeCloseTo((3000 - 1920) * (160 / 2560), 6);
    expect(p.height).toBe(Math.round(1400 * (160 / 2560)));
  });

  it('模型框再小也至少 2px 可见；工作区为 0 不出 NaN', () => {
    const tiny = screenPreview(layout({ model: { x: 0, y: 0, width: 4, height: 6 } }));
    expect(tiny.model.width).toBe(2);
    expect(tiny.model.height).toBe(2);
    const zero = screenPreview(
      layout({ screen: { workArea: { x: 0, y: 0, width: 0, height: 0 }, windowBounds: WA } }),
    );
    expect(Number.isNaN(zero.height) || Number.isNaN(zero.model.left)).toBe(false);
  });
});

describe('sliderView / pixelStopsView / pctLabel', () => {
  it('常规滑块：50% ~ maxScale，步进 5%，右端标签跟 maxScale', () => {
    expect(sliderView(layout())).toEqual({ min: 0.5, max: 2, step: 0.05, minLabel: '50%', maxLabel: '200%' });
    expect(sliderView(layout({ maxScale: 728 / 480 })).maxLabel).toBe('152%');
  });

  it('像素清晰档分段按钮：k× + 百分比，> maxScale 禁用，当前档高亮', () => {
    const v = pixelStopsView(
      layout({ pixelSnap: true, dpr: 1.5, presets: [0.6667, 1.3333, 2], scale: 1.3333, maxScale: 1.5 }),
    );
    expect(v).toEqual([
      { value: 0.6667, label: '1×', pct: '67%', enabled: true, active: false },
      { value: 1.3333, label: '2×', pct: '133%', enabled: true, active: true },
      { value: 2, label: '3×', pct: '200%', enabled: false, active: false },
    ]);
  });

  it('pctLabel 四舍五入', () => {
    expect(pctLabel(1.15)).toBe('115%');
    expect(pctLabel(728 / 480)).toBe('152%');
  });
});
