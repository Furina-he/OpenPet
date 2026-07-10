import { describe, it, expect } from 'vitest';
import { PerfMarks } from '../electron/main/perf-marks.js';

describe('PerfMarks', () => {
  it('mark→measure 输出耗时', () => {
    const logs: string[] = [];
    const t = [1000, 3400];
    const p = new PerfMarks({ now: () => t.shift()!, log: (m) => logs.push(m) });
    p.mark('boot');
    p.measure('boot', 'cold-start');
    expect(logs).toEqual(['[perf] cold-start 2400ms']);
  });
  it('未 mark 的 measure 静默跳过', () => {
    const logs: string[] = [];
    const p = new PerfMarks({ now: () => 0, log: (m) => logs.push(m) });
    p.measure('nope', 'x');
    expect(logs).toEqual([]);
  });
});
