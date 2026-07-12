/**
 * asset:// 自定义协议 —— 角色包资产的唯一合法入口（tech-design §7「资产加载安全」）。
 *
 * Renderer 只能引用 `asset://<characterId>/<相对路径>`；映射经 resolveAssetPath
 * 白名单解析（host=角色 id、段级校验、resolve 后前缀强校验），任何越级/跨包/
 * 非法形状一律 null → 404。注册分两步：
 *   - assetSchemePrivileges() 必须在 app ready 前经 registerSchemesAsPrivileged 注册
 *     （supportFetchAPI：GLTFLoader 走 fetch；corsEnabled + ACAO：renderer 的
 *     localhost/file 源对 asset:// 是跨源请求）。
 *   - registerAssetProtocol() 在 ready 后挂 protocol.handle。
 */
import { protocol, net } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHARACTER_ID_RE } from '@openpet/protocol';

export const ASSET_SCHEME = 'asset';

export function assetSchemePrivileges(): Electron.CustomScheme[] {
  return [
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ];
}

/**
 * asset URL → 磁盘绝对路径；多根按序找存在文件，均缺 → 首根候选（自然 404）；
 * 任何不合法形状返回 null（调用方 404）。纯函数可单测。
 *
 * reservedHosts（⑪ 发布批次）：保留 host → 专用根列表（host 直接映射目录本身，
 * 不叠加 <id>/ 子目录）。用于非角色资产（cubism core 三级加载链的后两级）；
 * 保留字优先于同名角色包。
 */
export function resolveAssetPath(
  charactersRoots: string[],
  rawUrl: string,
  exists: (p: string) => boolean = existsSync,
  reservedHosts: Record<string, string[]> = {},
): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ASSET_SCHEME}:`) return null;

  const id = url.hostname;
  if (!CHARACTER_ID_RE.test(id)) return null;

  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  rel = rel.replace(/^\//, '');
  if (rel.length === 0 || rel.includes('\\')) return null;
  const segs = rel.split('/');
  if (segs.some((s) => s.length === 0 || s === '.' || s === '..' || s.includes(':'))) return null;

  const reserved = reservedHosts[id];
  if (reserved) {
    let first: string | null = null;
    for (const root of reserved) {
      const base = path.resolve(root);
      const full = path.resolve(base, rel);
      if (!full.startsWith(base + path.sep)) continue;
      first ??= full;
      if (exists(full)) return full;
    }
    return first;
  }

  let first: string | null = null;
  for (const root of charactersRoots) {
    const base = path.resolve(root, id);
    const full = path.resolve(base, rel);
    if (!full.startsWith(base + path.sep)) continue; // 跨包/越级兜底（防解析歧义）
    first ??= full;
    if (exists(full)) return full;
  }
  return first;
}

export function registerAssetProtocol(
  charactersRoots: string[],
  reservedHosts: Record<string, string[]> = {},
): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const filePath = resolveAssetPath(charactersRoots, request.url, existsSync, reservedHosts);
    if (!filePath) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(filePath).toString());
    // net.fetch(file://) 不带 CORS 头；renderer 源（localhost/file）跨源取 asset:// 必须显式放行
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });
}
