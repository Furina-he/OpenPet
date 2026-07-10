import type { Adapter, ChatTarget } from '@openpet/protocol';

/**
 * 决定一轮 send 的链首项 + model/adapter/baseUrl（纯函数，不碰 host）。
 * 无降级链：resolved 命中即单项 [sourceId]（带 adapter/baseUrl）；否则回退静态 chain。
 */
export function resolveSendTarget(
  explicitProviderId: string | undefined,
  staticChain: string[],
  resolved: ChatTarget | null | undefined,
): { chain: string[]; model?: string; adapter?: Adapter; baseUrl?: string } {
  if (explicitProviderId) return { chain: [explicitProviderId] };
  if (resolved) {
    return {
      chain: [resolved.sourceId],
      model: resolved.model,
      adapter: resolved.adapter,
      baseUrl: resolved.apiBase,
    };
  }
  return { chain: staticChain };
}
