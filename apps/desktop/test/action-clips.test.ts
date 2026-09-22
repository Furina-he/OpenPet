import { describe, it, expect } from 'vitest';
import {
  ActionClipRegistry,
  applyPoseTo,
  resolveClipEntries,
  type PoseNode,
  type PoseOffsets,
} from '../src/renderer/character/action-clips';
import { ZERO_OFFSETS } from '../src/renderer/character/actions';

const node = (r = { x: 0, y: 0, z: 0 }, p = { x: 0, y: 0, z: 0 }): PoseNode => ({
  rotation: { ...r },
  position: { ...p },
});

describe('⑱ resolveClipEntries', () => {
  it('manifest.actionClips → asset URL；缺省空；base 自动补斜杠', () => {
    expect(resolveClipEntries(undefined, 'asset://miko/')).toEqual([]);
    expect(resolveClipEntries({ wave: 'anim/wave.vrma' }, 'asset://miko')).toEqual([
      { name: 'wave', url: 'asset://miko/anim/wave.vrma' },
    ]);
  });
});

describe('⑱ ActionClipRegistry.loadAll', () => {
  it('命中/未命中分派；加载失败 warn + 跳过，其余照常，永不抛', async () => {
    const reg = new ActionClipRegistry<string>();
    const warns: string[] = [];
    const r = await reg.loadAll(
      [
        { name: 'wave', url: 'ok://wave' },
        { name: 'jump', url: 'bad://jump' },
      ],
      async (url) => {
        if (url.startsWith('bad')) throw new Error('404');
        return `clip:${url}`;
      },
      (m) => warns.push(m),
    );
    expect(r.loaded).toEqual(['wave']);
    expect(r.failed).toEqual(['jump']);
    expect(reg.has('wave')).toBe(true);
    expect(reg.get('wave')).toBe('clip:ok://wave');
    expect(reg.has('jump')).toBe(false); // → 程序化曲线兜底
    expect(warns[0]).toMatch(/jump.*回退/);
    expect(reg.names()).toEqual(['wave']);
  });
});

describe('⑱ applyPoseTo：absolute 赋值 / additive 累加不破坏 mixer 姿态', () => {
  const rest = { armRestZ: 1.15, hipsRestX: 0, hipsRestY: 1 };
  const off: PoseOffsets = { ...ZERO_OFFSETS, headPitch: 0.1, spineYaw: 0.05, hipsY: 0.02, armRaiseL: 0.3 };

  it('absolute：rest + offsets，幂等', () => {
    const t = { head: node({ x: 9, y: 9, z: 9 }), spine: node(), chest: node(), hips: node(), upperArmL: node(), upperArmR: node() };
    applyPoseTo(t, off, 'absolute', rest);
    applyPoseTo(t, off, 'absolute', rest);
    expect(t.head.rotation).toEqual({ x: 0.1, y: 0, z: 0 });
    expect(t.spine.rotation.y).toBeCloseTo(0.05, 9);
    expect(t.hips.position.y).toBeCloseTo(1.02, 9);
    expect(t.upperArmL.rotation.z).toBeCloseTo(1.15 - 0.3, 9);
    expect(t.upperArmR.rotation.z).toBeCloseTo(-1.15, 9);
  });

  it('additive：mixer 写出的旋转 + offsets（数值断言），手臂 rest 不再施加', () => {
    const t = {
      head: node({ x: 0.5, y: -0.2, z: 0.1 }),
      spine: node({ x: 0.3, y: 0, z: 0 }),
      chest: node(),
      hips: node({ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0.9, z: 0 }),
      upperArmL: node({ x: 0, y: 0, z: 0.4 }),
      upperArmR: node({ x: 0, y: 0, z: -0.4 }),
    };
    applyPoseTo(t, off, 'additive', rest);
    expect(t.head.rotation.x).toBeCloseTo(0.6, 9);
    expect(t.head.rotation.y).toBeCloseTo(-0.2, 9);
    expect(t.spine.rotation.x).toBeCloseTo(0.3, 9);
    expect(t.spine.rotation.y).toBeCloseTo(0.05, 9);
    expect(t.hips.position.y).toBeCloseTo(0.92, 9);
    expect(t.hips.position.x).toBeCloseTo(0.01, 9);
    expect(t.upperArmL.rotation.z).toBeCloseTo(0.4 - 0.3, 9);
    expect(t.upperArmR.rotation.z).toBeCloseTo(-0.4, 9);
  });

  it('null 节点安全跳过', () => {
    const t = { head: null, spine: null, chest: null, hips: null, upperArmL: null, upperArmR: null };
    expect(() => applyPoseTo(t, off, 'additive', rest)).not.toThrow();
  });
});
