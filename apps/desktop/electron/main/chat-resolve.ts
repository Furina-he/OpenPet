/** 决定一轮 send 的 provider 降级链首项与 model（纯函数，便于单测，不碰 host）。 */
export function resolveSendTarget(
  explicitProviderId: string | undefined,
  staticChain: string[],
  resolved: { providerId?: string; model?: string } | undefined,
): { chain: string[]; model?: string } {
  if (explicitProviderId) return { chain: [explicitProviderId] };
  const chain = resolved?.providerId ? [resolved.providerId] : staticChain;
  return { chain, ...(resolved?.model ? { model: resolved.model } : {}) };
}
