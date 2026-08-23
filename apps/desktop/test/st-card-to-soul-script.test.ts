import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema } from '@openpet/protocol';
import { describe, expect, it } from 'vitest';
// @ts-expect-error —— 仓库根的零依赖 CLI 工具（.mjs，无类型声明；本测试只验产物契约）
import { convertCard, mapCardToSoul, normalizeCard, pickId } from '../../../scripts/st-card-to-soul.mjs';
import { installSoulPack, readSoulPack } from '../electron/main/soul-compose.js';
import { installStCard } from '../electron/main/st-card-import.js';

/** ST 卡 PNG 构造器（同 st-card-import.test.ts）。 */
function pngWithText(pairs: Array<[string, string]>): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const texts = pairs.map(([k, v]) =>
    chunk(
      'tEXt',
      Buffer.concat([
        Buffer.from(k, 'latin1'),
        Buffer.from([0]),
        Buffer.from(Buffer.from(v, 'utf8').toString('base64'), 'latin1'),
      ]),
    ),
  );
  return Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), ...texts, chunk('IEND', Buffer.alloc(0))]);
}

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Aqua',
    description: '女神',
    personality: '爱哭',
    first_mes: '来啦 {{user}}',
    alternate_greetings: ['又是你'],
    post_history_instructions: '别写旁白',
    creator: 'painter',
    creator_notes: '来自某作品的二创',
    character_version: '1.3',
    tags: ['fantasy'],
    character_book: { entries: [{ keys: ['Nyx'], content: '城设定' }] },
  },
};

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'card2soul-'));
  const cardPath = path.join(root, 'aqua.png');
  writeFileSync(cardPath, pngWithText([['chara', JSON.stringify(CARD)]]));
  // donor 形象包
  const donorRoot = path.join(root, 'builtin');
  const donorDir = path.join(donorRoot, 'hero');
  mkdirSync(donorDir, { recursive: true });
  writeFileSync(
    path.join(donorDir, 'manifest.json'),
    JSON.stringify({
      id: 'hero',
      name: 'Hero',
      version: '1.0',
      engine: 'vrm',
      model: 'hero.vrm',
      actions: ['wave'],
    }),
  );
  writeFileSync(path.join(donorDir, 'hero.vrm'), 'VRM');
  return { root, cardPath, donorRoot, importedRoot: path.join(root, 'imported') };
}

describe('st-card-to-soul.mjs（上架转换脚本）', () => {
  it('产出的 .dssoul 能被 readSoulPack 解析（zip 写入格式互通）', () => {
    const f = fixture();
    const { soul, packBuf } = convertCard(f.cardPath);
    const packPath = path.join(f.root, 'out.dssoul');
    writeFileSync(packPath, packBuf);
    const read = readSoulPack(packPath);
    expect(read.soul.id).toBe(soul.id);
    expect(read.soul.name).toBe('Aqua');
    expect(read.preview?.relPath).toBe('preview.png'); // PNG 卡自带头像
  });

  it('产出的灵魂包走真安装链 → 合法角色包（肉体来自 donor）', () => {
    const f = fixture();
    const { packBuf } = convertCard(f.cardPath);
    const packPath = path.join(f.root, 'out.dssoul');
    writeFileSync(packPath, packBuf);
    const { id } = installSoulPack({
      soulPath: packPath,
      donorId: 'hero',
      donorRoot: f.donorRoot,
      importedRoot: f.importedRoot,
      exists: () => false,
    });
    const m = CharacterManifestSchema.parse(
      JSON.parse(readFileSync(path.join(f.importedRoot, id, 'manifest.json'), 'utf8')),
    );
    expect(m.engine).toBe('vrm');
    expect(m.model).toBe('hero.vrm');
    expect(m.persona?.greetings).toEqual(['来啦 {{user}}', '又是你']);
    expect(m.persona?.styleAnchor).toBe('别写旁白');
    expect(m.lorebook?.entries[0]?.keys).toEqual(['Nyx']);
    expect(existsSync(path.join(f.importedRoot, id, 'hero.vrm'))).toBe(true);
  });

  it('映射结果与 app 内 ⑫ 卡导入一致（同一张卡两条路径同人设）', () => {
    const f = fixture();
    const viaScript = convertCard(f.cardPath).soul;
    const { id } = installStCard({
      cardPath: f.cardPath,
      donorId: 'hero',
      donorRoot: f.donorRoot,
      importedRoot: f.importedRoot,
      exists: () => false,
    });
    const viaApp = CharacterManifestSchema.parse(
      JSON.parse(readFileSync(path.join(f.importedRoot, id, 'manifest.json'), 'utf8')),
    );
    expect(viaScript.persona.systemPrompt).toBe(viaApp.persona?.systemPrompt);
    expect(viaScript.persona.greetings).toEqual(viaApp.persona?.greetings);
    expect(viaScript.version).toBe(viaApp.version);
    expect(viaScript.author).toBe(viaApp.author);
    expect(viaScript.tags).toEqual(viaApp.tags);
    expect(viaScript.id).toBe(id); // id 派生规则同源
  });

  it('CJK 名 → st-<hash> id（与 app 内 pickCharacterId 同规则）；冲突自增', () => {
    expect(pickId('Aqua')).toBe('aqua');
    expect(pickId('芙宁娜')).toMatch(/^st-[0-9a-z]+$/);
    expect(pickId('Aqua', new Set(['aqua']))).toBe('aqua-2');
  });

  it('缺 name 的卡 → 报错（不产出坏包）', () => {
    expect(() => normalizeCard({ data: { name: '  ' } })).toThrow(/name/);
  });

  it('system_prompt 的 {{original}} 占位被展开（照 ST 语义）', () => {
    const card = normalizeCard({
      data: { name: 'X', description: '描述', system_prompt: '前置\n{{original}}\n后置' },
    });
    expect(mapCardToSoul(card, 'x').persona.systemPrompt).toBe('前置\n描述\n后置');
  });
});
