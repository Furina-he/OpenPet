/**
 * 程序化动作库 —— M4 无 VRMA 动画资产，8 个动作（persona DEFAULT_ACTIONS 词表）
 * 全部用参数曲线合成：`sampleAction(name, phase)` 返回骨骼偏移（弧度 / 米）。
 *
 * 不变量：phase=0 与 phase=1 时全零（bump 包络保证）——动作从 idle 无缝起、
 * 无缝收，ActionPlayer 不需要额外的混入/混出逻辑。纯函数可单测。
 */
export interface BoneOffsets {
  /** hips 纵向位移（米，normalized rig）。 */
  hipsY: number;
  spinePitch: number;
  spineYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 手臂抬起量（弧度，叠加在自然下垂 rest pose 上；正值 = 抬起）。 */
  armRaiseL: number;
  armRaiseR: number;
}

export const ZERO_OFFSETS: BoneOffsets = {
  hipsY: 0,
  spinePitch: 0,
  spineYaw: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  armRaiseL: 0,
  armRaiseR: 0,
};

export const ACTION_NAMES = [
  'wave',
  'nod',
  'shake',
  'fidget',
  'stretch',
  'sigh',
  'jump',
  'tilt',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export const ACTION_DEFAULT_MS: Record<ActionName, number> = {
  wave: 1800,
  nod: 900,
  shake: 1000,
  fidget: 2000,
  stretch: 2200,
  sigh: 1800,
  jump: 700,
  tilt: 1400,
};

/** 半正弦包络：两端 0、中点 1。 */
const bump = (t: number): number => Math.sin(Math.PI * t);
const TWO_PI = Math.PI * 2;

const CURVES: Record<ActionName, (t: number) => Partial<BoneOffsets>> = {
  // 点头一次半：pitch 正弦 × 包络（频率避开 0.25/0.5/0.75 的正弦零点）
  nod: (t) => ({ headPitch: 0.3 * Math.sin(TWO_PI * 1.5 * t) * bump(t) }),
  // 摇头两次半
  shake: (t) => ({ headYaw: 0.38 * Math.sin(TWO_PI * 2.5 * t) * bump(t) }),
  // 歪头保持
  tilt: (t) => ({ headRoll: 0.3 * bump(t), headYaw: 0.06 * bump(t) }),
  // 小跳：hips 上抬 + 手臂微张
  jump: (t) => ({ hipsY: 0.06 * bump(t), armRaiseL: 0.25 * bump(t), armRaiseR: 0.25 * bump(t) }),
  // 挥手：右臂抬起 + 高频小摆调制 + 头微歪
  wave: (t) => ({
    armRaiseR: bump(t) * (1.1 + 0.15 * Math.sin(TWO_PI * 3 * t)),
    headRoll: -0.08 * bump(t),
  }),
  // 伸懒腰：双臂高举 + 脊柱后仰 + 微踮
  stretch: (t) => ({
    armRaiseL: 1.3 * bump(t),
    armRaiseR: 1.3 * bump(t),
    spinePitch: -0.12 * bump(t),
    hipsY: 0.015 * bump(t),
  }),
  // 叹气：低头 + 含胸 + 身体下沉
  sigh: (t) => ({ headPitch: 0.2 * bump(t), spinePitch: 0.1 * bump(t), hipsY: -0.012 * bump(t) }),
  // 不安扭动：躯干小幅左右扭 + 头微摆
  fidget: (t) => ({
    spineYaw: 0.09 * Math.sin(TWO_PI * 2 * t) * bump(t),
    headYaw: 0.05 * Math.sin(TWO_PI * 2 * t + 0.7) * bump(t),
    hipsY: -0.004 * bump(t),
  }),
};

export function sampleAction(name: string, phase: number): BoneOffsets {
  const curve = (CURVES as Record<string, (t: number) => Partial<BoneOffsets>>)[name];
  if (!curve || phase <= 0 || phase >= 1) return { ...ZERO_OFFSETS };
  return { ...ZERO_OFFSETS, ...curve(phase) };
}
