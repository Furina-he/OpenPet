/**
 * KB 文件解析（批次⑥）：.txt/.md utf8 直读；.pdf 经 unpdf（纯 JS，pdf.js 内核）抽文本
 * （对齐 AstrBot parsers/pdf_parser 的文本路径；图片资源/epub/url → follow-up）。
 * pdfExtract 可注入（单测不喂真 PDF）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function unpdfExtract(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function parseKbFile(
  filePath: string,
  pdfExtract: (buf: Buffer) => Promise<string> = unpdfExtract,
): Promise<{ filename: string; text: string }> {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') {
    return { filename, text: await readFile(filePath, 'utf8') };
  }
  if (ext === '.pdf') {
    return { filename, text: await pdfExtract(await readFile(filePath)) };
  }
  throw new Error(`不支持的文件类型 ${ext}（支持 .txt/.md/.pdf）`);
}
