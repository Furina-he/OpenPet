import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterLayout, CharacterManifest, Prefs } from '@openpet/protocol';
import {
  DETACH_GRACE_MS,
  PLACEMENT_DEBOUNCE_MS,
  SCALE_SETTLE_MS,
  createCharacterStage,
  type StageDisplay,
} from '../electron/main/character-stage';
import { MemoryPrefsStore } from '../electron/main/prefs/memory-store';
import type { Bounds } from '../electron/main/window-scale';

type Body = Pick<CharacterManifest, 'engine' | 'sprite'>;
const VRM: Body = { engine: 'vrm' };
const CODEX_INTEGER = { engine: 'sprite', sprite: { layout: 'codex', fit: 'integer' } } as Body;

const PRIMARY: StageDisplay = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
const SIDE: StageDisplay = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.5,
};
/** 100% VRM 在主屏默认位（windows.ts 现状初始位）。 */
const DEFAULT_WINDOW: Bounds = { x: 1576, y: 536, width: 320, height: 480 };

function makeEnv(
  opts: {
    prefs?: Partial<Prefs>;
    displays?: StageDisplay[];
    body?: Body;
    characterId?: string;
    window?: boolean;
  } = {},
) {
  let displays = (opts.displays ?? [PRIMARY]).map((d) => ({ ...d }));
  let primaryId = displays[0]!.id;
  const contains = (d: StageDisplay, p: { x: number; y: number }): boolean =>
    p.x >= d.workArea.x &&
    p.x <= d.workArea.x + d.workArea.width &&
    p.y >= d.workArea.y &&
    p.y <= d.workArea.y + d.workArea.height;
  const dist = (d: StageDisplay, p: { x: number; y: number }): number => {
    const dx = Math.max(d.workArea.x - p.x, 0, p.x - (d.workArea.x + d.workArea.width));
    const dy = Math.max(d.workArea.y - p.y, 0, p.y - (d.workArea.y + d.workArea.height));
    return Math.hypot(dx, dy);
  };
  const screen = {
    getAllDisplays: () => displays.map((d) => ({ ...d })),
    getPrimaryDisplay: () => ({ ...(displays.find((d) => d.id === primaryId) ?? displays[0]!) }),
    getDisplayNearestPoint: (p: { x: number; y: number }) => {
      const hit = displays.find((d) => contains(d, p));
      if (hit) return { ...hit };
      return { ...[...displays].sort((a, b) => dist(a, p) - dist(b, p))[0]! };
    },
  };
  const setBounds = vi.fn<[Bounds], void>();
  const win = { isDestroyed: () => false, setBounds };
  const prefs = new MemoryPrefsStore(opts.prefs ?? {});
  const cur = { characterId: opts.characterId ?? 'default', manifest: opts.body ?? VRM };
  const layouts: CharacterLayout[] = [];
  const stage = createCharacterStage({
    window: () => (opts.window === false ? null : win),
    screen,
    prefs,
    current: () => cur,
    broadcast: (l) => layouts.push(l),
  });
  return {
    stage,
    prefs,
    cur,
    layouts,
    setBounds,
    lastBounds: (): Bounds => setBounds.mock.calls.at(-1)![0],
    setDisplays(next: StageDisplay[], primary = next[0]!.id) {
      displays = next.map((d) => ({ ...d }));
      primaryId = primary;
    },
    placement: () => prefs.getAll()['display.characterPlacement'],
  };
}

const modelBoxOnScreen = (b: Bounds, l: CharacterLayout): Bounds => ({
  x: b.x + l.model.x,
  y: b.y + l.model.y,
  width: l.model.width,
  height: l.model.height,
});
const inside = (b: Bounds, wa: Bounds): boolean =>
  b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('character-stage：启动与每角色大小', () => {
  it('boot 无记录：100% VRM 站在主屏默认位（零回归）并推 layout', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    expect(env.lastBounds()).toEqual(DEFAULT_WINDOW);
    expect(env.layouts.at(-1)).toEqual({
      scale: 1,
      maxScale: 2,
      pixelSnap: false,
      dpr: 1,
      presets: [0.5, 0.75, 1, 1.25, 1.5, 2],
      window: { width: 320, height: 480 },
      model: { x: 0, y: 0, width: 320, height: 480 },
      screen: { workArea: PRIMARY.workArea, windowBounds: DEFAULT_WINDOW },
    });
    expect(env.stage.layout()).toEqual(env.layouts.at(-1));
  });

  it('每角色一份大小；没单独设过的角色回落 display.characterScale（初值）', () => {
    const env = makeEnv({
      prefs: { 'display.characterScale': 1.25, 'display.characterScales': { miko: 0.5 } },
    });
    env.stage.apply('boot');
    expect(env.stage.layout().scale).toBe(1.25);
    env.cur.characterId = 'miko';
    env.stage.apply('character');
    expect(env.stage.layout().scale).toBe(0.5);
    expect(env.stage.layout().window).toEqual({ width: 300, height: 360 });
  });

  it('50% 默认位：窗口 300×360，模型框右下角仍距工作区右下 24', () => {
    const env = makeEnv({ prefs: { 'display.characterScales': { default: 0.5 } } });
    env.stage.apply('boot');
    const l = env.stage.layout();
    const box = modelBoxOnScreen(env.lastBounds(), l);
    expect(env.lastBounds()).toEqual({ x: 1666, y: 656, width: 300, height: 360 });
    expect(box.x + box.width).toBe(1920 - 24);
    expect(box.y + box.height).toBe(1040 - 24);
  });

  it('没有 character 窗也不抛（只算几何）', () => {
    const env = makeEnv({ window: false });
    expect(() => env.stage.apply('boot')).not.toThrow();
    expect(env.stage.setScale(0.5, { persist: false })).toBe(0.5);
  });
});

describe('character-stage：缩放', () => {
  it('persist:true 按当前角色落盘；预览不落盘；返回吸附后的实际值', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    expect(env.stage.setScale(1.13, { persist: false })).toBe(1.15);
    expect(env.prefs.getAll()['display.characterScales']).toEqual({});
    vi.advanceTimersByTime(SCALE_SETTLE_MS);
    expect(env.stage.setScale(1.2, { persist: true })).toBe(1.2);
    expect(env.prefs.getAll()['display.characterScales']).toEqual({ default: 1.2 });
    expect(env.prefs.getAll()['display.characterScale']).toBe(1); // 初值不动
  });

  it('以脚底为锚：连续缩放往返后窗口回到原位（锚点不漂）', () => {
    const env = makeEnv({
      prefs: {
        'display.characterPlacement': {
          lastDisplayId: '1',
          byDisplay: { '1': { rx: 0.5, ry: 0.9 } },
          byResolution: {},
        },
      },
    });
    env.stage.apply('boot');
    const start = env.lastBounds();
    for (const s of [0.5, 1.35, 0.75, 0.55, 1.45, 0.9, 1]) {
      env.stage.setScale(s, { persist: false });
      vi.advanceTimersByTime(SCALE_SETTLE_MS);
      const l = env.stage.layout();
      const box = modelBoxOnScreen(env.lastBounds(), l);
      expect(box.x + box.width / 2).toBeCloseTo(960, 0);
      expect(box.y + box.height).toBe(936);
    }
    expect(env.lastBounds()).toEqual(start);
  });

  it('默认位放大到 200%：模型框自动挪回工作区内', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.setScale(2, { persist: true });
    const l = env.stage.layout();
    expect(inside(modelBoxOnScreen(env.lastBounds(), l), PRIMARY.workArea)).toBe(true);
    expect(env.lastBounds()).toEqual({ x: 1280, y: 56, width: 640, height: 960 });
  });

  it('小屏幕：maxScale 受限、请求 200% 只到 maxFit', () => {
    const small: StageDisplay = { id: 1, workArea: { x: 0, y: 0, width: 1366, height: 728 }, scaleFactor: 1 };
    const env = makeEnv({ displays: [small] });
    env.stage.apply('boot');
    expect(env.stage.layout().maxScale).toBeCloseTo(728 / 480, 9);
    expect(env.stage.setScale(2, { persist: true })).toBeCloseTo(728 / 480, 9);
    expect(env.lastBounds().height).toBe(728);
  });

  it('像素精灵（fit: integer）只在清晰档间：dpr 1.25 → 0.8 / 1.6', () => {
    const env = makeEnv({
      body: CODEX_INTEGER,
      displays: [{ ...PRIMARY, scaleFactor: 1.25 }],
    });
    env.stage.apply('boot');
    const l = env.stage.layout();
    expect(l.pixelSnap).toBe(true);
    expect(l.dpr).toBe(1.25);
    expect(l.presets).toEqual([0.8, 1.6]);
    expect(l.scale).toBe(0.8);
    expect(l.model).toEqual({ x: 54, y: 175, width: 192, height: 185 });
    expect(env.stage.setScale(1.3, { persist: true })).toBe(1.6);
  });

  it('合批：settle 窗口内连发 5 次只再应用最后一次', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.setBounds.mockClear();
    env.stage.setScale(0.9, { persist: false });
    for (const s of [0.95, 1.05, 1.1, 1.15, 1.3]) env.stage.setScale(s, { persist: false });
    expect(env.setBounds).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SCALE_SETTLE_MS);
    expect(env.setBounds).toHaveBeenCalledTimes(2);
    expect(env.lastBounds().width).toBe(Math.round(320 * 1.3));
    vi.advanceTimersByTime(SCALE_SETTLE_MS * 4);
    expect(env.setBounds).toHaveBeenCalledTimes(2);
  });

  it('layoutChanged 载荷随缩放更新', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.setScale(0.5, { persist: false });
    const l = env.layouts.at(-1)!;
    expect(l.scale).toBe(0.5);
    expect(l.window).toEqual({ width: 300, height: 360 });
    expect(l.model).toEqual({ x: 70, y: 120, width: 160, height: 240 });
    expect(l.screen.windowBounds).toEqual(env.lastBounds());
  });

  it('切角色 / 换形象：新形象站在同一个脚底位置，底座随形象变', () => {
    const env = makeEnv({ prefs: { 'display.characterScales': { pixel: 1 } } });
    env.stage.apply('boot');
    const before = env.stage.layout();
    const feet = {
      x: before.screen.windowBounds.x + before.model.x + before.model.width / 2,
      y: before.screen.windowBounds.y + before.model.y + before.model.height,
    };
    env.cur.characterId = 'pixel';
    env.cur.manifest = CODEX_INTEGER;
    env.stage.apply('character');
    const after = env.stage.layout();
    expect(after.model).toEqual({ x: 30, y: 129, width: 240, height: 231 });
    expect(after.screen.windowBounds.x + after.model.x + after.model.width / 2).toBe(feet.x);
    expect(after.screen.windowBounds.y + after.model.y + after.model.height).toBe(feet.y);
  });

  it('卸载角色顺手删它的大小记录', () => {
    const env = makeEnv({ prefs: { 'display.characterScales': { miko: 0.5, default: 1.5 } } });
    env.stage.forgetCharacter('miko');
    expect(env.prefs.getAll()['display.characterScales']).toEqual({ default: 1.5 });
    env.stage.forgetCharacter('ghost'); // 无记录：不抛
  });
});

describe('character-stage：拖拽', () => {
  it('moveBy 以锚点 + 期望尺寸 setBounds（非 100% DPI 漂移回归：40 次不涨）', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.setScale(0.5, { persist: false }); // 脚底仍在 (1736, 1016) → 窗口 (1586, 656)
    expect(env.lastBounds()).toEqual({ x: 1586, y: 656, width: 300, height: 360 });
    for (let i = 0; i < 40; i++) env.stage.moveBy(-3, -2);
    for (const [b] of env.setBounds.mock.calls.slice(-40)) {
      expect(b.width).toBe(300);
      expect(b.height).toBe(360);
    }
    expect(env.lastBounds()).toEqual({ x: 1586 - 120, y: 656 - 80, width: 300, height: 360 });
  });

  it('拖拽不夹屏（允许藏一半在屏边）', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.moveBy(300, 0);
    expect(env.lastBounds().x).toBe(1876); // 模型框右出 276px
  });

  it('最后一次 moveBy 后 500ms 才落盘位置（双键 + 上次所在屏）', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.moveBy(-736, -16);
    env.stage.moveBy(0, 0);
    expect(env.placement().lastDisplayId).toBe('');
    vi.advanceTimersByTime(PLACEMENT_DEBOUNCE_MS - 1);
    expect(env.placement().lastDisplayId).toBe('');
    vi.advanceTimersByTime(1);
    expect(env.placement()).toEqual({
      lastDisplayId: '1',
      byDisplay: { '1': { rx: 0.52083, ry: 0.96154 } },
      byResolution: { '1920x1040': { rx: 0.52083, ry: 0.96154 } },
    });
  });

  it('拖到另一块屏：落定后按新屏重新吸附（像素精灵 dpr 1 → 1.5 跳档）', () => {
    const env = makeEnv({ body: CODEX_INTEGER, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    expect(env.stage.layout().scale).toBe(1);
    env.stage.moveBy(1500, -200);
    expect(env.stage.layout().scale).toBe(1); // 拖拽中不动
    vi.advanceTimersByTime(PLACEMENT_DEBOUNCE_MS);
    const l = env.stage.layout();
    expect(l.dpr).toBe(1.5);
    expect(l.presets).toEqual([0.6667, 1.3333, 2]);
    expect(l.scale).toBe(1.3333);
    expect(env.placement().lastDisplayId).toBe('2');
    expect(env.prefs.getAll()['display.characterScales']).toEqual({}); // 重新吸附不改用户设的大小
  });
});

describe('character-stage：位置记忆', () => {
  const onSide = {
    'display.characterPlacement': {
      lastDisplayId: '2',
      byDisplay: { '1': { rx: 0.25, ry: 0.9 }, '2': { rx: 0.5, ry: 0.8 } },
      byResolution: { '1920x1040': { rx: 0.25, ry: 0.9 }, '2560x1400': { rx: 0.5, ry: 0.8 } },
    },
  };
  const feetOf = (env: ReturnType<typeof makeEnv>) => {
    const l = env.stage.layout();
    return {
      x: l.screen.windowBounds.x + l.model.x + l.model.width / 2,
      y: l.screen.windowBounds.y + l.model.y + l.model.height,
    };
  };

  it('重启仍在副屏同一相对位置', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    expect(feetOf(env)).toEqual({ x: 1920 + 1280, y: 1120 });
  });

  it('显示器 id 变了（驱动更新）按分辨率找回', () => {
    const env = makeEnv({
      prefs: {
        'display.characterPlacement': {
          lastDisplayId: '777',
          byDisplay: { '777': { rx: 0.5, ry: 0.9 } },
          byResolution: { '1920x1040': { rx: 0.5, ry: 0.9 } },
        },
      },
    });
    env.stage.apply('boot');
    expect(feetOf(env)).toEqual({ x: 960, y: 936 });
  });

  it('分辨率 / DPI 变化：按比例重算并夹屏', () => {
    const env = makeEnv({
      prefs: {
        'display.characterPlacement': {
          lastDisplayId: '1',
          byDisplay: { '1': { rx: 0.5, ry: 0.9 } },
          byResolution: {},
        },
      },
    });
    env.stage.apply('boot');
    env.setDisplays([{ id: 1, workArea: { x: 0, y: 0, width: 1536, height: 824 }, scaleFactor: 1.25 }]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 768, y: 742 }); // 741.6 → 窗口取整
  });

  it('所在屏拔掉：先回主屏记录位置、宽限期不落盘；10s 后才转正', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.setDisplays([PRIMARY]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 480, y: 936 });
    env.stage.moveBy(10, 0); // 宽限期内拖动也只动窗口
    vi.advanceTimersByTime(PLACEMENT_DEBOUNCE_MS);
    expect(env.placement()).toEqual(onSide['display.characterPlacement']);
    vi.advanceTimersByTime(DETACH_GRACE_MS);
    expect(env.placement().lastDisplayId).toBe('1');
    expect(env.placement().byDisplay['1']).toEqual({ rx: 0.25521, ry: 0.9 });
    expect(env.placement().byDisplay['2']).toEqual({ rx: 0.5, ry: 0.8 });
  });

  it('10s 内同一块屏插回：回副屏原位，不留在主屏', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.setDisplays([PRIMARY]);
    env.stage.apply('display');
    vi.advanceTimersByTime(4000);
    env.setDisplays([PRIMARY, SIDE]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 3200, y: 1120 });
    vi.advanceTimersByTime(DETACH_GRACE_MS);
    expect(env.placement()).toEqual(onSide['display.characterPlacement']);
  });

  it('宽限期内插回的屏换了 id 但同尺寸：同样回原位，记到新 id 下', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.setDisplays([PRIMARY]);
    env.stage.apply('display');
    env.setDisplays([PRIMARY, { ...SIDE, id: 9 }]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 3200, y: 1120 });
    expect(env.placement().lastDisplayId).toBe('9');
    expect(env.placement().byDisplay['9']).toEqual({ rx: 0.5, ry: 0.8 });
  });

  it('超过宽限才插回：留在主屏（已转正）', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.setDisplays([PRIMARY]);
    env.stage.apply('display');
    vi.advanceTimersByTime(DETACH_GRACE_MS + 1);
    env.setDisplays([PRIMARY, SIDE]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 480, y: 936 });
  });

  it('显示器变化时丢弃尚未落盘的拖拽位置', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.stage.moveBy(-400, 0);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 3200, y: 1120 });
    vi.advanceTimersByTime(PLACEMENT_DEBOUNCE_MS * 2);
    expect(env.placement()).toEqual(onSide['display.characterPlacement']);
  });

  it('suspend 立即存（不等防抖）；resume 按记录重放', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.moveBy(-736, -16);
    env.stage.suspend();
    expect(env.placement().lastDisplayId).toBe('1');
    const saved = env.lastBounds();
    env.stage.moveBy(50, 0);
    env.stage.apply('resume');
    expect(env.lastBounds()).toEqual(saved);
  });

  it('睡眠中宽限暂停：唤醒后 10s 内副屏回来仍回原位', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY, SIDE] });
    env.stage.apply('boot');
    env.setDisplays([PRIMARY]);
    env.stage.apply('display');
    env.stage.suspend();
    vi.advanceTimersByTime(DETACH_GRACE_MS * 30); // 睡了很久
    env.stage.apply('resume');
    vi.advanceTimersByTime(3000);
    env.setDisplays([PRIMARY, SIDE]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 3200, y: 1120 });
  });

  it('boot 时上次所在屏不在：回主屏但不改记录（副屏稍后接上仍能回去）', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY] });
    env.stage.apply('boot');
    expect(feetOf(env)).toEqual({ x: 480, y: 936 });
    vi.advanceTimersByTime(DETACH_GRACE_MS * 2);
    expect(env.placement()).toEqual(onSide['display.characterPlacement']);
    env.setDisplays([PRIMARY, SIDE]);
    env.stage.apply('display');
    expect(feetOf(env)).toEqual({ x: 3200, y: 1120 });
  });

  it('开机时副屏已不在：之后无关的显示器事件不开宽限、不冲掉副屏记录', () => {
    const env = makeEnv({ prefs: onSide, displays: [PRIMARY] });
    env.stage.apply('boot');
    // 任务栏自动隐藏 → 主屏工作区变化（display-metrics-changed）
    env.setDisplays([{ ...PRIMARY, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]);
    env.stage.apply('display');
    vi.advanceTimersByTime(DETACH_GRACE_MS * 2);
    expect(env.placement()).toEqual(onSide['display.characterPlacement']);
  });

  it('flush 立即落盘（退出前）', () => {
    const env = makeEnv();
    env.stage.apply('boot');
    env.stage.moveBy(-736, -16);
    env.stage.flush();
    expect(env.placement().lastDisplayId).toBe('1');
  });
});
