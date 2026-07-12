import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema } from '@openpet/protocol';
import { describe, expect, it } from 'vitest';
import { inspectStCard, installStCard } from '../electron/main/st-card-import.js';

/** 复用 st-card.test.ts 的 PNG 构造器（复制一份，测试文件各自自足）。 */
function pngWithText(pairs: Array<[string, string]>): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const texts = pairs.map(([k, v]) =>
    chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(Buffer.from(v, 'utf8').toString('base64'), 'latin1')])),
  );
  return Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), ...texts, chunk('IEND', Buffer.alloc(0))]);
}

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Aqua', description: '女神', first_mes: '来啦 {{user}}', creator: 'painter', tags: ['fantasy'],
    character_book: { entries: [{ keys: ['Nyx'], content: '城设定' }] },
  },
};

/** 形象来源（donor）夹具：vrm 包目录（manifest + 模型文件 + 立绘）。 */
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'st-import-'));
  const donorRoot = path.join(root, 'builtin');
  const donorDir = path.join(donorRoot, 'hero');
  mkdirSync(donorDir, { recursive: true });
  writeFileSync(path.join(donorDir, 'manifest.json'), JSON.stringify({
    id: 'hero', name: 'Hero', version: '1.0', engine: 'vrm', model: 'hero.vrm',
    actions: ['wave'], preview: 'hero.png', voice: 'v-1',
  }));
  writeFileSync(path.join(donorDir, 'hero.vrm'), 'VRMDATA');
  writeFileSync(path.join(donorDir, 'hero.png'), 'PREVIEW');
  const cardPath = path.join(root, 'aqua.png');
  writeFileSync(cardPath, pngWithText([['chara', JSON.stringify(CARD)]]));
  const importedRoot = path.join(root, 'imported');
  return { root, donorRoot, cardPath, importedRoot };
}

describe('inspectStCard', () => {
  it('返回导入摘要', () => {
    const f = makeFixture();
    expect(inspectStCard(f.cardPath)).toEqual({
      name: 'Aqua', creator: 'painter', version: '1.0',
      greetingCount: 1, lorebookCount: 1, tags: ['fantasy'], hasAvatar: true,
    });
  });
});

describe('installStCard（灵魂 + 形象复制）', () => {
  it('合成包：肉体承 donor、灵魂来自卡、preview=卡图、voice 不承', () => {
    const f = makeFixture();
    const { id } = installStCard({
      cardPath: f.cardPath, donorId: 'hero', donorRoot: f.donorRoot,
      importedRoot: f.importedRoot, exists: () => false,
    });
    expect(id).toBe('aqua');
    const dest = path.join(f.importedRoot, 'aqua');
    const m = CharacterManifestSchema.parse(JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8')));
    expect(m).toMatchObject({
      id: 'aqua', name: 'Aqua', engine: 'vrm', model: 'hero.vrm',
      actions: ['wave'], preview: 'card.png', author: 'painter', tags: ['fantasy'],
    });
    expect(m.voice).toBeUndefined();
    expect(m.persona?.systemPrompt).toContain('女神');
    expect(m.persona?.greetings).toEqual(['来啦 {{user}}']);
    expect(m.lorebook?.entries[0]?.keys).toEqual(['Nyx']);
    expect(readFileSync(path.join(dest, 'hero.vrm'), 'utf8')).toBe('VRMDATA'); // 形象自包含
    expect(existsSync(path.join(dest, 'card.png'))).toBe(true);
  });
  it('id 冲突自增；donor 缺 manifest 报错', () => {
    const f = makeFixture();
    const { id } = installStCard({
      cardPath: f.cardPath, donorId: 'hero', donorRoot: f.donorRoot,
      importedRoot: f.importedRoot, exists: (x) => x === 'aqua',
    });
    expect(id).toBe('aqua-2');
    expect(() =>
      installStCard({ cardPath: f.cardPath, donorId: 'ghost', donorRoot: f.donorRoot, importedRoot: f.importedRoot, exists: () => false }),
    ).toThrow();
  });
});
