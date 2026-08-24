import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMarketService, type MarketFetchResponse } from '../electron/main/market-service.js';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sage',
    name: '贤者',
    version: '1.0.0',
    type: 'soul',
    license: 'CC0-1.0',
    downloadUrl: 'https://example.com/sage.dssoul',
    sha256: 'a'.repeat(64),
    ...over,
  };
}

/** 注入式 fetch：url → 文本或字节；未登记的 url 抛（模拟坏源/断网）。 */
function fakeFetch(routes: Record<string, string | Buffer | Error | { status: number }>) {
  return async (url: string): Promise<MarketFetchResponse> => {
    const r = routes[url];
    if (r === undefined) throw new Error(`ENOTFOUND ${url}`);
    if (r instanceof Error) throw r;
    if (!Buffer.isBuffer(r) && typeof r !== 'string') {
      return {
        ok: false,
        status: r.status,
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    const buf = Buffer.isBuffer(r) ? r : Buffer.from(r, 'utf8');
    return {
      ok: true,
      status: 200,
      text: async () => buf.toString('utf8'),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    };
  };
}

const A = 'https://cdn.example/index.json';
const B = 'https://raw.example/index.json';

describe('market.fetchIndex（多源）', () => {
  it('多源合并去重：同 id 先出现的源优先', async () => {
    const svc = createMarketService({
      getSources: () => [A, B],
      fetchImpl: fakeFetch({
        [A]: JSON.stringify({ version: 1, items: [item({ version: '1.0.0' })] }),
        [B]: JSON.stringify({
          version: 1,
          items: [item({ version: '9.9.9' }), item({ id: 'other' })],
        }),
      }),
      log: () => {},
    });
    const r = await svc['market.fetchIndex']();
    expect(r.items.map((i) => i.id).sort()).toEqual(['other', 'sage']);
    expect(r.items.find((i) => i.id === 'sage')?.version).toBe('1.0.0'); // A 先出现
    expect(r.sources.every((s) => s.ok)).toBe(true);
  });

  it('单源失败其余照常，失败源进 sources chip 带错误文案', async () => {
    const svc = createMarketService({
      getSources: () => [A, B],
      fetchImpl: fakeFetch({ [B]: JSON.stringify([item()]) }),
      log: () => {},
    });
    const r = await svc['market.fetchIndex']();
    expect(r.items).toHaveLength(1);
    const bad = r.sources.find((s) => s.url === A);
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toMatch(/ENOTFOUND/);
    expect(r.sources.find((s) => s.url === B)?.count).toBe(1);
  });

  it('HTTP 非 2xx → 该源失败不抛', async () => {
    const svc = createMarketService({
      getSources: () => [A],
      fetchImpl: fakeFetch({ [A]: { status: 404 } }),
      log: () => {},
    });
    const r = await svc['market.fetchIndex']();
    expect(r.items).toHaveLength(0);
    expect(r.sources[0]?.error).toMatch(/404/);
  });

  it('坏索引（非 JSON / 坏条目）不崩：坏条目计 dropped', async () => {
    const svc = createMarketService({
      getSources: () => [A, B],
      fetchImpl: fakeFetch({
        [A]: 'not json at all',
        [B]: JSON.stringify([item(), { id: 'broken' }, { id: 'ref-x', type: 'ref' }]),
      }),
      log: () => {},
    });
    const r = await svc['market.fetchIndex']();
    expect(r.items.map((i) => i.id)).toEqual(['sage']);
    expect(r.dropped).toBe(2);
    expect(r.sources.find((s) => s.url === A)?.ok).toBe(false);
  });

  it('源列表为空 → 空结果不抛', async () => {
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({}) });
    await expect(svc['market.fetchIndex']()).resolves.toEqual({
      items: [],
      sources: [],
      dropped: 0,
    });
  });

  it('⑰ 流通白名单：ST 卡等未知型条目逐条丢弃，同源其余条目照常', async () => {
    const svc = createMarketService({
      getSources: () => [A],
      fetchImpl: fakeFetch({
        [A]: JSON.stringify([
          item(), // soul
          item({ id: 'knight', type: 'body', downloadUrl: 'https://e.com/k.dsbody' }),
          item({ id: 'carded', type: 'stcard', downloadUrl: 'https://e.com/x.png' }),
          item({ id: 'weird', type: 'vrm' }),
        ]),
      }),
      log: () => {},
    });
    const r = await svc['market.fetchIndex']();
    expect(r.items.map((i) => i.id).sort()).toEqual(['knight', 'sage']);
    expect(r.dropped).toBe(2);
    expect(r.sources[0]?.ok).toBe(true);
  });
});

/** 造一个合法 .dssoul / .dspack 字节流。 */
function soulZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'soul.json',
    Buffer.from(
      JSON.stringify({
        id: 'sage',
        name: '贤者',
        version: '2.0',
        author: 'someone',
        license: 'CC0-1.0',
        persona: { systemPrompt: '你是贤者。', beginDialogs: [], greetings: ['你好', '嗨'] },
        lorebook: { entries: [{ keys: ['塔'], content: '塔在东边。' }] },
      }),
      'utf8',
    ),
  );
  return zip.toBuffer();
}

function packZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        id: 'miko',
        name: 'Miko',
        version: '1.2',
        engine: 'vrm',
        model: 'miko.vrm',
        author: 'artist',
        license: 'CC-BY-4.0',
      }),
      'utf8',
    ),
  );
  zip.addFile('miko.vrm', Buffer.from('VRM'));
  return zip.toBuffer();
}

function bodyZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'body.json',
    Buffer.from(
      JSON.stringify({
        id: 'knight',
        name: 'Knight',
        version: '3.0',
        engine: 'vrm',
        model: 'knight.vrm',
        author: 'sculptor',
        license: 'CC-BY-4.0',
      }),
      'utf8',
    ),
  );
  zip.addFile('knight.vrm', Buffer.from('VRM'));
  return zip.toBuffer();
}

const DL = 'https://example.com/dl';

describe('market.download（sha256 门）', () => {
  it('soul 型：校验通过 → 返回临时路径 + 灵魂摘要，kind=soul', async () => {
    const buf = soulZip();
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({ [DL]: buf }) });
    const r = await svc['market.download']({ url: DL, sha256: sha(buf), type: 'soul' });
    expect(r.kind).toBe('soul');
    expect(existsSync(r.path)).toBe(true);
    expect(r.summary).toEqual({
      id: 'sage',
      name: '贤者',
      version: '2.0',
      author: 'someone',
      license: 'CC0-1.0',
      greetingCount: 2,
      lorebookCount: 1,
    });
  });

  it('full 型：走 inspectPack，kind=pack 且带 engine', async () => {
    const buf = packZip();
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({ [DL]: buf }) });
    const r = await svc['market.download']({ url: DL, sha256: sha(buf), type: 'full' });
    expect(r.kind).toBe('pack');
    expect(r.summary.id).toBe('miko');
    expect(r.summary).toMatchObject({ engine: 'vrm', license: 'CC-BY-4.0' });
  });

  it('ref 型：与 soul 同路径（模型不托管，下载物是灵魂包）', async () => {
    const buf = soulZip();
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({ [DL]: buf }) });
    const r = await svc['market.download']({ url: DL, sha256: sha(buf), type: 'ref' });
    expect(r.kind).toBe('soul');
  });

  it('⑰ body 型：走 inspectBody，kind=body + 形象面摘要', async () => {
    const buf = bodyZip();
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({ [DL]: buf }) });
    const r = await svc['market.download']({ url: DL, sha256: sha(buf), type: 'body' });
    expect(r.kind).toBe('body');
    expect(r.path.endsWith('.dsbody')).toBe(true);
    expect(r.summary).toEqual({
      id: 'knight',
      name: 'Knight',
      version: '3.0',
      engine: 'vrm',
      author: 'sculptor',
      license: 'CC-BY-4.0',
    });
  });

  it('⑰ body 型下载物不是形象包（缺 body.json）→ -32602 且清理', async () => {
    const buf = soulZip();
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'mkt-'));
    const svc = createMarketService({
      getSources: () => [],
      fetchImpl: fakeFetch({ [DL]: buf }),
      tmpRoot,
    });
    await expect(
      svc['market.download']({ url: DL, sha256: sha(buf), type: 'body' }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('sha256 不符 → -32602 且临时文件被清理', async () => {
    const buf = soulZip();
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'mkt-'));
    const svc = createMarketService({
      getSources: () => [],
      fetchImpl: fakeFetch({ [DL]: buf }),
      tmpRoot,
    });
    await expect(
      svc['market.download']({ url: DL, sha256: 'b'.repeat(64), type: 'soul' }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('sha256 大小写不敏感', async () => {
    const buf = soulZip();
    const svc = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({ [DL]: buf }) });
    await expect(
      svc['market.download']({ url: DL, sha256: sha(buf).toUpperCase(), type: 'soul' }),
    ).resolves.toMatchObject({ kind: 'soul' });
  });

  it('下载物不是合法包（校验通过但解析失败）→ -32602 且清理', async () => {
    const buf = Buffer.from('garbage');
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'mkt-'));
    const svc = createMarketService({
      getSources: () => [],
      fetchImpl: fakeFetch({ [DL]: buf }),
      tmpRoot,
    });
    await expect(
      svc['market.download']({ url: DL, sha256: sha(buf), type: 'soul' }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('HTTP 失败 / 网络异常 → -32603', async () => {
    const svc = createMarketService({
      getSources: () => [],
      fetchImpl: fakeFetch({ [DL]: { status: 500 } }),
    });
    await expect(
      svc['market.download']({ url: DL, sha256: 'a'.repeat(64), type: 'soul' }),
    ).rejects.toMatchObject({ code: -32603 });
    const svc2 = createMarketService({ getSources: () => [], fetchImpl: fakeFetch({}) });
    await expect(
      svc2['market.download']({ url: DL, sha256: 'a'.repeat(64), type: 'soul' }),
    ).rejects.toMatchObject({ code: -32603 });
  });

  it('超过体积上限 → -32602', async () => {
    const buf = soulZip();
    const svc = createMarketService({
      getSources: () => [],
      fetchImpl: fakeFetch({ [DL]: buf }),
      maxDownloadBytes: 4,
    });
    await expect(
      svc['market.download']({ url: DL, sha256: sha(buf), type: 'soul' }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});
