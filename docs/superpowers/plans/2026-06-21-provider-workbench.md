# Provider 工作台（AstrBot 对齐）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（本环境推荐 inline；subagent 派发被 429 限流）to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 DeskSoul 的单 provider/单 model 体系重构为 AstrBot 对齐的两层「Provider Source + Model entries」工作台：可多建 source（同 adapter 并存）、每 source 挂多 model（能力标签 + 逐模型测试）、6 能力 tab、按能力选默认（无降级链）、key 明文随 source 存。

**Architecture:** 四层顺序落地——A 协议/数据模型/迁移/解析（纯 TS，TDD）→ B Main 服务（provider.* RPC 重写 + 源感知 key 注入 + chat 解析接线 + 启动迁移）→ C Worker（按 adapter 选 provider fn）→ D 渲染层（工作台 UI，对齐 AstrBot 三面板）。逻辑全部下沉纯 TS 单测；SFC 薄渲染、视觉对照 PNG。

**Tech Stack:** TypeScript（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax，相对导入带 `.js`）、Zod、Vitest、Vue 3 + Tailwind。

**Spec:** `docs/superpowers/specs/2026-06-21-provider-workbench-design.md`

---

## 关键决策（用户裁定，照此实现）

1. **6 能力 tab 全做成可配**（chat 端到端；embedding/stt/tts/rerank/agent_runner 先可配，DeskSoul 暂不消费）。
2. **API Key 明文随 source 存进 prefs**（放弃 keychain）。「key 不进 worker」铁律亦放开——但本计划仍走 **Main FetchGateway 源感知注入**（改动最小、复用现有 fetch 代理），key 注入点不变只是改读 `source.key`。
3. **无自动降级链**（对齐 AstrBot：按能力一个默认 + 失败走离线兜底卡）。
4. **已知限制（记录）**：两个 source 若 `apiBase` 完全相同、仅 key 不同，URL→source 反查取首个匹配；常见多端点用法（OpenAI 官方 / 本地 vLLM / OpenRouter）apiBase 不同，不受影响。

---

## File Structure

| 文件 | 责任 | 动作 |
| --- | --- | --- |
| `packages/protocol/src/provider-config.ts` | 追加 Source/Model/Capability/Adapter/ModelCaps/AdapterTemplate schema + `ADAPTER_TEMPLATES` + helpers + `resolveChatTarget` | Modify |
| `packages/protocol/src/prefs.ts` | PrefsSchema 追加两层模型键 | Modify |
| `packages/protocol/src/provider-migrate.ts` | 旧配置→新两层 纯函数 | Create |
| `packages/protocol/src/schemas.ts` | `ChatStartFrame` 追加 `adapter?` | Modify |
| `packages/protocol/src/methods.ts` | 重写 `provider.*` 方法 schema | Modify |
| `apps/desktop/electron/main/provider-service.ts` | 重写为操作动态 sources/models + source.key | Rewrite |
| `apps/desktop/electron/main/provider-config.ts` | `resolveHost`/`injectAuth` 源感知 | Modify |
| `apps/desktop/electron/main/chat-resolve.ts` | `resolveSendTarget` 接 `resolveChatTarget` | Modify |
| `apps/desktop/electron/main/chat-service.ts` | `resolveModel` 透传 adapter；host.send 带 adapter | Modify |
| `apps/desktop/electron/main/ipc-router.ts` | 注入新 provider-service 依赖 + resolveModel 改造 | Modify |
| `apps/desktop/electron/main/index.ts` | 启动迁移接线 + provider-service deps | Modify |
| `apps/sidecar/src/workers/provider-registry.ts` | `resolveProviderByAdapter` | Modify |
| `apps/sidecar/src/workers/provider-worker-entry.ts` | frame.adapter 优先走新解析 | Modify |
| `apps/desktop/src/renderer/settings/provider-config-view.ts` | 重写为两层 view-model（纯函数） | Rewrite |
| `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue` | 工作台壳（能力 tab + 两面板） | Modify |
| `apps/desktop/src/renderer/components/provider/ProviderSourcesPanel.vue` | 左：source 列表 | Create |
| `apps/desktop/src/renderer/components/provider/ProviderModelsPanel.vue` | 右：source 配置 + models 表 | Create |
| `apps/desktop/src/renderer/components/provider/AddSourceDialog.vue` | 新建 source 弹窗 | Create |
| `apps/desktop/src/renderer/components/ProviderConfigPanel.vue` | C2 引导积木同步精简版 | Modify |
| 对应 `test/` | 单测 | Create/Modify |

> 测试：协议自测直跑 `../src`。**协议改完、跑 desktop 前必** `pnpm --filter @desksoul/protocol build`；**跑全量 desktop 前** `pnpm --filter @desksoul/sidecar build`。

---

# Section A — 协议 / 数据模型 / 迁移 / 解析

## Task A1: Source/Model/Adapter schema + 模板 + helpers

**Files:** Modify `packages/protocol/src/provider-config.ts`（文件末尾追加）；Test: `packages/protocol/test/provider-config.test.ts`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `packages/protocol/test/provider-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  ProviderSourceSchema,
  ModelEntrySchema,
  AdapterTemplateSchema,
  ADAPTER_TEMPLATES,
  generateUniqueSourceId,
  modelEntryId,
} from '../src/provider-config.js';

describe('ProviderSourceSchema', () => {
  it('defaults key="" / enabled=true on a minimal source', () => {
    const s = ProviderSourceSchema.parse({
      id: 'openai-main',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'https://api.openai.com/v1',
    });
    expect(s.key).toBe('');
    expect(s.enabled).toBe(true);
  });
  it('rejects unknown adapter / capability', () => {
    expect(ProviderSourceSchema.safeParse({ id: 'x', adapter: 'cohere', capability: 'chat', apiBase: '' }).success).toBe(false);
    expect(ProviderSourceSchema.safeParse({ id: 'x', adapter: 'openai', capability: 'image', apiBase: '' }).success).toBe(false);
  });
});

describe('ModelEntrySchema', () => {
  it('defaults caps={} / enabled=true', () => {
    const m = ModelEntrySchema.parse({ id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o' });
    expect(m.caps).toEqual({});
    expect(m.enabled).toBe(true);
  });
});

describe('helpers + templates', () => {
  it('generateUniqueSourceId appends _N on collision', () => {
    expect(generateUniqueSourceId('openai', [])).toBe('openai');
    expect(generateUniqueSourceId('openai', ['openai'])).toBe('openai_1');
    expect(generateUniqueSourceId('openai', ['openai', 'openai_1'])).toBe('openai_2');
  });
  it('modelEntryId joins source/model', () => {
    expect(modelEntryId('openai-main', 'gpt-4o')).toBe('openai-main/gpt-4o');
  });
  it('ADAPTER_TEMPLATES parse and cover the 4 chat adapters', () => {
    for (const t of ADAPTER_TEMPLATES) expect(AdapterTemplateSchema.parse(t)).toEqual(t);
    const chat = ADAPTER_TEMPLATES.filter((t) => t.capability === 'chat').map((t) => t.adapter);
    expect(chat).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini', 'ollama']));
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts` → Expected: FAIL（未导出）。

- [ ] **Step 3: 追加实现** — 在 `packages/protocol/src/provider-config.ts` 末尾追加：

```ts
/** 能力分类（对齐 AstrBot ProviderType）。 */
export const CapabilitySchema = z.enum(['chat', 'agent_runner', 'stt', 'tts', 'embedding', 'rerank']);
export type Capability = z.infer<typeof CapabilitySchema>;

/** 适配器 = 请求/响应格式；openai 兼容任意 openai-compatible 端点。 */
export const AdapterSchema = z.enum(['openai', 'anthropic', 'gemini', 'ollama']);
export type Adapter = z.infer<typeof AdapterSchema>;

/** 模型能力标签（= AstrBot modalities + reasoning）。 */
export const ModelCapsSchema = z.object({
  vision: z.boolean().optional(),
  audio: z.boolean().optional(),
  tool: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});
export type ModelCaps = z.infer<typeof ModelCapsSchema>;

/** Provider Source = 端点账号；可多建、同 adapter 可并存。key 明文随 source 存（用户裁定）。 */
export const ProviderSourceSchema = z.object({
  id: z.string().min(1),
  adapter: AdapterSchema,
  capability: CapabilitySchema,
  apiBase: z.string(),
  key: z.string().default(''),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
  proxy: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  ollamaDisableThinking: z.boolean().optional(),
});
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

/** Model 条目 = 挂在某 Source 下的具体模型；id = `${sourceId}/${model}`。 */
export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  model: z.string().min(1),
  enabled: z.boolean().default(true),
  caps: ModelCapsSchema.default({}),
  contextTokens: z.number().int().positive().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/** 新建 source 时的 adapter 默认模板（替代旧 BUILTIN_PROVIDERS 单选全集）。 */
export const AdapterTemplateSchema = z.object({
  adapter: AdapterSchema,
  capability: CapabilitySchema,
  label: z.string(),
  defaultApiBase: z.string(),
  authStyle: z.enum(['bearer', 'x-api-key', 'query-key', 'none']),
  format: AdapterSchema,
  defaultModels: z.array(z.string()),
});
export type AdapterTemplate = z.infer<typeof AdapterTemplateSchema>;

export const ADAPTER_TEMPLATES: AdapterTemplate[] = [
  { adapter: 'openai', capability: 'chat', label: 'OpenAI Compatible', defaultApiBase: 'https://api.openai.com/v1', authStyle: 'bearer', format: 'openai', defaultModels: ['gpt-4o-mini', 'gpt-4o'] },
  { adapter: 'anthropic', capability: 'chat', label: 'Anthropic Claude', defaultApiBase: 'https://api.anthropic.com/v1', authStyle: 'x-api-key', format: 'anthropic', defaultModels: ['claude-sonnet-4-6'] },
  { adapter: 'gemini', capability: 'chat', label: 'Google Gemini', defaultApiBase: 'https://generativelanguage.googleapis.com/v1beta', authStyle: 'query-key', format: 'gemini', defaultModels: ['gemini-1.5-flash'] },
  { adapter: 'ollama', capability: 'chat', label: 'Ollama (本地)', defaultApiBase: 'http://127.0.0.1:11434', authStyle: 'none', format: 'ollama', defaultModels: [] },
];

/** 生成不冲突的 source id（对齐 AstrBot generateUniqueSourceId）。 */
export function generateUniqueSourceId(baseId: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  if (!existing.has(baseId)) return baseId;
  let i = 1;
  while (existing.has(`${baseId}_${i}`)) i += 1;
  return `${baseId}_${i}`;
}

/** Model 条目 id 拼装：`${sourceId}/${model}`。 */
export function modelEntryId(sourceId: string, model: string): string {
  return `${sourceId}/${model}`;
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts` → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-config.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(protocol): ProviderSource/ModelEntry/AdapterTemplate schema + helpers"
```

## Task A2: resolveChatTarget 解析纯函数

**Files:** Modify `packages/protocol/src/provider-config.ts`；Test: 追加到 `provider-config.test.ts`

- [ ] **Step 1: 写失败测试** — 在 `provider-config.test.ts` 顶部 import 增补、文件末尾追加：

```ts
import type { ProviderSource, ModelEntry } from '../src/provider-config.js';
import { resolveChatTarget } from '../src/provider-config.js';

describe('resolveChatTarget', () => {
  const sources: ProviderSource[] = [
    { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://api.openai.com/v1', key: 'k', enabled: true },
  ];
  const models: ModelEntry[] = [
    { id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} },
  ];
  it('resolves a valid target', () => {
    expect(resolveChatTarget(sources, models, 'openai-main/gpt-4o')).toEqual({
      sourceId: 'openai-main', adapter: 'openai', apiBase: 'https://api.openai.com/v1', model: 'gpt-4o',
    });
  });
  it('returns null on empty / missing / disabled model / disabled source', () => {
    expect(resolveChatTarget(sources, models, '')).toBeNull();
    expect(resolveChatTarget(sources, models, 'x/y')).toBeNull();
    expect(resolveChatTarget(sources, [{ ...models[0]!, enabled: false }], 'openai-main/gpt-4o')).toBeNull();
    expect(resolveChatTarget([{ ...sources[0]!, enabled: false }], models, 'openai-main/gpt-4o')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts` → Expected: FAIL（`resolveChatTarget` 未导出）。
- [ ] **Step 3: 追加实现** — `provider-config.ts` 末尾追加：

```ts
export interface ChatTarget {
  sourceId: string;
  adapter: Adapter;
  apiBase: string;
  model: string;
}

/** defaultChatModelId → ModelEntry → ProviderSource；任一缺失/disabled 返回 null（走离线兜底）。纯函数，无降级链。 */
export function resolveChatTarget(
  sources: ProviderSource[],
  models: ModelEntry[],
  defaultChatModelId: string,
): ChatTarget | null {
  if (!defaultChatModelId) return null;
  const entry = models.find((m) => m.id === defaultChatModelId);
  if (!entry || !entry.enabled) return null;
  const source = sources.find((s) => s.id === entry.sourceId);
  if (!source || !source.enabled) return null;
  return { sourceId: source.id, adapter: source.adapter, apiBase: source.apiBase, model: entry.model };
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-config.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(protocol): resolveChatTarget 两层配置→chat 目标（无降级链）"
```

## Task A3: PrefsSchema 追加两层模型键

**Files:** Modify `packages/protocol/src/prefs.ts`；Test: `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 写失败测试** — `prefs.test.ts` 末尾追加：

```ts
describe('PrefsSchema provider workbench (AstrBot 对齐)', () => {
  it('defaults sources/models=[] 与 default*ModelId=""', () => {
    expect(DEFAULT_PREFS['model.providerSources']).toEqual([]);
    expect(DEFAULT_PREFS['model.models']).toEqual([]);
    expect(DEFAULT_PREFS['model.defaultChatModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultEmbeddingModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultSttModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultTtsModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultRerankModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultAgentModelId']).toBe('');
  });
  it('validates a source array via .shape', () => {
    expect(PrefsSchema.shape['model.providerSources'].safeParse([
      { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://api.openai.com/v1' },
    ]).success).toBe(true);
    expect(PrefsSchema.shape['model.providerSources'].safeParse([
      { id: 'x', adapter: 'nope', capability: 'chat', apiBase: '' },
    ]).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts` → Expected: FAIL。
- [ ] **Step 3: 实现** — `prefs.ts` 顶部 import 改为：

```ts
import {
  BUILTIN_PROVIDERS,
  normalizeProviderBaseUrl,
  ProviderSourceSchema,
  ModelEntrySchema,
} from './provider-config.js';
```

在 `'model.ollamaBaseUrl': ...` 行之后、`// budget` 之前插入：

```ts
  // model · Provider 工作台（AstrBot 对齐）—— 两层 Source+Model（旧键并存，迁移后弃用）
  'model.providerSources': z.array(ProviderSourceSchema).default([]),
  'model.models': z.array(ModelEntrySchema).default([]),
  'model.defaultChatModelId': z.string().default(''),
  'model.defaultEmbeddingModelId': z.string().default(''),
  'model.defaultSttModelId': z.string().default(''),
  'model.defaultTtsModelId': z.string().default(''),
  'model.defaultRerankModelId': z.string().default(''),
  'model.defaultAgentModelId': z.string().default(''),
```

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): prefs 追加两层 Source+Model 键"
```

## Task A4: 旧配置迁移纯函数

**Files:** Create `packages/protocol/src/provider-migrate.ts`；Modify `packages/protocol/src/index.ts`；Test: `packages/protocol/test/provider-migrate.test.ts`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `packages/protocol/test/provider-migrate.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { migrateProviderConfig } from '../src/provider-migrate.js';

const keyLookup = (id: string) => (id === 'openai' ? 'sk-test' : '');

describe('migrateProviderConfig', () => {
  it('empty when no/unknown active provider', () => {
    expect(migrateProviderConfig({ activeProvider: '', activeModel: '', rawPrefs: {} }, keyLookup))
      .toEqual({ sources: [], models: [], defaultChatModelId: '' });
    expect(migrateProviderConfig({ activeProvider: 'mystery', activeModel: 'x', rawPrefs: {} }, keyLookup))
      .toEqual({ sources: [], models: [], defaultChatModelId: '' });
  });
  it('synthesizes source+model+default from legacy openai config', () => {
    const r = migrateProviderConfig(
      { activeProvider: 'openai', activeModel: 'gpt-4o', rawPrefs: { 'model.openaiBaseUrl': 'https://relay.example.com/v1' } },
      keyLookup,
    );
    expect(r.sources[0]).toMatchObject({ id: 'openai', adapter: 'openai', capability: 'chat', apiBase: 'https://relay.example.com/v1', key: 'sk-test', enabled: true });
    expect(r.models[0]).toMatchObject({ id: 'openai/gpt-4o', sourceId: 'openai', model: 'gpt-4o' });
    expect(r.defaultChatModelId).toBe('openai/gpt-4o');
  });
  it('maps claude→anthropic adapter, falls back to dialect default model', () => {
    const r = migrateProviderConfig({ activeProvider: 'claude', activeModel: '', rawPrefs: {} }, () => 'k');
    expect(r.sources[0]?.adapter).toBe('anthropic');
    expect(r.models[0]?.model).toBe('claude-sonnet-4-6');
    expect(r.defaultChatModelId).toBe('claude/claude-sonnet-4-6');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-migrate.test.ts` → Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现 + export** — 新建 `packages/protocol/src/provider-migrate.ts`：

```ts
import {
  BUILTIN_PROVIDERS,
  getProviderBaseUrl,
  modelEntryId,
  type ProviderSource,
  type ModelEntry,
} from './provider-config.js';

export interface LegacyProviderPrefs {
  activeProvider: string;
  activeModel: string;
  rawPrefs: Record<string, unknown>;
}
export interface MigratedProviderConfig {
  sources: ProviderSource[];
  models: ModelEntry[];
  defaultChatModelId: string;
}

/** 旧单 provider 配置 → 新两层。纯函数：key 由 Main 经 keyLookup 注入。仅内置 dialect 时合成。 */
export function migrateProviderConfig(
  legacy: LegacyProviderPrefs,
  keyLookup: (providerId: string) => string,
): MigratedProviderConfig {
  const empty: MigratedProviderConfig = { sources: [], models: [], defaultChatModelId: '' };
  const pid = legacy.activeProvider;
  const dialect = BUILTIN_PROVIDERS[pid];
  if (!pid || !dialect) return empty;
  const apiBase = getProviderBaseUrl(pid, legacy.rawPrefs) ?? dialect.baseUrl;
  const source: ProviderSource = {
    id: pid,
    adapter: dialect.format, // ProviderFormat 与 Adapter 同一字符串联合
    capability: 'chat',
    apiBase,
    key: keyLookup(pid),
    enabled: true,
  };
  const model = legacy.activeModel || dialect.defaultModels[0] || '';
  if (!model) return { sources: [source], models: [], defaultChatModelId: '' };
  const entry: ModelEntry = { id: modelEntryId(pid, model), sourceId: pid, model, enabled: true, caps: {} };
  return { sources: [source], models: [entry], defaultChatModelId: entry.id };
}
```

`packages/protocol/src/index.ts` 在 `export * from './provider-config.js';` 后加：

```ts
export * from './provider-migrate.js';
```

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-migrate.ts packages/protocol/src/index.ts packages/protocol/test/provider-migrate.test.ts
git commit -m "feat(protocol): 旧单 provider 配置 → 两层模型迁移纯函数"
```

## Task A5: methods.ts 重写 provider.* + ChatStartFrame.adapter

**Files:** Modify `packages/protocol/src/methods.ts`、`packages/protocol/src/schemas.ts`；Test: `packages/protocol/test/methods.test.ts`（新建或追加，若不存在则建）

- [ ] **Step 1: 写失败测试** — 新建 `packages/protocol/test/methods.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods.js';
import { ChatStartFrame } from '../src/schemas.js';

describe('provider.* method registry (AstrBot 对齐)', () => {
  it('registers new two-layer methods, drops legacy key/list methods', () => {
    expect('provider.getConfig' in Methods).toBe(true);
    expect('provider.upsertSource' in Methods).toBe(true);
    expect('provider.testModel' in Methods).toBe(true);
    expect('provider.setDefault' in Methods).toBe(true);
    expect('provider.saveKey' in Methods).toBe(false);
    expect('provider.listProviders' in Methods).toBe(false);
  });
  it('provider.setDefault params validate capability + modelId', () => {
    expect(Methods['provider.setDefault'].params.safeParse({ capability: 'chat', modelId: 'a/b' }).success).toBe(true);
    expect(Methods['provider.setDefault'].params.safeParse({ capability: 'nope', modelId: 'a/b' }).success).toBe(false);
  });
});

describe('ChatStartFrame', () => {
  it('accepts optional adapter', () => {
    const f = ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r', sessionId: 's', adapter: 'openai' });
    expect(f.adapter).toBe('openai');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts` → Expected: FAIL。
- [ ] **Step 3: 实现** —
  (a) `schemas.ts`：顶部加 `import { AdapterSchema } from './provider-config.js';`，在 `ChatStartFrame` 的 `baseUrl` 行后加一行：

```ts
  /** provider adapter（format）；新两层路由用它在 worker 选 provider fn。 */
  adapter: AdapterSchema.optional(),
```

  (b) `methods.ts`：顶部加 import：

```ts
import {
  ProviderSourceSchema,
  ModelEntrySchema,
  ModelCapsSchema,
  AdapterTemplateSchema,
  CapabilitySchema,
} from './provider-config.js';
```

  删除旧 `provider.saveKey`/`provider.deleteKey`/`provider.listProviders`/`provider.testConnection`/`provider.listModels` 五个块，保留 `provider.ollamaDetect`，在其前插入：

```ts
  // --- request/response: Renderer → Main（Provider 工作台，AstrBot 对齐）---
  'provider.getConfig': {
    params: z.object({}),
    result: z.object({
      sources: z.array(ProviderSourceSchema),
      models: z.array(ModelEntrySchema),
      templates: z.array(AdapterTemplateSchema),
    }),
  },
  'provider.upsertSource': {
    params: z.object({ source: ProviderSourceSchema }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'provider.deleteSource': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.fetchModels': {
    params: z.object({ sourceId: z.string().min(1) }),
    result: z.object({ models: z.array(z.string()) }),
  },
  'provider.addModel': {
    params: z.object({ entry: ModelEntrySchema }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.deleteModel': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.setModelEnabled': {
    params: z.object({ id: z.string().min(1), enabled: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.updateModelCaps': {
    params: z.object({ id: z.string().min(1), caps: ModelCapsSchema }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.testModel': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      latencyMs: z.number().int().nonnegative().optional(),
      errorKind: ErrorKindSchema.optional(),
    }),
  },
  'provider.setDefault': {
    params: z.object({ capability: CapabilitySchema, modelId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
```

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 协议全量 + build** — Run: `pnpm --filter @desksoul/protocol test && pnpm --filter @desksoul/protocol typecheck && pnpm --filter @desksoul/protocol build` → Expected: 全绿、exit 0。
- [ ] **Step 6: 提交**

```bash
git add packages/protocol/src/methods.ts packages/protocol/src/schemas.ts packages/protocol/test/methods.test.ts
git commit -m "feat(protocol): provider.* 工作台方法重写 + ChatStartFrame.adapter"
```

---

# Section B — Main 服务

> 起步先 `pnpm --filter @desksoul/protocol build`（desktop 消费 dist）。

## Task B1: provider-service.ts 重写（操作动态 sources/models）

**Files:** Rewrite `apps/desktop/electron/main/provider-service.ts`；Rewrite `apps/desktop/test/provider-service.test.ts`

- [ ] **Step 1: 写失败测试** — 用新接口重写 `apps/desktop/test/provider-service.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { createProviderService, type ProviderServiceDeps } from '../electron/main/provider-service';
import { DEFAULT_PREFS, type Prefs, type ProviderSource, type ModelEntry } from '@desksoul/protocol';

function makeDeps(over?: { http?: ProviderServiceDeps['httpGetJson']; prefs?: Partial<Prefs> }): {
  deps: ProviderServiceDeps;
  state: Prefs;
} {
  const state: Prefs = { ...DEFAULT_PREFS, ...over?.prefs };
  const deps: ProviderServiceDeps = {
    httpGetJson: over?.http ?? (async () => ({ data: [{ id: 'gpt-4o' }] })),
    getPrefs: () => state,
    setPref: (k, v) => {
      (state as Record<string, unknown>)[k] = v;
    },
  };
  return { deps, state };
}

const openaiSource: ProviderSource = {
  id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://api.openai.com/v1', key: '', enabled: true,
};

describe('provider-service · sources', () => {
  it('upsertSource adds then getConfig returns it', async () => {
    const { deps, state } = makeDeps();
    const svc = createProviderService(deps);
    await svc['provider.upsertSource']({ source: openaiSource });
    expect((state['model.providerSources'] as ProviderSource[])[0]?.id).toBe('openai-main');
    const cfg = await svc['provider.getConfig']({});
    expect(cfg.sources[0]?.id).toBe('openai-main');
    expect(cfg.templates.length).toBeGreaterThan(0);
  });

  it('upsertSource rename cascades models.sourceId', async () => {
    const { deps, state } = makeDeps({
      prefs: {
        'model.providerSources': [openaiSource],
        'model.models': [{ id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} }],
      },
    });
    const svc = createProviderService(deps);
    await svc['provider.upsertSource']({ source: { ...openaiSource, id: 'openai-main', key: 'sk' }, /* same id */ });
    // rename case:
    await svc['provider.upsertSource']({ source: { ...openaiSource, id: 'oai2' } as ProviderSource, ...( { } ) });
    // 注：upsert 用 source.id 作主键；rename 由 renderer 先删后建或 service 支持 oldId——本实现按 id 覆盖/新增。
    const cfg = await svc['provider.getConfig']({});
    expect(cfg.sources.some((s) => s.id === 'oai2')).toBe(true);
  });

  it('deleteSource removes its models and clears default if pointing to them', async () => {
    const { deps, state } = makeDeps({
      prefs: {
        'model.providerSources': [openaiSource],
        'model.models': [{ id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} }],
        'model.defaultChatModelId': 'openai-main/gpt-4o',
      },
    });
    const svc = createProviderService(deps);
    await svc['provider.deleteSource']({ id: 'openai-main' });
    expect(state['model.providerSources']).toEqual([]);
    expect(state['model.models']).toEqual([]);
    expect(state['model.defaultChatModelId']).toBe('');
  });
});

describe('provider-service · models', () => {
  it('fetchModels queries upstream from source.apiBase with source.key', async () => {
    const http = vi.fn(async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
    const { deps } = makeDeps({
      http,
      prefs: { 'model.providerSources': [{ ...openaiSource, apiBase: 'https://relay.example.com/v1', key: 'sk-r' }] },
    });
    const svc = createProviderService(deps);
    await expect(svc['provider.fetchModels']({ sourceId: 'openai-main' })).resolves.toEqual({
      models: ['gpt-4o', 'gpt-4o-mini'],
    });
    expect(http).toHaveBeenCalledWith('https://relay.example.com/v1/models', { authorization: 'Bearer sk-r' });
  });

  it('addModel + setModelEnabled + updateModelCaps + deleteModel', async () => {
    const { deps, state } = makeDeps({ prefs: { 'model.providerSources': [openaiSource] } });
    const svc = createProviderService(deps);
    const entry: ModelEntry = { id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} };
    await svc['provider.addModel']({ entry });
    await svc['provider.updateModelCaps']({ id: entry.id, caps: { vision: true, tool: true } });
    await svc['provider.setModelEnabled']({ id: entry.id, enabled: false });
    let models = state['model.models'] as ModelEntry[];
    expect(models[0]).toMatchObject({ caps: { vision: true, tool: true }, enabled: false });
    await svc['provider.deleteModel']({ id: entry.id });
    expect(state['model.models']).toEqual([]);
  });

  it('setDefault writes the capability-specific pref key', async () => {
    const { deps, state } = makeDeps();
    const svc = createProviderService(deps);
    await svc['provider.setDefault']({ capability: 'chat', modelId: 'openai-main/gpt-4o' });
    expect(state['model.defaultChatModelId']).toBe('openai-main/gpt-4o');
    await svc['provider.setDefault']({ capability: 'embedding', modelId: 'oai/te-3' });
    expect(state['model.defaultEmbeddingModelId']).toBe('oai/te-3');
  });

  it('testModel classifies a 401 as auth', async () => {
    const http = vi.fn(async () => {
      throw Object.assign(new Error('401'), { status: 401 });
    });
    const { deps } = makeDeps({ http, prefs: { 'model.providerSources': [{ ...openaiSource, key: 'bad' }], 'model.models': [{ id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} }] } });
    const svc = createProviderService(deps);
    expect(await svc['provider.testModel']({ id: 'openai-main/gpt-4o' })).toMatchObject({ ok: false, errorKind: 'auth' });
  });
});
```

> 注：上面 rename 用例的中间写法仅示意 upsert 按 `source.id` 覆盖/新增；实现里 `provider.upsertSource` 不处理改名级联（renderer 改名走「保存新 id + service 端 by-id 覆盖」即可）。如需 oldId 级联，扩展 params 加 `oldId?`（YAGNI，本期不做）。删掉该用例里 same-id 那一行重复调用，仅保留 rename 一次 + getConfig 断言。

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-service.test.ts` → Expected: FAIL（新接口未实现）。

- [ ] **Step 3: 重写实现** — 整体替换 `apps/desktop/electron/main/provider-service.ts`：

```ts
/**
 * ProviderService —— provider.* RPC（AstrBot 对齐两层 Source+Model）。
 * 纯函数集合，注入 getPrefs/setPref + httpGetJson；由 ipc-router spread 进 router。
 * key 明文随 source 存（prefs）；HTTP 取模型/测试在此读 source.key 注入。
 */
import {
  ADAPTER_TEMPLATES,
  getModelsUrlForAdapter,
  modelEntryId,
  type Adapter,
  type ErrorKind,
  type ModelCaps,
  type ModelEntry,
  type PrefKey,
  type Prefs,
  type ProviderSource,
} from '@desksoul/protocol';

export type HttpGetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export interface ProviderServiceDeps {
  httpGetJson: HttpGetJson;
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
}

const DEFAULT_KEY_BY_CAP: Record<string, PrefKey> = {
  chat: 'model.defaultChatModelId',
  embedding: 'model.defaultEmbeddingModelId',
  stt: 'model.defaultSttModelId',
  tts: 'model.defaultTtsModelId',
  rerank: 'model.defaultRerankModelId',
  agent_runner: 'model.defaultAgentModelId',
};

function classify(e: unknown): ErrorKind {
  const status = (e as { status?: number }).status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status && status >= 500) return 'server';
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  return 'network';
}

function parseModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown; models?: unknown }).data;
  const models = (payload as { data?: unknown; models?: unknown }).models;
  const source = Array.isArray(data) ? data : Array.isArray(models) ? models : [];
  return source
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const r = item as { id?: unknown; name?: unknown };
        if (typeof r.id === 'string') return r.id;
        if (typeof r.name === 'string') return r.name;
      }
      return '';
    })
    .filter(Boolean);
}

/** adapter → auth header（query-key 改 url 在 fetch 路径处理；此处取模型/测试用 header/无）。 */
function authHeaders(adapter: Adapter, key: string): Record<string, string> {
  const t = ADAPTER_TEMPLATES.find((x) => x.adapter === adapter);
  if (!t || t.authStyle === 'none' || !key) return {};
  if (t.authStyle === 'bearer') return { authorization: `Bearer ${key}` };
  if (t.authStyle === 'x-api-key') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return {}; // query-key：modelsUrl 已带 ?key=
}

export function createProviderService(deps: ProviderServiceDeps) {
  const sources = (): ProviderSource[] => deps.getPrefs()['model.providerSources'];
  const models = (): ModelEntry[] => deps.getPrefs()['model.models'];
  const findSource = (id: string): ProviderSource | undefined => sources().find((s) => s.id === id);
  const sourceOfModel = (modelId: string): ProviderSource | undefined => {
    const m = models().find((x) => x.id === modelId);
    return m ? findSource(m.sourceId) : undefined;
  };

  return {
    'provider.getConfig': async (_p: Record<string, never>) => ({
      sources: sources(),
      models: models(),
      templates: ADAPTER_TEMPLATES,
    }),

    'provider.upsertSource': async (p: { source: ProviderSource }) => {
      const list = [...sources()];
      const idx = list.findIndex((s) => s.id === p.source.id);
      if (idx >= 0) list[idx] = p.source;
      else list.push(p.source);
      deps.setPref('model.providerSources', list);
      return { ok: true as const, id: p.source.id };
    },

    'provider.deleteSource': async (p: { id: string }) => {
      deps.setPref('model.providerSources', sources().filter((s) => s.id !== p.id));
      const keptModels = models().filter((m) => m.sourceId !== p.id);
      deps.setPref('model.models', keptModels);
      // 清空指向被删 model 的默认指针
      const prefs = deps.getPrefs();
      for (const key of Object.values(DEFAULT_KEY_BY_CAP)) {
        const cur = prefs[key] as string;
        if (cur && !keptModels.some((m) => m.id === cur)) deps.setPref(key, '' as never);
      }
      return { ok: true as const };
    },

    'provider.fetchModels': async (p: { sourceId: string }) => {
      const src = findSource(p.sourceId);
      if (!src) return { models: [] as string[] };
      const url = getModelsUrlForAdapter(src.adapter, src.apiBase, src.key);
      const payload = await deps.httpGetJson(url, authHeaders(src.adapter, src.key));
      const ids = parseModelIds(payload);
      const t = ADAPTER_TEMPLATES.find((x) => x.adapter === src.adapter);
      return { models: ids.length ? ids : (t?.defaultModels ?? []) };
    },

    'provider.addModel': async (p: { entry: ModelEntry }) => {
      const list = [...models()];
      if (!list.some((m) => m.id === p.entry.id)) list.push(p.entry);
      deps.setPref('model.models', list);
      return { ok: true as const };
    },

    'provider.deleteModel': async (p: { id: string }) => {
      deps.setPref('model.models', models().filter((m) => m.id !== p.id));
      return { ok: true as const };
    },

    'provider.setModelEnabled': async (p: { id: string; enabled: boolean }) => {
      deps.setPref('model.models', models().map((m) => (m.id === p.id ? { ...m, enabled: p.enabled } : m)));
      return { ok: true as const };
    },

    'provider.updateModelCaps': async (p: { id: string; caps: ModelCaps }) => {
      deps.setPref('model.models', models().map((m) => (m.id === p.id ? { ...m, caps: p.caps } : m)));
      return { ok: true as const };
    },

    'provider.testModel': async (p: { id: string }) => {
      const src = sourceOfModel(p.id);
      if (!src) return { ok: false, errorKind: 'unknown' as ErrorKind };
      const url = getModelsUrlForAdapter(src.adapter, src.apiBase, src.key);
      const t0 = Date.now();
      try {
        await deps.httpGetJson(url, authHeaders(src.adapter, src.key));
        return { ok: true, latencyMs: Math.max(0, Date.now() - t0) };
      } catch (e) {
        return { ok: false, errorKind: classify(e) };
      }
    },

    'provider.setDefault': async (p: { capability: string; modelId: string }) => {
      const key = DEFAULT_KEY_BY_CAP[p.capability];
      if (key) deps.setPref(key, p.modelId as never);
      return { ok: true as const };
    },

    'provider.ollamaDetect': async (_p: Record<string, never>) => {
      // Ollama 本地探测：用第一个 ollama source 的 apiBase，否则模板默认。
      const src = sources().find((s) => s.adapter === 'ollama');
      const base = src?.apiBase ?? ADAPTER_TEMPLATES.find((t) => t.adapter === 'ollama')!.defaultApiBase;
      try {
        const tags = (await deps.httpGetJson(`${base}/api/tags`)) as { models?: Array<{ name: string }> };
        return { available: true, models: (tags.models ?? []).map((m) => m.name) };
      } catch {
        return { available: false, models: [] as string[] };
      }
    },
  };
}
```

> 新增协议 helper `getModelsUrlForAdapter(adapter, apiBase, key)`（A1 同文件追加，给 ollama=`/api/tags`、gemini=`/models?key=`、其余=`/models`）。补到 `provider-config.ts`：
> ```ts
> export function getModelsUrlForAdapter(adapter: Adapter, apiBase: string, key: string): string {
>   const base = normalizeProviderBaseUrl(apiBase);
>   if (adapter === 'ollama') return `${base}/api/tags`;
>   if (adapter === 'gemini') return `${base}/models${key ? `?key=${encodeURIComponent(key)}` : ''}`;
>   return `${base}/models`;
> }
> ```
> 并在 A1 的 provider-config.test.ts 加一条断言（ollama→/api/tags、gemini 带 ?key=、openai→/models）。

- [ ] **Step 4: 跑测试确认通过** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-service.test.ts` → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/provider-service.ts apps/desktop/test/provider-service.test.ts packages/protocol/src/provider-config.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(desktop): provider-service 重写为两层 Source+Model（source.key 明文）"
```

## Task B2: provider-config.ts(main) 源感知 resolveHost/injectAuth

**Files:** Modify `apps/desktop/electron/main/provider-config.ts`；Test: `apps/desktop/test/provider-config.test.ts`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `apps/desktop/test/provider-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createProviderConfig } from '../electron/main/provider-config';
import { DEFAULT_PREFS, type Prefs, type ProviderSource } from '@desksoul/protocol';

const src: ProviderSource = {
  id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://relay.example.com/v1', key: 'sk-r', enabled: true,
};
const prefs = (): Prefs => ({ ...DEFAULT_PREFS, 'model.providerSources': [src] });

describe('provider-config(main) 源感知', () => {
  it('resolveHost matches a configured source apiBase → sourceId', () => {
    const svc = createProviderConfig({ getPrefs: prefs });
    expect(svc.resolveHost('https://relay.example.com/v1/chat/completions')).toEqual({ providerId: 'openai-main' });
    expect(svc.resolveHost('https://evil.example.com/x')).toBeNull();
  });
  it('injectAuth reads source.key + adapter authStyle', async () => {
    const svc = createProviderConfig({ getPrefs: prefs });
    const r = await svc.injectAuth('openai-main', 'https://relay.example.com/v1/chat/completions', {});
    expect(r.headers.authorization).toBe('Bearer sk-r');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-config.test.ts` → Expected: FAIL（仍是旧 keychain 实现）。

- [ ] **Step 3: 重写实现** — 替换 `apps/desktop/electron/main/provider-config.ts`：

```ts
/**
 * ProviderConfig（Main 侧）—— 源感知 host 白名单 + 密钥注入，供 FetchGateway。
 * resolveHost：匹配已配置 source 的 apiBase（最长前缀）→ sourceId。
 * injectAuth：按 source.adapter 的 authStyle 用 source.key 注入（明文随 source 存）。
 */
import {
  ADAPTER_TEMPLATES,
  normalizeProviderBaseUrl,
  type Prefs,
  type ProviderSource,
} from '@desksoul/protocol';

export interface ProviderConfigDeps {
  getPrefs: () => Prefs;
}

export interface ProviderConfigService {
  resolveHost(url: string): { providerId: string } | null;
  injectAuth(
    sourceId: string,
    url: string,
    headers: Record<string, string>,
  ): Promise<{ url?: string; headers: Record<string, string> }>;
}

export function createProviderConfig(deps: ProviderConfigDeps): ProviderConfigService {
  const sources = (): ProviderSource[] => deps.getPrefs()['model.providerSources'];
  return {
    resolveHost(url) {
      // 最长 apiBase 前缀匹配，减少同前缀歧义。
      let best: { providerId: string; len: number } | null = null;
      for (const s of sources()) {
        const base = normalizeProviderBaseUrl(s.apiBase);
        if (base && url.startsWith(base) && (!best || base.length > best.len)) {
          best = { providerId: s.id, len: base.length };
        }
      }
      return best ? { providerId: best.providerId } : null;
    },
    async injectAuth(sourceId, url, headers) {
      const s = sources().find((x) => x.id === sourceId);
      if (!s || !s.key) return { headers };
      const t = ADAPTER_TEMPLATES.find((x) => x.adapter === s.adapter);
      if (!t || t.authStyle === 'none') return { headers };
      if (t.authStyle === 'bearer') return { headers: { ...headers, authorization: `Bearer ${s.key}` } };
      if (t.authStyle === 'x-api-key')
        return { headers: { ...headers, 'x-api-key': s.key, 'anthropic-version': '2023-06-01' } };
      if (t.authStyle === 'query-key') {
        const sep = url.includes('?') ? '&' : '?';
        return { url: `${url}${sep}key=${encodeURIComponent(s.key)}`, headers };
      }
      return { headers };
    },
  };
}
```

> `KeychainLike` 类型曾被 `provider-service.ts`/`index.ts` import；B1 已移除 provider-service 对它的依赖。检查 `index.ts` 不再 import 旧 `provider-config` 的 `KeychainLike`（B4 处理）。

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/provider-config.ts apps/desktop/test/provider-config.test.ts
git commit -m "feat(desktop): FetchGateway 源感知 resolveHost/injectAuth（读 source.key）"
```

## Task B3: chat-resolve / chat-service 接 resolveChatTarget

**Files:** Modify `apps/desktop/electron/main/chat-resolve.ts`、`chat-service.ts`；Test: `apps/desktop/test/chat-resolve.test.ts`（若存在则追加，否则新建）

- [ ] **Step 1: 写失败测试** — `apps/desktop/test/chat-resolve.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../electron/main/chat-resolve';

describe('resolveSendTarget (两层)', () => {
  it('explicit providerId wins (single-item chain, no model)', () => {
    expect(resolveSendTarget('openai-main', [], undefined)).toEqual({ chain: ['openai-main'] });
  });
  it('uses resolved target → chain=[sourceId], model+adapter+baseUrl', () => {
    const resolved = { sourceId: 'openai-main', adapter: 'openai' as const, apiBase: 'https://api.openai.com/v1', model: 'gpt-4o' };
    expect(resolveSendTarget(undefined, ['fallback'], resolved)).toEqual({
      chain: ['openai-main'], model: 'gpt-4o', adapter: 'openai', baseUrl: 'https://api.openai.com/v1',
    });
  });
  it('falls back to static chain when nothing resolved', () => {
    expect(resolveSendTarget(undefined, ['openai-main'], null)).toEqual({ chain: ['openai-main'] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/chat-resolve.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现** — 替换 `apps/desktop/electron/main/chat-resolve.ts`：

```ts
import type { ChatTarget } from '@desksoul/protocol';

/** 决定一轮 send 的链首项 + model/adapter/baseUrl（纯函数，不碰 host）。无降级链：resolved 命中即单项。 */
export function resolveSendTarget(
  explicitProviderId: string | undefined,
  staticChain: string[],
  resolved: ChatTarget | null | undefined,
): { chain: string[]; model?: string; adapter?: string; baseUrl?: string } {
  if (explicitProviderId) return { chain: [explicitProviderId] };
  if (resolved) {
    return {
      chain: [resolved.sourceId],
      model: resolved.model,
      adapter: resolved.adapter,
      baseUrl: resolved.apiBase,
    };
  }
  return { chain: staticChain };
}
```

`chat-service.ts` 改动：
- `resolveModel` 的返回类型扩 `adapter?`（`ChatService` 选项 `resolveModel?: () => ChatTarget | null`）。
- `send()` 内：`const resolved = providerId ? undefined : this.resolveModel?.();` → `const { chain, model, adapter, baseUrl } = resolveSendTarget(providerId, this.providerChain, resolved);`
- `host.send` 首发与降级处把 `baseUrl`/`adapter` 一并带上（`adapter` 透传到 ChatStartFrame；`baseUrl` 沿用现字段）。把原来 `resolved?.baseUrl && chain[0] === baseProviderId` 的条件改为「resolved 命中即带 baseUrl+adapter」。

```ts
// send() 内（替换原 chain/model 解析与首发块）：
const resolved = providerId ? undefined : this.resolveModel?.();
const { chain, model, adapter, baseUrl } = resolveSendTarget(providerId, this.providerChain, resolved);
const request = assembleContext({ /* ...existing... */, ...(model ? { model } : {}) });
this.turns.set(sessionId, { chain, idx: 0, request, sawDelta: false, toolRound: false,
  ...(baseUrl ? { baseUrl } : {}), ...(adapter ? { adapter } : {}), pendingTools: [] });
this.host.send(sessionId, chain.length > 0
  ? { providerId: chain[0]!, request, ...(baseUrl ? { baseUrl } : {}), ...(adapter ? { adapter } : {}) }
  : { request });
```

> `TurnState` 加可选 `adapter?: string`；`host.send` 的 payload 类型加 `adapter?`（见 provider-host.ts 的 send 形参类型，B 中一并扩）。降级顺位处（`turn.idx+1` 块）同样带上 `turn.adapter`/`turn.baseUrl`。

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS（chat-service 既有测试不回归：`pnpm --filter @desksoul/desktop exec vitest run test/chat-service.test.ts`）。
- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/chat-resolve.ts apps/desktop/electron/main/chat-service.ts apps/desktop/test/chat-resolve.test.ts
git commit -m "feat(desktop): chat 解析接 resolveChatTarget，host.send 透传 adapter/baseUrl"
```

## Task B4: ipc-router / index 接线 + 启动迁移

**Files:** Modify `apps/desktop/electron/main/ipc-router.ts`、`index.ts`

- [ ] **Step 1: 写失败测试**（迁移接线纯逻辑）— `apps/desktop/test/provider-migrate-wire.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { runProviderMigrationIfNeeded } from '../electron/main/startup-provider-migrate';
import { DEFAULT_PREFS, type Prefs } from '@desksoul/protocol';

describe('runProviderMigrationIfNeeded', () => {
  it('migrates legacy config when sources empty', () => {
    const state: Prefs = { ...DEFAULT_PREFS, 'model.activeProvider': 'openai', 'model.activeModel': 'gpt-4o' };
    runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: (k, v) => { (state as Record<string, unknown>)[k] = v; },
      keyLookup: () => 'sk-x',
    });
    expect((state['model.providerSources'] as unknown[]).length).toBe(1);
    expect(state['model.defaultChatModelId']).toBe('openai/gpt-4o');
  });
  it('no-op when sources already present', () => {
    const state: Prefs = { ...DEFAULT_PREFS, 'model.providerSources': [{ id: 'x', adapter: 'openai', capability: 'chat', apiBase: 'b', key: '', enabled: true }] };
    let wrote = false;
    runProviderMigrationIfNeeded({ getPrefs: () => state, setPref: () => { wrote = true; }, keyLookup: () => '' });
    expect(wrote).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-migrate-wire.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现** — 新建 `apps/desktop/electron/main/startup-provider-migrate.ts`：

```ts
import { migrateProviderConfig, type PrefKey, type Prefs } from '@desksoul/protocol';

export interface ProviderMigrateDeps {
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  keyLookup: (providerId: string) => string;
}

/** 启动时一次性：旧单 provider 配置 → 两层。仅当新 sources 为空且有旧 activeProvider 才跑。 */
export function runProviderMigrationIfNeeded(deps: ProviderMigrateDeps): void {
  const p = deps.getPrefs();
  if (p['model.providerSources'].length > 0) return;
  const migrated = migrateProviderConfig(
    { activeProvider: p['model.activeProvider'], activeModel: p['model.activeModel'], rawPrefs: p as Record<string, unknown> },
    deps.keyLookup,
  );
  if (migrated.sources.length === 0) return;
  deps.setPref('model.providerSources', migrated.sources);
  deps.setPref('model.models', migrated.models);
  deps.setPref('model.defaultChatModelId', migrated.defaultChatModelId);
}
```

`ipc-router.ts` 改动：
- `IpcRouterDeps.providerService` 类型不变（仍是 `createProviderService` 返回值），但 `index.ts` 用新 deps 构造。
- `resolveModel`（约 L109）改为读两层 + `resolveChatTarget`：

```ts
import { resolveChatTarget } from '@desksoul/protocol';
// ...
resolveModel: () => {
  const p = prefsStore.getAll();
  return resolveChatTarget(p['model.providerSources'], p['model.models'], p['model.defaultChatModelId']);
},
```

`index.ts` 改动：
- 移除 `keychain` 给 provider 的用途（`createProviderConfig({ keychain, ... })` → `createProviderConfig({ getPrefs: () => prefsStore.getAll() })`；`createProviderService({ keychain, ... })` → `createProviderService({ httpGetJson, getPrefs: () => prefsStore.getAll(), setPref: (k, v) => prefsStore.set(k, v) })`）。
- 启动（prefsStore 建好后、registerIpcRouter 之前）调用：

```ts
import { runProviderMigrationIfNeeded } from './startup-provider-migrate.js';
// keyLookup：从旧 keychain 读出明文 key 搬进 source（一次性）
runProviderMigrationIfNeeded({
  getPrefs: () => prefsStore.getAll(),
  setPref: (k, v) => prefsStore.set(k, v),
  keyLookup: (pid) => keychainGetSync(pid), // 见下
});
```

> `keychain.get` 是 async；迁移需同步 key。两选一：(a) 把 `runProviderMigrationIfNeeded` 改 async，`keyLookup` 返回 Promise，迁移内 await（推荐）；(b) 迁移先不带 key（key 留空），用户重填。推荐 (a)：把 `keyLookup` 签名改 `=> Promise<string>`，函数改 async，测试相应改 `await`。实现时统一成 async 版本。

- [ ] **Step 4: 跑测试确认通过 + 全量 desktop** — Run: `pnpm --filter @desksoul/sidecar build && pnpm --filter @desksoul/desktop test` → Expected: 全绿（含既有 chat/provider 用例不回归）。
- [ ] **Step 5: typecheck** — Run: `pnpm --filter @desksoul/desktop typecheck` → Expected: 无错误。
- [ ] **Step 6: 提交**

```bash
git add apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts apps/desktop/electron/main/startup-provider-migrate.ts apps/desktop/test/provider-migrate-wire.test.ts
git commit -m "feat(desktop): provider 工作台接线 + 启动迁移旧配置"
```

---

# Section C — Worker

## Task C1: worker 按 adapter 选 provider fn

**Files:** Modify `apps/sidecar/src/workers/provider-registry.ts`、`provider-worker-entry.ts`；Test: `apps/sidecar/test/provider-registry.test.ts`（新建或追加）

- [ ] **Step 1: 写失败测试** — `apps/sidecar/test/provider-registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveProviderByAdapter } from '../src/workers/provider-registry.js';

describe('resolveProviderByAdapter', () => {
  it('returns a fn for each known adapter', () => {
    for (const a of ['openai', 'anthropic', 'gemini', 'ollama'] as const) {
      expect(typeof resolveProviderByAdapter(a, 'https://x/v1')).toBe('function');
    }
  });
  it('returns undefined for unknown adapter', () => {
    expect(resolveProviderByAdapter('cohere' as never, 'https://x')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/sidecar exec vitest run test/provider-registry.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现** — `provider-registry.ts` 追加：

```ts
import { ADAPTER_TEMPLATES, type Adapter, type ProviderDialect } from '@desksoul/protocol';

/** adapter（+ 显式 apiBase）→ chat 生成器。合成最小 dialect（baseUrl/defaultModels 仅 fallback）。 */
export function resolveProviderByAdapter(adapter: Adapter, baseUrl: string): ProviderChatFn | undefined {
  const tmpl = ADAPTER_TEMPLATES.find((t) => t.adapter === adapter);
  if (!tmpl) return undefined;
  const dialect: ProviderDialect = {
    id: adapter, name: adapter, kind: 'chat',
    baseUrl, host: baseUrl, authStyle: tmpl.authStyle, format: tmpl.format, defaultModels: tmpl.defaultModels,
  };
  switch (tmpl.format) {
    case 'openai': return (req, signal) => openaiCompatChat(dialect, req, signal, baseUrl);
    case 'ollama': return (req, signal) => ollamaChat(dialect, req, signal, baseUrl);
    case 'anthropic': return (req, signal) => anthropicChat(dialect, req, signal, baseUrl);
    case 'gemini': return (req, signal) => geminiChat(dialect, req, signal, baseUrl);
    default: return undefined;
  }
}
```

`provider-worker-entry.ts`：`runStream` 选流改为 adapter 优先：

```ts
const stream =
  start.adapter && start.request
    ? (resolveProviderByAdapter(start.adapter, start.baseUrl ?? '') ?? errorStream(`unknown adapter: ${start.adapter}`))(start.request, ac.signal)
    : start.providerId && start.providerId !== 'mock' && start.request
      ? resolveProviderStream(start.providerId, start.request, ac.signal, start.baseUrl)
      : mockProviderChat(ac.signal, { script: pickDemoScript(demoTurn++), ...(start.intervalMs !== undefined ? { intervalMs: start.intervalMs } : {}) });
```

> 顶部 import 加 `resolveProviderByAdapter`；把现有 `resolveProviderStream` 里合成 error 流的逻辑抽成 `errorStream(msg)` 复用（一个返回 `AsyncIterable<ChatEvent>` 的小工厂，yield 一个 `{type:'done',finishReason:'error',error:msg,errorKind:'unknown'}`）。`start.adapter` 来自 ChatStartFrame（A5 已加）。

- [ ] **Step 4: 跑测试确认通过** — Run: `pnpm --filter @desksoul/sidecar exec vitest run test/provider-registry.test.ts` 且 `pnpm --filter @desksoul/sidecar test`（不回归）→ Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add apps/sidecar/src/workers/provider-registry.ts apps/sidecar/src/workers/provider-worker-entry.ts apps/sidecar/test/provider-registry.test.ts
git commit -m "feat(sidecar): worker 按 adapter 选 provider fn（两层路由）"
```

---

# Section D — 渲染层（工作台 UI）

> 视觉真源：`UI/36b542fb-…png`（D3）+ `docs/research/astrbot-fusion-hifi-redesign.md`（D3 工作台 brief）。交互参考：AstrBot `dashboard/.../provider/ProviderSourcesPanel.vue`、`ProviderModelsPanel.vue`、`AddNewProvider.vue` + `composables/useProviderSources.ts`。复用 `Input/Select/Switch/Slider/KeyInput` + `ds-glass`/§2 token。SFC 薄渲染，逻辑在 view-model。

## Task D1: provider-config-view.ts 重写（两层 view-model，纯函数 TDD）

**Files:** Rewrite `apps/desktop/src/renderer/settings/provider-config-view.ts`；Test: `apps/desktop/test/provider-config-view.test.ts`（新建/重写）

- [ ] **Step 1: 写失败测试** — `apps/desktop/test/provider-config-view.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  sourcesForTab, modelsForSource, mergedModelEntries, capsBadges, formatContextLimit, defaultPrefKeyFor,
} from '../src/renderer/settings/provider-config-view';
import type { ProviderSource, ModelEntry } from '@desksoul/protocol';

const sources: ProviderSource[] = [
  { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'b1', key: '', enabled: true },
  { id: 'voice', adapter: 'openai', capability: 'tts', apiBase: 'b2', key: '', enabled: true },
];
const models: ModelEntry[] = [
  { id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: { vision: true, tool: true }, contextTokens: 128000 },
];

describe('provider-config-view', () => {
  it('sourcesForTab filters by capability', () => {
    expect(sourcesForTab(sources, 'chat').map((s) => s.id)).toEqual(['openai-main']);
    expect(sourcesForTab(sources, 'tts').map((s) => s.id)).toEqual(['voice']);
  });
  it('modelsForSource filters by sourceId', () => {
    expect(modelsForSource(models, 'openai-main')).toHaveLength(1);
    expect(modelsForSource(models, 'voice')).toEqual([]);
  });
  it('mergedModelEntries puts configured first, drops dup available', () => {
    const merged = mergedModelEntries(models, ['gpt-4o', 'gpt-4o-mini']);
    expect(merged.map((e) => [e.type, e.model])).toEqual([
      ['configured', 'gpt-4o'],
      ['available', 'gpt-4o-mini'],
    ]);
  });
  it('capsBadges + formatContextLimit', () => {
    expect(capsBadges({ vision: true, tool: true, reasoning: false }, 128000)).toEqual(['vision', 'tool', '128K']);
    expect(formatContextLimit(1_000_000)).toBe('1M');
  });
  it('defaultPrefKeyFor maps capability → pref key', () => {
    expect(defaultPrefKeyFor('chat')).toBe('model.defaultChatModelId');
    expect(defaultPrefKeyFor('embedding')).toBe('model.defaultEmbeddingModelId');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-config-view.test.ts` → Expected: FAIL。

- [ ] **Step 3: 重写实现** — 替换 `provider-config-view.ts`：

```ts
/** Provider 工作台的纯视图计算（无 Vue 依赖，便于单测）。AstrBot useProviderSources 对齐。 */
import type { Capability, ModelCaps, ModelEntry, PrefKey, ProviderSource } from '@desksoul/protocol';

export function sourcesForTab(sources: ProviderSource[], cap: Capability): ProviderSource[] {
  return sources.filter((s) => s.capability === cap);
}
export function modelsForSource(models: ModelEntry[], sourceId: string): ModelEntry[] {
  return models.filter((m) => m.sourceId === sourceId);
}

export type MergedEntry =
  | { type: 'configured'; model: string; entry: ModelEntry }
  | { type: 'available'; model: string };

/** 已配置在前 + 尚未配置的可用模型（对齐 AstrBot mergedModelEntries）。 */
export function mergedModelEntries(configured: ModelEntry[], available: string[]): MergedEntry[] {
  const have = new Set(configured.map((m) => m.model));
  return [
    ...configured.map((entry) => ({ type: 'configured' as const, model: entry.model, entry })),
    ...available.filter((m) => !have.has(m)).map((model) => ({ type: 'available' as const, model })),
  ];
}

export function formatContextLimit(ctx?: number): string {
  if (!ctx || typeof ctx !== 'number') return '';
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return `${ctx}`;
}

/** 能力徽标顺序：vision/audio/tool/reasoning + 上下文。 */
export function capsBadges(caps: ModelCaps, contextTokens?: number): string[] {
  const out: string[] = [];
  if (caps.vision) out.push('vision');
  if (caps.audio) out.push('audio');
  if (caps.tool) out.push('tool');
  if (caps.reasoning) out.push('reasoning');
  const ctx = formatContextLimit(contextTokens);
  if (ctx) out.push(ctx);
  return out;
}

const DEFAULT_KEYS: Record<Capability, PrefKey> = {
  chat: 'model.defaultChatModelId',
  agent_runner: 'model.defaultAgentModelId',
  stt: 'model.defaultSttModelId',
  tts: 'model.defaultTtsModelId',
  embedding: 'model.defaultEmbeddingModelId',
  rerank: 'model.defaultRerankModelId',
};
export function defaultPrefKeyFor(cap: Capability): PrefKey {
  return DEFAULT_KEYS[cap];
}

export const CAPABILITY_TABS: { value: Capability; label: string }[] = [
  { value: 'chat', label: '对话模型' },
  { value: 'agent_runner', label: 'Agent' },
  { value: 'stt', label: '语音转文字' },
  { value: 'tts', label: '文字转语音' },
  { value: 'embedding', label: '向量 Embedding' },
  { value: 'rerank', label: '重排 Rerank' },
];
```

- [ ] **Step 4: 跑测试确认通过** — Run: 同上 → Expected: PASS。
- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/settings/provider-config-view.ts apps/desktop/test/provider-config-view.test.ts
git commit -m "feat(desktop): provider 工作台 view-model（两层，纯函数）"
```

## Task D2: AddSourceDialog.vue（新建 source 弹窗）

**Files:** Create `apps/desktop/src/renderer/components/provider/AddSourceDialog.vue`

**契约**：`props: { templates: AdapterTemplate[]; existingIds: string[]; capability: Capability }`；`emits: { create: [source: ProviderSource]; close: [] }`。逻辑：列出 `templates.filter(t => t.capability===capability)`；选中模板 → 用 `generateUniqueSourceId(template.adapter, existingIds)` 生成 id，构造 `ProviderSource`（adapter/capability/apiBase=defaultApiBase/key=''/enabled=true）→ emit `create`。

- [ ] **Step 1: 写组件**（薄；视觉对照 AstrBot `AddNewProvider.vue` + glass token）— `<script setup>` 用 `generateUniqueSourceId`（from `@desksoul/protocol`）构造对象并 `emit('create', src)`。模板：标题「新增提供商源」+ 模板网格（图标 + label）+ 取消按钮。
- [ ] **Step 2: 渲染抽验** — `?page=` harness 挂载 + Playwright MCP 截图对照 brief（无独立单测；逻辑已在 D1/protocol）。
- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/components/provider/AddSourceDialog.vue
git commit -m "feat(desktop): AddSourceDialog 新建 source 弹窗"
```

## Task D3: ProviderSourcesPanel.vue + ProviderModelsPanel.vue

**Files:** Create 两文件。

**ProviderSourcesPanel 契约**：`props: { sources: ProviderSource[]; activeSourceId: string }`；`emits: { select:[id]; add:[]; remove:[id] }`。渲染 `sources`（已由父按 tab 过滤）行：adapter 图标 + id + enable 点 + 选中高亮；底部「➕ 新增」emit add。

**ProviderModelsPanel 契约**：`props: { source: ProviderSource; models: ModelEntry[]; available: string[]; defaultModelId: string; testing: Record<string,boolean|null> }`；`emits: { saveSource:[ProviderSource]; fetchModels:[]; addModel:[model:string]; deleteModel:[id]; toggleModel:[{id,enabled}]; testModel:[id]; setDefault:[id]; updateCaps:[{id,caps}] }`。用 `mergedModelEntries(models, available)` 渲染合并列表；每行能力徽标 `capsBadges(...)` + 测试按钮（显示 testing 态/耗时）+ enable 开关 + 删除 + 设默认单选。上半 basic（id/apiBase/KeyInput）+ 可折叠 advanced（timeout/proxy/headers）。

- [ ] **Step 1: 写两组件**（薄；逻辑全在 view-model + 父发 RPC；视觉对照 AstrBot 两面板 + `UI/36b542fb`）。
- [ ] **Step 2: 渲染抽验** — harness + 截图对照。
- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/components/provider/ProviderSourcesPanel.vue apps/desktop/src/renderer/components/provider/ProviderModelsPanel.vue
git commit -m "feat(desktop): Provider 工作台左右两面板（sources/models）"
```

## Task D4: ModelApiPage.vue 工作台壳 + 接线

**Files:** Modify `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`

**职责**：顶部 `CAPABILITY_TABS` 能力 tab；当前 tab 下 `sourcesForTab` 过滤 → 左 `ProviderSourcesPanel`；选中 source → 右 `ProviderModelsPanel`（`modelsForSource`）；`AddSourceDialog` 受控。所有变更经 RPC：`provider.getConfig`（mounted/每次变更后重拉）、`upsertSource`/`deleteSource`/`fetchModels`/`addModel`/`deleteModel`/`setModelEnabled`/`updateModelCaps`/`testModel`/`setDefault`。保留底部「预算告警 / 离线兜底」两卡（现有，未动）。

- [ ] **Step 1: 改 SFC** — `<script setup>` 持 `sources/models/templates/activeTab/activeSourceId/available/testing` ref；各 emit → `window.desksoul.rpc('provider.*', ...)` → 重拉 `getConfig`。模板拼三件组件 + 两卡。
- [ ] **Step 2: 渲染抽验 + 端到端** — `pnpm --filter @desksoul/desktop dev`：新增一个 OpenAI source → 填 key → 拉模型 → 加一个 model → 设默认 → 聊天发一句走该 model（真 Key 90s）。对照 `UI/36b542fb` 右半。
- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/settings/pages/ModelApiPage.vue
git commit -m "feat(desktop): ModelApiPage 工作台壳（能力 tab + 两面板 + RPC 接线）"
```

## Task D5: C2 引导 ProviderConfigPanel 同步

**Files:** Modify `apps/desktop/src/renderer/components/ProviderConfigPanel.vue`

**职责**：首启 C2 用的精简版——「建 1 个 source（默认 openai 模板）→ 填 key → 拉模型 → 选 1 个 model 设为 chat 默认」。复用 D1 view-model + 同 RPC。保证 onboarding 不回归。

- [ ] **Step 1: 改 SFC** — 用 `provider.upsertSource` + `fetchModels` + `addModel` + `setDefault('chat', id)` 串起最小流程。
- [ ] **Step 2: 验证** — onboarding 既有薄渲染测试不回归（`pnpm --filter @desksoul/desktop exec vitest run test/onboarding*.test.ts` 若有）；dev 首启走一遍。
- [ ] **Step 3: 全量收口** — Run: `pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/sidecar build && pnpm --filter @desksoul/desktop test && pnpm --filter @desksoul/desktop typecheck && pnpm --filter @desksoul/desktop build` → Expected: 全绿、exit 0。
- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/components/ProviderConfigPanel.vue
git commit -m "feat(desktop): C2 引导 provider 积木同步两层模型"
```

---

## Self-Review（写计划后自查）

- **Spec 覆盖**：§4 数据模型→A1/A3；§6 路由→A2/B3；§7 协议→A5；§8 Main→B1/B2/B3/B4；§9 worker→C1；§10 UI→D1–D5；§11 迁移→A4/B4；§5 6 tab→D1（CAPABILITY_TABS）/D4。全覆盖。
- **类型一致**：`ProviderSource/ModelEntry/ModelCaps/Capability/Adapter/AdapterTemplate/ChatTarget` 贯穿；新协议 helper `getModelsUrlForAdapter`（A1 补、B1 用）；pref 键名 A3 定义、B1/B4/D1 引用一致；`resolveChatTarget` 返回形被 B3 `resolveSendTarget`/`resolveModel` 消费一致；`setPref<K>` 签名对齐 PrefsStore.set。
- **占位**：逻辑层（A/B/C/D1）全量代码；SFC（D2–D5）给契约+script 逻辑+视觉真源指针（DeskSoul 惯例：视觉对 PNG，不臆造 markup）——非占位。
- **风险点已标注**：①同 apiBase 多 source 的 key 反查取首个（已记已知限制）；②迁移 keyLookup 同步/异步→统一 async（B4 Step3 注）；③provider-service.test 的 rename 用例需按注释精简。
- **顺序安全**：A 纯追加不回归；B 切运行时（迁移保证旧用户不丢）；C worker 兼容旧 providerId 路径；D UI。每 task 红→绿→提交。

## 执行约定

- 本环境 **inline 逐 task**（subagent 429 限流）。改 protocol 后先 `build` 再跑 desktop；跑全量 desktop 前 `build` sidecar。
- 收尾按里程碑惯例：RESULTS + 更新 CURRENT.md + CLAUDE 状态行（[[milestone-results-convention]]）。真窗 + 真 Key 冒烟为人工硬门槛。
