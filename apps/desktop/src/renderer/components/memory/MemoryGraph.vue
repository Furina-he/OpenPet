<!-- components/memory/MemoryGraph.vue — ㉒ F3 记忆图谱画布（spec 2026-09-24-memory-graph-design §4.2 / §4.3）。
     只做 canvas 装配：过滤 / 半径 / 配色 / 标签占位 / 相机 / 孤岛 / 布局记忆 / 力模拟全在纯 TS 模块。
     先定型再上屏（settleSync → fit → 第一帧）；刷新从旧坐标补间 300ms；只有拖拽时实时模拟；
     RAF 只在补间 / 拖拽 / 模拟未冷却时运行，页面隐藏与卸载即停；颜色读 CSS 变量，换肤重绘。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  labelAlpha,
  neighborsOf,
  recallGlow,
  type GraphView,
  type ProbeRoute,
  type ViewNode,
} from '../../settings/memory-graph-model.js';
import {
  createWidthCache,
  labelFontPx,
  placeLabels,
  truncateLabel,
  type LabelCandidate,
  type LabelTier,
} from '../../settings/graph-labels.js';
import {
  boundsOf,
  centerOn,
  easeOutCubic,
  fitBounds,
  lerpCamera,
  panBy,
  toScreen,
  toWorld,
  zoomAt,
  type Camera,
} from '../../settings/graph-camera.js';
import {
  boundingCircle,
  debounce,
  initialPosition,
  islandPositions,
  loadPositions,
  savePositions,
  type Point,
} from '../../settings/graph-layout.js';
import {
  createSim,
  isHot,
  pin,
  settleSync,
  unpin,
  type GraphSim,
  type SimNode,
} from '../../settings/graph-sim.js';

const props = defineProps<{
  view: GraphView;
  /** 布局记忆键（角色 id）。 */
  cid: string;
  selected: string | null;
  hits: ReadonlySet<string>;
  rings: ReadonlyMap<string, ProbeRoute>;
  /** 右侧浮动阅读栏宽度（选中节点自动平移到它左边的可见区）。 */
  rightInset: number;
  /** 左侧浮层（试一句结果）宽度：命中范围适配时避开。 */
  leftInset: number;
  /** 无障碍汇总（role=img 的 aria-label）。 */
  label: string;
}>();
const emit = defineEmits<{ select: [string | null] }>();

const wrap = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const tip = ref<{ x: number; y: number; text: string } | null>(null);

const size = { w: 0, h: 0, dpr: 1 };
let cam: Camera = { x: 0, y: 0, k: 1 };
let camTween: { from: Camera; to: Camera; t0: number; dur: number } | null = null;
/** 当前显示坐标（世界系）。 */
let pos = new Map<string, Point>();
let posTween: { from: Map<string, Point>; to: Map<string, Point>; t0: number; dur: number } | null =
  null;
let sim: GraphSim | null = null;
let simNodes = new Map<string, SimNode>();
let island = new Map<string, Point>();
let needFit = true;
let hoverId: string | null = null;
let drag:
  | { kind: 'node'; id: string; sx: number; sy: number; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; lastX: number; lastY: number; moved: boolean }
  | null = null;
let raf = 0;
const reduced =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TWEEN_MS = reduced ? 0 : 300;

const nodeById = computed(() => new Map(props.view.nodes.map((n) => [n.id, n])));

// ---------- 颜色（CSS 变量，换肤重读） ----------
let colors: Record<string, string> = {};
function readColors(): void {
  const cs = getComputedStyle(canvas.value ?? document.documentElement);
  const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  colors = {
    main: v('--ds-text-main', '#171821'),
    sub: v('--ds-text-sub', 'rgba(23,24,33,0.55)'),
    brandFrom: v('--ds-brand-from', '#ffb4a2'),
    brandTo: v('--ds-brand-to', '#ff8fab'),
    cool: v('--ds-cool', '#6fa8ff'),
    people: v('--ds-graph-people', '#ffb4a2'),
    topics: v('--ds-graph-topics', '#7fb7ff'),
    character: v('--ds-graph-character', '#c6a8ff'),
  };
}

const measureCtx = document.createElement('canvas').getContext('2d');
const textWidth = createWidthCache((font, text) => {
  if (!measureCtx) return text.length * 12;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
});
const fontOf = (px: number): string =>
  `${px}px "PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif`;

// ---------- 布局 ----------
const saveLater = debounce(() => {
  if (pos.size) savePositions(window.localStorage, props.cid, pos);
}, 600);

function layout(): void {
  const view = props.view;
  const saved = loadPositions(window.localStorage, props.cid);
  const known = new Map<string, Point>();
  for (const n of view.nodes) {
    const p = pos.get(n.id) ?? saved.get(n.id);
    if (p) known.set(n.id, p);
  }
  const main = view.nodes.filter((n) => !n.orphan);
  const nodes: SimNode[] = main.map((n) => ({ id: n.id, r: n.radius }));
  const adj = new Map<string, string[]>();
  for (const e of view.edges) {
    if (e.kind !== 'link') continue;
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  for (const sn of nodes) {
    const p = known.get(sn.id);
    if (p) {
      sn.x = p.x;
      sn.y = p.y;
    }
  }
  if (known.size > 0)
    for (const sn of nodes) {
      if (sn.x !== undefined) continue;
      const nb = (adj.get(sn.id) ?? []).map((id) => known.get(id)).filter((p): p is Point => !!p);
      const p = initialPosition(sn.id, nb);
      sn.x = p.x;
      sn.y = p.y;
    }
  sim?.stop();
  sim = createSim(
    nodes,
    view.edges.filter((e) => e.kind === 'link'),
  );
  // 有存档坐标 → 低温微调（重开 Hub 图不重排）；全新 → 完整定型
  if (known.size > 0) sim.alpha(0.1);
  settleSync(sim, 300);
  simNodes = new Map(nodes.map((n) => [n.id, n]));
  const circle = boundingCircle(nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, r: n.r })));
  const orphans = view.nodes
    .filter((n) => n.orphan)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh') || (a.id < b.id ? -1 : 1));
  island = islandPositions(
    orphans.map((n) => n.id),
    nodes.length ? circle : { cx: 0, cy: 0, r: 0 },
  );
  const target = currentTargets();
  if (pos.size > 0 && TWEEN_MS > 0) {
    const from = new Map<string, Point>();
    for (const [id, p] of target) from.set(id, pos.get(id) ?? p);
    posTween = { from, to: target, t0: performance.now(), dur: TWEEN_MS };
  } else {
    pos = target;
    posTween = null;
  }
  if (needFit && size.w > 0) {
    cam = fitCamera(target);
    needFit = false;
  }
  saveLater();
  kick();
}

function currentTargets(): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [id, n] of simNodes) out.set(id, { x: n.x ?? 0, y: n.y ?? 0 });
  for (const [id, p] of island) out.set(id, p);
  return out;
}

function fitCamera(points: Map<string, Point>, only?: ReadonlySet<string>): Camera {
  const k0 = cam.k || 1;
  const pts = [...points]
    .filter(([id]) => !only || only.has(id))
    .map(([id, p]) => {
      const n = nodeById.value.get(id);
      const r = n?.radius ?? 5;
      const lw = n ? textWidth(fontOf(12), truncateLabel(n.title)) / k0 / 2 : 0;
      return { x: p.x, y: p.y, padX: Math.max(r, lw), padY: r + 20 };
    });
  if (!only) return fitBounds(boundsOf(pts), { w: size.w, h: size.h });
  // 只适配部分节点（试一句命中）：避开左右浮层，在中间可见区里适配
  const w = Math.max(1, size.w - props.rightInset - props.leftInset);
  const c = fitBounds(boundsOf(pts), { w, h: size.h }, 0.12, 1.4);
  return { ...c, x: c.x + props.leftInset };
}

// ---------- 动画循环 ----------
function kick(): void {
  if (!raf && typeof document !== 'undefined' && !document.hidden)
    raf = requestAnimationFrame(frame);
}
function frame(now: number): void {
  raf = 0;
  let more = false;
  if (posTween) {
    const t = posTween.dur ? Math.min(1, (now - posTween.t0) / posTween.dur) : 1;
    const e = easeOutCubic(t);
    const next = new Map<string, Point>();
    for (const [id, to] of posTween.to) {
      const f = posTween.from.get(id) ?? to;
      next.set(id, { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e });
    }
    pos = next;
    if (t >= 1) posTween = null;
    else more = true;
  }
  if (camTween) {
    const t = camTween.dur ? Math.min(1, (now - camTween.t0) / camTween.dur) : 1;
    cam = lerpCamera(camTween.from, camTween.to, easeOutCubic(t));
    if (t >= 1) camTween = null;
    else more = true;
  }
  if (sim && (drag?.kind === 'node' || isHot(sim)) && !posTween) {
    sim.tick();
    pos = currentTargets();
    if (drag?.kind !== 'node' && !isHot(sim)) saveLater();
    more = true;
  }
  draw();
  if (more) kick();
}
function animateCamera(to: Camera): void {
  camTween = { from: { ...cam }, to, t0: performance.now(), dur: TWEEN_MS };
  kick();
}

// ---------- 绘制 ----------
function draw(): void {
  const c = canvas.value;
  const ctx = c?.getContext('2d');
  if (!c || !ctx || size.w === 0) return;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  const view = props.view;
  const focus = hoverId ? neighborsOf(view.edges, hoverId) : null;
  const probing = props.rings.size > 0;
  const searching = props.hits.size > 0;
  const dimOf = (id: string): number => {
    if (focus) return focus.has(id) ? 1 : 0.15;
    if (probing) return props.rings.has(id) ? 1 : 0.25;
    if (searching) return props.hits.has(id) ? 1 : 0.2;
    return 1;
  };
  const sp = (id: string): Point | null => {
    const p = pos.get(id);
    return p ? toScreen(cam, p.x, p.y) : null;
  };

  // 边
  for (const e of view.edges) {
    const a = sp(e.source);
    const b = sp(e.target);
    if (!a || !b) continue;
    const hot = !!hoverId && (e.source === hoverId || e.target === hoverId);
    const dim = Math.min(dimOf(e.source), dimOf(e.target));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (hot) {
      ctx.strokeStyle = colors.brandTo!;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(e.kind === 'mention' ? [3, 3] : []);
    } else {
      ctx.strokeStyle = colors.sub!;
      ctx.globalAlpha = (e.kind === 'mention' ? 0.2 : 0.35) * dim;
      ctx.lineWidth = 1;
      ctx.setLineDash(e.kind === 'mention' ? [3, 3] : []);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 节点
  const t = Date.now();
  for (const n of view.nodes) {
    const p = sp(n.id);
    if (!p) continue;
    const r = Math.max(2, n.radius * cam.k);
    const dim = dimOf(n.id);
    const glow = recallGlow(n.recall?.lastAt, t);
    if (glow > 0) {
      const g = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r + 10);
      g.addColorStop(0, colors.brandTo!);
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = glow * dim;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = dim;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (n.color === 'ghost') {
      ctx.strokeStyle = colors.sub!;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      if (n.color === 'self') {
        const g = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r);
        g.addColorStop(0, colors.brandFrom!);
        g.addColorStop(1, colors.brandTo!);
        ctx.fillStyle = g;
      } else ctx.fillStyle = colors[n.color]!;
      ctx.fill();
    }
    const ring = props.rings.get(n.id);
    if (ring) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + (ring === 'resident' ? 3 : 4), 0, Math.PI * 2);
      ctx.strokeStyle =
        ring === 'keyword' ? colors.brandTo! : ring === 'vector' ? colors.cool! : colors.main!;
      ctx.lineWidth = ring === 'resident' ? 1 : 2.5;
      ctx.stroke();
    } else if (searching && props.hits.has(n.id)) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = colors.main!;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (n.id === props.selected) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = colors.brandTo!;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // 标签：按缩放淡入 + 固定优先级占位（不闪、不重叠）
  const px = labelFontPx(cam.k);
  const font = fontOf(px);
  const base = labelAlpha(cam.k);
  const cands: LabelCandidate[] = [];
  const texts = new Map<string, string>();
  for (const n of view.nodes) {
    const p = sp(n.id);
    if (!p || p.x < -200 || p.y < -50 || p.x > size.w + 200 || p.y > size.h + 50) continue;
    const tier: LabelTier =
      n.id === hoverId
        ? 0
        : n.id === props.selected
          ? 1
          : n.kind === 'profile'
            ? 2
            : props.hits.has(n.id) || props.rings.has(n.id)
              ? 3
              : 4;
    if (tier === 4 && base <= 0) continue;
    const text = truncateLabel(n.title);
    const w = textWidth(font, text);
    texts.set(n.id, text);
    cands.push({
      id: n.id,
      tier,
      degree: n.degree,
      title: n.title,
      x: p.x - w / 2,
      y: p.y + Math.max(2, n.radius * cam.k) + 4,
      w,
      h: px + 2,
    });
  }
  const tiers = new Map(cands.map((c) => [c.id, c]));
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.main!;
  for (const id of placeLabels(cands)) {
    const c = tiers.get(id)!;
    ctx.globalAlpha = (c.tier <= 3 ? 1 : base) * dimOf(id);
    ctx.fillText(texts.get(id)!, c.x + c.w / 2, c.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- 命中测试 ----------
function nodeAt(sx: number, sy: number): ViewNode | null {
  let best: ViewNode | null = null;
  let bestD = Infinity;
  for (const n of props.view.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const s = toScreen(cam, p.x, p.y);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= Math.max(6, n.radius * cam.k + 3) && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
function edgeAt(sx: number, sy: number): string | null {
  for (const e of props.view.edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (!a || !b || !e.context) continue;
    const A = toScreen(cam, a.x, a.y);
    const B = toScreen(cam, b.x, b.y);
    const vx = B.x - A.x;
    const vy = B.y - A.y;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1) continue;
    const t = Math.max(0, Math.min(1, ((sx - A.x) * vx + (sy - A.y) * vy) / len2));
    if (Math.hypot(A.x + vx * t - sx, A.y + vy * t - sy) < 4) return e.context;
  }
  return null;
}
function local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ---------- 指针 / 键盘 ----------
function onPointerDown(e: PointerEvent): void {
  const { x, y } = local(e);
  canvas.value?.setPointerCapture(e.pointerId);
  const n = nodeAt(x, y);
  tip.value = null;
  if (n) {
    drag = { kind: 'node', id: n.id, sx: x, sy: y, moved: false };
    return;
  }
  drag = { kind: 'pan', sx: x, sy: y, lastX: x, lastY: y, moved: false };
}
function onPointerMove(e: PointerEvent): void {
  const { x, y } = local(e);
  if (drag?.kind === 'pan') {
    if (Math.hypot(x - drag.sx, y - drag.sy) > 3) drag.moved = true;
    cam = panBy(cam, x - drag.lastX, y - drag.lastY);
    camTween = null;
    drag.lastX = x;
    drag.lastY = y;
    kick();
    return;
  }
  if (drag?.kind === 'node') {
    if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) <= 3) return;
    const w = toWorld(cam, x, y);
    const sn = simNodes.get(drag.id);
    if (!drag.moved) {
      drag.moved = true;
      posTween = null;
      if (sn && sim) pin(sim, sn, w.x, w.y);
    }
    if (sn) {
      sn.fx = w.x;
      sn.fy = w.y;
    } else {
      island.set(drag.id, w);
      pos.set(drag.id, w);
    }
    kick();
    return;
  }
  const n = nodeAt(x, y);
  const id = n?.id ?? null;
  if (id !== hoverId) {
    hoverId = id;
    kick();
  }
  if (n) {
    const full = n.title !== truncateLabel(n.title) || n.aliases.length;
    tip.value = full
      ? { x, y, text: n.aliases.length ? `${n.title}（${n.aliases.join('、')}）` : n.title }
      : null;
  } else {
    const ctx = edgeAt(x, y);
    tip.value = ctx ? { x, y, text: ctx } : null;
  }
  if (canvas.value) canvas.value.style.cursor = n ? 'pointer' : 'grab';
}
function onPointerUp(e: PointerEvent): void {
  canvas.value?.releasePointerCapture(e.pointerId);
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'node') {
    const sn = simNodes.get(d.id);
    if (d.moved) {
      if (sn && sim) unpin(sim, sn);
      saveLater();
      kick();
    } else emit('select', d.id);
    return;
  }
  if (!d.moved) emit('select', null);
}
function onPointerLeave(): void {
  if (hoverId) {
    hoverId = null;
    kick();
  }
  tip.value = null;
}
function onDblClick(e: MouseEvent): void {
  const { x, y } = local(e);
  const n = nodeAt(x, y);
  const p = n ? pos.get(n.id) : null;
  if (!p) return;
  animateCamera(centerOn(cam, p.x, p.y, { w: size.w - props.rightInset, h: size.h }, 1.6));
}
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const { x, y } = local(e);
  cam = zoomAt(cam, x, y, Math.exp(-e.deltaY * 0.0015));
  camTween = null;
  tip.value = null;
  kick();
}
function onKey(e: KeyboardEvent): void {
  const step = 40;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  if (moves[e.key]) {
    cam = panBy(cam, ...moves[e.key]!);
  } else if (e.key === '+' || e.key === '=') zoomBy(1.25);
  else if (e.key === '-') zoomBy(0.8);
  else if (e.key === 'Escape') emit('select', null);
  else return;
  e.preventDefault();
  kick();
}

// ---------- 对外 ----------
function zoomBy(f: number): void {
  animateCamera(zoomAt(camTween?.to ?? cam, size.w / 2, size.h / 2, f));
}
function fitAll(): void {
  animateCamera(fitCamera(currentTargets()));
}
/** 平滑居中到某节点（搜索回车用；缩放不变，避开右侧阅读栏）。 */
function focusNode(id: string): void {
  const p = pos.get(id);
  if (!p) return;
  const base = camTween?.to ?? cam;
  animateCamera(centerOn(base, p.x, p.y, { w: size.w - props.rightInset, h: size.h }));
}
defineExpose({ zoomBy, fitAll, focusNode });

// 选中节点平移到阅读栏左侧的可见区
watch(
  () => props.selected,
  (id) => {
    const p = id ? pos.get(id) : null;
    if (!p) return kick();
    const s = toScreen(cam, p.x, p.y);
    const right = size.w - props.rightInset - 40;
    if (s.x < 40 || s.x > right || s.y < 40 || s.y > size.h - 40)
      animateCamera(centerOn(cam, p.x, p.y, { w: size.w - props.rightInset, h: size.h }));
    else kick();
  },
);
// 试一句：视口平移到命中范围
watch(
  () => props.rings,
  (rings) => {
    if (rings.size > 0) {
      const ids = new Set([...rings.keys()].filter((id) => pos.has(id)));
      if (ids.size) animateCamera(fitCamera(pos, ids));
    }
    kick();
  },
);
watch(() => props.hits, kick);
watch(() => props.view, layout);
watch(
  () => props.cid,
  () => {
    pos = new Map();
    needFit = true;
    layout();
  },
);

// ---------- 生命周期 ----------
let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;
function resize(): void {
  const el = wrap.value;
  const c = canvas.value;
  if (!el || !c) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w === 0 || h === 0) return;
  size.w = w;
  size.h = h;
  size.dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * size.dpr);
  c.height = Math.round(h * size.dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  if (needFit && pos.size) {
    cam = fitCamera(pos);
    needFit = false;
  }
  kick();
}
function onVisibility(): void {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else kick();
}
onMounted(() => {
  readColors();
  resize();
  layout();
  ro = new ResizeObserver(resize);
  if (wrap.value) ro.observe(wrap.value);
  mo = new MutationObserver(() => {
    readColors();
    kick();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  sim?.stop();
  saveLater.cancel();
  if (pos.size) savePositions(window.localStorage, props.cid, pos);
  ro?.disconnect();
  mo?.disconnect();
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div ref="wrap" class="relative h-full w-full overflow-hidden">
    <canvas
      ref="canvas"
      class="block touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-brand-to/40"
      tabindex="0"
      role="img"
      :aria-label="label"
      style="cursor: grab"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @dblclick="onDblClick"
      @wheel="onWheel"
      @keydown="onKey"
    />
    <div
      v-if="tip"
      class="ds-glass pointer-events-none absolute z-10 max-w-[320px] rounded-btn px-2 py-1 text-xs text-text-main"
      :style="{ left: `${tip.x + 12}px`, top: `${tip.y + 12}px` }"
    >
      {{ tip.text }}
    </div>
  </div>
</template>
