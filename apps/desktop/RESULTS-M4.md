# M4 渲染层 CharacterRuntime — RESULTS

**状态:** ✅ PASSED
**日期:** 2026-06-12
**平台:** Windows 11 (win32)，165Hz 显示器

## 验收映射（impl-plan M4）

| 验收项 | 口径 | 结果 |
| --- | --- | --- |
| D4 缩放 50–200% 不掉帧（≥30 FPS） | 自动（`test/m4-fps-probe.mjs`：三档各 32s 读 30s 滚动平均） | ✅ 50%=165.0 / 100%=165.0 / 200%=164.6（满 165Hz 刷新率） |
| 8 种基础 emotion 切换流畅 | 自动（e2e 行为通道驱动）+ 截图核对（happy/sleepy）+ 400ms 缓动沿用 S3 实测参数 | ✅ manifest 8 情绪（含新增 curious/sleepy 组合）全部可消费 |
| 内置 1 个角色包能完整加载 | 自动（probe 截图：模型正面、全纹理、手臂自然下垂；asset://default/model.vrm 200） | ✅ `characters/default/`（manifest 入 git，model.vrm 本地） |
| 资产越级 404 / manifest 校验 | 自动（asset-protocol 6 用例 + character-service 6 用例 + e2e M4-2） | ✅ 越级 fetch 被拒、合法 200；三层防御（URL 规范化/段检查/前缀校验） |
| LookAt 30Hz 节流 + 平滑插值 | 自动（cursor-publisher 5 用例 + lookat 8 用例 + e2e M4-3） | ✅ 30Hz 轮询/变化去重/2s keepalive；指数阻尼帧率无关 |
| Idle 池 + intent 子集 + 90s 主动行为 | 自动（idle-pool 7 + idle-watch 6 + idle-responder 3 用例 + e2e M4-5 回路） | ✅ idleTimeout → Main 决策 stub → playAction 端到端 |
| 性能预算监控 | 自动（perf-budget 6 + fps-meter 4 用例 + probe 实测） | ✅ 32,847 三角面（预算内）；纹理估算 320MB **超 64MB 预算 → 告警正确触发** |

e2e 双形态：VRM 模式与 fallback 模式（移除 model.vrm）均 PASS（M4 断言不依赖渲染形态）。

## 执行中发现并修复的问题

1. **VRM 0.x 模型背对相机**——S3/M1 的 vrm-stage 从未调 `VRMUtils.rotateVRM0`（spike 有 OrbitControls 掩盖）。probe 截图实证后修复。
2. **CSP 拦截内嵌纹理（白模根因）**——GLB 纹理经 blob: URL fetch，`connect-src` 未放行 `data:/blob:`。
3. **MToon 纹理测量为 0**——VRM 的 MToonMaterial 纹理在 `ShaderMaterial.uniforms` 而非自有属性；并需按 image 身份去重（Texture 包装共享像素源，1.12GB → 320MB）。
4. **cursor-publisher 丢首拍**——renderer 崩溃自愈/启动慢会错过仅首拍发送的快照；加 2s keepalive 重发。
5. **e2e 动态 import 输给 app ready**——`registerSchemesAsPrivileged` 必须 ready 前调用；smoke 改静态 import 与生产同时序。

## 实测数据（test/m4-fps-probe.mjs，截图在 test/m4-captures/）

- 三角面：32,847（预算 80,000 内）
- 纹理估算：336,069,120 bytes RGBA8（**超 64MB 预算**——VRoid 默认导出未优化，属真实告警；M9 打包/角色包规范时处理模型优化，预算语义为告警不拒载）
- FPS（30s 滚动平均）：50% / 100% / 200% 三档均 ≈165（显示器刷新率上限）

## 已知限制（按设计延后）

- `setLipsync` stub（V1+）；`behavior.actionDone` 未上（无消费者）；Live2D 引擎 V1+。
- LookAt 开关/强度、D4 设置 UI → M7；主动行为「说话」决策 → M6+；90s 时长可配置 → M6+。
- 打包态 extraResources 实测 → M9；内置模型纹理超预算的优化 → M9。
- `window.__charDebug` 是 debug 表面（e2e/手测），不属于 desksoul 协议。
