/**
 * ⑱ Dev harness `?harness=life`（spec §7）——调参与录 GIF 的唯一入口。
 * 挂在 character 窗（dev：`OPENPET_HARNESS=life pnpm --filter @openpet/desktop dev`）。
 * 左侧面板：滑杆（呼吸/微噪/包络/基线/视线）、层开关（A/B）、按钮（情绪/动作/节拍/mood/energy/
 * 模拟说话）、VRMA 文件选择；「导出」把当前参数 JSON 复制到剪贴板，贴回代码常量即定稿。
 * 纯逻辑（exportTuning / applyTuning）与 DOM 挂载分离，前者可单测。
 */
import type { SpriteSheet } from '@openpet/protocol';
import type { CharacterRuntime } from '../character/runtime-types';
import {
  BREATH_AMP,
  BREATH_HZ,
  LIFE_FLAGS,
  MICRO_NOISE_AMP,
  WEIGHT_SHIFT,
  type Energy,
} from '../character/life-layers';
import { ENVELOPE } from '../character/emotion-envelope';
import { GAZE } from '../character/gaze';
import { ACTION_NAMES } from '../character/actions';
import { SPRITE_2D_GAIN, SPRITE_FLAGS } from '../character/sprite-transform';

export interface LifeTuning {
  breathHz: Record<Energy, number>;
  breathAmp: Record<Energy, number>;
  microNoise: { headYaw: number; headRoll: number; spineYaw: number };
  weightShift: { minGapMs: number; maxGapMs: number; easeMs: number; hipsX: number; spineRoll: number };
  envelope: { attackMs: number; overshootAtMs: number; overshoot: number; releaseMs: number; baselineMs: number };
  gaze: {
    trackIdleMs: number;
    trackRadiusFactor: number;
    saccadeMs: number;
    wanderRange: number;
    wanderHoldMinMs: number;
    wanderHoldMaxMs: number;
    wanderJitter: number;
  };
  flags: typeof LIFE_FLAGS;
  /** ⑳ BoneOffsets → 2D 增益（sprite 引擎）。 */
  sprite2d: typeof SPRITE_2D_GAIN;
  spriteFlags: typeof SPRITE_FLAGS;
}

/** 当前参数快照（深拷贝，可直接 JSON 化）。 */
export function exportTuning(): LifeTuning {
  return JSON.parse(
    JSON.stringify({
      breathHz: BREATH_HZ,
      breathAmp: BREATH_AMP,
      microNoise: MICRO_NOISE_AMP,
      weightShift: WEIGHT_SHIFT,
      envelope: ENVELOPE,
      gaze: {
        trackIdleMs: GAZE.trackIdleMs,
        trackRadiusFactor: GAZE.trackRadiusFactor,
        saccadeMs: GAZE.saccadeMs,
        wanderRange: GAZE.wanderRange,
        wanderHoldMinMs: GAZE.wanderHoldMinMs,
        wanderHoldMaxMs: GAZE.wanderHoldMaxMs,
        wanderJitter: GAZE.wanderJitter,
      },
      flags: LIFE_FLAGS,
      sprite2d: SPRITE_2D_GAIN,
      spriteFlags: SPRITE_FLAGS,
    }),
  ) as LifeTuning;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function assignNumbers<T extends object>(target: T, patch: DeepPartial<T> | undefined): void {
  if (!patch) return;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (target as Record<string, unknown>)[k] = v;
  }
}

/** 把（部分）参数写回运行中的可变常量对象——纯逻辑模块在下一帧即读到新值。 */
export function applyTuning(t: DeepPartial<LifeTuning>): void {
  assignNumbers(BREATH_HZ, t.breathHz);
  assignNumbers(BREATH_AMP, t.breathAmp);
  assignNumbers(MICRO_NOISE_AMP, t.microNoise);
  assignNumbers(WEIGHT_SHIFT, t.weightShift);
  assignNumbers(ENVELOPE, t.envelope);
  assignNumbers(GAZE, t.gaze);
  assignNumbers(LIFE_FLAGS, t.flags);
  assignNumbers(SPRITE_2D_GAIN, t.sprite2d);
  assignNumbers(SPRITE_FLAGS, t.spriteFlags);
}

export interface HarnessHooks {
  /** 模拟一段 chat.stream（说话态 + 三种节拍）。 */
  simulateStream: () => void;
  /** T9：加载用户自备 .vrma 为某动作的片段。 */
  loadClip?: ((name: string, file: File) => Promise<boolean>) | undefined;
  /** ⑳ sprite：热换图集（可同时换布局描述）。 */
  loadSheet?: ((file: File, sprite?: SpriteSheet) => Promise<void>) | undefined;
}

const EMOTION_BUTTONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'shy', 'sleepy', 'thinking'];

/** DOM 挂载（无框架，character 窗内）。所有指针事件 stopPropagation，避免触发拖拽/点击。 */
export function mountLifeHarness(root: HTMLElement, rt: CharacterRuntime, hooks: HarnessHooks): void {
  const panel = document.createElement('div');
  panel.id = 'life-harness';
  panel.style.cssText = [
    'position:absolute;left:0;top:0;bottom:0;width:210px;overflow:auto;z-index:50',
    'background:rgba(20,22,30,.86);color:#eee;font:10px/1.4 ui-monospace,monospace;padding:6px',
    'box-sizing:border-box;user-select:none',
  ].join(';');
  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }
  const h = (tag: string, text?: string, css?: string): HTMLElement => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (css) el.style.cssText = css;
    return el;
  };
  const section = (title: string): HTMLElement => {
    const el = h('div', undefined, 'margin:6px 0 2px;font-weight:bold;color:#9cf');
    el.textContent = title;
    panel.appendChild(el);
    return el;
  };
  const slider = (
    label: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
  ): void => {
    const row = h('label', undefined, 'display:flex;align-items:center;gap:4px');
    const name = h('span', label, 'flex:0 0 78px;white-space:nowrap;overflow:hidden');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.style.cssText = 'flex:1;min-width:0';
    const val = h('span', String(get()), 'flex:0 0 38px;text-align:right');
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      val.textContent = String(v);
    });
    row.append(name, input, val);
    panel.appendChild(row);
  };
  const button = (label: string, onClick: () => void, parent: HTMLElement = panel): void => {
    const b = h('button', label, 'font:10px ui-monospace;margin:1px;padding:1px 4px;cursor:pointer');
    b.addEventListener('click', onClick);
    parent.appendChild(b);
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
    const row = h('label', undefined, 'display:flex;align-items:center;gap:4px');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = get();
    cb.addEventListener('change', () => set(cb.checked));
    row.append(cb, h('span', label));
    panel.appendChild(row);
  };

  section('层开关 A/B');
  for (const k of Object.keys(LIFE_FLAGS) as Array<keyof typeof LIFE_FLAGS>) {
    toggle(k, () => LIFE_FLAGS[k], (v) => (LIFE_FLAGS[k] = v));
  }
  toggle('lifeLayers 总闸', () => true, (v) => rt.setLifeLayers(v));

  section('呼吸');
  for (const e of ['low', 'mid', 'high'] as const) {
    slider(`hz.${e}`, () => BREATH_HZ[e], (v) => (BREATH_HZ[e] = v), 0.05, 0.6, 0.01);
    slider(`amp.${e}`, () => BREATH_AMP[e], (v) => (BREATH_AMP[e] = v), 0, 0.06, 0.001);
  }
  section('微噪');
  slider('headYaw', () => MICRO_NOISE_AMP.headYaw, (v) => (MICRO_NOISE_AMP.headYaw = v), 0, 0.1, 0.005);
  slider('headRoll', () => MICRO_NOISE_AMP.headRoll, (v) => (MICRO_NOISE_AMP.headRoll = v), 0, 0.1, 0.005);
  slider('spineYaw', () => MICRO_NOISE_AMP.spineYaw, (v) => (MICRO_NOISE_AMP.spineYaw = v), 0, 0.05, 0.002);
  section('重心');
  slider('hipsX', () => WEIGHT_SHIFT.hipsX, (v) => (WEIGHT_SHIFT.hipsX = v), 0, 0.04, 0.001);
  slider('spineRoll', () => WEIGHT_SHIFT.spineRoll, (v) => (WEIGHT_SHIFT.spineRoll = v), 0, 0.08, 0.002);
  slider('gapMin(s)', () => WEIGHT_SHIFT.minGapMs / 1000, (v) => (WEIGHT_SHIFT.minGapMs = v * 1000), 2, 30, 1);
  slider('gapMax(s)', () => WEIGHT_SHIFT.maxGapMs / 1000, (v) => (WEIGHT_SHIFT.maxGapMs = v * 1000), 4, 60, 1);
  section('表情包络');
  slider('attackMs', () => ENVELOPE.attackMs, (v) => (ENVELOPE.attackMs = v), 60, 600, 10);
  slider('overshoot', () => ENVELOPE.overshoot, (v) => (ENVELOPE.overshoot = v), 0, 0.3, 0.01);
  slider('releaseMs', () => ENVELOPE.releaseMs, (v) => (ENVELOPE.releaseMs = v), 200, 4000, 50);
  slider('baselineMs', () => ENVELOPE.baselineMs, (v) => (ENVELOPE.baselineMs = v), 200, 6000, 100);
  section('视线');
  slider('R×窗宽', () => GAZE.trackRadiusFactor, (v) => (GAZE.trackRadiusFactor = v), 0.5, 4, 0.1);
  slider('wanderRange', () => GAZE.wanderRange, (v) => (GAZE.wanderRange = v), 0, 0.8, 0.02);
  slider('holdMin(s)', () => GAZE.wanderHoldMinMs / 1000, (v) => (GAZE.wanderHoldMinMs = v * 1000), 0.2, 6, 0.1);
  slider('holdMax(s)', () => GAZE.wanderHoldMaxMs / 1000, (v) => (GAZE.wanderHoldMaxMs = v * 1000), 0.5, 12, 0.1);
  slider('lookAt 强度', () => 50, (v) => rt.setLookAtPrefs(true, v), 0, 100, 1);

  section('心情 / 基调');
  slider('mood', () => 0, (v) => rt.setMood(v), -1, 1, 0.05);
  const energyRow = h('div');
  for (const e of ['low', 'mid', 'high']) {
    button(`energy ${e}`, () => rt.setIdle({ mood: 'neutral', energy: e }), energyRow);
  }
  panel.appendChild(energyRow);

  section('情绪');
  const emoRow = h('div');
  for (const e of [...new Set([...EMOTION_BUTTONS, ...rt.listEmotions()])]) {
    button(e, () => rt.applyEmotion(e, 1), emoRow);
  }
  button('release', () => rt.releaseEmotion(), emoRow);
  panel.appendChild(emoRow);

  section('动作');
  const actRow = h('div');
  for (const a of [...new Set([...ACTION_NAMES, ...rt.listActions()])]) {
    button(a, () => rt.playAction(a, null), actRow);
  }
  panel.appendChild(actRow);

  section('节拍 / 说话');
  const beatRow = h('div');
  for (const k of ['question', 'exclaim', 'period'] as const) button(`beat ${k}`, () => rt.playBeat(k), beatRow);
  button('模拟一段回复', hooks.simulateStream, beatRow);
  panel.appendChild(beatRow);

  if (hooks.loadClip) {
    section('VRMA 片段（T9）');
    const row = h('div', undefined, 'display:flex;gap:4px;align-items:center');
    const sel = document.createElement('select');
    sel.style.cssText = 'font:10px ui-monospace;max-width:80px';
    for (const a of ACTION_NAMES) {
      const o = document.createElement('option');
      o.value = a;
      o.textContent = a;
      sel.appendChild(o);
    }
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.vrma';
    file.style.cssText = 'font:10px ui-monospace;width:100px';
    const status = h('span', '', 'color:#9f9');
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void hooks.loadClip!(sel.value, f).then((ok) => {
        status.textContent = ok ? `✓ ${sel.value}` : '✗ 回退曲线';
      });
    });
    row.append(sel, file, status);
    panel.appendChild(row);
  }

  if (hooks.loadSheet || rt.playState) {
    // ⑳ sprite：热换图集 / 布局 / 2D 增益 / 帧·程序化通道 A/B / 状态逐个点播
    section('帧动画（⑳）');
    toggle('帧通道', () => SPRITE_FLAGS.frames, (v) => (SPRITE_FLAGS.frames = v));
    toggle('程序化通道', () => SPRITE_FLAGS.procedural, (v) => (SPRITE_FLAGS.procedural = v));
    if (hooks.loadSheet) {
      const row = h('div', undefined, 'display:flex;gap:4px;align-items:center;flex-wrap:wrap');
      const layout = document.createElement('select');
      layout.style.cssText = 'font:10px ui-monospace';
      for (const [v, label] of [
        ['codex', 'codex smooth'],
        ['codex-pixel', 'codex pixel'],
        ['keep', '沿用当前描述'],
      ] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        layout.appendChild(o);
      }
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.png,.webp';
      file.style.cssText = 'font:10px ui-monospace;width:120px';
      const status = h('span', '', 'color:#9f9');
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (!f) return;
        const sprite: SpriteSheet | undefined =
          layout.value === 'keep'
            ? undefined
            : { layout: 'codex', ...(layout.value === 'codex-pixel' ? { smoothing: 'pixel' as const } : {}) };
        hooks.loadSheet!(f, sprite).then(
          () => (status.textContent = `✓ ${f.name}`),
          (e: unknown) => (status.textContent = `✗ ${String(e)}`),
        );
      });
      row.append(layout, file, status);
      panel.appendChild(row);
    }
    if (rt.playState && rt.listStates) {
      const stRow = h('div');
      for (const s of rt.listStates()) button(s, () => rt.playState!(s), stRow);
      panel.appendChild(stRow);
    }
    const g = SPRITE_2D_GAIN;
    slider('hipsY', () => g.hipsY, (v) => (g.hipsY = v), 0, 5, 0.1);
    slider('hipsX', () => g.hipsX, (v) => (g.hipsX = v), 0, 5, 0.1);
    slider('chestPitch', () => g.chestPitch, (v) => (g.chestPitch = v), 0, 2, 0.05);
    slider('spinePitch', () => g.spinePitch, (v) => (g.spinePitch = v), 0, 2, 0.05);
    slider('headPitch', () => g.headPitch, (v) => (g.headPitch = v), 0, 2, 0.05);
    slider('volume', () => g.volume, (v) => (g.volume = v), 0, 1, 0.05);
    slider('headRoll', () => g.headRoll, (v) => (g.headRoll = v), 0, 2, 0.05);
    slider('spineRoll', () => g.spineRoll, (v) => (g.spineRoll = v), 0, 3, 0.05);
    slider('spineYaw', () => g.spineYaw, (v) => (g.spineYaw = v), 0, 2, 0.05);
    slider('headYaw', () => g.headYaw, (v) => (g.headYaw = v), 0, 1, 0.01);
    slider('drag', () => g.drag, (v) => (g.drag = v), 0, 2, 0.05);
    slider('mouth', () => g.mouth, (v) => (g.mouth = v), 0, 0.05, 0.001);
  }

  section('导出');
  const out = document.createElement('textarea');
  out.style.cssText = 'width:100%;height:60px;font:9px ui-monospace;background:#111;color:#cfc';
  out.readOnly = true;
  button('参数 → JSON（并复制）', () => {
    const json = JSON.stringify(exportTuning(), null, 2);
    out.value = json;
    void navigator.clipboard?.writeText(json).catch(() => {});
  });
  panel.appendChild(out);

  const fpsEl = h('div', '', 'margin-top:4px;color:#aaa');
  panel.appendChild(fpsEl);
  setInterval(() => {
    fpsEl.textContent = `fps(30s) ${rt.getStats().fps.toFixed(1)}`;
  }, 2000);

  root.appendChild(panel);
}
