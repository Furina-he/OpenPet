# M8a P2 B1 玻璃聊天浮层 Implementation Plan（overlay 重构 + Bubble/EmotionChip 骨架 + harness）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 把 overlay 从 M2 朴素 UI 重构为 B1 玻璃浮层（顶栏 + 头像气泡列表 + 输入行），气泡用新 `Bubble.vue`（P2 基础形态），并接 `?fixture=` 视觉 harness——对照 `UI/60ea4a18`(B1 区)。特殊态/双轨/J3 留 P3。

**Architecture:** 复用 `chat-view` 会话模型（不动）；App.vue 仅换"视图层"。玻璃用 tokens.css `.ds-glass` + Tailwind 工具类（与 settings 一致）。气泡按 `bubble-view.groupMessages` 分组渲染（共享头像）。

**Tech Stack:** Vue 3 `<script setup>`、Tailwind + 设计 token、TS strict。

**关联 spec:** [`../spec.md`](../spec.md)（§2.2/§2.5 + §7 **P2**）。**前置：P1 已落**（bubble-view/error-copy/chat-view errorKind）。

**测试运行：** typecheck `pnpm --filter @desksoul/desktop typecheck`；dev 视觉 `pnpm --filter @desksoul/desktop dev` 开 `…/overlay/index.html?fixture=chat`。组件薄→无单测（P1 已覆盖纯逻辑）。每 task 末提交。

---

## 文件结构
- 新 `apps/desktop/src/renderer/overlay/components/EmotionChip.vue`
- 新 `apps/desktop/src/renderer/overlay/components/Bubble.vue`（P2 基础：文本 + caret + finishReason chip；状态留 P3）
- 改 `apps/desktop/src/renderer/overlay/App.vue`（重构 B1 玻璃壳 + harness）

---

## Task 1: EmotionChip + Bubble 骨架

**Files:** Create `apps/desktop/src/renderer/overlay/components/EmotionChip.vue`、`apps/desktop/src/renderer/overlay/components/Bubble.vue`

- [ ] **Step 1: EmotionChip.vue**

```vue
<!-- apps/desktop/src/renderer/overlay/components/EmotionChip.vue — B2 双轨：情绪小 chip（暖色） -->
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-sm text-white"
    style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
  >
    {{ label }}
  </span>
</template>
```

- [ ] **Step 2: Bubble.vue（P2 基础形态）**

```vue
<!-- apps/desktop/src/renderer/overlay/components/Bubble.vue — B2 单条气泡（P2 基础；思考/折叠/错误态 P3 加）
     视觉 UI/60ea4a18（B2 区）。 -->
<script setup lang="ts">
import type { ChatMessage } from '../chat-view';

defineProps<{ message: ChatMessage; streaming: boolean }>();
</script>
<template>
  <div
    class="max-w-[86%] whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-base leading-relaxed"
    :class="
      message.role === 'user'
        ? 'self-end text-white'
        : 'self-start ds-glass text-text-main'
    "
    :style="
      message.role === 'user'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : ''
    "
  >
    <span>{{ message.text }}</span>
    <span
      v-if="message.role === 'assistant' && message.finishReason === null && streaming"
      class="ml-0.5 inline-block h-[1.1em] w-[7px] translate-y-[2px] animate-pulse"
      style="background: var(--ds-brand-to)"
    />
    <span
      v-if="message.finishReason === 'cancel'"
      class="ml-2 rounded-full bg-glass-border px-2 py-0.5 text-sm text-text-sub"
    >
      已取消
    </span>
    <span
      v-else-if="message.finishReason === 'error'"
      class="ml-2 rounded-full px-2 py-0.5 text-sm text-white"
      style="background: var(--ds-danger)"
    >
      出错了
    </span>
  </div>
</template>
```

- [ ] **Step 3: typecheck + 提交**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: 干净（Bubble import ChatMessage 类型，prop 形状正确）。

```bash
pnpm exec prettier --write apps/desktop/src/renderer/overlay/components/
git add apps/desktop/src/renderer/overlay/components/
git commit -m "feat(overlay): Bubble + EmotionChip components (B2 base shape)"
```

---

## Task 2: 重构 App.vue 为 B1 玻璃壳 + harness

**Files:** Modify `apps/desktop/src/renderer/overlay/App.vue`（整体替换）

- [ ] **Step 1: 整体替换 App.vue**

```vue
<!-- apps/desktop/src/renderer/overlay/App.vue — B1 聊天浮层（ui-design §6.1；视觉 UI/60ea4a18 B1 区）
     复用 chat-view 会话模型；玻璃 + 顶栏（角色名/模型/连接态/⚙）+ 头像气泡列表 + 输入行。
     ?fixture=chat：注入假快照做视觉 harness（不连 Main）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ChatView } from './chat-view';
import type { ChatMessage } from './chat-view';
import { groupMessages } from './bubble-view';
import Bubble from './components/Bubble.vue';

const SESSION_ID = 'default';
const messages = ref<ChatMessage[]>([]);
const streaming = ref(false);
const ready = ref(false);
const draft = ref('');
const charName = ref('小灵');
const modelLabel = ref('未连接');
const connected = ref(false);
const unsubs: Array<() => void> = [];

const view = new ChatView(SESSION_ID, () => {
  messages.value = view.messages.map((m) => ({ ...m }));
  streaming.value = view.streaming;
});

const isFixture = new URLSearchParams(window.location.search).get('fixture') === 'chat';

onMounted(async () => {
  if (isFixture) {
    view.applySnapshot({
      sessionId: SESSION_ID,
      seq: 3,
      streaming: false,
      messages: [
        { role: 'user', text: '你好呀', finishReason: null },
        { role: 'assistant', text: '嗨~ 我是小灵，很高兴见到你！', finishReason: 'stop' },
        { role: 'user', text: '给我讲个笑话', finishReason: null },
        { role: 'assistant', text: '为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25 ：)', finishReason: 'stop' },
      ],
    });
    charName.value = '小灵';
    modelLabel.value = 'gpt-4o';
    connected.value = true;
    ready.value = true;
    return;
  }
  unsubs.push(
    window.desksoul.on('chat.stream', (p) => view.onStream(p as never)),
    window.desksoul.on('chat.done', (p) => view.onDone(p as never)),
  );
  try {
    const [snap, char, prefs] = await Promise.all([
      window.desksoul.rpc('chat.snapshot', { sessionId: SESSION_ID }),
      window.desksoul.rpc('character.current', {}).catch(() => null),
      window.desksoul.rpc('app.prefs.getAll', {}).catch(() => null),
    ]);
    view.applySnapshot(snap as never);
    if (char && (char as { manifest?: { name?: string } }).manifest?.name) {
      charName.value = (char as { manifest: { name: string } }).manifest.name;
    }
    const model = (prefs as Record<string, unknown> | null)?.['model.activeModel'];
    if (typeof model === 'string' && model) {
      modelLabel.value = model;
      connected.value = true;
    }
    ready.value = true;
  } catch {
    ready.value = true; // 失败也放行输入（错误态在发送时反馈）
  }
});

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (streaming.value || !ready.value || !draft.value.trim()) return;
  const text = draft.value;
  view.echoUser(text);
  draft.value = '';
  try {
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text });
  } catch {
    view.rollbackEcho();
  }
}
function cancel(): void {
  if (!streaming.value) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
}
function openHub(): void {
  void window.desksoul.rpc('app.window.openHub', {});
}
function avatar(role: ChatMessage['role']): string {
  return role === 'assistant' ? '🐧' : '🙂';
}
</script>

<template>
  <div class="ds-glass flex h-screen flex-col text-base text-text-main">
    <!-- 顶栏：角色名 + 模型 + 连接态 + 设置 -->
    <header class="flex items-center justify-between border-b border-glass-border px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-md">{{ charName }}</span>
        <span class="text-sm text-text-sub">{{ modelLabel }}</span>
        <span
          class="h-2 w-2 rounded-full"
          :style="`background: ${connected ? 'var(--ds-success)' : 'var(--ds-danger)'}`"
          :title="connected ? '已连接' : '模型未连接'"
        />
      </div>
      <button class="rounded-btn px-2 py-1 text-text-sub hover:text-text-main" title="设置" @click="openHub">
        ⚙
      </button>
    </header>

    <!-- 消息列表：按 role 分组，组内共享头像 -->
    <main class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div
        v-for="(g, gi) in groupMessages(messages)"
        :key="gi"
        class="flex items-start gap-2"
        :class="g.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div
          class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg"
          style="background: var(--ds-glass-border)"
        >
          {{ avatar(g.role) }}
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1" :class="g.role === 'user' ? 'items-end' : 'items-start'">
          <Bubble v-for="(m, mi) in g.messages" :key="mi" :message="m" :streaming="streaming" />
        </div>
      </div>
    </main>

    <!-- 输入行 -->
    <footer class="flex items-center gap-2 border-t border-glass-border p-3">
      <input
        v-model="draft"
        class="flex-1 rounded-input border border-glass-border bg-transparent px-3 py-2 text-base outline-none"
        placeholder="和小灵说点什么…"
        :disabled="!ready"
        @keydown.enter="send"
      />
      <button
        v-if="!streaming"
        class="rounded-btn px-4 py-2 text-base text-white disabled:opacity-50"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        :disabled="!ready || !draft.trim()"
        @click="send"
      >
        发送
      </button>
      <button
        v-else
        class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-sub"
        @click="cancel"
      >
        取消
      </button>
    </footer>
  </div>
</template>
```

- [ ] **Step 2: typecheck + 全量回归**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/overlay/App.vue
```
Expected: typecheck 干净；desktop 全量绿（P1 用例 + 既有 chat-view 不回归；App.vue 无单测）。

- [ ] **Step 3: dev 视觉自检（对照 60ea4a18 B1 区）**

Run: `pnpm --filter @desksoul/desktop dev`，开 `…/overlay/index.html?fixture=chat`，确认玻璃顶栏（角色名/模型/绿点/⚙）+ 头像气泡列表（user 右暖色、assistant 左玻璃）+ 输入行渲染；token 生效。精修留 P4。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/overlay/App.vue
git commit -m "feat(overlay): rebuild as B1 glass chat float (header/avatar list/input + fixture harness)"
```

---

## Self-Review（plan vs spec P2）
- **spec §2.5 B1 玻璃壳**：T2 顶栏（角色名/模型/连接态/⚙）+ 头像气泡列表（groupMessages）+ 输入行；玻璃 token ✓。
- **spec §2.5 Bubble/EmotionChip**：T1 骨架（Bubble 基础 + caret + finishReason chip；EmotionChip）✓。
- **spec §2.1 复用 chat-view 不动**：App.vue 仅换视图，chat-view 逻辑零改（onStream/onDone/snapshot/echo/cancel 沿用）✓。
- **harness**：`?fixture=chat` 注入假快照（spec §5 视觉 harness）✓。
- **占位符**：无；SFC 完整。
- **类型一致**：`ChatMessage`/`groupMessages`(P1) ↔ App/Bubble(T1/T2) 一致；`ChatView` API（applySnapshot/echoUser/rollbackEcho/onStream/onDone）↔ App 用法（既有 M2 已验证）一致；`Bubble` props `{message,streaming}`(T1) ↔ App 传参(T2) 一致。
- **回归点**：overlay App.vue 视图整体替换（chat-view 模型不变）；overlay/main.ts 已含 mock-bridge/tokens（无需改）。情绪 chip 双轨订阅 + 错误态/思考/折叠在 P3 接（本期 Bubble 仅基础形态）。
