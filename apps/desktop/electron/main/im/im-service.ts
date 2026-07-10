// IM 编排：唤醒(照 AstrBot waking_check)→ 白名单(whitelist_check)→
// 会话串行化(ChatService busy 规避)→ 回复捕获整段回发。
// 适配器经 adapterFactory 注入（测试假体）；缺省按 type 建真适配器。
import {
  imOrigin,
  parseImOrigin,
  isImSession,
  type ImIncoming,
  type ImPlatform,
  type ImStatus,
  type Prefs,
} from '@openpet/protocol';
import { createOnebotAdapter } from './onebot-adapter.js';
import { createTelegramAdapter } from './telegram-adapter.js';
import type { ImAdapter, ImAdapterCallbacks } from './adapter-types.js';

export interface ImServiceDeps {
  getPrefs: () => Prefs;
  chat: { send: (sessionId: string, text: string) => Promise<{ ok: true }> };
  broadcast: (channel: string, params: unknown) => void;
  /** 测试注入；缺省按 type 建真适配器。 */
  adapterFactory?: (p: ImPlatform, cb: ImAdapterCallbacks) => ImAdapter;
  log?: (msg: string) => void;
}

const QUEUE_CAP = 3;

export function createImService(deps: ImServiceDeps) {
  const log = deps.log ?? ((m) => console.info(`[im] ${m}`));
  const adapters = new Map<string, { adapter: ImAdapter; cfg: ImPlatform }>();
  const statuses = new Map<string, ImStatus>();
  /** origin → 回复累积缓冲（chat.stream 已被 conversation-core 剥完行为标签，是干净台词）。 */
  const replyBuf = new Map<string, string>();
  /** origin → 待发队列 + 在途标记（同 origin 一次一轮，避开 ChatService busy -32001）。 */
  const pending = new Map<string, { queue: string[]; busy: boolean }>();

  const makeAdapter = (p: ImPlatform, cb: ImAdapterCallbacks): ImAdapter =>
    deps.adapterFactory
      ? deps.adapterFactory(p, cb)
      : p.type === 'onebot-v11'
        ? createOnebotAdapter(p, cb)
        : createTelegramAdapter(p, cb);

  /** 唤醒判定；返回唤醒后的正文（剥前缀），null = 不唤醒。 */
  function wakeCheck(msg: ImIncoming): string | null {
    const prefs = deps.getPrefs();
    let text = msg.text;
    const prefixes = prefs['im.wakePrefixes'];
    const prefixHit = prefixes.find((w) => w && text.startsWith(w));
    if (prefixHit !== undefined) text = text.slice(prefixHit.length).trim();
    if (msg.kind === 'private') {
      if (prefs['im.friendNeedsWake'] && prefixHit === undefined) return null;
      return text || null;
    }
    // 群聊：@我 / 引用我 / 前缀命中
    if (msg.atMe || msg.replyToMe || prefixHit !== undefined) return text || null;
    return null;
  }

  function whitelistCheck(msg: ImIncoming, origin: string): boolean {
    const prefs = deps.getPrefs();
    if (!prefs['im.whitelistEnabled']) return true;
    const wl = prefs['im.whitelist'].map((s) => s.trim()).filter(Boolean);
    if (wl.length === 0) return true;
    if (prefs['im.admins'].includes(msg.senderId) && msg.kind === 'private') return true;
    return wl.includes(origin) || wl.includes(msg.chatId) || wl.includes(msg.senderId);
  }

  function dispatch(origin: string): void {
    const p = pending.get(origin);
    if (!p || p.busy) return;
    const text = p.queue.shift();
    if (text === undefined) return;
    p.busy = true;
    replyBuf.set(origin, '');
    deps.chat.send(origin, text).catch((e) => {
      log(`send failed for ${origin}: ${String(e)}`);
      p.busy = false;
      replyBuf.delete(origin);
      dispatch(origin);
    });
  }

  function sendReply(origin: string, text: string): void {
    const parsed = parseImOrigin(origin);
    if (!parsed) return;
    const entry = adapters.get(parsed.platformId);
    if (!entry) return;
    entry.adapter
      .send(parsed.kind, parsed.chatId, text)
      .catch((e) => log(`reply to ${origin} failed: ${String(e)}`));
  }

  const service = {
    /** 适配器入站回调（也是测试入口）。 */
    handleIncoming(msg: ImIncoming): void {
      const woken = wakeCheck(msg);
      if (woken === null) return;
      const origin = imOrigin(msg.platformId, msg.kind, msg.chatId);
      if (!whitelistCheck(msg, origin)) return;
      if (deps.getPrefs()['im.notifyDesktop']) {
        deps.broadcast('im.activity', {
          platformId: msg.platformId,
          senderName: msg.senderName,
          text: woken.slice(0, 40),
        });
      }
      const text = msg.kind === 'group' ? `${msg.senderName}：${woken}` : woken;
      const p = pending.get(origin) ?? { queue: [], busy: false };
      pending.set(origin, p);
      if (p.queue.length >= QUEUE_CAP) {
        log(`queue overflow for ${origin}, dropped`);
        return;
      }
      p.queue.push(text);
      dispatch(origin);
    },

    /**
     * ipc-router broadcast tee 调用；返回 true = 该通知属 IM 会话（勿再扇出窗口/voice）。
     * 只认领 chat.* 通道——trace.record 等同样带 sessionId 的通知照常扇出（诊断页可见 IM 轮）。
     */
    handleNotify(channel: string, params: unknown): boolean {
      if (!channel.startsWith('chat.')) return false;
      const sid = (params as { sessionId?: string }).sessionId;
      if (!sid || !isImSession(sid)) return false;
      if (channel === 'chat.stream') {
        replyBuf.set(sid, (replyBuf.get(sid) ?? '') + (params as { text: string }).text);
      } else if (channel === 'chat.done') {
        const text = (replyBuf.get(sid) ?? '').trim();
        replyBuf.delete(sid);
        const p = pending.get(sid);
        if (p) p.busy = false;
        if ((params as { finishReason: string }).finishReason === 'stop' && text)
          sendReply(sid, text);
        dispatch(sid);
      }
      return true;
    },

    /** 群聊会话默认不进轮末记忆提炼（spec §2.3 口径）；ipc-router onTurnEnd 包装用。 */
    shouldExtractMemory(sessionId: string): boolean {
      const parsed = parseImOrigin(sessionId);
      if (!parsed) return true;
      if (parsed.kind === 'private') return true;
      return deps.getPrefs()['im.groupIntoMemory'];
    },

    /** prefs im.platforms 变更 → 重载（配置整体替换：全停再按 enable 起）。 */
    async reload(): Promise<void> {
      for (const [, e] of adapters) await e.adapter.stop();
      adapters.clear();
      for (const cfg of deps.getPrefs()['im.platforms']) {
        if (!cfg.enable) continue;
        const adapter = makeAdapter(cfg, {
          onMessage: (m) => service.handleIncoming(m),
          onStatus: (s) => {
            statuses.set(s.platformId, s);
            deps.broadcast('im.status', s);
          },
        });
        adapters.set(cfg.id, { adapter, cfg });
        adapter.start();
      }
      // 已删平台的残留状态清掉（禁用但仍配置的保留 stopped，供连接页显示）
      const configured = new Set(deps.getPrefs()['im.platforms'].map((p) => p.id));
      for (const id of [...statuses.keys()]) if (!configured.has(id)) statuses.delete(id);
    },

    statuses: (): ImStatus[] => [...statuses.values()],
    async dispose(): Promise<void> {
      for (const [, e] of adapters) await e.adapter.stop();
      adapters.clear();
    },
  };
  return service;
}
export type ImService = ReturnType<typeof createImService>;
