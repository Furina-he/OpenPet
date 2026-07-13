import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import {
  mapStCardToSoul,
  normalizeStCard,
  pickCharacterId,
  readStCard,
  readStCardFromPng,
  sanitizeText,
} from '../electron/main/st-card.js';

/** 测试用 PNG 构造器：签名 + IHDR + tEXt(keyword=base64(json)) + IEND；CRC 乱填（解析器不验）。 */
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

const V2 = {
  spec: 'chara_card_v2',
  data: { name: 'Aqua', description: '水之女神{{char}}', first_mes: '你来啦，{{user}}！' },
};

describe('readStCardFromPng', () => {
  it('读 chara(V2) tEXt 块', () => {
    const raw = readStCardFromPng(pngWithText([['chara', JSON.stringify(V2)]])) as typeof V2;
    expect(raw.data.name).toBe('Aqua');
  });
  it('ccv3 优先于 chara（照 ST 读取语义）', () => {
    const v3 = { spec: 'chara_card_v3', data: { name: 'AquaV3' } };
    const raw = readStCardFromPng(
      pngWithText([['chara', JSON.stringify(V2)], ['ccv3', JSON.stringify(v3)]]),
    ) as typeof v3;
    expect(raw.data.name).toBe('AquaV3');
  });
  it('无角色数据的 PNG / 非 PNG 各自明确报错', () => {
    expect(() => readStCardFromPng(pngWithText([]))).toThrow(/chara/);
    expect(() => readStCardFromPng(Buffer.from('not a png'))).toThrow(/PNG/);
  });
});

describe('normalizeStCard（V1/V2/V3 归一 + 清洗）', () => {
  it('V2 取 data.*；V1 顶层字段也认', () => {
    expect(normalizeStCard(V2).name).toBe('Aqua');
    expect(normalizeStCard({ name: 'Old', description: 'v1 卡' }).name).toBe('Old');
  });
  it('字段类型不对不炸（catch 空串）；控制字符剥离；name 空拒绝', () => {
    const card = normalizeStCard({ data: { name: 'A\u0000B', description: 42, tags: ['ok', 7] } });
    expect(card.name).toBe('AB');
    expect(card.description).toBe('');
    expect(card.tags).toEqual(['ok']);
    expect(() => normalizeStCard({ data: { description: '无名卡' } })).toThrow(/name/);
  });
  it('sanitizeText：CRLF 归一 + 截断', () => {
    expect(sanitizeText('a\r\nb\u0007', 100)).toBe('a\nb');
    expect(sanitizeText('xxxxx', 3)).toBe('xxx');
  });
});

describe('readStCard（按扩展名分发）', () => {
  it('png：卡数据 + 头像=原图', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stcard-'));
    const p = path.join(dir, 'aqua.png');
    writeFileSync(p, pngWithText([['chara', JSON.stringify(V2)]]));
    const { card, avatar } = readStCard(p);
    expect(card.name).toBe('Aqua');
    expect(avatar?.ext).toBe('png');
  });
  it('charx：card.json + embeded:// icon（name=main 优先）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stcard-'));
    const p = path.join(dir, 'aqua.charx');
    const zip = new AdmZip();
    zip.addFile('card.json', Buffer.from(JSON.stringify({
      spec: 'chara_card_v3',
      data: {
        name: 'AquaX',
        assets: [
          { type: 'icon', uri: 'embeded://assets/icon/other.png', name: 'other', ext: 'png' },
          { type: 'icon', uri: 'embeded://assets/icon/main.png', name: 'main', ext: 'png' },
        ],
      },
    })));
    zip.addFile('assets/icon/main.png', Buffer.from('MAIN'));
    zip.addFile('assets/icon/other.png', Buffer.from('OTHER'));
    zip.writeZip(p);
    const { card, avatar } = readStCard(p);
    expect(card.name).toBe('AquaX');
    expect(avatar?.buf.toString()).toBe('MAIN');
  });
  it('json：无头像；未知扩展名报错', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stcard-'));
    const p = path.join(dir, 'aqua.json');
    writeFileSync(p, JSON.stringify(V2), 'utf8');
    expect(readStCard(p).avatar).toBeNull();
    expect(() => readStCard(path.join(dir, 'aqua.webp'))).toThrow(/不支持/);
  });
});

describe('mapStCardToSoul（spec §2 映射表）', () => {
  it('description/personality/scenario/mes_example 合成 systemPrompt；<START> 剥离', () => {
    const soul = mapStCardToSoul(normalizeStCard({ data: {
      name: 'Aqua', description: '女神', personality: '傲娇', scenario: '酒馆',
      mes_example: '<START>\n{{char}}: 哼！', first_mes: '来啦 {{user}}',
      alternate_greetings: ['备用1'], creator: 'painter', creator_notes: '注释',
      character_version: '2.1', tags: ['fantasy'],
    } }));
    expect(soul.persona.systemPrompt).toContain('女神');
    expect(soul.persona.systemPrompt).toContain('## 性格\n傲娇');
    expect(soul.persona.systemPrompt).toContain('## 场景\n酒馆');
    expect(soul.persona.systemPrompt).toContain('{{char}}: 哼！');
    expect(soul.persona.systemPrompt).not.toContain('<START>');
    expect(soul.persona.greetings).toEqual(['来啦 {{user}}', '备用1']);
    expect(soul.persona.beginDialogs).toEqual([]);
    expect(soul).toMatchObject({ name: 'Aqua', version: '2.1', author: 'painter', description: '注释', tags: ['fantasy'] });
  });
  it('system_prompt 的 {{original}} 替换为合成体；无占位则前置', () => {
    const withOrig = mapStCardToSoul(normalizeStCard({ data: { name: 'A', description: 'D', system_prompt: '前缀 {{original}} 后缀' } }));
    expect(withOrig.persona.systemPrompt).toBe('前缀 D 后缀');
    const noOrig = mapStCardToSoul(normalizeStCard({ data: { name: 'A', description: 'D', system_prompt: 'SYS' } }));
    expect(noOrig.persona.systemPrompt).toBe('SYS\n\nD');
  });
  it('全空卡兜底一句人设；version 空回退 1.0', () => {
    const soul = mapStCardToSoul(normalizeStCard({ data: { name: 'Bare' } }));
    expect(soul.persona.systemPrompt).toBe('你是Bare。');
    expect(soul.version).toBe('1.0');
    expect(soul.persona.greetings).toBeUndefined();
    expect(soul.lorebook).toBeUndefined();
  });
  it('character_book：数组与 {uid: entry} 两形态、snake→camel、空 content 丢弃', () => {
    const book = {
      scan_depth: 6, token_budget: 500,
      entries: {
        '0': { keys: ['Nyx'], content: '城', insertion_order: 5, case_sensitive: true, comment: '城设定' },
        '1': { keys: ['dead'], content: '' },
        '2': { content: '常驻背景', constant: true, enabled: false },
      },
    };
    const soul = mapStCardToSoul(normalizeStCard({ data: { name: 'A', character_book: book } }));
    expect(soul.lorebook).toMatchObject({ scanDepth: 6, tokenBudget: 500 });
    expect(soul.lorebook?.entries).toHaveLength(2);
    expect(soul.lorebook?.entries[0]).toMatchObject({ keys: ['Nyx'], insertionOrder: 5, caseSensitive: true, name: '城设定' });
    expect(soul.lorebook?.entries[1]).toMatchObject({ constant: true, enabled: false });
  });
  it('⑭ post_history_instructions → persona.styleAnchor（回捡）；空/缺失不带键', () => {
    const soul = mapStCardToSoul(normalizeStCard({ data: { name: 'A', post_history_instructions: '短句，禁书面语' } }));
    expect(soul.persona.styleAnchor).toBe('短句，禁书面语');
    const bare = mapStCardToSoul(normalizeStCard({ data: { name: 'A' } }));
    expect(bare.persona.styleAnchor).toBeUndefined();
  });
});

describe('pickCharacterId', () => {
  it('ASCII 名 slug 化；冲突 -2 自增', () => {
    expect(pickCharacterId('Aqua Chan!', () => false)).toBe('aqua-chan');
    expect(pickCharacterId('Aqua', (id) => id === 'aqua')).toBe('aqua-2');
  });
  it('CJK 名回退 st-<hash>（确定性）且符合 CHARACTER_ID_RE', () => {
    const id = pickCharacterId('芙宁娜', () => false);
    expect(id).toMatch(/^st-[a-z0-9]+$/);
    expect(pickCharacterId('芙宁娜', () => false)).toBe(id);
  });
});
