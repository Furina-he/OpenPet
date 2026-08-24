import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema, BodyPackSchema, type BodyPack } from '@openpet/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBody } from '../electron/main/soul-compose.js';
import { createCharacterService } from '../electron/main/character-service.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** 有灵魂的角色（人设/世界书/音色/元数据齐全）+ 两个形象包（vrm / live2d）。 */
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'ds-swap-fx-'));
  cleanups.push(root);
  const builtinRoot = path.join(root, 'builtin');
  const importedRoot = path.join(root, 'imported');
  const bodiesRoot = path.join(root, 'bodies');

  mkdirSync(path.join(builtinRoot, 'default'), { recursive: true });
  writeFileSync(
    path.join(builtinRoot, 'default', 'manifest.json'),
    JSON.stringify({ id: 'default', name: '小灵', version: '1.0', engine: 'vrm', model: 'd.vrm' }),
  );

  const charDir = path.join(importedRoot, 'sage');
  mkdirSync(charDir, { recursive: true });
  writeFileSync(
    path.join(charDir, 'manifest.json'),
    JSON.stringify({
      id: 'sage',
      name: '贤者',
      version: '2.1',
      engine: 'vrm',
      model: 'old.vrm',
      emotions: { happy: { happy: 1 } },
      actions: ['wave'],
      preview: 'old.png',
      persona: { systemPrompt: '你是贤者。', beginDialogs: ['你好', '嗯'], greetings: ['又见面了'] },
      lorebook: { entries: [{ keys: ['塔'], content: '塔在东边。' }] },
      voice: 'vp_sage',
      author: 'someone',
      description: '一位贤者',
      license: 'CC0-1.0',
      tags: ['fantasy'],
    }),
  );
  writeFileSync(path.join(charDir, 'old.vrm'), 'OLDVRM');
  writeFileSync(path.join(charDir, 'old.png'), 'OLDIMG');

  const mkBody = (b: Record<string, unknown>, files: Array<[string, string]>): BodyPack => {
    const body = BodyPackSchema.parse(b);
    const dir = path.join(bodiesRoot, body.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'body.json'), JSON.stringify(body));
    for (const [rel, data] of files) writeFileSync(path.join(dir, rel), data);
    return body;
  };

  const knight = mkBody(
    {
      id: 'knight',
      name: '骑士',
      version: '3.0',
      engine: 'vrm',
      model: 'knight.vrm',
      emotions: { angry: { angry: 1 } },
      actions: ['salute'],
      preview: 'knight.png',
      author: 'sculptor',
      license: 'CC-BY-4.0',
    },
    [
      ['knight.vrm', 'KNIGHTVRM'],
      ['knight.png', 'KNIGHTIMG'],
    ],
  );
  const doll = mkBody(
    {
      id: 'doll',
      name: '人偶',
      version: '1.0',
      engine: 'live2d',
      model: 'doll.model3.json',
      live2dEmotions: { happy: 'exp_01' },
    },
    [['doll.model3.json', '{}']],
  );

  return { root, builtinRoot, importedRoot, bodiesRoot, knight, doll, charDir };
}

const readManifest = (dir: string) =>
  CharacterManifestSchema.parse(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')));

const swap = (f: ReturnType<typeof makeFixture>, body: BodyPack, over = {}) =>
  swapBody({
    characterId: 'sage',
    characterRoot: f.importedRoot,
    importedRoot: f.importedRoot,
    body,
    bodyDir: path.join(f.bodiesRoot, body.id),
    ...over,
  });

describe('⑰ swapBody（换皮不换人）', () => {
  it('characterId 不变；灵魂/音色/元数据原地保留，肉体整组换成形象包的', () => {
    const f = makeFixture();
    const r = swap(f, f.knight);
    expect(r.id).toBe('sage');

    const m = readManifest(f.charDir);
    // 灵魂（含 voice = 第三层「声音」，不随肉体变）
    expect(m.id).toBe('sage');
    expect(m.name).toBe('贤者');
    expect(m.version).toBe('2.1');
    expect(m.persona?.systemPrompt).toBe('你是贤者。');
    expect(m.persona?.greetings).toEqual(['又见面了']);
    expect(m.lorebook?.entries[0]?.content).toBe('塔在东边。');
    expect(m.voice).toBe('vp_sage');
    expect(m.author).toBe('someone'); // 形象包作者不覆盖角色作者
    expect(m.license).toBe('CC0-1.0');
    expect(m.tags).toEqual(['fantasy']);
    // 肉体
    expect(m.engine).toBe('vrm');
    expect(m.model).toBe('knight.vrm');
    expect(m.emotions).toEqual({ angry: { angry: 1 } });
    expect(m.actions).toEqual(['salute']);
    expect(m.preview).toBe('knight.png');
    // 资产：新形象整包落位，旧模型消失，body.json 不进角色包
    expect(readFileSync(path.join(f.charDir, 'knight.vrm'), 'utf8')).toBe('KNIGHTVRM');
    expect(existsSync(path.join(f.charDir, 'old.vrm'))).toBe(false);
    expect(existsSync(path.join(f.charDir, 'body.json'))).toBe(false);
  });

  it('旧目录留一份 .bak（单份，下次换形象覆盖），且不出现在角色列表里', () => {
    const f = makeFixture();
    swap(f, f.knight);
    const bak = path.join(f.importedRoot, 'sage.bak');
    expect(readFileSync(path.join(bak, 'old.vrm'), 'utf8')).toBe('OLDVRM');

    swap(f, f.doll); // 第二次换形象 → .bak 被覆盖成上一版（骑士）
    expect(existsSync(path.join(bak, 'old.vrm'))).toBe(false);
    expect(readFileSync(path.join(bak, 'knight.vrm'), 'utf8')).toBe('KNIGHTVRM');

    const svc = createCharacterService({
      builtinRoot: f.builtinRoot,
      importedRoot: f.importedRoot,
      activeId: () => 'sage',
      setActiveId: () => {},
    });
    expect(svc.list().map((c) => c.characterId).sort()).toEqual(['default', 'sage']);
  });

  it('跨引擎（vrm → live2d）产出合法 manifest，词表随肉体走', () => {
    const f = makeFixture();
    swap(f, f.doll);
    const m = readManifest(f.charDir);
    expect(m.engine).toBe('live2d');
    expect(m.model).toBe('doll.model3.json');
    expect(m.live2dEmotions).toEqual({ happy: 'exp_01' });
    expect(m.emotions).toBeUndefined(); // 旧肉体词表不残留
    expect(m.preview).toBeUndefined();
    expect(m.persona?.systemPrompt).toBe('你是贤者。'); // 灵魂照旧
  });

  it('内置角色只读 → -32602「请复制后编辑」；角色不存在 → -32602', () => {
    const f = makeFixture();
    expect(() =>
      swapBody({
        characterId: 'default',
        characterRoot: f.builtinRoot,
        importedRoot: f.importedRoot,
        body: f.knight,
        bodyDir: path.join(f.bodiesRoot, 'knight'),
      }),
    ).toThrow(/内置角色只读/);
    expect(() =>
      swapBody({
        characterId: 'ghost',
        characterRoot: null,
        importedRoot: f.importedRoot,
        body: f.knight,
        bodyDir: path.join(f.bodiesRoot, 'knight'),
      }),
    ).toThrow(/not found/);
    expect(readManifest(f.charDir).model).toBe('old.vrm'); // 未触碰
  });

  it('形象目录缺失 → 校验阶段失败，角色目录零改动（先校验后替换）', () => {
    const f = makeFixture();
    expect(() =>
      swapBody({
        characterId: 'sage',
        characterRoot: f.importedRoot,
        importedRoot: f.importedRoot,
        body: f.knight,
        bodyDir: path.join(f.bodiesRoot, 'nope'),
      }),
    ).toThrow();
    expect(readManifest(f.charDir).model).toBe('old.vrm');
    expect(readFileSync(path.join(f.charDir, 'old.vrm'), 'utf8')).toBe('OLDVRM');
    expect(existsSync(path.join(f.importedRoot, 'sage.bak'))).toBe(false);
  });

  it('落位失败 → 回滚：原角色目录完好可用（.bak 即被恢复的那份）', () => {
    const f = makeFixture();
    expect(() =>
      swap(f, f.knight, {
        commit: () => {
          throw new Error('disk full');
        },
      }),
    ).toThrow(/disk full/);
    const m = readManifest(f.charDir);
    expect(m.model).toBe('old.vrm');
    expect(m.persona?.systemPrompt).toBe('你是贤者。');
    expect(readFileSync(path.join(f.charDir, 'old.vrm'), 'utf8')).toBe('OLDVRM');
    expect(existsSync(path.join(f.importedRoot, 'sage.bak'))).toBe(false); // 已 rename 回原位
  });

  it('换形象不动数据库：同 characterId 的记忆与会话历史查询结果不变（换皮不换人）', () => {
    const f = makeFixture();
    const store = new MemoryStore();
    store.memoryInsert('sage', '喜欢喝红茶', [0.1, 0.2], 1000);
    store.appendMessage({ characterId: 'sage', sessionId: 's1', role: 'user', text: '在吗', ts: 1 });
    store.appendMessage({
      characterId: 'sage',
      sessionId: 's1',
      role: 'assistant',
      text: '在的',
      ts: 2,
    });
    const factsBefore = store.memoryList('sage');
    const msgsBefore = store.recentMessages('sage', 's1', 10);

    swap(f, f.knight);

    expect(store.memoryList('sage')).toEqual(factsBefore);
    expect(store.recentMessages('sage', 's1', 10)).toEqual(msgsBefore);
    expect(readManifest(f.charDir).model).toBe('knight.vrm'); // 确实换了形象
  });

  it('形象包资产带子目录也照常整包落位', () => {
    const f = makeFixture();
    const dir = path.join(f.bodiesRoot, 'knight', 'textures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 't.png'), 'TEX');
    swap(f, f.knight);
    expect(readFileSync(path.join(f.charDir, 'textures', 't.png'), 'utf8')).toBe('TEX');
  });
});
