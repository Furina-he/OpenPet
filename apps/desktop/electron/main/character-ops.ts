/** 卸载导入包（spec §3）：内置拒绝；卸当前 → 先切 default 并回调 onChanged。 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { CharacterService } from './character-service.js';

export function removeCharacter(
  id: string,
  deps: { characters: CharacterService; importedRoot: string; onChanged: (id: string) => void },
): void {
  if (deps.characters.isBuiltin(id)) throw new Error('内置角色不可卸载');
  if (deps.characters.current().characterId === id) {
    deps.characters.switch('default');
    deps.onChanged('default');
  }
  rmSync(path.join(deps.importedRoot, id), { recursive: true, force: true });
  deps.characters.invalidate();
}
