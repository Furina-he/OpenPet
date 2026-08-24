/**
 * ⑯ MarketService —— market.* RPC（spec §3）：静态索引多源拉取 + 校验下载。
 *
 * 零服务器：索引 = GitHub 仓的 `index.json`（jsDelivr / raw 双源预置，直连 GitHub
 * 不通是硬约束）。形状照抄 `plugins.marketFetch` / `plugins.installFromUrl`：
 * Main 侧 fetch（renderer 无跨域能力）→ 临时文件 → **不安装**，返回摘要给 UI 确认。
 *
 * 安全：下载物一律 sha256 校验（不符即删文件 + -32602），随后走既有
 * `pack-import` / `soul-compose` / `body-pack` 安全门——本服务不新增任何安全面。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMarketIndex, type MarketItem, type MarketItemType } from '@openpet/protocol';
import { inspectBody } from './body-pack.js';
import { inspectPack } from './pack-import.js';
import { readSoulPack } from './soul-compose.js';
import { RpcError } from './router.js';

export interface MarketFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MarketServiceDeps {
  /** 索引拉取 + 下载（index 注入 net.fetch 网关；测试注入 fake）。 */
  fetchImpl?: (url: string) => Promise<MarketFetchResponse>;
  /** pref `market.sources`。 */
  getSources: () => string[];
  /** 下载体积上限（防坏源塞巨物）；缺省 300MB，与 pack-import 解压上限同量级。 */
  maxDownloadBytes?: number;
  /** 临时下载目录父级；缺省系统 tmp（测试注入隔离目录）。 */
  tmpRoot?: string;
  log?: (msg: string) => void;
}

export interface MarketSourceStatus {
  url: string;
  ok: boolean;
  count: number;
  error?: string;
}

const DEFAULT_MAX_DOWNLOAD = 300 * 1024 * 1024;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createMarketService(deps: MarketServiceDeps) {
  const log = deps.log ?? ((msg: string) => console.info(`[market] ${msg}`));
  const maxBytes = deps.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD;

  const fetchOne = async (
    url: string,
  ): Promise<{ status: MarketSourceStatus; items: MarketItem[]; dropped: number }> => {
    if (!deps.fetchImpl) throw new Error('market fetch not configured');
    const res = await deps.fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseMarketIndex(JSON.parse(await res.text()) as unknown);
    return {
      status: { url, ok: true, count: parsed.items.length },
      items: parsed.items,
      dropped: parsed.dropped,
    };
  };

  return {
    /** 多源并发拉取；单源失败不影响其他源（错误进 sources chip），按 id 合并去重（先出现优先）。 */
    'market.fetchIndex': async () => {
      const urls = deps.getSources();
      const settled = await Promise.allSettled(urls.map((u) => fetchOne(u)));
      const sources: MarketSourceStatus[] = [];
      const byId = new Map<string, MarketItem>();
      let dropped = 0;
      settled.forEach((r, i) => {
        const url = urls[i] ?? '';
        if (r.status === 'fulfilled') {
          sources.push(r.value.status);
          dropped += r.value.dropped;
          for (const item of r.value.items) if (!byId.has(item.id)) byId.set(item.id, item);
        } else {
          const error = errText(r.reason);
          log(`source failed ${url}: ${error}`);
          sources.push({ url, ok: false, count: 0, error });
        }
      });
      return { items: [...byId.values()], sources, dropped };
    },

    /** 下载到临时文件 + sha256 校验 + 按 type 解析摘要；**不安装**（UI 确认后走 import*Apply）。 */
    'market.download': async (p: { url: string; sha256: string; type: MarketItemType }) => {
      if (!deps.fetchImpl) throw new RpcError(-32603, 'market fetch not configured');
      let res: MarketFetchResponse;
      try {
        res = await deps.fetchImpl(p.url);
      } catch (e) {
        throw new RpcError(-32603, `下载失败：${errText(e)}`);
      }
      if (!res.ok) throw new RpcError(-32603, `下载失败：HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new RpcError(-32602, '下载物超过 300MB 上限');

      const kind: 'pack' | 'soul' | 'body' =
        p.type === 'full' ? 'pack' : p.type === 'body' ? 'body' : 'soul';
      const staging = mkdtempSync(path.join(deps.tmpRoot ?? tmpdir(), 'ds-market-'));
      const file = path.join(staging, `download.${kind === 'pack' ? 'dspack' : kind === 'body' ? 'dsbody' : 'dssoul'}`);
      writeFileSync(file, buf);
      try {
        const digest = createHash('sha256').update(buf).digest('hex');
        if (digest !== p.sha256.toLowerCase()) {
          throw new RpcError(-32602, `校验失败：sha256 不匹配（期望 ${p.sha256}，实际 ${digest}）`);
        }
        if (kind === 'pack') {
          const m = inspectPack(file);
          return {
            path: file,
            kind,
            summary: {
              id: m.id,
              name: m.name,
              version: m.version,
              engine: m.engine,
              ...(m.author ? { author: m.author } : {}),
              ...(m.license ? { license: m.license } : {}),
              ...(m.persona?.greetings ? { greetingCount: m.persona.greetings.length } : {}),
              ...(m.lorebook ? { lorebookCount: m.lorebook.entries.length } : {}),
            },
          };
        }
        if (kind === 'body') {
          // ⑰ 肉体包：摘要只有形象面（引擎/词表数），无灵魂字段可报。
          const b = inspectBody(file);
          return {
            path: file,
            kind,
            summary: {
              id: b.id,
              name: b.name,
              version: b.version,
              engine: b.engine,
              ...(b.author ? { author: b.author } : {}),
              ...(b.license ? { license: b.license } : {}),
            },
          };
        }
        const { soul } = readSoulPack(file);
        return {
          path: file,
          kind,
          summary: {
            id: soul.id,
            name: soul.name,
            version: soul.version,
            ...(soul.author ? { author: soul.author } : {}),
            ...(soul.license ? { license: soul.license } : {}),
            greetingCount: soul.persona.greetings?.length ?? 0,
            lorebookCount: soul.lorebook?.entries.length ?? 0,
          },
        };
      } catch (e) {
        rmSync(staging, { recursive: true, force: true }); // 校验/解析失败即清理临时文件
        if (e instanceof RpcError) throw e;
        throw new RpcError(-32602, `下载物无法解析：${errText(e)}`);
      }
    },
  };
}
