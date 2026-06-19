# M8a P1 纯逻辑地基 Implementation Plan（error-copy + bubble-view + chat-view errorKind）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 为 B2/J3 铺三块纯逻辑：J3 错误分级文案表、B2 气泡视图判定（思考/折叠/合并）、chat-view 捕获 `errorKind`——全可 node 单测，P2/P3 直接消费。

**Architecture:** 逻辑下沉纯 TS（无 Vue/DOM），延续 M7a/M7b 风格。`chat.done` 通知已含 `errorKind`（协议无需改），只在 `chat-view` 落库。

**Tech Stack:** TS strict、`@desksoul/protocol`（ErrorKind）、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§2.3/§2.4 + §7 **P1**）。分支建议 `feat/m8a-chat`（自 M7b-2 HEAD 切出，执行者定）。

**测试运行：** `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；typecheck `pnpm --filter @desksoul/desktop typecheck`。每 task 末提交。

---

## 文件结构
- 新 `apps/desktop/src/renderer/overlay/error-copy.ts`（ErrorKind→台词/操作）
- 新 `apps/desktop/src/renderer/overlay/bubble-view.ts`（isThinking/shouldFold/groupMessages）
- 改 `apps/desktop/src/renderer/overlay/chat-view.ts`（ChatMessage/DoneEvent + errorKind）
- 测试：`apps/desktop/test/overlay/{error-copy,bubble-view,chat-view-error}.test.ts`(新)

---

## Task 1: J3 错误分级 `error-copy.ts`

**Files:** Create `apps/desktop/src/renderer/overlay/error-copy.ts`；Test `apps/desktop/test/overlay/error-copy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/overlay/error-copy.test.ts
import { describe, it, expect } from 'vitest';
import { errorCopy } from '../../src/renderer/overlay/error-copy';

describe('errorCopy（J3 §14.3 分级）', () => {
  it('timeout/network → 连不上 + 重试/换模型', () => {
    expect(errorCopy('timeout')).toEqual({ line: '「歪头」我没法连上大脑诶…', actions: ['retry', 'switchModel'] });
    expect(errorCopy('network')).toEqual({ line: '「歪头」我没法连上大脑诶…', actions: ['retry', 'switchModel'] });
  });
  it('auth → 钥匙不对 + 改 Key', () => {
    expect(errorCopy('auth')).toEqual({ line: '「眨眼」哎，钥匙好像不对', actions: ['changeKey'] });
  });
  it('rate_limit → 额度用完 + 换模型', () => {
    expect(errorCopy('rate_limit')).toEqual({ line: '「叹气」今天的额度用完啦', actions: ['switchModel'] });
  });
  it('server/unknown/缺省 → 卡了一下 + 重试', () => {
    const fallback = { line: '「困惑」大脑卡了一下，再说一次？', actions: ['retry'] };
    expect(errorCopy('server')).toEqual(fallback);
    expect(errorCopy('unknown')).toEqual(fallback);
    expect(errorCopy(undefined)).toEqual(fallback);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/overlay/error-copy.test.ts`
Expected: FAIL — cannot find module error-copy。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/overlay/error-copy.ts
/**
 * J3 错误分级文案（ui-design §14.3）：绝不直抛 `Error: 401`，只给角色化台词 + 操作。
 * 数据源 = chat.done 的 errorKind（已由 Main 转发）。actions 由 UI 映射：
 * retry=重发上一条 user；switchModel/changeKey=打开 Hub D3。
 */
import type { ErrorKind } from '@desksoul/protocol';

export type ErrorAction = 'retry' | 'switchModel' | 'changeKey';
export interface ErrorCopy {
  line: string;
  actions: ErrorAction[];
}

export function errorCopy(kind?: ErrorKind): ErrorCopy {
  switch (kind) {
    case 'timeout':
    case 'network':
      return { line: '「歪头」我没法连上大脑诶…', actions: ['retry', 'switchModel'] };
    case 'auth':
      return { line: '「眨眼」哎，钥匙好像不对', actions: ['changeKey'] };
    case 'rate_limit':
      return { line: '「叹气」今天的额度用完啦', actions: ['switchModel'] };
    case 'server':
    case 'unknown':
    default:
      return { line: '「困惑」大脑卡了一下，再说一次？', actions: ['retry'] };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/overlay/error-copy.test.ts`
Expected: PASS (4)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/overlay/error-copy.ts apps/desktop/test/overlay/error-copy.test.ts
git commit -m "feat(overlay): J3 error-grading copy (errorKind → line + actions)"
```

---

## Task 2: B2 气泡视图判定 `bubble-view.ts`

**Files:** Create `apps/desktop/src/renderer/overlay/bubble-view.ts`；Test `apps/desktop/test/overlay/bubble-view.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/overlay/bubble-view.test.ts
import { describe, it, expect } from 'vitest';
import { isThinking, shouldFold, groupMessages } from '../../src/renderer/overlay/bubble-view';
import type { ChatMessage } from '../../src/renderer/overlay/chat-view';

const asst = (text: string, fr: ChatMessage['finishReason'] = null): ChatMessage => ({
  role: 'assistant',
  text,
  finishReason: fr,
});
const user = (text: string): ChatMessage => ({ role: 'user', text, finishReason: null });

describe('bubble-view（B2 渲染判定）', () => {
  it('isThinking：assistant 空文本 + streaming + 未结束', () => {
    expect(isThinking(asst(''), true)).toBe(true);
    expect(isThinking(asst('嗨'), true)).toBe(false); // 已有文本
    expect(isThinking(asst(''), false)).toBe(false); // 非 streaming
    expect(isThinking(user(''), true)).toBe(false); // user 不算思考
  });
  it('shouldFold：>200 字才折叠（按字符计）', () => {
    expect(shouldFold('短')).toBe(false);
    expect(shouldFold('字'.repeat(200))).toBe(false);
    expect(shouldFold('字'.repeat(201))).toBe(true);
  });
  it('groupMessages：连续同 role 合并', () => {
    const groups = groupMessages([user('a'), asst('b'), asst('c'), user('d')]);
    expect(groups.map((g) => g.role)).toEqual(['user', 'assistant', 'user']);
    expect(groups[1]!.messages).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/overlay/bubble-view.test.ts`
Expected: FAIL — cannot find module bubble-view。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/overlay/bubble-view.ts
/** B2 气泡渲染判定（纯函数）：思考态 / 长文折叠 / 连续同发言合并（ui-design §6.1/§6.2）。 */
import type { ChatMessage } from './chat-view';

/** 思考中：assistant 占位（空文本）且正在流、未结束 → 三点呼吸光。 */
export function isThinking(msg: ChatMessage, streaming: boolean): boolean {
  return streaming && msg.role === 'assistant' && msg.text === '' && msg.finishReason === null;
}

const FOLD_THRESHOLD = 200;
/** 长文（>200 字）默认折叠前 N 行。按 Unicode 码点计数。 */
export function shouldFold(text: string): boolean {
  return [...text].length > FOLD_THRESHOLD;
}

export interface BubbleGroup {
  role: ChatMessage['role'];
  messages: ChatMessage[];
}
/** 连续同 role 的消息合并为一个渲染组（共享头像，气泡纵向堆叠）。 */
export function groupMessages(messages: ChatMessage[]): BubbleGroup[] {
  const groups: BubbleGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.messages.push(m);
    else groups.push({ role: m.role, messages: [m] });
  }
  return groups;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/overlay/bubble-view.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/overlay/bubble-view.ts apps/desktop/test/overlay/bubble-view.test.ts
git commit -m "feat(overlay): B2 bubble-view helpers (isThinking/shouldFold/groupMessages)"
```

---

## Task 3: chat-view 捕获 errorKind

**Files:** Modify `apps/desktop/src/renderer/overlay/chat-view.ts`；Test `apps/desktop/test/overlay/chat-view-error.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/overlay/chat-view-error.test.ts
import { describe, it, expect } from 'vitest';
import { ChatView } from '../../src/renderer/overlay/chat-view';

function viewReady(): ChatView {
  const v = new ChatView('default', () => {});
  v.applySnapshot({ sessionId: 'default', messages: [], streaming: false, seq: 0 });
  return v;
}

describe('ChatView 捕获 errorKind（J3）', () => {
  it('done(error, errorKind) 写到末条 assistant', () => {
    const v = viewReady();
    v.echoUser('在吗');
    v.onStream({ sessionId: 'default', text: '', seq: 1 });
    v.onDone({ sessionId: 'default', finishReason: 'error', errorKind: 'auth' });
    const last = v.messages.at(-1)!;
    expect(last.finishReason).toBe('error');
    expect(last.errorKind).toBe('auth');
  });
  it('done(stop) 不带 errorKind', () => {
    const v = viewReady();
    v.echoUser('hi');
    v.onStream({ sessionId: 'default', text: '你好', seq: 1 });
    v.onDone({ sessionId: 'default', finishReason: 'stop' });
    expect(v.messages.at(-1)!.errorKind).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/overlay/chat-view-error.test.ts`
Expected: FAIL — `errorKind` 不在 ChatMessage/DoneEvent 上（类型错误或运行时 undefined 写不进）。

- [ ] **Step 3: 实现（改 chat-view.ts）**

import 顶部加：
```ts
import type { ErrorKind } from '@desksoul/protocol';
```
`ChatMessage` 接口加字段：
```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  /** J3：仅 finishReason==='error' 时有意义（错误分级台词用）。 */
  errorKind?: ErrorKind;
}
```
`DoneEvent` 接口加字段：
```ts
export interface DoneEvent {
  sessionId: string;
  finishReason: 'stop' | 'cancel' | 'error';
  errorKind?: ErrorKind;
}
```
`applyDone` 写入 errorKind（在设 finishReason 处）：
```ts
  private applyDone(ev: DoneEvent, opts: { silent?: boolean } = {}): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === 'assistant' && last.finishReason === null) {
      last.finishReason = ev.finishReason;
      if (ev.errorKind !== undefined) last.errorKind = ev.errorKind;
    }
    this.streaming = false;
    if (!opts.silent) this.onChange();
  }
```

- [ ] **Step 4: 跑测试确认通过 + 既有不回归**

Run:
```bash
pnpm --filter @desksoul/desktop exec vitest run test/overlay/chat-view-error.test.ts
pnpm --filter @desksoul/desktop exec vitest run test/overlay
pnpm --filter @desksoul/desktop typecheck
```
Expected: 新用例 PASS；既有 chat-view 测试不回归；typecheck 干净（`exactOptionalPropertyTypes` 下用条件赋值，不显式写 undefined）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/overlay/chat-view.ts apps/desktop/test/overlay/chat-view-error.test.ts
git commit -m "feat(overlay): chat-view captures errorKind on done(error) for J3"
```

---

## Self-Review（plan vs spec P1）
- **spec §2.3 error-copy 表**：T1 全 6 个 ErrorKind + 缺省覆盖（§14.3 映射）✓。
- **spec §2.4 bubble-view**：T2 isThinking/shouldFold/groupMessages ✓。
- **spec §2.3 chat-view errorKind**：T3 ChatMessage/DoneEvent + applyDone，既有不回归 ✓。
- **占位符**：无；每步完整代码/命令/预期。
- **类型一致**：`ErrorKind`(protocol) ↔ error-copy(T1)/chat-view(T3) 一致；`ChatMessage`(T3 扩展) ↔ bubble-view import(T2) 一致；`DoneEvent.errorKind`(T3) ↔ P2/P3 的 App.vue done 处理（下一计划）将透传。
- **依赖顺序**：T2 import `ChatMessage`（T3 扩展后仍兼容，新增字段可选，T2 不依赖该字段）；T1/T2/T3 互独立，可任意序，建议 T1→T2→T3。
- **回归点**：仅扩 chat-view（新增可选字段，既有 snapshot/stream/seq/echo 逻辑不动）。
