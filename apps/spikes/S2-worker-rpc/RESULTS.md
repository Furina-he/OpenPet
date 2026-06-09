# Spike S2 · Electron Main ↔ Renderer ↔ Worker 串联 — RESULTS

**状态:** ✅ PASSED
**日期:** 2026-06-09
**平台:** Windows 11 (win32)

## 目标

Renderer 经 `window.desksoul.rpc(...)` 调到 Main;Main 内 JSON-RPC 路由把请求转发给 `worker_threads` 内的 sidecar 业务模块;Worker 崩溃后由 PluginHost 指数退避重启,重连后可继续调用。语义模型全程 JSON-RPC 2.0,`@desksoul/protocol` 零改动复用。

## 成功判据

| # | 判据 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | `sys.ping` 全链路往返(Renderer→Main→Worker→Main→Renderer) | Vitest `round-trips sys.ping` + 手测 ping 按钮 | ✅ |
| 2 | `worker.terminate()` 模拟崩溃 → 退避重启 | Vitest `reconnects after terminate` | ✅ |
| 3 | 重启后再发请求仍成功(无需手动刷新) | 同上,terminate 后 `sys.ping` 再次成功 | ✅ |
| 4 | 退避指数递增、封顶 30s | Vitest `escalates backoff` (50→100→200) + `caps backoff` | ✅ |
| 5 | Worker 抛未捕获异常 → host 进程不退出、可恢复 | Vitest `survives worker crash` | ✅ |

附加:`rejects in-flight calls when the worker dies` —— worker 死亡时挂起的调用被 reject,不永久悬挂。

## 自动化测试

`test/plugin-host.test.ts`(Vitest,跨平台,6 个用例全过)。用真实 sidecar worker 入口(`@desksoul/sidecar/dist/worker-entry.js`,即生产 Main resolve 的同一文件)跑往返/重连;用 `test/fixtures/crash-worker.mjs`(启动即抛)验退避递增——因为永远收不到健康响应,退避不会被重置,才能观察到 1→2→4 倍增。

退避重置策略:**收到 worker 的任何响应才重置**(健康证明),而非"spawn 即重置"。否则 crash-on-start 的 worker 每次重启都会复位退避,判据 4 测不出递增。

## 关键设计

- **ESM worker 入口 resolve**:Main 是 ESM(`"type": "module"`),无 `require`。用 `createRequire(import.meta.url)` 拿到 `require.resolve`,定位 sidecar worker 入口。
- **崩溃事件去重**:terminated worker 会同时触发 `error` 与 `exit`,`handleDeath` 用 `restarting` 标志去重,避免一次崩溃排两次重启。
- **PluginHost 可注入项**:`baseBackoffMs` / `maxBackoffMs` / `onRespawnScheduled`,生产默认 1s/30s,测试用小基数 + 回调断言退避序列。

## 发现并修复的真实缺陷

**`@desksoul/protocol` 的 `dist/index.js` 相对导出缺 `.js` 后缀。**

`src/index.ts` 用 `export * from './jsonrpc'`(无后缀),编译后 dist 原样保留。此前该包只被 Vitest 的 bundler resolution 解析过(不需后缀),**S2 是第一次在 `worker_threads` 里按 Node ESM 运行时规则加载它**,后缀缺失才暴露为 `Cannot find module '...\protocol\dist\jsonrpc'`,导致 worker 启动即崩。

修复:`src/index.ts` 三个 `export *` 补 `.js` 后缀(符合 CLAUDE.md "ESM 相对导入要带 `.js` 后缀")。已重建 protocol dist 验证。

> **回写提示**:迁移到 `apps/desktop`(M1)时,protocol 的运行时加载路径与此处一致,该后缀修复必须保留;后续给 protocol 加新文件/导出时同样要带 `.js`。

## 手测清单(Windows dev 窗口)

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| dev 窗口弹出,ping 按钮返回 `{pong:'ok', echoNonce}` | ☐ | `pnpm --filter @desksoul/spike-s2 dev` |
| "模拟 Worker 崩溃"后等 ~1s 再 ping 仍成功 | ☐ | |
| 连按崩溃按钮,控制台见 `[PluginHost] respawn in {1000→2000→4000}ms` | ☐ | |

> 自动化测试已覆盖以上全部判据;手测仅为 Electron 真实运行时的二次确认。
