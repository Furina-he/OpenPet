/** J5 诊断/崩溃 payload 组装 + 脱敏（纯）：永不含 Key/对话内容；日志仅最近 200 行。 */
export interface DiagInput {
  version: string;
  platform: string;
  stack?: string;
  prefs: Record<string, unknown>;
  logs: string[];
  secrets?: unknown; // 仅为强调"不进 payload"，函数不读它
}
export interface Diag {
  version: string;
  platform: string;
  stack: string;
  config: Record<string, unknown>;
  logs: string[];
}
const MAX_LOG_LINES = 200;

export function assembleDiag(input: DiagInput): Diag {
  // 配置摘要：只取非敏感 prefs（剔除任何含 key/secret/token/password 字样的键）。
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.prefs)) {
    if (/key|secret|token|password/i.test(k)) continue;
    config[k] = v;
  }
  return {
    version: input.version,
    platform: input.platform,
    stack: input.stack ?? '',
    config,
    logs: input.logs.slice(-MAX_LOG_LINES),
  };
}
