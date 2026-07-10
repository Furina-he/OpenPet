import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  createStarHostService,
  type ChildLike,
  type StarHostService,
} from '../electron/main/plugins/star-host-service';

class FakeChild extends EventEmitter implements ChildLike {
  written: string[] = [];
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: (s: string): void => {
      this.written.push(s);
    },
  };
  kill(): void {
    this.killed = true;
    this.emit('exit', null);
  }
  /** 测试注入 host→Main 帧。 */
  emitLine(obj: unknown): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8'));
  }
}

const roots: string[] = [];
function makeDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-star-'));
  roots.push(d);
  return d;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

interface Harness {
  service: StarHostService;
  children: FakeChild[];
  spawns: Array<{ cmd: string; args: string[] }>;
  execs: Array<{ cmd: string; args: string[] }>;
  statuses: Array<{ runtime: string; id: string; status: string; lastError?: string }>;
  pluginsDir: string;
}

function makeService(over: {
  pythonVersion?: string | null; // null = python 不存在
  python3Version?: string | null;
  pluginsDir?: string;
  timeoutMs?: number;
  restartDelays?: number[];
  pipIndexUrl?: string;
}): Harness {
  const children: FakeChild[] = [];
  const spawns: Array<{ cmd: string; args: string[] }> = [];
  const execs: Array<{ cmd: string; args: string[] }> = [];
  const statuses: Harness['statuses'] = [];
  const pluginsDir = over.pluginsDir ?? makeDir();
  const service = createStarHostService({
    hostDir: '/host',
    pluginsDir,
    venvDir: path.join(makeDir(), 'venv'),
    broadcast: (channel, params) => {
      if (channel === 'plugin.status') statuses.push(params as Harness['statuses'][number]);
    },
    spawnImpl: (cmd, args) => {
      spawns.push({ cmd, args });
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    execImpl: (cmd, args) => {
      execs.push({ cmd, args });
      if (args[0] === '--version') {
        const v = cmd.includes('python3') ? over.python3Version : over.pythonVersion;
        if (v === null || v === undefined) return Promise.reject(new Error('not found'));
        return Promise.resolve({ stdout: `Python ${v}` });
      }
      return Promise.resolve({ stdout: '' });
    },
    timeoutMs: over.timeoutMs ?? 200,
    restartDelays: over.restartDelays ?? [0, 0],
    delay: () => Promise.resolve(),
    pipIndexUrl: () => over.pipIndexUrl ?? 'https://pypi.test/simple',
  });
  return { service, children, spawns, execs, statuses, pluginsDir };
}

function until<T>(probe: () => T | undefined, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const v = probe();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > timeoutMs) return reject(new Error('until timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('star-host-service', () => {
  it('detectPython：python 命中 → found+version；python 缺 python3 兜底；全缺/过老 → not found', async () => {
    const a = makeService({ pythonVersion: '3.13.3' });
    await expect(a.service.detectPython()).resolves.toEqual({ found: true, version: '3.13.3' });

    const b = makeService({ pythonVersion: null, python3Version: '3.11.0' });
    await expect(b.service.detectPython()).resolves.toEqual({ found: true, version: '3.11.0' });

    const c = makeService({ pythonVersion: null, python3Version: null });
    await expect(c.service.detectPython()).resolves.toEqual({ found: false });

    const d = makeService({ pythonVersion: '3.9.7', python3Version: null });
    await expect(d.service.detectPython()).resolves.toEqual({ found: false });
  });

  it('python 缺失 → start no-op + tryHandle null（绝不阻塞聊天）', async () => {
    const h = makeService({ pythonVersion: null, python3Version: null });
    await h.service.start();
    expect(h.spawns).toEqual([]);
    await expect(h.service.tryHandle('default', 'private', 'u', 'U', '/签到', false)).resolves.toBe(
      null,
    );
  });

  it('start → spawn main.py + 插件目录；plugins 帧 → metas + running 广播', async () => {
    const h = makeService({ pythonVersion: '3.12.0' });
    await h.service.start();
    expect(h.spawns[0]!.args[0]).toContain('main.py');
    expect(h.spawns[0]!.args[1]).toBe(h.pluginsDir);
    h.children[0]!.emitLine({
      type: 'plugins',
      list: [{ dir: 'checkin', name: 'checkin', commands: ['签到'] }],
    });
    await until(() => (h.service.metas().length > 0 ? true : undefined));
    expect(h.service.metas()[0]).toMatchObject({ dir: 'checkin', commands: ['签到'] });
    expect(h.statuses.at(-1)).toMatchObject({ runtime: 'star', id: 'star-host', status: 'running' });
  });

  it('disabledDirs 经 argv[2] 传宿主（加载层跳过）', async () => {
    const children: FakeChild[] = [];
    const spawns: Array<{ cmd: string; args: string[] }> = [];
    const service = createStarHostService({
      hostDir: '/host',
      pluginsDir: makeDir(),
      venvDir: path.join(makeDir(), 'venv'),
      broadcast: () => {},
      spawnImpl: (cmd, args) => {
        spawns.push({ cmd, args });
        const c = new FakeChild();
        children.push(c);
        return c;
      },
      execImpl: () => Promise.resolve({ stdout: 'Python 3.12.0' }),
      delay: () => Promise.resolve(),
      disabledDirs: () => ['muted-plugin', 'another'],
    });
    await service.start();
    expect(spawns[0]!.args[2]).toBe('muted-plugin,another');
    await service.stop();
  });

  it('tryHandle：stdin 帧字段正确 → result 帧按 id 唤醒；未知 id 忽略', async () => {
    const h = makeService({ pythonVersion: '3.12.0' });
    await h.service.start();
    const child = h.children[0]!;
    const p = h.service.tryHandle('im:qq:private:1', 'private', 'u1', '测试', '/签到', true);
    const frame = await until(() =>
      child.written.length ? (JSON.parse(child.written[0]!) as Record<string, unknown>) : undefined,
    );
    expect(frame).toMatchObject({
      type: 'event',
      origin: 'im:qq:private:1',
      kind: 'private',
      senderId: 'u1',
      senderName: '测试',
      text: '/签到',
      isAdmin: true,
    });
    child.emitLine({ type: 'result', id: 999, handled: true, replies: ['bogus'] }); // 未知 id 忽略
    child.emitLine({ type: 'result', id: frame.id, handled: true, replies: ['测试 签到成功 ✅'] });
    await expect(p).resolves.toEqual({ handled: true, replies: ['测试 签到成功 ✅'] });
  });

  it('tryHandle 超时 → null（放行走 LLM）', async () => {
    const h = makeService({ pythonVersion: '3.12.0', timeoutMs: 30 });
    await h.service.start();
    await expect(h.service.tryHandle('default', 'private', 'u', 'U', '/慢', false)).resolves.toBe(
      null,
    );
  });

  it('崩溃 → restarting 广播 + 重启；耗尽 → error + 不再重启', async () => {
    const h = makeService({ pythonVersion: '3.12.0', restartDelays: [0, 0] });
    await h.service.start();
    h.children[0]!.emit('exit', 1);
    await until(() => (h.spawns.length >= 2 ? true : undefined));
    expect(h.statuses.some((s) => s.status === 'restarting')).toBe(true);
    h.children[1]!.emit('exit', 1);
    await until(() => (h.spawns.length >= 3 ? true : undefined));
    h.children[2]!.emit('exit', 1);
    await until(() => (h.statuses.some((s) => s.status === 'error') ? true : undefined));
    expect(h.spawns).toHaveLength(3);
    await expect(h.service.tryHandle('default', 'private', 'u', 'U', '/x', false)).resolves.toBe(
      null,
    );
  });

  it('stop 后 exit 不触发重启', async () => {
    const h = makeService({ pythonVersion: '3.12.0' });
    await h.service.start();
    await h.service.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(h.spawns).toHaveLength(1);
    expect(h.statuses.some((s) => s.status === 'restarting')).toBe(false);
  });

  it('installStar zip：落 pluginsDir + 重启宿主；同名冲突拒；GitHub 包一层剥壳', async () => {
    const h = makeService({ pythonVersion: '3.12.0' });
    await h.service.start();
    const src = makeDir();
    const zip = new AdmZip();
    zip.addFile('checkin-master/main.py', Buffer.from('# plugin'));
    zip.addFile('checkin-master/metadata.yaml', Buffer.from('name: checkin\nversion: 1.0.0\n'));
    const zipPath = path.join(src, 'checkin.zip');
    zip.writeZip(zipPath);
    const r = await h.service.installStar(zipPath);
    expect(r.dir).toBe('checkin-master');
    expect(existsSync(path.join(h.pluginsDir, 'checkin-master', 'main.py'))).toBe(true);
    expect(h.spawns.length).toBeGreaterThanOrEqual(2); // 装完重启
    await expect(h.service.installStar(zipPath)).rejects.toThrow('已存在');
  });

  it('installStar 缺 main.py 拒绝；带 requirements → venv + pip -i 镜像序列', async () => {
    const h = makeService({ pythonVersion: '3.12.0', pipIndexUrl: 'https://mirror.test/simple' });
    await h.service.start();
    const bad = makeDir();
    writeFileSync(path.join(bad, 'metadata.yaml'), 'name: x\n');
    await expect(h.service.installStar(bad)).rejects.toThrow('main.py');

    const good = makeDir();
    writeFileSync(path.join(good, 'main.py'), '# p');
    writeFileSync(path.join(good, 'requirements.txt'), 'requests\n');
    await h.service.installStar(good);
    const venvCall = h.execs.find((e) => e.args.includes('venv'));
    expect(venvCall).toBeTruthy();
    const pipCall = h.execs.find((e) => e.args.includes('pip'));
    expect(pipCall!.args).toContain('-i');
    expect(pipCall!.args).toContain('https://mirror.test/simple');
  });

  it('uninstallStar：删目录 + 重启', async () => {
    const h = makeService({ pythonVersion: '3.12.0' });
    await h.service.start();
    const dir = path.join(h.pluginsDir, 'byebye');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'main.py'), '# p');
    const spawnsBefore = h.spawns.length;
    await h.service.uninstallStar('byebye');
    expect(existsSync(dir)).toBe(false);
    expect(h.spawns.length).toBeGreaterThan(spawnsBefore);
  });
});
