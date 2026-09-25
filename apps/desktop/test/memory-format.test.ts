import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMemoryGraph } from '../electron/main/memory-graph.js';
import { memoryFormatVersion, upgradeMemoryFormat } from '../electron/main/memory-format.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

const v1 = (title: string, keys: string[], body: string, summary = ''): string =>
  [
    '---',
    `title: ${JSON.stringify(title)}`,
    `keys: ${JSON.stringify(keys)}`,
    `summary: ${JSON.stringify(summary)}`,
    'updated: 2026-09-01',
    'source: llm',
    '---',
    '',
    body,
    '',
  ].join('\n');

/** 按 ⑲ 真实落盘格式造一个 v1 库。 */
function makeV1(): { parent: string; root: string } {
  const parent = mkdtempSync(path.join(tmpdir(), 'ds-fmt-'));
  cleanups.push(parent);
  const root = path.join(parent, 'memory');
  const w = (rel: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  w(
    'user/profile.md',
    v1(
      '用户档案',
      [],
      '## 一句话档案\n\n程序员，室友王小明\n\n## 身份\n\n\n\n## 杂项\n\n<!-- locked -->\n王小明是我手写的',
    ),
  );
  w('user/people/xiao-ming.md', v1('王小明', ['小王'], '大学室友，周末常去徒步', '大学室友'));
  w('user/people/xiao-ming.md.prev', v1('王小明', ['小王'], '旧版'));
  w('user/topics/pa-shan.md', v1('爬山', ['徒步'], '周末活动'));
  w('user/people/a.md', v1('冲突', [], '甲'));
  w('user/people/冲突.md', v1('冲突', [], '乙'));
  w(
    'characters/furina/relationship.md',
    v1('我们的关系', [], '## 称呼\n\n阿芙\n\n## 约定\n\n\n\n## 禁忌\n\n\n\n## 亲密度叙事\n\n'),
  );
  w(
    'characters/furina/timeline.md',
    v1('共同经历', [], '- 2026-09-02 聊到小王的猫\n- 2026-09-01 初次见面'),
  );
  w('index.md', '# 记忆索引\n');
  w('characters/furina/index.md', '# 记忆索引\n');
  return { parent, root };
}

const read = (root: string, rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const graphOf = (root: string) =>
  buildMemoryGraph(new MemoryWiki(root).listAllPages(), {
    scope: 'current',
    currentCid: 'furina',
    characterName: (c) => c,
  });

describe('㉒ memory-format v1 → v2 升级', () => {
  it('八步：备份 / keys→aliases + created / slug→中文文件名（含 .prev）/ 冲突保留 / 导航行 / 补链 / index 挪位 / 预设 / 标记', () => {
    const { parent, root } = makeV1();
    const r = upgradeMemoryFormat(root, { now: () => 123 });
    expect(r.upgraded).toBe(true);
    expect(r.error).toBeUndefined();
    // 1 备份：内容一致
    const bak = path.join(parent, 'memory.bak-v1-123');
    expect(r.backup).toBe(bak);
    expect(readFileSync(path.join(bak, 'user/people/xiao-ming.md'), 'utf8')).toContain('keys:');
    // 2 frontmatter
    const wm = read(root, 'user/people/王小明.md');
    expect(wm).toContain('aliases:\n  - 小王');
    expect(wm).toContain('created: 2026-09-01');
    expect(wm).not.toContain('keys:');
    expect(read(root, 'user/profile.md')).toContain('aliases:\n  - 用户档案');
    // 3 改名（含 .prev）；冲突保留原名
    expect(r.renamed).toContainEqual(['user/people/xiao-ming.md', 'user/people/王小明.md']);
    expect(r.renamed).toContainEqual(['user/topics/pa-shan.md', 'user/topics/爬山.md']);
    expect(existsSync(path.join(root, 'user/people/xiao-ming.md'))).toBe(false);
    expect(read(root, 'user/people/王小明.md.prev')).toContain('旧版');
    expect(existsSync(path.join(root, 'user/people/a.md'))).toBe(true);
    // 4 导航行
    expect(read(root, 'characters/furina/relationship.md')).toContain(
      '> [[profile|用户档案]] · [[characters/furina/timeline|共同经历]]\n\n## 称呼',
    );
    expect(read(root, 'characters/furina/timeline.md')).toContain(
      '> [[characters/furina/relationship|我们的关系]]\n\n- 2026-09-02',
    );
    // 5 存量补链：锁定节原文不变
    expect(read(root, 'user/profile.md')).toContain('程序员，室友[[王小明]]');
    expect(read(root, 'user/profile.md')).toContain('<!-- locked -->\n王小明是我手写的');
    expect(read(root, 'characters/furina/timeline.md')).toContain('聊到[[王小明|小王]]的猫');
    expect(read(root, 'user/people/王小明.md')).toContain('周末常去[[爬山|徒步]]');
    expect(r.linked).toBeGreaterThanOrEqual(3);
    const g = graphOf(root);
    const link = (s: string, t: string) =>
      g.edges.some((e) => e.kind === 'link' && e.source === s && e.target === t);
    expect(link('user/profile.md', 'user/people/王小明.md')).toBe(true);
    expect(link('characters/furina/timeline.md', 'user/people/王小明.md')).toBe(true);
    expect(link('user/people/王小明.md', 'user/topics/爬山.md')).toBe(true);
    expect(link('characters/furina/relationship.md', 'user/profile.md')).toBe(true);
    // 6 index 挪位
    expect(existsSync(path.join(root, 'index.md'))).toBe(false);
    expect(existsSync(path.join(root, 'characters/furina/index.md'))).toBe(false);
    expect(read(root, '.openpet/index.md')).toContain('[[王小明]]（人物）');
    expect(read(root, '.openpet/characters/furina/index.md')).toContain('## 本角色');
    // 7 预设 + 8 标记
    expect(JSON.parse(read(root, '.obsidian/app.json'))).toMatchObject({
      useMarkdownLinks: false,
      newLinkFormat: 'shortest',
    });
    expect(JSON.parse(read(root, '.obsidian/graph.json')).colorGroups[1]).toEqual({
      query: 'path:user/people',
      color: { a: 1, rgb: 0xffb4a2 },
    });
    expect(memoryFormatVersion(root)).toBe(2);
    // 已升级 → no-op
    expect(upgradeMemoryFormat(root, { now: () => 456 })).toMatchObject({ upgraded: false });
    expect(existsSync(path.join(parent, 'memory.bak-v1-456'))).toBe(false);
  });

  it('幂等：标记丢失后重跑，内容逐字节不变（补链 / 导航行不重复）', () => {
    const { root } = makeV1();
    upgradeMemoryFormat(root, { now: () => 1 });
    const snapshot = (): Record<string, string> =>
      Object.fromEntries(
        ['user/profile.md', 'user/people/王小明.md', 'user/topics/爬山.md', 'characters/furina/relationship.md', 'characters/furina/timeline.md'].map(
          (r) => [r, read(root, r)],
        ),
      );
    const before = snapshot();
    rmSync(path.join(root, '.openpet/format.json'));
    const r2 = upgradeMemoryFormat(root, { now: () => 2 });
    expect(r2.renamed).toEqual([]);
    expect(r2.linked).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it('中途抛错：不写标记（下次重试）；.obsidian 已存在不覆盖；新装只写预设与标记', () => {
    const { parent, root } = makeV1();
    const blocker = path.join(parent, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const logs: string[] = [];
    const r = upgradeMemoryFormat(root, { backupRoot: blocker, log: (m) => logs.push(m) });
    expect(r.upgraded).toBe(false);
    expect(r.error).toBeTruthy();
    expect(logs).toHaveLength(1);
    expect(memoryFormatVersion(root)).toBe(0);

    mkdirSync(path.join(root, '.obsidian'));
    writeFileSync(path.join(root, '.obsidian/app.json'), '{"mine":true}');
    expect(upgradeMemoryFormat(root).upgraded).toBe(true);
    expect(read(root, '.obsidian/app.json')).toBe('{"mine":true}');
    // 备份跳过 .obsidian
    const baks = readdirSync(parent).filter((n) => n.startsWith('memory.bak-v1-'));
    expect(baks).toHaveLength(1);
    expect(existsSync(path.join(parent, baks[0]!, '.obsidian'))).toBe(false);

    const fresh = path.join(parent, 'fresh');
    const f = upgradeMemoryFormat(fresh);
    expect(f).toMatchObject({ upgraded: false, renamed: [] });
    expect(memoryFormatVersion(fresh)).toBe(2);
    expect(existsSync(path.join(fresh, '.obsidian/graph.json'))).toBe(true);
    expect(readdirSync(parent).filter((n) => n.startsWith('fresh.bak'))).toEqual([]);
  });
});
