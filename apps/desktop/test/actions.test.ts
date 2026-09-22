import { describe, it, expect } from 'vitest';
import {
  ACTION_NAMES,
  ACTION_DEFAULT_MS,
  ACTION_COMPANIONS,
  ACTION_SCALE,
  PREP_ACTIONS,
  PREP_MS,
  TAIL_MS,
  TAIL_OVERSHOOT,
  actionTotalMs,
  sampleAction,
  sampleActionEnvelope,
  ZERO_OFFSETS,
  type BoneOffsets,
} from '../src/renderer/character/actions';
import { settle, settleFromZero } from '../src/renderer/character/settle';

const KEYS = Object.keys(ZERO_OFFSETS) as Array<keyof BoneOffsets>;
const maxAbs = (o: BoneOffsets): number => Math.max(...KEYS.map((k) => Math.abs(o[k])));

describe('actions', () => {
  it('covers persona DEFAULT_ACTIONS + 系统 cue 专用词（searching/nuzzle/droop，F-IT T6）', () => {
    expect([...ACTION_NAMES].sort()).toEqual(
      [
        'fidget',
        'jump',
        'nod',
        'shake',
        'sigh',
        'stretch',
        'tilt',
        'wave',
        'searching',
        'nuzzle',
        'droop',
      ].sort(),
    );
  });

  it('every action has a positive default duration', () => {
    for (const name of ACTION_NAMES) {
      expect(ACTION_DEFAULT_MS[name]).toBeGreaterThan(0);
    }
  });

  it.each([...ACTION_NAMES])('%s starts and ends at rest (blends with idle)', (name) => {
    expect(maxAbs(sampleAction(name, 0))).toBeLessThan(1e-9);
    expect(maxAbs(sampleAction(name, 1))).toBeLessThan(1e-9);
  });

  it.each([...ACTION_NAMES])('%s is visibly non-zero mid-way', (name) => {
    const peak = Math.max(
      maxAbs(sampleAction(name, 0.25)),
      maxAbs(sampleAction(name, 0.5)),
      maxAbs(sampleAction(name, 0.75)),
    );
    expect(peak).toBeGreaterThan(0.02);
  });

  it('clamps phase outside [0,1] to rest', () => {
    expect(maxAbs(sampleAction('nod', -0.5))).toBeLessThan(1e-9);
    expect(maxAbs(sampleAction('nod', 1.5))).toBeLessThan(1e-9);
  });

  it('unknown action name samples to rest (caller warns, renderer must not crash)', () => {
    expect(maxAbs(sampleAction('bogus', 0.5))).toBeLessThan(1e-9);
  });

  it('nod moves pitch, shake moves yaw, tilt moves roll (语义对得上)', () => {
    expect(Math.abs(sampleAction('nod', 0.25).headPitch)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('shake', 0.25).headYaw)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('tilt', 0.5).headRoll)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('jump', 0.5).hipsY)).toBeGreaterThan(0.01);
    expect(sampleAction('wave', 0.5).armRaiseR).toBeGreaterThan(0.3);
    expect(sampleAction('stretch', 0.5).armRaiseL).toBeGreaterThan(0.3);
  });

  it('searching 扫视 yaw、nuzzle 蹭 roll、droop 垂头 pitch（新曲线语义，F-IT T6）', () => {
    expect(Math.abs(sampleAction('searching', 0.25).headYaw)).toBeGreaterThan(0.1);
    expect(Math.abs(sampleAction('nuzzle', 0.25).headRoll)).toBeGreaterThan(0.05);
    expect(sampleAction('droop', 0.5).headPitch).toBeGreaterThan(0.2);
    expect(sampleAction('droop', 0.5).spinePitch).toBeGreaterThan(0.05);
  });
});

describe('⑱ 三段包络 sampleActionEnvelope', () => {
  it.each([...ACTION_NAMES])('%s：t=0 与 t=total 两端零', (name) => {
    const dur = ACTION_DEFAULT_MS[name];
    expect(maxAbs(sampleActionEnvelope(name, 0, dur))).toBeLessThan(1e-9);
    expect(maxAbs(sampleActionEnvelope(name, actionTotalMs(name, dur), dur))).toBeLessThan(1e-9);
    expect(maxAbs(sampleActionEnvelope(name, -1, dur))).toBeLessThan(1e-9);
  });

  it('预备段：大动作（jump/wave/stretch）前 120ms 反向 15%；其余无预备', () => {
    expect([...PREP_ACTIONS].sort()).toEqual(['jump', 'stretch', 'wave']);
    const dur = ACTION_DEFAULT_MS.jump;
    const prep = sampleActionEnvelope('jump', PREP_MS / 2, dur);
    const mid = sampleAction('jump', 0.5);
    expect(Math.sign(prep.hipsY)).toBe(-Math.sign(mid.hipsY));
    expect(Math.abs(prep.hipsY)).toBeCloseTo(0.15 * Math.abs(mid.hipsY), 9);
    expect(actionTotalMs('jump', dur)).toBe(PREP_MS + dur + TAIL_MS);
    expect(actionTotalMs('nod', 900)).toBe(900 + TAIL_MS);
    // 主体从 PREP_MS 起：nod 无预备，t=dur/2 即曲线中点
    expect(sampleActionEnvelope('nod', 450, 900)).toEqual(sampleAction('nod', 0.5));
    expect(sampleActionEnvelope('jump', PREP_MS + dur / 2, dur)).toEqual(sampleAction('jump', 0.5));
  });

  it('余震：主体结束后一次过冲（方向与收尾前相反，幅度 ≤12%）后收敛', () => {
    const dur = ACTION_DEFAULT_MS.nod;
    const ref = sampleAction('nod', 0.85).headPitch;
    let peak = 0;
    let signFlips = 0;
    let last = 0;
    for (let t = 1; t < TAIL_MS; t += 5) {
      const v = sampleActionEnvelope('nod', dur + t, dur).headPitch;
      peak = Math.max(peak, Math.abs(v));
      if (last !== 0 && Math.sign(v) !== Math.sign(last)) signFlips += 1;
      last = v;
    }
    expect(peak).toBeLessThanOrEqual(TAIL_OVERSHOOT * Math.abs(ref) + 1e-9);
    expect(peak).toBeGreaterThan(0.05 * Math.abs(ref));
    expect(Math.sign(sampleActionEnvelope('nod', dur + 60, dur).headPitch)).toBe(-Math.sign(ref));
    expect(signFlips).toBeLessThanOrEqual(1); // 一次过冲
  });

  it('settle 与拖拽回归同源：t=0 为 1、0.4s 衰至 ~5%；settleFromZero 峰值 1', () => {
    expect(settle(0)).toBe(1);
    expect(Math.abs(settle(400))).toBeLessThan(0.1);
    let peak = 0;
    for (let t = 0; t < 400; t += 1) peak = Math.max(peak, settleFromZero(t));
    expect(peak).toBeCloseTo(1, 3);
    expect(settleFromZero(0)).toBe(0);
  });

  it('协同表覆盖 spec 八条；幅度三档常量', () => {
    expect(ACTION_COMPANIONS.nod).toMatchObject({ gaze: 'down', blink: 'blink' });
    expect(ACTION_COMPANIONS.sigh).toMatchObject({ blink: 'eyesHalf', mouth: 0.15, breath: 'exhale' });
    expect(ACTION_COMPANIONS.jump).toMatchObject({ breath: 'inhale', blink: 'blink' });
    expect(ACTION_COMPANIONS.wave).toMatchObject({ gaze: 'user' });
    expect(ACTION_COMPANIONS.stretch).toMatchObject({ blink: 'eyesClosed', mouth: 0.2 });
    expect(ACTION_COMPANIONS.tilt).toMatchObject({ gaze: 'suppressWander', gazeMs: 2000 });
    expect(ACTION_COMPANIONS.searching).toMatchObject({ gaze: 'scanLR' });
    expect(ACTION_COMPANIONS.droop).toMatchObject({ posture: 'sad' });
    expect(ACTION_SCALE).toEqual({ explicit: 1, idle: 0.7, beat: 0.3 });
  });
});
