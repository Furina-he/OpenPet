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
  it('covers exactly the persona DEFAULT_ACTIONS vocabulary', () => {
    expect([...ACTION_NAMES].sort()).toEqual(
      ['fidget', 'jump', 'nod', 'shake', 'sigh', 'stretch', 'tilt', 'wave'].sort(),
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
});
