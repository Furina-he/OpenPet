import { describe, it, expect } from 'vitest';
import {
  ACTION_NAMES,
  ACTION_DEFAULT_MS,
  sampleAction,
  ZERO_OFFSETS,
  type BoneOffsets,
} from '../src/renderer/character/actions';

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
