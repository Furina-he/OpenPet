# DeskSoul 技术设计文档

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1 (Draft) | 2026-05-01 | Brainstorming Validated | [PRD.md](../../PRD.md) |
| v0.2 (Electron Pivot) | 2026-05-14 | Active | 同上 |

> 本文档由 PRD v0.1 出发，经 12 轮架构 brainstorming 收敛而成，对应"长期工程"取向（MVP 阶段就把模块边界、插件沙箱、协议、状态归属定清）。语音 / Bridge / 多角色编排等 V1+ 主题留 stub，待近期再单独 brainstorm。

> **v0.2 变更摘要**：桌面壳从 **Tauri 2 (Rust)** 改为 **Electron (Node)**，并采用"**Main 进程合并 Sidecar**"形态——业务大脑（Conversation / Persona / Memory / PluginHost）直接跑在 Electron Main 里，不再独立 spawn Node 子进程；插件 Worker 仍跑在 `worker_threads` 中保持崩溃隔离。统一 JS/TS 栈、减少 Rust 工具链依赖、IPC 链路从两段缩到一段；代价是包体积增大（~80MB）且 Main 进程崩溃 = 整个 app 重启。受影响章节：§1、§2、§3、§4.2、§5.4–5.5、§6、§7、§9.1–9.3、附录 A。

---

## §1 总览与指导原则

**产品级目标**（来自 PRD）：桌面常驻 AI 角色伙伴，融合桌宠存在感 / AI 内核 / 角色与插件生态。

**架构级原则**：

1. **崩溃隔离（分层）**：
   - **进程级**：Electron Main + 两个 Renderer（Character / UI Overlay）三家之一挂掉，其余应能自恢复（Renderer 崩溃由 Main 重新加载；Main 崩溃由用户/启动项重启，状态从磁盘恢复）。
   - **线程级**：业务大脑跑在 Main，所有插件跑在 `worker_threads`。任一 Worker 死掉由 PluginHost 重启，不拖垮主进程。
   - **取舍说明**：相比 Tauri 方案"Rust 内核 + 独立 Node Sidecar 子进程"，本方案放弃 Main / Sidecar 跨进程隔离；理由是统一 JS 栈、减少 IPC 跳数。Main 进程崩溃 = 整个 app 重启，因此 Main 内代码必须严格只做"协议路由 / Worker 调度 / DB 单连接"，业务复杂度尽量下沉到 Worker。
2. **插件一等公民**：插件的接口、隔离、权限从 MVP 第 0 天就是产品 API，而不是后期补丁。任何"主流程"功能都应能用 SDK 重写。
3. **本地优先**：所有持久状态默认在本机；云端只承担 LLM / TTS 调用本身，且密钥永不进 Worker。
4. **流式即体验**：LLM 输出 → 表情 / 动作 / 文本 必须在 token 流出过程中实时发生，绝不"等整段输出完再动"。
5. **协议分明**：
   - 本地 IPC 一种：JSON-RPC 2.0（webview→Main 走 Electron `ipcRenderer.invoke` / `webContents.send`，Main→Worker 走 `MessagePort`）
   - 行为驱动一种：intent header + 行内标签
   - 插件接口一份：`@desksoul/plugin-sdk`
   三者不可混淆，每条协议都应能独立测试。
6. **MVP 切片不偷工**：MVP 功能可以小，但骨架（Main / Renderer 隔离、Worker 沙箱、行为协议、状态分层）从 day 0 完整存在；削功能不削架构。

**非目标**（架构层显式排除）：
- 不在桌面端打包 Python 运行时（Bridge 走远程进程）
- 不写自有渲染引擎（沿用 three-vrm + pixi-live2d-display）
- 不做强一致的多端同步（V2+ 再议）
- MVP 不做插件市场（只做本地文件夹/zip 安装）
- 不引入 GPU 重负载特性（PBR 高级材质、实时阴影等）作为默认
- **不再 spawn 独立 Node Sidecar 子进程**（v0.2 调整；如果未来需要把业务大脑剥离回独立进程，可走 `utilityProcess` 而非外部 stdio）

---

## §2 进程与窗口拓扑

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main Process (Node)                                │
│   职责：窗口宿主 / IPC 路由 / Keychain (safeStorage) /       │
│         插件注册表 / SQLite 单连接 / Worker 监督 /           │
│         fetch 凭证注入（net + session.webRequest）           │
│                                                             │
│   业务模块（同进程，互相直接调用）：                          │
│     ConversationCore / Persona / MemoryWorker(thread) /     │
│     BehaviorParser / ProviderRouter / PluginHost            │
│                                                             │
│   ├── BrowserWindow: Character (transparent, alpha hit-test)│
│   │     Renderer (sandbox + contextIsolation): Three.js     │
│   │     / pixi-live2d (二选一)                              │
│   │     "愚蠢的角色播放器"，无业务逻辑                       │
│   │                                                         │
│   ├── BrowserWindow: UI Overlay (transparent, no through)   │
│   │     Renderer: Vue + Tailwind                            │
│   │     聊天、设置、记忆面板、插件管理                       │
│   │                                                         │
│   └── BrowserWindow: Settings (按需创建，常态隐藏)           │
│                                                             │
│   ↕ MessagePort (JSON-RPC 2.0 over postMessage)              │
│   ├── Worker (worker_threads): Provider Plugin × N          │
│   ├── Worker (worker_threads): Skill Plugin × N             │
│   └── Worker (worker_threads): Tool Plugin × N              │
└─────────────────────────────────────────────────────────────┘
                  ↕ WebSocket (按需，远程)
┌─────────────────────────────────────────────────────────────┐
│ Optional Remote: AstrBot Bridge / 远程 Agent (V2+)          │
└─────────────────────────────────────────────────────────────┘
```

**v0.2 关键变更**：业务大脑与窗口宿主**合并到 Electron Main 同一进程**，不再独立 Node Sidecar。崩溃隔离粒度：
- **进程级**：三个 Renderer 之间、Main 与 Renderer 之间相互隔离（Chromium 多进程模型天然给到）。
- **线程级**：所有插件 Worker 跑在 `worker_threads`，PluginHost 监督；Worker 崩溃不影响 Main。
- **MemoryWorker**（异步事实抽取 / 摘要 / 向量化）也跑在 `worker_threads`，避免阻塞 Main 的 IPC 事件循环。

**窗口编排（状态化锚定）**：
- 状态机：`Idle → Awakened（贴附）→ Detached（分离）`
- 角色窗口默认非 always-on-top；UI 浮层激活时短暂置顶 1.5s
- 角色窗口 alpha 命中（>0.05 才命中），其余穿透
- 长按 0.2s 才进入拖拽；多屏跟随用户最后放置；全屏检测自动隐藏
- UI 永不抢焦
- Renderer 全部启用 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；唯一 Node 能力通过 `preload.js` + `contextBridge.exposeInMainWorld` 暴露的最小 API（`window.desksoul.rpc(...)`）

**进程监督**：
- Main 进程内 PluginHost 监听每个 Worker 的 `exit` / `error` 事件，1 秒内指数退避重启（封顶 30s）；连续 3 次 unhealthy 自动禁用并通知 UI。
- Renderer 崩溃由 Main 监听 `webContents.on('render-process-gone')`，触发重新 `loadURL`；崩溃中的对话 token 流可能丢失最后几个 token，但消息边界从 `sessions.db` 完整可重建。
- Main 自身崩溃 → OS 进程退出；由用户/启动项重启；恢复路径见 §6。
- **回退预案**：若未来 Main 阻塞或内存压力过大，可把 ConversationCore + ProviderRouter 拆到 Electron `utilityProcess`（仍在同一 app 沙箱内、仍走 MessagePort），无需改协议；本质是把"线程"升级为"进程"，不改语义。

---

## §3 IPC 与消息契约

**两段链路 + 一种协议**：

```
[Renderer]  ⇄  [Electron Main]  ⇄  [Worker]
  ipcRenderer.invoke / webContents.send    MessagePort.postMessage
```

整条链路只有一种语义模型：JSON-RPC 2.0（request / response / notification）。Electron 的 `ipcRenderer` / `ipcMain` / `MessagePort` 在我们这层都被当成"按 method 名转发"的薄壳，**payload 永远是合法的 JSON-RPC 2.0 帧**，便于：
- 远程 Bridge（V2）替换为 WebSocket 时零改动
- 测试时可以直接用纯 JS mock 双端，绕过 Electron 运行时

**Preload 暴露的最小 API**（`apps/desktop/electron/preload/index.ts`）：

```ts
// 通过 contextBridge 暴露到 Renderer，Renderer 内 `window.desksoul.rpc(...)` 即可
contextBridge.exposeInMainWorld('desksoul', {
  rpc: (method: string, params?: unknown) => ipcRenderer.invoke('desksoul:rpc', { method, params }),
  on:  (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`desksoul:notify:${channel}`, handler);
    return () => ipcRenderer.off(`desksoul:notify:${channel}`, handler);
  },
});
```

Renderer 内 **不直接持有 `ipcRenderer`**；所有调用都走 `window.desksoul.rpc` / `window.desksoul.on`，Main 端有唯一一个 `ipcMain.handle('desksoul:rpc', ...)` 入口做 JSON-RPC 路由。这样：
- Renderer 即便被 XSS 注入，也只能调到白名单内的 method，不能任意调 Node API
- 协议演进只需改一个路由表，不需要逐个 `ipcMain.handle` 注册

**消息四类命名空间**：

| 命名空间 | 方向 | 例子 |
| --- | --- | --- |
| `app.*` | Renderer ↔ Main | `app.window.toggleClickThrough`、`app.tray.notify` |
| `chat.*` | Renderer ↔ Main（Main 内转发至 ConversationCore） | `chat.send`、`chat.cancel`、`chat.stream`（notification） |
| `behavior.*` | Main → Renderer(Character) | `behavior.applyEmotion`、`behavior.playAction`、`behavior.setLipsync` |
| `plugin.*` | Worker ↔ Main | `plugin.registerSkill`、`plugin.invokeTool`、`plugin.permissionRequest` |

**示例：一次完整对话流**

```
1. UI ──ipc.invoke──> Main:  chat.send {sessionId, text}
2. Main 内 ConversationCore:
   - 组装 context
   - 通过 PluginHost 选择 ProviderWorker
3. ProviderWorker ──MessagePort──> Main:
     {type:"delta", text:"嗯…"} × N
4. Main 内 BehaviorParser:
   - 检测到 <emo:shy/> → emit behavior.applyEmotion
   - 剥离后的 text → emit chat.stream
5. Main ──webContents.send──> UI Overlay:  chat.stream
6. Main ──webContents.send──> Character:   behavior.applyEmotion
7. 整段结束 → Main 写库 + emit chat.done {sessionId, usage}
```

**契约定义**：所有 method 用 TS 类型声明 + Zod schema 校验，编译期生成：
- `@desksoul/protocol`（共享 npm 包）：method 签名 + 类型 + Zod schema（Main 与 Renderer 都从这里 import；Renderer 走 `window.desksoul.rpc<MethodName>(params)` 时类型安全）
- Worker 端复用同一份 Zod schema 校验来自 Main 的入参
- 任一端违约 → 立即 `error: -32602` 返回 + 日志告警

**关键设计要点**：

1. **零端口暴露**：所有本地 IPC 走 Electron IPC / MessagePort，不开 TCP 端口（杀软友好）。
2. **流式 = notification**：不滥用 response，避免占用 request id 资源。一个 `chat.send` 后，对应的流通过 Main 主动 `webContents.send('desksoul:notify:chat.stream', frame)` 推送（带 `sessionId` 关联）。
3. **取消传播**：UI 发 `chat.cancel` → Main → 调 Worker 的 `AbortSignal`；Worker 在 200ms 内未响应则 PluginHost 强行 `terminate` 该 Worker 并重启。
4. **Backpressure**：notification 在 Main 内每 session 上限 N 条；溢出时合并相邻 deltas（不丢消息边界）。Electron IPC 本身缓冲很大，但仍需限流以避免 Renderer 解析跟不上。
5. **远程 Bridge（V2）**：相同 method 表，只是传输从 Electron IPC 换成 WebSocket；AstrBot Bridge 当作"远程 ConversationCore"看待，本地路由代码不变。
6. **Renderer 安全基线**：`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false` + CSP（限制远端脚本/样式/字体）；Preload 文件本身不引入 Node-only 模块到 Renderer 全局。

---

## §4 行为协议与 LLM 调用流水线

### 4.1 行为协议

每条 AI 回复采用 `intent header + 行内标签`，由 Node 内的 BehaviorParser 流式增量解析。

**最小语法（v1）**：

```
[intent mood=shy energy=low]
嗯……<emo:shy/>我在想，<act:fidget dur=1800/>要不要请你喝杯热可可？<emo:happy/>
```

| 标签 | 触发 | 何时归零 |
| --- | --- | --- |
| `[intent mood=X energy=Y]` | 段首基调，影响默认动画选择与 idle 行为 | 本回复结束 |
| `<emo:NAME [w=0.0..1.0]/>` | 切换 BlendShape 表情，权重默认 1.0 | 下一个 `<emo/>` 或回复结束 |
| `<act:NAME [dur=ms]/>` | 触发一次动作（动画 clip），dur 默认动画自身长度 | 动画结束 |
| `<say:CLIP/>` | 触发预录语音片段（V1+） | 片段结束 |
| `<wait ms=N/>` | 文本流停顿 N ms | — |

**System Prompt 注入策略**：Persona 中嵌一段"你可以使用以下标签…"的简短规约 + 几条 few-shot；不输出标签也合法（自动 idle）。

**解析器（BehaviorParser）状态机**：

```
读入 token 流 → 维护 buffer
  扫描已完成的标签：剥离 → emit behavior.* notification
  剩余文本：emit chat.stream
  半个标签（流到 "<emo:" 但还没结束）：暂存 buffer，下个 token 来再判
  非法/未注册标签：原样作为文本输出，记 warn 日志
  超时未闭合（300ms 无新 token）：buffer 强制 flush 为文本
```

### 4.2 调用流水线

```
UI: chat.send (ipcRenderer.invoke via preload)
 → Main: ipcMain.handle → JSON-RPC 路由 → ConversationCore
 → ConversationCore (Main 进程内同步调用):
     1) 加载 Persona + Persona State
     2) 组装 Working Memory（最近 20 轮）
     3) 检索 Episodic（向量 top-k）+ Semantic（高置信度事实）
     4) 按 token 预算裁剪：40% 历史 / 30% 检索 / 20% 事实 / 10% persona
     5) 调 ProviderRouter.chat(req, signal)
 → ProviderRouter (Main 进程内):
     - 选 primary Provider，AbortController 准备 fallback
     - Worker 内 fetch 被 PluginHost 代理：Main 端用 Electron `net` + `session.webRequest`
       完成 host 白名单 + Authorization 注入
 → ProviderWorker（worker_threads）:
     - 调远端 / 本地 LLM（fetch 经代理回 Main）
     - 流式 ChatEvent 经 MessagePort 回 Main
 → BehaviorParser (Main 进程内):
     - delta → 双路：clean text + behavior events
 → 通过 `webContents.send` 同时推 UI Overlay 与 Character Renderer
 → 末尾 chat.done：写入 sessions.db（Main 持唯一 better-sqlite3 连接）、
   触发 MemoryWorker（worker_threads）异步抽取
```

### 4.3 Provider 接口（@desksoul/plugin-sdk）

```ts
export interface ChatProvider {
  id: string;
  capabilities: { tools?: boolean; vision?: boolean; jsonMode?: boolean };
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; args: unknown; id: string }
  | { type: 'usage'; prompt: number; completion: number; cost?: number }
  | { type: 'done'; finishReason: 'stop' | 'cancel' | 'error'; error?: string };
```

| 维度 | 决定 |
| --- | --- |
| **密钥注入** | Provider Worker 调"代理 fetch"时（Worker 内 globalThis.fetch 被替换），请求被 postMessage 回 Main；Main 端识别目标 host + Provider id，从 `safeStorage` 解密 Keychain 取密钥注入 Authorization 头，使用 Electron `net` 模块完成实际请求；Worker 内代码看不到密钥 |
| **Token 计数** | 优先用 Provider 返回的 `usage`；缺失时本地用 `tiktoken` 等回退估算；按 Provider 声明的 `price/1K` 计费 |
| **取消** | UI / Main 任一层 abort，传播到 Worker 的 AbortSignal；中断后 BehaviorParser 对未闭合标签做 graceful close；Worker 200ms 内未响应 abort 由 PluginHost 强行 `terminate` 并重启 |
| **降级链** | Persona 配置 `providers: [primary, fallback1, fallback2]`；超时/错误自动顺位重试（同一对话内只重试一次） |
| **Embedding Provider** | 与 Chat Provider 分离接口（`EmbeddingProvider`），可独立配置 |
| **能力探测** | Provider 声明 `capabilities`，Conversation 根据能力决定是否启用 tool calls / vision |
| **多 Persona 多 Provider** | Persona 与 Provider 多对多：同一 Persona 可在不同对话用不同模型，长期记忆共享 |
| **本地模型（Ollama）** | 内置一个"local" Provider plugin，零配置可用；离线兜底默认指它 |

---

## §5 插件运行时、SDK 与 Manifest

### 5.1 四类插件 + 分层运行时

| 类型 | 内容 | 运行环境 | 典型权限 |
| --- | --- | --- | --- |
| **Character Pack** | 模型 + 动画 + Persona + 资产 | 不开 Worker，资产装载到 Character Renderer | 仅资产路径 |
| **Skill Plugin** | 玩法/钩子代码（如"番茄钟陪伴""每日早安"） | `worker_threads` + manifest 权限 | `behavior:emit`、`chat:listen` |
| **Tool Plugin** | Agent 可调用的工具（搜索、剪贴板、日历…） | `worker_threads` + 高危权限网关 | `network:*`、`fs:*`、`shell` |
| **Provider Plugin** | LLM / TTS / ASR / Embedding 适配器 | `worker_threads` + Main 注入凭证 | `network:<host>` |

### 5.2 Manifest 格式

**Character Pack 示例**：

```json
{
  "id": "com.example.character.mochi",
  "name": "Mochi",
  "version": "1.0.0",
  "type": "character",
  "author": "...",
  "license": "CC-BY-NC-4.0",
  "engine": "vrm",
  "entry": {
    "model": "model/mochi.vrm",
    "animations": { "idle": "anim/idle.vrma", "wave": "anim/wave.vrma" },
    "persona": "persona.md",
    "voiceProfile": "voice.json"
  },
  "permissions": []
}
```

**Skill / Tool / Provider 示例**：

```json
{
  "id": "com.example.skill.pomodoro",
  "type": "skill",
  "entry": "dist/index.js",
  "permissions": ["behavior:emit", "chat:listen", "timer"],
  "engines": { "desksoul": "^0.1.0" }
}
```

### 5.3 SDK 形态

```ts
// Skill 示例
import { defineSkill, on, behavior } from '@desksoul/plugin-sdk';

export default defineSkill({
  id: 'pomodoro-companion',
  setup(ctx) {
    on('chat.userMessage', async (msg) => {
      if (/番茄钟/.test(msg.text)) {
        ctx.timer.in('25m', () => {
          behavior.applyEmotion('happy');
          ctx.chat.systemSay('25 分钟到啦，要起来活动一下吗？');
        });
      }
    });
  }
});
```

SDK 本质上是 Worker 内的 thin client，所有真实操作通过 `MessagePort` 回到 Main 进程的 PluginHost；PluginHost 校验权限、转译为 JSON-RPC 调业务模块或经 Electron API 触达系统能力。

### 5.4 沙箱与权限网关

1. **Worker 启动隔离**：`new Worker(entry, { eval: false, workerData: { allowedHosts, manifest }, execArgv: ['--experimental-permission', '--allow-fs-read=<plugin-dir>'], env: {} })`。Worker 内 `process.env` 为空、文件系统按目录白名单授权、无 `require` 高危模块（用 ESM + import map 收紧）。
2. **fetch 网关**：Worker 内 `globalThis.fetch` 在 plugin runtime bootstrap 阶段被替换为代理实现：请求经 `parentPort.postMessage` → PluginHost → Main；Main 比对 `permissions: ["network:<host>"]`，命中才放行；命中后由 Main（不是 Worker）通过 Electron `net.request` 完成 TLS 与 Header 注入；响应流回 Worker。
3. **fs / clipboard / shell 等**：仅通过 SDK 函数访问（如 `ctx.fs.readUserdir`、`ctx.clipboard.read`），每次调用经 PluginHost 权限网关；底层调用 Electron `clipboard` / Node `fs.promises`（被限定到角色包目录或用户主动选择的路径）。
4. **运行时审计**：高危调用首次触发由 Main 通过 `BrowserWindow`（Settings 窗口）弹窗确认（"插件 X 想读取剪贴板"），用户决定 `允许一次 / 永久允许 / 拒绝`，结果落 `plugins.registry.json`。
5. **资源限额**：每 Worker CPU 软超时 5s/调用、堆 128MB（通过 `resourceLimits: { maxOldGenerationSizeMb: 128 }` 设置）；超限 PluginHost `terminate` Worker 并标记 unhealthy；连续 3 次 unhealthy 自动禁用。

### 5.5 安装与热加载

Main 进程负责把 `.dspack`（zip）解压到 `plugins/<id>/`、写入注册表、签名校验（V2）；PluginHost 监听注册表变更（`chokidar` 或显式 `app.reloadPlugins()`），热加载/卸载对应 Worker，无需重启 app。Renderer 不直接访问文件系统，所有"我安装一个插件"的 UI 动作都走 `app.plugins.install` JSON-RPC。

---

## §6 状态归属与持久化

**单进程 + 单一写者**：所有持久状态由 Electron Main 持有，Renderer 与 Worker 通过 IPC / MessagePort 读写。原 v0.1 设计里 "Rust 写 vs Node 写" 的分层在 v0.2 中坍缩为"Main 进程的不同模块写"，但仍维持"每份数据只有一个写者"的纪律避免数据竞争。

```
<userData>/desksoul/        # app.getPath('userData') + '/desksoul'
├── secrets.kc            ← Main (safeStorage 加密；底层 OS Keychain 兜底)
├── windows.json          ← Main (WindowManager 模块)
├── plugins.registry.json ← Main (PluginHost 模块)
├── plugins/<id>/         ← Main (插件文件树；ZipInstaller 模块)
├── characters/<id>/      ← Main (角色包文件树；AssetInstaller 模块)
├── data/
│   ├── sessions.db       ← Main (better-sqlite3 单连接，WAL；ConversationCore 模块)
│   ├── memory.vec.db     ← Main (sqlite-vec，向量索引；MemoryWorker 通过 RPC 写)
│   ├── prefs.json        ← Main (Settings 模块)
│   └── logs/*.ndjson     ← Main + 各 Worker 通过 RPC 追加（Main 统一句柄，避免 fs 锁）
```

> 路径选择：`app.getPath('userData')` 在 Win 上是 `%APPDATA%/desksoul-desktop/`、Mac 上是 `~/Library/Application Support/desksoul-desktop/`、Linux 上是 `~/.config/desksoul-desktop/`。在该目录下再加一个 `desksoul/` 子目录以兼容用户文档习惯（用户手册中以 `~/.desksoul/` 别名展示，安装时建立 symlink）。

**SQLite schema 概要（`sessions.db`）**：

```sql
-- 每个角色一份独立空间，character_id 是所有表的强制前缀
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,            -- user / assistant / system / tool
  text        TEXT NOT NULL,
  raw         TEXT,                     -- 原始含标签文本
  ts          INTEGER NOT NULL,
  tokens_in   INTEGER, tokens_out INTEGER,
  provider    TEXT, model TEXT
);
CREATE INDEX idx_msg_char_session_ts ON messages(character_id, session_id, ts);

CREATE TABLE persona_state (
  character_id TEXT PRIMARY KEY,
  blob_json    TEXT NOT NULL,           -- 亲密度/约定等 KV
  updated_at   INTEGER NOT NULL
);

CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL,
  subject TEXT, predicate TEXT, object TEXT,
  confidence REAL NOT NULL,
  source_session TEXT, last_seen INTEGER, status TEXT  -- active|disputed|archived
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL, session_id TEXT NOT NULL,
  summary TEXT NOT NULL, ts INTEGER NOT NULL,
  archived INTEGER DEFAULT 0
);
```

**关键设计**：

1. **角色隔离**：所有业务表均以 `character_id` 为前缀，跨角色查询必须显式（默认 API 不暴露）。
2. **WAL + 单连接**：Main 进程持唯一 `better-sqlite3` 连接（WAL 模式），所有 Worker 不直连数据库，统一经 PluginHost RPC（`db.query`、`db.write`）走 Main。
3. **写路径无锁瓶颈**：消息/Persona State 是热写入（每条立刻 commit）；Episodic/Semantic 是低频写，由 `MemoryWorker` 后台批量、通过 `db.write` RPC 排队进入 Main 的写队列。
4. **崩溃恢复**：Renderer 重启后，UI 通过 `chat.snapshot {sessionId}` 拉最近 N 条消息重建视图；半截消息（status=`streaming`）标记为 `truncated`，不丢弃也不续写。Main 崩溃后由 OS 重启 → 加载磁盘状态 → 同样路径。
5. **导出与遗忘**：
   - 用户可一键导出全部数据到单 zip（schema 自带 manifest，便于迁移）
   - "记忆面板" UI 支持按角色 / 时间 / 关键词浏览删除事实与 episode；删除即写 tombstone（避免后台异步任务复活已删条目）
6. **跨层引用走 ID**：`plugin.id`、`character.id` 作 string key 出现在表里；模块之间不假设彼此的文件路径细节。
7. **磁盘配额**：`memory.vec.db` 默认上限 1GB，超限时按 episode 老化策略归档；`logs/` 滚动 7 天 / 100MB 二选一。
8. **加密**：`secrets.kc` 优先使用 Electron `safeStorage`（Win 上走 DPAPI、Mac 上走 Keychain、Linux 上走 Secret Service / libsecret）；`safeStorage.isEncryptionAvailable()` 为 false 时降级到 AES-256-GCM 本地加密文件，密钥派生自机器固定标识（`machine-id` / `IOPlatformUUID` / `MachineGuid`）+ 用户口令（可选）。**所有密钥操作只在 Main，Renderer 与 Worker 永远拿不到明文**。

---

## §7 渲染层与 Character Runtime

**双引擎、二选一、加载时定**：

```
[Character Window: 一个 webview]
  ├── 角色加载时根据 manifest.engine 选定一个：
  │     • engine="vrm"     → Three.js + @pixiv/three-vrm
  │     • engine="live2d"  → PIXI + pixi-live2d-display
  │
  └── 切换角色 = 销毁当前 context（dispose 完整资源）→ 新建
       允许一帧黑闪，换来"零跨引擎并发状态"
```

**统一抽象（`CharacterRuntime` 接口）**：

```ts
interface CharacterRuntime {
  load(manifest: CharacterManifest): Promise<void>;
  dispose(): void;

  // 行为 API（由 §4 BehaviorParser 触发）
  applyEmotion(name: string, weight?: number): void;
  playAction(name: string, durMs?: number): void;
  setLookAt(x: number, y: number): void;     // 屏幕坐标
  setLipsync(visemes: VisemeFrame[] | null): void;  // V1+
  setIdle(intent: { mood: string; energy: string }): void;

  // 查询
  listEmotions(): string[];
  listActions(): string[];
}
```

**渲染窗口 = 愚蠢播放器**：不持有业务状态、不跑 LLM、不读写数据库。仅经 preload 暴露的 `window.desksoul.on('behavior.*', ...)` 接收命令、播放、回报事件（如 `behavior.actionDone`）。

**透明窗口 + 命中策略**：

| 平台 | 透明 | 点击穿透 | 实现 |
| --- | --- | --- | --- |
| Win 10/11 | ✅ Electron `transparent: true` + `frame: false` | alpha 命中 (>0.05) | Renderer 内 `readPixels(1x1)` at cursor，经 IPC 通知 Main 调 `win.setIgnoreMouseEvents(ignore, { forward: true })` |
| macOS 12+ | ✅ `transparent: true`（Vibrancy 可选关闭） | 同上 | `win.setIgnoreMouseEvents(ignore, { forward: true })`；启动期 `win.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:false})` 配合不打扰模式 |
| Linux X11 | ⚠️ 需 compositor | 同上 | Electron 在 compositor 缺失时透明会失效；启动期 `process.versions.electron` + `app.commandLine.appendSwitch('enable-features=...')` 探测，无 compositor 时降级深色背景 |
| Linux Wayland | ⚠️ 各 compositor 差异 | `setIgnoreMouseEvents` 在 Wayland 下行为不稳定 | KDE/GNOME/Sway 单独测；MVP 标 experimental；必要时启用 `--ozone-platform=wayland --enable-features=WaylandWindowDecorations` |

> Electron 的 `forward: true` 关键在于"穿透时仍把鼠标 move 事件转发给被穿透窗口下层"——同时我们的角色 Renderer 又需要 mousemove 来 readPixels。Electron 在这点上的取舍是：`forward: true` 时鼠标事件在该窗口和下层同时收到。Spike S1 必须验证此行为在 Win 10/11 上正确（包含 alpha 临界翻转时的抖动控制）。

**性能预算（每帧）**：
- VRM 模式：60 FPS 目标；空闲态降至 30 FPS（无动作时）
- Live2D 模式：60 FPS 目标
- 单角色三角面 < 8 万；纹理总量 < 64MB
- 物理（弹簧骨/物理 mesh）默认 30Hz；用户可关

**资产加载安全**：
- Main 验证 manifest 中所有路径必须在 `characters/<id>/` 下，禁绝相对路径越级（`..`）和绝对路径
- 通过校验后，Main 注册一个自定义 `protocol.handle('asset', request => ...)`（Electron `protocol` 模块），将 `asset://<character-id>/<file>` 映射到磁盘文件；Renderer 仅能引用这种 URL，不能直接 `file://` 越权
- 角色包恶意指向系统文件 / 跨包加载 → protocol handler 直接 404
- 角色 Renderer 启用严格 CSP：`default-src 'self' asset:; img-src 'self' asset: data: blob:; script-src 'self'`（不允许远端脚本）

**LookAt / 鼠标追踪**：Main 把鼠标屏幕坐标（30Hz 节流）经 `webContents.send` 推到 Character Renderer；渲染层做平滑插值，避免抖动。可在设置中关闭。

**Idle 行为**：渲染层维护一组 idle 动画池，按当前 intent 选择采样。例如 `mood=shy` → 偏害羞的 idle 动画子集。空闲超时（默认 90s）触发"主动行为"事件（由 Main 内 ConversationCore 决策是否说话）。

---

## §8 记忆架构

```
┌──────────────────────────────────────────────────────┐
│ Working   最近 N=20 轮原始消息   每轮全注入           │
├──────────────────────────────────────────────────────┤
│ Episodic  历史会话摘要 + 向量    向量 top-k 检索      │
├──────────────────────────────────────────────────────┤
│ Semantic  结构化事实 (S,P,O,c)  关键词+向量混合检索   │
├──────────────────────────────────────────────────────┤
│ Persona   角色情感/关系 KV       全注入 system prompt │
└──────────────────────────────────────────────────────┘
```

**每轮上下文组装算法**：

```python
budget = model.context_window - reserved_for_output
ctx = []
ctx += persona_state(character_id)            # 始终全注入
ctx += semantic_facts(c >= 0.7)               # 高置信度事实，硬注入
remain = budget - len(ctx)
working = last_n_messages(20)                 # 原始消息
episodic = vector_search(query=user_msg, k=5) # 摘要 top-k
ctx += pack_with_budget(
  working * 0.5, episodic * 0.3, facts_low * 0.2,
  remain
)
```

**写路径**：

| 时机 | 动作 | 执行体 |
| --- | --- | --- |
| 每条消息生成 | 立刻 append `messages` 表 | Node 主线程，同步落库 |
| 每轮结束 | 更新 `persona_state`（亲密度、上次情绪、用户状态） | Node 主线程 |
| 会话闲置 30 分钟 / 超 40 轮 | 触发 Episodic 摘要 + 向量化 | `MemoryWorker`（独立 Worker） |
| 每 N 条消息（默认 20） | Semantic 事实抽取（用本地小模型） | `MemoryWorker` |
| 每天凌晨 / 启动后 | 老化扫描：低置信事实 prune、老 episode 归档 | `MemoryWorker` |

**Embedding Provider 独立**：默认 `bge-small-zh / multilingual-e5-small` 本地推理（onnxruntime-node 或 transformers.js）；用户可改用云端。每 `character_id + 文本` 缓存一份向量。

**事实抽取**：本地小模型扫一段对话 → `[{subject, predicate, object, confidence}]`。失败/JSON 损坏 → 静默丢弃。**反驳更新**：新消息明显冲突 → 旧事实 status=`disputed`、置信度衰减；连续 K 次被反驳则删除（写 tombstone）。

**翻旧账控制（五层抑制）**：

1. **检索阈值**：向量相似度 < 0.5 的 episode 不召回（可调）
2. **时间衰减**：相似度 × `exp(-age_days / τ)`，τ 默认 30 天
3. **去重**：top-k 中相互相似度 > 0.85 的合并保留一条
4. **主题过滤**：检索结果若与当前对话 intent 不匹配，权重×0.5
5. **冷却**：刚被引用过的 episode 在该 session 内冷却 5 轮不再召回

**隐私 / 用户控制**：
- 设置 → "记忆面板"：按角色 / 时间 / 关键词浏览、编辑、删除
- 一键 "忘记最近 1 小时 / 这次对话 / 关于 X 的所有事实"
- 全量本地，未经显式开关任何记忆都不会发往云端 LLM
- 角色间默认隔离；用户授权才共享

**MVP 切片**：MVP 只上 **Working + Persona State**；Episodic/Semantic 留接口，V1.0 启用。

---

## §9 MVP 切片、Tech Spike 与风险

### 9.1 MVP 切片（V0.1，目标 8–10 周）

**架构全部上**，功能砍到最小：

| 模块 | MVP 包含 | MVP 不做 |
| --- | --- | --- |
| Electron Main + 双 Renderer + Worker | ✅ 完整 | utilityProcess 拆分 |
| Electron IPC + Worker MessagePort（语义 = JSON-RPC 2.0） | ✅ 完整 | 远程 WebSocket Bridge |
| 行为协议解析 | ✅ `[intent]` + `<emo/>` + `<act/>` | `<say/>` `<wait/>` |
| 渲染 | ✅ Three.js + three-vrm | Live2D（V1.0） |
| Provider | ✅ OpenAI 兼容 + Ollama | 多 fallback、tool calls |
| 插件 | ✅ `worker_threads` 沙箱分层 + 1 个内置 Provider 插件 | 第三方插件安装 UI |
| 记忆 | ✅ Working + Persona State | Episodic / Semantic（V1.0） |
| 角色包 | ✅ 1 个内置角色 | `.dspack` 安装通道 |
| 设置 | ✅ Provider/Persona/快捷键 | 记忆面板、插件管理 UI |
| 平台 | ✅ Win 10/11 | macOS（V1.0）、Linux（V1.x） |

**关键：架构骨架不打折**——Main / Renderer / Worker 分层、Worker 沙箱、JSON-RPC 帧格式、行为协议、状态分层从 day 0 就完整。功能可以"接口在、实现 stub"，但骨架不能事后补。

### 9.2 Tech Spike 计划（建议 1–2 周，先于全量实现）

| Spike | 验证什么 | 成功判据 |
| --- | --- | --- |
| **S1 透明窗口三件套** | Win Electron `transparent: true` + alpha 命中穿透 + 拖拽 | Win 10/11 均可拖拽，alpha 命中正确，`setIgnoreMouseEvents({forward:true})` 切换无明显抖动，杀软不报警 |
| **S2 Main ↔ Renderer ↔ Worker 串联** | preload `contextBridge` 暴露最小 RPC + Main 内 JSON-RPC 路由 + `worker_threads` 启停与崩溃恢复 | UI invoke `sys.ping` 全链路（Renderer → Main → Worker → Main → Renderer）通；Worker 强杀（`worker.terminate()`）后 1s 内 PluginHost 重启，UI 再 invoke 仍成功；连续 kill 3 次观察 backoff |
| **S3 VRM 加载 + BlendShape** | three-vrm 0/1 加载 + 8 种基础情绪可控 | 8 个 emotion 切换流畅 ≥30 FPS |
| **S4 一次完整流式对话** | UI → Main → ProviderWorker → BehaviorParser → 双 Renderer 输出 | 边出文本边变表情，cancel 可终止（200ms 内 Worker terminate 兜底） |
| **S5 Worker 沙箱权限网关** | Worker fetch 代理 + Main 端 host 白名单 + Authorization 注入 + Worker 看不到 API key | Worker 内 `process.env` / 读 secrets.kc 全失败；外发请求 host 白名单生效；safeStorage 写读密钥往返成功 |

**通过 S1–S5 才进入正式开发**。任一项失败需要回到对应章节重新决策。

### 9.3 风险登记表

| 风险 | 等级 | 触达时机 | 缓解 |
| --- | --- | --- | --- |
| Linux Wayland 透明 + 穿透不一致 | 高 | V1.x | MVP 不发；V1.x 单独 spike，KDE/GNOME/Sway 分别测；首发 experimental |
| LLM 漏标签 / 半截标签 | 中 | MVP | 解析器 fail-safe（300ms timeout flush）；Persona prompt 强约束 + few-shot |
| Worker 沙箱被绕过 | 高 | V1+ | 渐进收紧：MVP 用 `worker_threads` + 受限 globalThis + execArgv permission；V1 加 `--experimental-permission` 完整集；V2 探索 isolated-vm 或 `utilityProcess` 把 ProviderRouter 拆出 |
| Main 进程崩溃 = 整 app 重启 | 中 | 始终 | Main 内代码严格"轻"：业务下沉到 Worker；DB / Keychain 操作用 try/catch 包裹；崩溃路径写最小化的 prefs 快照 |
| 长期记忆翻旧账 | 中 | V1.0 | §8 五层抑制策略；记忆面板让用户可观可改 |
| 跨平台分发体积膨胀 | 中 | V1.0 | Electron base ~80MB；用 electron-builder 的 maximum compression + asar；按需下载 onnx 模型；区分 portable / setup 两种发行 |
| 角色包版权与素材合规 | 中 | V1.0 | manifest 强制 `license` 字段；安装时显示并要求确认 |
| 用户对"桌面常驻 AI"隐私顾虑 | 高 | 始终 | 默认本地优先 + 启动期数据流向说明 + 开源代码可审计 |

### 9.4 待 brainstorm 的 V1+ 主题（stub）

1. **语音 / 嘴型架构**：TTS 流式与行为协议的耦合点；viseme 流 vs 音量包络；播放进程归属；ASR 推送-拉取模式。
2. **AstrBot Bridge**：远程 Node sidecar 形态 vs 共享 SQLite vs Webhook 桥；记忆是否跨端同步；多端对话归并策略。
3. **多角色编排（V2）**：同屏多角色或角色之间互动；跨角色记忆与人格隔离边界。
4. **插件市场（V2）**：分发渠道（GitHub Repo 索引 vs 自建）；签名机制；评分与举报。

---

## 附录 A: 关键决策摘要

| # | 决策点 | 选择 |
| --- | --- | --- |
| Q1 | 技术取向 | 长期工程型（MVP 阶段就把骨架打好） |
| Q2 | 进程 / 窗口模型 | Electron Main + 双 Renderer（Character / UI Overlay）+ 按需 Settings 窗口；进程 = Main + Renderers，崩溃隔离粒度详见 §1/§2 |
| Q3 | 核心服务运行时 | **Electron Main（Node）直接承担业务大脑**；插件跑 `worker_threads`（v0.2 调整：放弃 Rust 内核 + 独立 Node Sidecar 子进程） |
| Q4 | IPC 机制 | Electron `ipcMain`/`ipcRenderer` + `contextBridge` + `MessagePort`；payload 始终是 JSON-RPC 2.0 帧 |
| Q5 | 行为驱动协议 | intent header + 行内标签 |
| Q6 | 插件运行环境 | 分层混合（资源型不沙箱、代码型 `worker_threads`、特权型 `worker_threads` + 权限网关 + Main 端 fetch 代理） |
| Q7 | 状态归属 | Main 内多模块写、单一写者纪律；Renderer / Worker 经 RPC 读写 |
| Q8 | 窗口编排 | 状态化锚定（Idle/Awakened/Detached） |
| Q9 | 渲染引擎 | 双引擎并存，加载时二选一（VRM Three.js / Live2D PIXI） |
| Q10 | Provider 抽象 | 自定义外层 + OpenAI 兼容内层（混合） |
| Q11 | 记忆架构 | 四层（Working / Episodic / Semantic / Persona） |
| Q12 | 文档落地 | 整合本设计文档，V1+ 主题留 stub |
| Q13 (v0.2) | 桌面壳 | **Electron**；理由：JS/TS 单栈、IPC 链路短、生态成熟、团队减少 Rust 依赖；代价：~80MB 体积 + Main 崩溃即整 app 重启（用 Worker 化业务降低概率） |

## 附录 B: 与参考项目的复用关系

| 参考项目 | 复用什么 | 不复用什么 |
| --- | --- | --- |
| **Mate-Engine** | 桌面透明窗口 + 拖拽 + 点击穿透的设计思路 | Unity 渲染层（我们走 Web 栈） |
| **AstrBot** | Provider 抽象、插件市场、IM 适配的产品形态思路；V2 作可选远程 Bridge 后端 | 桌面端不打包 Python；不在桌面端跑其插件 |
| **airi** | 模块化角色 / 技能 / 记忆边界设计；语音嘴型方案借鉴（V1+） | 浏览器为主的部署形态 |
| **VSCode / Obsidian** | Electron 透明窗口（Obsidian 部分场景）/ 多 BrowserWindow 编排 / contextBridge 最佳实践 | 全功能 IDE 形态 |
