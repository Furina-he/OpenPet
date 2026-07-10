/**
 * 文本分块（对齐 AstrBot chunk_size/overlap）：先按双换行分段，超 size 的段按字符滑窗。
 * 纯函数——KB 摄入用，无 IO。空/空白输入返回空数组（无可嵌入内容）。
 */
export function chunkText(text: string, size: number, overlap: number): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  const step = Math.max(1, size - overlap);
  for (const para of paras) {
    if (para.length <= size) {
      out.push(para);
      continue;
    }
    for (let i = 0; i < para.length; i += step) {
      out.push(para.slice(i, i + size));
      if (i + size >= para.length) break;
    }
  }
  return out;
}
