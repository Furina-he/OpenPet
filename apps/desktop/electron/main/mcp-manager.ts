/**
 * McpManager — MCP server 连接 / 工具发现 / 调用 + active 工具表（§4）。
 *
 * 不直接 import SDK：依赖注入 connectFactory（生产 = mcp-transports.ts 真 SDK；
 * 测试 = 内存 fake），故纯单测可覆盖发现/过滤/冲突/调用，不 spawn 子进程。
 * 工具名冲突：首注册 server 赢，后者跳过 + errlog（对齐 AstrBot tool_conflict_resolution）。
 */
import type { ChatTool, McpServer, McpServerStatus, McpTool } from '@openpet/protocol';
import { toolKey } from '@openpet/protocol';

/** SDK Client 的最小子集（便于注入内存实现测试）。 */
export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  }>;
  callTool(args: {
    name: string;
    arguments?: unknown;
  }): Promise<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
  close(): Promise<void>;
  /** 连接意外关闭回调槽（SDK Client 自带同名属性；内存 fake 需可赋值）。 */
  onclose?: (() => void) | undefined;
}

export interface McpManagerDeps {
  /** 按 server 配置建 client（已 connect）。生产 = mcp-transports；测试 = 内存。 */
  connectFactory: (server: McpServer) => Promise<{ client: McpClientLike }>;
  /** #6 重连退避序列 ms；缺省 [1s,2s,4s,8s,16s]；测试注入 [0,0] 加速。 */
  reconnectDelays?: number[];
  /** 连接事件旁路（§7 Trace / 未来托盘提示）。 */
  onEvent?: (
    action: 'mcp.disconnected' | 'mcp.reconnected' | 'mcp.gaveUp',
    fields: Record<string, unknown>,
  ) => void;
}

interface Runtime {
  client: McpClientLike;
  tools: Array<{ name: string; description: string; parameters: unknown }>;
  /** #6：重连需要原始配置（意外断线时 runtime 即将被清）。 */
  server: McpServer;
}

export class McpManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly errlogs = new Map<string, string[]>();
  private readonly toolOwner = new Map<string, string>(); // toolName → serverId（首注册赢）
  private disabled = new Set<string>(); // toolKey
  /** #6：重连挂起态（attempt = 已排的第 N 次尝试；timer 供意图关闭时掐掉）。 */
  private readonly reconnects = new Map<
    string,
    { attempt: number; timer: ReturnType<typeof setTimeout> }
  >();
  /** #6：意图关闭标记（disconnectServer 置位）——SDK close() 触发的 onclose 不算意外。 */
  private readonly intentionalClose = new Set<string>();

  constructor(private readonly deps: McpManagerDeps) {}

  setDisabled(keys: string[]): void {
    this.disabled = new Set(keys);
  }

  async connectServer(server: McpServer): Promise<void> {
    await this.disconnectServer(server.id);
    try {
      const { client } = await this.deps.connectFactory(server);
      const listed = await client.listTools();
      const tools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema ?? {},
      }));
      for (const t of tools) {
        const owner = this.toolOwner.get(t.name);
        if (owner && owner !== server.id) {
          this.pushErr(server.id, `tool name conflict: ${t.name} already from ${owner}, skipped`);
          continue;
        }
        this.toolOwner.set(t.name, server.id);
      }
      this.runtimes.set(server.id, { client, tools, server });
      this.intentionalClose.delete(server.id);
      client.onclose = () => this.onUnexpectedClose(server.id);
    } catch (e) {
      this.pushErr(server.id, e instanceof Error ? e.message : String(e));
    }
  }

  /** #6：意外断线（非 disconnectServer 意图关闭）→ 清运行态 + 事件 + 排重连。 */
  private onUnexpectedClose(id: string): void {
    if (this.intentionalClose.has(id)) return;
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const server = rt.server;
    this.runtimes.delete(id);
    for (const [name, owner] of this.toolOwner) if (owner === id) this.toolOwner.delete(name);
    this.deps.onEvent?.('mcp.disconnected', { serverId: id });
    this.scheduleReconnect(server, 0);
  }

  private scheduleReconnect(server: McpServer, attempt: number): void {
    const delays = this.deps.reconnectDelays ?? [1000, 2000, 4000, 8000, 16000];
    const delay = delays[attempt];
    if (delay === undefined) {
      this.reconnects.delete(server.id);
      this.pushErr(server.id, `重连 ${delays.length} 次失败，已放弃（重新保存或重新激活可再试）`);
      this.deps.onEvent?.('mcp.gaveUp', { serverId: server.id, attempts: delays.length });
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        await this.connectServer(server);
        if (this.runtimes.has(server.id)) {
          this.reconnects.delete(server.id);
          this.deps.onEvent?.('mcp.reconnected', { serverId: server.id, attempt: attempt + 1 });
        } else {
          this.scheduleReconnect(server, attempt + 1);
        }
      })();
    }, delay);
    this.reconnects.set(server.id, { attempt: attempt + 1, timer });
  }

  async disconnectServer(id: string): Promise<void> {
    // #6：意图关闭——SDK close() 会触发 onclose，先置标记防误判成意外断线；顺手掐掉挂起的重连。
    this.intentionalClose.add(id);
    const rec = this.reconnects.get(id);
    if (rec) {
      clearTimeout(rec.timer);
      this.reconnects.delete(id);
    }
    const rt = this.runtimes.get(id);
    if (rt) {
      try {
        await rt.client.close();
      } catch {
        /* ignore */
      }
      this.runtimes.delete(id);
    }
    for (const [name, owner] of this.toolOwner) if (owner === id) this.toolOwner.delete(name);
    this.errlogs.delete(id);
  }

  async connectAll(servers: McpServer[]): Promise<void> {
    for (const s of servers) if (s.active) await this.connectServer(s);
  }

  async disconnectAll(): Promise<void> {
    for (const id of [...this.runtimes.keys()]) await this.disconnectServer(id);
    for (const id of [...this.reconnects.keys()]) await this.disconnectServer(id);
  }

  /** 当前发现的工具（含 active 计算）。serverActive(id)=false → 该 server 工具 active=false。 */
  discoveredTools(serverActive: (id: string) => boolean): McpTool[] {
    const out: McpTool[] = [];
    for (const [id, rt] of this.runtimes) {
      for (const t of rt.tools) {
        if (this.toolOwner.get(t.name) !== id) continue; // 冲突被跳过者不计
        const active = serverActive(id) && !this.disabled.has(toolKey(id, t.name));
        out.push({
          serverId: id,
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          active,
        });
      }
    }
    return out;
  }

  /** 注入 LLM 的 active 工具定义。 */
  activeToolDefs(serverActive: (id: string) => boolean): ChatTool[] {
    return this.discoveredTools(serverActive)
      .filter((t) => t.active)
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const owner = this.toolOwner.get(name);
    const rt = owner ? this.runtimes.get(owner) : undefined;
    if (!rt) throw new Error(`MCP tool not found or server disconnected: ${name}`);
    const res = await rt.client.callTool({ name, arguments: args });
    const text = (res.content ?? [])
      .map((c) => (c.type === 'text' && c.text ? c.text : JSON.stringify(c)))
      .join('\n');
    if (res.isError) throw new Error(text || `tool ${name} returned error`);
    return text;
  }

  status(): Record<string, McpServerStatus> {
    const out: Record<string, McpServerStatus> = {};
    const ids = new Set([
      ...this.runtimes.keys(),
      ...this.errlogs.keys(),
      ...this.reconnects.keys(),
    ]);
    for (const id of ids) {
      const rec = this.reconnects.get(id);
      out[id] = {
        connected: this.runtimes.has(id),
        errlogs: this.errlogs.get(id) ?? [],
        ...(rec ? { reconnectAttempts: rec.attempt } : {}),
      };
    }
    return out;
  }

  private pushErr(id: string, msg: string): void {
    const arr = this.errlogs.get(id) ?? [];
    arr.push(msg);
    this.errlogs.set(id, arr);
  }
}
