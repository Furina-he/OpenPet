// Desktop 插件 worker 引导（线 B-2）：动态 import 插件 entry，能力经 parentPort JSON 帧与 Main 互通。
// 协议（t 字段）：
//   Main→worker: init{manifest,config,entryPath} / toolCall{id,name,args} / config{config}
//                / fetchResult{id,status,body}
//   worker→Main: ready{tools,cues} / toolResult{id,ok,result|error} / say{text} / log{msg}
//                / fetchRequest{id,url,init}
// 能力门：manifest.permissions 未声明 → say 静默丢弃 / fetch reject / tools·cues 不上报。
import { parentPort, type MessagePort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import type { DesktopPluginDef, PluginCtx, PluginFetchInit } from '@openpet/plugin-sdk';

type Frame = Record<string, unknown> & { t: string };

export function attachPluginRuntime(port: MessagePort): void {
  const post = (f: Frame): void => port.postMessage(f);

  let def: DesktopPluginDef | null = null;
  let config: Record<string, unknown> = {};
  let perms: string[] = [];
  let fetchSeq = 0;
  const fetchWaiters = new Map<number, (r: { status: number; body: string }) => void>();

  const ctx: PluginCtx = {
    say: (text) => {
      if (perms.includes('say')) post({ t: 'say', text });
    },
    fetch: (url: string, init?: PluginFetchInit) => {
      if (!perms.includes('fetch')) {
        return Promise.reject(new Error('permission fetch not declared'));
      }
      fetchSeq += 1;
      const id = fetchSeq;
      return new Promise<{ status: number; body: string }>((resolve) => {
        fetchWaiters.set(id, resolve);
        post({ t: 'fetchRequest', id, url, init: init ?? {} });
      });
    },
    config: () => config,
    log: (msg) => post({ t: 'log', msg }),
  };

  port.on('message', (raw: Frame) => {
    void (async () => {
      if (raw.t === 'init') {
        const manifest = (raw.manifest ?? {}) as { permissions?: string[] };
        perms = manifest.permissions ?? [];
        config = (raw.config as Record<string, unknown>) ?? {};
        const mod = (await import(pathToFileURL(String(raw.entryPath)).href)) as {
          default: DesktopPluginDef;
        };
        def = mod.default;
        await def.activate?.(ctx);
        post({
          t: 'ready',
          tools: (perms.includes('tools') ? (def.tools ?? []) : []).map((tl) => ({
            name: tl.name,
            description: tl.description,
            parameters: tl.parameters,
          })),
          cues: perms.includes('cues') ? (def.cues ?? []) : [],
        });
      } else if (raw.t === 'toolCall') {
        try {
          const tool = def?.tools?.find((tl) => tl.name === raw.name);
          if (!tool) throw new Error(`unknown tool ${String(raw.name)}`);
          const result = await tool.execute(raw.args, ctx);
          post({ t: 'toolResult', id: raw.id, ok: true, result: result ?? null });
        } catch (e) {
          post({ t: 'toolResult', id: raw.id, ok: false, error: String(e) });
        }
      } else if (raw.t === 'config') {
        config = (raw.config as Record<string, unknown>) ?? {};
        def?.onConfigChanged?.(config);
      } else if (raw.t === 'fetchResult') {
        const waiter = fetchWaiters.get(raw.id as number);
        fetchWaiters.delete(raw.id as number);
        waiter?.({ status: Number(raw.status), body: String(raw.body) });
      }
    })().catch((e) => post({ t: 'log', msg: `plugin-entry error: ${String(e)}` }));
  });
}

if (parentPort) {
  attachPluginRuntime(parentPort);
}
