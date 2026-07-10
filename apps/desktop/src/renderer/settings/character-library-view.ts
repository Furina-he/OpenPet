/** E1 角色库纯逻辑（卡片 VM/排序）；SFC 薄渲染。 */
import type { CharacterManifest } from '@openpet/protocol';

export interface CharacterListItem {
  characterId: string;
  manifest: CharacterManifest;
  builtin: boolean;
  active: boolean;
}

export interface CharacterCardVm {
  id: string;
  name: string;
  version: string;
  engine: string;
  builtin: boolean;
  active: boolean;
  previewUrl: string | null;
  hasPersona: boolean;
  cueCount: number;
  emotionCount: number;
  actionCount: number;
}

export function toCardVm(item: CharacterListItem): CharacterCardVm {
  const m = item.manifest;
  return {
    id: item.characterId,
    name: m.name,
    version: m.version,
    engine: m.engine,
    builtin: item.builtin,
    active: item.active,
    previewUrl: m.preview ? `asset://${item.characterId}/${m.preview}` : null,
    hasPersona: m.persona !== undefined,
    cueCount: m.cues?.length ?? 0,
    emotionCount: Object.keys(m.emotions ?? {}).length,
    actionCount: m.actions?.length ?? 0,
  };
}

export function sortCards<T extends { active: boolean; builtin: boolean; name: string }>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
