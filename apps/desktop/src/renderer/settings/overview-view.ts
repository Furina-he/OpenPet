/** 总览页纯逻辑（spec 2026-07-09）；SFC 薄渲染。图表色板由 SFC 读 CSS 变量后注入。 */

export type GreetSlot = 'morning' | 'afternoon' | 'evening' | 'night';
export function greetSlot(hour: number): GreetSlot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export function formatMemoryMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

export type ShowcaseMode = 'live' | 'preview' | 'initial';
/** 降级链：vrm 且未失败 → 实时；否则 preview 图；无 preview → 首字占位。 */
export function showcaseMode(engine: string, hasPreview: boolean, vrmFailed: boolean): ShowcaseMode {
  if (engine === 'vrm' && !vrmFailed) return 'live';
  return hasPreview ? 'preview' : 'initial';
}

export function previewUrlOf(characterId: string, m: { preview?: string }): string | null {
  return m.preview ? `asset://${characterId}/${m.preview}` : null;
}

export function modelUrlOf(characterId: string, m: { model: string }): string {
  return `asset://${characterId}/${m.model}`;
}

export function activeModelLabel(
  models: Array<{ id: string; model: string }>,
  defaultChatModelId: string,
): string | null {
  return models.find((x) => x.id === defaultChatModelId)?.model ?? null;
}

/** footer Token 摘要：预算开启 → "用量 / 上限"+占比（cap 口径=万 tokens）；否则仅用量。 */
export function budgetVm(
  monthTokens: number,
  enabled: boolean,
  capWan: number,
): { text: string; pct: number | null } {
  if (!enabled || capWan <= 0) return { text: formatCompact(monthTokens), pct: null };
  const cap = capWan * 10_000;
  return {
    text: `${formatCompact(monthTokens)} / ${formatCompact(cap)}`,
    pct: Math.min(100, Math.round((monthTokens / cap) * 100)),
  };
}

export interface ChartPalette {
  brandFrom: string;
  brandTo: string;
  textSub: string;
  border: string;
}

/** SFC 侧读主题 CSS 变量（主题类 prefs 变化后重调，图表色跟随换肤）。 */
export function readPalette(root: Element = document.documentElement): ChartPalette {
  const s = getComputedStyle(root);
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback;
  return {
    brandFrom: v('--ds-brand-from', '#FFB4A2'),
    brandTo: v('--ds-brand-to', '#FF8FAB'),
    textSub: v('--ds-text-sub', '#9B8F89'),
    border: v('--ds-glass-border', '#EADDD6'),
  };
}

const axisOf = (p: ChartPalette) => ({
  labels: { datetimeUTC: false, style: { colors: p.textSub } },
  axisBorder: { show: false },
  axisTicks: { show: false },
});

export function areaChartConfig(p: ChartPalette, series: Array<[number, number]>, name: string) {
  return {
    series: [{ name, data: series }],
    options: {
      chart: {
        type: 'area' as const,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: 'inherit',
      },
      colors: [p.brandTo],
      stroke: { curve: 'smooth' as const, width: 2 },
      fill: { type: 'gradient' as const, gradient: { opacityFrom: 0.3, opacityTo: 0 } },
      dataLabels: { enabled: false },
      grid: { borderColor: p.border },
      xaxis: { type: 'datetime' as const, ...axisOf(p) },
      yaxis: {
        labels: {
          formatter: (v: number) => formatCompact(Math.round(v)),
          style: { colors: p.textSub },
        },
      },
      tooltip: { x: { format: 'MM-dd HH:mm' } },
      legend: { show: false },
    },
  };
}

export function stackedTokenConfig(
  p: ChartPalette,
  tokenSeries: Array<{ model: string; points: Array<[number, number]> }>,
  othersKey: string,
  othersLabel: string,
) {
  // 系列扩展色唯一出处：brand 双色 + 派生暖粉三档（spec §6）。
  const colors = [p.brandFrom, p.brandTo, '#E8B4CB', '#F5C9BE', '#D9C8C0'];
  return {
    series: tokenSeries.map((s) => ({
      name: s.model === othersKey ? othersLabel : s.model,
      data: s.points,
    })),
    options: {
      chart: {
        type: 'bar' as const,
        stacked: true,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: 'inherit',
      },
      colors,
      plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
      dataLabels: { enabled: false },
      grid: { borderColor: p.border },
      xaxis: { type: 'datetime' as const, ...axisOf(p) },
      yaxis: {
        labels: {
          formatter: (v: number) => formatCompact(Math.round(v)),
          style: { colors: p.textSub },
        },
      },
      tooltip: { x: { format: 'MM-dd' } },
      legend: {
        position: 'top' as const,
        horizontalAlign: 'left' as const,
        labels: { colors: p.textSub },
      },
    },
  };
}
