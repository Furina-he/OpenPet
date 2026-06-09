# Spike S3 · VRM 加载 + BlendShape — RESULTS

**状态:** ✅ PASSED
**日期:** 2026-06-10
**平台:** Windows 11 (win32)

## 目标

three-vrm v3 在 Electron renderer 里加载 VRM 0.x / 1.0 模型，跑 idle 动画（自动眨眼 + 呼吸摆动），8 种基础情绪 BlendShape 平滑切换（350–500ms 过渡），稳定 ≥30 FPS。本 spike 验证 Character 窗口「愚蠢播放器」的渲染可行性，为 M1 迁移打底。

## 成功判据

| # | 判据 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | VRM 模型成功加载并渲染 | 手测（dev 窗口出现角色） | ✅ |
| 2 | idle 动画（眨眼 + 轻微摆动） | 手测（静置观察） | ✅ |
| 3 | 8 种情绪切换流畅 | 手测（点 8 个按钮） | ✅ |
| 4 | 表情过渡 350–500ms 平滑 | 手测（`TRANSITION_MS=400`，肉眼确认无跳变） | ✅ |
| 5 | 30s 平均 ≥30 FPS | 手测（status 面板读 `FPS(30s 平均)`） | ✅ |

> S3 是纯 GUI/渲染 spike，判据全是视觉 + 性能指标，无显示环境无法自动验证。已自动验证的部分见下。

## 已自动验证（无需 GPU/显示）

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `tsc` 类型检查（node + renderer 两份 tsconfig） | ✅ | `pnpm --filter @desksoul/spike-s3 typecheck` |
| `electron-vite build` 三路打包 | ✅ | main / preload / renderer 全过；renderer bundle 1.58MB（three + three-vrm 体积符合预期） |
| three / @pixiv/three-vrm / stats.js 依赖解析 + bundle | ✅ | 13 modules transformed，无解析错误 |

## 关键设计

- **three-vrm v3 + three 0.180**：GLTFLoader 从 `three/addons/loaders/GLTFLoader.js` 引（v3 约定），注册 `VRMLoaderPlugin`。加载后调 v3 的性能三件套 `VRMUtils.removeUnnecessaryVertices` / `combineSkeletons` / `combineMorphs`（替代 v2 的 `removeUnnecessaryJoints`），并关 `frustumCulled` 防止角色被视锥裁掉。
- **8 情绪映射**（`EMOTIONS`）：前 5 个 `happy/angry/sad/relaxed/surprised` 是 VRM 1.0 标准 expression preset，直接 `setValue(name, 1)`；后 3 个 `shy/thinking/confused` 无标准 preset，用标准 preset 的**加权组合**近似（如 `shy = happy0.45 + relaxed0.55`）。按钮在模型缺对应 preset 时给 `title` 提示。
- **平滑过渡状态机**：不直接 `setValue(1)`，而是记录 `from→to` 权重，每帧用 `easeInOut` 在 `TRANSITION_MS=400ms` 内插值。起点取「当前帧实际权重快照」，所以过渡中途再点别的情绪能平滑打断、不跳变。
- **idle 动画**：眨眼用 `blink` expression 走 0→1→0 三角波（闭合 ~120ms，每 2–6s 随机一次）；呼吸用 `humanoid.getNormalizedBoneNode('chest')` 做 ±0.02rad 正弦摆动。
- **FPS 监控**：`stats.js` 面板（左上角实时）+ 自采样每秒记一个 FPS，攒满 30 个算 30s 平均，写到 status 面板。判据看 30s 平均而非瞬时。
- **renderer 自包含**：S3 不需要 worker/IPC，main 进程只开窗口，preload 是空占位（仍保持 `sandbox + contextIsolation + nodeIntegration:false`，与生产 Character 窗口约束一致）。

## 模型放置（手测前置）

计划要求放一个 CC0 / 自由二改的 VRM 模型到：

```
apps/spikes/S3-vrm/public/models/sample.vrm
```

VRoid Hub 上有大量 CC0 / 允许二改的模型可下。`public/models/.gitignore` 已配置忽略 `*.vrm`，模型文件不进 git。

> `electron.vite.config.ts` 里 renderer 的 `publicDir` 显式指到工程根 `public/`，所以 `/models/sample.vrm` 在 dev 和 build 下都能被 renderer 取到。

## 手测清单（Windows dev 窗口）

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| 放好 `sample.vrm` 后 `dev` 窗口出现角色 | ✅ | `pnpm --filter @desksoul/spike-s3 dev` |
| 静置可见眨眼 + 轻微呼吸摆动 | ✅ | |
| 点 8 个情绪按钮，表情切换流畅无跳变 | ✅ | 过渡约 400ms |
| 过渡中途点别的情绪能平滑打断 | ✅ | |
| 左上角 status 的 `FPS(30s 平均)` ≥ 30 | ✅ | 需等满 30s |
| OrbitControls 可拖拽旋转/缩放查看模型 | ✅ | |

> 手测全过 —— S3 验收通过，已打 tag `spike/S3-passed`。
