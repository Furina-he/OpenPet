/**
 * IPC 路由接线 — Renderer ⇄ Main 的唯一缝。
 *
 * 进站：preload 的 `window.openpet.rpc` → `ipcMain.handle('openpet:rpc')` →
 *       纯 router（Zod 校验 + 分发）→ ChatService / CharacterService / 窗口操作。
 * 出站：ChatService 的背压队列 flush → 广播到所有窗口的
 *       `openpet:notify:<channel>`；各 renderer 只订阅自己关心的 channel
 *       （overlay → chat.*，character → behavior.* + chat.done）。
 *       behavior.lookAt / 主动行为 playAction 只与 character 相关 → 经
 *       sendToCharacter 直发，不进背压队列（见 cursor-publisher.ts 头注释）。
 * 业务编排全部下沉到纯模块——本文件只做 Electron 缝。
 */
import { ipcMain, BrowserWindow, Menu, net, type WebContents } from 'electron';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn as cpSpawn, execFile } from 'node:child_process';
import path from 'node:path';
import {
  DEFAULT_CUES,
  mergeCues,
  parseImOrigin,
  resolveChatTarget,
  resolveEmbeddingTarget,
  resolveRerankTarget,
  validateImPlatform,
  type McpServer,
} from '@openpet/protocol';
import { ChatService } from './chat-service.js';
import { createImService, type ImService } from './im/im-service.js';
import { InteractionService } from './interaction-service.js';
import { createInteractionScheduler } from './interaction-scheduler.js';
import { MoodState } from './mood-state.js';
import { McpManager, type McpClientLike } from './mcp-manager.js';
import { createMcpService } from './mcp-service.js';
import { createStatsService } from './stats-service.js';
import { deriveTitle, sanitizeFilename, sessionToMarkdown } from './session-export.js';
import {
  assertNotImSession,
  nextActiveAfterDelete,
  writeActiveSession,
} from './session-guards.js';
import { createKbService } from './kb-service.js';
import { parseKbFile } from './kb-file.js';
import { rerankDocs } from './rerank-client.js';
import { createMemoryService } from './memory-service.js';
import { createMemoryExtractor } from './memory-extractor.js';
import { createPersonaService } from './persona-service.js';
import { createTraceCollector } from './trace-collector.js';
import { createRouter, RpcError } from './router.js';
import { buildCharacterMenuTemplate } from './character-menu.js';
import { menuLabels } from './menu-labels.js';
import * as appActions from './app-actions.js';
import { assembleDiag } from './crash-payload.js';
import { createCharacterService } from './character-service.js';
import { runTestGreeting } from './character-greeting.js';
import { inspectPack, installPack } from './pack-import.js';
import { removeCharacter } from './character-ops.js';
import { DesktopPluginHost } from './plugins/desktop-plugin-host.js';
import { mergeToolPorts } from './plugins/tool-port-merge.js';
import { createPluginService, readPluginConfig } from './plugins/plugin-service.js';
import { createStarHostService, type ChildLike } from './plugins/star-host-service.js';
import { createConversationStore } from './db/index.js';
import { stageDsbakImport } from './db/import-data.js';
import { createIdleResponder } from './idle-responder.js';
import { scaledBounds, CHARACTER_BASE_SIZE } from './window-scale.js';
import {
  createPrefsStore,
  createPrefEffects,
  applyAllEffects,
  type PrefsStore,
  type PrefEffects,
} from './prefs/index.js';
import { createVoiceService, type FetchLike } from './voice-service.js';
import { createPrefsService } from './prefs-service.js';
import { createAppService } from './app-service.js';
import { createOnboardingService } from './onboarding-service.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  /** character 窗口定位（setScale / 主动行为直发）。 */
  characterWindow: () => BrowserWindow | null;
  /** Hub（settings 窗口）定位器；index 注入。openHub RPC 用它 show+focus。 */
  settingsWindow?: () => BrowserWindow | null;
  /** 引导窗定位器（M7b-2）；finishOnboarding hide 它。 */
  onboardingWindow?: () => BrowserWindow | null;
  /** overlay 窗定位器（M7b-2）；finishOnboarding show 它。 */
  overlayWindow?: () => BrowserWindow | null;
  /** 角色包根目录（dev: apps/desktop/characters；打包: resources/characters）。 */
  charactersRoot: string;
  /** 导入包根（生产 userData/characters）；缺省 charactersRoot/_imported（测试）。 */
  importedCharactersRoot?: string;
  /** E3 系统选择框（index 注入 dialog.showOpenDialog）；缺省 null=取消。 */
  pickCharacterPath?: (kind: 'pack' | 'folder') => Promise<string | null>;
  /** ⑩.7 E4：导出 .dspack 保存框（index 注入 dialog.showSaveDialog）；缺省 null=取消。 */
  pickDspackSave?: (defaultName: string) => Promise<string | null>;
  /** ⑩.7 E2：在文件夹中显示（index 注入 shell.showItemInFolder）。 */
  revealItem?: (fullPath: string) => void;
  /** 线 B-2 Desktop 插件：安装根（生产 userData/plugins）；缺省 charactersRoot/_plugins（测试空）。 */
  pluginsRoot?: string;
  /** 线 B-2：sidecar dist plugin-entry 路径；缺省 ''（无插件时永不 spawn，测试安全）。 */
  pluginEntryPath?: string;
  /** 线 B-2 插件安装选择框；缺省 null=取消。 */
  pickPluginPath?: (kind: 'dsplug' | 'folder') => Promise<string | null>;
  /** 线 B-2 Star：宿主目录（resources/star-host）。注入才启动 star 宿主（测试缺省不启）。 */
  starHostDir?: string;
  /** 线 B-2 Star：插件目录（生产 userData/star-plugins）。 */
  starPluginsDir?: string;
  /** 线 B-2 Star：venv 目录（生产 userData/star-host/venv）。 */
  starVenvDir?: string;
  /** 线 B-2 Star 安装选择框；缺省 null=取消。 */
  pickStarPath?: (kind: 'zip' | 'folder') => Promise<string | null>;
  /** 批次⑥ KB 文件导入选择框（.txt/.md/.pdf）；index 注入；缺省 null=取消。 */
  pickKbFile?: () => Promise<string | null>;
  /** 批次⑥ D7：.dsbak 打开/保存对话框 + 打开数据目录 + 重启；index 注入。 */
  pickDsbakOpen?: () => Promise<string | null>;
  pickDsbakSave?: () => Promise<string | null>;
  /** 会话导出 .md 保存框（index.ts showSaveDialog；测试省略）。 */
  pickMarkdownSave?: (defaultName: string) => Promise<string | null>;
  openDataDir?: () => void;
  relaunch?: () => void;
  providerEntryPath: string;
  /** sessions.db 路径（生产 userData/data/sessions.db；测试省略=纯内存）。 */
  sqlitePath?: string;
  /** Electron 专属 better-sqlite3 产物目录（dev=app 根 native/；打包=resources/native）。 */
  nativeDir?: string;
  /** ⑪ 发布批次：打包版 sqlite 失败即响（true=不降级内存库，调 onStoreFatal 后抛）。 */
  requireNativeStore?: boolean;
  onStoreFatal?: (message: string) => void;
  /** 代理 fetch 网关依赖（Electron net + 白名单 + Keychain 注入）；生产由 index.ts 注入。 */
  fetch?: import('./fetch-gateway.js').FetchGatewayDeps;
  /** 默认 provider id（chat.send 未指定时用）；M5 固定 'openai'，M7 接用户选择。 */
  defaultProviderId?: string;
  /** provider.* RPC handlers（M5）；index.ts 注入，spread 进 router。 */
  providerService?: ReturnType<typeof import('./provider-service.js').createProviderService>;
  /** §4：真 MCP transport 工厂（index 注入 connectMcpServer）；缺省=未配置（无 MCP server 时无影响）。 */
  mcpConnectFactory?: (server: McpServer) => Promise<{ client: McpClientLike }>;
  /** 应用偏好持久化（M7a）；index.ts 注入 JsonPrefsStore。缺省纯内存（测试）。 */
  prefsStore?: PrefsStore;
  /** pref 副作用表（M7a 空 seam）。 */
  prefEffects?: PrefEffects;
  /** 开机自启动开关施加器（index 注入 app.setLoginItemSettings）。 */
  setLoginItem?: (open: boolean) => void;
  /** app.* 杂项 handlers（openExternal）；index 注入 shell.openExternal。 */
  appService?: ReturnType<typeof createAppService>;
  /** 每条出站通知的旁路观察者（J1 托盘据 chat.stream/done 切三态图标）。 */
  onBroadcast?: (channel: string, params: unknown) => void;
  /** ⑩.6 音色工坊：参考音频根（生产 userData/voices）；缺省 charactersRoot/_voices（测试）。 */
  voicesDir?: string;
  /** J5 诊断：app 版本 + .dsdiag 落盘路径（index 注入 app.getVersion() + userData 路径）。 */
  appVersion?: string;
  diagPath?: string;
  /** ⑪ 自动更新服务（index 注入 createUpdateService 真实例；缺省 RPC 返回 disabled）。 */
  updateService?: import('./update-service.js').UpdateService;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): {
  dispose: () => Promise<void>;
  /** F-IT-06：index 的 fullscreen-watch 状态变化转入（true → desktop.fullscreen cue）。 */
  notifyDesktopState: (fullscreen: boolean) => void;
} {
  // F-VC：先声明后装配（broadcast 闭包引用它；构造依赖 store/characters 在下方才建）。
  let voiceService: ReturnType<typeof createVoiceService> | null = null;
  // 线 B-1：同款先声明后装配；tee 把 im: 会话的 chat.* 从窗口扇出与 TTS 中剥离。
  let imService: ImService | null = null;
  const broadcast = (channel: string, params: unknown): void => {
    // 线 B-1：im: 会话的 chat.* 通知只喂 im-service（整段回发平台），不进窗口/不触发 TTS。
    if (imService?.handleNotify(channel, params)) return;
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`openpet:notify:${channel}`, params);
    }
    deps.onBroadcast?.(channel, params);
    // F-VC autoSpeak 旁路：回复正常完成 → 朗读该会话最后一条 assistant 文本。
    // fire-and-forget；autoSpeak 关/未配置/请求失败在 speakSession 内静默短路。
    if (channel === 'chat.done' && (params as { finishReason?: string }).finishReason === 'stop')
      void voiceService?.speakSession((params as { sessionId: string }).sessionId);
  };
  const sendToCharacter = (channel: string, params: unknown): void => {
    const win = deps.characterWindow();
    if (win && !win.isDestroyed()) win.webContents.send(`openpet:notify:${channel}`, params);
  };

  const store = createConversationStore(
    deps.sqlitePath
      ? {
          sqlitePath: deps.sqlitePath,
          ...(deps.nativeDir ? { nativeDir: deps.nativeDir } : {}),
          ...(deps.requireNativeStore ? { requireNative: true } : {}),
          ...(deps.onStoreFatal ? { onFatal: deps.onStoreFatal } : {}),
        }
      : {},
  );
  // 应用偏好（M7a）：单写者 PrefsStore。在 ChatService 之前声明，供 resolveModel 读当前 provider/model。
  const prefsStore = deps.prefsStore ?? createPrefsStore({});
  const importedRoot = deps.importedCharactersRoot ?? path.join(deps.charactersRoot, '_imported');
  const characters = createCharacterService({
    builtinRoot: deps.charactersRoot,
    importedRoot,
    activeId: () => prefsStore.getAll()['character.activeId'],
    setActiveId: (id) => prefsStore.set('character.activeId', id),
  });
  // §7 Trace：环形缓冲 + trace.record 直发；开关实时读 prefs。
  const trace = createTraceCollector({
    broadcast,
    enabled: () => prefsStore.getAll()['trace.enabled'],
  });
  // F-VC 语音：Main 直调 openai 兼容端点（spec §2）；net.fetch 走系统代理，Response 结构性满足 FetchLike。
  const voiceFetch: FetchLike = (url, init) => net.fetch(url, init);
  // ⑩.6 音色工坊：参考音频文件面。id/file 白名单校验挡路径穿越（id 是 vp_ nanoid / _staging）。
  const voicesDir = deps.voicesDir ?? path.join(deps.charactersRoot, '_voices');
  const voiceFilePath = (id: string, file: string): string => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法音色目录名：${id}`);
    if (path.basename(file) !== file) throw new Error(`非法音频文件名：${file}`);
    return path.join(voicesDir, id, file);
  };
  const voice = createVoiceService({
    getPrefs: () => prefsStore.getAll(),
    broadcast,
    lastAssistantText: (sid) =>
      store
        .recentMessages(characters.current().characterId, sid, 20)
        .filter((r) => r.role === 'assistant')
        .at(-1)?.text ?? null,
    fetchImpl: voiceFetch,
    // 角色绑定音色（manifest.voice，F-VC-05）：生效序最优先；切角色自然重取。
    getActiveCharacterVoice: () => characters.current().manifest.voice,
    voicesDir,
    readVoiceFile: (id, file) => {
      try {
        return readFileSync(voiceFilePath(id, file));
      } catch {
        return null;
      }
    },
    writeVoiceFile: (id, file, data) => {
      mkdirSync(path.join(voicesDir, id), { recursive: true });
      writeFileSync(voiceFilePath(id, file), data);
    },
    moveVoiceFile: (fromId, file, toId) => {
      mkdirSync(path.join(voicesDir, toId), { recursive: true });
      renameSync(voiceFilePath(fromId, file), voiceFilePath(toId, file));
    },
    removeVoiceDir: (id) => {
      voiceFilePath(id, 'x'); // 复用 id 白名单校验
      rmSync(path.join(voicesDir, id), { recursive: true, force: true });
    },
  });
  voiceService = voice;
  // §4 MCP：McpManager + mcp-service。connectFactory 缺省抛（无 server 配置时不触发）。
  const mcpConnectFactory =
    deps.mcpConnectFactory ??
    (async () => {
      throw new Error('MCP transport not configured');
    });
  // #6 连接事件旁路进 §7 Trace（一个常驻 span 收 mcp.disconnected/reconnected/gaveUp）。
  const mcpTraceSpan = trace.span(undefined, 'MCP 连接');
  const mcpManager = new McpManager({
    connectFactory: mcpConnectFactory,
    onEvent: (action, fields) => mcpTraceSpan.record(action, fields),
  });
  const mcpService = createMcpService({
    manager: mcpManager,
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
    connectFactory: mcpConnectFactory,
  });
  void mcpService.init(); // 异步连 active server，不阻塞启动
  // F-IT：cue 引擎——事件→表现单点。cues 实时取当前角色 manifest 覆盖（切角色自然重取）；
  // mood 持久化 prefs pet.mood（重启保留）；策略门实时读 prefs（proactiveFreq 改动即生效）。
  // 线 B-2：插件 cues 追加表尾（find 首条命中 → 内置/角色包同 on 优先，插件只补新事件）。
  const pluginsRoot = deps.pluginsRoot ?? path.join(deps.charactersRoot, '_plugins');
  // 插件面宽松 fetch（GET 无 body；FetchLike 是 POST 型必填结构，不适用）。
  const pluginFetch = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }> =>
    net.fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      ...(init?.body !== undefined && init.body !== '' ? { body: init.body } : {}),
    });
  const pluginHost = new DesktopPluginHost({
    entryPath: deps.pluginEntryPath ?? '',
    broadcast,
    say: (text) => broadcast('pet.say', { text }),
    proxyFetch: async (url, init) => {
      console.info(`[plugin-fetch] ${new URL(url).host}`);
      const res = await pluginFetch(
        url,
        init as { method?: string; headers?: Record<string, string>; body?: string },
      );
      return { status: res.status, body: await res.text() };
    },
    getConfig: (id) => readPluginConfig(pluginsRoot, id),
  });
  // 线 B-2 Star 宿主：注入 starHostDir（生产）才启动；缺省（测试）不 spawn、tryHandle 恒 null。
  const starHost = createStarHostService({
    hostDir: deps.starHostDir ?? '',
    pluginsDir: deps.starPluginsDir ?? path.join(deps.charactersRoot, '_star-plugins'),
    venvDir: deps.starVenvDir ?? path.join(deps.charactersRoot, '_star-venv'),
    broadcast,
    spawnImpl: (cmd, args) =>
      cpSpawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) as ChildLike,
    execImpl: (cmd, args) =>
      new Promise((resolve, reject) =>
        execFile(cmd, args, { windowsHide: true }, (err, stdout) =>
          err ? reject(err) : resolve({ stdout: String(stdout) }),
        ),
      ),
    pipIndexUrl: () => prefsStore.getAll()['star.pipIndexUrl'],
    disabledDirs: () => prefsStore.getAll()['star.disabled'],
  });
  if (deps.starHostDir) void starHost.start();
  const pluginService = createPluginService({
    pluginsRoot,
    host: pluginHost,
    getDisabled: () => prefsStore.getAll()['plugins.disabled'],
    setDisabled: (next) => prefsStore.set('plugins.disabled', next),
    ...(deps.pickPluginPath ? { pickPluginPath: deps.pickPluginPath } : {}),
    fetchImpl: (url) => pluginFetch(url),
    starList: () =>
      starHost.metas().map((meta) => ({
        meta,
        enabled: !prefsStore.getAll()['star.disabled'].includes(meta.dir),
      })),
    pythonInfo: () => starHost.pythonInfo(),
    onStarSetEnabled: async (dir, enabled) => {
      const rest = prefsStore.getAll()['star.disabled'].filter((x) => x !== dir);
      prefsStore.set('star.disabled', enabled ? rest : [...rest, dir]);
      await starHost.restart();
    },
  });
  pluginService.startAll();
  const interactions = new InteractionService({
    cues: () => [
      ...mergeCues(DEFAULT_CUES, characters.current().manifest.cues),
      ...pluginHost.activeCues(),
    ],
    broadcast,
    getPrefs: () => prefsStore.getAll(),
    mood: new MoodState({
      getPref: () => prefsStore.getAll()['pet.mood'],
      setPref: (v) => prefsStore.set('pet.mood', v),
    }),
  });
  // F-IT-06 clock/greet 时刻源：只发领域事件，策略（DND/proactiveFreq/概率）由引擎统一执行。
  const scheduler = createInteractionScheduler({
    trigger: (e) => interactions.trigger(e),
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
  });
  scheduler.start();
  // §5 知识库 / 自动 RAG：kb-service 先于 chat 建，chat 构造时注入 retrieveKb（单向依赖，
  // arch-evolution #2）。kb 的 embed 依赖 = 后装配的 chat.embed 函数句柄（执行期才解引用，
  // embedding target 动态解析——工作台选默认 embedding 模型即生效）；未配则 chat.embed 抛错
  // → 摄入/检索失败被兜底跳过。
  let chatRef: ChatService | null = null;
  const kbService = createKbService({
    store,
    embed: (inputs) => {
      if (!chatRef) throw new Error('chat service not ready');
      const p = prefsStore.getAll();
      return chatRef.embed(
        inputs,
        resolveEmbeddingTarget(
          p['model.providerSources'],
          p['model.models'],
          p['model.defaultEmbeddingModelId'],
        ),
      );
    },
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
    // 批次⑥ rerank：解析默认 rerank 模型 → Main 直调 ${apiBase}/rerank；未配 → null（回退余弦序）。
    rerank: (query, docs, topN) => {
      const p = prefsStore.getAll();
      const t = resolveRerankTarget(
        p['model.providerSources'],
        p['model.models'],
        p['model.defaultRerankModelId'],
      );
      if (!t) return Promise.resolve(null);
      const key = p['model.providerSources'].find((s) => s.id === t.sourceId)?.key ?? '';
      return rerankDocs(
        { fetchImpl: voiceFetch },
        { apiBase: t.apiBase, model: t.model, key },
        query,
        docs,
        topN,
      );
    },
  });
  // §6 人设：CRUD 落 prefs；resolveFor 注入 chat 组装链（绑定>默认>内置）。
  const personaService = createPersonaService({
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
  });
  // 批次⑥ F-AI-06 长期记忆：service（RPC + 检索注入）+ extractor（轮末提炼）。
  // embed 同 kb：经后装配的 chat.embed 句柄（执行期解引用默认 embedding 目标）。
  const memoryEmbed = (inputs: string[]): Promise<number[][]> => {
    if (!chatRef) throw new Error('chat service not ready');
    const p = prefsStore.getAll();
    return chatRef.embed(
      inputs,
      resolveEmbeddingTarget(
        p['model.providerSources'],
        p['model.models'],
        p['model.defaultEmbeddingModelId'],
      ),
    );
  };
  const memoryService = createMemoryService({
    store,
    embed: memoryEmbed,
    getPrefs: () => prefsStore.getAll(),
    character: () => ({ id: characters.current().characterId }),
  });
  // 默认 chat 目标 + source key（memory-extractor 与 ⑩.7 testGreeting 共用的单发通道形态）。
  const chatTargetWithKey = () => {
    const p = prefsStore.getAll();
    const t = resolveChatTarget(
      p['model.providerSources'],
      p['model.models'],
      p['model.defaultChatModelId'],
    );
    if (!t) return null;
    const key = p['model.providerSources'].find((s) => s.id === t.sourceId)?.key ?? '';
    return { apiBase: t.apiBase, model: t.model, key, adapter: t.adapter };
  };
  const memoryExtractor = createMemoryExtractor({
    store,
    embed: memoryEmbed,
    fetchImpl: voiceFetch,
    getPrefs: () => prefsStore.getAll(),
    resolveTarget: chatTargetWithKey,
    character: () => ({ id: characters.current().characterId }),
  });
  // 批次⑥ F-AI-08：本地时区自然月起点（用量聚合月界 + 预算门共用）。
  const monthStart = (): number => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  // 总览页统计聚合（spec 2026-07-09）；生态计数直调各 service handler 与页面同源。
  const statsService = createStatsService({
    store,
    imPlatforms: () => prefsStore.getAll()['im.platforms'],
    imStatuses: () => imService?.statuses() ?? [],
    mcpToolCount: async () => (await mcpService['mcp.getConfig']({})).tools.length,
    pluginCounts: async () => {
      const r = await pluginService['plugins.list']({});
      return {
        enabled:
          r.desktop.filter((x) => x.enabled).length + r.star.filter((x) => x.enabled).length,
        total: r.desktop.length + r.star.length,
      };
    },
    appVersion: deps.appVersion ?? '0.0.0',
  });
  const chat = new ChatService({
    providerEntryPath: deps.providerEntryPath,
    broadcast,
    store,
    // 线 B-2：MCP 工具 + Desktop 插件工具合流（wire 名 p_<id>_<tool> 前缀路由回插件 worker）。
    mcp: mergeToolPorts(mcpManager, pluginHost),
    // 线 B-2 T7：Star 命令短路——命中即答不进 LLM；未运行/未命中/超时 null 放行（绝不阻塞聊天）。
    // 桌面会话视作 admin 私聊（本机主人）；IM 会话 sender 以 chatId 近似（Tier1 限制，RESULTS 记录）。
    intercept: async (sessionId, text) => {
      const im = parseImOrigin(sessionId);
      const admins = prefsStore.getAll()['im.admins'];
      const r = await starHost.tryHandle(
        sessionId,
        im?.kind ?? 'private',
        im?.chatId ?? 'desktop',
        im?.chatId ?? 'desktop',
        text,
        im ? admins.includes(im.chatId) : true,
      );
      return r && r.handled && r.replies.length > 0 ? r.replies.join('\n') : null;
    },
    character: () => {
      const c = characters.current();
      return {
        id: c.characterId,
        name: c.manifest.name,
        ...(c.manifest.emotions ? { emotions: Object.keys(c.manifest.emotions) } : {}),
        ...(c.manifest.actions ? { actions: c.manifest.actions } : {}),
      };
    },
    ...(deps.sqlitePath ? { sqlitePath: deps.sqlitePath } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.defaultProviderId ? { defaultProviderId: deps.defaultProviderId } : {}),
    // §7.1：chat.send 未带 providerId 时，动态读 prefs 的两层默认 chat 目标（工作台选默认即生效）。
    resolveModel: () => {
      const p = prefsStore.getAll();
      return resolveChatTarget(
        p['model.providerSources'],
        p['model.models'],
        p['model.defaultChatModelId'],
      );
    },
    retrieveKb: (q) => kbService.retrieveForChat(q),
    retrieveMemory: (q) => memoryService.retrieveForChat(q),
    // 线 B-1 记忆口径：IM 群聊会话默认不进轮末提炼（噪音大；im.groupIntoMemory 放开）。
    onTurnEnd: (sid) => {
      if (imService?.shouldExtractMemory(sid) ?? true) void memoryExtractor.onTurnEnd(sid);
    },
    // F-AI-08 超限门：budget.enabled 且 onExceed=pause 且 本月已用 ≥ 上限（口径 = 万 tokens，spec §5）。
    budgetGate: () => {
      const p = prefsStore.getAll();
      if (!p['budget.enabled'] || p['budget.onExceed'] !== 'pause') return null;
      const capTokens = p['budget.monthlyCap'] * 10_000;
      if (capTokens <= 0) return null;
      const u = store.usageSummary(monthStart());
      return u.tokensIn + u.tokensOut >= capTokens
        ? '已达本月 token 预算上限（可在 模型 API → 预算 调整）'
        : null;
    },
    interactions,
    // §6+批次④：当前生效 persona（用户绑定 > 包声明 > 用户默认 > null=内置）注入组装链。
    persona: () => {
      const cur = characters.current();
      return personaService.resolveFor(cur.characterId, cur.manifest.persona ?? null);
    },
    trace,
  });
  chatRef = chat;
  // 线 B-1 IM 通道：唤醒/白名单/串行化编排。IM 与桌宠同一个灵魂——chat.send 复用同一
  // ChatService（persona/记忆/KB 全链路生效）；enable 平台随启动/配置变更起停。
  imService = createImService({
    getPrefs: () => prefsStore.getAll(),
    chat: { send: (sid, text) => chat.send(sid, text) },
    broadcast,
  });
  void imService.reload();
  const idleResponder = createIdleResponder(() => interactions.trigger('idle.timeout'));
  // character 窗口的期望尺寸真源：唯一合法的尺寸变更入口是 setScale。
  // Windows 非 100% DPI 下 setPosition 每次调用有 DIP↔物理像素舍入漂移
  //（125% 实测 40 次 moveBy 涨 36×53px），位置操作必须用 setBounds 锁回期望尺寸。
  let characterSize: { width: number; height: number } = { ...CHARACTER_BASE_SIZE };
  const prefEffects =
    deps.prefEffects ??
    createPrefEffects({
      characterWindow: deps.characterWindow,
      setLoginItem: deps.setLoginItem ?? (() => {}),
      setCharacterSize: (s) => {
        characterSize = s;
      },
      broadcast,
    });
  applyAllEffects(prefEffects, prefsStore.getAll());
  const prefsService = createPrefsService({ store: prefsStore, broadcast, effects: prefEffects });

  // A3 穿透切换真源：菜单/RPC 共用；逻辑在 app-actions（J1 托盘 / J2 热键同源，避免三份重复）。
  const toggleClickThroughPref = (): boolean =>
    appActions.toggleClickThroughPref({
      prefsStore,
      characterWindow: deps.characterWindow,
      broadcast,
    });
  const overlayWindow = deps.overlayWindow ?? (() => null);
  const settingsWindow = deps.settingsWindow ?? (() => null);

  const { init: _mcpInit, ...mcpHandlers } = mcpService;
  // speakSession 是 autoSpeak 旁路内部 API，非 RPC handler —— 从 spread 里剔除（同 mcp init 手法）。
  const { speakSession: _speakSession, ...voiceHandlers } = voice;
  // retrieveForChat / ingest 是 chat/router 内部用的注入 API，非 RPC handler —— 从 spread 里剔除。
  const { retrieveForChat: _retrieveForChat, ingest: _kbIngest, ...kbHandlers } = kbService;
  // memory 同款：retrieveForChat 是 memoryStage 注入源，非 RPC handler。
  const { retrieveForChat: _memRetrieve, ...memoryHandlers } = memoryService;
  // resolveFor 是组装链内部 API，非 RPC handler —— 从 spread 里剔除（同 kb retrieveForChat 手法）。
  const { resolveFor: _personaResolve, ...personaHandlers } = personaService;
  // 线 B-2：startAll 是启动期内部 API，非 RPC handler —— 同款剔除。
  const { startAll: _pluginStartAll, ...pluginHandlers } = pluginService;
  // 嵌入维度「自动检测」/ 源级检测（照 AstrBot）：embed 一段探针读向量维度 + 延迟。源需已保存（key 经 fetch 网关注入）。
  const detectEmbeddingDim = async (p: { sourceId: string; model: string }) => {
    const all = prefsStore.getAll();
    const src = all['model.providerSources'].find((s) => s.id === p.sourceId);
    if (!src) return { ok: false as const, error: 'source not found' };
    const t0 = Date.now();
    try {
      const vectors = await chat.embed(['dimension probe'], {
        sourceId: src.id,
        adapter: src.adapter,
        apiBase: src.apiBase,
        model: p.model,
      });
      const dim = vectors[0]?.length ?? 0;
      const latencyMs = Math.max(0, Date.now() - t0);
      return dim > 0
        ? { ok: true as const, dimensions: dim, latencyMs }
        : { ok: false as const, error: '返回空向量（确认模型名与端点正确）' };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const router = createRouter<RpcContext>({
    ...(deps.providerService ?? {}),
    ...mcpHandlers,
    ...voiceHandlers,
    ...kbHandlers,
    ...memoryHandlers,
    ...personaHandlers,
    ...pluginHandlers,
    ...prefsService,
    'provider.detectEmbeddingDim': detectEmbeddingDim,
    ...(deps.appService ?? {}),
    ...createOnboardingService({
      prefsStore,
      onboardingWindow: deps.onboardingWindow ?? (() => null),
      overlayWindow: deps.overlayWindow ?? (() => null),
    }),
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    // --- 线 B-2 T7：Star 插件安装/卸载（UI 先弹「本机运行」警示再调用）---
    'plugins.installStar': async (p) => {
      const picked = (await deps.pickStarPath?.(p.kind)) ?? null;
      if (!picked) return { cancelled: true as const };
      const r = await starHost.installStar(picked);
      return { cancelled: false as const, ok: true as const, dir: r.dir };
    },
    'plugins.uninstallStar': async (p) => {
      await starHost.uninstallStar(p.dir);
      return { ok: true as const };
    },
    'chat.send': (p) => chat.send(p.sessionId, p.text, p.providerId),
    'chat.cancel': (p) => chat.cancel(p.sessionId),
    'chat.snapshot': (p) => chat.snapshot(p.sessionId, p.limit),
    // --- 会话管理（spec 2026-07-09-session-management）---
    'chat.sessions': () => {
      const cid = characters.current().characterId;
      return {
        sessions: store.sessionList(cid).map((r) => ({
          id: r.id,
          title: deriveTitle(r.title, r.firstUserText, r.id),
          pinned: r.pinned,
          lastText: r.lastText,
          lastTs: r.lastTs,
          count: r.count,
          origin: r.id.startsWith('im:') ? ('im' as const) : ('desktop' as const),
        })),
      };
    },
    'chat.sessionRename': (p) => {
      assertNotImSession(p.id);
      store.sessionSetTitle(p.id, characters.current().characterId, p.title);
      return { ok: true as const };
    },
    'chat.sessionPin': (p) => {
      assertNotImSession(p.id);
      store.sessionSetPinned(p.id, characters.current().characterId, p.pinned);
      return { ok: true as const };
    },
    'chat.sessionDelete': (p) => {
      assertNotImSession(p.id);
      store.sessionDelete(p.id);
      const cid = characters.current().characterId;
      const map = prefsStore.getAll()['chat.activeSessions'];
      const next = nextActiveAfterDelete(
        p.id,
        map[cid] ?? 'default',
        store
          .sessionList(cid)
          .filter((s) => !s.id.startsWith('im:'))
          .map((s) => s.id),
      );
      if (next !== null) {
        writeActiveSession(
          {
            getMap: () => prefsStore.getAll()['chat.activeSessions'],
            setMap: (m) => prefsStore.set('chat.activeSessions', m),
            broadcast,
          },
          cid,
          next,
        );
      }
      return { ok: true as const };
    },
    'chat.sessionExport': async (p) => {
      const cur = characters.current();
      const rows = store.sessionMessages(cur.characterId, p.id);
      const meta = store.sessionList(cur.characterId).find((s) => s.id === p.id);
      const title = deriveTitle(meta?.title ?? null, meta?.firstUserText ?? null, p.id);
      const out = (await deps.pickMarkdownSave?.(sanitizeFilename(title) || 'session')) ?? null;
      if (!out) return { cancelled: true as const };
      writeFileSync(out, sessionToMarkdown(title, cur.manifest.name, rows), 'utf8');
      return { cancelled: false as const, path: out };
    },
    'chat.setActiveSession': (p) => {
      writeActiveSession(
        {
          getMap: () => prefsStore.getAll()['chat.activeSessions'],
          setMap: (m) => prefsStore.set('chat.activeSessions', m),
          broadcast,
        },
        characters.current().characterId,
        p.sessionId,
      );
      return { ok: true as const };
    },
    // --- 线 B-1 多 IM 通道（platforms 写 prefs 即重载；照 mcp.* 惯例不广播 prefs.changed）---
    'im.getConfig': () => ({
      platforms: prefsStore.getAll()['im.platforms'],
      statuses: imService?.statuses() ?? [],
    }),
    'im.savePlatform': (p) => {
      validateImPlatform(p.platform);
      const list = prefsStore.getAll()['im.platforms'].filter((x) => x.id !== p.platform.id);
      prefsStore.set('im.platforms', [...list, p.platform]);
      void imService?.reload();
      return { ok: true as const };
    },
    'im.deletePlatform': (p) => {
      prefsStore.set(
        'im.platforms',
        prefsStore.getAll()['im.platforms'].filter((x) => x.id !== p.id),
      );
      void imService?.reload();
      return { ok: true as const };
    },
    'trace.history': () => ({ records: trace.history() }),
    'trace.clear': () => {
      trace.clear();
      return { ok: true as const };
    },
    'app.storageUsage': () => chat.storageUsage(),
    'app.exportData': (p) => chat.exportData(p.outPath),
    // --- 批次⑥ D7 数据页 ---
    'app.importData': async () => {
      const picked = (await deps.pickDsbakOpen?.()) ?? null;
      if (!picked) return { cancelled: true as const };
      if (!deps.sqlitePath) throw new Error('纯内存模式不支持导入');
      stageDsbakImport(picked, deps.sqlitePath);
      return { cancelled: false as const, ok: true as const, requiresRestart: true as const };
    },
    'app.exportDataPick': async () => {
      const out = (await deps.pickDsbakSave?.()) ?? null;
      if (!out) return { cancelled: true as const };
      const r = await chat.exportData(out);
      return { cancelled: false as const, ok: true as const, bytes: r.bytes, path: out };
    },
    'app.clearMessages': () => {
      store.clearMessages();
      return { ok: true as const };
    },
    'app.openDataDir': () => {
      deps.openDataDir?.();
      return { ok: true as const };
    },
    'app.relaunch': () => {
      deps.relaunch?.();
      return { ok: true as const };
    },
    'app.usageSummary': () => ({ sinceTs: monthStart(), ...store.usageSummary(monthStart()) }),
    'app.stats.overview': (p) => statsService.overview(p.rangeDays),
    'app.version': () => ({ version: deps.appVersion ?? '0.0.0' }),
    // ⑪ 自动更新三件套（服务缺省=永远 disabled(dev)，测试/dev 装配无需注入）
    'app.update.status': () =>
      deps.updateService?.status() ?? { state: 'disabled' as const, reason: 'dev' as const },
    'app.update.check': async () =>
      deps.updateService ? await deps.updateService.check() : { state: 'disabled' as const, reason: 'dev' as const },
    'app.update.download': async () => {
      await deps.updateService?.download();
      return { ok: true as const };
    },
    'app.update.install': async () => {
      await deps.updateService?.install();
      return { ok: true as const };
    },
    'kb.importFile': async (p) => {
      // 批次⑥：Main 弹框选 .txt/.md/.pdf → 解析（PDF 走 unpdf）→ 复用摄入内部。
      const picked = (await deps.pickKbFile?.()) ?? null;
      if (!picked) return { cancelled: true as const };
      const { filename, text } = await parseKbFile(picked);
      const r = await kbService.ingest(p.kbId, filename, text);
      return { cancelled: false as const, ...r, filename };
    },
    'app.generateDiag': () => {
      // J5：组装脱敏诊断 → 落本地 .dsdiag（JSON）。真实上报端点留 M9；
      // logs = §7 Trace 环尾 100 条 action+时间摘要（无 fields，不含 prompt/结果正文）。
      const diag = assembleDiag({
        version: deps.appVersion ?? '0.0.0',
        platform: process.platform,
        prefs: prefsStore.getAll() as Record<string, unknown>,
        logs: trace.history().slice(-100).map((r) => `${new Date(r.ts).toISOString()} ${r.action}`),
      });
      const out = deps.diagPath ?? 'openpet.dsdiag';
      writeFileSync(out, JSON.stringify(diag, null, 2), 'utf8');
      return { ok: true as const, path: out };
    },
    'character.current': () => characters.current(),
    'character.tap': (p) => {
      // A1 轻点：领域事件进 cue 引擎（combo 计数 + 查表广播；F-IT T4 收敛自 inline 广播）。
      interactions.onTap(p.zone);
      return { ok: true as const };
    },
    'character.gesture': (p) => {
      // F-IT-01 触摸语义分级统一入口（renderer 手势检测上报）。
      switch (p.kind) {
        case 'tap':
          interactions.onTap(p.zone);
          break;
        case 'long':
          interactions.trigger('press.long');
          break;
        case 'stroke':
          interactions.trigger('stroke.head');
          break;
        case 'dragStart':
          interactions.trigger('drag.start');
          break;
        case 'dragEnd':
          interactions.trigger('drag.end');
          break;
        case 'fileDrop':
          interactions.trigger('file.drop');
          break;
      }
      return { ok: true as const };
    },
    'character.setScale': (p) => {
      const win = deps.characterWindow();
      if (win && !win.isDestroyed()) {
        const b = scaledBounds(win.getBounds(), p.scale);
        characterSize = { width: b.width, height: b.height };
        win.setBounds(b);
      }
      return { ok: true as const };
    },
    'character.idleTimeout': (p) => {
      idleResponder.onIdleTimeout(p.idleMs);
      return { ok: true as const };
    },
    // --- 批次④ 角色包体系：列表/切换/导入/卸载 ---
    'character.list': () => {
      const activeId = characters.current().characterId;
      return {
        characters: characters
          .list()
          .map((c) => ({ ...c, active: c.characterId === activeId })),
      };
    },
    'character.switch': (p) => {
      characters.switch(p.id);
      broadcast('character.changed', { characterId: p.id });
      return { ok: true as const };
    },
    'character.importPick': async (p) => {
      const picked = (await deps.pickCharacterPath?.(p.kind)) ?? null;
      if (!picked) return { cancelled: true as const };
      const m = inspectPack(picked);
      return {
        cancelled: false as const,
        path: picked,
        summary: { id: m.id, name: m.name, version: m.version, engine: m.engine },
      };
    },
    'character.importApply': (p) => {
      const m = installPack(p.path, importedRoot, (id) => characters.rootOf(id) !== null);
      characters.invalidate();
      return { ok: true as const, id: m.id };
    },
    'character.remove': (p) => {
      removeCharacter(p.id, {
        characters,
        importedRoot,
        onChanged: (id) => broadcast('character.changed', { characterId: id }),
      });
      return { ok: true as const };
    },
    // --- ⑩.7 E4 角色编辑器写侧 ---
    'character.updateManifest': (p) => {
      const manifest = characters.updateManifest(p.id, p.manifest);
      if (characters.current().characterId === p.id) {
        broadcast('character.changed', { characterId: p.id }); // 编辑当前角色 → 热重载
      }
      return { ok: true as const, manifest };
    },
    'character.duplicate': (p) => characters.duplicate(p.id),
    'character.export': async (p) => {
      if (!characters.rootOf(p.id)) throw new RpcError(-32602, `character not found: ${p.id}`);
      const target = (await deps.pickDspackSave?.(`${p.id}.dspack`)) ?? null;
      if (!target) return { canceled: true as const };
      characters.exportPack(p.id, target);
      return { canceled: false as const, path: target };
    },
    'character.revealInFolder': (p) => {
      const root = characters.rootOf(p.id);
      if (!root) throw new RpcError(-32602, `character not found: ${p.id}`);
      deps.revealItem?.(path.join(root, p.id, 'manifest.json'));
      return { ok: true as const };
    },
    'character.listFiles': (p) => ({ files: characters.listFiles(p.id) }),
    'character.testGreeting': async (p) => {
      const c = characters.list().find((x) => x.characterId === p.id);
      if (!c) throw new RpcError(-32602, `character not found: ${p.id}`);
      await runTestGreeting(
        c.manifest,
        personaService.resolveFor(p.id, c.manifest.persona ?? null),
        { fetchImpl: voiceFetch, resolveTarget: chatTargetWithKey, broadcast },
      );
      return { ok: true as const };
    },
    'app.window.setClickThrough': (p, ctx) => {
      ctx.win?.setIgnoreMouseEvents(p.ignore, { forward: true });
      return { ok: true as const };
    },
    'app.window.hideSelf': (_p, ctx) => {
      ctx.win?.hide();
      return { ok: true as const };
    },
    'app.window.moveBy': (p, ctx) => {
      if (ctx.win) {
        const [x, y] = ctx.win.getPosition();
        const nx = x + Math.round(p.dx);
        const ny = y + Math.round(p.dy);
        if (ctx.win === deps.characterWindow()) {
          ctx.win.setBounds({ x: nx, y: ny, ...characterSize });
        } else {
          ctx.win.setPosition(nx, ny);
        }
      }
      return { ok: true as const };
    },
    'app.window.openHub': () => {
      appActions.openHub(settingsWindow);
      return { ok: true as const };
    },
    'app.window.showChat': () => {
      appActions.showChat(overlayWindow);
      return { ok: true as const };
    },
    'app.window.popCharacterMenu': () => {
      const menu = Menu.buildFromTemplate(
        buildCharacterMenuTemplate(
          {
            chat: () => appActions.showChat(overlayWindow),
            toggleClickThrough: () => {
              toggleClickThroughPref();
            },
            toggleVisible: () => appActions.toggleCharacter(deps.characterWindow),
            openHub: () => appActions.openHub(settingsWindow),
          },
          menuLabels(String(prefsStore.getAll()['general.language'] ?? 'zh-CN')),
        ),
      );
      const c = deps.characterWindow();
      if (c && !c.isDestroyed()) menu.popup({ window: c });
      return { ok: true as const };
    },
    'app.window.toggleClickThrough': () => ({
      ok: true as const,
      ignore: toggleClickThroughPref(),
    }),
  });

  ipcMain.handle('openpet:rpc', (e, payload: { method?: unknown; params?: unknown }) => {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    return router.dispatch(method, payload?.params, {
      win: BrowserWindow.fromWebContents(e.sender),
    });
  });

  return {
    // F-IT-06 全屏让位：index 的 fullscreen-watch onChange 转入（隐藏前小挥手；cue 表 30s 冷却）。
    notifyDesktopState: (fullscreen: boolean): void => {
      if (fullscreen) interactions.trigger('desktop.fullscreen');
    },
    dispose: async () => {
      ipcMain.removeHandler('openpet:rpc');
      scheduler.stop();
      interactions.dispose();
      await imService?.dispose();
      await pluginHost.stopAll();
      await starHost.stop();
      await chat.dispose();
      await mcpManager.disconnectAll();
      store.close();
      prefsStore.close();
    },
  };
}
