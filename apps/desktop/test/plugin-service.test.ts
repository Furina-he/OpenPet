import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { DesktopPluginManifest, PluginRuntimeStatus } from '@openpet/protocol';
import {
  createPluginService,
  readPluginConfig,
} from '../electron/main/plugins/plugin-service';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ds-plugins-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function writePlugin(
  root: string,
  id: string,
  extra: Record<string, unknown> = {},
  entryContent = 'export default {};',
): string {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', engine: 'desktop', ...extra }),
  );
  writeFileSync(path.join(dir, 'main.js'), entryContent);
  return dir;
}

interface FakeHost {
  calls: string[];
  started: Map<string, { manifest: DesktopPluginManifest; dir: string; entryFile: string }>;
  start(m: DesktopPluginManifest, dir: string, entryFile: string): void;
  stop(id: string): Promise<void>;
  pushConfig(id: string, config: Record<string, unknown>): void;
  statuses(): Array<{ id: string; status: PluginRuntimeStatus; lastError?: string }>;
}

function makeFakeHost(): FakeHost {
  return {
    calls: [],
    started: new Map(),
    start(m, dir, entryFile) {
      this.calls.push(`start:${m.id}`);
      this.started.set(m.id, { manifest: m, dir, entryFile });
    },
    stop(id) {
      this.calls.push(`stop:${id}`);
      this.started.delete(id);
      return Promise.resolve();
    },
    pushConfig(id, config) {
      this.calls.push(`push:${id}:${JSON.stringify(config)}`);
    },
    statuses() {
      return [...this.started.keys()].map((id) => ({ id, status: 'running' as const }));
    },
  };
}

function makeService(over: {
  root?: string;
  host?: FakeHost;
  disabled?: string[];
  pick?: (kind: 'dsplug' | 'folder') => Promise<string | null>;
  fetchImpl?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  maxUnpackedBytes?: number;
}) {
  const root = over.root ?? makeRoot();
  const host = over.host ?? makeFakeHost();
  let disabled = over.disabled ?? [];
  const logs: string[] = [];
  const service = createPluginService({
    pluginsRoot: root,
    host,
    getDisabled: () => disabled,
    setDisabled: (next) => {
      disabled = next;
    },
    ...(over.pick ? { pickPluginPath: over.pick } : {}),
    ...(over.fetchImpl ? { fetchImpl: over.fetchImpl } : {}),
    ...(over.maxUnpackedBytes !== undefined ? { maxUnpackedBytes: over.maxUnpackedBytes } : {}),
    log: (msg) => logs.push(msg),
  });
  return { root, host, service, logs, getDisabled: () => disabled };
}

describe('plugin-service', () => {
  it('startAll 扫描合法 manifest 并启动；坏 manifest 跳过并记诊断', () => {
    const root = makeRoot();
    writePlugin(root, 'good');
    const badDir = path.join(root, 'bad');
    mkdirSync(badDir);
    writeFileSync(path.join(badDir, 'plugin.json'), '{ not json');
    const { host, service, logs } = makeService({ root });
    service.startAll();
    expect(host.calls).toEqual(['start:good']);
    expect(logs.some((l) => l.includes('bad'))).toBe(true);
  });

  it('disabled 不 start；plugins.list 报 disabled 状态', async () => {
    const root = makeRoot();
    writePlugin(root, 'off');
    const { host, service } = makeService({ root, disabled: ['off'] });
    service.startAll();
    expect(host.calls).toEqual([]);
    const list = await service['plugins.list']({});
    expect(list.desktop).toHaveLength(1);
    expect(list.desktop[0]).toMatchObject({ enabled: false, status: 'disabled' });
    expect(list.star).toEqual([]);
    expect(list.python).toEqual({ found: false });
  });

  it('installDesktop pick 取消 → cancelled；选中 → 返回 manifest 摘要（不安装）', async () => {
    const src = makeRoot();
    const srcDir = writePlugin(src, 'demo', { permissions: ['say'] });
    const { root, service } = makeService({ pick: () => Promise.resolve(srcDir) });
    const r = await service['plugins.installDesktop']({ kind: 'folder' });
    expect(r).toMatchObject({
      cancelled: false,
      path: srcDir,
      manifest: { id: 'demo', permissions: ['say'] },
    });
    expect(existsSync(path.join(root, 'demo'))).toBe(false);

    const { service: s2 } = makeService({ pick: () => Promise.resolve(null) });
    await expect(s2['plugins.installDesktop']({ kind: 'folder' })).resolves.toEqual({
      cancelled: true,
    });
  });

  it('installDesktopApply 文件夹 → 落位 + 启动；同 id 冲突拒绝', async () => {
    const src = makeRoot();
    const srcDir = writePlugin(src, 'demo');
    const { root, host, service } = makeService({});
    const r = await service['plugins.installDesktopApply']({ path: srcDir });
    expect(r).toEqual({ ok: true, id: 'demo' });
    expect(existsSync(path.join(root, 'demo', 'plugin.json'))).toBe(true);
    expect(host.calls).toContain('start:demo');
    await expect(service['plugins.installDesktopApply']({ path: srcDir })).rejects.toThrow(
      '已存在',
    );
  });

  it('.dsplug zip 安装 + zip-slip 拒绝 + 解压上限拒绝', async () => {
    const src = makeRoot();
    const zipPath = path.join(src, 'demo.dsplug');
    const zip = new AdmZip();
    zip.addFile(
      'plugin.json',
      Buffer.from(JSON.stringify({ id: 'zipped', name: 'Z', version: '1', engine: 'desktop' })),
    );
    zip.addFile('main.js', Buffer.from('export default {};'));
    zip.writeZip(zipPath);
    const { root, service } = makeService({});
    const r = await service['plugins.installDesktopApply']({ path: zipPath });
    expect(r).toEqual({ ok: true, id: 'zipped' });
    expect(existsSync(path.join(root, 'zipped', 'main.js'))).toBe(true);

    // adm-zip 的 addFile 会 sanitize 掉 `..`——照 pack-import 测试在字节层伪造 entry 名。
    const evil = new AdmZip();
    evil.addFile(
      'plugin.json',
      Buffer.from(JSON.stringify({ id: 'evil', name: 'E', version: '1', engine: 'desktop' })),
    );
    evil.addFile('xx/evil.js', Buffer.from('x'));
    const evilPath = path.join(src, 'evil.dsplug');
    evil.writeZip(evilPath);
    const buf = readFileSync(evilPath);
    const from = Buffer.from('xx/evil.js');
    const to = Buffer.from('../evil.js');
    let i: number;
    while ((i = buf.indexOf(from)) !== -1) to.copy(buf, i);
    writeFileSync(evilPath, buf);
    const { service: s2 } = makeService({});
    await expect(s2['plugins.installDesktopApply']({ path: evilPath })).rejects.toThrow(
      '非法路径',
    );

    const { service: s3 } = makeService({ maxUnpackedBytes: 4 });
    await expect(s3['plugins.installDesktopApply']({ path: zipPath })).rejects.toThrow('上限');
  });

  it('setEnabled 即时起停 + prefs 更新', async () => {
    const root = makeRoot();
    writePlugin(root, 'demo');
    const { host, service, getDisabled } = makeService({ root });
    service.startAll();
    await service['plugins.setEnabled']({ runtime: 'desktop', id: 'demo', enabled: false });
    expect(host.calls).toContain('stop:demo');
    expect(getDisabled()).toEqual(['demo']);
    await service['plugins.setEnabled']({ runtime: 'desktop', id: 'demo', enabled: true });
    expect(host.calls.filter((c) => c === 'start:demo')).toHaveLength(2);
    expect(getDisabled()).toEqual([]);
  });

  it('getConfig/setConfig：schema 透出 + 值落 config.json + pushConfig 被调', async () => {
    const root = makeRoot();
    writePlugin(root, 'demo', {
      configSchema: { greeting: { type: 'string', hint: 'hi' } },
    });
    const { host, service } = makeService({ root });
    const before = await service['plugins.getConfig']({ id: 'demo' });
    expect(before.schema).toEqual({ greeting: { type: 'string', hint: 'hi' } });
    expect(before.values).toEqual({});
    await service['plugins.setConfig']({ id: 'demo', values: { greeting: 'yo' } });
    expect(readPluginConfig(root, 'demo')).toEqual({ greeting: 'yo' });
    expect(host.calls).toContain('push:demo:{"greeting":"yo"}');
    const after = await service['plugins.getConfig']({ id: 'demo' });
    expect(after.values).toEqual({ greeting: 'yo' });
  });

  it('reload → stop + start；uninstall → stop + 目录删净', async () => {
    const root = makeRoot();
    writePlugin(root, 'demo');
    const { host, service } = makeService({ root });
    service.startAll();
    await service['plugins.reload']({ id: 'demo' });
    expect(host.calls).toEqual(['start:demo', 'stop:demo', 'start:demo']);
    await service['plugins.uninstallDesktop']({ id: 'demo' });
    expect(host.calls.at(-1)).toBe('stop:demo');
    expect(existsSync(path.join(root, 'demo'))).toBe(false);
    const list = await service['plugins.list']({});
    expect(list.desktop).toEqual([]);
  });

  it('marketFetch 走注入 fetch，数组/items 两种形状都归一', async () => {
    const { service } = makeService({
      fetchImpl: (url) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              url.includes('arr') ? '[{"name":"a"}]' : '{"items":[{"name":"b"}]}',
            ),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
    });
    await expect(service['plugins.marketFetch']({ url: 'https://x.test/arr.json' })).resolves.toEqual({
      items: [{ name: 'a' }],
    });
    await expect(service['plugins.marketFetch']({ url: 'https://x.test/obj.json' })).resolves.toEqual({
      items: [{ name: 'b' }],
    });
  });

  it('installFromUrl 下载 .dsplug 到临时文件并返回 manifest（不安装）', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'plugin.json',
      Buffer.from(JSON.stringify({ id: 'remote', name: 'R', version: '1', engine: 'desktop' })),
    );
    const bytes = zip.toBuffer();
    const { root, service } = makeService({
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
          arrayBuffer: () =>
            Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)),
        }),
    });
    const r = await service['plugins.installFromUrl']({ url: 'https://x.test/remote.dsplug' });
    expect(r.manifest.id).toBe('remote');
    expect(existsSync(r.path)).toBe(true);
    expect(existsSync(path.join(root, 'remote'))).toBe(false);
    // 同一 path 走 apply 完成安装（同权限确认后流程）
    await expect(service['plugins.installDesktopApply']({ path: r.path })).resolves.toEqual({
      ok: true,
      id: 'remote',
    });
    rmSync(path.dirname(r.path), { recursive: true, force: true });
  });
});
