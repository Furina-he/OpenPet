import { describe, it, expect } from 'vitest';
import {
  greetSlot,
  formatInt,
  formatCompact,
  formatUptime,
  formatMemoryMb,
  showcaseMode,
  previewUrlOf,
  modelUrlOf,
  activeModelLabel,
  budgetVm,
  areaChartConfig,
  stackedTokenConfig,
  type ChartPalette,
} from '../src/renderer/settings/overview-view.js';

const P: ChartPalette = {
  brandFrom: '#FFB4A2',
  brandTo: '#FF8FAB',
  textSub: '#9B8F89',
  border: '#EADDD6',
};

describe('overview-view', () => {
  it('greetSlot 四段边界', () => {
    expect(greetSlot(5)).toBe('morning');
    expect(greetSlot(10)).toBe('morning');
    expect(greetSlot(11)).toBe('afternoon');
    expect(greetSlot(17)).toBe('afternoon');
    expect(greetSlot(18)).toBe('evening');
    expect(greetSlot(22)).toBe('evening');
    expect(greetSlot(23)).toBe('night');
    expect(greetSlot(4)).toBe('night');
  });

  it('数字/时长/内存格式化', () => {
    expect(formatInt(1284)).toBe('1,284');
    expect(formatCompact(320)).toBe('320');
    expect(formatCompact(32600)).toBe('32.6K');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatUptime(8040)).toBe('2h 14m');
    expect(formatUptime(300)).toBe('5m');
    expect(formatUptime(38)).toBe('38s');
    expect(formatMemoryMb(126)).toBe('126 MB');
    expect(formatMemoryMb(1536)).toBe('1.5 GB');
  });

  it('模型展示降级链', () => {
    expect(showcaseMode('vrm', true, false)).toBe('live');
    expect(showcaseMode('vrm', true, true)).toBe('preview');
    expect(showcaseMode('live2d', true, false)).toBe('preview');
    expect(showcaseMode('live2d', false, false)).toBe('initial');
    expect(showcaseMode('vrm', false, true)).toBe('initial');
  });

  it('asset URL 拼装', () => {
    expect(previewUrlOf('hero', { preview: 'p.png' })).toBe('asset://hero/p.png');
    expect(previewUrlOf('hero', {})).toBeNull();
    expect(modelUrlOf('hero', { model: 'm.vrm' })).toBe('asset://hero/m.vrm');
  });

  it('footer：activeModelLabel + budgetVm', () => {
    const models = [
      { id: 'a', model: 'gpt-4o' },
      { id: 'b', model: 'deepseek-v3' },
    ];
    expect(activeModelLabel(models, 'b')).toBe('deepseek-v3');
    expect(activeModelLabel(models, 'zzz')).toBeNull();
    expect(budgetVm(32600, false, 0)).toEqual({ text: '32.6K', pct: null });
    expect(budgetVm(32600, true, 20)).toEqual({ text: '32.6K / 200.0K', pct: 16 });
    expect(budgetVm(999_999_999, true, 1).pct).toBe(100);
  });

  it('图表 config：色板注入 + 其他合并显示名', () => {
    const area = areaChartConfig(P, [[1, 2]], '消息');
    expect(area.options.colors).toEqual([P.brandTo]);
    expect(area.series).toEqual([{ name: '消息', data: [[1, 2]] }]);
    const stacked = stackedTokenConfig(
      P,
      [
        { model: 'gpt-4o', points: [[1, 10]] },
        { model: '__others__', points: [[1, 5]] },
      ],
      '__others__',
      '其他',
    );
    expect(stacked.series.map((s) => s.name)).toEqual(['gpt-4o', '其他']);
    expect(stacked.options.chart.stacked).toBe(true);
  });
});
