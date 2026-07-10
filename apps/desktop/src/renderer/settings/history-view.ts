/** B3 历史页纯逻辑（过滤/分组/时间/指针/undo）；SFC 薄渲染。 */

export interface SessionVm {
  id: string;
  title: string;
  pinned: boolean;
  lastText: string;
  lastTs: number;
  count: number;
  origin: 'desktop' | 'im';
}

export function splitSessions(
  list: SessionVm[],
  query: string,
): { pinned: SessionVm[]; recent: SessionVm[] } {
  const q = query.trim().toLowerCase();
  const hit = q
    ? list.filter((x) => x.title.toLowerCase().includes(q) || x.lastText.toLowerCase().includes(q))
    : list;
  return { pinned: hit.filter((x) => x.pinned), recent: hit.filter((x) => !x.pinned) };
}

export function formatSessionTime(
  ts: number,
  now: number,
): { kind: 'time' | 'yesterday' | 'date'; text: string } {
  const d = new Date(ts);
  const n = new Date(now);
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(n) - day(d)) / 86_400_000;
  if (diff === 0) {
    const pad = (v: number): string => String(v).padStart(2, '0');
    return { kind: 'time', text: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  if (diff === 1) return { kind: 'yesterday', text: '' };
  return { kind: 'date', text: `${d.getMonth() + 1}-${d.getDate()}` };
}

export function resolveActiveSession(map: Record<string, string>, characterId: string): string {
  return map[characterId] ?? 'default';
}

export function newSessionId(now: number): string {
  return `s_${now}`;
}

/** 删除 undo（ui-design §2.8①）：toast 期间不发 RPC，到点才真删；cancel = 撤销。 */
export class UndoTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly delayMs: number) {}
  schedule(id: string, fire: () => void): void {
    this.cancel(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        fire();
      }, this.delayMs),
    );
  }
  cancel(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }
  pending(id: string): boolean {
    return this.timers.has(id);
  }
}
