// apps/desktop/src/renderer/dev/memory-demo.ts
// ㉒ dev 浏览器视觉 harness 专用：记忆图谱样例数据（mock-bridge 用）。**行为不承诺**，只让 F3 图谱
// 在纯浏览器里有东西可看（人物 / 话题 / 固定页 / 未建页面 / 孤立页 / 提及 / 被想起光环）。
import type { MemoryGraph, MemoryGraphNode, MemoryProbeResult } from '@openpet/protocol';

const now = Date.now();
const node = (
  id: string,
  kind: MemoryGraphNode['kind'],
  title: string,
  extra: Partial<MemoryGraphNode> = {},
): MemoryGraphNode => ({
  id,
  title,
  kind,
  tags: [],
  aliases: [],
  chars: 120,
  readonly: false,
  updated: '2026-09-24',
  ...extra,
});

const P = (t: string): string => `user/people/${t}.md`;
const T = (t: string): string => `user/topics/${t}.md`;

export const DEMO_PAGES: Record<string, string> = {
  'user/profile.md':
    '---\ntitle: 用户档案\naliases:\n  - 用户档案\n---\n\n## 一句话档案\n\n深圳后端工程师，室友 [[王小明]]，周末爱 [[爬山]]。\n\n## 近况\n\n<!-- locked -->\n2026-09-30 面试 #求职\n',
  [P('王小明')]:
    '---\ntitle: 王小明\naliases:\n  - 小王\ntags:\n  - 同事\n---\n\n大学室友，现在和 [[李雷]] 一个组，常一起去 [[爬山]]、聊 [[三体]]。想去 [[珠峰]]。\n',
};

const nodes: MemoryGraphNode[] = [
  node('user/profile.md', 'profile', '我'),
  node(P('王小明'), 'people', '王小明', {
    aliases: ['小王'],
    tags: ['同事'],
    recall: { count: 12, lastAt: now - 20 * 60_000 },
  }),
  node(P('李雷'), 'people', '李雷', { recall: { count: 3, lastAt: now - 5 * 3_600_000 } }),
  node(P('韩梅梅'), 'people', '韩梅梅'),
  node(P('妈妈'), 'people', '妈妈', { tags: ['家人'] }),
  node(P('年糕'), 'people', '年糕', { tags: ['宠物'], recall: { count: 5, lastAt: now - 3 * 86_400_000 } }),
  node(T('爬山'), 'topics', '爬山', { aliases: ['徒步'] }),
  node(T('三体'), 'topics', '三体', { tags: ['爱好/阅读'] }),
  node(T('后端'), 'topics', '后端'),
  node(T('求职'), 'topics', '求职'),
  node(T('深圳'), 'topics', '深圳'),
  node(T('天气'), 'topics', '天气'),
  node(T('咖啡'), 'topics', '咖啡'),
  node('characters/default/relationship.md', 'relationship', '小灵 · 关系', { characterId: 'default' }),
  node('characters/default/timeline.md', 'timeline', '小灵 · 经历', { characterId: 'default' }),
  node('ghost:珠峰', 'ghost', '珠峰', { chars: 0 }),
];
const L = (source: string, target: string, context?: string, count = 1) => ({
  source,
  target,
  kind: 'link' as const,
  count,
  ...(context ? { context } : {}),
});
const edges: MemoryGraph['edges'] = [
  L('user/profile.md', P('王小明'), '深圳后端工程师，室友王小明'),
  L('user/profile.md', T('爬山')),
  L('user/profile.md', T('后端')),
  L('user/profile.md', T('深圳')),
  L('user/profile.md', T('求职'), '2026-09-30 面试'),
  L('user/profile.md', P('妈妈')),
  L(P('王小明'), P('李雷'), '现在和李雷一个组'),
  L(P('王小明'), T('爬山'), '常一起去爬山', 2),
  L(P('王小明'), T('三体')),
  L(P('王小明'), 'ghost:珠峰', '想去珠峰'),
  L(P('李雷'), P('韩梅梅')),
  L(P('李雷'), P('王小明')),
  L(P('李雷'), T('后端')),
  L(P('年糕'), 'user/profile.md'),
  L('characters/default/relationship.md', 'user/profile.md'),
  L('characters/default/relationship.md', 'characters/default/timeline.md'),
  L('characters/default/timeline.md', 'characters/default/relationship.md'),
  L('characters/default/timeline.md', P('王小明'), '我陪 ta 聊到王小明升职'),
  L('characters/default/timeline.md', P('年糕'), '第一次听说年糕'),
  L('characters/default/timeline.md', T('三体')),
  { source: T('爬山'), target: P('李雷'), kind: 'mention', count: 1, context: '李雷也去过' },
];

export const DEMO_GRAPH: MemoryGraph = {
  nodes,
  edges,
  stats: { pages: nodes.length - 1, links: edges.filter((e) => e.kind === 'link').length, ghosts: 1, orphans: 2 },
};

export const DEMO_PROBE: MemoryProbeResult = {
  resident: [
    { title: '用户档案', chars: 38 },
    { title: '我们的关系', chars: 20 },
    { title: '最近经历（我记下的）', chars: 60 },
  ],
  pages: [
    { path: P('王小明'), title: '王小明', via: 'keyword', chars: 64 },
    { path: T('爬山'), title: '爬山', via: 'keyword', chars: 30 },
    { path: T('深圳'), title: '深圳', via: 'vector', score: 0.71, chars: 22 },
  ],
  injectedChars: 234,
  budget: 2500,
  preview:
    '## 记忆（关于用户与我们的过往，供参考，自然使用，勿逐条复述；与当前对话冲突时以当前为准）\n### 用户档案\n深圳后端工程师，室友王小明……',
};
