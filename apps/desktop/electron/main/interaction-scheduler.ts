/**
 * InteractionScheduler —— clock/greet 时刻源（F-IT-06）。轻量 setInterval（默认 60s）
 * 查表出领域事件；DND/概率/冷却全部由 InteractionService 策略门统一管，这里只管
 * 「什么时刻发生了什么」。greet 用 prefs `pet.lastGreet`（'YYYY-MM-DD/morning'）防
 * 当日重复与跨重启重复。纯逻辑注入 now 可测。
 */
import type { CueEvent, Prefs } from '@openpet/protocol';

export interface InteractionSchedulerDeps {
  trigger: (event: CueEvent) => void;
  getPrefs: () => Prefs;
  setPref: (key: 'pet.lastGreet', value: string) => void;
  now?: () => number;
  intervalMs?: number;
}

/** 问候时段（本地时刻）。 */
export const GREET_MORNING = { fromH: 5, toH: 11 } as const;
export const GREET_EVENING = { fromH: 18, toH: 23 } as const;

export interface InteractionScheduler {
  /** 每 tick 检查一次时刻表（start 内部定时调用；测试手动调）。 */
  tick(): void;
  start(): void;
  stop(): void;
}

export function createInteractionScheduler(deps: InteractionSchedulerDeps): InteractionScheduler {
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    const d = new Date(now());
    if (d.getMinutes() === 0) deps.trigger('clock.hourly');
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const h = d.getHours();
    const last = deps.getPrefs()['pet.lastGreet'];
    if (h >= GREET_MORNING.fromH && h < GREET_MORNING.toH && last !== `${date}/morning`) {
      deps.setPref('pet.lastGreet', `${date}/morning`);
      deps.trigger('greet.morning');
    } else if (h >= GREET_EVENING.fromH && h < GREET_EVENING.toH && last !== `${date}/evening`) {
      deps.setPref('pet.lastGreet', `${date}/evening`);
      deps.trigger('greet.evening');
    }
  }

  return {
    tick,
    start(): void {
      if (timer !== null) return;
      timer = setInterval(tick, intervalMs);
      tick(); // 启动即查一次：早上首启立即问候
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
