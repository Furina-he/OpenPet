/**
 * 拖拽物理共享态（F-IT-04）：interaction.ts 在每次 moveBy 时写入平滑速度，
 * runtime.ts 帧循环读取并叠加 BoneOffsets。同 bundle 模块单例，无需事件。
 */
export const dragState = {
  active: false,
  /** 窗口位移速度（px/ms，指数平滑）。 */
  vx: 0,
  vy: 0,
};
