/**
 * ㉒ 力模拟包装（spec §4.3；d3-force，默认 LCG 随机源 → 同输入同坐标，可断言）。
 * 参数：link 距离 60 / charge −180（distanceMax 400）/ forceX·Y 0.06 / collide 半径 + 4。
 * **先定型再上屏**：数据到达后 settleSync 同步跑完再画第一帧；只有拖拽时实时模拟（reheat），
 * 冷却到 alphaMin 自然停。孤岛节点不进模拟（graph-layout.islandPositions 摆放）。
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Point } from './graph-layout.js';

export interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
}
export type SimLink = SimulationLinkDatum<SimNode>;
export type GraphSim = Simulation<SimNode, SimLink>;

export const SIM_ALPHA_MIN = 0.005;

export function createSim(
  nodes: SimNode[],
  links: ReadonlyArray<{ source: string; target: string }>,
): GraphSim {
  const ids = new Set(nodes.map((n) => n.id));
  const ls: SimLink[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target }));
  return forceSimulation<SimNode, SimLink>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(ls)
        .id((d) => d.id)
        .distance(60),
    )
    .force('charge', forceManyBody<SimNode>().strength(-180).distanceMax(400))
    .force('x', forceX<SimNode>(0).strength(0.06))
    .force('y', forceY<SimNode>(0).strength(0.06))
    .force(
      'collide',
      forceCollide<SimNode>((d) => d.r + 4),
    )
    .alphaMin(SIM_ALPHA_MIN)
    .stop();
}

/** 同步跑 n 步（首帧前必跑）。已有存档坐标时调用方先把 alpha 设低（0.1）只做低温微调。 */
export function settleSync(sim: GraphSim, n = 300): void {
  for (let i = 0; i < n && sim.alpha() >= SIM_ALPHA_MIN; i++) sim.tick();
}

/** 拖拽开始：固定跟随并升温（alphaTarget 0.3）。 */
export function pin(sim: GraphSim, node: SimNode, x: number, y: number): void {
  node.fx = x;
  node.fy = y;
  sim.alphaTarget(0.3);
  if (sim.alpha() < 0.3) sim.alpha(0.3);
}

/** 松手：解除固定，alphaTarget 回 0 自然冷却。 */
export function unpin(sim: GraphSim, node: SimNode): void {
  node.fx = null;
  node.fy = null;
  sim.alphaTarget(0);
}

/** 模拟仍在跑（需要 RAF）。 */
export function isHot(sim: GraphSim): boolean {
  return sim.alpha() >= SIM_ALPHA_MIN;
}

/** 刷新补间起点：旧坐标沿用；返回沿用数。 */
export function mergePositions(prev: ReadonlyMap<string, Point>, next: SimNode[]): number {
  let n = 0;
  for (const node of next) {
    const p = prev.get(node.id);
    if (!p) continue;
    node.x = p.x;
    node.y = p.y;
    n++;
  }
  return n;
}
