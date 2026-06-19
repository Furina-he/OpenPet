# M8c P3 J2 热键录制器 UI Implementation Plan（KeyCap + D2 热键页 + 冲突检测 + 重注册）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** Hub「系统→热键」页：表格列出可绑定功能 + 当前键 + 录制（KeyCap 捕获组合）+ 冲突检测 + 一键全恢复；改键即持久 + Main 重注册。

**Architecture:** 把 P1 的 `hotkey-rules` 提升到 `@desksoul/protocol`（Main + renderer 共用校验/冲突，单一真源）；新 `keycap-accel.ts`（KeyboardEvent→accelerator 串，纯）；`KeyCap.vue` 录制组件 + `HotkeysPage.vue`；Main 监听 `hotkeys.*` 变更重注册。

**关联 spec:** [`../spec.md`](../spec.md)（§1 J2 录制器）。**前置：M8c P1/P2 已落**；nav-tree 已有 `system.hotkeys`。

---

## 文件结构
- 移 `hotkey-rules.ts` → `packages/protocol/src/hotkeys.ts`（P1 文件改为 re-export）
- 新 `apps/desktop/src/renderer/settings/keycap-accel.ts`（纯：event→accelerator）
- 新 `apps/desktop/src/renderer/components/KeyCap.vue`、`settings/pages/HotkeysPage.vue`
- 改 `settings/App.vue`（路由 `system.hotkeys`→HotkeysPage）、`index.ts`（hotkeys.* 变更重注册）
- 测试：`packages/protocol/test/hotkeys.test.ts`（移）、`apps/desktop/test/keycap-accel.test.ts`

---

## Task 1: hotkey-rules 提升到 protocol

**Files:** Create `packages/protocol/src/hotkeys.ts`（搬 P1 内容）；Modify `packages/protocol/src/index.ts`（导出）、`apps/desktop/electron/main/hotkey-rules.ts`（re-export）；move test

- [ ] **Step 1: 搬运 + re-export**

把 `apps/desktop/electron/main/hotkey-rules.ts` 的内容整体移到 `packages/protocol/src/hotkeys.ts`（含 `validateAccelerator`/`findConflict`/`Validation` + MODIFIERS）。`packages/protocol/src/index.ts` 加 `export * from './hotkeys.js';`。`apps/desktop/electron/main/hotkey-rules.ts` 改为：
```ts
export { validateAccelerator, findConflict, type Validation } from '@desksoul/protocol';
```
把 `apps/desktop/test/hotkey-rules.test.ts` 移到 `packages/protocol/test/hotkeys.test.ts`，import 改 `from '../src/hotkeys'`。

- [ ] **Step 2: 测试 + 重建**

Run:
```bash
pnpm --filter @desksoul/protocol exec vitest run test/hotkeys.test.ts
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop exec vitest run test/hotkey-service.test.ts
```
Expected: 全 PASS（service 经 re-export 仍取到规则）。

- [ ] **Step 3: 提交**

```bash
git add packages/protocol apps/desktop/electron/main/hotkey-rules.ts apps/desktop/test/hotkey-rules.test.ts
git commit -m "refactor(protocol): promote hotkey rules to @desksoul/protocol (shared by renderer)"
```

---

## Task 2: keycap-accel（KeyboardEvent→accelerator，纯）

**Files:** Create `apps/desktop/src/renderer/settings/keycap-accel.ts`；Test `apps/desktop/test/keycap-accel.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/keycap-accel.test.ts
import { describe, it, expect } from 'vitest';
import { toAccelerator } from '../../src/renderer/settings/keycap-accel';

describe('toAccelerator（KeyboardEvent→Electron accelerator）', () => {
  it('修饰 + 字母', () => {
    expect(toAccelerator({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'd' })).toBe('CommandOrControl+Shift+D');
  });
  it('纯修饰键返回空（未完成）', () => {
    expect(toAccelerator({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'Control' })).toBe('');
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/settings/keycap-accel.ts
/** 把 keydown 事件转 Electron accelerator 串（纯）。纯修饰键 → ''（录制未完成）。 */
export interface KeyEventLike {
  ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string;
}
const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph']);

export function toAccelerator(e: KeyEventLike): string {
  if (MOD_KEYS.has(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}
```

- [ ] **Step 4: 通过 + 提交**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/keycap-accel.test.ts
git add apps/desktop/src/renderer/settings/keycap-accel.ts apps/desktop/test/keycap-accel.test.ts
git commit -m "feat(settings): KeyboardEvent → accelerator (pure)"
```

---

## Task 3: KeyCap + HotkeysPage + 路由 + 重注册

**Files:** Create `components/KeyCap.vue`、`settings/pages/HotkeysPage.vue`；Modify `settings/App.vue`、`index.ts`

- [ ] **Step 1: KeyCap.vue（录制组件）**

```vue
<!-- apps/desktop/src/renderer/components/KeyCap.vue — J2 录制：点击进入监听，按下组合即捕获 -->
<script setup lang="ts">
import { ref } from 'vue';
import { toAccelerator } from '../settings/keycap-accel';
import { validateAccelerator } from '@desksoul/protocol';

const props = defineProps<{ value: string }>();
const emit = defineEmits<{ capture: [accelerator: string] }>();
const listening = ref(false);

function onKeydown(e: KeyboardEvent): void {
  if (!listening.value) return;
  e.preventDefault();
  const acc = toAccelerator(e);
  if (!acc) return; // 纯修饰，等普通键
  if (validateAccelerator(acc).ok) {
    listening.value = false;
    emit('capture', acc);
  }
}
</script>
<template>
  <button
    class="rounded-input border px-3 py-1.5 text-sm"
    :class="listening ? 'text-text-main' : 'border-glass-border text-text-sub'"
    :style="listening ? 'border-color: var(--ds-brand-to); animation: pulse 1s infinite' : ''"
    tabindex="0"
    @click="listening = true"
    @blur="listening = false"
    @keydown="onKeydown"
  >
    {{ listening ? '按下组合键…' : value || '未设置' }}
  </button>
</template>
```

- [ ] **Step 2: HotkeysPage.vue（功能表 + 录制 + 冲突 + 恢复）**

```vue
<!-- apps/desktop/src/renderer/settings/pages/HotkeysPage.vue — D2→热键页（ui-design §14.2 总览） -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs } from '@desksoul/protocol';
import { DEFAULT_PREFS, findConflict } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import KeyCap from '../../components/KeyCap.vue';

const emit = defineEmits<{ saved: [] }>();
const HOTKEYS: Array<{ key: keyof Prefs & `hotkeys.${string}`; label: string }> = [
  { key: 'hotkeys.chat', label: '跟小灵聊聊' },
  { key: 'hotkeys.toggleHide', label: '显示 / 隐藏角色' },
  { key: 'hotkeys.clickThrough', label: '鼠标穿透' },
  { key: 'hotkeys.dnd', label: '不打扰' },
  { key: 'hotkeys.openHub', label: '打开 Hub' },
];
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const map = computed<Record<string, string>>(() =>
  Object.fromEntries(HOTKEYS.map((h) => [h.key, prefs.value[h.key] as string])),
);

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
});
function conflictOf(key: string, acc: string): string | null {
  const id = findConflict(map.value, key, acc);
  return id ? (HOTKEYS.find((h) => h.key === id)?.label ?? id) : null;
}
async function capture(key: keyof Prefs & `hotkeys.${string}`, acc: string): Promise<void> {
  prefs.value = { ...prefs.value, [key]: acc };
  await window.desksoul.rpc('app.prefs.set', { key, value: acc });
  emit('saved');
}
async function resetAll(): Promise<void> {
  for (const h of HOTKEYS) {
    const def = DEFAULT_PREFS[h.key] as string;
    prefs.value = { ...prefs.value, [h.key]: def };
    await window.desksoul.rpc('app.prefs.set', { key: h.key, value: def });
  }
  emit('saved');
}
</script>
<template>
  <div class="max-w-[720px]">
    <SettingSection title="全局热键">
      <SettingCard v-for="h in HOTKEYS" :key="h.key" :label="h.label">
        <div class="flex items-center gap-2">
          <span v-if="conflictOf(h.key, map[h.key]!)" class="text-sm" style="color: var(--ds-warning)">
            已被「{{ conflictOf(h.key, map[h.key]!) }}」占用
          </span>
          <KeyCap :value="map[h.key]!" @capture="(acc) => capture(h.key, acc)" />
        </div>
      </SettingCard>
    </SettingSection>
    <button class="mt-3 rounded-btn border border-glass-border px-4 py-2 text-sm text-text-sub" @click="resetAll">
      恢复默认热键
    </button>
  </div>
</template>
```

- [ ] **Step 3: settings/App.vue 路由 + index.ts 重注册**

App.vue：import HotkeysPage + 加 `<HotkeysPage v-else-if="active === 'system.hotkeys'" @saved="saved" />`。
index.ts：在 prefs 变更广播处（或 prefsStore.set 后）若 key 以 `hotkeys.` 开头 → `hotkeys.apply(prefsStore.getAll())`。最小：包一层 prefsStore 或在 ipc-router 的 prefsService set 后回调。建议在 index.ts 持有 hotkeys 实例 + 订阅自身广播（character/overlay 已订阅 app.prefs.changed；Main 侧可在 prefs-service effects 或 set 钩子重注册）。

- [ ] **Step 4: typecheck + 全量 + 提交**

```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/components/KeyCap.vue apps/desktop/src/renderer/settings/pages/HotkeysPage.vue apps/desktop/src/renderer/settings/App.vue apps/desktop/electron/main/index.ts
git add -A
git commit -m "feat(settings): J2 hotkey recorder page (KeyCap + conflict + reset + re-register)"
```

---

## Self-Review（plan vs spec J2 UI）
- **录制 + 冲突 + 总览 + 一键恢复**：T1 共享规则 + T2 accel + T3 KeyCap/HotkeysPage ✓。
- **限制（单键/纯修饰/ESC）**：validateAccelerator（protocol）renderer + Main 共用 ✓。
- **重注册**：T3 Step3 index 监听 hotkeys.* 重 apply（闭合 P1 TODO）✓。
- **占位/诚实**：重注册接线给了方向（prefs set 钩子 / 广播订阅），执行者择一；多平台 Mac 转换（Ctrl→⌘）= accelerator `CommandOrControl` 已天然处理。
- **类型一致**：`validateAccelerator/findConflict`(protocol) ↔ KeyCap/HotkeysPage；`toAccelerator`(T2) ↔ KeyCap；`hotkeys.*` prefs ↔ HOTKEYS 表一致。
