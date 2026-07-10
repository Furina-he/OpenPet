import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseKbFile } from '../electron/main/kb-file.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('kb-file（批次⑥ PDF/文本解析路由）', () => {
  it('.txt/.md → utf8 直读', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-kbf-'));
    cleanups.push(dir);
    const f = path.join(dir, 'note.md');
    writeFileSync(f, '# 标题\n正文', 'utf8');
    expect(await parseKbFile(f)).toEqual({ filename: 'note.md', text: '# 标题\n正文' });
  });
  it('.pdf → 走注入的 pdf 提取器', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-kbf-'));
    cleanups.push(dir);
    const f = path.join(dir, 'doc.pdf');
    writeFileSync(f, Buffer.from('%PDF-fake'));
    const r = await parseKbFile(f, async (buf) => `PDF文本(${buf.length}B)`);
    expect(r.filename).toBe('doc.pdf');
    expect(r.text).toContain('PDF文本');
  });
  it('不支持的扩展名抛错', async () => {
    await expect(parseKbFile('x.exe')).rejects.toThrow(/支持/);
  });
});
