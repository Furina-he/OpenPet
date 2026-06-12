# M3 行为协议生产化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `BehaviorParser` 从 spike 形态升级到生产：全标签集（intent/emo/act/wait/say-stub）、fail-safe（300ms 超时 flush、非法标签原样输出 + warn）、`<wait/>` 文本流节流、Persona few-shot 模板、覆盖率 ≥90%、100+ 边界 case。

**Architecture:** 解析器仍是 `packages/protocol` 里的纯同步状态机（feed/flush 生成器），新增「前缀四态分类」让普通文本零延迟放行、类标签等闭合整段放行 + warn、未闭合超长溢出兜底。运行时 fail-safe（300ms stale flush 定时器）和 `<wait/>` 节流（per-session 发射门）放在 `apps/desktop` 的 ConversationCore——parser 保持无时钟、可枚举测试。

**Tech Stack:** TypeScript（strict 全开）、Zod（不涉及，本里程碑无 wire 协议变更）、Vitest 1.6（fake timers + @vitest/coverage-v8 覆盖率门槛）。

---

## 背景与现状

**M3 规格**（`docs/plans/2026-05-01-desksoul-impl-plan.md` L1289-1298）：

> **范围：** BehaviorParser 从 spike 形态升级到生产
> - 完整支持 §4.1 全部标签（intent/emo/act/wait；say 留 stub）
> - fail-safe：300ms 超时 flush、非法标签原样输出 + warn 日志
> - Persona few-shot 模板写入 `packages/protocol/src/persona-prompt-template.ts`
> - 单测覆盖率 ≥ 90%
>
> **验收：** 100+ 边界 case 测试全过（含半截标签、嵌套、流截断、误用）

**tech-design §4.1 的解析器状态机要求**（L196-205）：剥离完成标签 emit behavior.*、剩余文本 emit chat.stream、半截标签暂存 buffer、非法/未注册标签原样文本 + warn、300ms 无新 token 强制 flush。

**现状差距**（M2 后的 `packages/protocol/src/behavior-parser.ts`，85 行）：

| 要求 | 现状 | 差距 |
| --- | --- | --- |
| `<say:CLIP/>` | 无 | 解析层支持 + 消费端 stub |
| 非法标签 warn 日志 | 原样输出但无日志 | 注入式 onWarn 钩子（protocol 零依赖） |
| 300ms 超时 flush | 无（只有 done 时 flush） | ConversationCore 持 per-session 定时器 |
| 普通文本里的 `<`/`[` | `a<b`、`[link](url)` 会 buffer 等闭合符，**永不闭合则 buffer 无限涨** | 前缀四态分类 + MAX_TAG_LENGTH 溢出兜底 |
| 数值边界 | `w=99`、`ms=999999999` 原样通过（wait 会停 11 天） | clamp + warn |
| intent 段首语义 | 任意位置都解析（违反 §4.1「段首基调」） | 仅段首识别，中途降级文本 + warn |
| `<wait ms=N/>` 文本流停顿 | ConversationCore 显式忽略（`conversation-core.ts:113` 注释指给 M3） | per-session 发射门 |
| 覆盖率门槛 | 无 coverage 配置 | @vitest/coverage-v8 + thresholds 90 |
| 测试量 | 13 用例 | 100+（含程序化切分不变性） |

**M2 已就位、本计划直接依赖的事实**（已逐一核实源码）：

- `ConversationCore`（`apps/desktop/electron/main/conversation-core.ts`）：per-session parser map、`cancelling` Set、cancel 丢迟到 delta + 废弃半截 buffer、done 清标记。
- `ChatService.cancel`（`chat-service.ts:70-77`）先查 `store.isStreaming`，按 ①core.cancel ②queue.dropSession ③host.cancel 顺序。
- `NotificationQueue.push(..., {urgent:true})` 是**同步** `flushNow()`（`notification-queue.ts:54`）——cancel 路径里先合成的 done 经 urgent push 立即广播，随后的 `dropSession` 清不到它，顺序安全。
- `ProviderHost.cancel` 遍历 `inflight`，已 settle 的 request 无条目 → **no-op**（`provider-host.ts:173-179`）——「wait 延迟期间取消、流早已结束」的场景安全。
- `SessionStore.appendDelta` 由 `ChatService.onNotification` 在收到 chat.stream 通知时调用——wait 门推迟通知即推迟入账，seq 仍单调、快照文本 = UI 已见文本，一致性反而更对。
- mock provider 脚本（`apps/sidecar/src/workers/mock-provider.ts` MOCK_SCRIPT）只含注册标签且段首 intent，M3 全兼容，e2e 不需要改。
- vitest 实际版本 **1.6.1**（根 node_modules），coverage 包用 `@vitest/coverage-v8@^1.6.0`。
- protocol 现有 44 测试全绿（执行前基线，2026-06-12 实测）。

---

## 关键决策

**D1 — say 解析支持、消费 stub、模板不提及。** `<say:CLIP/>` 进 `BehaviorEvent`（`{type:'say'; clip}`），ConversationCore `case 'say': break`（V1+ 接语音）。Persona 模板**不写** say 语法——stub 阶段教模型输出只会被丢弃，不教最干净。

**D2 — 数值越界 clamp + warn，正则收紧。** `w` clamp [0,1]、`dur` clamp [0,60000]、`ms` clamp [0,10000]，上限收口在导出常量 `BEHAVIOR_LIMITS`（模板与消费端共享）。`w` 正则从 `[0-9.]+` 收紧为 `\d+(?:\.\d+)?|\.\d+`：`w=1.2.3` 从「parseFloat 静默截断 1.2」变为整标签 malformed（原样文本 + warn）。负数天然被正则拒绝。

**D3 — 前缀四态分类（流式零延迟 vs 未注册标签 warn 的平衡）。** buffer 从 marker（`<`/`[`）开始时分类：
- `tag`：startsWith 某注册前缀（`<emo:` `<act:` `<say:` `<wait ` / `[intent `）→ 等闭合后走解析（解析失败 = `malformed-tag` warn + 原样文本）。
- `viable`：是某注册前缀的真前缀（如 `<em`、`[in`）→ 继续等。
- `taglike`：`^<[a-zA-Z]` 但非注册（如 `<bogus:x/>`、`<div>`）→ 等闭合 `>` 后**整段原样文本 + `unregistered-tag` warn**（满足 tech-design「未注册标签原样输出 + warn」字面要求）。
- `reject`：其余（`< b`、`<3`、`<<`、`</`、`[l`、`[ `）→ **立即放行一个 marker 字符**，从下一字符重扫——`i<3 you`、`[链接](url)`、`arr[0]` 零延迟、零 warn、永不积 buffer。

`[` 家族只有 intent 一个注册名，不设 taglike（方括号在普通中文/markdown 太常见，全部等 `]` 伤体验）。核心不变量：**文本无损**——任何输入的非标签字符原样出现在 text 事件流中，顺序不变。

**D4 — MAX_TAG_LENGTH=128 溢出放行。** `tag`/`viable`/`taglike` 状态下未闭合 buffer 超过 128 字符 → 整段放行为文本 + `tag-overflow` warn。这是「`a<b` 后面 10KB 文本没有 `>`」的内存兜底（300ms stale flush 是时间兜底，两者独立成立）。已闭合的完整标签不限长（正则照判）。

**D5 — intent 仅段首。** §4.1 定义 intent 是「段首基调，本回复结束才归零」，中途切换无语义。解析器维护 `atHead`：吐出任何含非空白的 text 或任何行为事件后置 false；前导空白（含换行）不破坏段首。非段首的结构合法 `[intent ...]` → 原样文本 + `misplaced-intent` warn。每条回复一个新 parser 实例（M2 既有模式），状态天然干净。

**D6 — warn 是注入钩子。** protocol 包零运行时依赖，`new BehaviorParser({ onWarn })`，reason 枚举：`malformed-tag | unregistered-tag | value-clamped | tag-overflow | misplaced-intent`。ConversationCore 注入默认 `console.warn`（Main 进程日志），测试注入收集器断言。

**D7 — 300ms stale flush 放 ConversationCore，parser 保持纯同步。** parser 新增 `hasPendingInput()`（buffer 非空），ConversationCore 在每个 delta 处理完后：有残留 → 武装/重置 300ms 定时器；无残留 → 解除。到点 `parser.flush()` 吐文本（半截标签放行为文本）+ `stale-flush` warn，**parser 之后继续可用**（流恢复时 feed 照常）。done/cancel/dispose 清定时器。`STALE_FLUSH_MS = 300` 导出，测试用 vitest fake timers。

**D8 — wait 节流 = per-session 发射门（gate）。** `conversation-core.ts:113` 注释明确指给 M3。设计：
- 无 wait 时**直通零开销**（同步 notify，M2 行为不变）。
- 遇 `wait` 事件：gate 进入延迟态（setTimeout），之后的所有通知（含 done）进 pending 队列，到点按序放出，途中再遇 delay 标记继续延迟——**消息顺序永不重排，done 不会越过文本**。
- `clamp` 保证单次延迟 ≤10s；`wait ms=0` 直接忽略。
- **cancel × gate 的死锁规避**：若 cancel 时 pending 里已压着 done（流在 provider 侧早已结束），清空 pending 后**当场合成 `done(cancel)`** 并且**不设 cancelling 标记**（不会再有事件来清它；ProviderHost 侧该 request 已 settle，后续 host.cancel 是 no-op）。否则 session 永远 `streaming`、新消息永远 -32001。若 pending 无 done：照旧丢 pending + 设标记，等 ProviderHost 协作取消/watchdog 合成的 done(cancel) 封口。
- done 在 gate 排队期间 `store.isStreaming` 保持 true → 新 `chat.send` 被 -32001 挡住 → 不存在「新流事件混入旧 gate」。
- ConversationCore 新增 `dispose()`（清 stale + gate 全部定时器），接进 `ChatService.dispose()` 链首。

**D9 — 覆盖率门槛进 test script。** protocol 的 `test` 直接 `vitest run --coverage`，thresholds 90（lines/functions/branches/statements），CI 的 `pnpm -r test` 即门槛。`src/index.ts`（纯 re-export）排除。**不达标补针对性测试，不降门槛、不加 exclude。**

**D10 — 范围排除**（防执行时镀金）：
- fetch 网关流式分块（spike-summary 写「留到 M3」是旧编号，按 impl-plan 属 M5 真 provider 接入）。
- 真实 Provider（M5）、wait 的渲染端打字机表现（M8）、say 的语音播放（V1+）、`behavior.setLipsync`（M4）。
- e2e-smoke 不扩（M3 验收是单测口径；e2e 跑回归确认不破即可）。
- wire 协议（methods.ts/schemas.ts）零变更——say/wait 不新增 notification channel。

**D11 — 「100+ 边界 case」统计口径。** 显式 it ≈125+（本计划各任务用例数合计），另有切分不变性性质测试：20 条样例 × 每条全部二分切点 + 逐字符 + 三等分，程序化断言数千。RESULTS-M3.md 按「显式 it 数 + 程序化切分 case 数」如实报告。

---

## 文件结构

```
packages/protocol/
  src/
    behavior-parser.ts            # 重写：四态分类、say、clamp、warn、overflow、atHead、hasPendingInput
    persona-prompt-template.ts    # 新建：buildBehaviorPrompt + BEHAVIOR_FEWSHOTS + 默认表情/动作集
    index.ts                      # PROTOCOL_VERSION 0.3.0 + 导出新模块
  test/
    behavior-parser.test.ts       # 重组扩展：~97 it（含 20 条性质测试）
    persona-prompt-template.test.ts  # 新建：~8 it（含模板自洽：few-shot 喂回 parser 零 warn）
  vitest.config.ts                # 新建：coverage v8 + thresholds 90
  package.json                    # +@vitest/coverage-v8、test script 加 --coverage

apps/desktop/
  electron/main/
    conversation-core.ts          # 重写：SessionState（parser+staleTimer+gate）、say stub、warn 接线、
                                  #       300ms stale flush、wait 发射门、cancel×gate、dispose
    chat-service.ts               # dispose() 链首加 core.dispose()
  test/
    conversation-core.test.ts     # 既有 10 it 全保留 + 新增 ~20 it（fake timers）
  RESULTS-M3.md                   # 新建：验收映射

CLAUDE.md                         # 项目状态行：M3 完成、下一个 M4
docs/plans/2026-06-12-m3-behavior-plan.md  # 本计划（Task 0 入库）
```

依赖顺序：Task 1→2→3 是 parser 渐进重写（每步全绿）；Task 5 build 之后 Task 6/7 才能在 desktop 看到新类型（desktop 测试 resolve 的是 protocol **dist**，turbo `test` dependsOn `^build` 自动保证，但手动单跑 vitest 前要先 build protocol）。

---

### Task 0: 分支与计划入库

**Files:**
- 无代码变更（git 操作 + 文档入库）

- [ ] **Step 1: 从 main 开分支**

```bash
cd /d/desk/Desktop/openpet
git checkout main && git checkout -b feat/m3-behavior
```

（网络约束：直连 GitHub 不通，跳过 `git pull`；本地 main 已含 M2 合并提交 10cf33e 即最新。）

- [ ] **Step 2: 提交两份计划文档**

工作区有未跟踪的 `docs/plans/2026-06-11-m2-ipc-plan.md`（M2 执行时漏入库），连同本计划一起入库：

```bash
git add docs/plans/2026-06-11-m2-ipc-plan.md docs/plans/2026-06-12-m3-behavior-plan.md
git commit -m "docs: M2 实施计划补档 + M3 行为协议生产化实施计划"
```

- [ ] **Step 3: 确认基线绿**

```bash
pnpm --filter @desksoul/protocol exec vitest run
```

Expected: 4 files, 44 tests passed.

---

### Task 1: 解析层定型 — say 标签 + 数值 clamp + onWarn 钩子

不动扫描算法（drain/nextMarker 保持 M2 原样），只升级「完整标签 → 事件」这一层。

**Files:**
- Modify: `packages/protocol/src/behavior-parser.ts`
- Test: `packages/protocol/test/behavior-parser.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/test/behavior-parser.test.ts` 末尾（现有 `describe('BehaviorParser')` 之后）追加。注意：本任务**不**对 malformed 输入断言 warn（malformed/unregistered 的 warn 语义在 Task 2 随分类器引入；这里只断言事件序列与 value-clamped）：

```ts
import { BehaviorParser, BEHAVIOR_LIMITS, type BehaviorWarnReason } from '../src/behavior-parser';

// （文件顶部已有的 BehaviorParser import 改成上面这行，合并导入）

function collectWarns(): { warns: Array<{ reason: BehaviorWarnReason; raw: string }>; onWarn: (reason: BehaviorWarnReason, raw: string) => void } {
  const warns: Array<{ reason: BehaviorWarnReason; raw: string }> = [];
  return { warns, onWarn: (reason, raw) => warns.push({ reason, raw }) };
}

describe('say tag (M3, V1+ 语音的解析层 stub)', () => {
  it('parses <say:clip/> into a say event', () => {
    const p = new BehaviorParser();
    expect([...p.feed('a<say:greet/>b')]).toEqual([
      { type: 'text', text: 'a' },
      { type: 'say', clip: 'greet' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('say interleaves with other tags', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:happy/><say:hi/><act:wave/>')]).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'say', clip: 'hi' },
      { type: 'action', name: 'wave', durationMs: null },
    ]);
  });

  it('say with extra params is not a say tag (falls back to literal text)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<say:hi w=1/>')]).toEqual([{ type: 'text', text: '<say:hi w=1/>' }]);
  });
});

describe('numeric clamps (M3)', () => {
  it('exports BEHAVIOR_LIMITS', () => {
    expect(BEHAVIOR_LIMITS).toMatchObject({
      emotionWeightMax: 1,
      actionDurationMaxMs: 60_000,
      waitMaxMs: 10_000,
      maxTagLength: 128,
    });
  });

  it('keeps in-range weight, accepts leading-dot decimals', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:sad w=0.6/><emo:soft w=.5/><emo:zero w=0/>')]).toEqual([
      { type: 'emotion', name: 'sad', weight: 0.6 },
      { type: 'emotion', name: 'soft', weight: 0.5 },
      { type: 'emotion', name: 'zero', weight: 0 },
    ]);
  });

  it('clamps w>1 to 1 and warns value-clamped', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:happy w=1.5/>')]).toEqual([{ type: 'emotion', name: 'happy', weight: 1 }]);
    expect(warns).toEqual([{ reason: 'value-clamped', raw: '<emo:happy w=1.5/>' }]);
  });

  it('clamps wait ms to 10s and warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<wait ms=999999/>')]).toEqual([{ type: 'wait', ms: 10_000 }]);
    expect(warns.map((w) => w.reason)).toEqual(['value-clamped']);
  });

  it('clamps act dur to 60s and warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<act:dance dur=99999999/>')]).toEqual([
      { type: 'action', name: 'dance', durationMs: 60_000 },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['value-clamped']);
  });

  it('in-range boundary values pass without warn', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<wait ms=10000/><act:hold dur=60000/><act:tap dur=0/><wait ms=0/>')]).toEqual([
      { type: 'wait', ms: 10_000 },
      { type: 'action', name: 'hold', durationMs: 60_000 },
      { type: 'action', name: 'tap', durationMs: 0 },
      { type: 'wait', ms: 0 },
    ]);
    expect(warns).toEqual([]);
  });

  it('rejects double-dot weight as a non-tag (literal text)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:sad w=1.2.3/>')]).toEqual([{ type: 'text', text: '<emo:sad w=1.2.3/>' }]);
  });

  it('constructor without options never throws on clamp paths', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:x w=5/>')]).toEqual([{ type: 'emotion', name: 'x', weight: 1 }]);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd packages/protocol && pnpm exec vitest run test/behavior-parser.test.ts
```

Expected: FAIL —— `BEHAVIOR_LIMITS` 无导出（import 报错）。

- [ ] **Step 3: 实现**

`packages/protocol/src/behavior-parser.ts` 整体替换为（扫描算法仍是 M2 的，新增解析层）：

```ts
export type BehaviorEvent =
  | { type: 'text'; text: string }
  | { type: 'emotion'; name: string; weight: number }
  | { type: 'action'; name: string; durationMs: number | null }
  | { type: 'wait'; ms: number }
  | { type: 'say'; clip: string }
  | { type: 'intent'; mood: string; energy: string };

/**
 * 数值边界（越界 clamp + warn）。persona 模板与消费端共享同一组上限，
 * maxTagLength 限制的是「未闭合标签的等待窗口」（防 buffer 无限增长），
 * 不限制已完整闭合的标签。
 */
export const BEHAVIOR_LIMITS = {
  emotionWeightMax: 1,
  actionDurationMaxMs: 60_000,
  waitMaxMs: 10_000,
  maxTagLength: 128,
} as const;

export type BehaviorWarnReason =
  | 'malformed-tag' // 注册命名空间内、闭合后语法不合规（如 <emo:bad name/>、w=1.2.3）
  | 'unregistered-tag' // <NAME...> 形状但 NAME 不在注册集（如 <bogus:x/>、<div>）
  | 'value-clamped' // w/dur/ms 越界被 clamp
  | 'tag-overflow' // 未闭合超过 maxTagLength，整段放行为文本
  | 'misplaced-intent'; // [intent] 不在段首

export interface BehaviorParserOptions {
  /** 协议层告警出口。protocol 包零运行时依赖，日志实现由宿主注入。 */
  onWarn?: (reason: BehaviorWarnReason, raw: string) => void;
}

const EMO_TAG = /^<emo:([a-zA-Z][\w-]*)(?:\s+w=(\d+(?:\.\d+)?|\.\d+))?\s*\/>$/;
const ACT_TAG = /^<act:([a-zA-Z][\w-]*)(?:\s+dur=(\d+))?\s*\/>$/;
const WAIT_TAG = /^<wait\s+ms=(\d+)\s*\/>$/;
const SAY_TAG = /^<say:([a-zA-Z][\w-]*)\s*\/>$/;
const INTENT_TAG = /^\[intent\s+mood=([a-zA-Z][\w-]*)\s+energy=([a-zA-Z][\w-]*)\s*\]$/;

export class BehaviorParser {
  private buffer = '';
  private readonly onWarn: ((reason: BehaviorWarnReason, raw: string) => void) | undefined;

  constructor(opts: BehaviorParserOptions = {}) {
    this.onWarn = opts.onWarn;
  }

  *feed(chunk: string): Generator<BehaviorEvent> {
    this.buffer += chunk;
    yield* this.drain(false);
  }

  *flush(): Generator<BehaviorEvent> {
    yield* this.drain(true);
  }

  private *drain(flush: boolean): Generator<BehaviorEvent> {
    while (this.buffer.length > 0) {
      const open = this.nextMarker();
      if (open === -1) {
        yield { type: 'text', text: this.buffer };
        this.buffer = '';
        return;
      }
      if (open > 0) {
        yield { type: 'text', text: this.buffer.slice(0, open) };
        this.buffer = this.buffer.slice(open);
      }
      const closer = this.buffer[0] === '<' ? '>' : ']';
      const close = this.buffer.indexOf(closer);
      if (close === -1) {
        if (flush) {
          yield { type: 'text', text: this.buffer };
          this.buffer = '';
        }
        return;
      }
      const tag = this.buffer.slice(0, close + 1);
      const event = this.parseRegistered(tag);
      yield event ?? { type: 'text', text: tag };
      this.buffer = this.buffer.slice(close + 1);
    }
  }

  private nextMarker(): number {
    const lt = this.buffer.indexOf('<');
    const br = this.buffer.indexOf('[');
    if (lt === -1) return br;
    if (br === -1) return lt;
    return Math.min(lt, br);
  }

  private warn(reason: BehaviorWarnReason, raw: string): void {
    this.onWarn?.(reason, raw);
  }

  private parseRegistered(tag: string): BehaviorEvent | null {
    const emo = EMO_TAG.exec(tag);
    if (emo) {
      const weight = emo[2] !== undefined ? parseFloat(emo[2]) : 1.0;
      return {
        type: 'emotion',
        name: emo[1]!,
        weight: this.clamp(weight, BEHAVIOR_LIMITS.emotionWeightMax, tag),
      };
    }
    const act = ACT_TAG.exec(tag);
    if (act) {
      const durationMs =
        act[2] !== undefined
          ? this.clamp(parseInt(act[2], 10), BEHAVIOR_LIMITS.actionDurationMaxMs, tag)
          : null;
      return { type: 'action', name: act[1]!, durationMs };
    }
    const wait = WAIT_TAG.exec(tag);
    if (wait) {
      return { type: 'wait', ms: this.clamp(parseInt(wait[1]!, 10), BEHAVIOR_LIMITS.waitMaxMs, tag) };
    }
    const say = SAY_TAG.exec(tag);
    if (say) {
      return { type: 'say', clip: say[1]! };
    }
    const intent = INTENT_TAG.exec(tag);
    if (intent) {
      return { type: 'intent', mood: intent[1]!, energy: intent[2]! };
    }
    return null;
  }

  /** 正则保证非负，越上限 clamp + warn。 */
  private clamp(v: number, max: number, raw: string): number {
    if (v <= max) return v;
    this.warn('value-clamped', raw);
    return max;
  }
}
```

- [ ] **Step 4: 跑绿**

```bash
pnpm exec vitest run test/behavior-parser.test.ts
```

Expected: PASS（既有 13 + 新增 12 = 25 tests）。既有用例零改动全过（`<bogus:xyz/>` 原样文本路径不变）。

- [ ] **Step 5: 提交**

```bash
git add src/behavior-parser.ts test/behavior-parser.test.ts
git commit -m "feat(protocol): behavior parser 解析层生产化 - say stub、数值 clamp、onWarn 钩子"
```

---

### Task 2: 扫描层生产化 — 前缀四态分类 + 溢出兜底 + intent 段首

parser 的核心改造：普通文本零延迟放行、类标签等闭合整段放行 + warn、未闭合超长溢出、intent 段首约束、`hasPendingInput()`。

**Files:**
- Modify: `packages/protocol/src/behavior-parser.ts`
- Test: `packages/protocol/test/behavior-parser.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `behavior-parser.test.ts`：

```ts
describe('prefix classification — plain text passes through instantly (M3)', () => {
  it('math-like "<" never buffers: a < b stays whole-ish text with zero warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('a < b and c > d'), ...p.flush()];
    expect(events.map((e) => (e.type === 'text' ? e.text : e)).join('')).toBe('a < b and c > d');
    expect(p.hasPendingInput()).toBe(false);
    expect(warns).toEqual([]);
  });

  it('i<3 you releases immediately', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('i<3 you')];
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('i<3 you');
    expect(p.hasPendingInput()).toBe(false);
  });

  it('markdown link [text](url) releases immediately without waiting for ]', () => {
    const p = new BehaviorParser();
    // 关键：feed 到 "[link" 为止就该放行 "["（不等永远may不来的 "]"）
    const e1 = [...p.feed('see [link')];
    expect(e1.map((e) => (e as { text: string }).text).join('')).toBe('see [link');
    const e2 = [...p.feed('](url)')];
    expect(e2.map((e) => (e as { text: string }).text).join('')).toBe('](url)');
  });

  it('array index arr[0] passes through', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('arr[0] = 1'), ...p.flush()];
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('arr[0] = 1');
  });

  it('double angle <<emo:shy/> releases first < then parses the tag', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<<emo:shy/>')]).toEqual([
      { type: 'text', text: '<' },
      { type: 'emotion', name: 'shy', weight: 1.0 },
    ]);
  });

  it('closing-slash </div> is reject (slash is not a letter), no warn', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('x</div>y'), ...p.flush()];
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('x</div>y');
    expect(warns).toEqual([]);
  });

  it('CJK brackets are not markers at all', () => {
    const p = new BehaviorParser();
    expect([...p.feed('《书》〈角〉【框】不是标签')]).toEqual([
      { type: 'text', text: '《书》〈角〉【框】不是标签' },
    ]);
  });
});

describe('unregistered tag-like input (M3)', () => {
  it('emits <bogus:xyz/> as one literal text and warns unregistered-tag', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('a<bogus:xyz/>b')]).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: '<bogus:xyz/>' },
      { type: 'text', text: 'b' },
    ]);
    expect(warns).toEqual([{ reason: 'unregistered-tag', raw: '<bogus:xyz/>' }]);
  });

  it('html-ish <div> warns unregistered-tag and passes through', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('<div>hello')];
    expect(events[0]).toEqual({ type: 'text', text: '<div>' });
    expect(warns.map((w) => w.reason)).toEqual(['unregistered-tag']);
  });

  it('unregistered tag split across chunks still assembles', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const e1 = [...p.feed('<bog')];
    expect(e1).toEqual([]); // taglike，等闭合
    const e2 = [...p.feed('us:x/>done')];
    expect(e2).toEqual([
      { type: 'text', text: '<bogus:x/>' },
      { type: 'text', text: 'done' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['unregistered-tag']);
  });
});

describe('malformed registered tags (M3)', () => {
  it('warns malformed-tag for bad emo body', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:bad name/>')]).toEqual([{ type: 'text', text: '<emo:bad name/>' }]);
    expect(warns).toEqual([{ reason: 'malformed-tag', raw: '<emo:bad name/>' }]);
  });

  it('warns malformed-tag for <wait foo/>', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<wait foo/>')]).toEqual([{ type: 'text', text: '<wait foo/>' }]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('warns malformed-tag for incomplete intent ([intent mood=x])', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('[intent mood=x]hi')]).toEqual([
      { type: 'text', text: '[intent mood=x]' },
      { type: 'text', text: 'hi' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('double-dot weight now warns malformed-tag (Task 1 left it silent)', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:sad w=1.2.3/>')]).toEqual([{ type: 'text', text: '<emo:sad w=1.2.3/>' }]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('say with extra params warns malformed-tag', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<say:hi w=1/>')]).toEqual([{ type: 'text', text: '<say:hi w=1/>' }]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('nested tags are misuse: outer half becomes malformed literal, no event leakage', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    // 第一个 ">" 在内层 <act:wave/> 处闭合 → raw "<emo:ha<act:wave/>" 不合语法
    expect([...p.feed('<emo:ha<act:wave/>ppy/>')]).toEqual([
      { type: 'text', text: '<emo:ha<act:wave/>' },
      { type: 'text', text: 'ppy/>' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });
});

describe('tag overflow guard (M3)', () => {
  it('releases an unclosed over-long registered prefix as text with tag-overflow', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const long = '<emo:' + 'a'.repeat(140); // 145 chars，无 ">"
    const events = [...p.feed(long)];
    expect(events).toEqual([{ type: 'text', text: long }]);
    expect(warns.map((w) => w.reason)).toEqual(['tag-overflow']);
    expect(p.hasPendingInput()).toBe(false);
  });

  it('overflow fires across incremental feeds too', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    let released = '';
    let all = '';
    for (let i = 0; i < 150; i++) {
      const c = i === 0 ? '<' : 'x';
      all += c;
      for (const e of p.feed(c)) released += (e as { text: string }).text;
    }
    expect(warns.map((w) => w.reason)).toEqual(['tag-overflow']);
    for (const e of p.flush()) released += (e as { text: string }).text;
    expect(released).toBe(all); // 文本无损
  });

  it('a fully closed long tag is NOT overflow (limit is the waiting window)', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const name = 'a'.repeat(150);
    expect([...p.feed(`<emo:${name}/>`)]).toEqual([{ type: 'emotion', name, weight: 1.0 }]);
    expect(warns).toEqual([]);
  });
});

describe('intent is head-only (M3)', () => {
  it('accepts intent after leading whitespace/newlines', () => {
    const p = new BehaviorParser();
    expect([...p.feed('  \n[intent mood=calm energy=high]go')]).toEqual([
      { type: 'text', text: '  \n' },
      { type: 'intent', mood: 'calm', energy: 'high' },
      { type: 'text', text: 'go' },
    ]);
  });

  it('demotes mid-reply intent to literal text with misplaced-intent', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('text first [intent mood=shy energy=low] after')]).toEqual([
      { type: 'text', text: 'text first ' },
      { type: 'text', text: '[intent mood=shy energy=low]' },
      { type: 'text', text: ' after' },
    ]);
    expect(warns).toEqual([{ reason: 'misplaced-intent', raw: '[intent mood=shy energy=low]' }]);
  });

  it('a second intent is misplaced even right after the first', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('[intent mood=a energy=b][intent mood=c energy=d]')];
    expect(events).toEqual([
      { type: 'intent', mood: 'a', energy: 'b' },
      { type: 'text', text: '[intent mood=c energy=d]' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['misplaced-intent']);
  });

  it('intent after a behavior event is misplaced', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('<emo:happy/>[intent mood=a energy=b]')];
    expect(events).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'text', text: '[intent mood=a energy=b]' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['misplaced-intent']);
  });

  it('head state survives chunk boundaries (whitespace chunks first)', () => {
    const p = new BehaviorParser();
    const events = [...p.feed(' '), ...p.feed('\n'), ...p.feed('[intent mood=a energy=b]x')];
    expect(events).toEqual([
      { type: 'text', text: ' ' },
      { type: 'text', text: '\n' },
      { type: 'intent', mood: 'a', energy: 'b' },
      { type: 'text', text: 'x' },
    ]);
  });
});

describe('hasPendingInput (M3, ConversationCore stale-flush 的武装依据)', () => {
  it('true while a half tag is buffered, false after flush', () => {
    const p = new BehaviorParser();
    void [...p.feed('hi <emo:')];
    expect(p.hasPendingInput()).toBe(true);
    void [...p.flush()];
    expect(p.hasPendingInput()).toBe(false);
  });

  it('false after plain text fully drains', () => {
    const p = new BehaviorParser();
    void [...p.feed('plain')];
    expect(p.hasPendingInput()).toBe(false);
  });

  it('parser remains usable after flush (stale-flush continuation)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('a<emo:')]).toEqual([{ type: 'text', text: 'a' }]);
    expect([...p.flush()]).toEqual([{ type: 'text', text: '<emo:' }]);
    expect([...p.feed('<emo:happy/>')]).toEqual([{ type: 'emotion', name: 'happy', weight: 1.0 }]);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
pnpm exec vitest run test/behavior-parser.test.ts
```

Expected: FAIL —— `hasPendingInput` 不存在；`a < b` 用例 buffer 不放行；misplaced intent 仍被解析为事件等。
注意有一个**既有用例会从绿变化**：无 —— `<bogus:xyz/>` 既有断言（三段 text）与新分类下的输出一致，只是新增 warn；既有用例不查 warn，保持绿。

- [ ] **Step 3: 实现**

替换 `behavior-parser.ts` 中 `BehaviorParser` 类与新增模块级常量（`BehaviorEvent`/`BEHAVIOR_LIMITS`/`BehaviorWarnReason`/`BehaviorParserOptions`/五个 TAG 正则保持 Task 1 原样）：

```ts
/** `<` 家族注册前缀（顺序无关）；`[` 家族只有 intent。 */
const ANGLE_PREFIXES = ['<emo:', '<act:', '<say:', '<wait '] as const;
const INTENT_PREFIX = '[intent ';

type Verdict = 'tag' | 'viable' | 'taglike' | 'reject';

/**
 * 对「从 marker 开始的 buffer」分类：
 *  - tag:     已确认进入注册命名空间（等闭合后解析；解析失败 = malformed）
 *  - viable:  仍可能长成注册前缀（如 `<em`、`[in`），继续等
 *  - taglike: `<字母...` 但非注册（如 `<bogus:`、`<div`）——等闭合整段放行 + warn
 *  - reject:  不可能是任何标签（`< b`、`<3`、`<<`、`</`、`[x`）——立即放行 marker 字符
 * 注册前缀不含闭合符，因此「viable 且 buffer 已含闭合符」不可能出现。
 */
function classify(buf: string): Verdict {
  if (buf[0] === '<') {
    for (const c of ANGLE_PREFIXES) {
      if (buf.startsWith(c)) return 'tag';
      if (c.startsWith(buf)) return 'viable';
    }
    return /^<[a-zA-Z]/.test(buf) ? 'taglike' : 'reject';
  }
  if (buf.startsWith(INTENT_PREFIX)) return 'tag';
  if (INTENT_PREFIX.startsWith(buf)) return 'viable';
  return 'reject';
}

export class BehaviorParser {
  private buffer = '';
  private atHead = true;
  private readonly onWarn: ((reason: BehaviorWarnReason, raw: string) => void) | undefined;

  constructor(opts: BehaviorParserOptions = {}) {
    this.onWarn = opts.onWarn;
  }

  *feed(chunk: string): Generator<BehaviorEvent> {
    this.buffer += chunk;
    yield* this.drain(false);
  }

  /** 吐出残余 buffer 为文本（done 收尾或 300ms stale flush）；parser 之后仍可继续 feed。 */
  *flush(): Generator<BehaviorEvent> {
    yield* this.drain(true);
  }

  /** buffer 里是否还压着未定型的半截输入（宿主据此武装 stale-flush 定时器）。 */
  hasPendingInput(): boolean {
    return this.buffer.length > 0;
  }

  private *drain(flush: boolean): Generator<BehaviorEvent> {
    while (this.buffer.length > 0) {
      const open = this.nextMarker();
      if (open === -1) {
        yield* this.emitText(this.buffer);
        this.buffer = '';
        return;
      }
      if (open > 0) {
        yield* this.emitText(this.buffer.slice(0, open));
        this.buffer = this.buffer.slice(open);
      }
      const verdict = classify(this.buffer);
      if (verdict === 'reject') {
        // marker 字符开启不了任何标签：放行它本身，从下一字符重扫
        yield* this.emitText(this.buffer[0]!);
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const closer = this.buffer[0] === '<' ? '>' : ']';
      const close = this.buffer.indexOf(closer);
      if (close === -1) {
        if (this.buffer.length > BEHAVIOR_LIMITS.maxTagLength) {
          this.warn('tag-overflow', this.buffer);
          yield* this.emitText(this.buffer);
          this.buffer = '';
          return;
        }
        if (flush) {
          yield* this.emitText(this.buffer);
          this.buffer = '';
        }
        return; // 半截标签：等下一个 chunk
      }
      const raw = this.buffer.slice(0, close + 1);
      this.buffer = this.buffer.slice(close + 1);
      if (verdict === 'taglike') {
        this.warn('unregistered-tag', raw);
        yield* this.emitText(raw);
        continue;
      }
      yield* this.emitRegistered(raw);
    }
  }

  private *emitRegistered(raw: string): Generator<BehaviorEvent> {
    const event = this.parseRegistered(raw);
    if (!event) {
      this.warn('malformed-tag', raw);
      yield* this.emitText(raw);
      return;
    }
    if (event.type === 'intent' && !this.atHead) {
      this.warn('misplaced-intent', raw);
      yield* this.emitText(raw);
      return;
    }
    this.atHead = false;
    yield event;
  }

  /** 文本出口统一走这里：维护 intent 的段首状态（非空白文本即破坏段首）。 */
  private *emitText(text: string): Generator<BehaviorEvent> {
    if (text.length === 0) return;
    if (this.atHead && /\S/.test(text)) this.atHead = false;
    yield { type: 'text', text };
  }

  private nextMarker(): number {
    const lt = this.buffer.indexOf('<');
    const br = this.buffer.indexOf('[');
    if (lt === -1) return br;
    if (br === -1) return lt;
    return Math.min(lt, br);
  }

  private warn(reason: BehaviorWarnReason, raw: string): void {
    this.onWarn?.(reason, raw);
  }

  private parseRegistered(tag: string): BehaviorEvent | null {
    // —— Task 1 原样，不改 ——
    const emo = EMO_TAG.exec(tag);
    if (emo) {
      const weight = emo[2] !== undefined ? parseFloat(emo[2]) : 1.0;
      return {
        type: 'emotion',
        name: emo[1]!,
        weight: this.clamp(weight, BEHAVIOR_LIMITS.emotionWeightMax, tag),
      };
    }
    const act = ACT_TAG.exec(tag);
    if (act) {
      const durationMs =
        act[2] !== undefined
          ? this.clamp(parseInt(act[2], 10), BEHAVIOR_LIMITS.actionDurationMaxMs, tag)
          : null;
      return { type: 'action', name: act[1]!, durationMs };
    }
    const wait = WAIT_TAG.exec(tag);
    if (wait) {
      return { type: 'wait', ms: this.clamp(parseInt(wait[1]!, 10), BEHAVIOR_LIMITS.waitMaxMs, tag) };
    }
    const say = SAY_TAG.exec(tag);
    if (say) {
      return { type: 'say', clip: say[1]! };
    }
    const intent = INTENT_TAG.exec(tag);
    if (intent) {
      return { type: 'intent', mood: intent[1]!, energy: intent[2]! };
    }
    return null;
  }

  private clamp(v: number, max: number, raw: string): number {
    if (v <= max) return v;
    this.warn('value-clamped', raw);
    return max;
  }
}
```

实现注意：
- `tag-overflow` 后 `return`（buffer 已清空，等价于循环自然结束）。
- 既有用例 `flush emits buffered incomplete tag as text`（`hi <emo:` → flush）走 `viable/tag` + `flush` 分支，行为不变。
- 既有用例 `parses intent header at start of reply` 段首合法，不受影响。

- [ ] **Step 4: 跑绿**

```bash
pnpm exec vitest run test/behavior-parser.test.ts
```

Expected: PASS（25 + 新增 24 = 49 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/behavior-parser.ts test/behavior-parser.test.ts
git commit -m "feat(protocol): 扫描层生产化 - 前缀四态分类、溢出兜底、intent 段首约束"
```

---

### Task 3: 切分不变性性质测试 + 边界矩阵

纯测试任务：用程序化切分覆盖「半截标签 / 流截断」的全空间，是验收「100+ 边界 case」的主力。**性质：任意切 chunk 的事件序列（合并相邻 text 后）与整串一次 feed+flush 完全相同，且 warn reason 序列相同。**

**Files:**
- Test: `packages/protocol/test/behavior-parser.test.ts`

- [ ] **Step 1: 写测试**（这次直接是绿的——它验证的是 Task 2 已实现的不变量；任何一条红都说明 Task 2 有 bug，按红修实现而不是改测试）

追加：

```ts
// ---------- 切分不变性（性质测试） ----------

function mergeText(events: BehaviorEvent[]): BehaviorEvent[] {
  const out: BehaviorEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + e.text };
    } else if (e.type !== 'text' || e.text !== '') {
      out.push(e);
    }
  }
  return out;
}

function runChunks(chunks: readonly string[]): { events: BehaviorEvent[]; warns: string[] } {
  const warns: string[] = [];
  const p = new BehaviorParser({ onWarn: (reason) => warns.push(reason) });
  const events: BehaviorEvent[] = [];
  for (const c of chunks) events.push(...p.feed(c));
  events.push(...p.flush());
  return { events: mergeText(events), warns };
}

const SPLIT_SAMPLES: readonly string[] = [
  // 1 tech-design §4.1 原例
  '[intent mood=shy energy=low]\n嗯……<emo:shy/>我在想，<act:fidget dur=1800/>要不要请你喝杯热可可？<emo:happy/>',
  // 2 纯文本
  'hello world, nothing special here',
  // 3 单标签
  '<emo:happy/>',
  // 4 全标签家族混排
  'a<emo:sad w=0.6/>b<act:wave/>c<wait ms=500/>d<say:greet/>e[尾巴]',
  // 5 marker 噪声（数学/比较符）
  'i<3 you & a<b but x>y still fine',
  // 6 方括号噪声（markdown / 数组）
  '[链接](https://example.com) 和 arr[0] 以及 [random brackets]',
  // 7 未注册 taglike
  'pre<bogus:x/>mid<div>post',
  // 8 malformed 注册标签
  '<emo:bad name/>oops<wait foo/>and[intent mood=x]tail',
  // 9 中途 intent（误用）
  '[intent mood=a energy=b]开头正常[intent mood=c energy=d]中途要降级',
  // 10 前导空白 + intent
  '  \n\t[intent mood=calm energy=high]前导空白后仍算段首',
  // 11 数值越界 clamp
  '<emo:happy w=1.5/>强烈<wait ms=99999/>久等<act:spin dur=99999999/>',
  // 12 双开角
  'x<<emo:shy/>y',
  // 13 连发标签
  '<emo:shy/><act:sigh/><wait ms=100/><say:hum/>',
  // 14 半截收尾（flush 路径）
  '正文说到一半<emo:',
  // 15 长文本 + 标签
  'x'.repeat(140) + '<emo:happy/>' + 'y'.repeat(40),
  // 16 溢出路径（未闭合超长）
  '<' + 'a'.repeat(140),
  // 17 中文标点不是 marker
  '《书名》〈角标〉【方头】，全都只是文本。',
  // 18 emoji（UTF-16 代理对在切分点被劈开也要无损）
  '😊开心<emo:happy/>🎉庆祝<act:jump/>完',
  // 19 邻接 intent + 立即标签
  '[intent mood=happy energy=high]<emo:happy/>!',
  // 20 嵌套标签（误用）：内层先闭合 → 外层成 malformed 原样放行，内层后的尾巴是纯文本
  '前<emo:ha<act:wave/>ppy/>后',
];

describe('流式切分不变性（性质测试：任意切分 ≡ 整串）', () => {
  it.each(SPLIT_SAMPLES.map((s, i) => [i + 1, s] as const))(
    'sample #%i: every binary split, char-by-char, and thirds agree with whole-string',
    (_i, sample) => {
      const whole = runChunks([sample]);
      for (let cut = 1; cut < sample.length; cut++) {
        const split = runChunks([sample.slice(0, cut), sample.slice(cut)]);
        expect(split.events).toEqual(whole.events);
        expect(split.warns).toEqual(whole.warns);
      }
      const chars = runChunks(sample.split(''));
      expect(chars.events).toEqual(whole.events);
      expect(chars.warns).toEqual(whole.warns);
      const t = Math.max(1, Math.floor(sample.length / 3));
      const thirds = runChunks([sample.slice(0, t), sample.slice(t, 2 * t), sample.slice(2 * t)]);
      expect(thirds.events).toEqual(whole.events);
      expect(thirds.warns).toEqual(whole.warns);
    },
  );

  it('tag syntax never leaks into text events for clean samples', () => {
    // 对不含误用的样例（#1/3/4/13/19），text 事件里不允许残留任何注册标签语法
    for (const sample of [SPLIT_SAMPLES[0]!, SPLIT_SAMPLES[2]!, SPLIT_SAMPLES[3]!, SPLIT_SAMPLES[12]!, SPLIT_SAMPLES[18]!]) {
      const { events, warns } = runChunks([sample]);
      expect(warns).toEqual([]);
      for (const e of events) {
        if (e.type === 'text') {
          expect(e.text).not.toMatch(/<emo:[\w-]+\s*\/>|<act:[\w-]+|<wait ms=\d+\s*\/>|<say:[\w-]+\s*\/>|^\[intent /);
        }
      }
    }
  });
});

// ---------- flush 行为与钩子安全 ----------

describe('flush & hook edge cases (M3)', () => {
  it('flush mid-stream then continue: subsequent tags still parse', () => {
    const p = new BehaviorParser();
    void [...p.feed('a<act:')]; // 半截
    expect([...p.flush()]).toEqual([{ type: 'text', text: '<act:' }]);
    expect([...p.feed('<act:wave/>')]).toEqual([{ type: 'action', name: 'wave', durationMs: null }]);
  });

  it('flush with a viable [ prefix releases it as text', () => {
    const p = new BehaviorParser();
    void [...p.feed('x[inte')];
    expect([...p.flush()]).toEqual([{ type: 'text', text: '[inte' }]);
  });

  it('flushing twice is idempotent', () => {
    const p = new BehaviorParser();
    void [...p.feed('y<emo:')];
    void [...p.flush()];
    expect([...p.flush()]).toEqual([]);
  });

  it('empty feed is a no-op', () => {
    const p = new BehaviorParser();
    expect([...p.feed('')]).toEqual([]);
    expect(p.hasPendingInput()).toBe(false);
  });

  it('whitespace-only stream stays head (intent after it is still valid)', () => {
    const p = new BehaviorParser();
    void [...p.feed('   ')];
    expect([...p.feed('[intent mood=a energy=b]')]).toEqual([
      { type: 'intent', mood: 'a', energy: 'b' },
    ]);
  });

  it('warn hook is optional everywhere (all warn paths run without onWarn)', () => {
    const p = new BehaviorParser();
    const all = [
      ...p.feed('<emo:x w=9/>'), // value-clamped
      ...p.feed('<bogus:y/>'), // unregistered
      ...p.feed('<wait zzz/>'), // malformed
      ...p.feed('t[intent mood=a energy=b]'), // misplaced
      ...p.feed('<' + 'q'.repeat(140)), // overflow
      ...p.flush(),
    ];
    expect(all.length).toBeGreaterThan(0); // 不炸即过，事件细节由上面各组覆盖
  });
});
```

- [ ] **Step 2: 跑（预期绿；红则修 Task 2 实现）**

```bash
pnpm exec vitest run test/behavior-parser.test.ts
```

Expected: PASS（49 + 23 = 72 tests；其中 20 条性质 it 每条内部含数十到数百次断言）。
若某 sample 的某切点红：**这是 Task 2 实现 bug**（最可能在 atHead 跨 chunk 或 overflow 触发时机），用失败切点最小化重现修 `behavior-parser.ts`，不要改性质断言。

- [ ] **Step 3: 提交**

```bash
git add test/behavior-parser.test.ts
git commit -m "test(protocol): 流式切分不变性性质测试 + 边界矩阵（20 样例全切点）"
```

---

### Task 4: Persona few-shot 模板

**Files:**
- Create: `packages/protocol/src/persona-prompt-template.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/persona-prompt-template.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/protocol/test/persona-prompt-template.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  buildBehaviorPrompt,
  BEHAVIOR_FEWSHOTS,
  DEFAULT_EMOTIONS,
  DEFAULT_ACTIONS,
} from '../src/persona-prompt-template';
import { BehaviorParser, BEHAVIOR_LIMITS, type BehaviorEvent } from '../src/behavior-parser';

describe('buildBehaviorPrompt', () => {
  it('lists every default emotion and action by name', () => {
    const prompt = buildBehaviorPrompt();
    for (const e of DEFAULT_EMOTIONS) expect(prompt).toContain(e);
    for (const a of DEFAULT_ACTIONS) expect(prompt).toContain(a);
  });

  it('documents tag syntax and numeric limits from BEHAVIOR_LIMITS', () => {
    const prompt = buildBehaviorPrompt();
    expect(prompt).toContain('[intent mood=');
    expect(prompt).toContain('<emo:');
    expect(prompt).toContain('<act:');
    expect(prompt).toContain('<wait ms=');
    expect(prompt).toContain(String(BEHAVIOR_LIMITS.waitMaxMs));
    expect(prompt).toContain(String(BEHAVIOR_LIMITS.actionDurationMaxMs));
  });

  it('never mentions the say tag (V1+ stub: 不教模型输出会被丢弃的标签)', () => {
    expect(buildBehaviorPrompt()).not.toContain('<say:');
  });

  it('accepts custom emotion/action vocabularies', () => {
    const prompt = buildBehaviorPrompt({ emotions: ['blink'], actions: ['spin'] });
    expect(prompt).toContain('blink');
    expect(prompt).toContain('spin');
    expect(prompt).not.toContain('fidget');
  });

  it('includes every few-shot verbatim', () => {
    const prompt = buildBehaviorPrompt();
    for (const shot of BEHAVIOR_FEWSHOTS) expect(prompt).toContain(shot);
  });
});

describe('few-shot 自洽：示例必须被 BehaviorParser 零告警解析', () => {
  it.each(BEHAVIOR_FEWSHOTS.map((s, i) => [i + 1, s] as const))(
    'few-shot #%i parses clean: starts with intent, no warns, no tag text leakage',
    (_i, shot) => {
      const warns: string[] = [];
      const p = new BehaviorParser({ onWarn: (reason) => warns.push(reason) });
      const events: BehaviorEvent[] = [...p.feed(shot), ...p.flush()];
      expect(warns).toEqual([]);
      expect(events[0]?.type).toBe('intent');
      for (const e of events) {
        if (e.type === 'text') {
          expect(e.text).not.toMatch(/<emo:|<act:|<wait |\[intent /);
        }
      }
      expect(events.some((e) => e.type === 'emotion')).toBe(true);
    },
  );
});
```

- [ ] **Step 2: 跑红**

```bash
pnpm exec vitest run test/persona-prompt-template.test.ts
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

新建 `packages/protocol/src/persona-prompt-template.ts`：

```ts
/**
 * Persona 系统提示的「行为标签」注入段（tech-design §4.1 System Prompt 注入策略）。
 *
 * M3 只负责把模板收口进 protocol 包；M6 ContextAssembler 组装 system prompt 时
 * 按角色包的实际表情/动作词表调用 buildBehaviorPrompt。few-shot 示例导出为常量，
 * 测试用它喂回 BehaviorParser 做自洽校验——模板与解析器永不漂移。
 *
 * 注意：<say:.../> 是 V1+ 语音标签，解析器支持但消费端丢弃（stub），
 * 模板刻意不教——教了只会让模型输出被静默吞掉的标签。
 */
import { BEHAVIOR_LIMITS } from './behavior-parser.js';

export interface BehaviorPromptOptions {
  /** 角色可用的表情名（VRM BlendShape，由角色包提供；缺省 8 基础表情）。 */
  emotions?: readonly string[];
  /** 角色可用的动作 clip 名。 */
  actions?: readonly string[];
}

export const DEFAULT_EMOTIONS: readonly string[] = [
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'shy',
  'curious',
  'sleepy',
];

export const DEFAULT_ACTIONS: readonly string[] = [
  'wave',
  'nod',
  'shake',
  'fidget',
  'stretch',
  'sigh',
  'jump',
  'tilt',
];

/** few-shot 示例（与 tech-design §4.1 示例同源）；必须能被 BehaviorParser 零告警解析。 */
export const BEHAVIOR_FEWSHOTS: readonly string[] = [
  '[intent mood=shy energy=low]\n嗯……<emo:shy/>我在想，<act:fidget dur=1800/>要不要请你喝杯热可可？<emo:happy/>',
  '[intent mood=happy energy=high]\n真的吗！<emo:happy/><act:jump/>太好了！<wait ms=400/>那我们现在就开始吧！',
];

/** 生成嵌入 Persona system prompt 的行为标签规约 + few-shot 段落。 */
export function buildBehaviorPrompt(opts: BehaviorPromptOptions = {}): string {
  const emotions = opts.emotions ?? DEFAULT_EMOTIONS;
  const actions = opts.actions ?? DEFAULT_ACTIONS;
  return [
    '## 行为标签（可选）',
    '',
    '你可以在回复中嵌入以下标签，让你的桌面形象随文字实时做出表情和动作。不使用任何标签也完全可以。',
    '',
    '- 回复最开头（任何正文之前）可以声明本次回复的基调：`[intent mood=心情 energy=low|mid|high]`，每条回复至多一次、只能放在最前面。',
    `- \`<emo:名字/>\` 或 \`<emo:名字 w=0.7/>\`：切换表情；w 是 0~${BEHAVIOR_LIMITS.emotionWeightMax} 的强度，省略时为 1。可用表情：${emotions.join(', ')}。`,
    `- \`<act:名字/>\` 或 \`<act:名字 dur=1500/>\`：播放一个动作；dur 是毫秒，最长 ${BEHAVIOR_LIMITS.actionDurationMaxMs}，省略时用动画自身长度。可用动作：${actions.join(', ')}。`,
    `- \`<wait ms=500/>\`：让文字停顿一下再继续，最长 ${BEHAVIOR_LIMITS.waitMaxMs} 毫秒。`,
    '- 标签必须独立完整地写出，不要嵌套、不要写成对的开闭标签、不要发明新标签。',
    '',
    '### 示例',
    '',
    ...BEHAVIOR_FEWSHOTS.flatMap((shot) => [shot, '']),
  ].join('\n');
}
```

`packages/protocol/src/index.ts` 加一行导出（版本号此处先不动，Task 5 统一改）：

```ts
export * from './persona-prompt-template.js';
```

- [ ] **Step 4: 跑绿**

```bash
pnpm exec vitest run
```

Expected: PASS（protocol 全部文件；few-shot 自洽 2 条全过）。

- [ ] **Step 5: 提交**

```bash
git add src/persona-prompt-template.ts src/index.ts test/persona-prompt-template.test.ts
git commit -m "feat(protocol): persona few-shot 行为标签模板（与 parser 自洽校验）"
```

---

### Task 5: 覆盖率门槛 ≥90% + 协议版本 0.3.0

**Files:**
- Create: `packages/protocol/vitest.config.ts`
- Modify: `packages/protocol/package.json`
- Modify: `packages/protocol/src/index.ts:1`

- [ ] **Step 1: 安装 coverage provider**

```bash
cd /d/desk/Desktop/openpet
pnpm --filter @desksoul/protocol add -D @vitest/coverage-v8@^1.6.0
```

（纯 JS 包无原生二进制，走默认 registry 即可；版本与 vitest 1.6.1 同 minor。）

- [ ] **Step 2: 写 coverage 配置（即「失败测试」——门槛就是断言）**

新建 `packages/protocol/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'], // 纯 re-export，无可测逻辑
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```

`packages/protocol/package.json` 的 test script 改为：

```json
"test": "vitest run --coverage"
```

- [ ] **Step 3: 跑门槛**

```bash
pnpm --filter @desksoul/protocol test
```

Expected: PASS 且 coverage 表格中 behavior-parser.ts / persona-prompt-template.ts / jsonrpc.ts / methods.ts / schemas.ts 各维度 ≥90%。
若某文件某维度 <90：**补针对性测试**（看报告里未覆盖行号，最可能是 jsonrpc.ts 的错误分支），不降门槛、不加 exclude。

- [ ] **Step 4: 升协议版本 + 全量构建回归**

`packages/protocol/src/index.ts:1` 改为：

```ts
export const PROTOCOL_VERSION = '0.3.0';
```

（仓内无对 '0.2.0' 字面量的测试断言，已 grep 核实；若 CI 另有发现按报错改。）

```bash
pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/desktop typecheck
```

Expected: 全过。desktop typecheck 应当干净——`BehaviorEvent` 新增 `say` 变体后，`conversation-core.ts` 的 switch **没有 default 也没有穷尽检查**，TS 对「漏 case 的 switch」不报错（这正是 Task 6 要补的行为缺口，不是类型错误）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/vitest.config.ts packages/protocol/package.json packages/protocol/src/index.ts pnpm-lock.yaml
git commit -m "chore(protocol): 覆盖率门槛 90% 进 test script + 协议版本 0.3.0"
```

---

### Task 6: ConversationCore — say stub + warn 接线 + 300ms stale flush

desktop 侧第一刀：引入 `SessionState`（parser + staleTimer），不动通知发射路径（gate 是 Task 7）。

**Files:**
- Modify: `apps/desktop/electron/main/conversation-core.ts`
- Test: `apps/desktop/test/conversation-core.test.ts`

- [ ] **Step 0: 确保 protocol dist 是新的**（desktop 测试 resolve dist）

```bash
pnpm --filter @desksoul/protocol build
```

- [ ] **Step 1: 写失败测试**

`apps/desktop/test/conversation-core.test.ts` 顶部 import 改为：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ConversationCore,
  STALE_FLUSH_MS,
  type Notification,
} from '../electron/main/conversation-core';
import type { ChatEvent } from '@desksoul/protocol';
```

文件末尾追加：

```ts
describe('ConversationCore M3: say stub / warn wiring / stale flush', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('say events are consumed silently (stub until V1+ voice)', () => {
    const out = run([
      { type: 'delta', text: 'a<say:greet/>b' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'a' } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'b' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('forwards parser warns with sessionId through opts.warn', () => {
    const warns: Array<[string, string, string]> = [];
    const core = new ConversationCore(() => {}, {
      warn: (sid, reason, raw) => warns.push([sid, reason, raw]),
    });
    core.handleEvent('s9', { type: 'delta', text: '<emo:x w=5/>' });
    expect(warns).toEqual([['s9', 'value-clamped', '<emo:x w=5/>']]);
  });

  it('stale flush: a half tag is released as text after STALE_FLUSH_MS of silence', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const warns: string[] = [];
    const core = new ConversationCore((n) => out.push(n), {
      warn: (_sid, reason) => warns.push(reason),
    });
    core.handleEvent('s1', { type: 'delta', text: '想了想<emo:' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '想了想' } },
    ]);
    vi.advanceTimersByTime(STALE_FLUSH_MS - 1);
    expect(out).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(out[1]).toEqual({
      channel: 'chat.stream',
      sessionId: 's1',
      params: { sessionId: 's1', text: '<emo:' },
    });
    expect(warns).toContain('stale-flush');
  });

  it('a fresh delta within the window re-arms the timer and the tag still parses', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'hi <emo:' });
    vi.advanceTimersByTime(STALE_FLUSH_MS - 1);
    core.handleEvent('s1', { type: 'delta', text: 'happy/>!' });
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'hi ' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '!' } },
    ]);
  });

  it('stream continues normally after a stale flush', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: '<emo:' });
    vi.advanceTimersByTime(STALE_FLUSH_MS);
    core.handleEvent('s1', { type: 'delta', text: '<emo:happy/>ok' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '<emo:' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'ok' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('no stale timer fires when the buffer is empty (plain text deltas)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'plain' });
    vi.advanceTimersByTime(STALE_FLUSH_MS * 3);
    expect(out).toHaveLength(1);
  });

  it('done clears the stale timer (no late text after done)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' });
    const len = out.length;
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toHaveLength(len);
  });

  it('cancel clears the stale timer (no text leaks after cancel)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.cancel('s1');
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'a' } },
    ]);
  });

  it('dispose clears all timers across sessions', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: '<emo:' });
    core.handleEvent('s2', { type: 'delta', text: '<act:' });
    core.dispose();
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
cd apps/desktop && pnpm exec vitest run test/conversation-core.test.ts
```

Expected: FAIL —— `STALE_FLUSH_MS` 无导出、构造第二参不存在、say 行为缺失。

- [ ] **Step 3: 实现**

`conversation-core.ts` 整体替换（Notification 类型与文件头注释保持 M2 原样，此处省略未变部分的注释；**完整文件**如下）：

```ts
/**
 * ConversationCore — the dual-channel splitter (Main-side).
 *
 * Consumes provider `ChatEvent`s for a session, feeds delta text through the
 * `BehaviorParser`, and emits two parallel notification streams:
 *   - chat.*      → UI Overlay (clean text, stripped of tags; done)
 *   - behavior.*  → Character window (emotion / action / intent)
 *
 * M3 生产化：
 *   - fail-safe：300ms 无新 delta 时把半截标签 buffer 放行为文本（stale flush）。
 *   - 解析告警（非法/越界/误用标签）经 opts.warn 出口，缺省 console.warn。
 *   - <say:.../> 解析后静默丢弃（V1+ 语音）。
 *
 * Pure and Electron-free so it can be unit-tested directly; the Main process
 * wires `notify` to `webContents.send`.
 */
import {
  BehaviorParser,
  type BehaviorEvent,
  type ChatEvent,
  type BehaviorWarnReason,
} from '@desksoul/protocol';

export type Notification =
  | { channel: 'chat.stream'; sessionId: string; params: { sessionId: string; text: string } }
  | {
      channel: 'chat.done';
      sessionId: string;
      params: { sessionId: string; finishReason: 'stop' | 'cancel' | 'error' };
    }
  | {
      channel: 'behavior.applyEmotion';
      sessionId: string;
      params: { name: string; weight: number };
    }
  | {
      channel: 'behavior.playAction';
      sessionId: string;
      params: { name: string; durationMs: number | null };
    }
  | { channel: 'behavior.setIntent'; sessionId: string; params: { mood: string; energy: string } };

/** tech-design §4.1 fail-safe：300ms 无新 token，半截标签强制 flush 为文本。 */
export const STALE_FLUSH_MS = 300;

export interface ConversationCoreOptions {
  /** 协议告警出口（sessionId + parser 的 reason/raw）；缺省 console.warn。 */
  warn?: (sessionId: string, reason: string, raw: string) => void;
}

interface SessionState {
  parser: BehaviorParser;
  staleTimer: ReturnType<typeof setTimeout> | null;
}

/** One state per active session so interleaved sessions don't share buffer state. */
export class ConversationCore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly cancelling = new Set<string>();
  private readonly warnOut: (sessionId: string, reason: string, raw: string) => void;

  constructor(
    private readonly notify: (n: Notification) => void,
    opts: ConversationCoreOptions = {},
  ) {
    this.warnOut =
      opts.warn ?? ((sid, reason, raw) => console.warn(`[behavior:${sid}] ${reason}: ${raw}`));
  }

  /**
   * 取消该 session：此后迟到的 delta 直接丢弃，半截标签 buffer 与定时器一并废弃
   * （取消语义下不值得 flush 成文本）。调用方必须保证之后会有一个 done
   * 事件（ProviderHost 协作取消或 watchdog 强杀都会合成）——done 负责清标记。
   */
  cancel(sessionId: string): void {
    this.teardown(sessionId);
    this.cancelling.add(sessionId);
  }

  /** Route a single provider event for `sessionId` into the two channels. */
  handleEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'delta') {
      if (this.cancelling.has(sessionId)) return; // 取消后迟到的 delta
      const state = this.stateFor(sessionId);
      for (const be of state.parser.feed(event.text)) this.emitBehavior(sessionId, be);
      this.armStaleTimer(sessionId, state);
      return;
    }
    // done: flush any buffered half-tag as text, then close both channels.
    this.cancelling.delete(sessionId);
    const state = this.sessions.get(sessionId);
    if (state) {
      this.clearStaleTimer(state);
      for (const be of state.parser.flush()) this.emitBehavior(sessionId, be);
      this.sessions.delete(sessionId);
    }
    this.notify({
      channel: 'chat.done',
      sessionId,
      params: { sessionId, finishReason: event.finishReason },
    });
  }

  /** 清理全部 session 状态与定时器（app 退出路径，ChatService.dispose 调用）。 */
  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) this.teardown(sessionId);
    this.cancelling.clear();
  }

  private stateFor(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        parser: new BehaviorParser({
          onWarn: (reason: BehaviorWarnReason, raw: string) => this.warnOut(sessionId, reason, raw),
        }),
        staleTimer: null,
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** 半截标签在 buffer 里才武装定时器；到点放行为文本，流恢复后解析照常。 */
  private armStaleTimer(sessionId: string, state: SessionState): void {
    this.clearStaleTimer(state);
    if (!state.parser.hasPendingInput()) return;
    state.staleTimer = setTimeout(() => {
      state.staleTimer = null;
      const events = [...state.parser.flush()];
      if (events.length === 0) return;
      this.warnOut(
        sessionId,
        'stale-flush',
        events.map((e) => (e.type === 'text' ? e.text : '')).join(''),
      );
      for (const be of events) this.emitBehavior(sessionId, be);
    }, STALE_FLUSH_MS);
  }

  private clearStaleTimer(state: SessionState): void {
    if (state.staleTimer) {
      clearTimeout(state.staleTimer);
      state.staleTimer = null;
    }
  }

  private teardown(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.clearStaleTimer(state);
    this.sessions.delete(sessionId);
  }

  private emitBehavior(sessionId: string, be: BehaviorEvent): void {
    switch (be.type) {
      case 'text':
        this.notify({ channel: 'chat.stream', sessionId, params: { sessionId, text: be.text } });
        break;
      case 'emotion':
        this.notify({
          channel: 'behavior.applyEmotion',
          sessionId,
          params: { name: be.name, weight: be.weight },
        });
        break;
      case 'action':
        this.notify({
          channel: 'behavior.playAction',
          sessionId,
          params: { name: be.name, durationMs: be.durationMs },
        });
        break;
      case 'intent':
        this.notify({
          channel: 'behavior.setIntent',
          sessionId,
          params: { mood: be.mood, energy: be.energy },
        });
        break;
      case 'say':
        // V1+ 语音：解析层支持，消费端 stub（impl-plan M3「say 留 stub」）。
        break;
      case 'wait':
        // Task 7 接管：per-session 发射门实现文本流停顿。
        break;
    }
  }
}
```

- [ ] **Step 4: 跑绿**

```bash
pnpm exec vitest run test/conversation-core.test.ts
```

Expected: PASS（既有 10 + 新增 9 = 19 tests）。既有 M2 用例零改动（构造第二参可选、行为兼容）。

- [ ] **Step 5: 提交**

```bash
git add electron/main/conversation-core.ts test/conversation-core.test.ts
git commit -m "feat(desktop): conversation-core 300ms stale flush fail-safe + say stub + 告警接线"
```

---

### Task 7: ConversationCore — `<wait/>` 发射门 + cancel 交互 + dispose 接线

**Files:**
- Modify: `apps/desktop/electron/main/conversation-core.ts`
- Modify: `apps/desktop/electron/main/chat-service.ts:111-115`
- Test: `apps/desktop/test/conversation-core.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `conversation-core.test.ts`：

```ts
describe('ConversationCore M3: <wait/> 发射门（文本流停顿）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function textOf(n: Notification): string {
    return n.channel === 'chat.stream' ? n.params.text : `[${n.channel}]`;
  }

  it('delays text after <wait ms=500/> by exactly 500ms', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=500/>b' });
    expect(out.map(textOf)).toEqual(['a']);
    vi.advanceTimersByTime(499);
    expect(out.map(textOf)).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(out.map(textOf)).toEqual(['a', 'b']);
  });

  it('chains two waits cumulatively and keeps order', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=100/>b<wait ms=200/>c' });
    vi.advanceTimersByTime(100);
    expect(out.map(textOf)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(199);
    expect(out.map(textOf)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(out.map(textOf)).toEqual(['a', 'b', 'c']);
  });

  it('behavior events queue behind the gate too (no reordering around text)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=100/><emo:happy/>b' });
    expect(out.map((n) => n.channel)).toEqual(['chat.stream']);
    vi.advanceTimersByTime(100);
    expect(out.map((n) => n.channel)).toEqual([
      'chat.stream',
      'behavior.applyEmotion',
      'chat.stream',
    ]);
  });

  it('done waits for the gate to drain (UI never sees done before its text)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=300/>b' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' });
    expect(out.map((n) => n.channel)).toEqual(['chat.stream']);
    vi.advanceTimersByTime(300);
    expect(out.map((n) => n.channel)).toEqual(['chat.stream', 'chat.stream', 'chat.done']);
    expect(out[2]!.params).toMatchObject({ finishReason: 'stop' });
  });

  it('wait ms=0 is a no-op (no timer, instant passthrough)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=0/>b' });
    expect(out.map(textOf)).toEqual(['a', 'b']);
  });

  it('cancel while gated WITHOUT pending done: drops queued text, host done seals later', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=5000/>never-shown' });
    core.cancel('s1');
    vi.advanceTimersByTime(10_000);
    expect(out.map(textOf)).toEqual(['a']); // 排队文本被丢弃
    core.handleEvent('s1', { type: 'done', finishReason: 'cancel' }); // host 合成
    expect(out.at(-1)).toMatchObject({ channel: 'chat.done', params: { finishReason: 'cancel' } });
  });

  it('cancel while gated WITH pending done: synthesizes done(cancel) immediately, no deadlock', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=5000/>tail' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' }); // 流已结束，done 压在门后
    core.cancel('s1');
    // 立即封口：done(cancel)，且不再发 tail
    expect(out.at(-1)).toEqual({
      channel: 'chat.done',
      sessionId: 's1',
      params: { sessionId: 's1', finishReason: 'cancel' },
    });
    vi.advanceTimersByTime(10_000);
    expect(out.filter((n) => n.channel === 'chat.done')).toHaveLength(1);
    // 且 cancelling 无残留：下一个流正常
    core.handleEvent('s1', { type: 'delta', text: 'fresh' });
    expect(out.at(-1)).toMatchObject({ channel: 'chat.stream', params: { text: 'fresh' } });
  });

  it('gates are per-session independent', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=1000/>slow' });
    core.handleEvent('s2', { type: 'delta', text: 'quick' });
    expect(out.map((n) => n.sessionId)).toEqual(['s1', 's2']);
    expect(out.map(textOf)).toEqual(['a', 'quick']);
  });

  it('stale flush text queues behind an open gate (order preserved)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=1000/>b<emo:' }); // 半截 + 门开着
    vi.advanceTimersByTime(STALE_FLUSH_MS); // stale flush 在门内排队
    expect(out.map(textOf)).toEqual(['a']);
    vi.advanceTimersByTime(1000 - STALE_FLUSH_MS);
    expect(out.map(textOf)).toEqual(['a', 'b', '<emo:']);
  });

  it('dispose clears gate timers (no late emissions)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<wait ms=1000/>b' });
    core.dispose();
    vi.advanceTimersByTime(5000);
    expect(out.map(textOf)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
pnpm exec vitest run test/conversation-core.test.ts
```

Expected: FAIL —— wait 仍被忽略（`a<wait ms=500/>b` 立即吐出 'a','b'）。

- [ ] **Step 3: 实现**

`conversation-core.ts` 改动三处（其余 Task 6 原样）：

**(1) SessionState 扩展 + 发射门字段：**

```ts
type GateEntry = { kind: 'notify'; n: Notification } | { kind: 'delay'; ms: number };

interface SessionState {
  parser: BehaviorParser;
  staleTimer: ReturnType<typeof setTimeout> | null;
  /** <wait/> 发射门：null = 直通；非 null = 延迟中，后续通知进 pending。 */
  gateTimer: ReturnType<typeof setTimeout> | null;
  gatePending: GateEntry[];
  /** done 已入队：gate 排空后自毁 state。 */
  endAfterDrain: boolean;
}
```

`stateFor` 的初始化补上 `gateTimer: null, gatePending: [], endAfterDrain: false`。

**(2) 通知发射统一走门；wait 事件转 delay：**

`emitBehavior` 里所有 `this.notify({...})` 改为 `this.send(sessionId, {...})`（text/emotion/action/intent 四处），`case 'wait':` 改为：

```ts
      case 'wait':
        // 文本流停顿（tech-design §4.1）：parser 已 clamp ≤10s；0ms 视为无停顿。
        if (be.ms > 0) this.addDelay(sessionId, be.ms);
        break;
```

`handleEvent` 的 done 分支改为（替换原「flush + delete + notify」段）：

```ts
    // done: flush any buffered half-tag as text, then close both channels.
    // 若 <wait/> 门开着，done 与残余文本一起排队——UI 永远先看到文本再看到 done。
    this.cancelling.delete(sessionId);
    const state = this.sessions.get(sessionId);
    const doneNotification: Notification = {
      channel: 'chat.done',
      sessionId,
      params: { sessionId, finishReason: event.finishReason },
    };
    if (!state) {
      this.notify(doneNotification);
      return;
    }
    this.clearStaleTimer(state);
    for (const be of state.parser.flush()) this.emitBehavior(sessionId, be);
    this.send(sessionId, doneNotification);
    if (state.gateTimer === null) this.sessions.delete(sessionId);
    else state.endAfterDrain = true;
```

新增三个私有方法：

```ts
  /** 通知出口：门关着直通（零开销，M2 行为）；门开着按序排队。 */
  private send(sessionId: string, n: Notification): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.gateTimer === null) {
      this.notify(n);
      return;
    }
    state.gatePending.push({ kind: 'notify', n });
  }

  private addDelay(sessionId: string, ms: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.gateTimer === null) {
      state.gateTimer = setTimeout(() => this.releaseGate(sessionId, state), ms);
    } else {
      state.gatePending.push({ kind: 'delay', ms });
    }
  }

  /** 门到点：按序放行 pending，途中遇到 delay 重新armed；排空后视情自毁。 */
  private releaseGate(sessionId: string, state: SessionState): void {
    state.gateTimer = null;
    while (state.gatePending.length > 0) {
      const entry = state.gatePending.shift()!;
      if (entry.kind === 'delay') {
        if (entry.ms > 0) {
          state.gateTimer = setTimeout(() => this.releaseGate(sessionId, state), entry.ms);
          return;
        }
        continue;
      }
      this.notify(entry.n);
    }
    if (state.endAfterDrain) this.sessions.delete(sessionId);
  }
```

**(3) cancel 的死锁规避 + teardown 清门：**

```ts
  cancel(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    const hadPendingDone =
      state?.gatePending.some((e) => e.kind === 'notify' && e.n.channel === 'chat.done') ?? false;
    this.teardown(sessionId);
    if (hadPendingDone) {
      // 流已在 provider 侧结束、done 被 <wait/> 压在门后：不会再有任何事件来，
      // 当场合成 done(cancel) 封口（否则 session 永远 streaming）。
      // 不设 cancelling——没有后续事件需要拦，标记也无人来清。
      this.notify({
        channel: 'chat.done',
        sessionId,
        params: { sessionId, finishReason: 'cancel' },
      });
      return;
    }
    this.cancelling.add(sessionId);
  }

  private teardown(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.clearStaleTimer(state);
    if (state.gateTimer) {
      clearTimeout(state.gateTimer);
      state.gateTimer = null;
    }
    state.gatePending = [];
    this.sessions.delete(sessionId);
  }
```

（`dispose()` 沿用 Task 6 的「逐 session teardown」，gate 定时器随之清理，无需改。）

**(4) `chat-service.ts` dispose 链首接入** —— `dispose()` 改为：

```ts
  async dispose(): Promise<void> {
    this.core.dispose(); // 先停：不再向 queue 产出
    this.queue.dispose();
    this.store.dispose();
    await this.host.dispose();
  }
```

- [ ] **Step 4: 跑绿 + desktop 全量回归**

```bash
pnpm exec vitest run test/conversation-core.test.ts
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop typecheck
```

Expected: conversation-core 29 tests PASS；desktop 全部测试文件 PASS（chat-service / provider-host / session-store / notification-queue / plugin-gateway / chat-view 等不受影响——MOCK_SCRIPT 无 wait 标签，gate 对 ChatService 透明）。

- [ ] **Step 5: 提交**

```bash
git add electron/main/conversation-core.ts electron/main/chat-service.ts test/conversation-core.test.ts
git commit -m "feat(desktop): <wait/> 发射门 - 文本流停顿、保序、取消安全（含 pending-done 死锁规避）"
```

---

### Task 8: 全仓回归 + e2e + RESULTS-M3 + 状态行 + 合并打标

**Files:**
- Create: `apps/desktop/RESULTS-M3.md`
- Modify: `CLAUDE.md`（项目概览状态行）

- [ ] **Step 1: 全仓回归**

```bash
cd /d/desk/Desktop/openpet
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: 全绿（protocol 的 test 现在带覆盖率门槛，绿 = 覆盖率达标）。

- [ ] **Step 2: e2e 冒烟回归**（M1/M2 链路确认不破）

```bash
pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs
```

Expected: 退出码 0（mock 脚本只含注册标签 + 段首 intent，M3 解析行为全兼容）。

- [ ] **Step 3: 写 RESULTS-M3.md**

新建 `apps/desktop/RESULTS-M3.md`（执行时把「待填」替换为实测数字）：

```markdown
# M3 验收结果 — 行为协议生产化

执行日期：YYYY-MM-DD　分支：feat/m3-behavior

## impl-plan M3 验收判据 → 证据

| # | 判据 | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | §4.1 全部标签（intent/emo/act/wait；say stub） | `behavior-parser.test.ts`（say 解析 + 消费端 stub 用例）+ `conversation-core.test.ts`（wait 发射门 10 例） | 待填 |
| 2 | fail-safe：300ms 超时 flush | `conversation-core.test.ts`（stale flush 7 例：到点放行/续流重武装/done·cancel·dispose 清理） | 待填 |
| 3 | 非法标签原样输出 + warn | `behavior-parser.test.ts`（malformed/unregistered/misplaced/overflow/clamped 五类 reason 全覆盖；文本无损不变量） | 待填 |
| 4 | Persona few-shot 模板 | `persona-prompt-template.ts` + 自洽测试（few-shot 喂回 parser 零告警） | 待填 |
| 5 | 覆盖率 ≥90% | `vitest run --coverage` thresholds 90 进 test script（CI 即门槛）；实测 lines XX% / branches XX% / functions XX% / statements XX% | 待填 |
| 6 | 100+ 边界 case 全过（半截/嵌套/流截断/误用） | 显式 it 共 XX 个；另切分不变性 20 样例 × 全部二分切点 + 逐字符 + 三等分 ≈ XXXX 个程序化 case | 待填 |

## 关键设计落点

- 前缀四态分类：普通文本（`a<b`、`[链接]`、`arr[0]`)零延迟放行、零告警；未注册类标签整段放行 + warn。
- 未闭合标签双兜底：128 字符溢出（内存）+ 300ms stale flush（时间）。
- intent 仅段首（前导空白允许），中途降级文本 + warn。
- `<wait/>` per-session 发射门：保序（done 不越过文本）、取消安全（pending-done 场景当场合成 done(cancel)，无 streaming 死锁）。
- 数值 clamp：w≤1、dur≤60s、wait≤10s（`BEHAVIOR_LIMITS` 单一真源，模板同步引用）。

## 已知限制（记录，不阻塞 M3）

- wait 门内的延迟文本在 Main 崩溃时随当轮 partial 一起丢——M6 SQLite 每条 commit 后缓解。
- say 解析后丢弃（V1+ 语音）；模板刻意不教 say。
- 渲染端打字机节奏（B2 流式气泡的视觉停顿微调）属 M8 体验范畴；M3 的停顿是真实的通知延迟。
- fetch 网关流式分块（spike-summary 旧编号「M3」）按 impl-plan 归 M5。
```

- [ ] **Step 4: 更新 CLAUDE.md 状态行**

`CLAUDE.md` 项目概览段，把：

> M1（架构骨架 + spike 迁移）、M2（IPC 四命名空间 + 取消 + 背压 + chat.snapshot 恢复）已完成，下一个里程碑是 M3（行为协议生产化）。

改为：

> M1（架构骨架 + spike 迁移）、M2（IPC 四命名空间 + 取消 + 背压 + chat.snapshot 恢复）、M3（行为协议生产化：全标签集 + fail-safe + wait 节流 + 覆盖率门槛）已完成，下一个里程碑是 M4（渲染层 CharacterRuntime）。

- [ ] **Step 5: 提交 + 合并 + 打标**

```bash
git add apps/desktop/RESULTS-M3.md CLAUDE.md
git commit -m "docs: M3 验收结果 + 项目状态行更新"
git checkout main
git merge --no-ff feat/m3-behavior -m "Merge feat/m3-behavior: M3 行为协议生产化 - 全标签集 + fail-safe + wait 节流 + 覆盖率门槛"
git tag mvp/M3-done
```

（推送与 PR 视网络情况：直连 GitHub 不通时留本地，恢复后 `git push origin main --tags`。）

---

## 验收映射总表

| impl-plan M3 要求 | 实现任务 | 测试证据 |
| --- | --- | --- |
| 完整支持 §4.1 全部标签 | Task 1（say/clamp）+ Task 2（分类/段首）+ Task 7（wait 运行时） | behavior-parser.test（say 3 例、clamp 8 例、intent 5 例）+ conversation-core.test（wait 10 例） |
| say 留 stub | Task 1 解析 + Task 6 消费端丢弃 + Task 4 模板不教 | say stub 用例 + 模板 `not.toContain('<say:')` |
| 300ms 超时 flush | Task 6（STALE_FLUSH_MS + hasPendingInput 武装） | stale flush 7 例（fake timers） |
| 非法标签原样输出 + warn | Task 2（malformed/unregistered/misplaced/overflow）+ Task 1（value-clamped） | 五类 reason 各有显式断言；性质测试断言 warn 序列切分不变 |
| Persona few-shot 模板 | Task 4 | 模板词表/上限/few-shot 自洽 8 例 |
| 覆盖率 ≥90% | Task 5（thresholds 进 test script，CI 即门槛） | `pnpm --filter @desksoul/protocol test` 绿 = 达标 |
| 100+ 边界 case（半截/嵌套/流截断/误用） | Task 3 性质测试（20 样例 × 全切点）+ 各任务显式用例 | 显式 it ≈125+；程序化切分 case 数千（RESULTS 报告实数） |
| `<wait/>` 文本流停顿（conversation-core.ts:113 注释欠账） | Task 7 发射门 | 延迟/串联/保序/取消死锁规避/跨 session/dispose 10 例 |

执行节奏提醒：protocol 源码改动后（Task 1-5）若要手动单跑 desktop 测试，先 `pnpm --filter @desksoul/protocol build`（desktop resolve 的是 dist）；`pnpm test`（turbo）自带 `^build` 依赖无此问题。提交一律 Conventional Commits。
