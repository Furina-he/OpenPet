# M8c · 系统集成（J1 托盘 + J2 热键录制器 + J5 崩溃上报）

> WHAT → [`spec.md`](spec.md)；HOW → [`plans/`](plans/)；交付 → `RESULTS.md`（收尾建）；状态 → [`../../status/CURRENT.md`](../../status/CURRENT.md)。

OS 级集成，把"显示/聊天/穿透/设置"收口为正式入口。**M8 三拆之三**（M8a→M8b→**M8c**），收尾即 M8 整体收口。**前置：M8a B1 + M8b A1 已落**。

| 阶段 | plan | 内容 | 状态 |
| --- | --- | --- | --- |
| P1 | [p1-j2-hotkey-system](plans/p1-j2-hotkey-system.md) | J2 热键注册系统（prefs.hotkeys + Main 注册替换硬编码 + accelerator 校验/冲突） | 📋 计划就绪 |
| P2 | [p2-j1-tray](plans/p2-j1-tray.md) | J1 托盘（Tray + 原生菜单 + 三态图标 + 鼠标动作） | 📋 计划就绪 |
| P3 | [p3-j2-recorder-ui](plans/p3-j2-recorder-ui.md) | J2 录制器 UI（KeyCap + D2 热键页 + 冲突 + 一键恢复 + 重注册） | 📋 计划就绪 |
| P4 | [p4-j5-crash-results](plans/p4-j5-crash-results.md) | J5 脱敏 payload + 生成 .dsdiag（接 D8）+ 崩溃钩子 + 视觉 + RESULTS | 📋 计划就绪 |

## 视觉真源
J1/J2/J5 = `UI/6a38a202-….png`。J2 总览在 Hub「系统→热键」页。

## 已知残留方向（详见各 plan + spec §1 OUT）
托盘图标占位件（真件待替）；J5 完整对话框 UI + 真实上报端点（M9，本期仅本地 .dsdiag）；热键多平台重注册真机验证。
