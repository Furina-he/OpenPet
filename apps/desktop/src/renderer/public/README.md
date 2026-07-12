# Renderer 静态目录（vite publicDir）

构建时此目录内容原样拷贝到 `out/renderer/` 根；页面（`character/` 等子目录）以
相对路径 `../<文件名>` 引用（dev http 与生产 file:// 均成立）。

## Live2D Cubism Core（必需，不入 git）

Live2D 角色渲染依赖 Cubism Core 运行库（Live2D 专有许可，**禁止提交进仓库**、
不随安装包分发）。运行时按三级链查找（`character/cubism-core-chain.ts`）：

1. 本目录（dev 自置 / 打包时若 dev 机在场则随 asar 内置）：
   从官方下载 <https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js>
   放到 `apps/desktop/src/renderer/public/live2dcubismcore.min.js`
2. 安装目录 `resources/cubism/`（asset://cubism 保留 host 第一根）
3. 用户数据目录 `%APPDATA%/openpet/cubism/`（打包版用户自置推荐位；
   Hub → 设置 → 数据 → 打开数据目录，新建 `cubism` 文件夹放入）

缺失时切换 Live2D 角色会降级为 fallback 情绪脸并在控制台给出指引（app 不崩）；
VRM 角色不受影响。Cubism 5 Core 向后兼容 Cubism 4 moc3。
