import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { ChatService } from '../electron/main/chat-service';

const require = createRequire(import.meta.url);
const PROVIDER_ENTRY = require.resolve('@openpet/sidecar/dist/workers/provider-worker-entry.js');

type Sent = { channel: string; params: any };

function until(pred: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    const tick = setInterval(() => {
      if (pred()) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}
const doneOf = (sent: Sent[], id: string) =>
  sent.find((s) => s.channel === 'chat.done' && s.params.sessionId === id);

let svc: ChatService | null = null;
afterEach(async () => {
  await svc?.dispose();
  svc = null;
});

describe('ChatService · intercept 命令短路（线 B-2 T7）', () => {
  it('intercept 返回文本 → 经正常通知面广播（stream+done stop）+ 入历史，不走 provider', async () => {
    const sent: Sent[] = [];
    const intercept = vi.fn(async (_sid: string, text: string) =>
      text.startsWith('/') ? '签到成功 ✅' : null,
    );
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      queue: { flushIntervalMs: 5 },
      host: { intervalMs: 5 },
      intercept,
    });
    await svc.send('s1', '/签到');
    await until(() => !!doneOf(sent, 's1'), 'intercepted done');

    expect(intercept).toHaveBeenCalledWith('s1', '/签到');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toBe('签到成功 ✅');

    const snap = svc.snapshot('s1');
    expect(snap.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '/签到'],
      ['assistant', '签到成功 ✅'],
    ]);
  });

  it('intercept 返回 null → 照旧走 provider（mock 流照常）', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      queue: { flushIntervalMs: 5 },
      host: { intervalMs: 5 },
      intercept: async () => null,
    });
    await svc.send('s2', '普通聊天');
    await until(() => !!doneOf(sent, 's2'), 'mock stream done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('签到');
  });

  it('未注入 intercept → 行为与现状一致', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      queue: { flushIntervalMs: 5 },
      host: { intervalMs: 5 },
    });
    await svc.send('s3', 'hello');
    await until(() => !!doneOf(sent, 's3'), 'plain done');
    expect(doneOf(sent, 's3')!.params.finishReason).toBe('stop');
  });
});
