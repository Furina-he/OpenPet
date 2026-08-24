/**
 * ⑯ E1 市场 tab 纯逻辑（过滤 / 已装比对 / 版本判定）；SFC 只做薄渲染。
 * 与 Main 的判定口径共用 protocol 的 `compareVersion`（可更新 = 索引版本高于本地）。
 */
import { compareVersion, type MarketItem, type MarketItemType } from '@openpet/protocol';

export type MarketInstallState = 'new' | 'installed' | 'updatable' | 'needsUpgrade';

export interface MarketCardVm {
  item: MarketItem;
  state: MarketInstallState;
  /** 本地已装版本（installed/updatable 时有值）。 */
  localVersion: string | null;
  tags: string[];
}

export interface InstalledLike {
  characterId: string;
  manifest: { version: string };
}

/**
 * 已装比对：id 命中 → 版本相同为「已安装」，索引更高为「可更新」；
 * `minAppVersion` 高于当前 app 版本 → 「需要升级」（安装按钮灰掉）。
 * ⑰ `body` 型比的是形象库（`installedBodies`），不是角色库——两个库命名空间独立。
 */
export function toMarketCard(
  item: MarketItem,
  installed: readonly InstalledLike[],
  appVersion: string,
  installedBodies: readonly InstalledLike[] = [],
): MarketCardVm {
  const pool = item.type === 'body' ? installedBodies : installed;
  const local = pool.find((c) => c.characterId === item.id) ?? null;
  const tags = item.tags ?? [];
  if (item.minAppVersion && appVersion && compareVersion(item.minAppVersion, appVersion) > 0) {
    return { item, state: 'needsUpgrade', localVersion: local?.manifest.version ?? null, tags };
  }
  if (!local) return { item, state: 'new', localVersion: null, tags };
  const state = compareVersion(item.version, local.manifest.version) > 0 ? 'updatable' : 'installed';
  return { item, state, localVersion: local.manifest.version, tags };
}

export interface MarketFilter {
  /** 搜索词（name / id / tags / summary 子串，大小写不敏感）。 */
  query: string;
  /** 类型过滤；'all' = 不过滤。 */
  type: MarketItemType | 'all';
}

/** 本地过滤 + 排序（可更新 → 未安装 → 已安装，同组按名称）。 */
export function filterMarketCards(
  cards: readonly MarketCardVm[],
  filter: MarketFilter,
): MarketCardVm[] {
  const q = filter.query.trim().toLowerCase();
  const rank = (s: MarketInstallState): number =>
    s === 'updatable' ? 0 : s === 'new' ? 1 : s === 'needsUpgrade' ? 2 : 3;
  return cards
    .filter((c) => filter.type === 'all' || c.item.type === filter.type)
    .filter((c) => {
      if (!q) return true;
      const hay = [c.item.name, c.item.id, c.item.summary ?? '', c.item.author ?? '', ...c.tags]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => rank(a.state) - rank(b.state) || a.item.name.localeCompare(b.item.name));
}

export function formatMarketSize(n?: number): string {
  if (n === undefined || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 源 URL 校验（只放行 http(s)；空/畸形拒绝）。 */
export function isValidSourceUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
}

/** 源列表增改：去重 + 保序（新源追加表尾）。 */
export function addSource(sources: readonly string[], url: string): string[] {
  const s = url.trim();
  return sources.includes(s) ? [...sources] : [...sources, s];
}
