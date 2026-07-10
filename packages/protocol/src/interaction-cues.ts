import { z } from 'zod';

/**
 * 声明式 Cue 注册表（F-IT 域，arch-evolution #1）——「事件→桌宠表现」单一真源。
 * 核心链路只发领域事件（CueEvent），表现（emotion/action/say/策略）全部查表；
 * 角色包 manifest.cues 可按 on 覆盖（mergeCues，包优先）。
 */
export const CueEventSchema = z.enum([
  'tap.head',
  'tap.body',
  'combo.head',
  'press.long',
  'stroke.head',
  'chat.reasoning',
  'chat.tool',
  'chat.toolLong',
  'chat.error',
  'chat.done',
  'idle.timeout',
  'clock.hourly',
  'greet.morning',
  'greet.evening',
  'desktop.fullscreen',
  'file.drop',
  'drag.start',
  'drag.end',
]);
export type CueEvent = z.infer<typeof CueEventSchema>;

export const CueSchema = z.object({
  on: CueEventSchema,
  emotion: z.string().optional(),
  action: z.string().optional(),
  /** 台词池（随机一条走桌面气泡 pet.say；受 proactiveSpeech 总闸）。 */
  say: z.array(z.string()).optional(),
  /** 同事件冷却（防连发）。 */
  cooldownMs: z.number().int().nonnegative().optional(),
  /** 0-1；主动类事件被 proactiveFreq 再缩放。 */
  probability: z.number().min(0).max(1).optional(),
  /** 主动行为：受 DND 时段 + proactiveFreq 管控。 */
  proactive: z.boolean().optional(),
});
export type Cue = z.infer<typeof CueSchema>;

/** 内置默认表 = spec §4（tap/combo/press/stroke/chat/idle/clock/greet/desktop/file/drag 全表）。 */
export const DEFAULT_CUES: Cue[] = [
  { on: 'tap.head', emotion: 'happy', action: 'nuzzle', cooldownMs: 800 },
  { on: 'tap.body', emotion: 'neutral', action: 'nod', cooldownMs: 800 },
  { on: 'combo.head', emotion: 'shy', action: 'fidget', say: ['再摸就要红温了…'], cooldownMs: 10_000 },
  { on: 'press.long', emotion: 'surprised', action: 'fidget', cooldownMs: 3_000 },
  { on: 'stroke.head', emotion: 'relaxed', action: 'nuzzle', cooldownMs: 5_000 },
  { on: 'chat.reasoning', emotion: 'thinking' },
  { on: 'chat.tool', action: 'searching' },
  { on: 'chat.toolLong', emotion: 'sleepy' },
  { on: 'chat.error', emotion: 'confused', action: 'droop', cooldownMs: 5_000 },
  { on: 'idle.timeout', proactive: true }, // action 由引擎 pickIdleAction(mood) 特判
  { on: 'clock.hourly', action: 'stretch', probability: 0.3, proactive: true, cooldownMs: 55 * 60_000 },
  { on: 'greet.morning', emotion: 'happy', action: 'wave', say: ['早安！今天也要加油哦', '早～睡得好吗？'], proactive: true },
  { on: 'greet.evening', emotion: 'relaxed', action: 'wave', say: ['晚上好～', '今天辛苦啦'], proactive: true },
  { on: 'desktop.fullscreen', action: 'wave', cooldownMs: 30_000 },
  { on: 'file.drop', emotion: 'surprised', action: 'jump', say: ['这个我还拿不动哦'], cooldownMs: 5_000 },
  { on: 'drag.start', emotion: 'surprised', cooldownMs: 2_000 },
  { on: 'drag.end', cooldownMs: 2_000 },
];

/** 角色包覆盖：同 on 包优先（整条替换），其余保留默认。 */
export function mergeCues(defaults: Cue[], pack: Cue[] | undefined): Cue[] {
  if (!pack?.length) return defaults;
  const byOn = new Map(defaults.map((c) => [c.on, c] as const));
  for (const c of pack) byOn.set(c.on, c);
  return [...byOn.values()];
}
