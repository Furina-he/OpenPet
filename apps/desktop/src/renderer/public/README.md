# Renderer 静态目录（vite publicDir）

构建时此目录内容原样拷贝到 `out/renderer/` 根；页面（`character/` 等子目录）以
相对路径 `../<文件名>` 引用（dev http 与生产 file:// 均成立）。

## Live2D Cubism Core（必需，不入 git）

Live2D 角色渲染依赖 Cubism Core 运行库（Live2D 专有许可，**禁止提交进仓库**）：

1. 从官方下载：<https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js>
2. 放到本目录：`apps/desktop/src/renderer/public/live2dcubismcore.min.js`

缺失时切换 Live2D 角色会降级为 fallback 情绪脸并在控制台给出本指引（app 不崩）；
VRM 角色不受影响。Cubism 5 Core 向后兼容 Cubism 4 moc3。
