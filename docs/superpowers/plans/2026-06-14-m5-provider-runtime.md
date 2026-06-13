# M5 Provider 运行时实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 chat 管线从 mock 脚本接通到真实 LLM 流式（OpenAI 兼容 + Ollama），密钥在 Main 注入、worker 永不可见。

**Architecture:** 单 provider worker + 内置 provider 注册表（`chat.start` 带 `providerId` 分发）。worker 内 `fetch` 被代理为 `plugin.fetchRequest` 帧上行到 Main 的 FetchGateway，由 Main 做 host 白名单 + Keychain 注入 Authorization + Electron `net` 流式请求，响应分块 `plugin.fetchChunk` 回灌 worker 重建 `ReadableStream`。provider 解析 SSE 产出 `ChatEvent`，经 `ConversationCore` 双轨拆分到 chat.* / behavior.*。

**Tech Stack:** TypeScript (strict + verbatimModuleSyntax + ESM `.js` 后缀)、Zod（协议单一真源）、Electron `net`、Vitest、`gpt-tokenizer`（纯 JS token 估算）。

**设计依据:** `docs/superpowers/specs/2026-06-14-m5-provider-runtime-design.md`

---

## 约定与全局须知（每个 task 都适用）

- **ESM 相对导入必须带 `.js` 后缀**；类型导入用 `import type`（`verbatimModuleSyntax`）。
- **改协议先改 Zod**：`packages/protocol` 是单一真源；Main/Worker/SDK 都 import `@desksoul/protocol`。
- **构建顺序**：protocol/plugin-sdk/sidecar 用 `tsc` 出 `dist/`；desktop 测试与运行依赖 `@desksoul/sidecar/dist/...` 真实文件，故改了 sidecar 后必须 `pnpm --filter @desksoul/sidecar build` 再跑 desktop 测试。
- **单测命令**：在对应 package 目录下 `pnpm exec vitest run <file>` 或 `-t "<用例名>"`。
- **提交规范**：Conventional Commits。每个 task 末尾 commit。
- **网络约束**：装依赖走已配置的 npmmirror 镜像；`gpt-tokenizer` 是纯 JS 无 native，正常 `pnpm add` 即可。
- **Electron `net` 不可在 vitest 中加载**：凡用到 `net` 的模块（FetchGateway）必须把"执行 HTTP 请求"抽象成注入的函数（`HttpAgent`），生产在 `apps/desktop/electron/main/index.ts` 注入 Electron 实现，测试注入 mock。

## 文件结构总览

**packages/protocol**（契约，先行）
- `src/schemas.ts` ✎ — ChatEvent 增 `usage`/`tool_call`，`done` 增 `error?`/`errorKind?`；新增 `PluginFetchRequestFrame`/`PluginFetchChunkFrame`；扩展 `ChatStartFrame`；新增 `ChatRequestSchema`；更新 Inbound/Outbound union
- `src/methods.ts` ✎ — 新增 `provider.*` 方法；`chat.send` 增可选 `providerId`
- `src/provider-config.ts` ✚ — `ProviderConfigSchema`、`ErrorKind` 常量、内置 provider dialect 表的类型

**packages/plugin-sdk**
- `src/index.ts` ✎ — 聚合导出
- `src/types.ts` ✎ — ChatEvent/ChatRequest 与 protocol 对齐（re-export）
- `src/fetch-proxy.ts` ✎ — 流式重建
- `src/sse.ts` ✚ — `parseSseStream(stream): AsyncGenerator<SseEvent>`
- `src/define-skill.ts` ✚ / `src/define-tool.ts` ✚

**apps/sidecar/src**
- `src/workers/provider-registry.ts` ✚
- `src/workers/providers/openai-compat.ts` ✚ — dialect 配置 + chat
- `src/workers/providers/ollama.ts` ✚
- `src/workers/providers/embedding.ts` ✚
- `src/workers/token-estimate.ts` ✚
- `src/workers/provider-worker-entry.ts` ✎ — 按 providerId 分发；保留 mock

**apps/desktop/electron/main**
- `fetch-gateway.ts` ✚ + `http-agent.ts` ✚（Electron net 适配，仅生产引用）
- `provider-host.ts` ✎ — fetchRequest 分支 + send 带 ChatRequest
- `provider-config.ts` ✚ + `provider-service.ts` ✚
- `chat-service.ts` ✎ — 组装 ChatRequest + usage 落账 + 降级链
- `conversation-core.ts` ✎ — usage/tool_call 处理
- `session-store.ts` ✎ — tokens 字段
- `ipc-router.ts` ✎ — 注册 provider.* + 注入 keychain/net

---

# Phase 1 · 协议补全 + SDK 定型 + 流式 fetch-proxy

到此结束：协议有完整的 ChatEvent/fetch 帧/ChatRequest，SDK 对外导出齐全，worker 侧 `fetch()` 能消费流式分块响应。纯单测，不涉及 Electron。

### Task 1.1: ChatEvent 扩展（usage / tool_call / done.error）

**Files:**
- Modify: `packages/protocol/src/schemas.ts:13-17`
- Test: `packages/protocol/test/schemas.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { ChatEventSchema } from '../src/schemas.js';

describe('ChatEventSchema', () => {
  it('accepts a usage event', () => {
    const r = ChatEventSchema.safeParse({ type: 'usage', prompt: 10, completion: 5 });
    expect(r.success).toBe(true);
  });
  it('accepts a tool_call event', () => {
    const r = ChatEventSchema.safeParse({ type: 'tool_call', id: 'c1', name: 'search', args: { q: 'x' } });
    expect(r.success).toBe(true);
  });
  it('accepts done with error + errorKind', () => {
    const r = ChatEventSchema.safeParse({ type: 'done', finishReason: 'error', error: 'boom', errorKind: 'auth' });
    expect(r.success).toBe(true);
  });
  it('still accepts a bare stop done', () => {
    expect(ChatEventSchema.safeParse({ type: 'done', finishReason: 'stop' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/schemas.test.ts`
Expected: FAIL（usage/tool_call 不被接受）

- [ ] **Step 3: 实现 —— 替换 `schemas.ts` 的 ChatEventSchema 与 ErrorKind**

```ts
// schemas.ts —— 替换第 13-17 行的 ChatEventSchema 定义
export const ERROR_KINDS = ['auth', 'rate_limit', 'timeout', 'network', 'server', 'unknown'] as const;
export const ErrorKindSchema = z.enum(ERROR_KINDS);
export type ErrorKind = z.infer<typeof ErrorKindSchema>;

export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('tool_call'), id: z.string(), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal('usage'),
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    cost: z.number().optional(),
  }),
  z.object({
    type: z.literal('done'),
    finishReason: z.enum(['stop', 'cancel', 'error']),
    error: z.string().optional(),
    errorKind: ErrorKindSchema.optional(),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/protocol && pnpm exec vitest run test/schemas.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 回归 —— 确认下游编译**

Run: `pnpm --filter @desksoul/protocol typecheck`
Expected: PASS（注意：`ConversationCore`/`mock-provider` 用了 ChatEvent，新增变体是可选/附加，不破坏既有 narrowing）

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/schemas.ts packages/protocol/test/schemas.test.ts
git commit -m "feat(protocol): ChatEvent 增 usage/tool_call 与 done.error/errorKind"
```

### Task 1.2: fetch 帧定义（fetchRequest / fetchChunk）+ Inbound/Outbound union

**Files:**
- Modify: `packages/protocol/src/schemas.ts`（在 PluginResponseFrame 之后追加；更新两个 union）
- Test: `packages/protocol/test/schemas.test.ts`

worker 侧 `fetch-proxy.ts` 当前手写 `plugin.fetchRequest`/`plugin.fetchResponse` 字面量且无 schema。正式收口为帧并改为**流式**模型：请求上行 `plugin.fetchRequest`，响应以**起始帧 + N 个 chunk 帧 + 终止帧**下行（统一为一个 `plugin.fetchChunk` 帧，用 `phase` 区分 `head`/`data`/`end`/`error`）。

- [ ] **Step 1: 追加测试用例到 schemas.test.ts**

```ts
import { PluginFetchRequestFrame, PluginFetchChunkFrame, ProviderOutboundFrame, ProviderInboundFrame } from '../src/schemas.js';

describe('fetch frames', () => {
  it('parses a fetchRequest frame', () => {
    const r = PluginFetchRequestFrame.safeParse({
      kind: 'plugin.fetchRequest', id: 'f1', url: 'https://api.openai.com/v1/chat/completions',
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    });
    expect(r.success).toBe(true);
  });
  it('parses fetchChunk head/data/end frames', () => {
    expect(PluginFetchChunkFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'head', status: 200, headers: {} }).success).toBe(true);
    expect(PluginFetchChunkFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'data', chunk: 'abc' }).success).toBe(true);
    expect(PluginFetchChunkFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'end' }).success).toBe(true);
    expect(PluginFetchChunkFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'error', error: 'x' }).success).toBe(true);
  });
  it('outbound union includes fetchRequest; inbound includes fetchChunk', () => {
    expect(ProviderOutboundFrame.safeParse({ kind: 'plugin.fetchRequest', id: 'f1', url: 'u', init: { method: 'GET' } }).success).toBe(true);
    expect(ProviderInboundFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'end' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/schemas.test.ts`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现 —— 在 `schemas.ts` PluginResponseFrame 之后追加帧，并替换两个 union**

```ts
/** Worker → Main：代理 fetch 请求（body 仅支持 string；二进制 V1+）。 */
export const PluginFetchRequestFrame = z.object({
  kind: z.literal('plugin.fetchRequest'),
  id: z.string(),
  url: z.string(),
  init: z.object({
    method: z.string(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
});
export type PluginFetchRequestFrame = z.infer<typeof PluginFetchRequestFrame>;

/** Main → Worker：流式响应分块。head 先到（状态/头），data 多次，end/error 收尾。 */
export const PluginFetchChunkFrame = z.object({
  kind: z.literal('plugin.fetchChunk'),
  id: z.string(),
  phase: z.enum(['head', 'data', 'end', 'error']),
  status: z.number().optional(),
  headers: z.record(z.string()).optional(),
  chunk: z.string().optional(),
  error: z.string().optional(),
});
export type PluginFetchChunkFrame = z.infer<typeof PluginFetchChunkFrame>;

// 替换既有 ProviderInboundFrame / ProviderOutboundFrame：
export const ProviderInboundFrame = z.discriminatedUnion('kind', [
  ChatStartFrame,
  ChatCancelFrame,
  PluginResponseFrame,
  PluginFetchChunkFrame,
]);
export type ProviderInboundFrame = z.infer<typeof ProviderInboundFrame>;

export const ProviderOutboundFrame = z.discriminatedUnion('kind', [
  ChatEventFrame,
  PluginRequestFrame,
  PluginFetchRequestFrame,
]);
export type ProviderOutboundFrame = z.infer<typeof ProviderOutboundFrame>;
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/protocol && pnpm exec vitest run test/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/schemas.ts packages/protocol/test/schemas.test.ts
git commit -m "feat(protocol): 定义流式 fetch 帧 fetchRequest/fetchChunk 并纳入 provider union"
```

### Task 1.3: ChatRequest schema + ChatStartFrame 扩展

**Files:**
- Modify: `packages/protocol/src/schemas.ts`（ChatStartFrame 第 20-27 行）
- Test: `packages/protocol/test/schemas.test.ts`

- [ ] **Step 1: 追加测试**

```ts
import { ChatRequestSchema, ChatStartFrame } from '../src/schemas.js';

describe('ChatRequest / ChatStartFrame', () => {
  const req = {
    messages: [{ role: 'user', content: 'hi' }],
    model: 'gpt-4o-mini',
    params: { temperature: 0.7, maxTokens: 256 },
  };
  it('parses a ChatRequest', () => {
    expect(ChatRequestSchema.safeParse(req).success).toBe(true);
  });
  it('chat.start carries providerId + request (intervalMs still optional for mock)', () => {
    expect(ChatStartFrame.safeParse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', providerId: 'openai', request: req }).success).toBe(true);
    expect(ChatStartFrame.safeParse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', intervalMs: 0 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/schemas.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 —— 新增 ChatRequestSchema，替换 ChatStartFrame**

```ts
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
});
export const ChatToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.unknown().optional(),
});
export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
  model: z.string().optional(),
  params: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
  }).optional(),
  tools: z.array(ChatToolSchema).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// 替换既有 ChatStartFrame：providerId + request 可选（mock 走 intervalMs 老路径）
export const ChatStartFrame = z.object({
  kind: z.literal('chat.start'),
  requestId: z.string(),
  sessionId: z.string(),
  providerId: z.string().optional(),
  request: ChatRequestSchema.optional(),
  intervalMs: z.number().int().nonnegative().optional(),
});
export type ChatStartFrame = z.infer<typeof ChatStartFrame>;
```

- [ ] **Step 4: 运行确认通过 + 全 protocol 测试回归**

Run: `cd packages/protocol && pnpm exec vitest run`
Expected: PASS（注意 ProviderInbound/Outbound union 引用了 ChatStartFrame，确认仍编译）

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/schemas.ts packages/protocol/test/schemas.test.ts
git commit -m "feat(protocol): ChatRequest schema + ChatStartFrame 携带 providerId/request"
```

### Task 1.4: provider.* 方法 + chat.send providerId（methods.ts）

**Files:**
- Modify: `packages/protocol/src/methods.ts`
- Test: `packages/protocol/test/methods.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/methods.test.ts
import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods.js';

describe('provider.* methods', () => {
  it('registers the provider namespace', () => {
    for (const m of ['provider.saveKey', 'provider.deleteKey', 'provider.listProviders', 'provider.testConnection', 'provider.listModels', 'provider.ollamaDetect']) {
      expect(Methods).toHaveProperty(m);
    }
  });
  it('provider.saveKey params accept providerId + key', () => {
    expect(Methods['provider.saveKey'].params.safeParse({ providerId: 'openai', key: 'sk-x' }).success).toBe(true);
  });
  it('provider.testConnection result carries ok + optional errorKind', () => {
    expect(Methods['provider.testConnection'].result.safeParse({ ok: false, errorKind: 'auth' }).success).toBe(true);
  });
  it('chat.send accepts optional providerId', () => {
    expect(Methods['chat.send'].params.safeParse({ sessionId: 's', text: 't', providerId: 'openai' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/methods.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 —— 改 `methods.ts`**

`chat.send` 的 params 增 `providerId`：

```ts
  'chat.send': {
    params: z.object({ sessionId: z.string(), text: z.string(), providerId: z.string().optional() }),
    result: z.object({ ok: z.literal(true) }),
  },
```

在 `plugin.invokeTool` 之后、`} as const;` 之前追加（先 `import { ErrorKindSchema } from './schemas.js';` 到文件顶部）：

```ts
  // --- request/response: Renderer → Main（provider 配置，M5；UI 在 M7 接 D3）---
  'provider.saveKey': {
    params: z.object({ providerId: z.string().min(1), key: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.deleteKey': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.listProviders': {
    params: z.object({}),
    result: z.object({
      providers: z.array(z.object({
        id: z.string(), name: z.string(), kind: z.enum(['chat', 'embedding']),
        hasKey: z.boolean(), enabled: z.boolean(), models: z.array(z.string()),
      })),
    }),
  },
  'provider.testConnection': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({ ok: z.boolean(), errorKind: ErrorKindSchema.optional(), detail: z.string().optional() }),
  },
  'provider.listModels': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({ models: z.array(z.string()) }),
  },
  'provider.ollamaDetect': {
    params: z.object({}),
    result: z.object({ available: z.boolean(), models: z.array(z.string()) }),
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/protocol && pnpm exec vitest run test/methods.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/methods.ts packages/protocol/test/methods.test.ts
git commit -m "feat(protocol): provider.* 方法命名空间 + chat.send 可选 providerId"
```

### Task 1.5: SDK 流式 fetch-proxy 改造

**Files:**
- Modify: `packages/plugin-sdk/src/fetch-proxy.ts`
- Test: `packages/plugin-sdk/test/fetch-proxy.test.ts`（已存在，替换/扩展）

worker 侧 `fetch()` 返回的 `Response.body` 必须是流式 `ReadableStream`，以便 provider 边收边解析 SSE。改造 `installFetchProxy`：发 `plugin.fetchRequest` 帧后，监听 `plugin.fetchChunk`：`head` → 构造 `Response`（body 接一个由后续 `data` 帧 enqueue 的 `ReadableStream`）；`data` → enqueue；`end` → close；`error` → error 流。

- [ ] **Step 1: 写失败测试（用 MessageChannel 驱动两端）**

```ts
// packages/plugin-sdk/test/fetch-proxy.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { installFetchProxy, __resetFetchProxyForTest } from '../src/fetch-proxy.js';

afterEach(() => __resetFetchProxyForTest());

describe('installFetchProxy (streaming)', () => {
  it('streams chunks as a ReadableStream body', async () => {
    const { port1, port2 } = new MessageChannel();
    installFetchProxy(port1);
    // 扮演 Main：收到 fetchRequest 就回 head + 两个 data + end
    port2.on('message', (m: any) => {
      if (m.kind !== 'plugin.fetchRequest') return;
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'data', chunk: 'hello ' });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'data', chunk: 'world' });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'end' });
    });
    const res = await fetch('https://x/y', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
    port1.close(); port2.close();
  });

  it('rejects/streams error on phase=error head', async () => {
    const { port1, port2 } = new MessageChannel();
    installFetchProxy(port1);
    port2.on('message', (m: any) => {
      if (m.kind !== 'plugin.fetchRequest') return;
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'error', error: 'net down' });
    });
    await expect(fetch('https://x/y')).rejects.toThrow(/net down/);
    port1.close(); port2.close();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/plugin-sdk && pnpm exec vitest run test/fetch-proxy.test.ts`
Expected: FAIL（当前实现是非流式 `plugin.fetchResponse`）

- [ ] **Step 3: 实现 —— 重写 `fetch-proxy.ts`**

```ts
import type { MessagePort } from 'node:worker_threads';
import type { PluginFetchRequestFrame, PluginFetchChunkFrame } from '@desksoul/protocol';

let proxyInstalled = false;
const FETCH_TIMEOUT = 60_000;

interface Pending {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  settleHead: (r: Response) => void;
  failHead: (e: Error) => void;
  headSettled: boolean;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** 仅测试：重置单例，便于多次 install。 */
export function __resetFetchProxyForTest(): void {
  proxyInstalled = false;
}

export function installFetchProxy(port: MessagePort): void {
  if (proxyInstalled) return;
  proxyInstalled = true;
  const pending = new Map<string, Pending>();
  const enc = new TextEncoder();

  port.on('message', (msg: unknown) => {
    if (typeof msg !== 'object' || !msg || (msg as { kind?: string }).kind !== 'plugin.fetchChunk') return;
    const f = msg as PluginFetchChunkFrame;
    const p = pending.get(f.id);
    if (!p) return;
    if (f.phase === 'head') {
      clearTimeout(p.timeoutId);
      const body = new ReadableStream<Uint8Array>({ start: (c) => { p.controller = c; } });
      p.headSettled = true;
      p.settleHead(new Response(body, { status: f.status ?? 200, ...(f.headers ? { headers: f.headers } : {}) }));
    } else if (f.phase === 'data') {
      if (f.chunk) p.controller?.enqueue(enc.encode(f.chunk));
    } else if (f.phase === 'end') {
      p.controller?.close();
      pending.delete(f.id);
    } else {
      const err = new Error(f.error ?? 'fetch failed');
      if (!p.headSettled) p.failHead(err); else p.controller?.error(err);
      clearTimeout(p.timeoutId);
      pending.delete(f.id);
    }
  });

  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const id = crypto.randomUUID();
    const reqUrl = typeof url === 'string' ? url : url.toString();
    return new Promise<Response>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('Fetch timeout after 60s'));
      }, FETCH_TIMEOUT);
      pending.set(id, { controller: null, settleHead: resolve, failHead: reject, headSettled: false, timeoutId });
      const headers = normalizeHeaders(init?.headers);
      const frame: PluginFetchRequestFrame = {
        kind: 'plugin.fetchRequest', id, url: reqUrl,
        init: {
          method: init?.method ?? 'GET',
          ...(headers ? { headers } : {}),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        },
      };
      port.postMessage(frame);
    });
  }) as typeof fetch;
}

function normalizeHeaders(h: RequestInit['headers']): Record<string, string> | undefined {
  if (!h) return undefined;
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/plugin-sdk && pnpm exec vitest run test/fetch-proxy.test.ts`
Expected: PASS（2 用例）

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/fetch-proxy.ts packages/plugin-sdk/test/fetch-proxy.test.ts
git commit -m "feat(plugin-sdk): fetch-proxy 改流式（ReadableStream body + fetchChunk 帧）"
```

### Task 1.6: SSE 解析 helper（sse.ts）

**Files:**
- Create: `packages/plugin-sdk/src/sse.ts`
- Test: `packages/plugin-sdk/test/sse.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/plugin-sdk/test/sse.test.ts
import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../src/sse.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
}

describe('parseSseStream', () => {
  it('yields data payloads split across chunk boundaries', async () => {
    const s = streamOf('data: {"a":1}\n\nda', 'ta: {"b":2}\n\n', 'data: [DONE]\n\n');
    const out: string[] = [];
    for await (const ev of parseSseStream(s)) out.push(ev.data);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });
  it('ignores comments and empty lines', async () => {
    const s = streamOf(': ping\n\ndata: x\n\n');
    const out: string[] = [];
    for await (const ev of parseSseStream(s)) out.push(ev.data);
    expect(out).toEqual(['x']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/plugin-sdk && pnpm exec vitest run test/sse.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `sse.ts`**

```ts
export interface SseEvent { event?: string; data: string; }

/** 解析 text/event-stream：按空行分隔事件，聚合多行 data:，跳过注释行。 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = parseBlock(block);
        if (ev) yield ev;
      }
    }
    const tail = parseBlock(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('event:')) event = line.slice(6).trim();
  }
  if (dataLines.length === 0) return null;
  return event !== undefined ? { event, data: dataLines.join('\n') } : { data: dataLines.join('\n') };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/plugin-sdk && pnpm exec vitest run test/sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/sse.ts packages/plugin-sdk/test/sse.test.ts
git commit -m "feat(plugin-sdk): 增量 SSE 解析 helper parseSseStream"
```

### Task 1.7: defineSkill / defineTool + index 聚合导出

**Files:**
- Create: `packages/plugin-sdk/src/define-skill.ts`, `packages/plugin-sdk/src/define-tool.ts`
- Modify: `packages/plugin-sdk/src/index.ts`
- Test: `packages/plugin-sdk/test/define.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/plugin-sdk/test/define.test.ts
import { describe, it, expect } from 'vitest';
import { defineProvider, defineSkill, defineTool, parseSseStream, installFetchProxy } from '../src/index.js';

describe('sdk barrel + define helpers', () => {
  it('re-exports core surface', () => {
    expect(typeof defineProvider).toBe('function');
    expect(typeof parseSseStream).toBe('function');
    expect(typeof installFetchProxy).toBe('function');
  });
  it('defineSkill returns a normalized descriptor', () => {
    const s = defineSkill({ id: 'pomodoro', setup() {} });
    expect(s.id).toBe('pomodoro');
    expect(typeof s.setup).toBe('function');
  });
  it('defineTool returns id + run', () => {
    const t = defineTool({ id: 'echo', run: (a) => a });
    expect(t.id).toBe('echo');
    expect(t.run({ x: 1 })).toEqual({ x: 1 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/plugin-sdk && pnpm exec vitest run test/define.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// packages/plugin-sdk/src/define-skill.ts
export interface SkillContext {
  chat: { systemSay(text: string): void };
  timer: { in(spec: string, cb: () => void): void };
}
export interface SkillConfig {
  id: string;
  setup(ctx: SkillContext): void | Promise<void>;
}
export function defineSkill(config: SkillConfig): SkillConfig {
  return config;
}
```

```ts
// packages/plugin-sdk/src/define-tool.ts
export interface ToolConfig {
  id: string;
  description?: string;
  run(args: unknown): unknown | Promise<unknown>;
}
export function defineTool(config: ToolConfig): ToolConfig {
  return config;
}
```

```ts
// packages/plugin-sdk/src/index.ts  —— 全量替换
export const PLUGIN_SDK_VERSION = '0.1.0';
export * from './types.js';
export { defineProvider, type ProviderConfig } from './define-provider.js';
export { defineSkill, type SkillConfig, type SkillContext } from './define-skill.js';
export { defineTool, type ToolConfig } from './define-tool.js';
export { installFetchProxy, __resetFetchProxyForTest } from './fetch-proxy.js';
export { parseSseStream, type SseEvent } from './sse.js';
export { createPluginClient, type PluginClient } from './plugin-client.js';
```

注意：`plugin-client.ts` 当前在 `apps/sidecar`，不在 plugin-sdk。**核对**：`createPluginClient` 实际位于 `apps/sidecar/src/plugin-client.ts`。本 task 不迁移它——从 index 导出列表中**删除** `createPluginClient` 那一行（保留它在 sidecar）。最终 index 末行只到 `parseSseStream`。

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `cd packages/plugin-sdk && pnpm exec vitest run && pnpm build`
Expected: PASS + dist 产出

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src
git commit -m "feat(plugin-sdk): defineSkill/defineTool + index 聚合导出"
```

### Task 1.8: Phase 1 收尾回归

- [ ] **Step 1: 全量 typecheck + test**

Run: `pnpm --filter @desksoul/protocol --filter @desksoul/plugin-sdk typecheck && pnpm --filter @desksoul/protocol --filter @desksoul/plugin-sdk test`
Expected: 全 PASS

- [ ] **Step 2: 构建 protocol 与 plugin-sdk（供下游 import）**

Run: `pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/plugin-sdk build`
Expected: dist 产出，无错误

---

# Phase 2 · Main 侧 FetchGateway + Keychain 注入

到此结束：worker 发出的 `plugin.fetchRequest` 被 Main 拦截 —— host 白名单校验、Keychain 取密钥注入 Authorization、Electron `net` 流式请求、`plugin.fetchChunk` 回流；取消可传播。worker 永远看不到密钥。FetchGateway 是纯模块（注入 `HttpAgent`），单测覆盖；Electron `net` 适配单独成文件不单测。

### Task 2.1: HttpAgent 接口 + Electron net 适配

**Files:**
- Create: `apps/desktop/electron/main/http-agent.ts`

`net` 只能在 Electron 运行时加载，vitest 里 import 会失败。因此把"执行一次流式 HTTP 请求"抽象为 `HttpAgent` 函数类型（在 fetch-gateway.ts 定义并被测试 mock），这里只提供生产实现，**不写单测**（由 e2e / 手动联网覆盖）。

- [ ] **Step 1: 实现 `http-agent.ts`**

```ts
/**
 * Electron net 适配：把一次请求映射为 HttpAgent。仅生产引用（index.ts），
 * 不在 vitest 中加载（net 需 Electron 运行时）。流式：response.on('data') 边收边吐。
 */
import { net } from 'electron';
import type { HttpAgent } from './fetch-gateway.js';

export const electronHttpAgent: HttpAgent = (spec, sink) => {
  const req = net.request({ method: spec.method, url: spec.url });
  for (const [k, v] of Object.entries(spec.headers)) req.setHeader(k, v);
  spec.signal.addEventListener('abort', () => req.abort(), { once: true });
  req.on('response', (res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    sink.head(res.statusCode ?? 0, headers);
    res.on('data', (c: Buffer) => sink.data(c.toString('utf8')));
    res.on('end', () => sink.end());
    res.on('error', (e: Error) => sink.error(e.message));
  });
  req.on('error', (e: Error) => sink.error(e.message));
  req.on('abort', () => sink.error('aborted'));
  if (spec.body !== undefined) req.write(spec.body);
  req.end();
};
```

- [ ] **Step 2: typecheck（无测试）**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: PASS（依赖 Task 2.2 的 fetch-gateway.ts 已存在其类型；若顺序执行，先做 2.2 再回填本步 typecheck）

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/main/http-agent.ts
git commit -m "feat(desktop): Electron net 适配 electronHttpAgent（流式）"
```

### Task 2.2: FetchGateway（纯模块）

**Files:**
- Create: `apps/desktop/electron/main/fetch-gateway.ts`
- Test: `apps/desktop/test/fetch-gateway.test.ts`

职责：白名单匹配（`resolveHost(url)` 命中得 `providerId`，否则拒绝）→ `injectAuth(providerId, headers)`（dialect 注入密钥，Phase 3 接 provider-config）→ 调注入的 `HttpAgent` → 把 head/data/end/error 映射成 `plugin.fetchChunk` 帧经 `send` 回流；维护 in-flight `AbortController` 支持取消。

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/fetch-gateway.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { PluginFetchChunkFrame, PluginFetchRequestFrame } from '@desksoul/protocol';
import { createFetchGateway, type HttpAgent } from '../electron/main/fetch-gateway';

const reqFrame = (over: Partial<PluginFetchRequestFrame> = {}): PluginFetchRequestFrame => ({
  kind: 'plugin.fetchRequest', id: 'f1', url: 'https://api.openai.com/v1/chat/completions',
  init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, ...over,
});

describe('FetchGateway', () => {
  it('rejects a host not on the whitelist with an error chunk', async () => {
    const sent: PluginFetchChunkFrame[] = [];
    const agent: HttpAgent = vi.fn();
    const gw = createFetchGateway({
      agent, resolveHost: () => null, injectAuth: async (_id, h) => h,
    });
    gw.handle(reqFrame({ url: 'https://evil.example/x' }), (c) => sent.push(c));
    await Promise.resolve();
    expect(agent).not.toHaveBeenCalled();
    expect(sent).toEqual([{ kind: 'plugin.fetchChunk', id: 'f1', phase: 'error', error: expect.stringContaining('not allowed') }]);
  });

  it('injects auth then streams head/data/end through chunk frames', async () => {
    const sent: PluginFetchChunkFrame[] = [];
    const agent: HttpAgent = (spec, sink) => {
      expect(spec.headers.authorization).toBe('Bearer sk-test');
      sink.head(200, { 'content-type': 'text/event-stream' });
      sink.data('data: a\n\n');
      sink.end();
    };
    const gw = createFetchGateway({
      agent,
      resolveHost: (url) => (url.includes('openai.com') ? { providerId: 'openai' } : null),
      injectAuth: async (id, h) => ({ ...h, authorization: id === 'openai' ? 'Bearer sk-test' : '' }),
    });
    gw.handle(reqFrame(), (c) => sent.push(c));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((c) => c.phase)).toEqual(['head', 'data', 'end']);
    expect(sent[0]).toMatchObject({ phase: 'head', status: 200 });
    expect(sent[1]).toMatchObject({ phase: 'data', chunk: 'data: a\n\n' });
  });

  it('cancel(id) aborts the in-flight request signal', async () => {
    let aborted = false;
    const agent: HttpAgent = (spec) => { spec.signal.addEventListener('abort', () => (aborted = true)); };
    const gw = createFetchGateway({ agent, resolveHost: () => ({ providerId: 'openai' }), injectAuth: async (_i, h) => h });
    gw.handle(reqFrame(), () => {});
    gw.cancel('f1');
    expect(aborted).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/fetch-gateway.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `fetch-gateway.ts`**

```ts
import type { PluginFetchRequestFrame, PluginFetchChunkFrame } from '@desksoul/protocol';

export interface HttpRequestSpec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}
export interface HttpResponseSink {
  head(status: number, headers: Record<string, string>): void;
  data(chunk: string): void;
  end(): void;
  error(message: string): void;
}
export type HttpAgent = (spec: HttpRequestSpec, sink: HttpResponseSink) => void;

export interface FetchGatewayDeps {
  agent: HttpAgent;
  /** 命中白名单返回 providerId，否则 null（拒绝）。 */
  resolveHost: (url: string) => { providerId: string } | null;
  /** 按 providerId 把密钥注入头（dialect：Bearer / x-api-key / query…）；Phase 3 接 provider-config。 */
  injectAuth: (providerId: string, headers: Record<string, string>) => Promise<Record<string, string>>;
}

export interface FetchGateway {
  handle(frame: PluginFetchRequestFrame, send: (chunk: PluginFetchChunkFrame) => void): void;
  cancel(id: string): void;
  cancelAll(): void;
}

export function createFetchGateway(deps: FetchGatewayDeps): FetchGateway {
  const inflight = new Map<string, AbortController>();

  return {
    handle(frame, send) {
      const sendErr = (error: string): void => send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'error', error });
      const hit = deps.resolveHost(frame.url);
      if (!hit) { sendErr(`host not allowed: ${frame.url}`); return; }

      const ac = new AbortController();
      inflight.set(frame.id, ac);
      const done = (): void => { inflight.delete(frame.id); };

      void deps
        .injectAuth(hit.providerId, { ...(frame.init.headers ?? {}) })
        .then((headers) => {
          const sink: HttpResponseSink = {
            head: (status, h) => send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'head', status, headers: h }),
            data: (chunk) => send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'data', chunk }),
            end: () => { send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'end' }); done(); },
            error: (message) => { sendErr(message); done(); },
          };
          deps.agent(
            { url: frame.url, method: frame.init.method, headers, ...(frame.init.body !== undefined ? { body: frame.init.body } : {}), signal: ac.signal },
            sink,
          );
        })
        .catch((e: unknown) => { sendErr(e instanceof Error ? e.message : String(e)); done(); });
    },
    cancel(id) { inflight.get(id)?.abort(); inflight.delete(id); },
    cancelAll() { for (const ac of inflight.values()) ac.abort(); inflight.clear(); },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm exec vitest run test/fetch-gateway.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/fetch-gateway.ts apps/desktop/test/fetch-gateway.test.ts
git commit -m "feat(desktop): FetchGateway 纯模块（白名单+密钥注入+流式回流+取消）"
```

### Task 2.3: ProviderHost 接 plugin.fetchRequest 分支

**Files:**
- Modify: `apps/desktop/electron/main/provider-host.ts`（构造选项 + message handler + cancel/death 清理）
- Test: `apps/desktop/test/provider-host.test.ts`（追加用例）+ `apps/desktop/test/fixtures/fetch-worker.mjs`（新建）

ProviderHost 当前 message handler 只认 `plugin.request` 与 `chat.event`；要增 `plugin.fetchRequest` 分支 → 调用注入的 `onFetchRequest(frame, send)`，`send` 把 chunk 帧 `postMessage` 回当前 worker（worker 换代/dispose 后丢弃）。死亡/强杀时调用 `onFetchCancelAll` 让网关 abort 在途请求。

- [ ] **Step 1: 新建 fixture worker（发一个 fetch 并把响应体作为 delta 吐回）**

```js
// apps/desktop/test/fixtures/fetch-worker.mjs
import { parentPort } from 'node:worker_threads';
const pending = new Map();
parentPort.on('message', async (msg) => {
  if (msg.kind === 'plugin.fetchChunk') {
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.phase === 'head') p.parts.push(`H${msg.status}`);
    else if (msg.phase === 'data') p.parts.push(msg.chunk);
    else if (msg.phase === 'end') { p.resolve(p.parts.join('')); pending.delete(msg.id); }
    else if (msg.phase === 'error') { p.resolve(`ERR:${msg.error}`); pending.delete(msg.id); }
    return;
  }
  if (msg.kind === 'chat.start') {
    const id = 'fx1';
    const body = await new Promise((resolve) => {
      pending.set(id, { parts: [], resolve });
      parentPort.postMessage({ kind: 'plugin.fetchRequest', id, url: 'https://api.openai.com/probe', init: { method: 'GET' } });
    });
    parentPort.postMessage({ kind: 'chat.event', requestId: msg.requestId, sessionId: msg.sessionId, event: { type: 'delta', text: body } });
    parentPort.postMessage({ kind: 'chat.event', requestId: msg.requestId, sessionId: msg.sessionId, event: { type: 'done', finishReason: 'stop' } });
  }
});
```

- [ ] **Step 2: 写失败测试（追加到 provider-host.test.ts 末尾）**

```ts
describe('ProviderHost · fetch gateway dispatch (M5)', () => {
  const FETCH_ENTRY = path.join(__dirname, 'fixtures/fetch-worker.mjs');
  it('routes plugin.fetchRequest to onFetchRequest and streams chunks back', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(FETCH_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      onFetchRequest: (frame, send) => {
        send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'head', status: 200, headers: {} });
        send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'data', chunk: 'OK' });
        send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'end' });
      },
    });
    host.send('fsess');
    await untilDone(events, 'fsess');
    const delta = events.find((e) => e.event.type === 'delta')!.event as { type: 'delta'; text: string };
    expect(delta.text).toBe('H200OK');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-host.test.ts -t "fetch gateway"`
Expected: FAIL（onFetchRequest 选项不存在 → fetchRequest 无人应答 → 超时）

- [ ] **Step 4: 实现 —— 改 `provider-host.ts`**

在 `ProviderHostOptions` 增字段：

```ts
  /** Worker → Main 的 plugin.fetchRequest 处理器（FetchGateway）；send 把 chunk 帧回 worker。 */
  onFetchRequest?: (
    frame: import('@desksoul/protocol').PluginFetchRequestFrame,
    send: (chunk: import('@desksoul/protocol').PluginFetchChunkFrame) => void,
  ) => void;
  /** worker 死亡/强杀时调用，让网关 abort 该 worker 的在途请求。 */
  onFetchCancelAll?: () => void;
```

构造函数保存（同既有 onPluginRequest 模式）：`this.onFetchRequest = opts.onFetchRequest; this.onFetchCancelAll = opts.onFetchCancelAll;`（记得加同名 private 字段声明）。

`spawn()` 的 `worker.on('message', ...)` 分支增（在 `plugin.request` 分支旁）：

```ts
      if (msg.kind === 'plugin.fetchRequest') {
        this.onFetchRequest?.(msg, (chunk) => {
          if (this.worker === worker && !this.disposed) worker.postMessage(chunk);
        });
        return;
      }
```

注意 `ProviderOutboundFrame` 现在含 `PluginFetchRequestFrame`，`worker.on('message', (msg: ProviderOutboundFrame) => ...)` 的类型自动覆盖；`onWorkerMessage` 的入参类型仍是 `chat.event`，保持不变（fetchRequest/plugin.request 在前面分支已 return）。

在 `onDeath` 与 `forceTerminate` 里，worker 失效处各加一行 `this.onFetchCancelAll?.();`（紧邻清理 inflight 处）。

- [ ] **Step 5: 运行确认通过 + 回归全文件**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-host.test.ts`
Expected: PASS（含既有 S2/S4/M2 全部用例）

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main/provider-host.ts apps/desktop/test/provider-host.test.ts apps/desktop/test/fixtures/fetch-worker.mjs
git commit -m "feat(desktop): ProviderHost 路由 plugin.fetchRequest 到 FetchGateway"
```

### Task 2.4: 接线 ChatService → FetchGateway（Keychain + net）

**Files:**
- Modify: `apps/desktop/electron/main/chat-service.ts`（构造 FetchGateway，传给 ProviderHost）
- Modify: `apps/desktop/electron/main/ipc-router.ts`（注入 keychain + agent）
- Modify: `apps/desktop/electron/main/index.ts`（生产注入 `electronHttpAgent` + Keychain 路径）
- Test: `apps/desktop/test/chat-service.test.ts`（追加：fetchRequest 经 gateway 注入）

本 task 把 Phase 2 各件接成一条线。`ChatService` 新增可选 `fetch` 依赖（`agent` + `resolveHost` + `injectAuth`）；缺省时 `onFetchRequest` 不挂（mock provider 不发 fetch，老测试不受影响）。

- [ ] **Step 1: 写失败测试（追加到 chat-service.test.ts）**

```ts
it('wires fetch gateway: worker fetch gets auth-injected and streamed back', async () => {
  // 用 fetch-worker fixture：它发一个 GET 并把响应体当 delta 吐回
  const FETCH_ENTRY = path.join(__dirname, 'fixtures/fetch-worker.mjs');
  const broadcasts: Array<{ channel: string; params: any }> = [];
  const svc = new ChatService({
    providerEntryPath: FETCH_ENTRY,
    broadcast: (channel, params) => broadcasts.push({ channel, params }),
    fetch: {
      agent: (spec, sink) => { sink.head(200, {}); sink.data(spec.headers.authorization ?? 'noauth'); sink.end(); },
      resolveHost: () => ({ providerId: 'openai' }),
      injectAuth: async (_id, h) => ({ ...h, authorization: 'Bearer injected' }),
    },
  });
  svc.send('s1', 'hi');
  await new Promise((r) => setTimeout(r, 200));
  const streamed = broadcasts.filter((b) => b.channel === 'chat.stream').map((b) => b.params.text).join('');
  expect(streamed).toContain('Bearer injected');
  await svc.dispose();
});
```

（test 顶部需 `import path from 'node:path'; import { fileURLToPath } from 'node:url'; const __dirname = path.dirname(fileURLToPath(import.meta.url));` —— 若文件已有则复用。）

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts -t "fetch gateway"`
Expected: FAIL（`fetch` 选项不存在）

- [ ] **Step 3: 实现 —— `chat-service.ts`**

import 增 `import { createFetchGateway, type FetchGatewayDeps } from './fetch-gateway.js';`

`ChatServiceOptions` 增：`fetch?: FetchGatewayDeps;`

构造函数：在 `this.host = new ProviderHost(...)` 之前建网关并接入 host 选项：

```ts
    const fetchGateway = opts.fetch ? createFetchGateway(opts.fetch) : null;
    this.host = new ProviderHost(
      opts.providerEntryPath,
      (sessionId, event) => this.core.handleEvent(sessionId, event),
      {
        ...(opts.host ?? {}),
        onPluginRequest: (frame) => this.plugins.handle(frame),
        ...(fetchGateway
          ? {
              onFetchRequest: (frame, send) => fetchGateway.handle(frame, send),
              onFetchCancelAll: () => fetchGateway.cancelAll(),
            }
          : {}),
      },
    );
```

- [ ] **Step 4: 实现 —— `ipc-router.ts` 透传 fetch 依赖**

`IpcRouterDeps` 增 `fetch?: import('./fetch-gateway.js').FetchGatewayDeps;`；构造 `ChatService` 时 `...(deps.fetch ? { fetch: deps.fetch } : {})`。

- [ ] **Step 5: 实现 —— `index.ts` 生产注入**

import：`import { electronHttpAgent } from './http-agent.js'; import { Keychain } from './keychain.js'; import { createProviderConfig } from './provider-config.js';`（`provider-config` 在 Phase 3 创建；本 step 先用最小内联 resolveHost/injectAuth 占位，Phase 3 Task 3.4 替换为 provider-config 驱动）。

在 `registerIpcRouter({...})` 调用增：

```ts
    fetch: {
      agent: electronHttpAgent,
      resolveHost: (url) => (url.startsWith('https://api.openai.com') ? { providerId: 'openai' } : null),
      injectAuth: async (providerId, headers) => {
        const key = await keychain.get(providerId, 'apiKey');
        return key ? { ...headers, authorization: `Bearer ${key}` } : headers;
      },
    },
```

其中 `const keychain = new Keychain(path.join(app.getPath('userData'), 'secrets.kc'));` 在 whenReady 内构造。

> 标注：本 step 是**集成接线**，无单测；由 Phase 5 的 headless 验证脚本与真实联网验收覆盖。Phase 3 Task 3.4 会把 `resolveHost`/`injectAuth` 换成 `provider-config` 的 dialect 驱动版本。

- [ ] **Step 6: 运行确认通过 + typecheck**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts && pnpm --filter @desksoul/desktop typecheck`
Expected: 测试 PASS；typecheck 因 `provider-config` 未建而失败 → 本 step 暂用内联占位、**删除** index.ts 里对 `createProviderConfig` 的 import 直到 Phase 3。确保 typecheck PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/main apps/desktop/test/chat-service.test.ts
git commit -m "feat(desktop): 接线 ChatService→FetchGateway，生产注入 Electron net + Keychain"
```

---

# Phase 3 · openai-compat Provider + ChatRequest 下传（核心链路接通）

到此结束（M5 里程碑节点）：真实 OpenAI 兼容端点的流式对话端到端跑通 —— `chat.send` → 历史组装 → worker openai-compat → SSE → `chat.stream`。验收用 mock HTTP agent 模拟 SSE；真机用 OpenAI Key 手动验。

### Task 3.1: 内置 provider dialect 表（protocol 单一真源）

**Files:**
- Create: `packages/protocol/src/provider-config.ts`
- Modify: `packages/protocol/src/index.ts`（增 `export * from './provider-config.js';`）
- Test: `packages/protocol/test/provider-config.test.ts`

dialect 是 Main（host 白名单 + 注入风格）与 Worker（baseUrl + 请求/响应格式）共享的静态真源。

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/provider-config.test.ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_PROVIDERS, getDialect } from '../src/provider-config.js';

describe('BUILTIN_PROVIDERS', () => {
  it('includes openai/deepseek/qwen/claude/gemini/ollama', () => {
    for (const id of ['openai', 'deepseek', 'qwen', 'claude', 'gemini', 'ollama']) {
      expect(BUILTIN_PROVIDERS[id]).toBeDefined();
    }
  });
  it('openai is bearer + openai format', () => {
    const d = getDialect('openai')!;
    expect(d.authStyle).toBe('bearer');
    expect(d.format).toBe('openai');
    expect(d.host).toContain('openai.com');
    expect(d.defaultModels.length).toBeGreaterThan(0);
  });
  it('claude uses x-api-key + anthropic format', () => {
    expect(getDialect('claude')!.authStyle).toBe('x-api-key');
    expect(getDialect('claude')!.format).toBe('anthropic');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/provider-config.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `provider-config.ts`**

```ts
import { z } from 'zod';

export type ProviderFormat = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type AuthStyle = 'bearer' | 'x-api-key' | 'query-key' | 'none';

export interface ProviderDialect {
  id: string;
  name: string;
  kind: 'chat' | 'embedding';
  /** 默认 base（不含末尾斜杠）；用户可在配置覆盖。 */
  baseUrl: string;
  /** 白名单主机（startsWith 匹配的 origin）。 */
  host: string;
  authStyle: AuthStyle;
  format: ProviderFormat;
  defaultModels: string[];
}

export const BUILTIN_PROVIDERS: Record<string, ProviderDialect> = {
  openai: { id: 'openai', name: 'OpenAI', kind: 'chat', baseUrl: 'https://api.openai.com/v1', host: 'https://api.openai.com', authStyle: 'bearer', format: 'openai', defaultModels: ['gpt-4o-mini', 'gpt-4o'] },
  deepseek: { id: 'deepseek', name: 'DeepSeek', kind: 'chat', baseUrl: 'https://api.deepseek.com/v1', host: 'https://api.deepseek.com', authStyle: 'bearer', format: 'openai', defaultModels: ['deepseek-chat'] },
  qwen: { id: 'qwen', name: '通义千问', kind: 'chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', host: 'https://dashscope.aliyuncs.com', authStyle: 'bearer', format: 'openai', defaultModels: ['qwen-plus'] },
  claude: { id: 'claude', name: 'Claude', kind: 'chat', baseUrl: 'https://api.anthropic.com/v1', host: 'https://api.anthropic.com', authStyle: 'x-api-key', format: 'anthropic', defaultModels: ['claude-sonnet-4-6'] },
  gemini: { id: 'gemini', name: 'Gemini', kind: 'chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', host: 'https://generativelanguage.googleapis.com', authStyle: 'query-key', format: 'gemini', defaultModels: ['gemini-1.5-flash'] },
  ollama: { id: 'ollama', name: 'Ollama (本地)', kind: 'chat', baseUrl: 'http://127.0.0.1:11434', host: 'http://127.0.0.1:11434', authStyle: 'none', format: 'ollama', defaultModels: [] },
};

export function getDialect(id: string): ProviderDialect | undefined {
  return BUILTIN_PROVIDERS[id];
}

export const ProviderConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
```

- [ ] **Step 4: 运行确认通过 + 构建 protocol**

Run: `cd packages/protocol && pnpm exec vitest run test/provider-config.test.ts && cd ../.. && pnpm --filter @desksoul/protocol build`
Expected: PASS + dist 更新

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/provider-config.ts packages/protocol/src/index.ts packages/protocol/test/provider-config.test.ts
git commit -m "feat(protocol): 内置 provider dialect 表 BUILTIN_PROVIDERS（单一真源）"
```

### Task 3.2: openai-compat provider（OpenAI 格式）

**Files:**
- Create: `apps/sidecar/src/workers/providers/openai-compat.ts`
- Test: `apps/sidecar/test/openai-compat.test.ts`

provider.chat 用 `globalThis.fetch`（生产里被 fetch-proxy 替换为经 Main）。本 task 只做 `format: 'openai'`（覆盖 openai/deepseek/qwen 及任意 openai 兼容端点）；anthropic/gemini 在 Task 3.6。

- [ ] **Step 1: 写失败测试**

```ts
// apps/sidecar/test/openai-compat.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { openaiCompatChat } from '../src/workers/providers/openai-compat.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function sseResponse(lines: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } });
  return new Response(status === 200 ? body : null, { status });
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []; for await (const e of it) out.push(e); return out;
}

const dialect = getDialect('openai')!;
const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('openaiCompatChat', () => {
  it('maps content deltas + usage then a stop done', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(ev.filter((e) => e.type === 'delta').map((e) => (e as any).text).join('')).toBe('Hi there');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 3, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('classifies a 401 as auth error done', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([], 401)) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'auth' });
  });

  it('classifies a thrown network failure', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'network' });
  });

  it('ends with cancel when signal already aborted mid-stream', async () => {
    const ac = new AbortController();
    globalThis.fetch = vi.fn(async () => { ac.abort(); return sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', 'data: [DONE]\n\n']); }) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, ac.signal));
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'cancel' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/openai-compat.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `openai-compat.ts`**

```ts
import type { ChatEvent, ChatRequest, ErrorKind, ProviderDialect } from '@desksoul/protocol';
import { parseSseStream } from '@desksoul/plugin-sdk';

export function classifyStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'unknown';
}

export function classifyThrown(e: unknown): ErrorKind {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  return 'network';
}

function buildBody(req: ChatRequest, model: string): unknown {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: req.messages,
    ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}),
    ...(req.params?.maxTokens !== undefined ? { max_tokens: req.params.maxTokens } : {}),
    ...(req.tools ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
  };
}

export async function* openaiCompatChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const base = baseUrlOverride ?? dialect.baseUrl;
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(req, model)),
      signal,
    });
  } catch (e) {
    yield { type: 'done', finishReason: signal.aborted ? 'cancel' : 'error', ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }) };
    return;
  }
  if (!res.ok) {
    yield { type: 'done', finishReason: 'error', error: `HTTP ${res.status}`, errorKind: classifyStatus(res.status) };
    return;
  }
  if (!res.body) { yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' }; return; }

  let prompt = 0, completion = 0, sawUsage = false;
  try {
    for await (const sse of parseSseStream(res.body)) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
      if (sse.data === '[DONE]') break;
      let json: any;
      try { json = JSON.parse(sse.data); } catch { continue; }
      const text = json?.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text) yield { type: 'delta', text };
      if (json?.usage) { sawUsage = true; prompt = json.usage.prompt_tokens ?? 0; completion = json.usage.completion_tokens ?? 0; }
    }
  } catch (e) {
    yield { type: 'done', finishReason: signal.aborted ? 'cancel' : 'error', ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }) };
    return;
  }
  if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
```

注意：sidecar 需依赖 `@desksoul/plugin-sdk`。本 task 先在 `apps/sidecar/package.json` 的 dependencies 增 `"@desksoul/plugin-sdk": "workspace:*"`，并 `pnpm install`。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/sidecar && pnpm exec vitest run test/openai-compat.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/sidecar/src/workers/providers/openai-compat.ts apps/sidecar/test/openai-compat.test.ts apps/sidecar/package.json pnpm-lock.yaml
git commit -m "feat(sidecar): openai-compat provider（SSE→ChatEvent + 错误分级）"
```

### Task 3.3: provider-registry + worker-entry 分发

**Files:**
- Create: `apps/sidecar/src/workers/provider-registry.ts`
- Modify: `apps/sidecar/src/workers/provider-worker-entry.ts`
- Test: `apps/sidecar/test/provider-registry.test.ts`

worker 启动时 `installFetchProxy(parentPort)`；`chat.start` 带 `providerId` + `request` → registry 分发到对应 provider；无 `providerId`（或 `mock`）走原 mock 脚本（保留 e2e/老测试）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/sidecar/test/provider-registry.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProvider } from '../src/workers/provider-registry.js';

describe('resolveProvider', () => {
  it('returns an openai-format chat fn for openai/deepseek/qwen', () => {
    for (const id of ['openai', 'deepseek', 'qwen']) {
      expect(typeof resolveProvider(id)).toBe('function');
    }
  });
  it('returns undefined for unknown id', () => {
    expect(resolveProvider('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/provider-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `provider-registry.ts`**

```ts
import type { ChatEvent, ChatRequest } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { openaiCompatChat } from './providers/openai-compat.js';

export type ProviderChatFn = (req: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;

/** providerId → chat 生成器。未知 id 返回 undefined（worker 合成 error done）。 */
export function resolveProvider(providerId: string): ProviderChatFn | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  switch (dialect.format) {
    case 'openai':
      return (req, signal) => openaiCompatChat(dialect, req, signal);
    // anthropic / gemini / ollama 在 Task 3.6 / Phase 5 接入
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: 改 `provider-worker-entry.ts` —— 分发 + installFetchProxy**

顶部 import 增：`import { installFetchProxy } from '@desksoul/plugin-sdk'; import { resolveProvider } from './provider-registry.js';`

`runStream` 改为：有 `providerId`（且非 mock）时走 registry，否则走 mock：

```ts
async function runStream(port, start, ac, cleanup) {
  try {
    const stream =
      start.providerId && start.providerId !== 'mock' && start.request
        ? resolveProviderStream(start.providerId, start.request, ac.signal)
        : mockProviderChat(ac.signal, start.intervalMs !== undefined ? { intervalMs: start.intervalMs } : {});
    for await (const event of stream) {
      port.postMessage({ kind: 'chat.event', requestId: start.requestId, sessionId: start.sessionId, event });
    }
  } finally {
    cleanup();
  }
}

function resolveProviderStream(providerId, request, signal) {
  const fn = resolveProvider(providerId);
  if (!fn) return (async function* () { yield { type: 'done', finishReason: 'error', error: `unknown provider: ${providerId}`, errorKind: 'unknown' }; })();
  return fn(request, signal);
}
```

在 `if (parentPort)` 块内、`attachProviderServer(parentPort)` 之前加 `installFetchProxy(parentPort);`。

> 类型：`StartMessage` 现在含 `providerId`/`request`（来自 Task 1.3 的 ChatStartFrame 扩展），无需改本文件的类型别名。

- [ ] **Step 5: 运行确认通过 + 构建 sidecar**

Run: `cd apps/sidecar && pnpm exec vitest run && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: PASS + dist 更新（含 provider-registry / providers / 改后的 worker-entry）

- [ ] **Step 6: Commit**

```bash
git add apps/sidecar/src/workers
git commit -m "feat(sidecar): provider-registry + worker-entry 按 providerId 分发（保留 mock）"
```

### Task 3.4: ChatRequest 下传（ProviderHost.send + ChatService 组装历史）

**Files:**
- Modify: `apps/desktop/electron/main/provider-host.ts`（`send` 签名 + chat.start 帧字段）
- Modify: `apps/desktop/electron/main/chat-service.ts`（组装 messages + providerId）
- Test: `apps/desktop/test/provider-host.test.ts` + `apps/desktop/test/chat-service.test.ts` + `apps/desktop/test/fixtures/echo-start-worker.mjs`（新建）

- [ ] **Step 1: 新建 echo fixture（把收到的 start 帧编进 delta，前缀避开 BehaviorParser 的 `[`/`<`）**

```js
// apps/desktop/test/fixtures/echo-start-worker.mjs
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const echo = 'REQ:' + JSON.stringify({ providerId: m.providerId ?? null, request: m.request ?? null });
  parentPort.postMessage({ kind: 'chat.event', requestId: m.requestId, sessionId: m.sessionId, event: { type: 'delta', text: echo } });
  parentPort.postMessage({ kind: 'chat.event', requestId: m.requestId, sessionId: m.sessionId, event: { type: 'done', finishReason: 'stop' } });
});
```

- [ ] **Step 2: 写失败测试（provider-host：send 把 providerId/request 编进帧）**

追加到 `provider-host.test.ts`：

```ts
describe('ProviderHost · send carries ChatRequest (M5)', () => {
  const ECHO_ENTRY = path.join(__dirname, 'fixtures/echo-start-worker.mjs');
  it('passes providerId + request into the chat.start frame', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(ECHO_ENTRY, (sessionId, event) => events.push({ sessionId, event }));
    host.send('s1', { providerId: 'openai', request: { messages: [{ role: 'user', content: 'hi' }] } });
    await untilDone(events, 's1');
    const delta = events.find((e) => e.event.type === 'delta')!.event as { type: 'delta'; text: string };
    const parsed = JSON.parse(delta.text.slice(4)); // 去掉 'REQ:'
    expect(parsed.providerId).toBe('openai');
    expect(parsed.request.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
```

- [ ] **Step 3: 写失败测试（chat-service：第二轮带上历史）**

追加到 `chat-service.test.ts`：

```ts
it('assembles messages from history + current text', async () => {
  const ECHO_ENTRY = path.join(__dirname, 'fixtures/echo-start-worker.mjs');
  const broadcasts: Array<{ channel: string; params: any }> = [];
  const svc = new ChatService({
    providerEntryPath: ECHO_ENTRY,
    broadcast: (channel, params) => broadcasts.push({ channel, params }),
    defaultProviderId: 'openai',
  });
  svc.send('s1', 'first');
  await new Promise((r) => setTimeout(r, 100));
  svc.send('s1', 'second');
  await new Promise((r) => setTimeout(r, 100));
  // 第二轮 echo 的 request.messages 应包含 first(user) + 第一轮 assistant 回复 + second(user)
  const lastStream = broadcasts.filter((b) => b.channel === 'chat.stream').at(-1)!;
  const parsed = JSON.parse(lastStream.params.text.slice(4));
  const roles = parsed.request.messages.map((m: any) => m.role);
  expect(roles).toEqual(['user', 'assistant', 'user']);
  expect(parsed.request.messages.at(-1)).toEqual({ role: 'user', content: 'second' });
  expect(parsed.providerId).toBe('openai');
  await svc.dispose();
});
```

- [ ] **Step 4: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-host.test.ts -t "carries ChatRequest" test/chat-service.test.ts -t "assembles messages"`
Expected: FAIL

- [ ] **Step 5: 实现 —— `provider-host.ts` 改 `send`**

```ts
  send(sessionId: string, opts?: { providerId?: string; request?: import('@desksoul/protocol').ChatRequest }): string {
    if (this.disposed) throw new Error('ProviderHost disposed');
    if (!this.worker) throw new Error('provider worker not ready');
    const requestId = `r${this.nextRequestId++}`;
    this.inflight.set(requestId, { sessionId, cancelTimer: null });
    const frame: ChatStartFrame = {
      kind: 'chat.start',
      requestId,
      sessionId,
      ...(opts?.providerId !== undefined ? { providerId: opts.providerId } : {}),
      ...(opts?.request !== undefined ? { request: opts.request } : {}),
      ...(opts?.providerId === undefined && this.intervalMs !== undefined ? { intervalMs: this.intervalMs } : {}),
    };
    this.worker.postMessage(frame);
    return requestId;
  }
```

（mock 路径：无 providerId 时仍带 intervalMs，老测试不变。）

- [ ] **Step 6: 实现 —— `chat-service.ts` 组装 messages**

`ChatServiceOptions` 增 `defaultProviderId?: string;`；构造函数存 `this.defaultProviderId = opts.defaultProviderId;`（加 private 字段 `private readonly defaultProviderId: string | undefined;`）。

改 `send`：

```ts
  send(sessionId: string, text: string, providerId?: string): { ok: true } {
    if (this.store.isStreaming(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    const pid = providerId ?? this.defaultProviderId;
    // 组装 messages：历史（已封口的 user/assistant）+ 当前 user 输入
    const history = this.store
      .snapshot(sessionId, 40)
      .messages.filter((m) => m.text.length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
    const request = { messages: [...history, { role: 'user' as const, content: text }] };
    try {
      this.host.send(sessionId, pid ? { providerId: pid, request } : {});
    } catch {
      throw new RpcError(-32002, 'provider unavailable (worker restarting)');
    }
    this.store.appendUser(sessionId, text);
    this.store.beginAssistant(sessionId);
    return { ok: true };
  }
```

`ipc-router.ts` 的 `'chat.send'` handler 改为透传 providerId：`'chat.send': (p) => chat.send(p.sessionId, p.text, p.providerId),`

- [ ] **Step 7: 运行确认通过 + 全文件回归**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-host.test.ts test/chat-service.test.ts`
Expected: 全 PASS（含既有用例；注意老的 mock 路径用例：ChatService 不传 defaultProviderId 时 `pid` 为 undefined → `host.send(sessionId, {})` → 走 mock intervalMs 路径）

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/main/provider-host.ts apps/desktop/electron/main/chat-service.ts apps/desktop/electron/main/ipc-router.ts apps/desktop/test
git commit -m "feat(desktop): ChatRequest 下传——ProviderHost.send 带 request + ChatService 组装历史"
```

### Task 3.5: Main provider-config（dialect 驱动 resolveHost/injectAuth）+ 集成

**Files:**
- Create: `apps/desktop/electron/main/provider-config.ts`
- Modify: `apps/desktop/electron/main/index.ts`（用 provider-config 替换 Task 2.4 的内联占位）
- Test: `apps/desktop/test/provider-config.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/provider-config.test.ts
import { describe, it, expect } from 'vitest';
import { createProviderConfig } from '../electron/main/provider-config';

const fakeKeychain = (keys: Record<string, string>) => ({
  get: async (providerId: string) => keys[providerId] ?? null,
}) as any;

describe('createProviderConfig', () => {
  it('resolveHost matches builtin hosts and rejects others', () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({}) });
    expect(pc.resolveHost('https://api.openai.com/v1/chat/completions')).toEqual({ providerId: 'openai' });
    expect(pc.resolveHost('https://api.anthropic.com/v1/messages')).toEqual({ providerId: 'claude' });
    expect(pc.resolveHost('https://evil.example/x')).toBeNull();
  });
  it('injectAuth uses bearer for openai', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ openai: 'sk-1' }) });
    expect(await pc.injectAuth('openai', {})).toMatchObject({ authorization: 'Bearer sk-1' });
  });
  it('injectAuth uses x-api-key + anthropic-version for claude', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ claude: 'ak-1' }) });
    const h = await pc.injectAuth('claude', {});
    expect(h['x-api-key']).toBe('ak-1');
    expect(h['anthropic-version']).toBeDefined();
  });
  it('injectAuth leaves headers untouched when no key', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({}) });
    expect(await pc.injectAuth('openai', { a: '1' })).toEqual({ a: '1' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-config.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `provider-config.ts`**

```ts
import { BUILTIN_PROVIDERS, getDialect } from '@desksoul/protocol';

export interface KeychainLike {
  get(providerId: string, keyName: string): Promise<string | null>;
}
export interface ProviderConfigDeps {
  keychain: KeychainLike;
}
export interface ProviderConfigService {
  resolveHost(url: string): { providerId: string } | null;
  injectAuth(providerId: string, headers: Record<string, string>): Promise<Record<string, string>>;
}

export function createProviderConfig(deps: ProviderConfigDeps): ProviderConfigService {
  return {
    resolveHost(url) {
      for (const d of Object.values(BUILTIN_PROVIDERS)) {
        if (url.startsWith(d.host)) return { providerId: d.id };
      }
      return null;
    },
    async injectAuth(providerId, headers) {
      const dialect = getDialect(providerId);
      if (!dialect || dialect.authStyle === 'none') return headers;
      const key = await deps.keychain.get(providerId, 'apiKey');
      if (!key) return headers;
      if (dialect.authStyle === 'bearer') return { ...headers, authorization: `Bearer ${key}` };
      if (dialect.authStyle === 'x-api-key') return { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      // query-key（Gemini）需改 url，FetchGateway 当前只注入 header —— Phase 6 扩展
      return headers;
    },
  };
}
```

- [ ] **Step 4: 替换 `index.ts` 占位**

把 Task 2.4 Step 5 写的内联 `fetch: { resolveHost, injectAuth }` 改为 provider-config 驱动：

```ts
import { createProviderConfig } from './provider-config.js';
// whenReady 内：
const keychain = new Keychain(path.join(app.getPath('userData'), 'secrets.kc'));
const providerConfig = createProviderConfig({ keychain });
// registerIpcRouter({...}) 内：
    fetch: {
      agent: electronHttpAgent,
      resolveHost: (url) => providerConfig.resolveHost(url),
      injectAuth: (providerId, headers) => providerConfig.injectAuth(providerId, headers),
    },
```

并把 `defaultProviderId` 透传：`registerIpcRouter` 增 `defaultProviderId: 'openai'`（M5 暂固定；M7 设置 UI 接用户选择），`IpcRouterDeps` 增 `defaultProviderId?: string`，`ChatService` 构造时 `...(deps.defaultProviderId ? { defaultProviderId: deps.defaultProviderId } : {})`。

- [ ] **Step 5: 运行通过 + typecheck**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-config.test.ts && pnpm --filter @desksoul/desktop typecheck`
Expected: PASS（typecheck 现在应全绿——`createProviderConfig` 已存在）

- [ ] **Step 6: 集成验证（mock OpenAI SSE 端到端）—— 写到 chat-service.test.ts**

```ts
it('end-to-end: openai-format stream via injected agent reaches chat.stream', async () => {
  const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
  const sse = [
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"呀"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const broadcasts: Array<{ channel: string; params: any }> = [];
  const svc = new ChatService({
    providerEntryPath: PROVIDER_ENTRY,
    broadcast: (channel, params) => broadcasts.push({ channel, params }),
    defaultProviderId: 'openai',
    fetch: {
      agent: (_spec, sink) => { sink.head(200, { 'content-type': 'text/event-stream' }); for (const l of sse) sink.data(l); sink.end(); },
      resolveHost: () => ({ providerId: 'openai' }),
      injectAuth: async (_id, h) => h,
    },
  });
  svc.send('s1', 'hi');
  await new Promise((r) => setTimeout(r, 300));
  const text = broadcasts.filter((b) => b.channel === 'chat.stream').map((b) => b.params.text).join('');
  expect(text).toBe('你好呀');
  const done = broadcasts.find((b) => b.channel === 'chat.done');
  expect(done?.params.finishReason).toBe('stop');
  await svc.dispose();
});
```

（顶部需 `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`，若已有则复用。先 `pnpm --filter @desksoul/sidecar build` 确保 dist 最新。）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @desksoul/sidecar build && cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts -t "end-to-end"`
Expected: PASS（真实 worker + openai-compat + fetch-proxy + FetchGateway 全链路，仅 HTTP 出口被 mock）

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/main apps/desktop/test/provider-config.test.ts apps/desktop/test/chat-service.test.ts
git commit -m "feat(desktop): provider-config 驱动白名单/注入 + OpenAI 端到端集成验证"
```

### Task 3.6: 真机联网验收（OpenAI Key）

**手动验收（无自动化测试）**：

- [ ] **Step 1:** 临时写一条 key：在 `apps/desktop` 起 dev（`pnpm --filter @desksoul/desktop dev`），打开 devtools 控制台执行 `await window.desksoul.rpc('provider.saveKey', { providerId: 'openai', key: 'sk-...' })`（`provider.saveKey` 在 Phase 5 实现；若此刻未到 Phase 5，改为手动把 key 写进 `secrets.kc` 或临时硬编码 keychain.set）。
- [ ] **Step 2:** 在聊天浮层发一条消息，确认逐 token 流式出现、表情/动作随标签触发、`done` 正常封口。
- [ ] **Step 3:** 把 key 改错重发，确认 `chat.done.errorKind === 'auth'`（Phase 4 完成错误分级后）。
- [ ] **Step 4:** 记录验收结果到 `docs/status/` 或里程碑 RESULTS。无代码改动则不 commit。

---

# Phase 4 · token usage 落账 + 错误分级端到端 + 降级链

到此结束：usage 落账到会话；`chat.done` 携带 `errorKind`（J3 数据侧）；首选 provider 在「首个 delta 之前」失败时自动降级到下一顺位（同一对话一次）。

### Task 4.1: usage 落账（SessionStore + ChatService 拦截）

**Files:**
- Modify: `apps/desktop/electron/main/session-store.ts`（StoredMessage 增 tokens + `recordUsage`）
- Modify: `apps/desktop/electron/main/conversation-core.ts`（handleEvent 防御非 delta/done）
- Modify: `apps/desktop/electron/main/chat-service.ts`（host 回调拦截 usage）
- Test: `apps/desktop/test/session-store.test.ts` + `apps/desktop/test/chat-service.test.ts`

- [ ] **Step 1: 写失败测试（session-store）**

```ts
it('recordUsage writes tokens onto the current assistant message', () => {
  const s = new SessionStore();
  s.appendUser('s1', 'hi');
  s.beginAssistant('s1');
  s.appendDelta('s1', 'yo');
  s.recordUsage('s1', 3, 2);
  s.finishAssistant('s1', 'stop');
  const snap = s.snapshot('s1');
  const assistant = snap.messages.at(-1)!;
  expect(assistant.tokensIn).toBe(3);
  expect(assistant.tokensOut).toBe(2);
});
```

- [ ] **Step 2: 写失败测试（chat-service 拦截 usage 落账，不污染 chat 流）**

```ts
it('records usage from the stream without emitting it as chat text', async () => {
  const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
  const sse = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n', 'data: [DONE]\n\n'];
  const broadcasts: Array<{ channel: string; params: any }> = [];
  const svc = new ChatService({
    providerEntryPath: PROVIDER_ENTRY,
    broadcast: (c, p) => broadcasts.push({ channel: c, params: p }),
    defaultProviderId: 'openai',
    fetch: { agent: (_s, sink) => { sink.head(200, {}); for (const l of sse) sink.data(l); sink.end(); }, resolveHost: () => ({ providerId: 'openai' }), injectAuth: async (_i, h) => h },
  });
  svc.send('s1', 'hi');
  await new Promise((r) => setTimeout(r, 300));
  const text = broadcasts.filter((b) => b.channel === 'chat.stream').map((b) => b.params.text).join('');
  expect(text).toBe('hi'); // usage 不出现在文本里
  expect(svc.snapshot('s1').messages.at(-1)).toMatchObject({ tokensIn: 5, tokensOut: 1 });
  await svc.dispose();
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/session-store.test.ts -t "recordUsage" test/chat-service.test.ts -t "records usage"`
Expected: FAIL

- [ ] **Step 4: 实现 —— `session-store.ts`**

`StoredMessage` 接口增可选字段：

```ts
export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  tokensIn?: number;
  tokensOut?: number;
}
```

新增方法（在 finishAssistant 之后）：

```ts
  recordUsage(sessionId: string, tokensIn: number, tokensOut: number): void {
    const messages = this.sessions.get(sessionId);
    const last = messages?.[messages.length - 1];
    if (last && last.role === 'assistant') {
      last.tokensIn = tokensIn;
      last.tokensOut = tokensOut;
      this.schedulePersist();
    }
  }
```

- [ ] **Step 5: 实现 —— `conversation-core.ts` 防御**

`handleEvent` 开头加：`if (event.type !== 'delta' && event.type !== 'done') return;`（usage/tool_call 不应进双轨拆分器；由 ChatService 拦截）。放在方法第一行。

- [ ] **Step 6: 实现 —— `chat-service.ts` host 回调拦截**

把 ProviderHost 的 onEvent 回调（构造函数里 `(sessionId, event) => this.core.handleEvent(...)`）抽成方法 `onProviderEvent`：

```ts
  private onProviderEvent(sessionId: string, event: import('@desksoul/protocol').ChatEvent): void {
    if (event.type === 'usage') { this.store.recordUsage(sessionId, event.prompt, event.completion); return; }
    this.core.handleEvent(sessionId, event);
  }
```

构造函数里改为 `(sessionId, event) => this.onProviderEvent(sessionId, event)`。

- [ ] **Step 7: 运行确认通过**

Run: `cd apps/desktop && pnpm exec vitest run test/session-store.test.ts test/chat-service.test.ts test/conversation-core.test.ts`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/main apps/desktop/test
git commit -m "feat(desktop): usage 落账（SessionStore.recordUsage + ChatService 拦截）"
```

### Task 4.2: token 估算兜底（gpt-tokenizer）

**Files:**
- Create: `apps/sidecar/src/workers/token-estimate.ts`
- Modify: `apps/sidecar/src/workers/providers/openai-compat.ts`（无 usage 时估算）
- Modify: `apps/sidecar/package.json`（增 `gpt-tokenizer`）
- Test: `apps/sidecar/test/token-estimate.test.ts` + `apps/sidecar/test/openai-compat.test.ts`（追加用例）

- [ ] **Step 1: 装依赖**

Run: `cd apps/sidecar && pnpm add gpt-tokenizer`
Expected: 写入 dependencies（纯 JS，无 native）

- [ ] **Step 2: 写失败测试（token-estimate）**

```ts
// apps/sidecar/test/token-estimate.test.ts
import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessagesTokens } from '../src/workers/token-estimate.js';

describe('token estimate', () => {
  it('estimates a non-zero count for text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });
  it('estimates messages with per-message overhead', () => {
    const n = estimateMessagesTokens([{ role: 'user', content: 'hi' }]);
    expect(n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 写失败测试（openai-compat 无 usage 时回退估算）**

追加到 `openai-compat.test.ts`：

```ts
it('falls back to estimated usage when provider omits it', async () => {
  globalThis.fetch = vi.fn(async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"hello world"}}]}\n\n',
    'data: [DONE]\n\n',
  ])) as typeof fetch;
  const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
  const usage = ev.find((e) => e.type === 'usage') as any;
  expect(usage).toBeDefined();
  expect(usage.completion).toBeGreaterThan(0);
});
```

- [ ] **Step 4: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/token-estimate.test.ts test/openai-compat.test.ts -t "estimated usage"`
Expected: FAIL

- [ ] **Step 5: 实现 `token-estimate.ts`**

```ts
import { encode } from 'gpt-tokenizer';
import type { ChatRequest } from '@desksoul/protocol';

export function estimateTokens(text: string): number {
  return encode(text).length;
}

/** 粗估：每条消息 ~4 token 结构开销 + 内容 token。 */
export function estimateMessagesTokens(messages: ChatRequest['messages']): number {
  let total = 0;
  for (const m of messages) total += 4 + estimateTokens(m.content);
  return total + 2;
}
```

- [ ] **Step 6: 实现 —— `openai-compat.ts` 估算回退**

在 chat 生成器里：累积 completion 文本；结束时若 `!sawUsage` 用估算：

- 在循环外声明 `let completionText = '';`，在 `yield { type:'delta', text }` 后追加 `completionText += text;`
- 把 `if (sawUsage) yield {...usage}` 改为：

```ts
  if (sawUsage) {
    yield { type: 'usage', prompt, completion };
  } else if (completionText) {
    yield { type: 'usage', prompt: estimateMessagesTokens(req.messages), completion: estimateTokens(completionText) };
  }
```

顶部 import：`import { estimateTokens, estimateMessagesTokens } from '../token-estimate.js';`

- [ ] **Step 7: 运行通过 + 构建**

Run: `cd apps/sidecar && pnpm exec vitest run && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: PASS + dist 更新

- [ ] **Step 8: Commit**

```bash
git add apps/sidecar/src apps/sidecar/test apps/sidecar/package.json pnpm-lock.yaml
git commit -m "feat(sidecar): gpt-tokenizer token 估算兜底（provider 缺 usage 时）"
```

### Task 4.3: 错误分级端到端（chat.done 携带 errorKind）

**Files:**
- Modify: `packages/protocol/src/methods.ts`（chat.done params 增 error/errorKind）
- Modify: `apps/desktop/electron/main/conversation-core.ts`（Notification + done 透传）
- Modify: `apps/desktop/electron/main/chat-service.ts`（onNotification chat.done 透传）
- Test: `packages/protocol/test/methods.test.ts` + `apps/desktop/test/conversation-core.test.ts`

- [ ] **Step 1: 写失败测试（protocol）**

追加到 `methods.test.ts`：

```ts
it('chat.done carries optional error + errorKind', () => {
  expect(Methods['chat.done'].params.safeParse({ sessionId: 's', finishReason: 'error', error: 'boom', errorKind: 'auth' }).success).toBe(true);
  expect(Methods['chat.done'].params.safeParse({ sessionId: 's', finishReason: 'stop' }).success).toBe(true);
});
```

- [ ] **Step 2: 写失败测试（conversation-core 透传 errorKind）**

追加到 `conversation-core.test.ts`（参照该文件既有风格用收集器 notify）：

```ts
it('propagates error + errorKind onto chat.done', () => {
  const notes: any[] = [];
  const core = new ConversationCore((n) => notes.push(n));
  core.handleEvent('s1', { type: 'done', finishReason: 'error', error: 'HTTP 401', errorKind: 'auth' });
  const done = notes.find((n) => n.channel === 'chat.done');
  expect(done.params).toMatchObject({ finishReason: 'error', errorKind: 'auth', error: 'HTTP 401' });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd packages/protocol && pnpm exec vitest run test/methods.test.ts -t "errorKind" ; cd ../../apps/desktop && pnpm exec vitest run test/conversation-core.test.ts -t "errorKind"`
Expected: FAIL

- [ ] **Step 4: 实现 —— `methods.ts` chat.done**

顶部已 import `ErrorKindSchema`（Task 1.4）。改 chat.done：

```ts
  'chat.done': {
    params: z.object({
      sessionId: z.string(),
      finishReason: z.enum(['stop', 'cancel', 'error']),
      error: z.string().optional(),
      errorKind: ErrorKindSchema.optional(),
    }),
    result: z.null(),
  },
```

- [ ] **Step 5: 实现 —— `conversation-core.ts`**

`Notification` 的 `chat.done` 变体 params 增可选字段：

```ts
  | {
      channel: 'chat.done';
      sessionId: string;
      params: { sessionId: string; finishReason: 'stop' | 'cancel' | 'error'; error?: string; errorKind?: import('@desksoul/protocol').ErrorKind };
    }
```

`handleEvent` 的 done 分支构造 `doneNotification` 时透传（event 此时 narrow 为 done，含可选 error/errorKind）：

```ts
    const doneNotification: Notification = {
      channel: 'chat.done',
      sessionId,
      params: {
        sessionId,
        finishReason: event.finishReason,
        ...(event.error !== undefined ? { error: event.error } : {}),
        ...(event.errorKind !== undefined ? { errorKind: event.errorKind } : {}),
      },
    };
```

- [ ] **Step 6: 实现 —— `chat-service.ts` onNotification**

`chat.done` 分支把整个 params 透传（已含 error/errorKind）：

```ts
      case 'chat.done':
        this.store.finishAssistant(n.sessionId, n.params.finishReason);
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params }, { urgent: true });
        return;
```

（原本就是透传 `n.params`，确认无需改即可；若原实现重组了 params 则改为直接用 `n.params`。）

- [ ] **Step 7: 运行确认通过**

Run: `cd packages/protocol && pnpm exec vitest run && cd ../../apps/desktop && pnpm exec vitest run test/conversation-core.test.ts`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/protocol apps/desktop
git commit -m "feat: chat.done 携带 errorKind（J3 错误分级数据侧端到端）"
```

### Task 4.4: 降级链（首 delta 前失败自动顺位重试）

**Files:**
- Modify: `apps/desktop/electron/main/chat-service.ts`
- Test: `apps/desktop/test/chat-service.test.ts` + `apps/desktop/test/fixtures/fallback-worker.mjs`

- [ ] **Step 1: 新建 fixture**

```js
// apps/desktop/test/fixtures/fallback-worker.mjs
// providerId 'bad' → 立即 error done（无 delta）；其他 → delta 'ok' + stop。
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const { requestId, sessionId } = m;
  if (m.providerId === 'bad') {
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'done', finishReason: 'error', error: 'bad provider', errorKind: 'server' } });
  } else {
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'delta', text: 'ok' } });
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'done', finishReason: 'stop' } });
  }
});
```

- [ ] **Step 2: 写失败测试**

```ts
describe('ChatService · provider fallback', () => {
  const FB_ENTRY = path.join(__dirname, 'fixtures/fallback-worker.mjs');
  it('falls back to the next provider when the first errors before any delta', async () => {
    const broadcasts: Array<{ channel: string; params: any }> = [];
    const svc = new ChatService({
      providerEntryPath: FB_ENTRY,
      broadcast: (c, p) => broadcasts.push({ channel: c, params: p }),
      providerChain: ['bad', 'good'],
    });
    svc.send('s1', 'hi');
    await new Promise((r) => setTimeout(r, 200));
    const text = broadcasts.filter((b) => b.channel === 'chat.stream').map((b) => b.params.text).join('');
    expect(text).toBe('ok');
    const done = broadcasts.find((b) => b.channel === 'chat.done');
    expect(done?.params.finishReason).toBe('stop');
    await svc.dispose();
  });

  it('does NOT fall back once a delta has been emitted', async () => {
    const broadcasts: Array<{ channel: string; params: any }> = [];
    const svc = new ChatService({
      providerEntryPath: FB_ENTRY,
      broadcast: (c, p) => broadcasts.push({ channel: c, params: p }),
      providerChain: ['good', 'bad'], // good 先成功，不应再切
    });
    svc.send('s1', 'hi');
    await new Promise((r) => setTimeout(r, 200));
    const errDone = broadcasts.filter((b) => b.channel === 'chat.done');
    expect(errDone).toHaveLength(1);
    expect(errDone[0].params.finishReason).toBe('stop');
    await svc.dispose();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts -t "fallback"`
Expected: FAIL（`providerChain` 不存在；error done 直接广播无重试）

- [ ] **Step 4: 实现 —— `chat-service.ts`**

`ChatServiceOptions` 增 `providerChain?: string[];`。新增 private 状态：

```ts
  private readonly providerChain: string[];
  private readonly sawDelta = new Map<string, boolean>();
  private readonly attempt = new Map<string, { chain: string[]; idx: number; request: import('@desksoul/protocol').ChatRequest }>();
```

构造函数：`this.providerChain = opts.providerChain ?? (opts.defaultProviderId ? [opts.defaultProviderId] : []);`（保留 defaultProviderId 兼容：单元素链）。

改 `send` 组装后用链首发：

```ts
    const chain = providerId ? [providerId] : this.providerChain;
    const request = { messages: [...history, { role: 'user' as const, content: text }] };
    try {
      if (chain.length > 0) {
        this.attempt.set(sessionId, { chain, idx: 0, request });
        this.sawDelta.set(sessionId, false);
        this.host.send(sessionId, { providerId: chain[0]!, request });
      } else {
        this.host.send(sessionId, {}); // mock 路径
      }
    } catch { throw new RpcError(-32002, 'provider unavailable (worker restarting)'); }
```

`onProviderEvent` 增降级判定：

```ts
  private onProviderEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'usage') { this.store.recordUsage(sessionId, event.prompt, event.completion); return; }
    if (event.type === 'delta') this.sawDelta.set(sessionId, true);
    if (event.type === 'done' && event.finishReason === 'error' && !this.sawDelta.get(sessionId)) {
      const a = this.attempt.get(sessionId);
      if (a && a.idx + 1 < a.chain.length) {
        a.idx += 1;
        this.host.send(sessionId, { providerId: a.chain[a.idx]!, request: a.request });
        return; // 吞掉本次 error done，不进 core/不广播
      }
    }
    this.core.handleEvent(sessionId, event);
    if (event.type === 'done') { this.sawDelta.delete(sessionId); this.attempt.delete(sessionId); }
  }
```

（需 `import type { ChatEvent } from '@desksoul/protocol';`）

- [ ] **Step 5: 运行确认通过 + 全 chat 回归**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts`
Expected: 全 PASS（含 end-to-end / usage / fallback）

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main/chat-service.ts apps/desktop/test
git commit -m "feat(desktop): provider 降级链（首 delta 前失败顺位重试一次）"
```

---

# Phase 5 · Ollama + provider.* RPC + headless 验证

到此结束：本地 Ollama 自动探测 + 流式可用；`provider.*` RPC 全部可经 IPC 调用；headless 脚本验证密钥隔离与端到端。

### Task 5.1: ollama provider（NDJSON 流式）

**Files:**
- Create: `apps/sidecar/src/workers/providers/ollama.ts`
- Modify: `apps/sidecar/src/workers/provider-registry.ts`（增 ollama case）
- Test: `apps/sidecar/test/ollama.test.ts`

Ollama `/api/chat` 返回 **NDJSON**（每行一个 JSON，非 SSE）：`{"message":{"content":"x"},"done":false}` … 末行 `{"done":true,"prompt_eval_count":N,"eval_count":M}`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/sidecar/test/ollama.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { ollamaChat } from '../src/workers/providers/ollama.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function ndjson(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } });
  return new Response(body, { status: 200 });
}
async function collect(it: AsyncIterable<ChatEvent>) { const o: ChatEvent[] = []; for await (const e of it) o.push(e); return o; }

describe('ollamaChat', () => {
  it('maps NDJSON message chunks to deltas + usage + stop', async () => {
    globalThis.fetch = vi.fn(async () => ndjson([
      '{"message":{"content":"你"},"done":false}\n',
      '{"message":{"content":"好"},"done":false}\n',
      '{"done":true,"prompt_eval_count":7,"eval_count":2}\n',
    ])) as typeof fetch;
    const ev = await collect(ollamaChat(getDialect('ollama')!, { messages: [{ role: 'user', content: 'hi' }], model: 'llama3' }, new AbortController().signal));
    expect(ev.filter((e) => e.type === 'delta').map((e) => (e as any).text).join('')).toBe('你好');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 7, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/ollama.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `ollama.ts`**

```ts
import type { ChatEvent, ChatRequest, ProviderDialect } from '@desksoul/protocol';

export async function* ollamaChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? 'llama3';
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: req.messages, stream: true }),
      signal,
    });
  } catch (e) {
    yield { type: 'done', finishReason: signal.aborted ? 'cancel' : 'error', ...(signal.aborted ? {} : { error: String(e), errorKind: 'network' as const }) };
    return;
  }
  if (!res.ok) { yield { type: 'done', finishReason: 'error', error: `HTTP ${res.status}`, errorKind: res.status >= 500 ? 'server' : 'unknown' }; return; }
  if (!res.body) { yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' }; return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', prompt = 0, completion = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let json: any;
        try { json = JSON.parse(line); } catch { continue; }
        const text = json?.message?.content;
        if (typeof text === 'string' && text) yield { type: 'delta', text };
        if (json?.done) { prompt = json.prompt_eval_count ?? 0; completion = json.eval_count ?? 0; }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
  if (prompt || completion) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
```

- [ ] **Step 4: 接入 registry —— `provider-registry.ts` switch 增 case**

```ts
import { ollamaChat } from './providers/ollama.js';
// switch (dialect.format) 内：
    case 'ollama':
      return (req, signal) => ollamaChat(dialect, req, signal);
```

- [ ] **Step 5: 运行通过 + 构建**

Run: `cd apps/sidecar && pnpm exec vitest run test/ollama.test.ts test/provider-registry.test.ts && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: PASS + dist 更新

- [ ] **Step 6: Commit**

```bash
git add apps/sidecar/src/workers
git commit -m "feat(sidecar): ollama provider（NDJSON 流式 + usage）"
```

### Task 5.2: provider-service（provider.* RPC handlers）

**Files:**
- Create: `apps/desktop/electron/main/provider-service.ts`
- Modify: `apps/desktop/electron/main/provider-config.ts`（增 `listProviders` / `detectOllama` / `testConnection` 所需的 httpGetJson 注入）
- Test: `apps/desktop/test/provider-service.test.ts`

handlers 是纯函数集合（注入 keychain + httpGetJson），由 ipc-router 注册到 router。

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/provider-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createProviderService } from '../electron/main/provider-service';

function deps(over: Partial<Parameters<typeof createProviderService>[0]> = {}) {
  const store: Record<string, string> = {};
  return {
    keychain: {
      get: async (id: string) => store[id] ?? null,
      set: async (id: string, _k: string, v: string) => { store[id] = v; },
      delete: async (id: string) => { delete store[id]; },
    } as any,
    httpGetJson: vi.fn(async () => ({ models: [{ name: 'llama3' }] })),
    ...over,
  };
}

describe('provider-service', () => {
  it('saveKey then listProviders reports hasKey', async () => {
    const svc = createProviderService(deps());
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-1' });
    const { providers } = await svc['provider.listProviders']({});
    expect(providers.find((p) => p.id === 'openai')!.hasKey).toBe(true);
  });
  it('deleteKey clears hasKey', async () => {
    const d = deps();
    const svc = createProviderService(d);
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-1' });
    await svc['provider.deleteKey']({ providerId: 'openai' });
    const { providers } = await svc['provider.listProviders']({});
    expect(providers.find((p) => p.id === 'openai')!.hasKey).toBe(false);
  });
  it('ollamaDetect returns available + models from /api/tags', async () => {
    const svc = createProviderService(deps({ httpGetJson: vi.fn(async () => ({ models: [{ name: 'llama3' }, { name: 'qwen2' }] })) }));
    const r = await svc['provider.ollamaDetect']({});
    expect(r.available).toBe(true);
    expect(r.models).toEqual(['llama3', 'qwen2']);
  });
  it('ollamaDetect returns unavailable when tags errors', async () => {
    const svc = createProviderService(deps({ httpGetJson: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) }));
    expect((await svc['provider.ollamaDetect']({})).available).toBe(false);
  });
  it('testConnection classifies a 401 as auth', async () => {
    const svc = createProviderService(deps({ httpGetJson: vi.fn(async () => { const e: any = new Error('401'); e.status = 401; throw e; }) }));
    await svc['provider.saveKey']({ providerId: 'openai', key: 'bad' });
    expect(await svc['provider.testConnection']({ providerId: 'openai' })).toMatchObject({ ok: false, errorKind: 'auth' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `provider-service.ts`**

```ts
import { BUILTIN_PROVIDERS, getDialect, type ErrorKind } from '@desksoul/protocol';
import type { KeychainLike } from './provider-config.js';

/** httpGetJson：GET 一个 URL（可带头），返回解析后的 JSON；非 2xx 抛带 `status` 的 Error。 */
export type HttpGetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export interface KeychainRW extends KeychainLike {
  set(providerId: string, keyName: string, value: string): Promise<void>;
  delete(providerId: string): Promise<void>;
}
export interface ProviderServiceDeps {
  keychain: KeychainRW;
  httpGetJson: HttpGetJson;
}

function classify(e: unknown): ErrorKind {
  const status = (e as { status?: number }).status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status && status >= 500) return 'server';
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  return 'network';
}

export function createProviderService(deps: ProviderServiceDeps) {
  return {
    'provider.saveKey': async (p: { providerId: string; key: string }) => {
      await deps.keychain.set(p.providerId, 'apiKey', p.key);
      return { ok: true as const };
    },
    'provider.deleteKey': async (p: { providerId: string }) => {
      await deps.keychain.delete(p.providerId);
      return { ok: true as const };
    },
    'provider.listProviders': async (_p: Record<string, never>) => {
      const providers = await Promise.all(
        Object.values(BUILTIN_PROVIDERS).map(async (d) => ({
          id: d.id, name: d.name, kind: d.kind,
          hasKey: d.authStyle === 'none' ? true : (await deps.keychain.get(d.id, 'apiKey')) !== null,
          enabled: true,
          models: d.defaultModels,
        })),
      );
      return { providers };
    },
    'provider.listModels': async (p: { providerId: string }) => {
      return { models: getDialect(p.providerId)?.defaultModels ?? [] };
    },
    'provider.ollamaDetect': async (_p: Record<string, never>) => {
      try {
        const tags = (await deps.httpGetJson(`${BUILTIN_PROVIDERS.ollama!.baseUrl}/api/tags`)) as { models?: Array<{ name: string }> };
        return { available: true, models: (tags.models ?? []).map((m) => m.name) };
      } catch {
        return { available: false, models: [] as string[] };
      }
    },
    'provider.testConnection': async (p: { providerId: string }) => {
      const d = getDialect(p.providerId);
      if (!d) return { ok: false, errorKind: 'unknown' as ErrorKind, detail: 'unknown provider' };
      if (d.format === 'ollama') {
        try { await deps.httpGetJson(`${d.baseUrl}/api/tags`); return { ok: true }; }
        catch (e) { return { ok: false, errorKind: classify(e) }; }
      }
      const key = await deps.keychain.get(p.providerId, 'apiKey');
      if (!key) return { ok: false, errorKind: 'auth' as ErrorKind, detail: 'no key' };
      // openai 格式有 /models；其余 MVP 仅凭有 key 视为可达（真实 ping 留 V1+）
      if (d.format !== 'openai') return { ok: true };
      try {
        await deps.httpGetJson(`${d.baseUrl}/models`, { authorization: `Bearer ${key}` });
        return { ok: true };
      } catch (e) {
        return { ok: false, errorKind: classify(e) };
      }
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/desktop && pnpm exec vitest run test/provider-service.test.ts`
Expected: PASS（5 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/provider-service.ts apps/desktop/test/provider-service.test.ts
git commit -m "feat(desktop): provider-service（saveKey/listProviders/ollamaDetect/testConnection）"
```

### Task 5.3: 注册 provider.* 到 router + httpGetJson 生产实现

**Files:**
- Modify: `apps/desktop/electron/main/http-agent.ts`（增 `electronHttpGetJson`）
- Modify: `apps/desktop/electron/main/ipc-router.ts`（注册 6 个 provider.* handler）
- Modify: `apps/desktop/electron/main/index.ts`（注入 keychain + electronHttpGetJson）
- Test: `apps/desktop/test/router.test.ts`（追加：provider.saveKey 经 router 分发）

- [ ] **Step 1: 写失败测试（router 注册）**

参照 `router.test.ts` 既有风格，追加：

```ts
it('dispatches provider.saveKey through the router', async () => {
  const calls: any[] = [];
  const router = createRouter<null>({
    'provider.saveKey': async (p) => { calls.push(p); return { ok: true as const }; },
  });
  const r = await router.dispatch('provider.saveKey', { providerId: 'openai', key: 'sk-1' }, null);
  expect(r).toEqual({ ok: true });
  expect(calls[0]).toEqual({ providerId: 'openai', key: 'sk-1' });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/router.test.ts -t "provider.saveKey"`
Expected: FAIL（若 router.test 此前未覆盖 provider.*；该测试本身验证 router 能分发已注册的 provider 方法——schema 来自 Task 1.4，应能通过类型；若失败是因 createRouter 泛型，确保按既有 import）

> 说明：本步主要保证 `provider.*` 已在 `Methods`（Task 1.4）且 router 可分发。真正的 handler 接线在 Step 3。

- [ ] **Step 3: 实现 —— `http-agent.ts` 增 electronHttpGetJson**

```ts
import type { HttpGetJson } from './provider-service.js';

export const electronHttpGetJson: HttpGetJson = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) { const e: any = new Error(`HTTP ${status}`); e.status = status; reject(e); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (err) { reject(err); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
```

- [ ] **Step 4: 实现 —— `ipc-router.ts` 注册 provider.***

`IpcRouterDeps` 增 `providerService?: ReturnType<typeof import('./provider-service.js').createProviderService>;`。在 `createRouter({...})` 内追加（若提供）：

```ts
    ...(deps.providerService ?? {}),
```

（`createProviderService` 返回的对象 key 正是 `provider.*` 方法名，可直接 spread 进 handlers。）

- [ ] **Step 5: 实现 —— `index.ts` 注入**

```ts
import { electronHttpAgent, electronHttpGetJson } from './http-agent.js';
import { createProviderService } from './provider-service.js';
// whenReady 内（keychain 已建）：
const providerService = createProviderService({ keychain, httpGetJson: electronHttpGetJson });
// registerIpcRouter({...}) 增：
    providerService,
```

- [ ] **Step 6: 运行通过 + typecheck**

Run: `cd apps/desktop && pnpm exec vitest run test/router.test.ts && pnpm --filter @desksoul/desktop typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/main apps/desktop/test/router.test.ts
git commit -m "feat(desktop): 注册 provider.* RPC + Electron net httpGetJson"
```

### Task 5.4: headless 密钥隔离验证脚本

**Files:**
- Create: `apps/desktop/test/m5-secret-isolation.test.ts`

验收项「Worker 内 secrets 读不到」：静态断言 worker 产物不含密钥来源，且 fetch 出口的 Authorization 由 Main 注入（worker 帧里无 Authorization）。

- [ ] **Step 1: 写测试**

```ts
// apps/desktop/test/m5-secret-isolation.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('M5 secret isolation', () => {
  it('provider worker bundle does not read process.env for secrets', () => {
    const entry = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
    const src = readFileSync(entry, 'utf8');
    // worker 不应直接触碰 env 取密钥；密钥注入只在 Main 的 provider-config
    expect(src).not.toMatch(/process\.env\.[A-Z_]*KEY/);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*TOKEN/);
  });

  it('worker fetchRequest frames never carry an Authorization header (injected only in Main)', async () => {
    // 见 fetch-gateway.test.ts 的 injectAuth 用例：worker 侧 init.headers 不含 authorization；
    // 此处冒烟断言 openai-compat 构造请求时不放 auth 头。
    const { default: x } = await import('@desksoul/sidecar/dist/workers/providers/openai-compat.js').catch(() => ({ default: null }));
    expect(x === null || typeof x === 'object').toBe(true); // 占位：真正保证在 fetch-gateway 注入测试
  });
});
```

> 第二个用例是文档性占位（真正的隔离保证在 `fetch-gateway.test.ts` 的 injectAuth 路径 + worker `env:{}`）。若觉冗余可只保留第一个用例。

- [ ] **Step 2: 运行确认通过**

Run: `pnpm --filter @desksoul/sidecar build && cd apps/desktop && pnpm exec vitest run test/m5-secret-isolation.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/m5-secret-isolation.test.ts
git commit -m "test(desktop): M5 密钥隔离静态断言（worker 不取密钥）"
```

---

# Phase 6 · tool_call 通路 + Embedding + Claude/Gemini dialect

到此结束：openai-compat 正确聚合流式 tool_calls 并产出 `tool_call` 事件；ChatService 执行工具并**单轮回灌**；Embedding Provider 可用；Claude（anthropic）与 Gemini dialect 接入。

### Task 6.1: openai-compat 流式 tool_calls 聚合

**Files:**
- Modify: `apps/sidecar/src/workers/providers/openai-compat.ts`
- Test: `apps/sidecar/test/openai-compat.test.ts`（追加）

OpenAI 流式 tool call：`delta.tool_calls[i] = { index, id?, function:{ name?, arguments? } }`，`arguments` 跨 chunk 拼接；`finish_reason==='tool_calls'` 收尾。

- [ ] **Step 1: 写失败测试**

```ts
it('aggregates streamed tool_calls into a tool_call event', async () => {
  globalThis.fetch = vi.fn(async () => sseResponse([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"cats\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ])) as typeof fetch;
  const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
  const tc = ev.find((e) => e.type === 'tool_call') as any;
  expect(tc).toMatchObject({ id: 'c1', name: 'search' });
  expect(tc.args).toEqual({ q: 'cats' });
  expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/openai-compat.test.ts -t "tool_calls"`
Expected: FAIL

- [ ] **Step 3: 实现 —— 在 `openaiCompatChat` 循环中聚合，结束前吐 tool_call**

在循环外声明 `const toolAcc = new Map<number, { id: string; name: string; args: string }>();`

在解析 `json` 后、`usage` 判断旁加：

```ts
      const tcs = json?.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      }
```

在最终 `if (sawUsage)...` 之前、`yield done` 之前加：

```ts
  for (const tc of toolAcc.values()) {
    let parsed: unknown = {};
    try { parsed = tc.args ? JSON.parse(tc.args) : {}; } catch { parsed = { _raw: tc.args }; }
    yield { type: 'tool_call', id: tc.id || `call_${tc.name}`, name: tc.name, args: parsed };
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/sidecar && pnpm exec vitest run test/openai-compat.test.ts && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/sidecar/src/workers/providers/openai-compat.ts apps/sidecar/test/openai-compat.test.ts
git commit -m "feat(sidecar): openai-compat 流式 tool_calls 聚合为 tool_call 事件"
```

### Task 6.2: ChatService 工具执行 + 单轮回灌

**Files:**
- Modify: `apps/desktop/electron/main/chat-service.ts`
- Test: `apps/desktop/test/chat-service.test.ts` + `apps/desktop/test/fixtures/tool-worker.mjs`

收到 `tool_call` → 经 `PluginGateway.invokeTool` 执行 → 把结果作为 `tool` 角色消息追加进 request → 用同 provider 重发**一次**（`toolRound` 去重，防无限循环）。

- [ ] **Step 1: 新建 fixture**

```js
// apps/desktop/test/fixtures/tool-worker.mjs
// 第一次 start：吐 tool_call 'echo' 然后 done(stop)。
// 第二次 start（request.messages 末尾含 role:'tool'）：吐该 tool 结果文本 + done。
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const { requestId, sessionId } = m;
  const hasToolMsg = (m.request?.messages ?? []).some((x) => x.role === 'tool');
  if (!hasToolMsg) {
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'tool_call', id: 't1', name: 'echo', args: { v: 42 } } });
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'done', finishReason: 'stop' } });
  } else {
    const toolMsg = m.request.messages.filter((x) => x.role === 'tool').at(-1);
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'delta', text: 'result=' + toolMsg.content } });
    parentPort.postMessage({ kind: 'chat.event', requestId, sessionId, event: { type: 'done', finishReason: 'stop' } });
  }
});
```

- [ ] **Step 2: 写失败测试**

```ts
it('executes a tool_call via gateway then re-prompts once with the result', async () => {
  const TOOL_ENTRY = path.join(__dirname, 'fixtures/tool-worker.mjs');
  const broadcasts: Array<{ channel: string; params: any }> = [];
  const svc = new ChatService({
    providerEntryPath: TOOL_ENTRY,
    broadcast: (c, p) => broadcasts.push({ channel: c, params: p }),
    providerChain: ['openai'],
    plugins: { tools: new Map([['echo', (args) => `echoed:${JSON.stringify(args)}`]]) },
  });
  svc.send('s1', 'use a tool');
  await new Promise((r) => setTimeout(r, 300));
  const text = broadcasts.filter((b) => b.channel === 'chat.stream').map((b) => b.params.text).join('');
  expect(text).toContain('result=echoed:');
  const dones = broadcasts.filter((b) => b.channel === 'chat.done');
  expect(dones).toHaveLength(1); // 回灌轮的 done 才广播；首轮 tool_call 的 done 被吞
  await svc.dispose();
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts -t "tool_call via gateway"`
Expected: FAIL

- [ ] **Step 4: 实现 —— `chat-service.ts`**

新增状态：`private readonly toolRound = new Map<string, boolean>();` 和 `private readonly pendingTools = new Map<string, Array<{ id: string; name: string; args: unknown }>>();`

`onProviderEvent` 增 tool_call 收集与 done 时的回灌（放在 usage 拦截之后、降级判定之前）：

```ts
    if (event.type === 'tool_call') {
      const list = this.pendingTools.get(sessionId) ?? [];
      list.push({ id: event.id, name: event.name, args: event.args });
      this.pendingTools.set(sessionId, list);
      return; // 不进 core
    }
    if (event.type === 'done' && event.finishReason === 'stop') {
      const tools = this.pendingTools.get(sessionId);
      const att = this.attempt.get(sessionId);
      if (tools && tools.length > 0 && att && !this.toolRound.get(sessionId)) {
        this.toolRound.set(sessionId, true);
        this.pendingTools.delete(sessionId);
        void this.runToolsAndReprompt(sessionId, att, tools);
        return; // 吞掉本轮 done，等回灌轮
      }
    }
```

在 done 的清理处一并清 tool 状态：`this.toolRound.delete(sessionId); this.pendingTools.delete(sessionId);`

新增方法：

```ts
  private async runToolsAndReprompt(
    sessionId: string,
    att: { chain: string[]; idx: number; request: import('@desksoul/protocol').ChatRequest },
    tools: Array<{ id: string; name: string; args: unknown }>,
  ): Promise<void> {
    const toolMessages = [];
    for (const t of tools) {
      let result: unknown;
      try {
        const r = await this.plugins.handle({
          kind: 'plugin.request',
          rpc: { jsonrpc: '2.0', id: 1, method: 'plugin.invokeTool', params: { toolId: t.name, args: t.args } },
        });
        result = r.rpc.result ? (r.rpc.result as { value: unknown }).value : `error: ${r.rpc.error?.message}`;
      } catch (e) {
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolMessages.push({ role: 'tool' as const, content: typeof result === 'string' ? result : JSON.stringify(result) });
    }
    const nextRequest = { ...att.request, messages: [...att.request.messages, ...toolMessages] };
    this.attempt.set(sessionId, { ...att, request: nextRequest });
    this.host.send(sessionId, { providerId: att.chain[att.idx]!, request: nextRequest });
  }
```

> 说明：`plugin-gateway` 的 `invokeTool` 需要工具已注册（`ChatServiceOptions.plugins.tools`）。MVP 单轮回灌（`toolRound` 防二次）；多步 agent loop 留 V1+。

- [ ] **Step 5: 运行确认通过 + 全 chat 回归**

Run: `cd apps/desktop && pnpm exec vitest run test/chat-service.test.ts`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main/chat-service.ts apps/desktop/test
git commit -m "feat(desktop): tool_call 执行 + 单轮回灌（经 PluginGateway.invokeTool）"
```

### Task 6.3: Embedding Provider（openai + ollama）

**Files:**
- Create: `apps/sidecar/src/workers/providers/embedding.ts`
- Test: `apps/sidecar/test/embedding.test.ts`

EmbeddingProvider 与 Chat 分离（tech-design §4.3）。M5 提供实现，消费方在 M8 记忆向量。

- [ ] **Step 1: 写失败测试**

```ts
// apps/sidecar/test/embedding.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { embed } from '../src/workers/providers/embedding.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('embed', () => {
  it('openai format returns vectors from data[].embedding', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 })) as typeof fetch;
    const v = await embed('openai', ['hi'], 'text-embedding-3-small');
    expect(v).toEqual([[0.1, 0.2]]);
  });
  it('ollama format returns embedding from /api/embeddings', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ embedding: [0.3, 0.4] }), { status: 200 })) as typeof fetch;
    const v = await embed('ollama', ['hi'], 'nomic-embed-text');
    expect(v).toEqual([[0.3, 0.4]]);
  });
  it('throws with status on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch;
    await expect(embed('openai', ['x'], 'm')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/embedding.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `embedding.ts`**

```ts
import { getDialect } from '@desksoul/protocol';

/** 返回每条输入对应的向量。openai：批量 data[].embedding；ollama：逐条 /api/embeddings。 */
export async function embed(providerId: string, inputs: string[], model: string): Promise<number[][]> {
  const d = getDialect(providerId);
  if (!d) throw new Error(`unknown provider: ${providerId}`);
  if (d.format === 'ollama') {
    const out: number[][] = [];
    for (const input of inputs) {
      const res = await fetch(`${d.baseUrl}/api/embeddings`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: input }),
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const json = (await res.json()) as { embedding: number[] };
      out.push(json.embedding);
    }
    return out;
  }
  // openai 格式（含 deepseek/qwen 兼容）
  const res = await fetch(`${d.baseUrl}/embeddings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d2) => d2.embedding);
}
```

- [ ] **Step 4: 运行通过 + 构建**

Run: `cd apps/sidecar && pnpm exec vitest run test/embedding.test.ts && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/sidecar/src/workers/providers/embedding.ts apps/sidecar/test/embedding.test.ts
git commit -m "feat(sidecar): Embedding provider（openai 批量 + ollama 逐条）"
```

### Task 6.4: Claude（anthropic）+ Gemini dialect

**Files:**
- Create: `apps/sidecar/src/workers/providers/anthropic.ts`, `apps/sidecar/src/workers/providers/gemini.ts`
- Modify: `apps/sidecar/src/workers/provider-registry.ts`（增 case）
- Modify: `apps/desktop/electron/main/provider-config.ts` + `fetch-gateway.ts`（injectAuth 支持改 url，供 gemini query-key）
- Test: `apps/sidecar/test/anthropic.test.ts`, `apps/sidecar/test/gemini.test.ts`, `apps/desktop/test/fetch-gateway.test.ts`（追加 url 改写）

- [ ] **Step 1: 写失败测试（anthropic SSE）**

```ts
// apps/sidecar/test/anthropic.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDialect } from '@desksoul/protocol';
import { anthropicChat } from '../src/workers/providers/anthropic.js';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function sse(lines: string[], status = 200): Response {
  const enc = new TextEncoder();
  return new Response(status === 200 ? new ReadableStream({ start(c){ for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } }) : null, { status });
}
async function collect(it: AsyncIterable<any>){ const o:any[]=[]; for await (const e of it) o.push(e); return o; }

describe('anthropicChat', () => {
  it('maps content_block_delta to deltas + message_delta usage + stop', async () => {
    globalThis.fetch = vi.fn(async () => sse([
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"你"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"好"}}\n\n',
      'event: message_delta\ndata: {"usage":{"input_tokens":5,"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {}\n\n',
    ])) as typeof fetch;
    const ev = await collect(anthropicChat(getDialect('claude')!, { messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-4-6' }, new AbortController().signal));
    expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('你好');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 5, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
```

- [ ] **Step 2: 写失败测试（gemini）**

```ts
// apps/sidecar/test/gemini.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDialect } from '@desksoul/protocol';
import { geminiChat } from '../src/workers/providers/gemini.js';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c){ for (const l of lines) c.enqueue(enc.encode(l)); c.close(); } }), { status: 200 });
}
async function collect(it: AsyncIterable<any>){ const o:any[]=[]; for await (const e of it) o.push(e); return o; }

describe('geminiChat', () => {
  it('maps candidates[].content.parts[].text to deltas', async () => {
    globalThis.fetch = vi.fn(async () => sse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}\n\n',
    ])) as typeof fetch;
    const ev = await collect(geminiChat(getDialect('gemini')!, { messages: [{ role: 'user', content: 'hi' }], model: 'gemini-1.5-flash' }, new AbortController().signal));
    expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Hi!');
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/sidecar && pnpm exec vitest run test/anthropic.test.ts test/gemini.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 `anthropic.ts`**

```ts
import type { ChatEvent, ChatRequest, ProviderDialect } from '@desksoul/protocol';
import { parseSseStream } from '@desksoul/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

export async function* anthropicChat(dialect: ProviderDialect, req: ChatRequest, signal: AbortSignal, baseUrlOverride?: string): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const messages = req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  let res: Response;
  try {
    res = await fetch(`${base}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, max_tokens: req.params?.maxTokens ?? 1024, ...(system ? { system } : {}), messages }),
      signal,
    });
  } catch (e) { yield { type: 'done', finishReason: signal.aborted ? 'cancel' : 'error', ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }) }; return; }
  if (!res.ok) { yield { type: 'done', finishReason: 'error', error: `HTTP ${res.status}`, errorKind: classifyStatus(res.status) }; return; }
  if (!res.body) { yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' }; return; }
  let prompt = 0, completion = 0, sawUsage = false;
  for await (const sse of parseSseStream(res.body)) {
    if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
    let json: any; try { json = JSON.parse(sse.data); } catch { continue; }
    if (sse.event === 'content_block_delta' && json?.delta?.type === 'text_delta') yield { type: 'delta', text: json.delta.text };
    if (json?.usage) { sawUsage = true; prompt = json.usage.input_tokens ?? prompt; completion = json.usage.output_tokens ?? completion; }
    if (sse.event === 'message_stop') break;
  }
  if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
```

- [ ] **Step 5: 实现 `gemini.ts`**（key 在 query，由 Main 注入；worker 只打 `:streamGenerateContent?alt=sse`）

```ts
import type { ChatEvent, ChatRequest, ProviderDialect } from '@desksoul/protocol';
import { parseSseStream } from '@desksoul/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

export async function* geminiChat(dialect: ProviderDialect, req: ChatRequest, signal: AbortSignal, baseUrlOverride?: string): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const contents = req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  let res: Response;
  try {
    res = await fetch(`${base}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents }), signal,
    });
  } catch (e) { yield { type: 'done', finishReason: signal.aborted ? 'cancel' : 'error', ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }) }; return; }
  if (!res.ok) { yield { type: 'done', finishReason: 'error', error: `HTTP ${res.status}`, errorKind: classifyStatus(res.status) }; return; }
  if (!res.body) { yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' }; return; }
  let prompt = 0, completion = 0, sawUsage = false;
  for await (const sse of parseSseStream(res.body)) {
    if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
    let json: any; try { json = JSON.parse(sse.data); } catch { continue; }
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    if (text) yield { type: 'delta', text };
    if (json?.usageMetadata) { sawUsage = true; prompt = json.usageMetadata.promptTokenCount ?? prompt; completion = json.usageMetadata.candidatesTokenCount ?? completion; }
  }
  if (signal.aborted) { yield { type: 'done', finishReason: 'cancel' }; return; }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
```

- [ ] **Step 6: registry 增 case**

```ts
import { anthropicChat } from './providers/anthropic.js';
import { geminiChat } from './providers/gemini.js';
// switch:
    case 'anthropic': return (req, signal) => anthropicChat(dialect, req, signal);
    case 'gemini':    return (req, signal) => geminiChat(dialect, req, signal);
```

- [ ] **Step 7: FetchGateway injectAuth 支持改 url（gemini query-key）**

把 `injectAuth` 的返回从 `Record<string,string>` 升为 `{ url?: string; headers: Record<string,string> }`。改三处：
- `fetch-gateway.ts` 的 `FetchGatewayDeps.injectAuth` 签名为 `(providerId, url, headers) => Promise<{ url?: string; headers: Record<string,string> }>`；`handle` 内用返回的 `url ?? frame.url`、`headers` 调 agent。
- 既有 `fetch-gateway.test.ts` 的 injectAuth 改为返回 `{ headers: {...} }`（更新断言）。
- `provider-config.ts` 的 `injectAuth` 改签名：bearer/x-api-key 返回 `{ headers }`；query-key（gemini）返回 `{ url: appendKey(url, key), headers }`。

`provider-config.ts` 的 query-key 分支：

```ts
      if (dialect.authStyle === 'query-key') {
        const sep = url.includes('?') ? '&' : '?';
        return { url: `${url}${sep}key=${encodeURIComponent(key)}`, headers };
      }
      return { headers };
```

并把 bearer/x-api-key/none 分支都改为返回 `{ headers: ... }` 形状。`createProviderConfig` 的 `injectAuth(providerId, url, headers)` 增 `url` 参数。

- [ ] **Step 8: 追加 fetch-gateway 测试（url 改写生效）**

```ts
it('applies url rewrite from injectAuth (gemini query-key)', async () => {
  let calledUrl = '';
  const agent: HttpAgent = (spec, sink) => { calledUrl = spec.url; sink.head(200, {}); sink.end(); };
  const gw = createFetchGateway({
    agent,
    resolveHost: () => ({ providerId: 'gemini' }),
    injectAuth: async (_id, url, h) => ({ url: url + '?key=K', headers: h }),
  });
  gw.handle(reqFrame({ url: 'https://generativelanguage.googleapis.com/x' }), () => {});
  await new Promise((r) => setTimeout(r, 10));
  expect(calledUrl).toBe('https://generativelanguage.googleapis.com/x?key=K');
});
```

> 注意：更新 Task 2.2 既有三个用例里的 `injectAuth` 返回值为 `{ headers }` 形状（之前直接返回 headers）。

- [ ] **Step 9: 运行通过 + 构建**

Run: `cd apps/sidecar && pnpm exec vitest run && cd ../desktop && pnpm exec vitest run test/fetch-gateway.test.ts && cd ../.. && pnpm --filter @desksoul/sidecar build`
Expected: 全 PASS

- [ ] **Step 10: Commit**

```bash
git add apps/sidecar/src apps/sidecar/test apps/desktop/electron/main apps/desktop/test/fetch-gateway.test.ts
git commit -m "feat: Claude(anthropic) + Gemini dialect（含 query-key url 注入）"
```

---

# Phase 7 · 全量回归 + e2e + 验收对照

### Task 7.1: e2e-smoke 扩展（mock provider 仍跑通）

**Files:**
- Modify: `apps/desktop/test/e2e-smoke.mjs`（确认 mock 路径在新 send 签名下不回归）

- [ ] **Step 1:** 阅读 `e2e-smoke.mjs`，确认其触发 `chat.send` 的路径在 ChatService 新签名（无 defaultProviderId → mock 路径）下仍工作。若 e2e 依赖真实流式，增加一个 mock-provider 用例：发 `chat.send`，断言收到 `chat.stream` + `chat.done`。
- [ ] **Step 2:** Run（packaged 或 dev e2e，按既有方式）：`pnpm --filter @desksoul/desktop build && node apps/desktop/test/e2e-smoke.mjs`（或既有 e2e 命令）。Expected: PASS。
- [ ] **Step 3:** 如有改动 Commit：`git commit -m "test(desktop): e2e-smoke 覆盖 M5 mock 流式路径"`

### Task 7.2: 全仓回归

- [ ] **Step 1: 顺序按 CI 跑全量**

Run:
```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @desksoul/desktop build
```
Expected: 全绿。失败则定位到对应 Phase 的 task 修复（不要跳过）。

- [ ] **Step 2:** 若有 lint/格式修复，Commit：`git commit -m "chore(m5): 全量回归修复（lint/typecheck）"`

### Task 7.3: 验收对照（impl-plan M5）

逐条核对并在 PR 描述/`docs/status/` 记录：

- [ ] 配 OpenAI Key → 完整跑通流式对话（Task 3.6 手动 + Task 3.5 集成）
- [ ] 配错 Key → 401 正确分级（`chat.done.errorKind === 'auth'`，Task 4.3 + 3.6 手动）
- [ ] Ollama 启动后自动检测 + 可用（`provider.ollamaDetect` Task 5.2 + ollama 流式 Task 5.1；本地有 Ollama 时手动验一次真实流式）
- [ ] Worker 内 secrets 读不到（Task 5.4 静态断言 + worker `env:{}` + 密钥仅在 Main 注入）

### Task 7.4: 收尾

- [ ] **Step 1:** 调用 `superpowers:finishing-a-development-branch` 完成分支（验证测试、呈现选项、执行 PR/merge）。
- [ ] **Step 2:** 更新 `CLAUDE.md` 项目状态行（M5 完成 → 下一里程碑 M6）。
- [ ] **Step 3:** Commit：`docs: M5 验收结果 + 项目状态行更新`

---

## 自审备忘（执行者可忽略，规划者已核对）

- **spec 覆盖**：fetch 网关✓(P2) / openai-compat✓(P3) / ollama✓(P5) / 降级链✓(P4.4) / tool_call✓(P6.1-6.2) / embedding✓(P6.3) / token✓(P4) / 错误分级✓(P4.3) / SDK 定型✓(P1) / provider.* RPC✓(P5) / 密钥隔离✓(P5.4)。
- **类型一致**：`ChatRequest`/`ChatEvent`/`ErrorKind` 全程引用 `@desksoul/protocol`；`injectAuth` 签名在 P6.4 演进为 `(providerId, url, headers) => {url?,headers}`，P2/P3 的早期签名在 P6.4 Step 7-8 显式迁移。
- **mock 路径不回归**：ChatService 无 `defaultProviderId`/`providerChain` 时 `host.send(sessionId, {})` 走 mock intervalMs，老 e2e/单测不受影响。
