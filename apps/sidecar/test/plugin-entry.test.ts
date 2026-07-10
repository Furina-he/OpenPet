import { describe, it, expect, afterEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 真 worker + dist 入口（照 provider entry 测试现状：测试前须 sidecar build）。
const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ENTRY = path.resolve(here, '../dist/plugin-entry.js');
const DEMO_PLUGIN = path.resolve(here, 'fixtures/demo-plugin.mjs');

type Frame = Record<string, unknown> & { t: string };

const workers: Worker[] = [];

function spawn(): { worker: Worker; frames: Frame[]; next: (t: string) => Promise<Frame> } {
  const worker = new Worker(PLUGIN_ENTRY);
  workers.push(worker);
  const frames: Frame[] = [];
  const waiters: Array<{ t: string; resolve: (f: Frame) => void }> = [];
  worker.on('message', (f: Frame) => {
    frames.push(f);
    const i = waiters.findIndex((w) => w.t === f.t);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(f);
  });
  const next = (t: string): Promise<Frame> => {
    const hit = frames.find((f) => f.t === t);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => waiters.push({ t, resolve }));
  };
  return { worker, frames, next };
}

function init(worker: Worker, permissions: string[], config: Record<string, unknown> = {}): void {
  worker.postMessage({
    t: 'init',
    manifest: { id: 'demo', permissions },
    entryPath: DEMO_PLUGIN,
    config,
  });
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.terminate()));
});

describe('plugin-entry worker 引导', () => {
  it('init → activate say + ready 带 tools/cues', async () => {
    const { worker, frames, next } = spawn();
    init(worker, ['tools', 'cues', 'say']);
    const ready = await next('ready');
    const tools = ready.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain('echo');
    expect(ready.cues).toEqual([{ id: 'plug-cue', on: 'chat.done', do: [] }]);
    expect(frames.some((f) => f.t === 'say' && f.text === 'hi from plugin')).toBe(true);
  });

  it('权限未声明 tools/cues/say → ready 空 + say 被丢弃', async () => {
    const { worker, frames, next } = spawn();
    init(worker, []);
    const ready = await next('ready');
    expect(ready.tools).toEqual([]);
    expect(ready.cues).toEqual([]);
    expect(frames.some((f) => f.t === 'say')).toBe(false);
  });

  it('toolCall echo → toolResult ok，未知工具 → ok:false', async () => {
    const { worker, next } = spawn();
    init(worker, ['tools']);
    await next('ready');
    worker.postMessage({ t: 'toolCall', id: 1, name: 'echo', args: { a: 1 } });
    const r1 = await next('toolResult');
    expect(r1.ok).toBe(true);
    expect((r1.result as { echoed: { a: number } }).echoed.a).toBe(1);

    worker.postMessage({ t: 'toolCall', id: 2, name: 'nope', args: {} });
    const r2 = await new Promise<Frame>((resolve) => {
      worker.on('message', (f: Frame) => {
        if (f.t === 'toolResult' && f.id === 2) resolve(f);
      });
    });
    expect(r2.ok).toBe(false);
    expect(String(r2.error)).toContain('unknown tool');
  });

  it('fetch 权限声明 → fetchRequest/fetchResult 往返；未声明 → execute 报错', async () => {
    const { worker, next } = spawn();
    init(worker, ['tools', 'fetch']);
    await next('ready');
    worker.postMessage({ t: 'toolCall', id: 3, name: 'fetchit', args: { url: 'https://x.test/' } });
    const req = await next('fetchRequest');
    expect(req.url).toBe('https://x.test/');
    worker.postMessage({ t: 'fetchResult', id: req.id, status: 200, body: 'pong' });
    const r = await next('toolResult');
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ status: 200, body: 'pong' });

    const noPerm = spawn();
    init(noPerm.worker, ['tools']);
    await noPerm.next('ready');
    noPerm.worker.postMessage({ t: 'toolCall', id: 4, name: 'fetchit', args: { url: 'https://x.test/' } });
    const r2 = await noPerm.next('toolResult');
    expect(r2.ok).toBe(false);
    expect(String(r2.error)).toContain('permission fetch not declared');
  });

  it('config 帧 → onConfigChanged 收到新值', async () => {
    const { worker, next } = spawn();
    init(worker, ['say'], { greeting: 'old' });
    await next('ready');
    worker.postMessage({ t: 'config', config: { greeting: 'new' } });
    const log = await next('log');
    expect(String(log.msg)).toContain('config-changed:{"greeting":"new"}');
  });
});
