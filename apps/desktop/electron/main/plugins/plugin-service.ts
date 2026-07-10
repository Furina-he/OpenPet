/**
 * PluginService —— plugins.* RPC（线 B-2 T4）：Desktop 插件扫描/安装/启停/配置。
 *
 * 安装复刻 pack-import 模式：.dsplug(zip)/文件夹两段式（pick 摘要 → apply 落盘），
 * zip-slip 逐 entry 校验 + 解压总量 50MB 上限 + id 冲突拒绝。启停 = prefs
 * `plugins.disabled` + host 即时起停；配置存 `<dir>/config.json`，变更推 worker。
 * star / python 字段由 T7 注入（缺省空/未装）。
 */
import AdmZip from 'adm-zip';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesktopPluginManifestSchema, isSafeRelPath } from '@openpet/protocol';
import type {
  DesktopPluginManifest,
  PluginRuntimeStatus,
  StarPluginMeta,
} from '@openpet/protocol';

const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;

/** host 侧最小面（DesktopPluginHost 结构满足；测试注入 fake）。 */
export interface PluginHostLike {
  start(manifest: DesktopPluginManifest, dir: string, entryFile: string): void;
  stop(id: string): Promise<void>;
  pushConfig(id: string, config: Record<string, unknown>): void;
  statuses(): Array<{ id: string; status: PluginRuntimeStatus; lastError?: string }>;
}

export interface PluginServiceDeps {
  pluginsRoot: string;
  host: PluginHostLike;
  getDisabled: () => string[];
  setDisabled: (next: string[]) => void;
  /** 系统选择框（index 注入 dialog）；缺省 null=取消。 */
  pickPluginPath?: (kind: 'dsplug' | 'folder') => Promise<string | null>;
  /** 市场索引拉取 + 从 URL 下载（index 注入 net.fetch）。 */
  fetchImpl?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  /** T7 注入：Star 插件列表 + Python 探测。 */
  starList?: () => Array<{ meta: StarPluginMeta; enabled: boolean }>;
  pythonInfo?: () => { found: boolean; version?: string };
  /** T7 注入：Star 启停（写 star.disabled prefs + 宿主重启）。 */
  onStarSetEnabled?: (dir: string, enabled: boolean) => Promise<void>;
  maxUnpackedBytes?: number;
  log?: (msg: string) => void;
}

/** 读插件配置值（host getConfig 与 service 共用；缺失/坏 JSON → {}）。 */
export function readPluginConfig(pluginsRoot: string, id: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(path.join(pluginsRoot, id, 'config.json'), 'utf8')) as
      | Record<string, unknown>
      | unknown;
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readManifest(raw: string): DesktopPluginManifest {
  return DesktopPluginManifestSchema.parse(JSON.parse(raw));
}

/** 摘要（不安装）：.dsplug(zip) 或文件夹自动判别。 */
function inspectPlugin(srcPath: string): DesktopPluginManifest {
  if (statSync(srcPath).isDirectory()) {
    return readManifest(readFileSync(path.join(srcPath, 'plugin.json'), 'utf8'));
  }
  const zip = new AdmZip(srcPath);
  const entry = zip.getEntry('plugin.json');
  if (!entry) throw new Error('包根缺少 plugin.json');
  return readManifest(zip.readAsText(entry));
}

export function createPluginService(deps: PluginServiceDeps) {
  const { pluginsRoot, host } = deps;
  const maxBytes = deps.maxUnpackedBytes ?? MAX_UNPACKED_BYTES;
  const log = deps.log ?? ((msg: string) => console.info(`[plugins] ${msg}`));

  /** 扫描 pluginsRoot 下各目录的 plugin.json；坏 manifest 跳过并记诊断。 */
  const scan = (): Array<{ manifest: DesktopPluginManifest; dir: string }> => {
    if (!existsSync(pluginsRoot)) return [];
    const out: Array<{ manifest: DesktopPluginManifest; dir: string }> = [];
    for (const name of readdirSync(pluginsRoot)) {
      const dir = path.join(pluginsRoot, name);
      const manifestPath = path.join(dir, 'plugin.json');
      if (!statSync(dir).isDirectory() || !existsSync(manifestPath)) continue;
      try {
        out.push({ manifest: readManifest(readFileSync(manifestPath, 'utf8')), dir });
      } catch (e) {
        log(`skip ${name}: bad plugin.json (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return out;
  };

  const isEnabled = (id: string): boolean => !deps.getDisabled().includes(id);

  const startOne = (m: DesktopPluginManifest, dir: string): void => {
    host.start(m, dir, path.join(dir, m.entry));
  };

  /** 安装到 pluginsRoot/<id>（zip-slip/上限/冲突照 pack-import）。 */
  const install = (srcPath: string): DesktopPluginManifest => {
    const manifest = inspectPlugin(srcPath);
    const dest = path.join(pluginsRoot, manifest.id);
    if (existsSync(dest)) throw new Error(`插件 id "${manifest.id}" 已存在`);
    mkdirSync(pluginsRoot, { recursive: true });

    if (statSync(srcPath).isDirectory()) {
      cpSync(srcPath, dest, { recursive: true });
      return manifest;
    }

    const zip = new AdmZip(srcPath);
    let total = 0;
    for (const e of zip.getEntries()) {
      const name = e.entryName.replace(/\/$/, '');
      if (name.length > 0 && !isSafeRelPath(name)) {
        throw new Error(`包内非法路径: ${e.entryName}`);
      }
      total += e.header.size;
      if (total > maxBytes) throw new Error('包解压总量超过 50MB 上限');
    }
    const staging = mkdtempSync(path.join(tmpdir(), 'ds-plugin-'));
    try {
      zip.extractAllTo(staging, true);
      try {
        renameSync(staging, dest);
      } catch {
        // 跨盘 rename EXDEV → 降级递归拷贝（同 pack-import）。
        cpSync(staging, dest, { recursive: true });
      }
    } catch (e) {
      rmSync(dest, { recursive: true, force: true });
      throw e;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return manifest;
  };

  return {
    /** 启动时把非 disabled 的全部拉起（ipc-router 构造后调）。 */
    startAll(): void {
      for (const { manifest, dir } of scan()) {
        if (isEnabled(manifest.id)) startOne(manifest, dir);
      }
    },

    'plugins.list': async (_p: Record<string, never>) => {
      const statuses = new Map(host.statuses().map((s) => [s.id, s]));
      return {
        desktop: scan().map(({ manifest }) => {
          const s = statuses.get(manifest.id);
          return {
            manifest,
            enabled: isEnabled(manifest.id),
            status: (s?.status ?? 'disabled') as PluginRuntimeStatus,
            ...(s?.lastError !== undefined ? { lastError: s.lastError } : {}),
          };
        }),
        star: deps.starList?.() ?? [],
        python: deps.pythonInfo?.() ?? { found: false as const },
      };
    },

    'plugins.installDesktop': async (p: { kind: 'dsplug' | 'folder' }) => {
      const picked = (await deps.pickPluginPath?.(p.kind)) ?? null;
      if (!picked) return { cancelled: true as const };
      return { cancelled: false as const, path: picked, manifest: inspectPlugin(picked) };
    },

    'plugins.installDesktopApply': async (p: { path: string }) => {
      const manifest = install(p.path);
      if (isEnabled(manifest.id)) {
        startOne(manifest, path.join(pluginsRoot, manifest.id));
      }
      return { ok: true as const, id: manifest.id };
    },

    'plugins.uninstallDesktop': async (p: { id: string }) => {
      await host.stop(p.id);
      rmSync(path.join(pluginsRoot, p.id), { recursive: true, force: true });
      deps.setDisabled(deps.getDisabled().filter((x) => x !== p.id));
      return { ok: true as const };
    },

    'plugins.reload': async (p: { id: string }) => {
      await host.stop(p.id);
      const found = scan().find((x) => x.manifest.id === p.id);
      if (found && isEnabled(p.id)) startOne(found.manifest, found.dir);
      return { ok: true as const };
    },

    'plugins.setEnabled': async (p: {
      runtime: 'desktop' | 'star';
      id: string;
      enabled: boolean;
    }) => {
      if (p.runtime !== 'desktop') {
        await deps.onStarSetEnabled?.(p.id, p.enabled);
        return { ok: true as const };
      }
      const rest = deps.getDisabled().filter((x) => x !== p.id);
      deps.setDisabled(p.enabled ? rest : [...rest, p.id]);
      if (p.enabled) {
        const found = scan().find((x) => x.manifest.id === p.id);
        if (found) startOne(found.manifest, found.dir);
      } else {
        await host.stop(p.id);
      }
      return { ok: true as const };
    },

    'plugins.getConfig': async (p: { id: string }) => {
      const found = scan().find((x) => x.manifest.id === p.id);
      return {
        ...(found?.manifest.configSchema !== undefined
          ? { schema: found.manifest.configSchema }
          : {}),
        values: readPluginConfig(pluginsRoot, p.id),
      };
    },

    'plugins.setConfig': async (p: { id: string; values: Record<string, unknown> }) => {
      writeFileSync(
        path.join(pluginsRoot, p.id, 'config.json'),
        JSON.stringify(p.values, null, 2),
        'utf8',
      );
      host.pushConfig(p.id, p.values);
      return { ok: true as const };
    },

    'plugins.marketFetch': async (p: { url: string }) => {
      if (!deps.fetchImpl) throw new Error('market fetch not configured');
      const res = await deps.fetchImpl(p.url);
      if (!res.ok) throw new Error(`market source HTTP ${res.status}`);
      const parsed = JSON.parse(await res.text()) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: unknown[] }).items)
          : [];
      return { items };
    },

    'plugins.installFromUrl': async (p: { url: string }) => {
      if (!deps.fetchImpl) throw new Error('market fetch not configured');
      const res = await deps.fetchImpl(p.url);
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const staging = mkdtempSync(path.join(tmpdir(), 'ds-plugin-dl-'));
      const file = path.join(staging, 'plugin.dsplug');
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { path: file, manifest: inspectPlugin(file) };
    },
  };
}
