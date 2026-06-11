# M1 验收结果

**环境：** Windows 11 · Node 22 · Electron 30 · 2026-06-11
**分支：** `feat/m1-skeleton` · 自动化 E2E：`apps/desktop/test/e2e-smoke.mjs`（`pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs`，跑真实构建产物）

## impl-plan M1 三大验收

| 验收项 | 验证方式 | 结果 |
| --- | --- | --- |
| **三窗口启动且崩溃隔离** | e2e-smoke：三窗口创建（settings 保持隐藏）；`forcefullyCrashRenderer()` 强杀 character → `render-process-gone` 自动 reload，overlay 不受影响，恢复后再次对话 character 仍收到 `behavior.applyEmotion`。Worker 崩溃语义由 `provider-host.test.ts` 9 用例钉死（退避 50/100/200 递增、封顶、收到响应才重置、死亡清算 error done、watchdog 强杀重生） | ✅ PASS |
| **protocol schema 单一真源** | 破坏性抽查：`methods.ts` 把 `chat.send.sessionId` 改名 → `apps/desktop` 的 ipc-router.ts 与 router.test.ts **编译期同时报 TS2339**，还原后恢复绿。运行时：e2e-smoke 验证违约 params 被 Zod 拒绝（-32602） | ✅ PASS |
| **E2E：overlay 发 chat.send (mock) → character 切表情** | e2e-smoke：overlay `chat.send` → 文本流 `"嗯…我在想要不要请你喝杯热可可？"`（行为标签全部剥离，无 `<emo:`/`<act:`/`[intent` 泄漏）→ done(stop)；character 收到 emotions `[shy, happy]` + playAction ×1（跨 chunk 半截标签 `<act:fidget ` + `dur=1500/>` 正确重组）+ setIntent ×1 | ✅ PASS |

## 详细检查项

| # | 检查项 | 结果 | 备注 |
| --- | --- | --- | --- |
| 1 | 三窗口启动，settings 隐藏不可见 | ✅ | e2e-smoke 自动断言 |
| 2 | preload bridge 在双 renderer 注入（character `sandbox:false` + overlay `sandbox:true`） | ✅ | `transparent`+`sandbox:true` 冲突的 S1 修正生效 |
| 3 | `sys.ping` 往返 | ✅ | echoNonce 正确 |
| 4 | Zod schema 校验拒绝违约 params | ✅ | RpcError -32602 |
| 5 | 双轨流式（文本 + 表情并行） | ✅ | 见上表 |
| 6 | 取消（协作 + 200ms watchdog 强杀 + 重生） | ✅ | provider-host.test 4 个 cancel 用例 |
| 7 | Worker 崩溃 → inflight 合成 error done → 退避重启 | ✅ | provider-host.test |
| 8 | 崩溃隔离 · character renderer | ✅ | e2e-smoke 自动断言 |
| 9 | 全仓 `pnpm -r typecheck` / `test` / desktop build | ✅ | 49 个测试（protocol 33 + sidecar 9 + desktop 24 中跨包去重后合计）全绿 |
| 10 | VRM 渲染（dev 模式有模型时：加载、idle 眨眼呼吸、8 情绪 400ms 过渡） | ⏳ 待人工复核 | 自动化跑 file:// 产物时模型路径不可达 → fallback 情绪脸路径已验证；VRM 视觉需 `pnpm dev` 人工确认 |
| 11 | alpha 穿透（迟滞、边缘不抖动、高 DPI） | ⏳ 待人工复核 | 迟滞决策逻辑由 hysteresis.test 钉死；真实穿透手感需人工 |
| 12 | 长按 200ms 拖拽（拖拽中冻结穿透） | ⏳ 待人工复核 | S1 验证逻辑原样迁移 |

## 偏差与说明

- **lint**：仓库尚无 lint script（与 CI 现状一致），`pnpm -r lint` 为 no-op。
- **VRM 模型**：`public/models/sample.vrm` 按约定不入库（.gitignore）；无模型环境自动降级 fallback 情绪脸，行为契约（`behavior.*` 订阅）两种形态一致。生产资产管线（`asset://` 协议）属 M4。
- **`--permission` fs jail / fetch 网关 / safeStorage**：按计划留 M5；M1 的 ProviderHost 已带 `env:{}` 隔离。
- **e2e-smoke 的 `waitFor`**：crash 边缘的 `executeJavaScript` 可能永不 settle，探测必须 race 超时（实现内有注释）。M8 升级 Playwright 时保留此教训。
