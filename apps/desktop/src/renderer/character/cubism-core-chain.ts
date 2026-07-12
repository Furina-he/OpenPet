/**
 * Cubism Core 三级加载链（⑪ 发布批次）——纯数据/文案，单测锁契约。
 *
 * 1. `../live2dcubismcore.min.js`：publicDir 拷贝目标（dev 自置 src/renderer/public/；
 *    打包时若 dev 机在场则随 asar 内置）。
 * 2. `asset://cubism/...`：Main 侧保留 host（index.ts registerAssetProtocol），背后
 *    依序找 resources/cubism → userData/cubism（用户自置，专有许可不随包分发）。
 */
export const CUBISM_CORE_CANDIDATES: readonly string[] = [
  '../live2dcubismcore.min.js',
  'asset://cubism/live2dcubismcore.min.js',
];

export function cubismCoreMissingMessage(): string {
  return (
    'Live2D Cubism Core 未安装：从 Live2D 官方 SDK 下载 live2dcubismcore.min.js，' +
    '放入数据目录的 cubism 子目录（Hub → 设置 → 数据 → 打开数据目录，新建 cubism 文件夹）后重启。' +
    '开发环境放 apps/desktop/src/renderer/public/。'
  );
}
