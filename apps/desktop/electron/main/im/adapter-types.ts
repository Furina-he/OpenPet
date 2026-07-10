// 线 B-1：IM 适配器统一接口（T2 定义；onebot/telegram 适配器与 im-service 共用）。
import type { ImIncoming, ImStatus, ImChatKind } from '@openpet/protocol';

export interface ImAdapterCallbacks {
  onMessage: (msg: ImIncoming) => void;
  onStatus: (s: ImStatus) => void;
}
export interface ImAdapter {
  start(): void;
  stop(): Promise<void>;
  send(kind: ImChatKind, chatId: string, text: string): Promise<void>;
  status(): ImStatus;
}
/** 测试注入的最小 WS 面（Node 全局 WebSocket 结构子集）。 */
export interface WsLike {
  send(data: string): void;
  close(): void;
  addEventListener(ev: 'open' | 'close' | 'error', fn: () => void): void;
  addEventListener(ev: 'message', fn: (e: { data: unknown }) => void): void;
}
export type WsFactory = (url: string) => WsLike;
