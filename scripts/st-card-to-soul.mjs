/**
 * ST 角色卡 → openpet 灵魂包（`.dssoul`）批量转换器 —— 角色市场上架管线（⑯ T6）。
 *
 * 输入：SillyTavern 角色卡（.png tEXt / .charx / .json），单个文件或整个目录。
 * 输出：`<out>/packs/<id>.dssoul` + `<out>/previews/<id>.png` + `<out>/index-fragment.json`
 *      （可直接粘进索引仓 index.json 的 items 数组）。
 *
 * 零依赖（只用 node 内置 zlib/crypto）——内容维护者 clone 索引仓即可跑，无需装 npm 包。
 * 映射规则与 app 内 ⑫ 卡导入（`apps/desktop/electron/main/st-card.ts`）保持一致：
 * 同一张卡，脚本转换与 app 内导入产出的人设文本相同。
 *
 * 用法（无 shebang：一律 `node` 起——单测经 vitest 直接 import 本文件，
 * `#!` 行不会被 vite 的 SSR transform 剥掉，会当场炸成 SyntaxError）：
 *   node scripts/st-card-to-soul.mjs <卡文件或目录>... --license "CC-BY-4.0" [选项]
 * 选项：
 *   --out <dir>        输出目录（默认 ./market-out）
 *   --license <text>   必填：上架许可（本批全部条目共用；逐条不同就分批跑）
 *   --base-url <url>   下载地址前缀（默认 jsDelivr 官方索引仓）
 *   --type <soul|ref>  商品类型（默认 soul；ref 需另行在条目里补 modelSource）
 *   --dry-run          只打印，不写文件
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CARD_EXTS = new Set(['.png', '.charx', '.json']);
const AVATAR_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_BASE_URL = 'https://cdn.jsdelivr.net/gh/Furina-he/openpet-market@main';

// --- 最小 zip 读写（.charx 读 / .dssoul 写；避免引入依赖）---

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 解析 zip 中央目录 → { name: {method, compSize, localOff} }。 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    entries.set(buf.toString('utf8', off + 46, off + 46 + nameLen), { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries };
}

export function readZipFile(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const b = zip.buf;
  const start = e.localOff + 30 + b.readUInt16LE(e.localOff + 26) + b.readUInt16LE(e.localOff + 28);
  const raw = b.subarray(start, start + e.compSize);
  return e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
}

/** 写 zip（deflate）；files = [{ name, data }]。 */
export function writeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// --- 卡解析（镜像 st-card.ts；控制字符剥离 + 长度上限 = 注入面清洗口径）---

export function sanitizeText(s, max) {
  const clean = String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return clean.length > max ? clean.slice(0, max) : clean;
}

const text = (v, max) => (typeof v === 'string' ? sanitizeText(v, max) : '');
const strArray = (v, maxEach, maxLen) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === 'string')
    .map((s) => sanitizeText(s, maxEach))
    .filter((s) => s.trim().length > 0)
    .slice(0, maxLen);

/** PNG tEXt 走查：ccv3 优先于 chara（照 ST 读取语义）。 */
export function readCardFromPng(buf) {
  if (buf.length < 20 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 文件');
  const texts = new Map();
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) break;
    if (type === 'tEXt') {
      const data = buf.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0)
        texts.set(data.toString('latin1', 0, nul).toLowerCase(), data.toString('latin1', nul + 1));
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = texts.get('ccv3') ?? texts.get('chara');
  if (!raw) throw new Error('PNG 中没有角色卡数据（缺 chara/ccv3 tEXt 块）');
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

/** 按扩展名读卡；返回 { raw, avatar }。 */
export function readCard(cardPath) {
  const ext = path.extname(cardPath).toLowerCase();
  const buf = readFileSync(cardPath);
  if (ext === '.png') return { raw: readCardFromPng(buf), avatar: { buf, ext: 'png' } };
  if (ext === '.json') return { raw: JSON.parse(buf.toString('utf8')), avatar: null };
  if (ext === '.charx') {
    const zip = readZip(buf);
    const cardJson = readZipFile(zip, 'card.json');
    if (!cardJson) throw new Error('charx 包缺少 card.json');
    const raw = JSON.parse(cardJson.toString('utf8'));
    return { raw, avatar: readCharxIcon(zip, raw) };
  }
  throw new Error(`不支持的角色卡格式: ${ext || '(无扩展名)'}`);
}

function readCharxIcon(zip, raw) {
  const assets = Array.isArray(raw?.data?.assets) ? raw.data.assets : [];
  const icons = assets.filter((a) => a?.type === 'icon' && typeof a.uri === 'string');
  const icon = icons.find((a) => a.name === 'main') ?? icons[0];
  if (!icon) return null;
  const zipPath = String(icon.uri)
    .replace(/^(?:embeded|embedded):\/\//i, '')
    .replace(/^__asset:/i, '');
  if (zipPath === String(icon.uri)) return null;
  const data = readZipFile(zip, zipPath.replace(/^\/+/, ''));
  if (!data) return null;
  const rawExt = String(icon.ext ?? path.extname(zipPath))
    .toLowerCase()
    .replace(/^\./, '');
  return { buf: data, ext: AVATAR_EXTS.has(rawExt) ? rawExt : 'png' };
}

/** V2/V3 取 data.*、V1 顶层；未知字段丢弃。 */
export function normalizeCard(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('角色卡不是 JSON 对象');
  const d = typeof raw.data === 'object' && raw.data !== null ? raw.data : raw;
  const card = {
    name: text(d.name, 100),
    description: text(d.description, 20000),
    personality: text(d.personality, 4000),
    scenario: text(d.scenario, 4000),
    first_mes: text(d.first_mes, 4000),
    mes_example: text(d.mes_example, 8000),
    system_prompt: text(d.system_prompt, 8000),
    post_history_instructions: text(d.post_history_instructions, 2000),
    creator: text(d.creator, 100),
    creator_notes: text(d.creator_notes, 2000),
    character_version: text(d.character_version, 40),
    alternate_greetings: strArray(d.alternate_greetings, 4000, 20),
    tags: strArray(d.tags, 40, 20),
    character_book: d.character_book,
  };
  if (card.name.trim().length === 0) throw new Error('角色卡缺少 name 字段');
  return card;
}

function clampInt(v, min, max, dflt) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(max, Math.max(min, n));
}

/** character_book → PackLorebook 最小子集（坏条目丢弃）。 */
export function mapCharacterBook(raw) {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entriesRaw = Array.isArray(raw.entries)
    ? raw.entries
    : typeof raw.entries === 'object' && raw.entries !== null
      ? Object.values(raw.entries)
      : [];
  const entries = entriesRaw
    .flatMap((e) => {
      if (typeof e !== 'object' || e === null) return [];
      const content = text(e.content, 8000).trim();
      if (!content) return [];
      const keys = strArray(e.keys, 100, 20).map((k) => k.trim());
      const name = typeof e.name === 'string' ? e.name : typeof e.comment === 'string' ? e.comment : '';
      return [
        {
          keys,
          content,
          enabled: e.enabled !== false,
          insertionOrder: clampInt(e.insertion_order, -100000, 100000, 100),
          caseSensitive: e.case_sensitive === true,
          constant: e.constant === true,
          ...(name.trim() ? { name: sanitizeText(name, 100) } : {}),
        },
      ];
    })
    .slice(0, 200);
  if (entries.length === 0) return undefined;
  return {
    ...(typeof raw.name === 'string' && raw.name.trim() ? { name: sanitizeText(raw.name, 100) } : {}),
    scanDepth: clampInt(raw.scan_depth, 1, 20, 4),
    tokenBudget: clampInt(raw.token_budget, 50, 8000, 1024),
    entries,
  };
}

function fnv1a36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 角色 id：slug(name)；非法（CJK 等）→ st-<fnv1a base36>（与 app 内一致，确定性）。 */
export function pickId(name, taken = new Set()) {
  let slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) slug = `st-${fnv1a36(name)}`;
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

/** 卡 → 灵魂（映射规则与 app 内 mapStCardToSoul 一致）。 */
export function mapCardToSoul(card, id) {
  const name = card.name.trim();
  const base = [
    card.description.trim(),
    card.personality.trim() ? `## 性格\n${card.personality.trim()}` : '',
    card.scenario.trim() ? `## 场景\n${card.scenario.trim()}` : '',
    card.mes_example.trim()
      ? `## 对话风格示例（模仿语气，不要照抄内容）\n${card.mes_example.replace(/<START>/gi, '').trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const sys = card.system_prompt.trim();
  let systemPrompt = base;
  if (sys) {
    systemPrompt = /\{\{original\}\}/i.test(sys)
      ? sys.replace(/\{\{original\}\}/gi, () => base).trim()
      : `${sys}\n\n${base}`.trim();
  }
  if (!systemPrompt) systemPrompt = `你是${name}。`;
  if (systemPrompt.length > 24000) systemPrompt = systemPrompt.slice(0, 24000);
  const greetings = [card.first_mes, ...card.alternate_greetings]
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const lorebook = mapCharacterBook(card.character_book);
  const description = card.creator_notes.trim().slice(0, 400);
  return {
    id,
    name,
    version: card.character_version.trim() || '1.0',
    ...(card.creator.trim() ? { author: card.creator.trim() } : {}),
    ...(description ? { description } : {}),
    ...(card.tags.length ? { tags: card.tags.slice(0, 20) } : {}),
    persona: {
      systemPrompt,
      beginDialogs: [],
      ...(greetings.length ? { greetings } : {}),
      ...(card.post_history_instructions.trim()
        ? { styleAnchor: card.post_history_instructions.trim() }
        : {}),
    },
    ...(lorebook ? { lorebook } : {}),
  };
}

/** 卡文件 → { soul, packBuf, preview }（不落盘，便于测试）。 */
export function convertCard(cardPath, taken = new Set()) {
  const { raw, avatar } = readCard(cardPath);
  const card = normalizeCard(raw);
  const id = pickId(card.name.trim(), taken);
  const soul = mapCardToSoul(card, id);
  const previewName = avatar ? `preview.${avatar.ext === 'jpeg' ? 'jpg' : avatar.ext}` : null;
  const files = [{ name: 'soul.json', data: Buffer.from(JSON.stringify(soul, null, 2), 'utf8') }];
  if (avatar && previewName) files.push({ name: previewName, data: avatar.buf });
  return {
    soul,
    packBuf: writeZip(files),
    preview: avatar && previewName ? { name: previewName, data: avatar.buf } : null,
  };
}

// --- CLI ---

function parseArgs(argv) {
  const opts = { inputs: [], out: 'market-out', baseUrl: DEFAULT_BASE_URL, type: 'soul', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--license') opts.license = argv[++i];
    else if (a === '--base-url') opts.baseUrl = String(argv[++i]).replace(/\/+$/, '');
    else if (a === '--type') opts.type = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`未知选项：${a}`);
    else opts.inputs.push(a);
  }
  return opts;
}

function collectCards(inputs) {
  const out = [];
  for (const p of inputs) {
    if (!existsSync(p)) throw new Error(`路径不存在：${p}`);
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p)) {
        if (CARD_EXTS.has(path.extname(n).toLowerCase())) out.push(path.join(p, n));
      }
    } else out.push(p);
  }
  return out.sort();
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
  if (!opts.inputs.length || !opts.license) {
    console.error(
      '用法: node scripts/st-card-to-soul.mjs <卡文件或目录>... --license "<许可证>" [--out <dir>] [--base-url <url>] [--type soul|ref] [--dry-run]\n' +
        '  --license 必填：上架条目须声明许可（无许可不上架）。',
    );
    process.exit(2);
  }
  const cards = collectCards(opts.inputs);
  if (!cards.length) {
    console.error('没有找到角色卡（.png / .charx / .json）');
    process.exit(1);
  }
  const packsDir = path.join(opts.out, 'packs');
  const previewsDir = path.join(opts.out, 'previews');
  if (!opts.dryRun) {
    mkdirSync(packsDir, { recursive: true });
    mkdirSync(previewsDir, { recursive: true });
  }
  const taken = new Set();
  const items = [];
  let failed = 0;
  for (const cardPath of cards) {
    try {
      const { soul, packBuf, preview } = convertCard(cardPath, taken);
      taken.add(soul.id);
      const packName = `${soul.id}.dssoul`;
      const sha256 = createHash('sha256').update(packBuf).digest('hex');
      let previewUrl;
      if (preview) {
        const ext = path.extname(preview.name);
        previewUrl = `${opts.baseUrl}/previews/${soul.id}${ext}`;
        if (!opts.dryRun) writeFileSync(path.join(previewsDir, `${soul.id}${ext}`), preview.data);
      }
      if (!opts.dryRun) writeFileSync(path.join(packsDir, packName), packBuf);
      items.push({
        id: soul.id,
        name: soul.name,
        version: soul.version,
        type: opts.type,
        ...(soul.description ? { summary: soul.description.slice(0, 200) } : {}),
        ...(soul.tags ? { tags: soul.tags } : {}),
        ...(soul.author ? { author: soul.author } : {}),
        license: opts.license,
        ...(previewUrl ? { preview: previewUrl } : {}),
        downloadUrl: `${opts.baseUrl}/packs/${packName}`,
        size: packBuf.length,
        sha256,
      });
      console.info(`✓ ${path.basename(cardPath)} → ${packName} (${packBuf.length} B, ${sha256.slice(0, 12)}…)`);
    } catch (e) {
      failed++;
      console.error(`✗ ${path.basename(cardPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!opts.dryRun && items.length) {
    const fragment = path.join(opts.out, 'index-fragment.json');
    writeFileSync(fragment, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, 'utf8');
    console.info(`\n索引片段已写出：${fragment}（把 items 合并进索引仓 index.json）`);
  }
  console.info(`\n完成：${items.length} 成功 / ${failed} 失败${opts.dryRun ? '（dry-run，未写文件）' : ''}`);
  if (opts.type === 'ref') {
    console.info('提示：ref 型条目必须手工补 modelSource {name,url,note}，否则客户端会丢弃该条目。');
  }
  process.exit(failed && !items.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
