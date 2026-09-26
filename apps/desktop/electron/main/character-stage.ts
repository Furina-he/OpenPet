/**
 * ㉓ character 窗几何的唯一真源（spec §4）：每角色大小 / 模型框 + 舞台边 / 脚底锚点 / 夹屏 / 吸附 /
 * 位置记忆（F-DT-02）。锚点（脚底，屏幕 DIP）只存在这里——窗口 bounds 永远由「锚点 + 布局」算出、
 * 从不回读，Windows 非 100% DPI 的 setPosition 舍入漂移因此无从累积。
 *
 * 依赖全注入（窗口 / screen / prefs / 当前角色 / 广播 / 定时器）→ 纯逻辑可测；Electron 缝在
 * ipc-router（RPC 与切角色）与 index（显示器事件、休眠唤醒、退出）。
 */
import type {
  CharacterLayout,
  CharacterManifest,
  PlacementPoint,
  PrefKey,
  Prefs,
} from '@openpet/protocol';
import {
  SCALE_MAX,
  SCALE_MIN,
  baseSizeFor,
  boundsFromAnchor,
  clampAnchor,
  defaultAnchor,
  fromRelative,
  isPixelSnap,
  maxFitScale,
  modelSize,
  pickPlacement,
  resolutionKey,
  scalePresets,
  snapScale,
  stageLayout,
  toRelative,
  type Bounds,
  type DisplayInfo,
  type Point,
  type StageLayout,
} from './window-scale.js';

/** 最后一次 moveBy / 缩放持久化后多久落盘位置。 */
export const PLACEMENT_DEBOUNCE_MS = 500;
/** 所在屏消失后记住它多久（照 Codex detachedDisplay）：期间回来就回原位，临时位置不落盘。 */
export const DETACH_GRACE_MS = 10_000;
/** 缩放合批窗口：setBounds 之后这段时间内的新目标只记最新一个，落定后再应用一次。 */
export const SCALE_SETTLE_MS = 16;

export interface StageWindow {
  isDestroyed(): boolean;
  setBounds(bounds: Bounds): void;
}

/** Electron `Display` 的结构子集（id 为 number）。 */
export interface StageDisplay {
  id: number | string;
  workArea: Bounds;
  scaleFactor: number;
}

export interface StageScreen {
  getAllDisplays(): StageDisplay[];
  getPrimaryDisplay(): StageDisplay;
  getDisplayNearestPoint(point: Point): StageDisplay;
}

export interface StagePrefs {
  getAll(): Prefs;
  set<K extends PrefKey>(key: K, value: Prefs[K]): void;
}

export type ApplyReason = 'boot' | 'character' | 'display' | 'resume';

export interface CharacterStageDeps {
  window: () => StageWindow | null;
  screen: StageScreen;
  prefs: StagePrefs;
  current: () => { characterId: string; manifest: Pick<CharacterManifest, 'engine' | 'sprite'> };
  /** 推 character.layoutChanged（character 窗 + Hub D4）。 */
  broadcast: (layout: CharacterLayout) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface CharacterStage {
  /** 按当前角色大小 + 底座 + 位置记录 → 夹屏 → setBounds → 推 layout。 */
  apply(reason: ApplyReason): void;
  /** 以当前锚点缩放（吸附 / maxFit / 夹屏），返回实际生效值；persist → 按当前角色落盘。 */
  setScale(scale: number, opts: { persist: boolean }): number;
  /** 拖拽：锚点平移 + 期望尺寸 setBounds（不夹屏）；500ms 防抖落盘位置。 */
  moveBy(dx: number, dy: number): void;
  /** 系统休眠：立即存位置，断开宽限暂停到唤醒。 */
  suspend(): void;
  /** 退出前：立即存位置。 */
  flush(): void;
  layout(): CharacterLayout;
  presets(): number[];
  /** 卸载角色：删它的大小记录。 */
  forgetCharacter(characterId: string): void;
  dispose(): void;
}

interface Geometry {
  scale: number;
  maxFit: number;
  pixel: boolean;
  display: DisplayInfo;
  layout: StageLayout;
}

interface Detached {
  id: string;
  /** 工作区分辨率键：同尺寸的屏换了 id 回来也认。 */
  key: string;
  rel: PlacementPoint | null;
  /** null = 休眠中暂停计时。 */
  timer: unknown;
}

export function createCharacterStage(deps: CharacterStageDeps): CharacterStage {
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearT =
    deps.clearTimeout ??
    ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));

  let anchor: Point | null = null;
  let applied: Geometry | null = null;
  let saveTimer: unknown = null;
  let settleTimer: unknown = null;
  let pendingScale: number | null = null;
  let detached: Detached | null = null;

  const info = (d: StageDisplay): DisplayInfo => ({
    id: String(d.id),
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor,
  });
  const displays = (): DisplayInfo[] => deps.screen.getAllDisplays().map(info);
  const primary = (): DisplayInfo => info(deps.screen.getPrimaryDisplay());
  const displayAt = (p: Point): DisplayInfo =>
    info(deps.screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }));
  const prefs = (): Prefs => deps.prefs.getAll();

  /** 当前角色的大小（每角色一份；没单独设过的从全局初值起步）。 */
  function storedScale(): number {
    const p = prefs();
    return p['display.characterScales'][deps.current().characterId] ?? p['display.characterScale'];
  }

  function geometry(s: number, display: DisplayInfo): Geometry {
    const { manifest } = deps.current();
    const base = baseSizeFor(manifest);
    const pixel = isPixelSnap(manifest);
    const maxFit = maxFitScale(base, display.workArea);
    const scale = snapScale(s, { pixelArt: pixel, dpr: display.scaleFactor, maxFit });
    return { scale, maxFit, pixel, display, layout: stageLayout(modelSize(base, scale)) };
  }

  function layoutOf(): CharacterLayout {
    const g = applied ?? geometry(storedScale(), primary());
    const a = anchor ?? defaultAnchor(g.layout.model, g.display.workArea);
    return {
      scale: g.scale,
      maxScale: g.maxFit,
      pixelSnap: g.pixel,
      dpr: g.display.scaleFactor,
      presets: scalePresets({ pixelArt: g.pixel, dpr: g.display.scaleFactor }),
      window: { ...g.layout.window },
      model: { ...g.layout.model },
      screen: { workArea: { ...g.display.workArea }, windowBounds: boundsFromAnchor(a, g.layout) },
    };
  }

  function setWindowBounds(): void {
    if (!anchor || !applied) return;
    const w = deps.window();
    if (w && !w.isDestroyed()) w.setBounds(boundsFromAnchor(anchor, applied.layout));
  }

  /** 落位：可选夹屏 → setBounds → 推 layout。 */
  function place(g: Geometry, at: Point, clampToScreen: boolean): void {
    anchor = clampToScreen ? clampAnchor(at, g.layout.model, g.display.workArea) : at;
    applied = g;
    setWindowBounds();
    deps.broadcast(layoutOf());
  }

  // ---- 位置记录 ----

  function recordPlacement(): void {
    if (!anchor || detached) return; // 断开宽限期内：临时位置不落盘
    const d = displayAt(anchor);
    const rel = toRelative(anchor, d.workArea);
    const cur = prefs()['display.characterPlacement'];
    deps.prefs.set('display.characterPlacement', {
      lastDisplayId: d.id,
      byDisplay: { ...cur.byDisplay, [d.id]: rel },
      byResolution: { ...cur.byResolution, [resolutionKey(d.workArea)]: rel },
    });
  }

  function cancelSave(): void {
    if (saveTimer !== null) clearT(saveTimer);
    saveTimer = null;
  }

  function scheduleSave(): void {
    cancelSave();
    saveTimer = setT(onMoveSettled, PLACEMENT_DEBOUNCE_MS);
  }

  /** 拖拽 / 缩放落定：换了屏 → 按新屏重新吸附 / maxFit（落点不夹）；然后存位置。 */
  function onMoveSettled(): void {
    saveTimer = null;
    if (!anchor || !applied) return;
    const d = displayAt(anchor);
    if (d.id !== applied.display.id || d.scaleFactor !== applied.display.scaleFactor) {
      place(geometry(storedScale(), d), anchor, false);
    } else {
      deps.broadcast(layoutOf()); // 位置变了：D4 屏幕示意跟上
    }
    recordPlacement();
  }

  // ---- 断开宽限 ----

  function endGrace(): void {
    if (detached?.timer != null) clearT(detached.timer);
    detached = null;
  }

  function expireGrace(): void {
    detached = null;
    recordPlacement(); // 没回来：主屏上的临时位置转正
  }

  // ---- 恢复 ----

  function restore(): void {
    const all = displays();
    if (detached) {
      const gone = detached;
      const back =
        all.find((d) => d.id === gone.id) ??
        all.find((d) => resolutionKey(d.workArea) === gone.key);
      if (back) {
        endGrace();
        const g = geometry(storedScale(), back);
        const at = gone.rel
          ? fromRelative(gone.rel, back.workArea)
          : defaultAnchor(g.layout.model, back.workArea);
        place(g, at, true);
        recordPlacement();
        return;
      }
    }
    const saved = prefs()['display.characterPlacement'];
    const lastGone = saved.lastDisplayId !== '' && !all.some((d) => d.id === saved.lastDisplayId);
    // 宽限只给「角色此刻就站在那块屏上」的消失；开机时它早已不在（回落主屏）不算，否则之后任何
    // 无关的显示器事件都会开宽限、到期把它的记录冲成主屏。
    if (lastGone && !detached && applied?.display.id === saved.lastDisplayId) {
      const key = resolutionKey(applied.display.workArea);
      detached = {
        id: saved.lastDisplayId,
        key,
        rel: saved.byDisplay[saved.lastDisplayId] ?? saved.byResolution[key] ?? null,
        timer: setT(expireGrace, DETACH_GRACE_MS),
      };
    }
    const pick = pickPlacement(saved, all, primary());
    const g = geometry(storedScale(), pick.display);
    const at = pick.rel
      ? fromRelative(pick.rel, pick.display.workArea)
      : defaultAnchor(g.layout.model, pick.display.workArea);
    place(g, at, true);
  }

  // ---- 缩放合批 ----

  function applyScale(s: number): void {
    if (!anchor) return;
    place(geometry(s, displayAt(anchor)), anchor, true);
  }

  function requestScale(s: number): void {
    if (settleTimer !== null) {
      pendingScale = s;
      return;
    }
    applyScale(s);
    settleTimer = setT(onScaleSettled, SCALE_SETTLE_MS);
  }

  function onScaleSettled(): void {
    settleTimer = null;
    if (pendingScale === null) return;
    const s = pendingScale;
    pendingScale = null;
    requestScale(s);
  }

  return {
    apply(reason) {
      pendingScale = null; // 旧目标作废（如滚轮预览中切了角色）
      if (reason === 'character' && anchor) {
        place(geometry(storedScale(), displayAt(anchor)), anchor, true); // 同一个脚底，底座随形象
        return;
      }
      if (reason === 'display' || reason === 'resume') cancelSave(); // 丢弃未落盘的拖拽位置
      if (reason === 'resume' && detached && detached.timer === null) {
        detached.timer = setT(expireGrace, DETACH_GRACE_MS); // 唤醒：宽限从现在重新计
      }
      restore();
    },

    setScale(scale, opts) {
      if (!anchor) restore();
      const g = geometry(scale, anchor ? displayAt(anchor) : primary());
      if (opts.persist) {
        const map = prefs()['display.characterScales'];
        const v = Math.min(SCALE_MAX, Math.max(SCALE_MIN, g.scale));
        deps.prefs.set('display.characterScales', { ...map, [deps.current().characterId]: v });
      }
      requestScale(g.scale);
      if (opts.persist) scheduleSave(); // 夹屏可能挪了脚底：落定后记位置
      return g.scale;
    },

    moveBy(dx, dy) {
      if (!anchor || !applied) return;
      anchor = { x: anchor.x + Math.round(dx), y: anchor.y + Math.round(dy) };
      setWindowBounds();
      scheduleSave();
    },

    suspend() {
      cancelSave();
      recordPlacement();
      if (detached?.timer != null) {
        clearT(detached.timer);
        detached.timer = null;
      }
    },

    flush() {
      cancelSave();
      recordPlacement();
    },

    layout: layoutOf,
    presets: () => layoutOf().presets,

    forgetCharacter(characterId) {
      const map = prefs()['display.characterScales'];
      if (!(characterId in map)) return;
      const { [characterId]: _gone, ...rest } = map;
      deps.prefs.set('display.characterScales', rest);
    },

    dispose() {
      cancelSave();
      if (settleTimer !== null) clearT(settleTimer);
      settleTimer = null;
      pendingScale = null;
      endGrace();
    },
  };
}
