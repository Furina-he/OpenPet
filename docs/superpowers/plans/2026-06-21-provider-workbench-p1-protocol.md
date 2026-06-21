# Provider 工作台 P1（协议+数据模型+迁移+解析）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@desksoul/protocol` 纯追加 AstrBot 对齐的两层 Provider 数据模型（Source + Model）、prefs 键、旧配置迁移函数与 chat 目标解析函数，全部 TDD 单测绿，且不改变任何现有运行时行为。

**Architecture:** 纯协议层、纯追加。新增 Zod schema / 类型 / adapter 模板 / 两个纯函数（迁移、解析）+ PrefsSchema 新键（数组默认 `[]`、默认指针默认 `''`）。旧 `model.activeProvider/activeModel/*BaseUrl` 键保持不动——P1 落地后旧路径继续驱动一切，P2 才把运行时切到新模型。解锁 P2（Main `provider.*` RPC + worker + 迁移接线 + injectAuth 改写）与 P3（工作台 UI）。

**Tech Stack:** TypeScript（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax，相对导入带 `.js`）、Zod、Vitest。

**Spec:** `docs/superpowers/specs/2026-06-21-provider-workbench-design.md`（§4 数据模型 / §6 路由 / §11 迁移）。

---

## File Structure

| 文件 | 责任 | 动作 |
| --- | --- | --- |
| `packages/protocol/src/provider-config.ts` | 已有 dialect 表；追加 Source/Model schema、adapter 模板、`generateUniqueSourceId`/`modelEntryId`/`resolveChatTarget` | Modify |
| `packages/protocol/src/prefs.ts` | PrefsSchema 追加 `model.providerSources`/`model.models`/`model.default*ModelId` | Modify |
| `packages/protocol/src/provider-migrate.ts` | 旧单 provider 配置 → 新两层（纯函数） | Create |
| `packages/protocol/test/provider-config.test.ts` | Source/Model schema、helpers、resolveChatTarget 单测 | Create |
| `packages/protocol/test/provider-migrate.test.ts` | 迁移函数单测 | Create |
| `packages/protocol/test/prefs.test.ts` | 新 prefs 键默认/校验单测 | Modify |

> `packages/protocol/src/index.ts` 已 `export * from './provider-config.js'` 与 `./prefs.js`；新增的 `provider-migrate.ts` 需补一行 export（见 Task 3 Step 3）。

> 测试运行约定：协议自测直跑 `../src`，无需先 build。命令统一用 `pnpm --filter @desksoul/protocol exec vitest run <file>`。**P1 全绿后、进入 P2/desktop 前**再 `pnpm --filter @desksoul/protocol build`（desktop 消费 dist）。

---

## Task 1: Source/Model schema + adapter 模板 + helpers

**Files:**
- Modify: `packages/protocol/src/provider-config.ts`（在文件末尾追加）
- Test: `packages/protocol/test/provider-config.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `packages/protocol/test/provider-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  ProviderSourceSchema,
  ModelEntrySchema,
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

  it('rejects unknown adapter or capability', () => {
    expect(
      ProviderSourceSchema.safeParse({ id: 'x', adapter: 'cohere', capability: 'chat', apiBase: '' })
        .success,
    ).toBe(false);
    expect(
      ProviderSourceSchema.safeParse({ id: 'x', adapter: 'openai', capability: 'image', apiBase: '' })
        .success,
    ).toBe(false);
  });
});

describe('ModelEntrySchema', () => {
  it('defaults caps={} / enabled=true', () => {
    const m = ModelEntrySchema.parse({
      id: 'openai-main/gpt-4o',
      sourceId: 'openai-main',
      model: 'gpt-4o',
    });
    expect(m.caps).toEqual({});
    expect(m.enabled).toBe(true);
  });
});

describe('provider-config helpers', () => {
  it('generateUniqueSourceId appends _N on collision', () => {
    expect(generateUniqueSourceId('openai', [])).toBe('openai');
    expect(generateUniqueSourceId('openai', ['openai'])).toBe('openai_1');
    expect(generateUniqueSourceId('openai', ['openai', 'openai_1'])).toBe('openai_2');
  });

  it('modelEntryId joins source/model', () => {
    expect(modelEntryId('openai-main', 'gpt-4o')).toBe('openai-main/gpt-4o');
  });

  it('ADAPTER_TEMPLATES exposes a chat template for each builtin adapter', () => {
    const chatAdapters = ADAPTER_TEMPLATES.filter((t) => t.capability === 'chat').map((t) => t.adapter);
    expect(chatAdapters).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini', 'ollama']));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts`
Expected: FAIL（`ProviderSourceSchema` 等未导出 / 模块解析报错）。

- [ ] **Step 3: 追加实现**

在 `packages/protocol/src/provider-config.ts` **文件末尾**追加（文件顶部已 `import { z } from 'zod'`，已有 `AuthStyle`/`ProviderFormat` 类型）：

```ts
/** 能力分类（对齐 AstrBot ProviderType）。 */
export const CapabilitySchema = z.enum([
  'chat',
  'agent_runner',
  'stt',
  'tts',
  'embedding',
  'rerank',
]);
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

/** Provider Source = 一个端点账号；可多建、同 adapter 可并存。key 明文随 source 存（用户裁定）。 */
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
export interface AdapterTemplate {
  adapter: Adapter;
  capability: Capability;
  label: string;
  defaultApiBase: string;
  authStyle: AuthStyle;
  format: ProviderFormat;
  defaultModels: string[];
}

export const ADAPTER_TEMPLATES: AdapterTemplate[] = [
  {
    adapter: 'openai',
    capability: 'chat',
    label: 'OpenAI Compatible',
    defaultApiBase: 'https://api.openai.com/v1',
    authStyle: 'bearer',
    format: 'openai',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
  },
  {
    adapter: 'anthropic',
    capability: 'chat',
    label: 'Anthropic Claude',
    defaultApiBase: 'https://api.anthropic.com/v1',
    authStyle: 'x-api-key',
    format: 'anthropic',
    defaultModels: ['claude-sonnet-4-6'],
  },
  {
    adapter: 'gemini',
    capability: 'chat',
    label: 'Google Gemini',
    defaultApiBase: 'https://generativelanguage.googleapis.com/v1beta',
    authStyle: 'query-key',
    format: 'gemini',
    defaultModels: ['gemini-1.5-flash'],
  },
  {
    adapter: 'ollama',
    capability: 'chat',
    label: 'Ollama (本地)',
    defaultApiBase: 'http://127.0.0.1:11434',
    authStyle: 'none',
    format: 'ollama',
    defaultModels: [],
  },
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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts`
Expected: PASS（3 describe 全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-config.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(protocol): ProviderSource/ModelEntry schema + adapter 模板 + helpers"
```

---

## Task 2: PrefsSchema 追加两层模型键

**Files:**
- Modify: `packages/protocol/src/prefs.ts`
- Test: `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/test/prefs.test.ts` 末尾追加：

```ts
describe('PrefsSchema provider workbench (AstrBot 对齐)', () => {
  it('defaults sources/models to [] and default*ModelId to ""', () => {
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
    const ok = PrefsSchema.shape['model.providerSources'].safeParse([
      { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://api.openai.com/v1' },
    ]);
    expect(ok.success).toBe(true);
    const bad = PrefsSchema.shape['model.providerSources'].safeParse([
      { id: 'x', adapter: 'nope', capability: 'chat', apiBase: '' },
    ]);
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: FAIL（`model.providerSources` 等键不存在，默认值 undefined）。

- [ ] **Step 3: 追加实现**

在 `packages/protocol/src/prefs.ts` 顶部 import 改为同时引入两个 schema：

```ts
import {
  BUILTIN_PROVIDERS,
  normalizeProviderBaseUrl,
  ProviderSourceSchema,
  ModelEntrySchema,
} from './provider-config.js';
```

在 `PrefsSchema` 内、`'model.ollamaBaseUrl': ...` 那一行**之后**、`// budget` 注释**之前**插入：

```ts
  // model · Provider 工作台（AstrBot 对齐）—— 两层 Source+Model（P1 纯追加，旧键并存）
  'model.providerSources': z.array(ProviderSourceSchema).default([]),
  'model.models': z.array(ModelEntrySchema).default([]),
  'model.defaultChatModelId': z.string().default(''),
  'model.defaultEmbeddingModelId': z.string().default(''),
  'model.defaultSttModelId': z.string().default(''),
  'model.defaultTtsModelId': z.string().default(''),
  'model.defaultRerankModelId': z.string().default(''),
  'model.defaultAgentModelId': z.string().default(''),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: PASS（含原有用例 + 新 describe）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): prefs 追加两层 Source+Model 键（纯追加，旧键并存）"
```

---

## Task 3: 旧配置迁移纯函数

**Files:**
- Create: `packages/protocol/src/provider-migrate.ts`
- Modify: `packages/protocol/src/index.ts`（补 export）
- Test: `packages/protocol/test/provider-migrate.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `packages/protocol/test/provider-migrate.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { migrateProviderConfig } from '../src/provider-migrate.js';

const keyLookup = (id: string) => (id === 'openai' ? 'sk-test' : '');

describe('migrateProviderConfig', () => {
  it('returns empty when no active provider', () => {
    const r = migrateProviderConfig({ activeProvider: '', activeModel: '', rawPrefs: {} }, keyLookup);
    expect(r).toEqual({ sources: [], models: [], defaultChatModelId: '' });
  });

  it('returns empty when active provider is not a builtin dialect', () => {
    const r = migrateProviderConfig(
      { activeProvider: 'mystery', activeModel: 'x', rawPrefs: {} },
      keyLookup,
    );
    expect(r).toEqual({ sources: [], models: [], defaultChatModelId: '' });
  });

  it('synthesizes source + model + default from legacy openai config', () => {
    const r = migrateProviderConfig(
      {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        rawPrefs: { 'model.openaiBaseUrl': 'https://relay.example.com/v1' },
      },
      keyLookup,
    );
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({
      id: 'openai',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'https://relay.example.com/v1',
      key: 'sk-test',
      enabled: true,
    });
    expect(r.models[0]).toMatchObject({ id: 'openai/gpt-4o', sourceId: 'openai', model: 'gpt-4o' });
    expect(r.defaultChatModelId).toBe('openai/gpt-4o');
  });

  it('maps claude dialect to anthropic adapter and falls back to default model', () => {
    const r = migrateProviderConfig(
      { activeProvider: 'claude', activeModel: '', rawPrefs: {} },
      () => 'k',
    );
    expect(r.sources[0]?.adapter).toBe('anthropic');
    expect(r.models[0]?.model).toBe('claude-sonnet-4-6');
    expect(r.defaultChatModelId).toBe('claude/claude-sonnet-4-6');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-migrate.test.ts`
Expected: FAIL（`provider-migrate` 模块不存在）。

- [ ] **Step 3: 写实现 + 补 export**

新建 `packages/protocol/src/provider-migrate.ts`：

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
  /** 旧 prefs 全量（供 getProviderBaseUrl 读各 *BaseUrl 覆盖）。 */
  rawPrefs: Record<string, unknown>;
}

export interface MigratedProviderConfig {
  sources: ProviderSource[];
  models: ModelEntry[];
  defaultChatModelId: string;
}

/**
 * 旧单 provider 配置 → 新两层 Source+Model。纯函数：keychain 读出的 key 由 Main 经
 * keyLookup 注入；无副作用便于单测。仅当 activeProvider 是内置 dialect 时合成。
 */
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

  const entry: ModelEntry = {
    id: modelEntryId(pid, model),
    sourceId: pid,
    model,
    enabled: true,
    caps: {},
  };
  return { sources: [source], models: [entry], defaultChatModelId: entry.id };
}
```

在 `packages/protocol/src/index.ts` 的 `export * from './provider-config.js';` 之后加一行：

```ts
export * from './provider-migrate.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-migrate.test.ts`
Expected: PASS（4 用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-migrate.ts packages/protocol/src/index.ts packages/protocol/test/provider-migrate.test.ts
git commit -m "feat(protocol): 旧单 provider 配置 → 两层模型迁移纯函数"
```

---

## Task 4: chat 目标解析纯函数

**Files:**
- Modify: `packages/protocol/src/provider-config.ts`（追加 `resolveChatTarget` + `ChatTarget`）
- Test: `packages/protocol/test/provider-config.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/test/provider-config.test.ts` 顶部 import 增补 `resolveChatTarget` 与类型，并在文件末尾追加 describe：

```ts
// ↓ 顶部 import 增补（与 Task 1 的 import 合并为一处）
import type { ProviderSource, ModelEntry } from '../src/provider-config.js';
import { resolveChatTarget } from '../src/provider-config.js';

describe('resolveChatTarget', () => {
  const sources: ProviderSource[] = [
    {
      id: 'openai-main',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'https://api.openai.com/v1',
      key: 'k',
      enabled: true,
    },
  ];
  const models: ModelEntry[] = [
    { id: 'openai-main/gpt-4o', sourceId: 'openai-main', model: 'gpt-4o', enabled: true, caps: {} },
  ];

  it('resolves a valid target', () => {
    expect(resolveChatTarget(sources, models, 'openai-main/gpt-4o')).toEqual({
      sourceId: 'openai-main',
      adapter: 'openai',
      apiBase: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
  });

  it('returns null on empty / missing / disabled model / disabled source', () => {
    expect(resolveChatTarget(sources, models, '')).toBeNull();
    expect(resolveChatTarget(sources, models, 'x/y')).toBeNull();
    const disabledModel: ModelEntry[] = [{ ...models[0]!, enabled: false }];
    expect(resolveChatTarget(sources, disabledModel, 'openai-main/gpt-4o')).toBeNull();
    const disabledSource: ProviderSource[] = [{ ...sources[0]!, enabled: false }];
    expect(resolveChatTarget(disabledSource, models, 'openai-main/gpt-4o')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts`
Expected: FAIL（`resolveChatTarget` 未导出）。

- [ ] **Step 3: 追加实现**

在 `packages/protocol/src/provider-config.ts` 末尾追加：

```ts
export interface ChatTarget {
  sourceId: string;
  adapter: Adapter;
  apiBase: string;
  model: string;
}

/**
 * 从两层配置解析 chat 目标：defaultChatModelId → ModelEntry → ProviderSource。
 * 任一缺失或 disabled 返回 null（调用方走离线兜底）。纯函数，无降级链（对齐 AstrBot）。
 */
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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/provider-config.test.ts`
Expected: PASS（含新增 `resolveChatTarget` describe）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/provider-config.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(protocol): resolveChatTarget 两层配置→chat 目标解析（无降级链）"
```

---

## Task 5: 全量协议测试 + build 收口

**Files:**（无新增，仅验证）

- [ ] **Step 1: 全量协议测试**

Run: `pnpm --filter @desksoul/protocol test`
Expected: PASS（含 provider-config / provider-migrate / prefs 全部用例；原有用例不回归）。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @desksoul/protocol typecheck`
Expected: 无错误（注意 `exactOptionalPropertyTypes`：可选字段不要显式赋 `undefined`）。

- [ ] **Step 3: build dist（供 P2/desktop 消费）**

Run: `pnpm --filter @desksoul/protocol build`
Expected: exit 0，`packages/protocol/dist/` 含 `provider-migrate.js` 与更新后的 `provider-config.js`/`prefs.js`。

- [ ] **Step 4: 提交（若 build 产物纳管则附带；通常 dist 不入库，仅确认 exit 0）**

```bash
git status --short
# 若仓库 .gitignore 忽略 dist，则无需提交；否则：
# git add packages/protocol/dist && git commit -m "chore(protocol): build dist for provider workbench P1"
```

---

## P1 Self-Review（写计划后自查，已内联确认）

- **Spec 覆盖（P1 切片）**：§4 数据模型 → Task 1/2；§11 迁移 → Task 3；§6 路由解析（纯函数部分）→ Task 4。§7 协议方法、§8 Main 服务、§9 worker、§10 UI、§5 tab → **P2/P3**（见下）。
- **类型一致性**：`ProviderSource`/`ModelEntry`/`Capability`/`Adapter`/`ModelCaps`/`ChatTarget` 命名贯穿 Task 1/3/4；`modelEntryId`/`generateUniqueSourceId`/`resolveChatTarget`/`migrateProviderConfig` 签名一致；prefs 键名（`model.providerSources`/`model.models`/`model.default*ModelId`）Task 2 与后续 P2 引用一致。
- **无占位**：每步含完整代码 + 实跑命令 + 预期。
- **行为不变**：P1 不动旧 `model.activeProvider/activeModel/*BaseUrl` 与任何 Main/worker/UI；旧路径继续驱动运行时，全绿无回归。

## 不在 P1（后续计划）

- **P2**：`methods.ts` 新 `provider.*` Zod + `provider-service.ts` 重写（操作动态 sources/models + source.key）+ `provider-config.ts`(main) `resolveHost`/`injectAuth` 改读 source.key + `chat-resolve.ts`/`chat-service.ts` 用 `resolveChatTarget` + 启动时调 `migrateProviderConfig` 接线 + worker honor 动态 `{adapter,apiBase,model}` target。headless 单测。
- **P3**：`ModelApiPage.vue` 工作台改造（6 能力 tab + `ProviderSourcesPanel`/`ProviderModelsPanel`/`AddSourceDialog`，对齐 AstrBot 三面板 + `UI/36b542fb` + hifi brief）+ C2 引导积木同步。
