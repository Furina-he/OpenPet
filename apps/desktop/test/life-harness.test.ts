import { describe, it, expect, afterEach } from 'vitest';
import { applyTuning, exportTuning } from '../src/renderer/dev/life-harness';
import { BREATH_HZ, LIFE_FLAGS, breathParams } from '../src/renderer/character/life-layers';
import { ENVELOPE, attackCurve } from '../src/renderer/character/emotion-envelope';
import { GAZE } from '../src/renderer/character/gaze';

const snapshot = exportTuning();
afterEach(() => applyTuning(snapshot)); // 每例回滚，避免污染其它测试文件（vitest 同进程隔离模块，仍稳妥）

describe('⑱ life harness 参数导出 / 回写', () => {
  it('exportTuning 是深拷贝快照，含全部调参组与层开关', () => {
    const t = exportTuning();
    expect(t.breathHz).toEqual({ low: 0.18, mid: 0.25, high: 0.33 });
    expect(t.envelope.attackMs).toBe(180);
    expect(t.gaze.wanderRange).toBe(0.3);
    expect(t.flags).toEqual(LIFE_FLAGS);
    t.breathHz.mid = 9; // 改快照不影响运行常量
    expect(BREATH_HZ.mid).toBe(0.25);
  });

  it('applyTuning 部分回写立即被纯逻辑读到（呼吸/包络/视线/层开关）', () => {
    applyTuning({ breathHz: { mid: 0.5 }, envelope: { attackMs: 300 }, gaze: { wanderRange: 0.6 }, flags: { noise: false } });
    expect(breathParams({ energy: 'mid', mood: 0, speaking: false, emotion: 'neutral' }).hz).toBe(0.5);
    expect(attackCurve(300)).toBe(1);
    expect(attackCurve(200)).toBeGreaterThan(1); // 300ms 起段内仍在过冲回落
    expect(GAZE.wanderRange).toBe(0.6);
    expect(LIFE_FLAGS.noise).toBe(false);
    expect(ENVELOPE.attackMs).toBe(300);
  });

  it('JSON round-trip：导出 → 解析 → 回写 → 再导出一致', () => {
    const a = exportTuning();
    applyTuning(JSON.parse(JSON.stringify(a)));
    expect(exportTuning()).toEqual(a);
  });
});
