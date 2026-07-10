import AdmZip from 'adm-zip';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectPack, installPack } from '../electron/main/pack-import.js';

const MANIFEST = JSON.stringify({
  id: 'miko',
  name: '巫女',
  version: '1.0.0',
  engine: 'vrm',
  model: 'model.vrm',
});
const cleanups: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-pack-'));
  cleanups.push(d);
  return d;
};
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function makeZip(entries: Array<[string, string]>): string {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content));
  const file = path.join(tmp(), 'pack.dspack');
  zip.writeZip(file);
  return file;
}

describe('pack-import（批次④ E3）', () => {
  it('inspect：zip 与文件夹都能读 manifest 摘要', () => {
    const zipPath = makeZip([
      ['manifest.json', MANIFEST],
      ['model.vrm', 'x'],
    ]);
    expect(inspectPack(zipPath).id).toBe('miko');
    const dir = path.join(tmp(), 'miko');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'manifest.json'), MANIFEST);
    expect(inspectPack(dir).name).toBe('巫女');
  });
  it('install zip → importedRoot/<id>；id 冲突拒绝', () => {
    const zipPath = makeZip([
      ['manifest.json', MANIFEST],
      ['model.vrm', 'x'],
    ]);
    const importedRoot = tmp();
    const { id } = installPack(zipPath, importedRoot, () => false);
    expect(id).toBe('miko');
    expect(existsSync(path.join(importedRoot, 'miko', 'model.vrm'))).toBe(true);
    expect(() => installPack(zipPath, importedRoot, (x) => x === 'miko')).toThrow(/已存在/);
  });
  it('zip-slip：../ 或盘符 entry 拒绝安装', () => {
    // adm-zip 的 addFile 会 sanitize 掉 `..`——恶意 zip 须在字节层伪造 entry 名（同长度占位替换）。
    const evil = makeZip([
      ['manifest.json', MANIFEST],
      ['xx/evil.txt', 'x'],
    ]);
    const buf = readFileSync(evil);
    const from = Buffer.from('xx/evil.txt');
    const to = Buffer.from('../evil.txt');
    let i: number;
    while ((i = buf.indexOf(from)) !== -1) to.copy(buf, i);
    writeFileSync(evil, buf);
    expect(() => installPack(evil, tmp(), () => false)).toThrow(/非法路径/);
  });
  it('包根缺 manifest.json 拒绝', () => {
    const bad = makeZip([['model.vrm', 'x']]);
    expect(() => inspectPack(bad)).toThrow(/manifest/);
  });
  it('文件夹安装 = 校验 + 递归拷贝', () => {
    const src = path.join(tmp(), 'src-pack');
    mkdirSync(src);
    writeFileSync(path.join(src, 'manifest.json'), MANIFEST);
    writeFileSync(path.join(src, 'model.vrm'), 'x');
    const importedRoot = tmp();
    installPack(src, importedRoot, () => false);
    expect(existsSync(path.join(importedRoot, 'miko', 'manifest.json'))).toBe(true);
  });
});
