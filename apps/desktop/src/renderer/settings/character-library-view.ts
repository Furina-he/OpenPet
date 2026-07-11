/** E1 角色库纯逻辑（卡片 VM/排序）+ ⑩.7 E2 详情（元数据格式化/persona 生效层/菜单表）；SFC 薄渲染。 */
import type { CharacterManifest } from '@openpet/protocol';

export interface CharacterListItem {
  characterId: string;
  manifest: CharacterManifest;
  builtin: boolean;
  active: boolean;
  sizeBytes?: number;
  installedAt?: number;
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
  // ⑩.7 E2 信息区
  author: string | null;
  license: string | null;
  description: string | null;
  tags: string[];
  voice: string | null;
  modelPath: string;
  hasEmotionOverride: boolean;
  sizeBytes: number | undefined;
  installedAt: number | undefined;
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
    author: m.author ?? null,
    license: m.license ?? null,
    description: m.description ?? null,
    tags: m.tags ?? [],
    voice: m.voice ?? null,
    modelPath: m.model,
    hasEmotionOverride: m.emotions !== undefined || m.live2dEmotions !== undefined,
    sizeBytes: item.sizeBytes,
    installedAt: item.installedAt,
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

// --- ⑩.7 E2 完整详情 ---

export function formatBytes(n?: number): string {
  if (n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface PersonaAllLike {
  personas: Array<{ id: string }>;
  defaultId: string;
  bindings: Record<string, string>;
}

export type PersonaSource = 'binding' | 'pack' | 'default' | 'builtin';

/** persona 生效层（镜像 Main 的 persona-service.resolveFor 顺位，仅用于 E2 展示）。 */
export function personaSourceOf(
  characterId: string,
  manifest: CharacterManifest,
  all: PersonaAllLike,
): PersonaSource {
  const bound = all.bindings[characterId];
  if (bound && all.personas.some((p) => p.id === bound)) return 'binding';
  if (manifest.persona) return 'pack';
  if (all.defaultId && all.personas.some((p) => p.id === all.defaultId)) return 'default';
  return 'builtin';
}

export interface CharacterMenuItem {
  key:
    | 'activate'
    | 'edit'
    | 'duplicate'
    | 'export'
    | 'rename'
    | 'resetEmotions'
    | 'reveal'
    | 'remove';
  disabled?: boolean;
  danger?: boolean;
  /** 内置角色的「编辑」实为「复制后编辑」。 */
  editAsCopy?: boolean;
}

/** E2 抽屉 ⋮ 菜单：复制 / 导出 / 重命名 / 重置情绪映射 / 在文件夹显示 / 卸载。 */
export function drawerMenuItems(vm: { builtin: boolean }): CharacterMenuItem[] {
  return [
    { key: 'duplicate' },
    { key: 'export' },
    { key: 'rename', ...(vm.builtin ? { disabled: true } : {}) },
    { key: 'resetEmotions', ...(vm.builtin ? { disabled: true } : {}) },
    { key: 'reveal' },
    { key: 'remove', danger: true, ...(vm.builtin ? { disabled: true } : {}) },
  ];
}

/** E1 卡片右键菜单（资源管理类，区别于 A1 桌面右键）。 */
export function cardContextMenuItems(vm: {
  builtin: boolean;
  active: boolean;
}): CharacterMenuItem[] {
  return [
    { key: 'activate', ...(vm.active ? { disabled: true } : {}) },
    { key: 'edit', ...(vm.builtin ? { editAsCopy: true } : {}) },
    { key: 'duplicate' },
    { key: 'export' },
    { key: 'reveal' },
    { key: 'remove', danger: true, ...(vm.builtin ? { disabled: true } : {}) },
  ];
}
