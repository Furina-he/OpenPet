/**
 * StatsService —— app.stats.overview 聚合（总览页数据源，spec 2026-07-09）。
 * 纯聚合零状态；now/tz/memory/uptime 可注入（测试确定性）。
 * range 语义：1 = 本地今日 0 点起（小时桶）；3/7 = 含今天的最近 N 个自然日（天桶）。
 */
import type { ImPlatform, ImStatus } from '@openpet/protocol';
import type { ConversationStore } from './db/store.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TOP_MODELS = 4;
/** 堆叠图 top4 以外合并桶的占位 model 名（前端 i18n 显示"其他"）。 */
export const OTHERS_KEY = '__others__';

export interface StatsServiceDeps {
  store: ConversationStore;
  imPlatforms: () => ImPlatform[];
  imStatuses: () => ImStatus[];
  mcpToolCount: () => Promise<number>;
  pluginCounts: () => Promise<{ enabled: number; total: number }>;
  appVersion: string;
  now?: () => number;
  tzOffsetMs?: () => number;
  memoryMb?: () => number;
  uptimeSec?: () => number;
}

function sumPoints(points: Array<[number, number]>): number {
  return points.reduce((s, [, v]) => s + v, 0);
}

function mergePoints(list: Array<Array<[number, number]>>): Array<[number, number]> {
  const acc = new Map<number, number>();
  for (const points of list) for (const [b, v] of points) acc.set(b, (acc.get(b) ?? 0) + v);
  return [...acc.entries()].sort((a, b) => a[0] - b[0]);
}

export function createStatsService(deps: StatsServiceDeps) {
  const now = deps.now ?? ((): number => Date.now());
  const tz = deps.tzOffsetMs ?? ((): number => -new Date().getTimezoneOffset() * 60_000);
  const memoryMb =
    deps.memoryMb ?? ((): number => Math.round(process.memoryUsage().rss / 1_048_576));
  const uptimeSec = deps.uptimeSec ?? ((): number => Math.round(process.uptime()));
  const dayStart = (t: number): number => Math.floor((t + tz()) / DAY) * DAY - tz();

  return {
    async overview(rangeDays: 1 | 3 | 7) {
      const t = now();
      const todayStart = dayStart(t);
      const since = rangeDays === 1 ? todayStart : todayStart - (rangeDays - 1) * DAY;
      const bucketMs = rangeDays === 1 ? HOUR : DAY;
      // 月界口径与 ipc-router monthStart 一致（本地自然月）。
      const d = new Date(t);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const usage = deps.store.usageSummary(monthStart);
      const firstTs = deps.store.statsFirstMessageTs();
      const ranked = [...deps.store.statsTokenSeriesByModel(since, bucketMs, tz())].sort(
        (a, b) => sumPoints(b.points) - sumPoints(a.points),
      );
      const rest = ranked.slice(TOP_MODELS);
      const tokenSeries = rest.length
        ? [
            ...ranked.slice(0, TOP_MODELS),
            { model: OTHERS_KEY, points: mergePoints(rest.map((r) => r.points)) },
          ]
        : ranked;
      const statuses = new Map(deps.imStatuses().map((s) => [s.platformId, s]));
      const [mcpToolCount, plugin] = await Promise.all([deps.mcpToolCount(), deps.pluginCounts()]);
      return {
        kpi: {
          monthMessages: deps.store.statsMessageCount(monthStart),
          monthTokens: usage.tokensIn + usage.tokensOut,
          memoryMb: memoryMb(),
          uptimeSec: uptimeSec(),
        },
        companionDays: firstTs === null ? 1 : Math.max(1, Math.floor((t - firstTs) / DAY) + 1),
        todayMessages: deps.store.statsMessageCount(todayStart),
        messageSeries: deps.store.statsMessageSeries(since, bucketMs, tz()),
        tokenSeries,
        tokensByModel: deps.store.statsTokensByModel(since),
        channels: deps.imPlatforms().map((p) => {
          const s = statuses.get(p.id);
          return {
            id: p.id,
            type: p.type,
            name: p.name,
            enabled: p.enable,
            connected: s?.status === 'running',
            error: s?.status === 'error' ? (s.lastError ?? null) : null,
          };
        }),
        mcpToolCount,
        pluginEnabled: plugin.enabled,
        pluginTotal: plugin.total,
        appVersion: deps.appVersion,
      };
    },
  };
}
