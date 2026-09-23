import { describe, it, expect } from 'vitest';
import { CODEX_LAYOUT, frameRects, resolveSprite, type ResolvedSprite } from '@openpet/protocol';
import {
  SPRITE_DRAG,
  SpriteDirector,
  SpritePlayer,
  frameAt,
  type DirectorConfig,
} from '../../src/renderer/character/sprite-player';

const IDLE = CODEX_LAYOUT.states['idle']!.durationsMs;

/** 以 50ms 步长推进到 to（player 单步上限 200ms，防后台大步长），返回最后一帧。 */
function runTo(d: SpriteDirector, from: number, to: number) {
  let f = d.tick(from);
  for (let t = from + 50; t <= to; t += 50) f = d.tick(t);
  if ((to - from) % 50 !== 0) f = d.tick(to);
  return f;
}

function codexConfig(overrides: Parameters<typeof resolveSprite>[0] = { layout: 'codex' }): DirectorConfig {
  const r: ResolvedSprite = resolveSprite(overrides);
  const f = frameRects(r, 1536, 1872);
  return { states: f.states, emotions: r.emotions, actions: r.actions, slots: r.slots };
}

describe('frameAt / SpritePlayer', () => {
  it.each([
    [0, 0],
    [279, 0],
    [280, 1],
    [390, 2],
    [500, 3],
    [640, 4],
    [780, 5],
    [1099, 5],
    [1100, 0], // 循环回第 0 帧
  ])('codex idle：t=%ims → 第 %i 帧', (t, frame) => {
    expect(frameAt(IDLE, t, true)).toBe(frame);
  });

  it('once 超出总长停在末帧', () => {
    expect(frameAt(IDLE, 5000, false)).toBe(5);
  });

  it('speed 缩放：speed 2 下 140ms 实时 = 280ms 播放时间', () => {
    const p = new SpritePlayer();
    p.play('idle', IDLE, { kind: 'loop' }, 0, 2);
    expect(p.tick(100).frame).toBe(0);
    expect(p.tick(140).frame).toBe(1);
  });

  it('speed 中途变化不跳相（累计时间）', () => {
    const p = new SpritePlayer();
    p.play('idle', IDLE, { kind: 'loop' }, 0, 1);
    p.tick(200); // t=200
    p.speed = 0.5;
    p.tick(360); // +80 → 280
    expect(p.elapsed()).toBe(280);
    expect(p.tick(360).frame).toBe(1);
  });

  it('once：一轮结束 finished', () => {
    const p = new SpritePlayer();
    const d = [140, 140, 140, 280];
    p.play('waving', d, { kind: 'once' }, 0);
    let now = 0;
    let r = p.tick(now);
    while (!r.finished && now < 2000) r = p.tick((now += 50));
    expect(r.finished).toBe(true);
    expect(now).toBe(700);
    expect(r.frame).toBe(3);
  });

  it('forMs：loop 行按时长循环后 finished', () => {
    const p = new SpritePlayer();
    p.play('running', [120, 120, 120, 120, 120, 220], { kind: 'forMs', ms: 2400 }, 0);
    let now = 0;
    let r = p.tick(now);
    while (!r.finished && now < 5000) r = p.tick((now += 100));
    expect(now).toBe(2400);
  });
});

describe('SpriteDirector 五级优先级', () => {
  it('空闲：idle 行按官方节奏', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    expect(d.tick(0)).toEqual({ state: 'idle', frame: 0, level: 'idle' });
    expect(d.tick(100).frame).toBe(0);
    expect(d.tick(200).frame).toBe(0);
    expect(d.tick(300).frame).toBe(1);
  });

  it('空闲 energy：无 idleLow/idleHigh 槽位时 idle 行调速；有则换行', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.setEnergy('high');
    d.tick(0);
    d.tick(100);
    d.tick(200);
    expect(d.tick(240).frame).toBe(1); // 240×1.2 = 288 ≥ 280
    const d2 = new SpriteDirector(codexConfig({ layout: 'codex', slots: { idleLow: 'waiting' } }), 0);
    d2.setEnergy('low');
    expect(d2.tick(0).state).toBe('waiting');
  });

  it('说话：有 talk 槽位才换行，速度 0.6 + 嘴型；无槽位留在 idle', () => {
    const plain = new SpriteDirector(codexConfig(), 0);
    plain.setTalking(true);
    expect(plain.tick(0).level).toBe('idle');
    const d = new SpriteDirector(codexConfig({ layout: 'codex', slots: { talk: 'waiting' } }), 0);
    d.setMouth(0.5); // 嘴型活跃也算说话
    expect(d.tick(0)).toMatchObject({ state: 'waiting', level: 'talk' });
    d.setMouth(0);
    expect(d.tick(10).level).toBe('idle');
  });

  it('情绪持续行压过说话；release 清除', () => {
    const d = new SpriteDirector(codexConfig({ layout: 'codex', slots: { talk: 'waiting' } }), 0);
    d.setTalking(true);
    d.applyEmotion('sad', 1, 0);
    expect(d.tick(0)).toMatchObject({ state: 'failed', level: 'emotion' });
    d.releaseEmotion();
    expect(d.tick(10).level).toBe('talk');
  });

  it('情绪 weight < 0.35 不换行，并清掉旧情绪的持续行', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.applyEmotion('sad', 1, 0);
    expect(d.tick(0).state).toBe('failed');
    d.applyEmotion('curious', 0.3, 10);
    expect(d.tick(10)).toMatchObject({ state: 'idle', level: 'idle' });
  });

  it('未映射情绪 / neutral：清持续行，走程序化', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.applyEmotion('sad', 1, 0);
    d.applyEmotion('angry', 1, 5);
    expect(d.tick(5).state).toBe('idle');
    d.applyEmotion('sad', 1, 6);
    d.applyEmotion('neutral', 1, 7);
    expect(d.tick(7).state).toBe('idle');
  });

  it('enter 先播一轮再进 loop（自定义 enter+loop）', () => {
    const d = new SpriteDirector(
      codexConfig({ layout: 'codex', emotions: { happy: { enter: 'jumping', loop: 'waiting' } } }),
      0,
    );
    d.applyEmotion('happy', 1, 0);
    expect(d.tick(0)).toMatchObject({ state: 'jumping', frame: 0, level: 'oneShot' });
    expect(runTo(d, 0, 839).state).toBe('jumping'); // 5 帧共 840ms
    expect(d.tick(840)).toMatchObject({ state: 'waiting', level: 'emotion' });
  });

  it('codex happy：跳一下后回 idle', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.applyEmotion('happy', 1, 0);
    expect(d.tick(0).state).toBe('jumping');
    for (let t = 100; t < 840; t += 100) expect(d.tick(t).state).toBe('jumping');
    expect(d.tick(840)).toMatchObject({ state: 'idle', frame: 0 });
  });

  it('动作映射行：loop=false 播一轮；loop=true 按动作时长循环；未映射 → procedural', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    expect(d.playAction('wave', null, 0)).toEqual({ kind: 'row', state: 'waving' });
    expect(d.tick(0).state).toBe('waving');
    expect(runTo(d, 0, 699).state).toBe('waving');
    expect(d.tick(700).state).toBe('idle');
    expect(d.playAction('searching', 1000, 800)).toEqual({ kind: 'row', state: 'running' });
    expect(d.tick(800).state).toBe('running');
    expect(runTo(d, 800, 1799).state).toBe('running');
    expect(d.tick(1800).state).toBe('idle');
    expect(d.playAction('nod', null, 2000)).toEqual({ kind: 'procedural' });
    expect(d.tick(2000).level).toBe('idle');
  });

  it('新动作打断旧一次性行（从第 0 帧起）', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.playAction('jump', null, 0);
    d.tick(0);
    d.tick(300);
    d.playAction('wave', null, 300);
    expect(d.tick(300)).toMatchObject({ state: 'waving', frame: 0 });
  });

  it('一次性行进行中到达的情绪 enter 丢弃，但 loop 部分生效', () => {
    const d = new SpriteDirector(
      codexConfig({ layout: 'codex', emotions: { happy: { enter: 'jumping', loop: 'waiting' } } }),
      0,
    );
    d.playAction('wave', null, 0);
    d.tick(0);
    d.applyEmotion('happy', 1, 100);
    expect(d.tick(100).state).toBe('waving');
    expect(runTo(d, 100, 700)).toMatchObject({ state: 'waiting', level: 'emotion' }); // 没有补播 jumping
  });

  it('同一状态跨等级续播不跳帧（sleepy = idle 行 ×0.6）', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.tick(0);
    d.tick(150);
    d.applyEmotion('sleepy', 1, 150);
    const f = d.tick(150);
    expect(f).toMatchObject({ state: 'idle', level: 'emotion', frame: 0 });
    d.tick(300); // 150 + 150×0.6 = 240
    expect(d.tick(360).frame).toBe(0); // 276
    expect(d.tick(400).frame).toBe(1); // 300（若在 150 处重置则只有 150 → 仍第 0 帧）
  });
});

describe('SpriteDirector 拖拽', () => {
  it('|vx| ≥ 门槛按方向播 running-left/right，压过一切并作废一次性行', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    d.playAction('wave', null, 0);
    d.tick(0);
    expect(d.tick(50, { active: true, vx: 0.2 })).toMatchObject({ state: 'running-right', level: 'drag' });
    expect(d.tick(100, { active: true, vx: -0.2 }).state).toBe('running-left');
    expect(d.oneShotActive()).toBe(false);
  });

  it('低于门槛保持 300ms 才回落；按住不动从不进拖拽行；松手立即回落', () => {
    const d = new SpriteDirector(codexConfig(), 0);
    expect(d.tick(0, { active: true, vx: 0.01 }).level).toBe('idle');
    d.tick(10, { active: true, vx: 0.3 });
    expect(d.tick(20, { active: true, vx: 0.01 }).state).toBe('running-right');
    expect(d.tick(20 + SPRITE_DRAG.holdMs - 1, { active: true, vx: 0.01 }).level).toBe('drag');
    expect(d.tick(20 + SPRITE_DRAG.holdMs, { active: true, vx: 0.01 }).level).toBe('idle');
    d.tick(400, { active: true, vx: -0.3 });
    expect(d.tick(410, { active: false, vx: -0.3 }).level).toBe('idle');
  });

  it('缺拖拽槽位：跳过拖拽级', () => {
    const d = new SpriteDirector(
      {
        states: { stand: { durationsMs: [100, 100], loop: true } },
        emotions: {},
        actions: {},
        slots: { idle: 'stand' },
      },
      0,
    );
    expect(d.tick(0, { active: true, vx: 1 }).level).toBe('idle');
  });

  it('idle 状态无可用帧 → 构造即抛（runtime 转 fallback）', () => {
    expect(
      () =>
        new SpriteDirector(
          { states: { stand: { durationsMs: [], loop: true } }, emotions: {}, actions: {}, slots: { idle: 'stand' } },
          0,
        ),
    ).toThrow(/idle/);
  });
});
