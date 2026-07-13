// IM 编排：唤醒(照 AstrBot waking_check)→ 白名单(whitelist_check)→
// 会话串行化(ChatService busy 规避)→ 回复捕获回发（⑭ 自然节奏开 = newBubble 分段多条 + 段间打字延迟；关 = 整段单条）。
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
  /** ⑭ 段间打字延迟（测试注入定值）；缺省 clamp(字数×80ms, 800, 3000) ±20% jitter。 */
  imDelayMs?: (chars: number) => number;
}

const QUEUE_CAP = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** IM 打字比桌面慢更像人（spec §2）：clamp(字数×80ms, 800, 3000) ±20%。 */
const defaultImDelayMs = (chars: number) =>
  Math.round(Math.min(3000, Math.max(800, chars * 80)) * (0.8 + Math.random() * 0.4));

export function createImService(deps: ImServiceDeps) {
  const log = deps.log ?? ((m) => console.info(`[im] ${m}`));
  const imDelay = deps.imDelayMs ?? defaultImDelayMs;
  const adapters = new Map<string, { adapter: ImAdapter; cfg: ImPlatform }>();
  const statuses = new Map<string, ImStatus>();
  /** origin → 回复分段缓冲（chat.stream 已被 conversation-core 剥完行为标签；newBubble 开新元素）。 */
  const replyBuf = new Map<string, string[]>();
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
    replyBuf.set(origin, []);
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
        const q = params as { text: string; newBubble?: boolean };
        const arr = replyBuf.get(sid) ?? [];
        if (arr.length === 0 || q.newBubble) arr.push(q.text);
        else arr[arr.length - 1] += q.text;
        replyBuf.set(sid, arr);
      } else if (channel === 'chat.done') {
        const parts = (replyBuf.get(sid) ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
        replyBuf.delete(sid);
        const p = pending.get(sid);
        const finish = (params as { finishReason: string }).finishReason;
        if (finish === 'stop' && parts.length > 0) {
          if (deps.getPrefs()['chat.naturalRhythm'] && parts.length > 1) {
            // ⑭ 多条回发：段间打字延迟；全发完才解 busy → 串行化语义不变。
            void (async () => {
              for (let i = 0; i < parts.length; i++) {
                if (i > 0) await sleep(imDelay(parts[i]!.length));
                sendReply(sid, parts[i]!);
              }
              if (p) p.busy = false;
              dispatch(sid);
            })();
            return true;
          }
          sendReply(sid, parts.join('\n'));
        }
        if (p) p.busy = false;
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
