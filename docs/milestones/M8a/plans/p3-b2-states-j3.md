# M8a P3 B2 状态 + J3 错误态 Implementation Plan（思考/折叠/错误气泡 + 情绪 chip 双轨 + 重试/换模型 + 角色歪头）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 给 B1 气泡补上 B2 特殊态（思考三点 / 长文折叠 / 错误红左条+分级台词+操作）、情绪 chip 双轨（文本流 + 表情流并行）、错误操作（重试/换模型）、以及 Main 在 error 时驱动角色"歪头"（confused）。

**Architecture:** Bubble 消费 P1 的 `isThinking/shouldFold/errorCopy`；App 订阅 `behavior.applyEmotion/setIntent` 维护当前情绪、传给流式气泡；错误操作 retry=重发上一条 user、switchModel/changeKey=`openHub`；Main `chat-service` 在 `chat.done(error)` 广播 `behavior.applyEmotion(confused)`（character 哑播放器歪头）。

**Tech Stack:** Vue 3、TS strict、Electron Main（broadcast）、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§2.2/§2.3 + §7 **P3**）。**前置：P1/P2 已落**。

**测试运行：** desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；typecheck；dev 视觉 `…/overlay/index.html?fixture=chat`（错误态 fixture 见 T1）。每 task 末提交。

---

## 文件结构
- 改 `apps/desktop/src/renderer/overlay/components/Bubble.vue`（思考/折叠/错误态+操作）
- 改 `apps/desktop/src/renderer/overlay/App.vue`（情绪 chip 双轨订阅 + Bubble 操作处理 + 错误 fixture）
- 改 `apps/desktop/electron/main/chat-service.ts`（error done → 广播 confused）
- 测试：`apps/desktop/test/chat-service.test.ts`(追加)

---

## Task 1: Bubble 补 B2 状态（思考 / 长文折叠 / 错误态 + 操作）

**Files:** Modify `apps/desktop/src/renderer/overlay/components/Bubble.vue`（整体替换 P2 版）

- [ ] **Step 1: 整体替换 Bubble.vue**

```vue
<!-- apps/desktop/src/renderer/overlay/components/Bubble.vue — B2 单条气泡（ui-design §6.2 + J3 §14.3）
     状态：思考三点 / 长文折叠 / 错误红左条+分级台词+操作；情绪 chip（双轨）经 emotion prop。 -->
<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ChatMessage } from '../chat-view';
import { isThinking, shouldFold } from '../bubble-view';
import { errorCopy, type ErrorAction } from '../error-copy';
import EmotionChip from './EmotionChip.vue';

const props = defineProps<{ message: ChatMessage; streaming: boolean; emotion?: string }>();
const emit = defineEmits<{ action: [ErrorAction] }>();

const expanded = ref(false);
const thinking = computed(() => isThinking(props.message, props.streaming));
const isError = computed(() => props.message.finishReason === 'error');
const copy = computed(() => errorCopy(props.message.errorKind));
const folded = computed(
  () => props.message.role === 'assistant' && !isError.value && shouldFold(props.message.text) && !expanded.value,
);
const ACTION_LABEL: Record<ErrorAction, string> = {
  retry: '重试',
  switchModel: '换个模型',
  changeKey: '改 Key',
};
</script>

<template>
  <!-- 错误态：玻璃 + 红左条 + 分级台词 + 操作 -->
  <div
    v-if="isError"
    class="ds-glass max-w-[86%] self-start rounded-card px-3.5 py-2.5 text-base text-text-main"
    style="border-left: 3px solid var(--ds-danger)"
  >
    <div>{{ copy.line }}</div>
    <div class="mt-2 flex gap-2">
      <button
        v-for="a in copy.actions"
        :key="a"
        class="rounded-btn border border-glass-border px-3 py-1 text-sm text-text-sub hover:text-text-main"
        @click="emit('action', a)"
      >
        {{ ACTION_LABEL[a] }}
      </button>
    </div>
  </div>

  <!-- 思考态：三点呼吸 -->
  <div
    v-else-if="thinking"
    class="ds-glass max-w-[86%] self-start rounded-card px-3.5 py-3 text-text-sub"
  >
    <span class="inline-flex gap-1">
      <span class="h-1.5 w-1.5 animate-pulse rounded-full" style="background: var(--ds-text-sub)" />
      <span class="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" style="background: var(--ds-text-sub)" />
      <span class="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" style="background: var(--ds-text-sub)" />
    </span>
  </div>

  <!-- 常态气泡 -->
  <div
    v-else
    class="max-w-[86%] whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-base leading-relaxed"
    :class="message.role === 'user' ? 'self-end text-white' : 'ds-glass self-start text-text-main'"
    :style="
      message.role === 'user'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : ''
    "
  >
    <EmotionChip v-if="emotion" :label="emotion" class="mb-1 mr-1" />
    <span :class="folded ? 'line-clamp-3' : ''">{{ message.text }}</span>
    <span
      v-if="message.role === 'assistant' && message.finishReason === null && streaming"
      class="ml-0.5 inline-block h-[1.1em] w-[7px] translate-y-[2px] animate-pulse"
      style="background: var(--ds-brand-to)"
    />
    <button
      v-if="message.role === 'assistant' && shouldFold(message.text)"
      class="mt-1 block text-sm text-text-sub hover:text-text-main"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '展开' }}
    </button>
    <span
      v-if="message.finishReason === 'cancel'"
      class="ml-2 rounded-full bg-glass-border px-2 py-0.5 text-sm text-text-sub"
    >
      已取消
    </span>
  </div>
</template>
```

> `line-clamp-3` 是 Tailwind 内置工具类（@tailwindcss/line-clamp 在 v3.3+ 已并入核心）。若构建报未知类，改用内联 `style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"`。

- [ ] **Step 2: typecheck + 视觉自检**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --write apps/desktop/src/renderer/overlay/components/Bubble.vue
```
Expected: typecheck 干净。视觉验证随 T2 的错误 fixture 一起做。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/overlay/components/Bubble.vue
git commit -m "feat(overlay): B2 bubble states (thinking/fold/error+actions) + emotion chip slot"
```

---

## Task 2: App.vue 情绪双轨 + 错误操作 + 错误 fixture

**Files:** Modify `apps/desktop/src/renderer/overlay/App.vue`

- [ ] **Step 1: script 加情绪 ref + 订阅 + 操作处理**

在 `const draft = ref('');` 之后加：
```ts
const emotion = ref('');
```
在 `onMounted` 非 fixture 分支的 `unsubs.push(` 里追加两条订阅（与 chat.stream/chat.done 并列）：
```ts
    window.desksoul.on('behavior.applyEmotion', (p) => {
      emotion.value = (p as { name: string }).name;
    }),
    window.desksoul.on('behavior.setIntent', (p) => {
      emotion.value = (p as { mood: string }).mood;
    }),
    window.desksoul.on('chat.done', () => {
      emotion.value = ''; // 流结束清空（错误/正常都清）
    }),
```
> 注：已有一条 `on('chat.done', ...→view.onDone)`；新增这条只清 emotion，二者独立订阅同 channel，均会触发，无冲突。

在 `function openHub()` 之后加（错误操作 + 情绪归属 + 重发）：
```ts
import type { ErrorAction } from './error-copy';

function lastUserText(): string {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]!;
    if (m.role === 'user') return m.text;
  }
  return '';
}
async function onAction(a: ErrorAction): Promise<void> {
  if (a === 'retry') {
    const text = lastUserText();
    if (!text || streaming.value) return;
    view.echoUser(text);
    try {
      await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text });
    } catch {
      view.rollbackEcho();
    }
    return;
  }
  openHub(); // switchModel / changeKey → Hub D3
}
// 情绪 chip 只挂在「最后一条、流式中的 assistant」气泡。
function emotionFor(m: ChatMessage): string {
  const last = messages.value[messages.value.length - 1];
  return streaming.value && m === last && m.role === 'assistant' ? emotion.value : '';
}
```
> `import type { ErrorAction }` 提到 `<script setup>` 顶部 import 区（与其它 import 并列），勿放函数体内。

- [ ] **Step 2: template 把 emotion + action 接到 Bubble**

把 P2 的 Bubble 行：
```vue
          <Bubble v-for="(m, mi) in g.messages" :key="mi" :message="m" :streaming="streaming" />
```
替换为：
```vue
          <Bubble
            v-for="(m, mi) in g.messages"
            :key="mi"
            :message="m"
            :streaming="streaming"
            :emotion="emotionFor(m)"
            @action="onAction"
          />
```

- [ ] **Step 3: 错误态 fixture（视觉自检用）**

把 fixture 分支的 messages 末尾追加一条错误 assistant（在 `?fixture=chat` 的 messages 数组里加）：
```ts
        { role: 'user', text: '在吗', finishReason: null },
        { role: 'assistant', text: '', finishReason: 'error', errorKind: 'auth' },
```

- [ ] **Step 4: typecheck + 全量 + 视觉**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/overlay/App.vue
```
Expected: typecheck 干净；desktop 全量绿。`pnpm --filter @desksoul/desktop dev` 开 `…/overlay/index.html?fixture=chat` 看错误气泡（红左条 +「钥匙不对」+ 改 Key 按钮）+ 长文折叠（如 fixture 含长文可加）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/overlay/App.vue
git commit -m "feat(overlay): B2 dual-track emotion chip + J3 error actions (retry/openHub)"
```

---

## Task 3: Main 在 error 时驱动角色"歪头"（confused）

**Files:** Modify `apps/desktop/electron/main/chat-service.ts`；Test `apps/desktop/test/chat-service.test.ts`

- [ ] **Step 1: 追加失败测试（用既有 killWorkerForTest 合成 error done）**

```ts
// apps/desktop/test/chat-service.test.ts — 追加一个 it（沿用文件顶部既有 PROVIDER_ENTRY/until/doneOf 等 helper）
it('error done 时广播 behavior.applyEmotion(confused)（J3 角色歪头）', async () => {
  const sent: Array<{ channel: string; params: unknown }> = [];
  svc = new ChatService({
    providerEntryPath: PROVIDER_ENTRY,
    broadcast: (channel, params) => sent.push({ channel, params }),
    store: new MemoryStore(),
  });
  svc.send('s1', '你好');
  svc.killWorkerForTest(); // 合成 finishReason:'error'
  await until(() => !!doneOf(sent, 's1'), 'error done');
  expect(doneOf(sent, 's1')!.params.finishReason).toBe('error');
  expect(
    sent.some(
      (s) => s.channel === 'behavior.applyEmotion' && (s.params as { name?: string }).name === 'confused',
    ),
  ).toBe(true);
});
```

> 若顶部未 import `MemoryStore`，用文件既有的 store 构造方式（参照同文件其它用例的 `store` 写法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/chat-service.test.ts -t "歪头"`
Expected: FAIL — 无 confused 广播。

- [ ] **Step 3: 实现（chat-service.ts）**

构造函数里存 broadcast 引用——在类字段区加：
```ts
  private readonly broadcast: (channel: string, params: unknown) => void;
```
constructor 内（`this.queue = new NotificationQueue(opts.broadcast, ...)` 附近）加：
```ts
    this.broadcast = opts.broadcast;
```
在 `onNotification` 的 `case 'chat.done':` 分支里，`finishReason==='stop'` 演进 persona 之后、`queue.push` 之前，加：
```ts
        if (n.params.finishReason === 'error') {
          // J3：错误时驱动角色"歪头"（character 哑播放器消费 applyEmotion）。
          this.broadcast('behavior.applyEmotion', { name: 'confused', weight: 1 });
        }
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run:
```bash
pnpm --filter @desksoul/desktop exec vitest run test/chat-service.test.ts
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --write apps/desktop/electron/main/chat-service.ts
```
Expected: 新用例 PASS；既有 chat-service 用例不回归（confused 广播是新增 channel，不影响既有 stream/done/cancel 断言）；typecheck 干净。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/chat-service.ts apps/desktop/test/chat-service.test.ts
git commit -m "feat(desktop): broadcast confused emotion on chat.done(error) for J3 head-tilt"
```

---

## Self-Review（plan vs spec P3）
- **spec §2.2 双轨情绪 chip**：T2 订阅 behavior.applyEmotion/setIntent + emotionFor 挂流式气泡 + T1 EmotionChip 渲染 ✓。
- **spec §2.3 J3 错误态 + 操作**：T1 错误气泡（红左条 + errorCopy 台词 + 操作按钮）+ T2 onAction（retry 重发 / switchModel·changeKey→openHub）+ T3 Main 广播 confused ✓。
- **spec §6.2 思考/折叠**：T1 thinking 三点 + shouldFold 折叠/展开 ✓。
- **占位符**：无；含 line-clamp 兜底说明。
- **类型一致**：`ErrorAction`(P1) ↔ Bubble emit / App onAction(T1/T2) 一致；`isThinking/shouldFold`(P1) ↔ Bubble(T1) 一致；`errorCopy`(P1) ↔ Bubble(T1) 一致；`behavior.applyEmotion` 参数 `{name,weight}`(protocol) ↔ Main broadcast(T3) 一致；`message.errorKind`(P1 chat-view) ↔ Bubble errorCopy(T1) / fixture(T2) 一致。
- **回归点**：chat-service 仅在 error done 加一条广播（既有断言基于 stream/done channel + finishReason，不受影响）；Bubble/App 视图增强不动 chat-view 模型。confused 走 `this.broadcast` 直发（同 behavior.lookAt 旁路，不进背压队列）——错误时一次性，可接受。
- **依赖顺序**：T1（Bubble）→ T2（App 接 Bubble 新接口）；T3 独立（Main）。
