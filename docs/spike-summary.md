# Tech Spike 总结 (Phase 0/1) — S1–S5

**日期:** 2026-06-11
**状态:** 全部 PASSED（5 个 spike tag 齐全）
**平台:** Windows 11 (win32) · Node 22.20.0 · Electron 30

---

## 执行概览

| Spike | 验证目标 | 判据 | 结果 | Tag |
| --- | --- | --- | --- | --- |
| **S1** 透明窗口 | 透明 + alpha 命中穿透 + 长按拖拽（Win 10/11） | 5 条（穿透/拖拽/杀软/抖动控制） | ✅ | `spike/S1-passed` |
| **S2** 三进程串联 | Renderer→Main→Worker JSON-RPC 往返 + 崩溃重连 | 5 条（往返/退避重启/挂起调用被 reject） | ✅ | `spike/S2-passed` |
| **S3** VRM 渲染 | three-vrm v3 加载 + 8 情绪 BlendShape + 30 FPS | 5 条（加载/idle 动画/平滑切换/FPS） | ✅ | `spike/S3-passed` |
| **S4** 流式对话 | 端到端流式管线（双轨并行 + cancel watchdog） | 5 条（全链路/双轨/协作 cancel/强杀/重生） | ✅ | `spike/S4-passed` |
| **S5** 沙箱网关 | Worker jail (env/fs) + fetch 网关（白名单 + 注键） | 5 条（env 隔离/fs 拒绝/evil host 拦截/白名单放行 + 注键） | ✅ | `spike/S5-passed` |

**自动化覆盖率:** S2/S4/S5 的全部判据已由 Vitest 自动验证（跨平台、无显示依赖、CI 友好）。S1/S3 的判据需 GPU + 显示，已人工手测确认全过。

---

## 原假设验证汇总

### ✅ 站住的假设（可直接用于 MVP）

| 假设 | 验证来源 | 生产实现路径 |
| --- | --- | --- |
| **Electron 透明窗口 + alpha 命中穿透在 Win 10/11 可用** | S1 | Character 窗口直接复用 `setIgnoreMouseEvents({forward:true})` + `gl.readPixels` 双阈值迟滞。`backgroundThrottling:false` 保证失焦时不降频。 |
| **`sandbox + contextIsolation` 能与透明窗口共存** | S1 | ⚠️ **修正**：Electron 已知限制下 `transparent:true` 与 `sandbox:true` 冲突（preload 静默失败），Character 窗口必须 `sandbox:false`，但 `contextIsolation:true` 仍保持。UI Overlay / Settings 可全沙箱。 |
| **worker_threads 可跨 Renderer→Main→Worker 串联 JSON-RPC** | S2 | `@desksoul/protocol` 作为单一真源，Main 的 IPC router 转发到 worker MessagePort。已验证崩溃重连（指数退避 + 挂起调用被 reject）。 |
| **three-vrm v3 + VRM 1.0 可在 Electron renderer 跑 ≥30 FPS** | S3 | 加载后跑 `VRMUtils.removeUnnecessaryVertices` / `combineSkeletons` / `combineMorphs` 三件套 + 关 `frustumCulled`，idle 动画 + 8 情绪平滑切换 400ms 均达标。 |
| **流式 LLM 输出可边吐边驱动表情（双轨并行）** | S4 | `BehaviorParser` 增量解析 delta chunk，`ConversationCore` 拆 text/emotion/action/intent 到两个 notification channel（`chat.*` / `behavior.*`），一次广播双 renderer 各取所需。已验证跨 chunk 半截标签拼接。 |
| **cancel 可在 200ms 内兜底（wedged provider 强杀 + 重生）** | S4 | `ProviderHost.cancel` 先发协作 cancel，同时武装 watchdog；超时强制 `terminate` + 合成 `done{cancel}` + 重生，UI 永不挂起。 |
| **Worker 可被 `env:{}` + `--permission` 关进牢笼** | S5 | `env:{}` 零成本清空环境（envKeys=0）；`--allow-fs-read=<workerDir>,<node>` 限 fs 白名单（系统文件 = `ERR_ACCESS_DENIED`）；fetch 代理 + Main 侧网关做 host 白名单 + `Authorization` 注入。密钥永不进 worker。 |

### ⚠️ 被证伪 / 需修正的假设

| 原假设 | 实证结论 | 修正 |
| --- | --- | --- |
| **Electron 透明窗口可全沙箱（`sandbox:true`）** | ❌ Electron 已知限制：`transparent:true` + `sandbox:true` 下 preload 静默失败 | Character 窗口 `sandbox:false`；UI Overlay / Settings 可 `sandbox:true`（不透明）。 |
| **`--experimental-permission` 可直接加到 worker execArgv** | ❌ 会让 worker 连自己代码都加载不了而启动即崩 | 范围必须 `--allow-fs-read=<workerDir>` + `--allow-fs-read=${process.execPath}`，否则 worker 无法 boot。 |
| **protocol 包的 re-export 在 Vitest 下能通过就行** | ❌ Vitest 走 bundler resolution 不需后缀，但 worker_threads 按 Node ESM 运行时加载、`export * from './jsonrpc'` 缺 `.js` 后缀会 `Cannot find module` | 所有 `export *` 已补 `.js` 后缀（符合 CLAUDE.md ESM 约定），dist 重建。 |
| **高 DPI 下 `clientY` 可直接翻转读 GL buffer** | ❌ `clientX/Y` 是 CSS 像素、drawing buffer 是 device 像素，150% 缩放下直接翻转会读错位置 | 按 `getPixelRatio()` 换算 → device 坐标再翻转 y 轴（S1 已修正）。 |
| **204 等 null-body 状态的 Response 能接受 `''` body** | ❌ undici `Response` ctor 对 204/205/304 拒绝任何 body（连空串都不行），且同步抛在 MessagePort handler 里 → fetch Promise 永不 settle | fetch-proxy 对这些状态强制 body 为 `null`（S5 已修正）。 |

### 🟡 需在 MVP 阶段额外注意的点

| 主题 | 发现 | M1/M2/M3 应对措施 |
| --- | --- | --- |
| **Character 窗口的沙箱妥协** | 透明必须 `sandbox:false`（Electron 限制） | ✅ `contextIsolation:true` 仍保持 + preload 最小暴露面（只给 rpc/on）+ Main 做 schema 校验。风险可控：Character renderer 只订阅 `behavior.*`，无用户输入、无外链跳转。 |
| **穿透与拖拽的状态共享** | 拖拽中途若被切到 `ignoreMouseEvents(true)`，`mouseup` 会落到桌面、本窗口收不到 → `dragging` 永不复位 | S1 已修正：拖拽期间冻结穿透切换（`shared.dragging`）。M1 迁移时必须保留这条耦合。 |
| **退避重置的时机** | worker spawn 不代表健康，crash-on-start 的 worker 若「spawn 即重置退避」会无限快速重启 | S2 已修正：**收到 worker 任何响应才重置退避**（健康证明），而非 spawn 即重置。PluginHost 生产版必须沿用。 |
| **流式响应的 chunked 实现** | S5 的 fetch 网关按整段 body 回，未做分块流式 | tech-design 提到「流式回响应」。S5 聚焦权限边界本身，流式分块留到 M3 与 S4 管线合并时做（协议帧 `fetch.result` 可演进为 `fetch.chunk` + `fetch.end`）。 |
| **VRM 模型的 `.gitignore`** | S3 的 `sample.vrm` (28MB) 按约定不进仓库 | M1/M2 打包时从外部 CDN / 本地 fallback 读；CI 无模型时 Character 窗口单测用 mock 或跳过渲染判据。 |
| **Character 窗口未接 VRM（S4）** | S4 验证流式管线，Character 窗口用 DOM「情绪脸」代替 VRM | 不是偏差：S4 的重点是双轨流式协议（`behavior.*` notification），与渲染技术（DOM vs VRM）正交。M1 换成 S3 的 three-vrm 运行时，订阅同一组 `behavior.*`，协议契约不变。 |

---

## 关键实证数据（供 M1+ 决策参考）

| 指标 | 实测值 | 来源 | 备注 |
| --- | --- | --- | --- |
| **透明窗口 alpha 命中采样帧率** | 30Hz（节流 `mousemove`） | S1 | 更高无意义（鼠标轨迹本就 ~125Hz），更低会感知延迟 |
| **alpha 穿透双阈值** | 进实心 ≥26 (0.10) / 退实心 <13 (0.05) | S1 | 拉开避免边缘抖动；具体值可按模型微调 |
| **长按拖拽触发延迟** | 200ms | S1 | 低于此值与「点击角色交互」冲突 |
| **cancel watchdog 超时** | 200ms（生产默认） | S4 | S2 的退避最小 1s，S4 cancel 最快 200ms 强杀，两者量级不冲突 |
| **退避封顶** | 30s | S2 | 无限递增会让一个长时 wedged 的插件永久不可用；30s 是「允许重试 + 避免风暴」的平衡点 |
| **表情过渡时长** | 400ms | S3 | 350–500ms 区间肉眼流畅；更短显跳变、更长显迟钝 |
| **VRM 渲染目标 FPS** | ≥30（30s 平均） | S3 | 瞬时可能抖动，30s 平均 ≥30 才算稳定 |
| **renderer bundle 体积** | 1.58MB (S3, three+vrm) / 987KB (S1, three only) | S1/S3 build | 可接受；生产打包时可按需 tree-shake |

---

## 回写 tech-design 的修订点

以下发现需回写到 `docs/plans/2026-05-01-desksoul-tech-design.md`（v0.2）：

1. **§3.1 进程拓扑 / Character 窗口沙箱约束**
   - 现状：未明确透明窗口的沙箱限制
   - 修订：注明 Character 窗口 `transparent:true` 下必须 `sandbox:false`（Electron 已知限制），但 `contextIsolation:true` 保持。UI Overlay / Settings 可全沙箱。

2. **§3.3 Worker 权限模型 / `--allow-fs-read` 范围**
   - 现状：`--allow-fs-read=...` 占位
   - 修订：范围**必须**显式包含 `<worker 代码目录>` **和** `process.execPath`（node 可执行），否则 worker 无法加载自身（S5 实证）。

3. **§3.3 Worker 权限模型 / 退避重置时机**
   - 现状：未明确退避何时重置
   - 修订：**收到 worker 任何响应才重置退避**（健康证明），而非 spawn 即重置。否则 crash-on-start 的插件会无限快速重启风暴（S2 实证）。

4. **§附录 协议 / ESM 导出后缀**
   - 现状：未约束
   - 修订：`@desksoul/protocol` 的所有相对导出必须带 `.js` 后缀（Node ESM 运行时要求），即使 TS 源码是 `.ts`。S2 发现并已修复。

5. **§9.2 Tech Spike 判据 / S1 高 DPI 修正**
   - 现状：skeleton 直接翻转 `clientY`
   - 修订：`clientX/Y` 须按 `getPixelRatio()` 换算成 device 像素再翻转 y 轴，否则高 DPI 下命中偏移（S1 实证）。

---

## M1 迁移清单（从 spike 到生产的 diff）

### 必须复用（已验证可行）

- **S1** `setIgnoreMouseEvents` 双阈值迟滞 + 高 DPI 修正 + 拖拽冻结穿透切换
- **S2** `createRequire(import.meta.url)` resolve worker entry + 退避「收到响应才重置」
- **S3** three-vrm v3 性能三件套 + `frustumCulled:false` + 8 情绪加权组合
- **S4** `ConversationCore` 纯函数双轨拆分 + `ProviderHost` cancel watchdog (200ms terminate 兜底)
- **S5** `PluginHost` jail 构造（`env:{}` + `--permission --allow-fs-read=<dir>,<node>`）+ fetch-proxy null-body 状态处理

### 需合并的协议（spike 间已分散定义）

- **S2** `sys.ping` → 留作健康检查
- **S4** `chat.send` / `chat.cancel` / `chat.stream` / `chat.done` + `behavior.applyEmotion` / `behavior.playAction` / `behavior.setIntent`
- **S5** fetch 网关的 `kind:'fetch'` / `kind:'fetch.result'` 帧（与 S4 的 `chat.*` 帧共存同一 MessagePort）

→ 合并后 `@desksoul/protocol/methods.ts` 是唯一定义点，Main 的 ipc-router + worker MessagePort 协议都从这里取 schema。

### 待补全（spike 有意跳过的部分）

- **真实 Provider 接入**：S4 用 `mock-provider`，M2/M3 接 OpenAI/Anthropic SDK。
- **safeStorage 密钥落盘 + 解密**：S5 的 `keyForHost` 是占位，生产读 ciphertext 经 `safeStorage.decryptString`。
- **fetch 网关流式分块**：S5 按整段 body 回，M3 演进为 `fetch.chunk` + `fetch.end` 帧。
- **VRM 模型分发**：S3 手测用本地 `sample.vrm`，M1 从 CDN / 本地 fallback 读。
- **跨平台验证（Mac/Linux）**：S1 仅验 Win 10/11，Mac/Linux 留 V1.0+。

---

## 风险 & 遗留问题

| 风险 | 缓解措施 | 跟踪 |
| --- | --- | --- |
| **Character 窗口 `sandbox:false` 的攻击面** | `contextIsolation:true` + preload 最小暴露 + Main schema 校验 + renderer 无用户输入/外链 | M1 安全 review |
| **流式 fetch 未实现（S5）** | S5 聚焦权限边界，流式分块留 M3 | M3 里程碑 |
| **Mac/Linux 透明窗口未验（S1）** | Win 是首发平台，其他 OS 留 V1.0+ | V1.0+ 跨平台里程碑 |
| **VRM 模型 CDN 依赖** | 本地 fallback + CI 用 mock 或跳过渲染判据 | M1 打包方案 |

---

## 结论

**Phase 0/1 验收通过**，5 个 spike 全部 PASSED，tag 齐全（`spike/S{1..5}-passed`）。核心技术栈（Electron 透明窗口 + three-vrm v3 + worker_threads JSON-RPC + 流式双轨 + 沙箱网关）的可行性已实证，关键假设的证伪点（透明沙箱冲突 / 权限模型范围 / 退避重置时机 / ESM 后缀 / 高 DPI 修正 / null-body 状态）已修正并记录，可安全进入 **Phase 2 (M1–M5 MVP 切片)**。

M1 的首要任务：把 S1–S5 验证过的代码迁移到 `apps/desktop` (Electron Main/Preload/Renderer) + `apps/sidecar` (业务大脑模块) + `packages/protocol`（协议定型），按 impl-plan 的 M1 验收标准（三窗口启动 + schema 单一真源 + E2E: UI overlay 发 `chat.send` → character 切表情）完成架构骨架收口。
