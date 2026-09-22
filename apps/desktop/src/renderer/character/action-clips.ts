/**
 * ⑱ VRMA 动作片段通道（spec §4）的纯逻辑半边：manifest `actionClips` → 待加载表；
 * 逐条加载（loader 注入，失败 warn + 跳过，永不抛）；注册表供 `playAction` 命中分派；
 * 叠加姿态（在 mixer 写出的旋转上累加，而非赋值）。three 依赖只在 runtime.ts。
 */
export interface ClipEntry {
  name: string;
  url: string;
}

/** manifest.actionClips → 绝对 asset URL 列表（assetBase 形如 `asset://<id>/`）。 */
export function resolveClipEntries(
  actionClips: Record<string, string> | undefined,
  assetBase: string,
): ClipEntry[] {
  if (!actionClips) return [];
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  return Object.entries(actionClips).map(([name, rel]) => ({ name, url: base + rel }));
}

export class ActionClipRegistry<Clip> {
  private readonly clips = new Map<string, Clip>();

  has(name: string): boolean {
    return this.clips.has(name);
  }

  get(name: string): Clip | undefined {
    return this.clips.get(name);
  }

  set(name: string, clip: Clip): void {
    this.clips.set(name, clip);
  }

  names(): string[] {
    return [...this.clips.keys()];
  }

  /**
   * 批量加载：每条独立 try/catch——文件缺失/解析错只 warn 并回退程序化曲线，永不崩。
   * 返回 {loaded, failed} 便于日志与测试。
   */
  async loadAll(
    entries: readonly ClipEntry[],
    load: (url: string) => Promise<Clip>,
    warn: (msg: string) => void = (m) => console.warn(m),
  ): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      entries.map(async (e) => {
        try {
          this.clips.set(e.name, await load(e.url));
          loaded.push(e.name);
        } catch (err) {
          failed.push(e.name);
          warn(`[runtime] actionClips "${e.name}" 加载失败，回退程序化曲线：${String(err)}`);
        }
      }),
    );
    return { loaded, failed };
  }
}

/** 最小骨骼节点形状（three Object3D 的子集；测试用假对象）。 */
export interface PoseNode {
  rotation: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
}

export interface PoseTargets {
  head: PoseNode | null;
  spine: PoseNode | null;
  chest: PoseNode | null;
  hips: PoseNode | null;
  upperArmL: PoseNode | null;
  upperArmR: PoseNode | null;
}

export interface PoseOffsets {
  hipsY: number;
  hipsX: number;
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;
  chestPitch: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armRaiseL: number;
  armRaiseR: number;
}

/**
 * 叠加写姿态：
 *   absolute（无片段）：rest + offsets 赋值（幂等，M4 行为）
 *   additive（片段播放中）：在 mixer 已写出的旋转/位移上累加 offsets（底噪/姿态/动作层叠在片段之上）
 * 手臂 rest（ARM_REST_Z）只在 absolute 模式施加——片段本身带完整手臂姿态。
 */
export function applyPoseTo(
  t: PoseTargets,
  o: PoseOffsets,
  mode: 'absolute' | 'additive',
  rest: { armRestZ: number; hipsRestX: number; hipsRestY: number },
): void {
  const add = mode === 'additive';
  if (t.upperArmL) t.upperArmL.rotation.z = add ? t.upperArmL.rotation.z - o.armRaiseL : rest.armRestZ - o.armRaiseL;
  if (t.upperArmR) t.upperArmR.rotation.z = add ? t.upperArmR.rotation.z + o.armRaiseR : -(rest.armRestZ - o.armRaiseR);
  if (t.head) {
    t.head.rotation.x = (add ? t.head.rotation.x : 0) + o.headPitch;
    t.head.rotation.y = (add ? t.head.rotation.y : 0) + o.headYaw;
    t.head.rotation.z = (add ? t.head.rotation.z : 0) + o.headRoll;
  }
  if (t.spine) {
    t.spine.rotation.x = (add ? t.spine.rotation.x : 0) + o.spinePitch;
    t.spine.rotation.y = (add ? t.spine.rotation.y : 0) + o.spineYaw;
    t.spine.rotation.z = (add ? t.spine.rotation.z : 0) + o.spineRoll;
  }
  if (t.chest) t.chest.rotation.x = (add ? t.chest.rotation.x : 0) + o.chestPitch;
  if (t.hips) {
    t.hips.position.y = (add ? t.hips.position.y : rest.hipsRestY) + o.hipsY;
    t.hips.position.x = (add ? t.hips.position.x : rest.hipsRestX) + o.hipsX;
  }
}
