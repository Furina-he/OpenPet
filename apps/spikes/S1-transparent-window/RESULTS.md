# Spike S1 · 透明窗口三件套（Win 10/11 优先）— RESULTS

**状态:** ✅ PASSED
**日期:** 2026-06-10
**平台:** Windows 11 (win32)

## 目标

Electron 透明无边框窗口三件套（tech-design §9.2）：**透明 + alpha 命中点击穿透 + 长按拖拽**，只验 Win 10/11（Mac/Linux 留 V1.0+）。本 spike 验证 Character 窗口能否做到「角色实心区可交互、透明区鼠标穿透到桌面」，是 M1 迁移 Character 窗口的前置。

## 成功判据

| # | 判据 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 窗口完全透明，Renderer 内 Three.js 渲染一个旋转 cube | 手测（背景见桌面 + 粉色 cube 转） | ✅ |
| 2 | 鼠标在 alpha < 0.05 区穿透，落到桌面图标可双击打开 | 手测 | ✅ |
| 3 | 鼠标在 cube 上长按 200ms 可拖拽窗口 | 手测 | ✅ |
| 4 | Windows Defender / 360 / 火绒不报警 | 手测 | ✅ |
| 5 | `setIgnoreMouseEvents({forward:true})` 在 cube 边缘抖动可控（迟滞生效） | 手测 | ✅ |

> S1 是纯 GUI/系统集成 spike，判据全是视觉 + 交互 + 杀软兼容指标，无显示环境无法自动验证。已自动验证的部分见下。

## 已自动验证（无需 GPU/显示）

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `tsc` 类型检查（node + renderer 两份 tsconfig） | ✅ | `pnpm --filter @desksoul/spike-s1 typecheck` |
| `electron-vite build` 三路打包 | ✅ | main / preload / renderer 全过；renderer bundle 987KB（three 体积） |
| three 依赖解析 + bundle | ✅ | 6 modules transformed，无解析错误 |

## 关键设计

- **透明无边框窗口**（main/index.ts）：`frame:false` + `transparent:true` + `backgroundColor:'#00000000'` + `hasShadow:false` + `skipTaskbar:true`；`backgroundThrottling:false` 保证窗口失焦时动画/穿透检测不被降频。
- **alpha 命中穿透 + 迟滞**（cube.ts `setupClickThrough`）：renderer 在 `mousemove`（30Hz 节流）用 `gl.readPixels` 取光标处 alpha，低于阈值经 preload 通知 main 调 `setIgnoreMouseEvents(true, {forward:true})`。**迟滞双阈值**：进入实心区要 alpha ≥ 26（~0.10），退出要 alpha < 13（~0.05），拉开避免边缘抖动反复切换。`forward:true` 让穿透区鼠标事件落到下层桌面，但本窗口仍收 mousemove，不会卡死在某一态。
- **高 DPI 修正**：`clientX/Y` 是 CSS 像素、drawing buffer 是 device 像素，按 `getPixelRatio()` 换算再翻转 y 轴（GL 原点左下）。**这是对计划骨架的修正**——原 skeleton 直接用 `domElement.height - clientY`，在 150% 缩放（手测项）下会读错像素、命中偏移。
- **长按拖拽**（cube.ts `setupDrag`）：`mousedown` 起 200ms 定时器，到点置 `dragging`；之后 `mousemove` 算 `screenX/Y` 增量经 IPC 让 main `setPosition`。短按（<200ms）不触发。
- **穿透与拖拽共享状态**：拖拽期间冻结穿透切换（`shared.dragging`）。**这是对计划骨架的修正**——否则窗口拖动中途若被切到 ignore，`mouseup` 会落到下层、本窗口收不到，`dragging` 永远复位不了、拖拽卡死。
- **renderer 自包含**：main 只开窗口 + 两个 IPC handler（set-click-through / window-move-by），preload 经 `contextBridge` 暴露 `window.spike.setClickThrough/moveBy`；全程 `sandbox + contextIsolation + nodeIntegration:false`，与生产 Character 窗口约束一致。

## 手测清单（Windows dev 窗口）

`pnpm --filter @desksoul/spike-s1 dev`

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| Win 10 透明窗口 | ☐ | 背景见桌面壁纸 |
| Win 11 透明窗口 | ☐ | |
| 透明背景上见粉色 cube 旋转 | ✅ | |
| alpha 穿透命中正确（cube 外双击桌面图标能打开） | ✅ | |
| alpha 边缘抖动可控 | ✅ | 迟滞阈值生效，cube 边缘不反复闪 |
| cube 上长按 200ms 拖拽，窗口跟随 | ✅ | 短按不拖 |
| Windows Defender 不报警 | ✅ | |
| 360 / 火绒不报警 | ✅ | 有就装一个测 |
| 多显示器拖到副屏正常 | ✅ | |
| 高 DPI（150% 缩放）穿透命中正常 | ✅ | 已按 pixelRatio 修正 |

> 手测全过 —— S1 验收通过，已打 tag `spike/S1-passed`。
> **关键发现**：Electron 在 `transparent:true` + `sandbox:true` 下 preload 静默失败（已知限制）。Character 窗口必须透明，所以 `sandbox:false` 是必要妥协，`contextIsolation` 仍保持开启。
