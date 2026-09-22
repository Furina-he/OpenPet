/**
 * ⑲ 一次性迁移（spec §4）：旧 `memory_fact` 扁平事实 → wiki。
 *
 * 触发：启动 / 切角色时，某角色 memory_fact 有行且未迁移（标记文件 characters/<id>/migration.json
 * 不存在）→ pinned 事实直接写入 profile「杂项」节并 `<!-- locked -->`（用户意志不过 LLM）；
 * 其余按 40 条一批走编译器「初始化整理」模式（第二个角色迁移时 profile 已存在 → prompt 明示合并）。
 * 全部批次成功才写标记（失败可重试）；旧表只读不删；同角色并发去重。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { MEMORY_LOCKED_MARK } from '@openpet/protocol';
import type { ConversationStore } from './db/index.js';
import type { CompileResult } from './memory-compiler.js';
import { joinSections, MemoryWiki, PROFILE_PATH, splitSections } from './memory-wiki.js';

export interface MemoryMigratorDeps {
  store: ConversationStore;
  wiki: MemoryWiki;
  compileFacts: (cid: string, facts: readonly string[]) => Promise<CompileResult>;
  onDone?: ((info: { characterId: string; from: number }) => void) | undefined;
  batchSize?: number;
  now?: () => number;
}

export interface MigrationRecord {
  characterId: string;
  from: number;
  at: number;
}

export function createMemoryMigrator(deps: MemoryMigratorDeps) {
  const batch = deps.batchSize ?? 40;
  const now = deps.now ?? Date.now;
  const inflight = new Set<string>();
  const markerPath = (cid: string): string =>
    path.join(deps.wiki.root, 'characters', cid, 'migration.json');

  function status(cid: string): MigrationRecord | null {
    const f = markerPath(cid);
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as MigrationRecord;
    } catch {
      return null;
    }
  }

  /** pinned → profile「杂项」节：加锁定标记 + 追加未存在的行（直接写盘，不过 LLM）。 */
  function writePinned(cid: string, texts: readonly string[]): void {
    if (texts.length === 0) return;
    deps.wiki.ensureLayout(cid);
    const page = deps.wiki.readPage(PROFILE_PATH);
    if (!page) return;
    const parsed = splitSections(page.body);
    const misc = parsed.sections.find((s) => s.name === '杂项');
    if (!misc) return;
    const body = misc.body.replace(MEMORY_LOCKED_MARK, '').trim();
    const lines = body ? body.split('\n') : [];
    for (const t of texts) {
      const line = `- ${t.trim()}`;
      if (!lines.includes(line)) lines.push(line);
    }
    misc.body = `${MEMORY_LOCKED_MARK}\n${lines.join('\n')}`;
    deps.wiki.writePage({
      ...page,
      frontmatter: { ...page.frontmatter, source: 'user', updated: deps.wiki.today() },
      body: joinSections(parsed),
    });
  }

  return {
    status,
    needsMigration(cid: string): boolean {
      return status(cid) === null && deps.store.memoryCount(cid) > 0;
    },
    /** 幂等：已迁移 / 无旧行 / 进行中 → ran:false。 */
    async maybeRun(cid: string): Promise<{ ran: boolean; ok?: boolean; from?: number }> {
      if (inflight.has(cid) || status(cid) !== null) return { ran: false };
      const facts = deps.store.memoryList(cid);
      if (facts.length === 0) return { ran: false };
      inflight.add(cid);
      try {
        writePinned(
          cid,
          facts.filter((f) => f.pinned).map((f) => f.text),
        );
        const rest = facts.filter((f) => !f.pinned).map((f) => f.text);
        let ok = true;
        for (let i = 0; i < rest.length; i += batch) {
          const r = await deps.compileFacts(cid, rest.slice(i, i + batch));
          if (!r.ok) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const rec: MigrationRecord = { characterId: cid, from: facts.length, at: now() };
          const f = markerPath(cid);
          mkdirSync(path.dirname(f), { recursive: true });
          writeFileSync(`${f}.tmp`, JSON.stringify(rec), 'utf8');
          renameSync(`${f}.tmp`, f);
          deps.onDone?.({ characterId: cid, from: facts.length });
        }
        return { ran: true, ok, from: facts.length };
      } finally {
        inflight.delete(cid);
      }
    },
  };
}

export type MemoryMigrator = ReturnType<typeof createMemoryMigrator>;
