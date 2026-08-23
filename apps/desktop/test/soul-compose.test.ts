import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema } from '@openpet/protocol';
import { describe, expect, it } from 'vitest';
import { installSoulPack, readSoulPack } from '../electron/main/soul-compose.js';

const SOUL = {
  id: 'sage',
  name: '贤者',
  version: '2.1',
  persona: { systemPrompt: '你是贤者。', beginDialogs: ['你好', '嗯？'], greetings: ['又见面了'] },
  lorebook: { entries: [{ keys: ['塔'], content: '塔在东边。' }] },
  author: 'someone',
  description: '一位贤者',
  license: 'CC0-1.0',
  tags: ['fantasy'],
};

/** donor 夹具：vrm 包目录（manifest + 模型 + 立绘 + 不该被承的 voice/元数据）。 */
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'soul-pack-'));
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
      emotions: { happy: { happy: 1 } },
      preview: 'hero.png',
      voice: 'v-1',
      author: 'donor-author',
    }),
  );
  writeFileSync(path.join(donorDir, 'hero.vrm'), 'VRMDATA');
  writeFileSync(path.join(donorDir, 'hero.png'), 'PREVIEW');
  return { root, donorRoot, importedRoot: path.join(root, 'imported') };
}

function writeSoulZip(
  dir: string,
  name: string,
  files: Array<[string, string | Buffer]>,
): string {
  const zip = new AdmZip();
  for (const [rel, data] of files) {
    zip.addFile(rel, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  }
  const p = path.join(dir, name);
  zip.writeZip(p);
  return p;
}

describe('readSoulPack', () => {
  it('解析 soul.json + 可选 preview 图', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [
      ['soul.json', JSON.stringify(SOUL)],
      ['preview.png', Buffer.from('IMG')],
    ]);
    const { soul, preview } = readSoulPack(p);
    expect(soul.id).toBe('sage');
    expect(soul.lorebook?.entries[0]?.content).toBe('塔在东边。');
    expect(preview?.relPath).toBe('preview.png');
  });

  it('缺 soul.json → 报错', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'bad.dssoul', [['readme.txt', 'hi']]);
    expect(() => readSoulPack(p)).toThrow(/soul\.json/);
  });

  it('坏 soul.json（persona 缺失）→ Zod 抛错', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'bad2.dssoul', [
      ['soul.json', JSON.stringify({ id: 'x', name: 'X', version: '1' })],
    ]);
    expect(() => readSoulPack(p)).toThrow();
  });

  it('zip-slip 路径拒绝（同 pack-import 安全口径）', () => {
    const f = makeFixture();
    // adm-zip 的 addFile 会 sanitize 掉 `..`——恶意 zip 须在字节层伪造 entry 名（同长度占位替换）。
    const p = writeSoulZip(f.root, 'evil.dssoul', [
      ['soul.json', JSON.stringify(SOUL)],
      ['xx/evil.txt', 'pwn'],
    ]);
    const buf = readFileSync(p);
    const from = Buffer.from('xx/evil.txt');
    const to = Buffer.from('../evil.txt');
    let i: number;
    while ((i = buf.indexOf(from)) !== -1) to.copy(buf, i);
    writeFileSync(p, buf);
    expect(() => readSoulPack(p)).toThrow(/非法路径/);
  });
});

describe('installSoulPack（灵魂 + donor 形象合成）', () => {
  it('产出合法 manifest：engine/model/词表来自 donor，人设/世界书/元数据来自灵魂包', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [['soul.json', JSON.stringify(SOUL)]]);
    const { id } = installSoulPack({
      soulPath: p,
      donorId: 'hero',
      donorRoot: f.donorRoot,
      importedRoot: f.importedRoot,
      exists: () => false,
    });
    expect(id).toBe('sage');
    const dir = path.join(f.importedRoot, 'sage');
    const m = CharacterManifestSchema.parse(
      JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    );
    // 肉体
    expect(m.engine).toBe('vrm');
    expect(m.model).toBe('hero.vrm');
    expect(m.actions).toEqual(['wave']);
    expect(m.emotions).toEqual({ happy: { happy: 1 } });
    expect(existsSync(path.join(dir, 'hero.vrm'))).toBe(true); // 形象整目录复制（自包含）
    // 灵魂
    expect(m.name).toBe('贤者');
    expect(m.version).toBe('2.1');
    expect(m.persona?.systemPrompt).toBe('你是贤者。');
    expect(m.persona?.greetings).toEqual(['又见面了']);
    expect(m.lorebook?.entries[0]?.keys).toEqual(['塔']);
    expect(m.author).toBe('someone'); // 灵魂包元数据覆盖 donor 的
    expect(m.license).toBe('CC0-1.0');
    expect(m.tags).toEqual(['fantasy']);
    // donor 的 voice/id 不承
    expect(m.voice).toBeUndefined();
    expect(m.id).toBe('sage');
  });

  it('灵魂包带 preview 图 → 随包落盘并成为 manifest.preview', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [
      ['soul.json', JSON.stringify(SOUL)],
      ['preview.png', Buffer.from('IMG')],
    ]);
    installSoulPack({
      soulPath: p,
      donorId: 'hero',
      donorRoot: f.donorRoot,
      importedRoot: f.importedRoot,
      exists: () => false,
    });
    const dir = path.join(f.importedRoot, 'sage');
    expect(readFileSync(path.join(dir, 'preview.png'), 'utf8')).toBe('IMG');
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
      preview: string;
    };
    expect(m.preview).toBe('preview.png');
  });

  it('无 preview 图 → 承 donor.preview', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [['soul.json', JSON.stringify(SOUL)]]);
    installSoulPack({
      soulPath: p,
      donorId: 'hero',
      donorRoot: f.donorRoot,
      importedRoot: f.importedRoot,
      exists: () => false,
    });
    const m = JSON.parse(
      readFileSync(path.join(f.importedRoot, 'sage', 'manifest.json'), 'utf8'),
    ) as { preview: string };
    expect(m.preview).toBe('hero.png');
  });

  it('id 冲突 → 拒绝（不静默改名）', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [['soul.json', JSON.stringify(SOUL)]]);
    expect(() =>
      installSoulPack({
        soulPath: p,
        donorId: 'hero',
        donorRoot: f.donorRoot,
        importedRoot: f.importedRoot,
        exists: (id) => id === 'sage',
      }),
    ).toThrow(/已存在/);
    expect(existsSync(path.join(f.importedRoot, 'sage'))).toBe(false);
  });

  it('donor 不存在 → 报错且不落盘', () => {
    const f = makeFixture();
    const p = writeSoulZip(f.root, 'sage.dssoul', [['soul.json', JSON.stringify(SOUL)]]);
    expect(() =>
      installSoulPack({
        soulPath: p,
        donorId: 'ghost',
        donorRoot: f.donorRoot,
        importedRoot: f.importedRoot,
        exists: () => false,
      }),
    ).toThrow();
    expect(existsSync(path.join(f.importedRoot, 'sage'))).toBe(false);
  });
});
