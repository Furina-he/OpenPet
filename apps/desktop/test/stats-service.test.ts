import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../electron/main/db/memory-store.js';
import { createStatsService, OTHERS_KEY } from '../electron/main/stats-service.js';

const TZ = 8 * 3_600_000;
const DAY = 86_400_000;
// 固定"现在"= 本地 2026-07-09 12:00（UTC 04:00）
const NOW = Date.UTC(2026, 6, 9, 4);

function makeService(
  store: MemoryStore,
  over: Partial<Parameters<typeof createStatsService>[0]> = {},
) {
  return createStatsService({
    store,
    imPlatforms: () => [
      {
        id: 'qq1',
        type: 'onebot-v11',
        name: 'QQ · NapCat',
        enable: true,
        wsUrl: '',
        accessToken: '',
        botToken: '',
      } as never,
    ],
    imStatuses: () => [{ platformId: 'qq1', status: 'running', errorCount: 0 } as never],
    mcpToolCount: async () => 6,
    pluginCounts: async () => ({ enabled: 3, total: 5 }),
    appVersion: '0.1.0',
    now: () => NOW,
    tzOffsetMs: () => TZ,
    memoryMb: () => 126,
    uptimeSec: () => 8040,
    ...over,
  });
}

describe('stats-service overview', () => {
  it('空库：KPI 全 0、companionDays=1、series 空', async () => {
    const r = await makeService(new MemoryStore()).overview(7);
    expect(r.kpi).toEqual({ monthMessages: 0, monthTokens: 0, memoryMb: 126, uptimeSec: 8040 });
    expect(r.companionDays).toBe(1);
    expect(r.todayMessages).toBe(0);
    expect(r.messageSeries).toEqual([]);
    expect(r.tokenSeries).toEqual([]);
    expect(r.appVersion).toBe('0.1.0');
  });

  it('range=1 用小时桶且 since=本地今日 0 点；月聚合与 companionDays', async () => {
    const store = new MemoryStore();
    const todayStartLocal = Date.UTC(2026, 6, 8, 16); // 本地 07-09 00:00
    store.appendMessage({
      characterId: 'c', sessionId: 's', role: 'user', text: 'old', ts: NOW - 40 * DAY,
    });
    store.appendMessage({
      characterId: 'c', sessionId: 's', role: 'assistant', text: 'a',
      ts: todayStartLocal + 3_600_000,
      finishReason: 'stop', tokensIn: 10, tokensOut: 5, model: 'm1',
    });
    const r = await makeService(store).overview(1);
    expect(r.todayMessages).toBe(1);
    expect(r.companionDays).toBe(41); // floor(40*DAY/DAY)+1
    expect(r.messageSeries).toEqual([[todayStartLocal + 3_600_000, 1]]); // 小时桶=整点
    expect(r.kpi.monthTokens).toBe(15);
  });

  it('tokenSeries top4 + 其他合并（逐桶相加）', async () => {
    const store = new MemoryStore();
    const t = Date.UTC(2026, 6, 9, 1); // 本地今天
    for (let i = 0; i < 6; i++) {
      store.appendMessage({
        characterId: 'c', sessionId: 's', role: 'assistant', text: `a${i}`, ts: t + i,
        finishReason: 'stop', tokensIn: 0, tokensOut: 100 - i * 10, model: `m${i}`,
      });
    }
    const r = await makeService(store).overview(7);
    expect(r.tokenSeries).toHaveLength(5);
    expect(r.tokenSeries.map((s) => s.model)).toEqual(['m0', 'm1', 'm2', 'm3', OTHERS_KEY]);
    const others = r.tokenSeries.find((s) => s.model === OTHERS_KEY)!;
    expect(others.points).toEqual([[Date.UTC(2026, 6, 8, 16), 60 + 50]]); // m4+m5 同桶合并
    expect(r.tokensByModel).toHaveLength(6); // 排行不合并
  });

  it('channels 投影：running=connected；error 带 lastError', async () => {
    const svc = makeService(new MemoryStore(), {
      imStatuses: () => [
        { platformId: 'qq1', status: 'error', errorCount: 2, lastError: 'boom' } as never,
      ],
    });
    const r = await svc.overview(7);
    expect(r.channels).toEqual([
      {
        id: 'qq1', type: 'onebot-v11', name: 'QQ · NapCat',
        enabled: true, connected: false, error: 'boom',
      },
    ]);
    expect(r.mcpToolCount).toBe(6);
    expect(r.pluginEnabled).toBe(3);
    expect(r.pluginTotal).toBe(5);
  });
});
