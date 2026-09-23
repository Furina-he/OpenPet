import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BodyPackSchema, CODEX_LAYOUT, resolveSprite } from '@openpet/protocol';
import { describe, expect, it } from 'vitest';
import {
  checkCodexSheet,
  codexPetDirs,
  convertPet,
  normalizeId,
  petToBody,
  readImageSize,
  // @ts-expect-error —— 仓库根的零依赖 CLI 工具（.mjs，无类型声明；本测试只验产物契约）
} from '../../../scripts/codex-pet-to-body.mjs';
import { installBody, readInstalledBody } from '../electron/main/body-pack.js';

/** PNG：签名 + IHDR（只需头；安装链路不解码像素）。 */
function pngHeader(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    len,
    Buffer.from('IHDR', 'latin1'),
    ihdr,
    Buffer.alloc(4),
    Buffer.from('fake-idat-bytes'),
  ]);
}

function riff(fourcc: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + 8 + payload.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(fourcc, 12, 'latin1');
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload]);
}

/** WebP VP8X：flags(4) + (w−1)(3 LE) + (h−1)(3 LE)。 */
function webpVp8x(w: number, h: number): Buffer {
  const p = Buffer.alloc(10);
  p.writeUIntLE(w - 1, 4, 3);
  p.writeUIntLE(h - 1, 7, 3);
  return riff('VP8X', p);
}

/** WebP VP8L：0x2f + 14 位 (w−1) + 14 位 (h−1)。 */
function webpVp8l(w: number, h: number): Buffer {
  const p = Buffer.alloc(10);
  p[0] = 0x2f;
  p.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 1);
  return riff('VP8L', p);
}

/** WebP VP8（有损）：帧标签(3) + 起始码 9d 01 2a + w/h（16 位 LE，低 14 位）。 */
function webpVp8(w: number, h: number): Buffer {
  const p = Buffer.alloc(10);
  p[3] = 0x9d;
  p[4] = 0x01;
  p[5] = 0x2a;
  p.writeUInt16LE(w, 6);
  p.writeUInt16LE(h, 8);
  return riff('VP8 ', p);
}

function petDir(pet: Record<string, unknown>, sheetName: string, sheet: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-pet-'));
  writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(pet));
  mkdirSync(path.dirname(path.join(dir, sheetName)), { recursive: true });
  writeFileSync(path.join(dir, sheetName), sheet);
  return dir;
}

describe('readImageSize', () => {
  it('PNG IHDR / WebP VP8X / VP8L / VP8', () => {
    expect(readImageSize(pngHeader(1536, 1872))).toEqual({ format: 'png', width: 1536, height: 1872 });
    expect(readImageSize(webpVp8x(1536, 1872))).toEqual({ format: 'webp', width: 1536, height: 1872 });
    expect(readImageSize(webpVp8l(3072, 3744))).toEqual({ format: 'webp', width: 3072, height: 3744 });
    expect(readImageSize(webpVp8(1536, 1872))).toEqual({ format: 'webp', width: 1536, height: 1872 });
  });

  it('非图片 → 抛', () => {
    expect(() => readImageSize(Buffer.from('GIF89a........................'))).toThrow(/PNG/);
  });
});

describe('checkCodexSheet', () => {
  it('标准与 2× 通过；不可 8×9 等分 / 比例不符拒绝', () => {
    expect(() => checkCodexSheet({ width: 1536, height: 1872 })).not.toThrow();
    expect(() => checkCodexSheet({ width: 3072, height: 3744 })).not.toThrow();
    expect(() => checkCodexSheet({ width: 1537, height: 1872 })).toThrow(/等分/);
    expect(() => checkCodexSheet({ width: 1600, height: 1872 })).toThrow(/1536:1872/);
  });
});

describe('normalizeId', () => {
  it('slug 化 / CJK 回退确定性哈希 / 冲突加序号', () => {
    expect(normalizeId('Pixel Cat!')).toBe('pixel-cat');
    expect(normalizeId('小猫')).toMatch(/^pet-[a-z0-9]+$/);
    expect(normalizeId('小猫')).toBe(normalizeId('小猫'));
    expect(normalizeId('cat', new Set(['cat', 'cat-2']))).toBe('cat-3');
  });
});

describe('petToBody / convertPet', () => {
  const PET = { id: 'Mochi', displayName: 'Mochi 团子', description: '一只团子', spritesheetPath: 'spritesheet.webp' };

  it('pet.json → body.json（codex 布局、name ← displayName、元数据透传）', () => {
    const dir = petDir(PET, 'spritesheet.webp', webpVp8x(1536, 1872));
    const { body, files } = petToBody(dir, { license: 'CC-BY-4.0', author: 'me', pixel: true });
    expect(body).toEqual({
      id: 'mochi',
      name: 'Mochi 团子',
      version: '1.0.0',
      engine: 'sprite',
      model: 'spritesheet.webp',
      sprite: { layout: 'codex', smoothing: 'pixel' },
      author: 'me',
      description: '一只团子',
      license: 'CC-BY-4.0',
    });
    expect(BodyPackSchema.parse(body).engine).toBe('sprite');
    expect(files.map((f: { name: string }) => f.name)).toEqual(['body.json', 'spritesheet.webp']);
  });

  it('--id 指定 / --preview 打进包', () => {
    const dir = petDir(PET, 'spritesheet.webp', webpVp8x(1536, 1872));
    const pv = path.join(dir, 'art.png');
    writeFileSync(pv, pngHeader(10, 10));
    const { body, files } = petToBody(dir, { id: 'my-mochi', preview: pv });
    expect(body.id).toBe('my-mochi');
    expect(body.preview).toBe('preview.png');
    expect(files.map((f: { name: string }) => f.name)).toContain('preview.png');
  });

  it('拒绝：缺 pet.json / 尺寸不符 / 扩展名与格式不符 / 越界路径', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'codex-pet-'));
    expect(() => petToBody(empty)).toThrow(/pet\.json/);
    expect(() => petToBody(petDir(PET, 'spritesheet.webp', webpVp8x(1500, 1872)))).toThrow();
    expect(() => petToBody(petDir(PET, 'spritesheet.webp', pngHeader(1536, 1872)))).toThrow(/格式/);
    expect(() =>
      petToBody(petDir({ ...PET, spritesheetPath: '../x.webp' }, 'spritesheet.webp', webpVp8x(1536, 1872))),
    ).toThrow(/非法/);
    expect(() =>
      petToBody(petDir({ ...PET, spritesheetPath: 'sheet.gif' }, 'sheet.gif', Buffer.alloc(40))),
    ).toThrow(/png/);
  });

  it('产物经 body-pack.installBody 真装进形象库：schema 通过、图集字节一致、codex 预设可展开', () => {
    const sheet = pngHeader(1536, 1872);
    const dir = petDir({ ...PET, spritesheetPath: 'art/sheet.png' }, 'art/sheet.png', sheet);
    const { body, packBuf } = convertPet(dir, { license: 'CC0-1.0' });
    const work = mkdtempSync(path.join(tmpdir(), 'codex-body-'));
    const src = path.join(work, `${body.id}.dsbody`);
    writeFileSync(src, packBuf);
    const bodiesRoot = path.join(work, 'bodies');
    mkdirSync(bodiesRoot);
    installBody(src, bodiesRoot, () => false);
    const installed = readInstalledBody(bodiesRoot, body.id);
    expect(installed.body).toMatchObject({ id: 'mochi', engine: 'sprite', model: 'spritesheet.png' });
    expect(readFileSync(path.join(bodiesRoot, body.id, 'spritesheet.png')).equals(sheet)).toBe(true);
    const r = resolveSprite(installed.body.sprite!);
    expect(Object.keys(r.states)).toEqual(Object.keys(CODEX_LAYOUT.states));
  });
});

describe('codexPetDirs', () => {
  it('扫描 <home>/pets/* 中含 pet.json 的目录', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'codex-home-'));
    mkdirSync(path.join(home, 'pets', 'a'), { recursive: true });
    mkdirSync(path.join(home, 'pets', 'b'), { recursive: true });
    writeFileSync(path.join(home, 'pets', 'a', 'pet.json'), '{}');
    expect(codexPetDirs(home)).toEqual([path.join(home, 'pets', 'a')]);
    expect(codexPetDirs(path.join(home, 'nope'))).toEqual([]);
  });
});
