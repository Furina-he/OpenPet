/**
 * Codex 宠物 → openpet 形象包（`.dsbody`）离线转换器（⑳ T6）。
 *
 * ⚠️ 版权：只转换**你自己孵化**（Codex `hatch-pet`）或**已获授权**的宠物。
 *    Codex 内置宠物属于 OpenAI 资产，未获授权不得再分发（包括上架 openpet 市场）。
 *
 * 输入：Codex 宠物目录（`pet.json` + 图集，hatch-pet 契约：`{id, displayName, description,
 *      spritesheetPath}`，图集 8 列 × 9 行、标准 1536×1872，webp / png），或 `--codex-home`
 *      扫描 `${CODEX_HOME:-~/.codex}/pets/*`。
 * 输出：`<out>/<id>.dsbody` = `body.json`（engine sprite、`sprite.layout: codex`）+ 原图集（字节不动）
 *      [+ `--preview` 立绘]。E1「形象」tab 导入即可给任意角色换上（记忆 / 会话 / 人设原地保留）。
 * 按 ⑰ 口径 Codex 宠物目录只是**输入格式**：app 内不解析 pet.json，市场只流通 `.dsbody`。
 *
 * 零依赖（node 内置 zlib；zip 助手与 st-card-to-soul 共用 scripts/lib/zip.mjs）。
 * 用法（无 shebang：单测经 vitest 直接 import 本文件，`#!` 行会炸 SyntaxError）：
 *   node scripts/codex-pet-to-body.mjs <宠物目录>... [选项]
 *   node scripts/codex-pet-to-body.mjs --codex-home [选项]
 * 选项：
 *   --out <dir>        输出目录（默认 ./bodies-out）
 *   --id <id>          指定形象 id（仅单个输入时可用；缺省由 pet.json 的 id / displayName 规整）
 *   --license <text>   许可声明（写进 body.json；上架市场时必填）
 *   --author <text>    作者
 *   --pixel            像素风：smoothing = pixel（最近邻 + 原生分辨率变换，防像素蠕动）
 *   --preview <file>   卡片立绘（.png / .webp / .jpg），打进包内作 preview
 *   --dry-run          只打印，不写文件
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './lib/zip.mjs';

/** Codex 契约（与 protocol CODEX_LAYOUT 同源口径）。 */
export const CODEX_COLUMNS = 8;
export const CODEX_ROWS = 9;
export const CODEX_SHEET = { width: 1536, height: 1872 };
const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHEET_EXTS = new Set(['.png', '.webp']);
const PREVIEW_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 读图头尺寸（PNG IHDR / WebP 的 VP8、VP8L、VP8X 三种头）；无法识别 → 抛。 */
export function readImageSize(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIG) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X') {
      return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (fourcc === 'VP8L') {
      if (buf[20] !== 0x2f) throw new Error('WebP VP8L 签名错误');
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      return {
        format: 'webp',
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (fourcc === 'VP8 ') {
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error('WebP VP8 起始码错误');
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    throw new Error(`不支持的 WebP 块：${fourcc}`);
  }
  throw new Error('无法识别的图片格式（只支持 PNG / WebP）');
}

/** 图集须 8×9 等分且比例 = 1536:1872（2× 高清图集同样可以）。 */
export function checkCodexSheet({ width, height }) {
  if (width % CODEX_COLUMNS !== 0 || height % CODEX_ROWS !== 0) {
    throw new Error(`图集 ${width}×${height} 不能被 8 列 × 9 行等分`);
  }
  if (width * CODEX_SHEET.height !== height * CODEX_SHEET.width) {
    throw new Error(`图集比例 ${width}:${height} 与 Codex 契约 1536:1872 不符`);
  }
}

function fnv1a36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 规整成合法形象 id（小写 slug）；规整后为空（CJK 名等）→ `pet-<fnv1a base36>`（确定性）。 */
export function normalizeId(raw, taken = new Set()) {
  let slug = String(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (!CHARACTER_ID_RE.test(slug)) slug = `pet-${fnv1a36(String(raw))}`;
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

const cleanText = (v, max) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max)
    : '';

/** 包内相对路径（不许越界）。 */
function safeRel(p) {
  const segs = String(p).split(/[\\/]/);
  return segs.length > 0 && segs.every((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes(':'));
}

/**
 * 宠物目录 → { body, files }。opts: { id?, license?, author?, pixel?, preview?, taken? }。
 * 不写文件（纯转换，便于单测）。
 */
export function petToBody(dir, opts = {}) {
  const petJsonPath = path.join(dir, 'pet.json');
  if (!existsSync(petJsonPath)) throw new Error(`缺少 pet.json：${dir}`);
  const pet = JSON.parse(readFileSync(petJsonPath, 'utf8'));
  const sheetRel = typeof pet.spritesheetPath === 'string' ? pet.spritesheetPath : 'spritesheet.webp';
  if (!safeRel(sheetRel)) throw new Error(`spritesheetPath 非法：${sheetRel}`);
  const ext = path.extname(sheetRel).toLowerCase();
  if (!SHEET_EXTS.has(ext)) throw new Error(`图集须为 .png / .webp：${sheetRel}`);
  const sheet = readFileSync(path.join(dir, sheetRel));
  const size = readImageSize(sheet);
  if (`.${size.format}` !== ext) throw new Error(`图集扩展名 ${ext} 与实际格式 ${size.format} 不符`);
  checkCodexSheet(size);

  const displayName = cleanText(pet.displayName, 60) || cleanText(pet.id, 60) || path.basename(path.resolve(dir));
  const id = opts.id ?? normalizeId(cleanText(pet.id, 80) || displayName, opts.taken ?? new Set());
  if (!CHARACTER_ID_RE.test(id)) throw new Error(`id 非法（只允许小写字母/数字/连字符）：${id}`);
  const description = cleanText(pet.description, 1000);
  const model = `spritesheet${ext}`;
  const files = [{ name: model, data: sheet }];
  let preview;
  if (opts.preview) {
    const pext = path.extname(opts.preview).toLowerCase();
    if (!PREVIEW_EXTS.has(pext)) throw new Error(`立绘须为 .png / .webp / .jpg：${opts.preview}`);
    preview = `preview${pext}`;
    files.push({ name: preview, data: readFileSync(opts.preview) });
  }
  const body = {
    id,
    name: displayName,
    version: '1.0.0',
    engine: 'sprite',
    model,
    sprite: { layout: 'codex', ...(opts.pixel ? { smoothing: 'pixel' } : {}) },
    ...(preview ? { preview } : {}),
    ...(opts.author ? { author: cleanText(opts.author, 100) } : {}),
    ...(description ? { description } : {}),
    ...(opts.license ? { license: cleanText(opts.license, 200) } : {}),
  };
  files.unshift({ name: 'body.json', data: Buffer.from(`${JSON.stringify(body, null, 2)}\n`, 'utf8') });
  return { body, files, size };
}

/** 转换并打包：返回 { body, packBuf }。 */
export function convertPet(dir, opts = {}) {
  const { body, files, size } = petToBody(dir, opts);
  return { body, size, packBuf: writeZip(files) };
}

/** `${CODEX_HOME:-~/.codex}/pets/*`（含 pet.json 的子目录）。 */
export function codexPetDirs(codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const root = path.join(codexHome, 'pets');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => path.join(root, n))
    .filter((p) => statSync(p).isDirectory() && existsSync(path.join(p, 'pet.json')))
    .sort();
}

// --- CLI ---

function parseArgs(argv) {
  const opts = { inputs: [], out: 'bodies-out', codexHome: false, pixel: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--id') opts.id = argv[++i];
    else if (a === '--license') opts.license = argv[++i];
    else if (a === '--author') opts.author = argv[++i];
    else if (a === '--preview') opts.preview = argv[++i];
    else if (a === '--pixel') opts.pixel = true;
    else if (a === '--codex-home') opts.codexHome = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`未知选项：${a}`);
    else opts.inputs.push(a);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
  const dirs = [...opts.inputs, ...(opts.codexHome ? codexPetDirs() : [])];
  if (!dirs.length) {
    console.error(
      '用法: node scripts/codex-pet-to-body.mjs <宠物目录>... | --codex-home [--out <dir>] [--id <id>] [--license <text>] [--author <text>] [--pixel] [--preview <file>] [--dry-run]',
    );
    process.exit(2);
  }
  if (opts.id && dirs.length > 1) {
    console.error('--id 只能配合单个宠物目录使用');
    process.exit(2);
  }
  console.info('⚠ 只转换自己孵化或已获授权的宠物；Codex 内置宠物属 OpenAI 资产，未获授权不得再分发。\n');
  if (!opts.dryRun) mkdirSync(opts.out, { recursive: true });
  const taken = new Set();
  let ok = 0;
  let failed = 0;
  for (const dir of dirs) {
    try {
      const { body, size, packBuf } = convertPet(dir, { ...opts, taken });
      taken.add(body.id);
      const file = path.join(opts.out, `${body.id}.dsbody`);
      if (!opts.dryRun) writeFileSync(file, packBuf);
      ok++;
      console.info(`✓ ${path.basename(path.resolve(dir))} → ${file}（${body.name}，图集 ${size.width}×${size.height}，${packBuf.length} B）`);
    } catch (e) {
      failed++;
      console.error(`✗ ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.info(`\n完成：${ok} 成功 / ${failed} 失败${opts.dryRun ? '（dry-run，未写文件）' : ''}`);
  if (ok) console.info('下一步：Hub → 角色库 → 形象 → 导入 .dsbody，再「应用到角色」。');
  process.exit(failed && !ok ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
