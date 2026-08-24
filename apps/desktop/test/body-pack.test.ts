import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectBody,
  installBody,
  listBodies,
  removeBody,
} from '../electron/main/body-pack.js';

const BODY = JSON.stringify({
  id: 'knight',
  name: '骑士',
  version: '1.0.0',
  engine: 'vrm',
  model: 'knight.vrm',
  emotions: { happy: { happy: 1 } },
  actions: ['wave'],
  preview: 'preview.png',
  license: 'CC-BY-4.0',
});
const cleanups: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-body-'));
  cleanups.push(d);
  return d;
};
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function makeZip(entries: Array<[string, string]>, name = 'body.dsbody'): string {
  const zip = new AdmZip();
  for (const [entry, content] of entries) zip.addFile(entry, Buffer.from(content));
  const file = path.join(tmp(), name);
  zip.writeZip(file);
  return file;
}

const fullZip = (): string =>
  makeZip([
    ['body.json', BODY],
    ['knight.vrm', 'VRMDATA'],
    ['preview.png', 'IMG'],
  ]);

describe('⑰ body-pack（.dsbody 肉体包安装）', () => {
  it('inspect：读 zip 根 body.json 摘要（不落盘）', () => {
    const b = inspectBody(fullZip());
    expect(b.id).toBe('knight');
    expect(b.engine).toBe('vrm');
    expect(b.emotions).toEqual({ happy: { happy: 1 } });
  });

  it('包根缺 body.json 拒绝', () => {
    expect(() => inspectBody(makeZip([['knight.vrm', 'x']]))).toThrow(/body\.json/);
  });

  it('灵魂字段被 schema 剥离（肉体包不带 persona/voice）', () => {
    const withSoul = makeZip([
      [
        'body.json',
        JSON.stringify({
          id: 'knight',
          name: '骑士',
          version: '1.0.0',
          engine: 'vrm',
          model: 'knight.vrm',
          persona: { systemPrompt: '不该在这里', beginDialogs: ['a', 'b'] },
          voice: 'v-1',
        }),
      ],
    ]);
    const b = inspectBody(withSoul) as Record<string, unknown>;
    expect('persona' in b).toBe(false);
    expect('voice' in b).toBe(false);
  });

  it('install → bodiesRoot/<id>；资产整包落位', () => {
    const bodiesRoot = tmp();
    const b = installBody(fullZip(), bodiesRoot, () => false);
    expect(b.id).toBe('knight');
    expect(existsSync(path.join(bodiesRoot, 'knight', 'knight.vrm'))).toBe(true);
    expect(existsSync(path.join(bodiesRoot, 'knight', 'body.json'))).toBe(true);
  });

  it('id 冲突拒绝（不静默改名，同 pack-import 口径）', () => {
    const bodiesRoot = tmp();
    installBody(fullZip(), bodiesRoot, () => false);
    expect(() => installBody(fullZip(), bodiesRoot, (id) => id === 'knight')).toThrow(/已存在/);
  });

  it('zip-slip：../ entry 拒绝安装且不留残骸', () => {
    // adm-zip 的 addFile 会 sanitize 掉 `..`——恶意 zip 须在字节层伪造 entry 名（同长度占位替换）。
    const evil = makeZip([
      ['body.json', BODY],
      ['xx/evil.txt', 'pwn'],
    ]);
    const buf = readFileSync(evil);
    const from = Buffer.from('xx/evil.txt');
    const to = Buffer.from('../evil.txt');
    let i: number;
    while ((i = buf.indexOf(from)) !== -1) to.copy(buf, i);
    writeFileSync(evil, buf);
    const bodiesRoot = tmp();
    expect(() => installBody(evil, bodiesRoot, () => false)).toThrow(/非法路径/);
    expect(existsSync(path.join(bodiesRoot, 'knight'))).toBe(false);
  });

  it('解压总量超限拒绝', () => {
    const big = makeZip([
      ['body.json', BODY],
      ['knight.vrm', 'x'.repeat(4096)],
    ]);
    expect(() => installBody(big, tmp(), () => false, 1024)).toThrow(/上限/);
  });

  it('list：扫 bodiesRoot（含大小/安装时间），坏包跳过；remove 删目录', () => {
    const bodiesRoot = tmp();
    installBody(fullZip(), bodiesRoot, () => false);
    // 坏包（body.json 非法）+ id 与目录名不符 → 都跳过，不整份失败
    mkdirSync(path.join(bodiesRoot, 'broken'));
    writeFileSync(path.join(bodiesRoot, 'broken', 'body.json'), '{oops');
    mkdirSync(path.join(bodiesRoot, 'mismatch'));
    writeFileSync(path.join(bodiesRoot, 'mismatch', 'body.json'), BODY);

    const list = listBodies(bodiesRoot);
    expect(list.map((x) => x.body.id)).toEqual(['knight']);
    expect(list[0]?.sizeBytes).toBeGreaterThan(0);
    expect(list[0]?.installedAt).toBeGreaterThan(0);

    removeBody(bodiesRoot, 'knight');
    expect(existsSync(path.join(bodiesRoot, 'knight'))).toBe(false);
    expect(listBodies(bodiesRoot)).toEqual([]);
    expect(listBodies(path.join(bodiesRoot, 'nope'))).toEqual([]); // 根不存在 → 空表
  });

  it('remove 拒绝越界 id（路径注入）', () => {
    const bodiesRoot = tmp();
    expect(() => removeBody(bodiesRoot, '../evil')).toThrow();
    expect(() => removeBody(bodiesRoot, 'Big')).toThrow();
  });
});
