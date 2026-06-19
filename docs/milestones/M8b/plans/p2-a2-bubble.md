# M8b P2 A2 桌面气泡 Implementation Plan（character 窗气泡层 + 流式 + 自动消失 + 方向自适应）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 角色头旁出现桌面气泡：订阅 `chat.stream` 逐字显示当前回复 + 表情同步，按 pref 自动消失，上方空间不足翻到下方。

**Architecture:** A2 = character 窗内 DOM 层（`#bubble`），不新建窗。纯逻辑下沉 `bubble-timer.ts`（消失时长解析 + 方向判定）。新 pref `display.bubbleDuration`。character renderer 加 `chat.stream` 订阅（仅驱动气泡文本，仍无业务）。

**关联 spec:** [`../spec.md`](../spec.md)（§1 A2）。**前置：M8b P1 已落**。分支 `feat/m8b-desktop`。

---

## 文件结构
- 改 `packages/protocol/src/prefs.ts`（+`display.bubbleDuration`）
- 新 `apps/desktop/src/renderer/character/bubble-timer.ts`（纯：durationMs + 方向）
- 新 `apps/desktop/src/renderer/character/bubble.ts`（气泡 DOM 控制器）
- 改 `apps/desktop/src/renderer/character/index.html`（+`#bubble` 样式）、`character/main.ts`（接气泡 + 订阅 chat.stream）
- 测试：`apps/desktop/test/character/bubble-timer.test.ts`、`packages/protocol/test/prefs.test.ts`(追加)

---

## Task 1: pref `display.bubbleDuration`

**Files:** Modify `packages/protocol/src/prefs.ts`；Test `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe('PrefsSchema bubbleDuration (M8b)', () => {
  it('默认 5s，枚举 3/5/8/always', () => {
    expect(DEFAULT_PREFS['display.bubbleDuration']).toBe('5');
    expect(PrefsSchema.shape['display.bubbleDuration'].safeParse('always').success).toBe(true);
    expect(PrefsSchema.shape['display.bubbleDuration'].safeParse('10').success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts` → FAIL。

- [ ] **Step 3: 实现**（`display.*` 段加）

```ts
  'display.bubbleDuration': z.enum(['3', '5', '8', 'always']).default('5'),
```

- [ ] **Step 4: 通过 + 重建** — `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts` PASS；`pnpm --filter @desksoul/protocol build`。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): display.bubbleDuration pref (A2)"
```

---

## Task 2: 气泡计时/方向（纯逻辑）

**Files:** Create `apps/desktop/src/renderer/character/bubble-timer.ts`；Test `apps/desktop/test/character/bubble-timer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/character/bubble-timer.test.ts
import { describe, it, expect } from 'vitest';
import { durationMs, bubbleSide } from '../../src/renderer/character/bubble-timer';

describe('bubble-timer（A2 消失时长 + 方向）', () => {
  it('durationMs：3/5/8 转毫秒，always → null（常驻）', () => {
    expect(durationMs('3')).toBe(3000);
    expect(durationMs('5')).toBe(5000);
    expect(durationMs('8')).toBe(8000);
    expect(durationMs('always')).toBeNull();
  });
  it('bubbleSide：头顶空间够→above，不够→below', () => {
    expect(bubbleSide({ charTopY: 200, bubbleH: 80 })).toBe('above'); // 200>80
    expect(bubbleSide({ charTopY: 40, bubbleH: 80 })).toBe('below'); // 40<80
  });
});
```

- [ ] **Step 2: 失败** — FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/character/bubble-timer.ts
/** A2 气泡：消失时长解析 + 方向自适应（纯函数）。 */
import type { Prefs } from '@desksoul/protocol';

export function durationMs(pref: Prefs['display.bubbleDuration']): number | null {
  return pref === 'always' ? null : Number(pref) * 1000;
}

/** 角色顶距屏顶 < 气泡高 → 上方放不下，翻到下方。 */
export function bubbleSide(p: { charTopY: number; bubbleH: number }): 'above' | 'below' {
  return p.charTopY >= p.bubbleH ? 'above' : 'below';
}
```

- [ ] **Step 4: 通过** — PASS (2)。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/bubble-timer.ts apps/desktop/test/character/bubble-timer.test.ts
git commit -m "feat(character): A2 bubble timer + side helpers (pure)"
```

---

## Task 3: 气泡 DOM 控制器 + 接线

**Files:** Create `apps/desktop/src/renderer/character/bubble.ts`；Modify `character/index.html`、`character/main.ts`

- [ ] **Step 1: index.html 加气泡层**（`<body>` 内 `#fallback` 后加）

```html
    <div id="bubble" class="bubble-hidden"></div>
```
`<style>` 内加：
```css
      #bubble {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        max-width: 280px;
        min-height: 40px;
        padding: 12px 16px;
        border-radius: 18px;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        color: #171821;
        background: rgba(255, 255, 255, 0.82);
        border-left: 3px solid #ff8fab;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        word-break: break-word;
        transition: opacity 0.25s ease;
      }
      #bubble.bubble-hidden { opacity: 0; pointer-events: none; }
      #bubble.bubble-above { top: 12px; }
      #bubble.bubble-below { bottom: 12px; }
```

- [ ] **Step 2: bubble.ts 控制器**

```ts
// apps/desktop/src/renderer/character/bubble.ts
/** A2 桌面气泡 DOM 控制器：流式追加文本、自动消失、方向。无业务（只反映 chat 文本）。 */
import { durationMs, bubbleSide } from './bubble-timer';
import type { Prefs } from '@desksoul/protocol';

export interface Bubble {
  appendStream(text: string): void;
  endStream(): void;
  setDuration(pref: Prefs['display.bubbleDuration']): void;
}

export function mountBubble(el: HTMLElement): Bubble {
  let pref: Prefs['display.bubbleDuration'] = '5';
  let hideTimer: number | null = null;
  let streaming = false;

  function place(): void {
    const side = bubbleSide({ charTopY: el.getBoundingClientRect().top, bubbleH: el.offsetHeight || 80 });
    el.classList.remove('bubble-above', 'bubble-below');
    el.classList.add(side === 'above' ? 'bubble-above' : 'bubble-below');
  }
  function show(): void {
    el.classList.remove('bubble-hidden');
    place();
  }
  function scheduleHide(): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    const ms = durationMs(pref);
    if (ms === null) return; // 常驻
    hideTimer = window.setTimeout(() => el.classList.add('bubble-hidden'), ms);
  }
  return {
    appendStream(text) {
      if (!streaming) {
        el.textContent = '';
        streaming = true;
        show();
      }
      el.textContent = (el.textContent ?? '') + text;
      if (hideTimer !== null) clearTimeout(hideTimer); // 流式中不消失
    },
    endStream() {
      streaming = false;
      scheduleHide();
    },
    setDuration(p) {
      pref = p;
    },
  };
}
```

- [ ] **Step 3: main.ts 接气泡 + 订阅 chat.stream**

`boot()` 内（订阅区附近）加：
```ts
  const bubble = mountBubble(document.getElementById('bubble')!);
  const prefs = await window.desksoul.rpc('app.prefs.getAll', {}).catch(() => null);
  if (prefs) bubble.setDuration((prefs as Prefs)['display.bubbleDuration']);
  window.desksoul.on('app.prefs.changed', (p) => {
    const c = p as { key?: string; value?: unknown };
    if (c.key === 'display.bubbleDuration') bubble.setDuration(c.value as Prefs['display.bubbleDuration']);
  });
  window.desksoul.on('chat.stream', (p) => {
    markActivity();
    bubble.appendStream((p as { text: string }).text);
  });
```
并把既有 `chat.done` 订阅回调里加 `bubble.endStream();`。
import 顶部加：`import { mountBubble } from './bubble';` + `import type { Prefs } from '@desksoul/protocol';`。

- [ ] **Step 4: typecheck + 全量 + 提交**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/character/bubble.ts apps/desktop/src/renderer/character/main.ts
```
Expected: typecheck 干净；全量绿（bubble-timer/prefs 用例）。

```bash
git add apps/desktop/src/renderer/character/ packages/protocol
git commit -m "feat(character): A2 desktop bubble (stream text + auto-dismiss + adaptive side)"
```

> **DND 降级**（A2 末项「DND 态头顶脉冲光点」）随 P3 A4 状态一起接（DND 时不展开气泡，只脉冲）。

---

## Self-Review（plan vs spec A2）
- **A2 流式 + 表情同步**：T3 订阅 chat.stream 逐字；表情已由既有 behavior.applyEmotion 驱动（character 同窗）✓。
- **自动消失（3/5/8/常驻）**：T1 pref + T2 durationMs + T3 scheduleHide ✓。
- **方向自适应**：T2 bubbleSide + T3 place ✓。
- **承载方式**：character 窗 DOM 层（index.html #bubble）✓。
- **占位符**：DND 降级明确转 P3（A4 状态依赖）；单击复制 = 视觉打磨期（P4）按需补，记 OUT-ish。
- **类型一致**：`durationMs/bubbleSide`(T2) ↔ bubble.ts(T3)；`display.bubbleDuration`(T1) ↔ 全链一致。
- **回归点**：character 新增 chat.stream 订阅仅驱动气泡 DOM，不改 runtime/behavior 既有路径；新 pref 不影响既有。
