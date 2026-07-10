// 改名 openpet 的一次性数据迁移：userData 整目录搬家
// （secrets.kc/characters/plugins/star-*/prefs.json/sessions.db 全在内，零逐项处理）。
import * as nodeFs from 'node:fs';

type FsLike = Pick<typeof nodeFs, 'existsSync' | 'readdirSync' | 'renameSync' | 'cpSync'>;

export function migrateUserData(oldDirs: string[], newDir: string, fs: FsLike = nodeFs): void {
  const newExists = fs.existsSync(newDir) && fs.readdirSync(newDir).length > 0;
  if (newExists) return;
  const from = oldDirs.find((d) => fs.existsSync(d));
  if (!from) return;
  try {
    fs.renameSync(from, newDir);
  } catch (e) {
    if ((e as { code?: string }).code !== 'EXDEV') throw e;
    fs.cpSync(from, newDir, { recursive: true } as never); // 旧目录保留原地即备份
  }
}
