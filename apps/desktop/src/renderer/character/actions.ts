/**
 * 程序化动作库 —— M4 无 VRMA 动画资产，8 个动作（persona DEFAULT_ACTIONS 词表）
 * 全部用参数曲线合成：`sampleAction(name, phase)` 返回骨骼偏移（弧度 / 米）。
 *
 * 不变量：phase=0 与 phase=1 时全零（bump 包络保证）——动作从 idle 无缝起、
 * 无缝收，ActionPlayer 不需要额外的混入/混出逻辑。纯函数可单测。
 *
 * ⑱ 三段包络 `sampleActionEnvelope(name, tMs, durMs)`：预备（大动作前 120ms 反向 15%）→
 * 主体（现有曲线）→ 余震（300ms，与拖拽回归同源的阻尼振荡一次过冲 12%），
 * 不变量改为 t=0 与 t=durMs+TAIL_MS 两端零。协同表 ACTION_COMPANIONS 让动作层向
 * 视线/眨眼/嘴/呼吸/姿态发"伴随指令"（点头压视线、叹气半合眼…）。
 */
import { settleFromZero } from './settle';
export interface BoneOffsets {
  /** hips 纵向位移（米，normalized rig）。 */
  hipsY: number;
  /** ⑱ hips 横向位移（重心转移，米）。 */
  hipsX: number;
  spinePitch: number;
  spineYaw: number;
  /** ⑱ 脊柱侧倾（重心转移配合）。 */
  spineRoll: number;
  /** ⑱ 胸腔俯仰（呼吸）。 */
  chestPitch: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 手臂抬起量（弧度，叠加在自然下垂 rest pose 上；正值 = 抬起）。 */
  armRaiseL: number;
  armRaiseR: number;
}

export const ZERO_OFFSETS: BoneOffsets = {
  hipsY: 0,
  hipsX: 0,
  spinePitch: 0,
  spineYaw: 0,
  spineRoll: 0,
  chestPitch: 0,
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
  // 系统 cue 专用（F-IT T6）：不进 persona DEFAULT_ACTIONS，不给 LLM。
  'searching',
  'nuzzle',
  'droop',
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
  searching: 2400,
  nuzzle: 1200,
  droop: 2000,
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
  // 张望搜寻：头缓慢左右扫视两个来回
  searching: (t) => ({ headYaw: 0.3 * Math.sin(TWO_PI * 1 * t) * bump(t), headPitch: 0.05 * bump(t) }),
  // 蹭（被摸头回应）：头小幅快摆 + 微低头贴近
  nuzzle: (t) => ({ headRoll: 0.18 * Math.sin(TWO_PI * 3 * t) * bump(t), headPitch: 0.12 * bump(t) }),
  // 蔫/沮丧：头肩下垂保持
  droop: (t) => ({ headPitch: 0.32 * bump(t), spinePitch: 0.14 * bump(t), hipsY: -0.015 * bump(t) }),
};

export function sampleAction(name: string, phase: number): BoneOffsets {
  const curve = (CURVES as Record<string, (t: number) => Partial<BoneOffsets>>)[name];
  if (!curve || phase <= 0 || phase >= 1) return { ...ZERO_OFFSETS };
  return { ...ZERO_OFFSETS, ...curve(phase) };
}

// ---- ⑱ 三段包络 ----
/** 预备段：只有"大动作"有反向预备。 */
export const PREP_ACTIONS: ReadonlySet<string> = new Set(['jump', 'wave', 'stretch']);
export const PREP_MS = 120;
export const PREP_RATIO = 0.15;
export const TAIL_MS = 300;
export const TAIL_OVERSHOOT = 0.12;
/** 幅度三档（防"抽搐"）：显式 playAction 1 / idle 变体 ≤0.7 / 节拍手势 ≤0.3。 */
export const ACTION_SCALE = { explicit: 1, idle: 0.7, beat: 0.3 } as const;

const KEYS = Object.keys(ZERO_OFFSETS) as Array<keyof BoneOffsets>;
const scaleOffsets = (o: BoneOffsets, k: number): BoneOffsets => {
  const out = { ...o };
  for (const key of KEYS) out[key] = o[key] * k;
  return out;
};

/** 动作总时长（含预备与余震）。 */
export function actionTotalMs(name: string, durMs: number): number {
  return (PREP_ACTIONS.has(name) ? PREP_MS : 0) + durMs + TAIL_MS;
}

/**
 * 三段包络采样：tMs ∈ [0, actionTotalMs]。
 *   预备 [0, PREP_MS)：主体中点姿态的反向 15% × 半正弦
 *   主体 [PREP_MS, PREP_MS+durMs)：现有曲线
 *   余震 [.., +TAIL_MS)：主体尾段姿态反向 12% × 从零起的阻尼振荡（与拖拽回归同源），线性淡出到零
 */
export function sampleActionEnvelope(name: string, tMs: number, durMs: number): BoneOffsets {
  const prep = PREP_ACTIONS.has(name) ? PREP_MS : 0;
  const total = prep + durMs + TAIL_MS;
  if (tMs <= 0 || tMs >= total) return { ...ZERO_OFFSETS };
  if (tMs < prep) {
    const k = -PREP_RATIO * Math.sin((Math.PI * tMs) / prep);
    return scaleOffsets(sampleAction(name, 0.5), k);
  }
  const tMain = tMs - prep;
  if (tMain < durMs) return sampleAction(name, tMain / durMs);
  const tTail = tMain - durMs;
  const ref = sampleAction(name, 0.85); // 收尾前的姿态方向
  const k = -TAIL_OVERSHOOT * settleFromZero(tTail) * (1 - tTail / TAIL_MS);
  return scaleOffsets(ref, k);
}

// ---- ⑱ 协同表：动作 → 视线/眨眼/嘴/呼吸/姿态伴随指令 ----
export interface ActionCompanion {
  gaze?: 'down' | 'user' | 'scanLR' | 'suppressWander';
  /** gaze 指令时长（缺省 = 动作时长）。 */
  gazeMs?: number;
  blink?: 'blink' | 'eyesHalf' | 'eyesClosed';
  blinkLevel?: number;
  /** 嘴微张（aa 权重），持续动作时长。 */
  mouth?: number;
  breath?: 'inhale' | 'exhale';
  /** 动作期间临时姿态（结束后回情绪姿态）。 */
  posture?: string;
}

export const ACTION_COMPANIONS: Partial<Record<ActionName, ActionCompanion>> = {
  nod: { gaze: 'down', blink: 'blink' },
  sigh: { blink: 'eyesHalf', blinkLevel: 0.5, mouth: 0.15, breath: 'exhale' },
  jump: { breath: 'inhale', blink: 'blink' },
  wave: { gaze: 'user' },
  stretch: { blink: 'eyesClosed', mouth: 0.2 },
  tilt: { gaze: 'suppressWander', gazeMs: 2000 },
  searching: { gaze: 'scanLR' },
  droop: { posture: 'sad' },
};
