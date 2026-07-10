import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatService } from '../electron/main/chat-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PROBE_ENTRY = path.join(__dirname, 'fixtures/kb-probe-worker.mjs');

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
const streamText = (sent: Sent[]) =>
  sent
    .filter((s) => s.channel === 'chat.stream')
    .map((s) => s.params.text)
    .join('');

let svc: ChatService | null = null;
afterEach(async () => {
  await svc?.dispose();
  svc = null;
});

describe('ChatService · 自动 RAG 注入 (§5)', () => {
  it('retrieveKb 命中 → 片段进 system（worker 看见）+ 片段不进 chat.stream（气泡干净）', async () => {
    const sent: Sent[] = [];
    const SNIPPET = 'KBSNIPPET_MARKER 猫住在屋顶的瓦片下';
    let askedQuery = '';
    svc = new ChatService({
      providerEntryPath: KB_PROBE_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      retrieveKb: async (q) => {
        askedQuery = q;
        return [{ text: SNIPPET }];
      },
    });
    await svc.send('s1', '猫住哪里');
    await until(() => !!doneOf(sent, 's1'), 'rag done');

    // retrieveKb 收到用户输入
    expect(askedQuery).toBe('猫住哪里');
    // worker 在 system 里看见了片段标记
    expect(streamText(sent)).toContain('SAW_SNIPPET');
    // 片段原文 / 标记均不进气泡（chat.stream）
    expect(streamText(sent)).not.toContain('KBSNIPPET_MARKER');
    expect(streamText(sent)).not.toContain('猫住在屋顶');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
  });

  it('无 retrieveKb → system 无片段（worker 报 NO_SNIPPET），对话照常', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: KB_PROBE_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
    });
    await svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'no-rag done');
    expect(streamText(sent)).toContain('NO_SNIPPET');
  });

  it('retrieveKb 抛错 → 跳过注入，对话仍正常 done', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: KB_PROBE_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      retrieveKb: async () => {
        throw new Error('embed boom');
      },
    });
    await svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'rag-error done');
    // 检索失败 → 不注入（NO_SNIPPET），但对话不被阻断
    expect(streamText(sent)).toContain('NO_SNIPPET');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
  });
});
