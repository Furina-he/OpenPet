# M6 状态层（Working + Persona State）+ 数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行环境说明：** 本仓库 subagent 派发常被基础设施层限流（429，见 RESULTS-M5）。subagent 不可用时退化为 inline `executing-plans` 逐 task TDD（写失败测试 → 跑红 → 最小实现 → 跑绿 → commit），与 M5 相同。

**Goal:** 把会话历史从 JSON 文件升级为 SQLite（better-sqlite3，单连接归 Main，角色隔离），新增 Persona State（每轮更新的亲密度/情绪 KV），并把 LLM 上下文从「裸历史」升级为 ContextAssembler 组装的「system prompt（人设 + persona 摘要 + 行为标签规约）+ Working Memory（最近 20 轮）」，附数据管理 RPC（存储占用 / 一键导出 .dsbak）。

**Architecture:**
- **数据访问接口化**（决策见下）：定义领域仓储接口 `ConversationStore`，两个实现——`SqliteStore`（better-sqlite3，生产）与 `MemoryStore`（纯内存，单测）。所有业务单测注入 `MemoryStore`，不依赖原生模块；`SqliteStore` 的 SQL 正确性由「可加载 better-sqlite3 时才跑」的集成测试覆盖（CI windows-latest 有 prebuilt；本地网络受限时 skip，真机验证延后）。
- **单一写者纪律**（tech-design §6）：唯一 `ConversationStore` 实例归 Main 的 `ChatService` 持有；Worker 永不直连 DB。
- **SessionStore 重构为「运行时状态机 + 持久化委托」**：保留 seq/streaming/当前轮 partial 累积（内存，不持久化），把「已封口消息的落库」与「snapshot 读历史」委托给注入的 `ConversationStore`。
- **ContextAssembler**：纯函数读 store（历史 + persona）+ `buildSystemPrompt`（protocol 纯函数）→ `ChatRequest`，替换 `chat-service.ts` 现有的裸拼接。

**Tech Stack:** better-sqlite3（WAL）+ `@types/better-sqlite3`、adm-zip（纯 JS 打包 .dsbak）、Zod（协议）、Vitest（单测）。

---

## 决策记录（本计划据此展开，写代码不再重新决策）

1. **better-sqlite3 落地 = 接口化 + 内存 fake**（用户确认）。`SqliteStore` 用 `createRequire(import.meta.url)('better-sqlite3')` 运行时加载（vite config 已 `external`），typecheck 仅依赖纯类型包 `@types/better-sqlite3`。`createConversationStore` 工厂：给了 sqlite 路径且 better-sqlite3 可加载 → `SqliteStore`；否则 `console.warn` 降级 `MemoryStore`（开发机网络受限不阻塞 app 启动）。真实 better-sqlite3 接线 + `@electron/rebuild` + 真机验证按 M5 模式列入 RESULTS 待办。
2. **导出 .dsbak = 仅 DB + manifest，不含密钥**（用户确认）。zip 内：`sessions.db`（SqliteStore 时用 better-sqlite3 `.backup()` 一致性快照；MemoryStore 时序列化为 SQL/JSON 兜底）+ `manifest.json`（导出元信息：schemaVersion、characterIds、messageCount、exportedAt）。**绝不含** `secrets.kc`。
3. **D7 边界 = 仅后端 + RPC**（用户确认）。新增 `app.storageUsage` / `app.exportData` 两个 RPC + headless 测试；D7 数据管理 UI 留 M7。
4. **characterId 来源**：不改 `chat.send` 协议。`ChatService` 构造注入 `getCharacterId: () => string`（接 `CharacterService.current().characterId`，MVP 单角色 `'default'`）。多角色按 session 映射 characterId 留 V1+。
5. **§6 schema 扩展**：`messages` 表加一列 `finish_reason TEXT`（运行协议早已用 stop|cancel|error，tech-design §6 原表漏了）。M6 收尾在 tech-design §6 schema 补这列并写决策记录。
6. **PersonaStateBlob（MVP 内容）**：`{ affinity:number(0..100, 默认 50), turns:number, lastMood?:string, lastEnergy?:string, lastInteraction?:number }`。每轮 assistant `done(stop)` 后更新：`turns++`、`affinity=min(100, affinity+1)`、`lastMood/lastEnergy` 取本轮 intent（无则不变）、`lastInteraction=ts`。约定/关系图谱等富 KV 留 V1+。
7. **ContextAssembler（MVP）**：`messages = [system, ...最近20轮(过滤空), {user, 当前输入}]`。Episodic 向量召回 / Semantic 事实硬注入 / token budget packing 全部留 V1+（tech-design §8 完整算法），MVP 不做 budget 裁剪（20 轮通常不爆窗）。
8. **facts / episodes / sqlite-vec = 建表 + 接口 stub**：schema 建好 `facts`/`episodes` 表，`ConversationStore` 留 `insertFact/insertEpisode/...` 方法但 MVP 仅 SqliteStore 落表、无业务调用方；向量 `memory.vec.db` / sqlite-vec V1.0 启用，本期不引入。

---

## 文件结构

**协议层 `packages/protocol/src/`**
- Create `state.ts` — `PersonaStateBlobSchema`、`DEFAULT_PERSONA_STATE`、`updatePersonaState()` 纯函数、`MessageRecord` 领域类型、`StorageUsage` / `ExportManifest` 类型。
- Modify `persona-prompt-template.ts` — 加 `buildSystemPrompt()`（人设 + persona 摘要 + 复用 `buildBehaviorPrompt`）。
- Modify `methods.ts` — 加 `app.storageUsage`、`app.exportData`。
- Modify `index.ts` — re-export `state.ts`。

**数据层 `apps/desktop/electron/main/db/`**（新目录）
- Create `schema.ts` — 建表 SQL 常量 + `SCHEMA_VERSION`。
- Create `store.ts` — `ConversationStore` 接口 + 共享行类型。
- Create `memory-store.ts` — 内存实现（单测）。
- Create `sqlite-store.ts` — better-sqlite3 实现（动态 require）。
- Create `index.ts` — `createConversationStore()` 工厂（含降级）。
- Create `export-bundle.ts` — `.dsbak` 打包（adm-zip）。

**状态/上下文层 `apps/desktop/electron/main/`**
- Create `context-assembler.ts` — `assembleContext()` → `ChatRequest`。
- Modify `session-store.ts` — 委托持久化给 `ConversationStore`；加 characterId；删 JSON 路径。
- Modify `chat-service.ts` — 注入 store + getCharacterId + manifest；接 ContextAssembler；done(stop) 更新 persona_state；提供 storageUsage/exportData。
- Modify `ipc-router.ts` — 注入 sqlitePath + characterService；注册 `app.storageUsage`/`app.exportData`。
- Modify `index.ts` — `dataDir = userData/data`；`sqlitePath = data/sessions.db`。

**测试 `apps/desktop/test/` 与 `packages/protocol/test/`**
- Create `protocol/test/state.test.ts`、`protocol/test/build-system-prompt.test.ts`
- Create `apps/desktop/test/db/memory-store.test.ts`、`db/sqlite-store.test.ts`、`db/export-bundle.test.ts`、`context-assembler.test.ts`、`persona-update-integration.test.ts`
- Modify `apps/desktop/test/session-store.test.ts`（改注入 MemoryStore）

---

## Task 1: 依赖与镜像配置

**Files:**
- Create: `.npmrc`（仓库根）
- Modify: `apps/desktop/package.json`（deps: `better-sqlite3`、`adm-zip`；devDeps: `@types/better-sqlite3`、`@types/adm-zip`）

- [ ] **Step 1: 写 `.npmrc`（npmmirror 镜像 — 本机直连 GitHub 不通）**

```
registry=https://registry.npmmirror.com
better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3
node_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary
```

- [ ] **Step 2: 装纯类型 + 纯 JS 依赖（必成功，不触发原生编译）**

Run:
```bash
pnpm --filter @desksoul/desktop add -D @types/better-sqlite3@^7 @types/adm-zip@^0.5
pnpm --filter @desksoul/desktop add adm-zip@^0.5
```
Expected: 写入 package.json，lockfile 更新，无原生编译。

- [ ] **Step 3: 尝试装 better-sqlite3（原生；失败不阻塞 — 接口化已兜底）**

Run: `pnpm --filter @desksoul/desktop add better-sqlite3@^11`
Expected（理想）: 从 npmmirror 拉到 prebuilt，安装成功。
Expected（受限）: 下载/编译失败 → 在 RESULTS-M6「真机待办」记录，**继续后续 task**（`createConversationStore` 会降级 MemoryStore；SqliteStore 集成测试会 skip）。

- [ ] **Step 4: 验证 typecheck 不被影响**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: PASS（此时还没引用新模块）。

- [ ] **Step 5: Commit**

```bash
git add .npmrc apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): add better-sqlite3 + adm-zip deps and npmmirror .npmrc for M6"
```

---

## Task 2: 协议层 — PersonaState 类型与更新纯函数

**Files:**
- Create: `packages/protocol/src/state.ts`
- Create: `packages/protocol/test/state.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: 写失败测试 `packages/protocol/test/state.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  PersonaStateBlobSchema,
  DEFAULT_PERSONA_STATE,
  updatePersonaState,
} from '../src/state';

describe('PersonaState', () => {
  it('default blob is valid and starts neutral', () => {
    const parsed = PersonaStateBlobSchema.parse(DEFAULT_PERSONA_STATE);
    expect(parsed.affinity).toBe(50);
    expect(parsed.turns).toBe(0);
  });

  it('updatePersonaState bumps turns, clamps affinity, records intent', () => {
    const next = updatePersonaState(DEFAULT_PERSONA_STATE, {
      mood: 'happy',
      energy: 'high',
      ts: 1000,
    });
    expect(next.turns).toBe(1);
    expect(next.affinity).toBe(51);
    expect(next.lastMood).toBe('happy');
    expect(next.lastEnergy).toBe('high');
    expect(next.lastInteraction).toBe(1000);
  });

  it('affinity never exceeds 100', () => {
    let s = { ...DEFAULT_PERSONA_STATE, affinity: 100 };
    s = updatePersonaState(s, { ts: 2000 });
    expect(s.affinity).toBe(100);
  });

  it('missing intent leaves last mood/energy unchanged', () => {
    const seeded = { ...DEFAULT_PERSONA_STATE, lastMood: 'shy' };
    const next = updatePersonaState(seeded, { ts: 3000 });
    expect(next.lastMood).toBe('shy');
  });
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/protocol test state` → FAIL（模块不存在）。

- [ ] **Step 3: 写实现 `packages/protocol/src/state.ts`**

```ts
import { z } from 'zod';

/**
 * Persona State — 角色随互动演化的情感/关系 KV（tech-design §8 Persona 层）。
 * 始终全量注入 system prompt。MVP 字段最小集；约定/关系图谱富 KV 留 V1+。
 */
export const PersonaStateBlobSchema = z.object({
  affinity: z.number().min(0).max(100),
  turns: z.number().int().nonnegative(),
  lastMood: z.string().optional(),
  lastEnergy: z.string().optional(),
  lastInteraction: z.number().int().nonnegative().optional(),
});
export type PersonaStateBlob = z.infer<typeof PersonaStateBlobSchema>;

export const DEFAULT_PERSONA_STATE: PersonaStateBlob = { affinity: 50, turns: 0 };

export interface TurnSignal {
  mood?: string;
  energy?: string;
  ts: number;
}

/** 每轮 assistant 收尾后演进 persona（纯函数；不可变返回新对象）。 */
export function updatePersonaState(prev: PersonaStateBlob, turn: TurnSignal): PersonaStateBlob {
  return {
    affinity: Math.min(100, prev.affinity + 1),
    turns: prev.turns + 1,
    lastMood: turn.mood ?? prev.lastMood,
    lastEnergy: turn.energy ?? prev.lastEnergy,
    lastInteraction: turn.ts,
  };
}

/** messages 表的领域行（持久化层与组装层共享）。 */
export interface MessageRecord {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  ts: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface StorageUsage {
  dbBytes: number;
  messageCount: number;
  characterCount: number;
}

export interface ExportManifest {
  schemaVersion: number;
  exportedAt: number;
  characterIds: string[];
  messageCount: number;
}
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/protocol test state` → PASS。

- [ ] **Step 5: re-export — `packages/protocol/src/index.ts` 加 `export * from './state.js';`**（确认现有 barrel 风格后追加）。

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/state.ts packages/protocol/test/state.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): persona state schema + updatePersonaState + domain types"
```

---

## Task 3: 协议层 — buildSystemPrompt

**Files:**
- Modify: `packages/protocol/src/persona-prompt-template.ts`
- Create: `packages/protocol/test/build-system-prompt.test.ts`

- [ ] **Step 1: 写失败测试 `packages/protocol/test/build-system-prompt.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/persona-prompt-template';
import { DEFAULT_PERSONA_STATE } from '../src/state';
import { BehaviorParser } from '../src/behavior-parser';

describe('buildSystemPrompt', () => {
  it('includes character name and behavior tag spec', () => {
    const sp = buildSystemPrompt({
      name: '小灵',
      persona: DEFAULT_PERSONA_STATE,
      emotions: ['happy', 'shy'],
      actions: ['wave'],
    });
    expect(sp).toContain('小灵');
    expect(sp).toContain('行为标签');
    expect(sp).toContain('happy');
  });

  it('summarizes persona affinity and last mood', () => {
    const sp = buildSystemPrompt({
      name: '小灵',
      persona: { ...DEFAULT_PERSONA_STATE, affinity: 72, turns: 30, lastMood: 'happy' },
    });
    expect(sp).toMatch(/72/);
    expect(sp).toMatch(/happy/);
  });

  it('emits no spurious behavior tags (parser sees only the few-shot examples cleanly)', () => {
    // 防御：system prompt 文本本身不应被 BehaviorParser 解析出告警（与解析器同源）。
    const sp = buildSystemPrompt({ name: 'X' });
    const warns: string[] = [];
    const p = new BehaviorParser({ onWarn: (r) => warns.push(r) });
    [...p.feed(sp)];
    [...p.flush()];
    expect(warns).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/protocol test build-system-prompt` → FAIL。

- [ ] **Step 3: 实现 — `persona-prompt-template.ts` 追加 `buildSystemPrompt`**

```ts
import type { PersonaStateBlob } from './state.js';

export interface SystemPromptOptions {
  name: string;
  persona?: PersonaStateBlob;
  emotions?: readonly string[];
  actions?: readonly string[];
}

/** 组装注入 ChatRequest 的 system prompt：人设 + persona 摘要 + 行为标签规约。 */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const parts: string[] = [
    `你是${opts.name}，用户的桌面 AI 伙伴。用自然、有温度的口吻陪伴用户。`,
  ];
  if (opts.persona) {
    const p = opts.persona;
    const bits = [`你与用户的亲密度 ${p.affinity}/100`, `已经互动了 ${p.turns} 轮`];
    if (p.lastMood) bits.push(`上次对话你的心情是「${p.lastMood}」`);
    parts.push(`【关系记忆】${bits.join('，')}。`);
  }
  parts.push(buildBehaviorPrompt({ ...(opts.emotions ? { emotions: opts.emotions } : {}), ...(opts.actions ? { actions: opts.actions } : {}) }));
  return parts.join('\n\n');
}
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/protocol test build-system-prompt` → PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/persona-prompt-template.ts packages/protocol/test/build-system-prompt.test.ts
git commit -m "feat(protocol): buildSystemPrompt (persona summary + behavior tag spec)"
```

---

## Task 4: 数据层 — schema 与 ConversationStore 接口

**Files:**
- Create: `apps/desktop/electron/main/db/schema.ts`
- Create: `apps/desktop/electron/main/db/store.ts`

- [ ] **Step 1: 写 `schema.ts`（建表 SQL — tech-design §6 + finish_reason 扩展）**

```ts
/** sessions.db schema（tech-design §6；M6 给 messages 加 finish_reason 列）。 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY,
  character_id  TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  text          TEXT NOT NULL,
  raw           TEXT,
  ts            INTEGER NOT NULL,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  finish_reason TEXT,
  provider      TEXT,
  model         TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_char_session_ts ON messages(character_id, session_id, ts);

CREATE TABLE IF NOT EXISTS persona_state (
  character_id TEXT PRIMARY KEY,
  blob_json    TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY,
  character_id   TEXT NOT NULL,
  subject        TEXT,
  predicate      TEXT,
  object         TEXT,
  confidence     REAL NOT NULL,
  source_session TEXT,
  last_seen      INTEGER,
  status         TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_char ON facts(character_id, status);

CREATE TABLE IF NOT EXISTS episodes (
  id           INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  archived     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_episodes_char ON episodes(character_id, archived);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
```

- [ ] **Step 2: 写 `store.ts`（接口 + 行类型）**

```ts
import type { PersonaStateBlob, StorageUsage } from '@desksoul/protocol';

export interface AppendMessageInput {
  characterId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  raw?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  finishReason?: 'stop' | 'cancel' | 'error' | null;
  provider?: string | null;
  model?: string | null;
}

export interface StoredRow {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  ts: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** facts / episodes：MVP 仅建表，方法签名留给 V1.0 记忆 worker。 */
export interface ConversationStore {
  appendMessage(input: AppendMessageInput): number;
  /** 最近 limit 条，按 ts 升序返回（角色 + 会话隔离）。 */
  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[];

  getPersonaState(characterId: string): PersonaStateBlob | null;
  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void;

  storageUsage(): StorageUsage;
  /** 一致性快照到目标 .db 文件（SqliteStore 用 better-sqlite3 .backup；Memory 兜底序列化）。 */
  backupTo(dbPath: string): Promise<void>;

  close(): void;
}
```

- [ ] **Step 3: typecheck** — Run: `pnpm --filter @desksoul/desktop typecheck` → PASS（纯类型，无测试）。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/main/db/schema.ts apps/desktop/electron/main/db/store.ts
git commit -m "feat(desktop): sessions.db schema sql + ConversationStore interface"
```

---

## Task 5: 数据层 — MemoryStore（单测真源）

**Files:**
- Create: `apps/desktop/electron/main/db/memory-store.ts`
- Create: `apps/desktop/test/db/memory-store.test.ts`

- [ ] **Step 1: 写失败测试 `apps/desktop/test/db/memory-store.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';

describe('MemoryStore', () => {
  it('appends and reads back recent messages in ts order', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    s.appendMessage({ characterId: 'c', sessionId: 's', role: 'assistant', text: 'yo', ts: 2, finishReason: 'stop' });
    const rows = s.recentMessages('c', 's', 10);
    expect(rows.map((r) => r.text)).toEqual(['hi', 'yo']);
    expect(rows[1].finishReason).toBe('stop');
  });

  it('isolates by character_id and session_id', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'A', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'B', ts: 1 });
    s.appendMessage({ characterId: 'a', sessionId: 'other', role: 'user', text: 'A2', ts: 1 });
    expect(s.recentMessages('a', 's', 10).map((r) => r.text)).toEqual(['A']);
  });

  it('recentMessages returns only the last N (ts order preserved)', () => {
    const s = new MemoryStore();
    for (let i = 1; i <= 5; i++) {
      s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    expect(s.recentMessages('c', 's', 2).map((r) => r.text)).toEqual(['m4', 'm5']);
  });

  it('persona state round-trips; null before first write', () => {
    const s = new MemoryStore();
    expect(s.getPersonaState('c')).toBeNull();
    s.putPersonaState('c', { ...DEFAULT_PERSONA_STATE, affinity: 60 }, 123);
    expect(s.getPersonaState('c')?.affinity).toBe(60);
  });

  it('storageUsage counts messages and distinct characters', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'x', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'y', ts: 1 });
    const u = s.storageUsage();
    expect(u.messageCount).toBe(2);
    expect(u.characterCount).toBe(2);
  });
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/desktop test memory-store` → FAIL。

- [ ] **Step 3: 实现 `memory-store.ts`**

```ts
import type { PersonaStateBlob, StorageUsage } from '@desksoul/protocol';
import type { AppendMessageInput, ConversationStore, StoredRow } from './store.js';

interface Row extends StoredRow {
  characterId: string;
  sessionId: string;
}

/** 纯内存 ConversationStore：单测真源 / better-sqlite3 不可用时的降级实现。 */
export class MemoryStore implements ConversationStore {
  private readonly rows: Row[] = [];
  private readonly persona = new Map<string, { blob: PersonaStateBlob; updatedAt: number }>();
  private seq = 0;

  appendMessage(input: AppendMessageInput): number {
    this.rows.push({
      characterId: input.characterId,
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      finishReason: input.finishReason ?? null,
      ts: input.ts,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
    });
    return ++this.seq;
  }

  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[] {
    return this.rows
      .filter((r) => r.characterId === characterId && r.sessionId === sessionId)
      .slice(-limit)
      .map((r) => ({
        role: r.role,
        text: r.text,
        finishReason: r.finishReason,
        ts: r.ts,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
      }));
  }

  getPersonaState(characterId: string): PersonaStateBlob | null {
    return this.persona.get(characterId)?.blob ?? null;
  }

  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void {
    this.persona.set(characterId, { blob, updatedAt });
  }

  storageUsage(): StorageUsage {
    const chars = new Set(this.rows.map((r) => r.characterId));
    return { dbBytes: 0, messageCount: this.rows.length, characterCount: chars.size };
  }

  async backupTo(): Promise<void> {
    // 内存实现无文件后端；导出由 ExportBundle 用 storageUsage/序列化兜底处理。
    return Promise.resolve();
  }

  close(): void {
    /* no-op */
  }
}
```
> 注：`slice(-limit)` 依赖插入即 ts 升序（SessionStore 顺序写入），与 SqliteStore 的 `ORDER BY ts` 语义一致。

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/desktop test memory-store` → PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/db/memory-store.ts apps/desktop/test/db/memory-store.test.ts
git commit -m "feat(desktop): in-memory ConversationStore (unit-test source of truth)"
```

---

## Task 6: 数据层 — SqliteStore + 工厂（含降级）

**Files:**
- Create: `apps/desktop/electron/main/db/sqlite-store.ts`
- Create: `apps/desktop/electron/main/db/index.ts`
- Create: `apps/desktop/test/db/sqlite-store.test.ts`（可加载 better-sqlite3 时才跑）

- [ ] **Step 1: 实现 `sqlite-store.ts`（运行时动态 require，typecheck 用纯类型包）**

```ts
import { createRequire } from 'node:module';
import type DatabaseT from 'better-sqlite3';
import type { PersonaStateBlob, StorageUsage } from '@desksoul/protocol';
import { PersonaStateBlobSchema } from '@desksoul/protocol';
import type { AppendMessageInput, ConversationStore, StoredRow } from './store.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

const require = createRequire(import.meta.url);

/** 抛错则说明原生模块不可用，工厂据此降级 MemoryStore。 */
export function loadBetterSqlite(): typeof DatabaseT {
  return require('better-sqlite3') as typeof DatabaseT;
}

export class SqliteStore implements ConversationStore {
  private readonly db: DatabaseT.Database;

  constructor(dbPath: string) {
    const Database = loadBetterSqlite();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.db
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  appendMessage(input: AppendMessageInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO messages
         (character_id, session_id, role, text, raw, ts, tokens_in, tokens_out, finish_reason, provider, model)
         VALUES (@characterId, @sessionId, @role, @text, @raw, @ts, @tokensIn, @tokensOut, @finishReason, @provider, @model)`,
      )
      .run({
        characterId: input.characterId,
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        raw: input.raw ?? null,
        ts: input.ts,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        finishReason: input.finishReason ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[] {
    const rows = this.db
      .prepare(
        `SELECT role, text, finish_reason AS finishReason, ts, tokens_in AS tokensIn, tokens_out AS tokensOut
         FROM messages WHERE character_id = ? AND session_id = ?
         ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all(characterId, sessionId, limit) as StoredRow[];
    return rows.reverse(); // 回到 ts 升序
  }

  getPersonaState(characterId: string): PersonaStateBlob | null {
    const row = this.db
      .prepare('SELECT blob_json AS blob FROM persona_state WHERE character_id = ?')
      .get(characterId) as { blob: string } | undefined;
    if (!row) return null;
    const parsed = PersonaStateBlobSchema.safeParse(JSON.parse(row.blob));
    return parsed.success ? parsed.data : null;
  }

  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO persona_state(character_id, blob_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET blob_json = excluded.blob_json, updated_at = excluded.updated_at`,
      )
      .run(characterId, JSON.stringify(blob), updatedAt);
  }

  storageUsage(): StorageUsage {
    const msg = this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    const chr = this.db
      .prepare('SELECT COUNT(DISTINCT character_id) AS n FROM messages')
      .get() as { n: number };
    const pages = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return { dbBytes: pages * pageSize, messageCount: msg.n, characterCount: chr.n };
  }

  async backupTo(dbPath: string): Promise<void> {
    await this.db.backup(dbPath); // better-sqlite3：一致性在线快照
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 2: 实现工厂 `db/index.ts`（降级逻辑）**

```ts
import type { ConversationStore } from './store.js';
import { MemoryStore } from './memory-store.js';
import { SqliteStore } from './sqlite-store.js';

export type { ConversationStore } from './store.js';
export { MemoryStore } from './memory-store.js';
export { SqliteStore } from './sqlite-store.js';

export interface CreateStoreOptions {
  /** 给了路径 → 尝试 SqliteStore；加载失败降级 MemoryStore。缺省纯内存（测试）。 */
  sqlitePath?: string;
}

export function createConversationStore(opts: CreateStoreOptions = {}): ConversationStore {
  if (!opts.sqlitePath) return new MemoryStore();
  try {
    return new SqliteStore(opts.sqlitePath);
  } catch (e) {
    console.warn('[db] better-sqlite3 unavailable, falling back to in-memory store:', e);
    return new MemoryStore();
  }
}
```

- [ ] **Step 3: 写集成测试 `apps/desktop/test/db/sqlite-store.test.ts`（条件 skip）**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';

let SqliteStore: typeof import('../../electron/main/db/sqlite-store.js').SqliteStore;
let available = false;

beforeAll(async () => {
  const mod = await import('../../electron/main/db/sqlite-store.js');
  SqliteStore = mod.SqliteStore;
  try {
    mod.loadBetterSqlite();
    available = true;
  } catch {
    available = false;
  }
});

describe.runIf(true)('SqliteStore (skips if better-sqlite3 not loadable)', () => {
  it('round-trips messages, persona, and reports usage', () => {
    if (!available) return; // 本地原生模块不可用：跳过，真机/CI 覆盖
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
    const store = new SqliteStore(join(dir, 'sessions.db'));
    try {
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'assistant', text: 'yo', ts: 2, finishReason: 'stop' });
      expect(store.recentMessages('c', 's', 10).map((r) => r.text)).toEqual(['hi', 'yo']);
      store.putPersonaState('c', { ...DEFAULT_PERSONA_STATE, affinity: 80 }, 9);
      expect(store.getPersonaState('c')?.affinity).toBe(80);
      const u = store.storageUsage();
      expect(u.messageCount).toBe(2);
      expect(u.dbBytes).toBeGreaterThan(0);
      const backup = join(dir, 'backup.db');
      return store.backupTo(backup).then(() => expect(existsSync(backup)).toBe(true));
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: 跑测试** — Run: `pnpm --filter @desksoul/desktop test sqlite-store`
Expected: better-sqlite3 可加载 → 实测 PASS；不可加载 → 用例内早 return，仍 PASS（标记在 RESULTS 待办）。

- [ ] **Step 5: typecheck** — Run: `pnpm --filter @desksoul/desktop typecheck` → PASS（`@types/better-sqlite3` 提供类型）。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main/db/sqlite-store.ts apps/desktop/electron/main/db/index.ts apps/desktop/test/db/sqlite-store.test.ts
git commit -m "feat(desktop): better-sqlite3 ConversationStore + factory with in-memory fallback"
```

---

## Task 7: 重构 SessionStore — 持久化委托给 ConversationStore

**Files:**
- Modify: `apps/desktop/electron/main/session-store.ts`
- Modify: `apps/desktop/test/session-store.test.ts`

**设计：** SessionStore 不再读写 JSON。构造注入 `store: ConversationStore` + `characterId`。运行时内存只保留每 session 的「当前 partial assistant 文本 + seq + streaming flag」；user 在 appendUser 即落库，assistant 在 finishAssistant 一次性落库。snapshot 从 store 读历史 + 拼当前 partial。

- [ ] **Step 1: 改测试 `session-store.test.ts`（注入 MemoryStore，删 JSON 持久化段）**

新顶部与构造：
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../electron/main/session-store.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';

describe('SessionStore - 会话记录（委托 ConversationStore）', () => {
  let store: SessionStore;
  let backend: MemoryStore;

  beforeEach(() => {
    backend = new MemoryStore();
    store = new SessionStore({ store: backend, characterId: 'default' });
  });
  afterEach(() => store.dispose());

  it('records user message', () => {
    store.appendUser('sess1', 'Hello');
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ role: 'user', text: 'Hello', finishReason: null });
    expect(snap.streaming).toBe(false);
    expect(snap.seq).toBe(0);
  });

  it('accumulates deltas in-memory, persists assistant on finish', () => {
    store.appendUser('sess1', 'Hi');
    store.beginAssistant('sess1');
    expect(store.appendDelta('sess1', 'Hel')).toBe(1);
    store.appendDelta('sess1', 'lo');
    const mid = store.snapshot('sess1');
    expect(mid.streaming).toBe(true);
    expect(mid.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: null });

    store.finishAssistant('sess1', 'stop');
    const done = store.snapshot('sess1');
    expect(done.streaming).toBe(false);
    expect(done.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: 'stop' });
    // 落库验证：MemoryStore 里有 user + assistant 两条
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(2);
  });

  it('snapshot reads persisted history across SessionStore instances (crash recovery)', () => {
    store.appendUser('sess1', 'Persisted');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'Reply');
    store.finishAssistant('sess1', 'stop');
    // 模拟重启：新 SessionStore 复用同一后端
    const reborn = new SessionStore({ store: backend, characterId: 'default' });
    const snap = reborn.snapshot('sess1');
    expect(snap.messages.map((m) => m.text)).toEqual(['Persisted', 'Reply']);
    expect(snap.streaming).toBe(false);
  });

  it('mid-stream partial is NOT persisted (lost on crash, acceptable MVP)', () => {
    store.appendUser('sess1', 'Q');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'partial');
    // 未 finish → 后端只有 user 一条
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(1);
  });

  it('recordUsage attaches tokens to the persisted assistant message', () => {
    store.appendUser('sess1', 'hi');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'yo');
    store.recordUsage('sess1', 3, 2);
    store.finishAssistant('sess1', 'stop');
    const a = backend.recentMessages('default', 'sess1', 10).at(-1)!;
    expect(a.tokensIn).toBe(3);
    expect(a.tokensOut).toBe(2);
  });

  it('keeps sessions independent (seq + messages)', () => {
    store.appendUser('sess1', 'A');
    store.appendUser('sess2', 'B');
    expect(store.snapshot('sess1').messages[0].text).toBe('A');
    expect(store.snapshot('sess2').messages[0].text).toBe('B');
  });

  it('snapshot of an unknown session is empty, not an error', () => {
    const snap = store.snapshot('unknown');
    expect(snap.messages).toEqual([]);
    expect(snap.streaming).toBe(false);
  });
});
```
> 删除原「JSON 持久化」describe 块、`recordUsage onto current message`（已并入上面）、`defensively opens assistant`（保留为内存防御，可加一条），与 `snapshot returns copies`（partial 拼接已是新对象）。原 `isStreaming`/seq 语义不变。

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/desktop test session-store` → FAIL（构造签名变了）。

- [ ] **Step 3: 重写 `session-store.ts`**

```ts
/**
 * SessionStore — 会话运行时状态机（seq / streaming / 当前轮 partial），
 * 持久化委托给注入的 ConversationStore（M6：JSON→SQLite）。
 *
 * 落库时机：user 在 appendUser 立刻 commit；assistant 在 finishAssistant 一次性
 * commit（含 finishReason + usage）。流式中途 partial 只在内存——Main 崩溃丢当轮
 * partial（可接受，与旧 JSON 版一致），已封口历史完整可恢复。
 * seq 不持久化：重启后从 0 重新计数（跨进程无流）。
 */
import type { ConversationStore } from './db/store.js';

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SessionSnapshot {
  sessionId: string;
  messages: StoredMessage[];
  streaming: boolean;
  seq: number;
}

export interface SessionStoreOptions {
  store: ConversationStore;
  characterId: string;
  /** 时间戳源（测试可注入单调计数；缺省 Date.now）。 */
  now?: () => number;
}

interface Partial {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export class SessionStore {
  private readonly store: ConversationStore;
  private readonly characterId: string;
  private readonly now: () => number;
  private readonly seqs = new Map<string, number>();
  private readonly partials = new Map<string, Partial>(); // 仅 streaming 中的 assistant

  constructor(opts: SessionStoreOptions) {
    this.store = opts.store;
    this.characterId = opts.characterId;
    this.now = opts.now ?? (() => Date.now());
  }

  appendUser(sessionId: string, text: string): void {
    this.store.appendMessage({
      characterId: this.characterId,
      sessionId,
      role: 'user',
      text,
      ts: this.now(),
      finishReason: null,
    });
  }

  beginAssistant(sessionId: string): void {
    this.partials.set(sessionId, { text: '' });
  }

  appendDelta(sessionId: string, text: string): number {
    const p = this.partials.get(sessionId) ?? { text: '' };
    p.text += text;
    this.partials.set(sessionId, p);
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    this.seqs.set(sessionId, seq);
    return seq;
  }

  finishAssistant(sessionId: string, reason: 'stop' | 'cancel' | 'error'): void {
    const p = this.partials.get(sessionId);
    if (!p) return; // 没有在途 assistant（防御）
    this.partials.delete(sessionId);
    this.store.appendMessage({
      characterId: this.characterId,
      sessionId,
      role: 'assistant',
      text: p.text,
      ts: this.now(),
      finishReason: reason,
      tokensIn: p.tokensIn ?? null,
      tokensOut: p.tokensOut ?? null,
    });
  }

  recordUsage(sessionId: string, tokensIn: number, tokensOut: number): void {
    const p = this.partials.get(sessionId);
    if (p) {
      p.tokensIn = tokensIn;
      p.tokensOut = tokensOut;
    }
  }

  isStreaming(sessionId: string): boolean {
    return this.partials.has(sessionId);
  }

  snapshot(sessionId: string, limit = 50): SessionSnapshot {
    const rows = this.store.recentMessages(this.characterId, sessionId, limit);
    const messages: StoredMessage[] = rows.map((r) => ({
      role: r.role,
      text: r.text,
      finishReason: r.finishReason,
      ...(r.tokensIn != null ? { tokensIn: r.tokensIn } : {}),
      ...(r.tokensOut != null ? { tokensOut: r.tokensOut } : {}),
    }));
    const p = this.partials.get(sessionId);
    if (p) messages.push({ role: 'assistant', text: p.text, finishReason: null });
    return {
      sessionId,
      messages,
      streaming: !!p,
      seq: this.seqs.get(sessionId) ?? 0,
    };
  }

  dispose(): void {
    /* 持久化由 store 负责；此处仅清运行时态 */
    this.partials.clear();
    this.seqs.clear();
  }
}
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/desktop test session-store` → PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/session-store.ts apps/desktop/test/session-store.test.ts
git commit -m "refactor(desktop): SessionStore delegates persistence to ConversationStore (SQLite)"
```

---

## Task 8: ContextAssembler

**Files:**
- Create: `apps/desktop/electron/main/context-assembler.ts`
- Create: `apps/desktop/test/context-assembler.test.ts`

- [ ] **Step 1: 写失败测试 `context-assembler.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleContext } from '../electron/main/context-assembler.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';

const CH = { id: 'default', name: '小灵', emotions: ['happy', 'shy'], actions: ['wave'] };

describe('assembleContext', () => {
  it('prepends a system prompt and appends the current user message', () => {
    const store = new MemoryStore();
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: '你好' });
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).toContain('小灵');
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: '你好' });
  });

  it('injects working memory (recent turns) between system and current user', () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'q1', ts: 1 });
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'assistant', text: 'a1', ts: 2, finishReason: 'stop' });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'q2' });
    expect(req.messages.map((m) => m.content)).toEqual([
      req.messages[0].content, // system
      'q1',
      'a1',
      'q2',
    ]);
  });

  it('caps working memory to the last WORKING_TURNS messages', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 50; i++) {
      store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'now' });
    // system + 20 working + 1 current
    expect(req.messages).toHaveLength(22);
  });

  it('reflects persisted persona state in the system prompt', () => {
    const store = new MemoryStore();
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 88 }, 1);
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages[0].content).toMatch(/88/);
  });

  it('filters out empty-text messages from history', () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'assistant', text: '', ts: 1, finishReason: 'cancel' });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages.filter((m) => m.content === '')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/desktop test context-assembler` → FAIL。

- [ ] **Step 3: 实现 `context-assembler.ts`**

```ts
import { buildSystemPrompt, DEFAULT_PERSONA_STATE, type ChatRequest } from '@desksoul/protocol';
import type { ConversationStore } from './db/store.js';

/** Working Memory 窗口（tech-design §8：最近 N=20 轮原始消息）。 */
export const WORKING_TURNS = 20;

export interface AssembleInput {
  store: ConversationStore;
  character: { id: string; name: string; emotions?: readonly string[]; actions?: readonly string[] };
  sessionId: string;
  userText: string;
}

/**
 * 组装单轮 ChatRequest（MVP：Working + Persona）。
 * messages = [system(人设+persona+行为标签规约), ...最近20轮(非空), {user, 当前输入}]。
 * Episodic 召回 / Semantic 硬注入 / token budget packing 留 V1+（tech-design §8）。
 */
export function assembleContext(input: AssembleInput): ChatRequest {
  const persona = input.store.getPersonaState(input.character.id) ?? DEFAULT_PERSONA_STATE;
  const system = buildSystemPrompt({
    name: input.character.name,
    persona,
    ...(input.character.emotions ? { emotions: input.character.emotions } : {}),
    ...(input.character.actions ? { actions: input.character.actions } : {}),
  });
  const history = input.store
    .recentMessages(input.character.id, input.sessionId, WORKING_TURNS)
    .filter((r) => r.text.length > 0)
    .map((r) => ({ role: r.role, content: r.text }));
  return {
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: input.userText },
    ],
  };
}
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/desktop test context-assembler` → PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/context-assembler.ts apps/desktop/test/context-assembler.test.ts
git commit -m "feat(desktop): ContextAssembler (system prompt + working memory) → ChatRequest"
```

---

## Task 9: 导出 .dsbak（adm-zip）

**Files:**
- Create: `apps/desktop/electron/main/db/export-bundle.ts`
- Create: `apps/desktop/test/db/export-bundle.test.ts`

- [ ] **Step 1: 写失败测试 `export-bundle.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { exportDsbak } from '../../electron/main/db/export-bundle.js';
import { MemoryStore } from '../../electron/main/db/memory-store.js';

describe('exportDsbak', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('writes a zip containing manifest.json with usage metadata (no secrets)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsbak-'));
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    const out = join(dir, 'backup.dsbak');
    await exportDsbak(store, out, { now: () => 12345 });

    expect(existsSync(out)).toBe(true);
    const zip = new AdmZip(out);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    expect(names).not.toContain('secrets.kc');
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.messageCount).toBe(1);
    expect(manifest.exportedAt).toBe(12345);
    expect(manifest.characterIds).toContain('default');
  });
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/desktop test export-bundle` → FAIL。

- [ ] **Step 3: 实现 `export-bundle.ts`**

```ts
import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportManifest } from '@desksoul/protocol';
import type { ConversationStore } from './store.js';
import { SCHEMA_VERSION } from './schema.js';

export interface ExportOptions {
  now?: () => number;
  /** SqliteStore 的源 db 路径（有则一致性快照进 zip）；MemoryStore 省略。 */
  sqlitePath?: string;
}

/**
 * 导出 .dsbak（zip）：manifest.json（元信息）+ sessions.db（若有 sqlite 后端）。
 * 决策：不含 secrets.kc（密钥绑机器、有泄露风险）。
 */
export async function exportDsbak(
  store: ConversationStore,
  outPath: string,
  opts: ExportOptions = {},
): Promise<void> {
  const now = opts.now ?? (() => Date.now());
  const usage = store.storageUsage();
  const manifest: ExportManifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    characterIds: ['default'], // MVP 单角色；多角色时 store 暴露 listCharacters()
    messageCount: usage.messageCount,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  if (opts.sqlitePath) {
    const tmp = await mkdtemp(join(tmpdir(), 'dsbak-src-'));
    const snap = join(tmp, 'sessions.db');
    await store.backupTo(snap);
    if (existsSync(snap)) zip.addLocalFile(snap, '', 'sessions.db');
  }
  zip.writeZip(outPath);
}
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/desktop test export-bundle` → PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/db/export-bundle.ts apps/desktop/test/db/export-bundle.test.ts
git commit -m "feat(desktop): export .dsbak (manifest + db snapshot, no secrets)"
```

---

## Task 10: 协议层 — app.storageUsage / app.exportData 方法签名

**Files:**
- Modify: `packages/protocol/src/methods.ts`
- Modify: `packages/protocol/test/methods.test.ts`（追加用例；若无此文件则在 schemas/methods 既有测试追加）

- [ ] **Step 1: 追加失败测试（验证新方法已注册且 params/result 校验）**

```ts
// methods.test.ts 追加
import { Methods } from '../src/methods';

it('registers app.storageUsage and app.exportData', () => {
  expect(Methods['app.storageUsage']).toBeDefined();
  expect(Methods['app.exportData']).toBeDefined();
  expect(() => Methods['app.exportData'].params.parse({ outPath: 'C:/x/backup.dsbak' })).not.toThrow();
  expect(() => Methods['app.storageUsage'].result.parse({ dbBytes: 0, messageCount: 0, characterCount: 0 })).not.toThrow();
});
```

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/protocol test methods` → FAIL。

- [ ] **Step 3: 在 `methods.ts` 的 `app.*` 段加方法**

```ts
  // --- request/response: Renderer → Main（数据管理，M6；D7 UI 在 M7 接）---
  'app.storageUsage': {
    params: z.object({}),
    result: z.object({
      dbBytes: z.number().int().nonnegative(),
      messageCount: z.number().int().nonnegative(),
      characterCount: z.number().int().nonnegative(),
    }),
  },
  'app.exportData': {
    // outPath 由 Renderer 经系统保存对话框拿到（M7 接 dialog）；M6 直接收路径。
    params: z.object({ outPath: z.string().min(1) }),
    result: z.object({ ok: z.literal(true), bytes: z.number().int().nonnegative() }),
  },
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/protocol test methods` → PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/methods.ts packages/protocol/test/methods.test.ts
git commit -m "feat(protocol): app.storageUsage + app.exportData method signatures"
```

---

## Task 11: ChatService 接线 — store + ContextAssembler + persona 更新 + 数据 RPC

**Files:**
- Modify: `apps/desktop/electron/main/chat-service.ts`
- Modify: `apps/desktop/test/chat-service.test.ts`（追加用例）

**改动点：**
1. 构造从 `persistPath` 改为注入 `store: ConversationStore` + `character: () => { id; name; emotions?; actions? }`。
2. `send()`：用 `assembleContext` 替换 line 95-100 裸拼接。
3. 捕获本轮 intent：`onNotification` 看到 `behavior.setIntent` 时存入 `lastIntent.set(sessionId, {mood, energy})`。
4. `done(stop)` 收尾后：`updatePersonaState` 并 `store.putPersonaState`。
5. 新增 `storageUsage()` 与 `exportData(outPath)` 方法。

- [ ] **Step 1: 追加失败测试 `chat-service.test.ts`（用 MemoryStore + mock provider）**

```ts
// 关键断言（沿用现有 chat-service.test.ts 的 mock 构造风格）：
it('persists messages via injected store and assembles system prompt', async () => {
  const store = new MemoryStore();
  const svc = new ChatService({
    providerEntryPath: MOCK_ENTRY,
    broadcast: () => {},
    store,
    character: () => ({ id: 'default', name: '小灵', emotions: ['happy'], actions: ['wave'] }),
  });
  svc.send('s', '你好');
  // …等流结束（沿用现有测试的 done 等待工具）…
  await waitForDone(svc, 's');
  const rows = store.recentMessages('default', 's', 10);
  expect(rows[0]).toMatchObject({ role: 'user', text: '你好' });
  expect(store.getPersonaState('default')?.turns).toBe(1); // 每轮 +1
  await svc.dispose();
});

it('storageUsage and exportData delegate to the store', async () => {
  const store = new MemoryStore();
  const svc = new ChatService({ providerEntryPath: MOCK_ENTRY, broadcast: () => {}, store, character: () => ({ id: 'default', name: '小灵' }) });
  expect(svc.storageUsage().messageCount).toBe(0);
  await svc.dispose();
});
```
> 沿用文件里已有的 mock provider entry 与 done 等待 helper（M5 已建）；上面是断言意图，落地时对齐现有 helper 名。

- [ ] **Step 2: 跑红** — Run: `pnpm --filter @desksoul/desktop test chat-service` → FAIL（构造签名变）。

- [ ] **Step 3: 改 `chat-service.ts`**

`ChatServiceOptions`：删 `persistPath`，加：
```ts
  store: import('./db/store.js').ConversationStore;
  character: () => { id: string; name: string; emotions?: readonly string[]; actions?: readonly string[] };
```
构造：
```ts
    this.store = opts.store;
    this.character = opts.character;
    this.session = new SessionStore({ store: opts.store, characterId: opts.character().id });
```
（`SessionStore` 字段名沿用 `this.store`→改名 `this.session` 以免与 ConversationStore 混淆；同步改 send/cancel/snapshot/onNotification/onProviderEvent 内的引用。）

`send()` 组装替换：
```ts
  send(sessionId: string, text: string, providerId?: string): { ok: true } {
    if (this.session.isStreaming(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    const chain = providerId ? [providerId] : this.providerChain;
    const request = assembleContext({
      store: this.store,
      character: this.character(),
      sessionId,
      userText: text,
    });
    try {
      if (chain.length > 0) {
        this.attempt.set(sessionId, { chain, idx: 0, request });
        this.sawDelta.set(sessionId, false);
        this.host.send(sessionId, { providerId: chain[0]!, request });
      } else {
        this.host.send(sessionId, {});
      }
    } catch {
      throw new RpcError(-32002, 'provider unavailable (worker restarting)');
    }
    this.session.appendUser(sessionId, text);
    this.session.beginAssistant(sessionId);
    return { ok: true };
  }
```

intent 捕获 + persona 更新：
```ts
  private readonly lastIntent = new Map<string, { mood?: string; energy?: string }>();

  // onNotification 内 behavior.setIntent 分支：
  case 'behavior.setIntent':
    this.lastIntent.set(n.sessionId, { mood: n.params.mood, energy: n.params.energy });
    this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params });
    return;

  // chat.done 分支收尾后（finishReason === 'stop' 时）更新 persona：
  case 'chat.done': {
    this.session.finishAssistant(n.sessionId, n.params.finishReason);
    if (n.params.finishReason === 'stop') {
      const cid = this.character().id;
      const prev = this.store.getPersonaState(cid) ?? DEFAULT_PERSONA_STATE;
      const intent = this.lastIntent.get(n.sessionId) ?? {};
      const ts = Date.now();
      this.store.putPersonaState(cid, updatePersonaState(prev, { ...intent, ts }), ts);
    }
    this.lastIntent.delete(n.sessionId);
    this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params }, { urgent: true });
    return;
  }
```
> 注意：`chat.stream` 分支里 `this.store.appendDelta` 改为 `this.session.appendDelta`（拿 seq）；`recordUsage` 同理走 `this.session`。`snapshot` 走 `this.session.snapshot`。

新增方法：
```ts
  storageUsage(): import('@desksoul/protocol').StorageUsage {
    return this.store.storageUsage();
  }
  async exportData(outPath: string): Promise<{ ok: true; bytes: number }> {
    await exportDsbak(this.store, outPath, this.sqlitePath ? { sqlitePath: this.sqlitePath } : {});
    const { statSync } = await import('node:fs');
    return { ok: true, bytes: statSync(outPath).size };
  }
```
（`this.sqlitePath` 由构造可选注入，用于 backup 进 zip；缺省仅 manifest。）

`dispose()`：`this.session.dispose()`（不再 await store.dispose；store.close 由 ipc-router dispose 调）。

imports 顶部加：
```ts
import { assembleContext } from './context-assembler.js';
import { exportDsbak } from './db/export-bundle.js';
import { DEFAULT_PERSONA_STATE, updatePersonaState } from '@desksoul/protocol';
```

- [ ] **Step 4: 跑绿** — Run: `pnpm --filter @desksoul/desktop test chat-service` → PASS（含 M5 既有 e2e/fallback/tool 用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main/chat-service.ts apps/desktop/test/chat-service.test.ts
git commit -m "feat(desktop): ChatService uses ConversationStore + ContextAssembler + persona update"
```

---

## Task 12: Main 接线 — ipc-router + index.ts

**Files:**
- Modify: `apps/desktop/electron/main/ipc-router.ts`
- Modify: `apps/desktop/electron/main/index.ts`

- [ ] **Step 1: 改 `ipc-router.ts`**

`IpcRouterDeps`：删 `persistPath`，加：
```ts
  /** sessions.db 路径（生产 userData/data/sessions.db；测试省略=纯内存）。 */
  sqlitePath?: string;
```
函数体：
```ts
  const store = createConversationStore(deps.sqlitePath ? { sqlitePath: deps.sqlitePath } : {});
  const characters = createCharacterService(deps.charactersRoot);
  const chat = new ChatService({
    providerEntryPath: deps.providerEntryPath,
    broadcast,
    store,
    character: () => {
      const c = characters.current();
      return {
        id: c.characterId,
        name: c.manifest.name,
        ...(c.manifest.emotions ? { emotions: Object.keys(c.manifest.emotions) } : {}),
        ...(c.manifest.actions ? { actions: c.manifest.actions } : {}),
      };
    },
    ...(deps.sqlitePath ? { sqlitePath: deps.sqlitePath } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.defaultProviderId ? { defaultProviderId: deps.defaultProviderId } : {}),
  });
```
router handlers 追加：
```ts
    'app.storageUsage': () => chat.storageUsage(),
    'app.exportData': (p) => chat.exportData(p.outPath),
```
dispose 追加 `store.close()`：
```ts
    dispose: async () => {
      ipcMain.removeHandler('desksoul:rpc');
      await chat.dispose();
      store.close();
    },
```
（删除 `import { createCharacterService }` 的重复——确认现有已 import；characters 实例上移到 chat 之前。）

- [ ] **Step 2: 改 `index.ts`（路径：userData/data/sessions.db）**

```ts
import { mkdirSync } from 'node:fs';
// …app.whenReady 内：
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  // …registerIpcRouter({ … }) 内：
  //   把 persistPath: …sessions.json  替换为：
  sqlitePath: path.join(dataDir, 'sessions.db'),
```
（删除原 `persistPath` 行。）

- [ ] **Step 3: typecheck + 全量测试** — Run: `pnpm --filter @desksoul/desktop typecheck && pnpm --filter @desksoul/desktop test`
Expected: 全绿（ipc-router 若有单测同步更新；e2e-smoke 仍用 mock provider）。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts
git commit -m "feat(desktop): wire SQLite store + data-mgmt RPC into Main (userData/data/sessions.db)"
```

---

## Task 13: 验收 — 性能/规模 + 文档收尾

**Files:**
- Create: `apps/desktop/test/db/acceptance.test.ts`
- Create: `apps/desktop/RESULTS-M6.md`
- Modify: `CLAUDE.md`（项目状态行：M6 完成，下一里程碑 M7）
- Modify: `docs/plans/2026-05-01-desksoul-tech-design.md`（§6 messages 表补 `finish_reason` 列 + 决策记录脚注）

- [ ] **Step 1: 写验收测试 `acceptance.test.ts`（SqliteStore 可用时跑，否则 skip 并 log）**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('M6 acceptance — 100 turns scale & query latency', () => {
  it('100 turns keep db < 5MB and recent-20 query < 10ms', async () => {
    const mod = await import('../../electron/main/db/sqlite-store.js');
    try { mod.loadBetterSqlite(); } catch { return; } // 原生不可用：真机覆盖
    const dir = mkdtempSync(join(tmpdir(), 'm6-accept-'));
    const store = new mod.SqliteStore(join(dir, 'sessions.db'));
    try {
      for (let i = 0; i < 100; i++) {
        store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: `u${i}`.repeat(20), ts: i * 2 });
        store.appendMessage({ characterId: 'default', sessionId: 's', role: 'assistant', text: `a${i}`.repeat(40), ts: i * 2 + 1, finishReason: 'stop' });
      }
      const usage = store.storageUsage();
      expect(usage.messageCount).toBe(200);
      expect(usage.dbBytes).toBeLessThan(5 * 1024 * 1024);
      const t0 = performance.now();
      const recent = store.recentMessages('default', 's', 20);
      const dt = performance.now() - t0;
      expect(recent).toHaveLength(20);
      expect(dt).toBeLessThan(10);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 跑全仓** — Run: `pnpm -r typecheck && pnpm -r test`
Expected: 全绿（SqliteStore 相关在原生不可用时 skip）。

- [ ] **Step 3: 写 `RESULTS-M6.md`** — 验收映射表（三条验收口径 + 结果）、接口化决策、真机待办（better-sqlite3 安装/electron-rebuild、100 轮真机性能、强杀重启恢复手测）、测试规模。

- [ ] **Step 4: 更新 `CLAUDE.md` 状态行**（M6 完成；下一里程碑 M7 设置面板 UI）+ tech-design §6 补 `finish_reason` 列与决策脚注。

- [ ] **Step 5: Commit + tag**

```bash
git add apps/desktop/test/db/acceptance.test.ts apps/desktop/RESULTS-M6.md CLAUDE.md docs/plans/2026-05-01-desksoul-tech-design.md
git commit -m "test(desktop): M6 acceptance (scale/latency) + RESULTS-M6 + status/design update"
git tag mvp/M6-done
```

---

## 验收映射（impl-plan M6）

| 验收项 | 本计划覆盖 | 口径 |
| --- | --- | --- |
| 跑 100 轮对话，DB < 5MB，查询最近 20 轮 < 10ms | Task 13 acceptance.test | SqliteStore 实测（原生可用）；否则真机待办 |
| 强杀进程后重启对话历史完整 | Task 7（snapshot 跨实例读 SQLite）+ 真机手测 | 已封口历史完整；当轮 partial 丢失为既有可接受行为 |
| D7 数据管理 UI 能看到存储占用 | Task 10/11/12（app.storageUsage RPC）；UI 留 M7 | 用户确认「仅后端 + RPC」 |
| better-sqlite3 + WAL，schema 四表 | Task 4/6 | schema.ts + SqliteStore（WAL pragma） |
| 单连接归 Main，Worker 不直连 | 架构（ChatService 持唯一 store；Worker 仅 provider/fetch） | 不新增 Worker DB 通道 |
| 每条 msg 立刻 commit；每轮更新 persona_state | Task 7（user/assistant 落库）+ Task 11（done→putPersonaState） | |
| ContextAssembler（Working 20 轮 + persona）→ ProviderRequest | Task 8 + Task 11 | |
| 角色隔离（character_id 强制前缀） | Task 5/6（所有查询带 character_id）+ Task 7（注入 characterId） | |
| 导出一键 .dsbak zip | Task 9 + Task 11/12（app.exportData） | 仅 DB + manifest，无密钥 |
| Episodic/Semantic/sqlite-vec stub | Task 4（facts/episodes 建表）；接口留空 | V1.0 启用 |

## 风险与回退

- **better-sqlite3 本地装不上**：接口化已兜底（MemoryStore），app 可启动、业务单测全绿；SqliteStore/acceptance 用例 skip。真机/CI 验证。**不阻塞 M6 其余 task。**
- **旧 `sessions.json` 数据**：M6 切到 SQLite，旧 JSON 不迁移（开发期数据，可丢）。生产首发无历史用户，无需迁移脚本。
- **adm-zip 装不上**：导出 task 受影响；可临时改为「写目录 + 不打包」并记待办（不影响验收三条硬指标）。
