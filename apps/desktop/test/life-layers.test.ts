import { describe, it, expect } from 'vitest';
import {
  Breath,
  BREATH_HZ,
  BREATH_AMP,
  breathParams,
  microNoise,
  MICRO_NOISE_AMP,
  WeightShift,
  WEIGHT_SHIFT,
  nightEnergy,
  asEnergy,
  addOffsets,
  proximityOffsets,
  LifeLayer,
  type LifeContext,
} from '../src/renderer/character/life-layers';
import { ZERO_OFFSETS } from '../src/renderer/character/actions';

const ctx = (over: Partial<LifeContext> = {}): LifeContext => ({
  energy: 'mid',
  mood: 0,
  speaking: false,
  emotion: 'neutral',
  ...over,
});

describe('breathParams', () => {
  it('频率按 energy：low 0.18 / mid 0.25 / high 0.33', () => {
    expect(breathParams(ctx({ energy: 'low' })).hz).toBe(BREATH_HZ.low);
    expect(breathParams(ctx({ energy: 'mid' })).hz).toBe(BREATH_HZ.mid);
    expect(breathParams(ctx({ energy: 'high' })).hz).toBe(BREATH_HZ.high);
  });

  it('sleepy：频率 ×0.7、幅度 ×1.3', () => {
    const p = breathParams(ctx({ emotion: 'sleepy' }));
    expect(p.hz).toBeCloseTo(BREATH_HZ.mid * 0.7, 6);
    expect(p.amp).toBeCloseTo(BREATH_AMP.mid * 1.3, 6);
  });

  it('说话中幅度 ×0.6；低落心情呼吸更慢', () => {
    expect(breathParams(ctx({ speaking: true })).amp).toBeCloseTo(BREATH_AMP.mid * 0.6, 6);
    expect(breathParams(ctx({ mood: -0.8 })).hz).toBeLessThan(BREATH_HZ.mid);
  });
});

describe('Breath 振荡器', () => {
  /** 以 60fps 步进采样到 t（dt 有 200ms 上限：后台节流恢复时防跳相）。 */
  const stepTo = (b: Breath, from: number, to: number, c: LifeContext) => {
    let out = b.sample(from, c);
    for (let t = from + 16; t <= to; t += 16) out = b.sample(t, c);
    return b.sample(to, c) ?? out;
  };

  it('周期 = 1/hz（mid 4s：2s 处过零、1s 处到峰）', () => {
    const b = new Breath();
    expect(stepTo(b, 0, 1000, ctx()).chestPitch).toBeCloseTo(BREATH_AMP.mid, 4); // 1/4 周期 = 峰
    expect(Math.abs(stepTo(b, 1000, 2000, ctx()).chestPitch)).toBeLessThan(1e-4); // 半周期过零
  });

  it('后台节流恢复：单步 dt 封顶 200ms，不跳相', () => {
    const b = new Breath();
    b.sample(0, ctx());
    const jumped = b.sample(5000, ctx()).chestPitch; // 5s 大步长只算 200ms
    expect(Math.abs(jumped)).toBeLessThan(BREATH_AMP.mid * 0.4);
  });

  it('换 energy 不跳相（相位连续累积）', () => {
    const b = new Breath();
    const before = stepTo(b, 0, 1000, ctx()).chestPitch;
    const after = b.sample(1016, ctx({ energy: 'high' })).chestPitch; // 一帧后换档
    expect(Math.abs(after / BREATH_AMP.high - before / BREATH_AMP.mid)).toBeLessThan(0.05);
  });
});

describe('Breath 协同拍', () => {
  it('inhale 叠正向半正弦、exhale 叠负向；结束后回常规', () => {
    const base = new Breath();
    const inh = new Breath();
    const exh = new Breath();
    inh.nudge('inhale', 0);
    exh.nudge('exhale', 0);
    const b = base.sample(0, ctx());
    const i = inh.sample(0, ctx());
    const e = exh.sample(0, ctx());
    expect(i.chestPitch).toBeCloseTo(b.chestPitch, 9); // t=0 半正弦为 0
    const b2 = base.sample(175, ctx());
    expect(inh.sample(175, ctx()).chestPitch).toBeGreaterThan(b2.chestPitch);
    expect(exh.sample(175, ctx()).chestPitch).toBeLessThan(b2.chestPitch);
    expect(e.chestPitch).toBeCloseTo(b.chestPitch, 9);
    base.sample(2000, ctx());
    inh.sample(2000, ctx());
    expect(inh.sample(2016, ctx()).chestPitch).toBeCloseTo(base.sample(2016, ctx()).chestPitch, 9);
  });
});

describe('microNoise', () => {
  it('幅度上限：全时段扫描不超过表值；high ×1.4', () => {
    let maxYaw = 0;
    let maxRoll = 0;
    let maxSpine = 0;
    for (let t = 0; t < 120_000; t += 50) {
      const n = microNoise(t, 'mid');
      maxYaw = Math.max(maxYaw, Math.abs(n.headYaw));
      maxRoll = Math.max(maxRoll, Math.abs(n.headRoll));
      maxSpine = Math.max(maxSpine, Math.abs(n.spineYaw));
    }
    expect(maxYaw).toBeLessThanOrEqual(MICRO_NOISE_AMP.headYaw + 1e-9);
    expect(maxRoll).toBeLessThanOrEqual(MICRO_NOISE_AMP.headRoll + 1e-9);
    expect(maxSpine).toBeLessThanOrEqual(MICRO_NOISE_AMP.spineYaw + 1e-9);
    expect(maxYaw).toBeGreaterThan(MICRO_NOISE_AMP.headYaw * 0.5); // 确实在动
    expect(microNoise(1234, 'high').headYaw).toBeCloseTo(microNoise(1234, 'mid').headYaw * 1.4, 9);
  });
});

describe('WeightShift', () => {
  it('首次转移落在 8–20s 内；0.8s 缓动到位后保持', () => {
    const rands = [0, 0.9, 0]; // gap=min → 8s；side=+1；下一 gap=min
    let i = 0;
    const ws = new WeightShift(0, () => rands[i++ % rands.length]!);
    expect(ws.sample(7999)).toEqual({ hipsX: 0, spineRoll: -0 });
    expect(ws.sample(8000).hipsX).toBe(0); // 转移起点
    const mid = ws.sample(8000 + WEIGHT_SHIFT.easeMs / 2);
    expect(mid.hipsX).toBeCloseTo(WEIGHT_SHIFT.hipsX / 2, 6);
    expect(mid.spineRoll).toBeCloseTo(-WEIGHT_SHIFT.spineRoll / 2, 6);
    const done = ws.sample(8000 + WEIGHT_SHIFT.easeMs);
    expect(done.hipsX).toBeCloseTo(WEIGHT_SHIFT.hipsX, 6);
    expect(ws.sample(12_000).hipsX).toBeCloseTo(WEIGHT_SHIFT.hipsX, 6); // 保持
  });

  it('间隔随机落在 [min, max]', () => {
    const ws = new WeightShift(0, () => 0.999);
    expect(Math.abs(ws.sample(WEIGHT_SHIFT.maxGapMs - 1).hipsX)).toBe(0);
    ws.sample(WEIGHT_SHIFT.maxGapMs + WEIGHT_SHIFT.easeMs);
    expect(Math.abs(ws.sample(WEIGHT_SHIFT.maxGapMs + WEIGHT_SHIFT.easeMs).hipsX)).toBeGreaterThan(0);
  });
});

describe('nightEnergy / asEnergy / addOffsets', () => {
  it('23–06 降一档，白天不变', () => {
    expect(nightEnergy(23, 'high')).toBe('mid');
    expect(nightEnergy(2, 'mid')).toBe('low');
    expect(nightEnergy(5, 'low')).toBe('low');
    expect(nightEnergy(12, 'high')).toBe('high');
    expect(nightEnergy(6, 'high')).toBe('high');
  });

  it('asEnergy 未知值回 mid', () => {
    expect(asEnergy('bogus')).toBe('mid');
    expect(asEnergy('low')).toBe('low');
  });

  it('proximityOffsets：光标在右 → 绕 Y 负转（与 lookAt 同向），k 线性缩放，nx=0 不转', () => {
    expect(proximityOffsets(0.5, 1)).toEqual({ spineYaw: -0.03, headYaw: -0.05 });
    expect(proximityOffsets(-0.5, 0.5)).toEqual({ spineYaw: 0.015, headYaw: 0.025 });
    expect(proximityOffsets(0, 1)).toEqual({ spineYaw: 0, headYaw: 0 });
  });

  it('addOffsets 逐通道相加且补齐全部键', () => {
    const o = addOffsets({ headYaw: 0.1 }, { headYaw: 0.2, hipsX: 0.01 });
    expect(o.headYaw).toBeCloseTo(0.3, 9);
    expect(o.hipsX).toBe(0.01);
    expect(Object.keys(o).sort()).toEqual(Object.keys(ZERO_OFFSETS).sort());
  });
});

describe('LifeLayer 合成', () => {
  it('永不为零：任意时刻至少一个通道非零', () => {
    const life = new LifeLayer(0, () => 0.5);
    let allZero = 0;
    for (let t = 100; t < 30_000; t += 333) {
      const o = life.sample(t, ctx());
      if (Object.values(o).every((v) => Math.abs(v) < 1e-9)) allZero += 1;
    }
    expect(allZero).toBe(0);
  });
});
