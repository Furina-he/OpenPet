# Spike S5 · Worker 沙箱权限网关 — RESULTS

**状态:** ✅ PASSED（自动化对抗判据全过；GUI 控制面板手测待 Windows dev 二次确认）
**日期:** 2026-06-10
**平台:** Windows 11 (win32) · Node 22.20.0 · Electron 30

## 目标

把 Provider Worker 关进 Main 监督的「沙箱 + 权限网关」里，证明三道隔离同时成立：

1. **凭证/env 隔离** —— Worker 内 `process.env` 读不到任何 secret。
2. **文件系统隔离** —— Worker 读系统文件（`hosts`）被 Node 权限模型拒绝，只能读自己代码目录。
3. **网络网关** —— Worker 的 `fetch` 全部经 MessagePort 代理到 Main；非白名单 host 在外发前被拒，白名单 host 放行且 `Authorization` 由 Main 注入（密钥永不进 Worker）。

## 成功判据

| # | 判据 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | `env: {}` 清空环境，Worker 读不到 `SECRET`，env 键数为 0 | Vitest `jails secrets...`（探针 `envSecret`/`envKeys`） | ✅ |
| 2 | `--permission --allow-fs-read=<workerDir>` 下 Worker 能加载自己但读 hosts = `ERR_ACCESS_DENIED` | 同上（探针 `fsHosts`） | ✅ |
| 3 | 非白名单 `evil.example.com` 被网关拒（未触达 egress），`onBlocked` 记录该 host | 同上（探针 `evil` + `blocked`） | ✅ |
| 4 | 白名单 `api.openai.com` 放行，egress 收到 `Authorization: Bearer <key>`，Worker 拿到正常 200 + body | 同上（探针 `allowed`/`allowedBody` + `injectedAuth` 断言） | ✅ |
| 5 | 白名单 host 但无 key 时不注入 `Authorization`（不凭空造头） | Vitest `does not inject Authorization...` | ✅ |

## 架构

```
[Renderer 控制面板]  --rpc sandbox.run-->  [Main: ipcMain]
                                              |
                              new Worker(entry, {
                                env: {},                         <- 凭证/env 隔离
                                execArgv: ['--permission',
                                  '--allow-fs-read=<workerDir>',  <- fs 白名单
                                  '--allow-fs-read=<node>'] })
                                              v
                          [SandboxWorker: sandbox-worker.mjs]
                            installFetchProxy(): globalThis.fetch 被替换
                              -> 每个请求经 MessagePort 发 {kind:'fetch', id, url, init}
                                              |  (MessagePort)
                                              v
                          [Main: PluginHost.onFetch]  ← 唯一握有网络 + 密钥的地方
                            1. URL.hostname ∈ allowedHosts ?  否 → 拒（onBlocked）
                            2. keyForHost(host) → 注入 Authorization: Bearer <key>
                            3. egress(url, init)  (生产: Electron net.request)
                            4. 回 {kind:'fetch.result', id, ok, status, body}
                                              |
                                              v
                          [SandboxWorker] fetch 的 Promise resolve 成 Response
```

- **三个独立可测单元**：
  - `worker/fetch-proxy.mjs` —— Worker 侧 fetch 代理。把 `globalThis.fetch` 换成 MessagePort 往返，按 `(kind==='fetch.result' && id)` 严格过滤，不吞 Worker 自己的 `run` 控制消息。
  - `worker/sandbox-worker.mjs` —— 充当不可信第三方 Provider 的对抗 Worker，收到 `run` 后依次尝试读 env / 读 hosts / 访问 evil host / 访问白名单 host，把结果作为 `probes` 回报。
  - `electron/main/plugin-host.ts` —— Main 侧沙箱 + 网关。spawn-time 建监狱（`env:{}` + 权限 flag），run-time 做白名单校验 + 密钥注入 + egress。`egress` 与 `keyForHost` 构造注入，使网关逻辑（白名单 + 注键）可在**无 Electron、无真实网络**下单测——沿用 S4「ConversationCore 纯函数可测」的同一手法。

## 三道隔离的实证依据（spike 前先打的探针）

| 假设 | 探测结论 |
| --- | --- |
| `env: {}` 是否真清空环境？ | ✅ `envKeys=0`、`SECRET=null`；默认 env-inherit 时 `envKeys=88`、能读到 SECRET。零成本隔离。 |
| `--experimental-permission` 加到 worker execArgv 行不行？ | ⚠️ 会让 worker **连自己代码都读不了**而启动失败；范围必须显式含 worker 目录 + `process.execPath`。已据此修订实现。 |
| 权限模型能否只收紧 worker、不影响主线程？ | ✅ 进程级 opt-in：主线程 `process.permission===undefined`（全权限），worker 带 flag 后 `fs.read` 白名单外 = `ERR_ACCESS_DENIED`。 |

## 已自动验证（无需 GPU/显示，CI 友好）

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `PluginHost` 真 worker 对抗探针（env/fs/evil/allowed 四合一） | ✅ | 真 `worker_threads` spawn，带生产 jail flags |
| `PluginHost` 白名单无 key 不注入 Authorization | ✅ | 边界用例，证明不凭空造认证头 |
| `tsc` 类型检查（node + renderer 两份 tsconfig） | ✅ | `pnpm --filter @openpet/spike-s5 typecheck` |
| `electron-vite build` 三路打包（main/preload/renderer） | ✅ | worker `.mjs` 不经打包，按 `out/main → ../worker` 运行时解析 |
| `eslint` lint | ✅ | 无错误 |

## 踩坑修订

- **204/205/304 是 null-body 状态**：undici 的 `Response` 构造器对这些状态码拒绝**任何** body（连 `''` 都不行），且在 MessagePort 的 message handler 里**同步抛出**——不在 fetch 的 Promise 链上，导致 `await fetch` 永不 settle，表现为「超时等不到 probes」。修复：fetch-proxy 对这些状态码把 body 强制为 `null`。

## 手测清单（Windows dev 控制面板）

> 自动化已覆盖全部 5 条成功判据；以下为 Electron 真实运行时（含 `safeStorage` + `net.request`）的二次确认。
> 跑：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm --filter @openpet/spike-s5 dev`

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| 弹出控制面板窗口，点「运行对抗探针」 | ☐ | |
| env secrets 一栏 ✓（SECRET=null，键数 0） | ☐ | |
| 读 hosts 一栏 ✓（`ERR_ACCESS_DENIED`） | ☐ | |
| evil.example.com 一栏 ✓（host not allowed，未外发） | ☐ | |
| api.openai.com 一栏：`net.request` 真发起（无网/401 也算放行成功，判据是「被网关放行 + 注键」而非远端返回值） | ☐ | 真实网络下 OpenAI 会因 demo key 返 401，属预期 |

## 与计划/设计的偏差说明

- **`--allow-fs-read` 范围**：tech-design §9.2 写的是 `--allow-fs-read=...` 占位。实证表明范围**必须**显式包含 worker 代码目录 **和** `process.execPath`，否则 worker 无法加载自身。已在 `PluginHost` 构造器里据此固化（取 entryPath 目录 + node 可执行）。回写 tech-design。
- **egress/key 注入点为接口注入**：生产里 `egress` = Electron `net.request`、`keyForHost` = `safeStorage` 解密；spike 的 Main entry 已接上真实 `net.request` 与 `safeStorage.isEncryptionAvailable()` 判定，但 demo 无落盘密文，故 `keyForHost` 对白名单 host 返回占位 key 以演示注入点。
- **流式响应（chunked）未做**：tech-design 提到网关「流式回响应」。S5 聚焦**权限边界**本身，egress 按整段 body 回。流式分块留到 M1/M3 与 S4 的流式管线合并时实现——协议帧（`fetch`/`fetch.result`）预留了演进空间（再加 `fetch.chunk`/`fetch.end` 即可）。

## 回写提示（给 M1 迁移）

- `PluginHost` 的 jail 构造（`env:{}` + `--permission --allow-fs-read=<dir>,<node>`）是生产 PluginHost 的权限基线，直接复用；范围计算别再踩「忘了 node 可执行」的坑。
- fetch-proxy 的 `(kind, id)` 严格过滤 + null-body 状态处理可原样搬。生产里 Provider Worker 的真实 `fetch`（调 OpenAI 等）就走这条代理，无需改 Provider 代码。
- 网关的「白名单 → 注键 → egress」三步是 tech-design §安全模型的落点；密钥解密永远在 Main，`egress` 收到的 init 已含 `Authorization`，Worker 侧拿不到也看不到。
- 与 S4 合并时：把 S4 的 `chat.start/event/cancel` 帧与 S5 的 `fetch/fetch.result` 帧并到同一 worker MessagePort 协议下，Provider Worker 既流式吐 delta、又经网关取数。
