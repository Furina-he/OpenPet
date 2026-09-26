/**
 * 桌面动作菜单模板（A1 右键 + J1 托盘复用）。返回 Electron MenuItemConstructorOptions[]，
 * 动作注入便于测；切角色（E1/V1）暂禁用占位。
 */
import type { CharacterLayout } from '@openpet/protocol';
import type { MenuLabels } from './menu-labels.js';

export interface CharacterMenuActions {
  chat: () => void;
  toggleClickThrough: () => void;
  toggleVisible: () => void;
  openHub: () => void;
}

export interface MenuItemTpl {
  label?: string;
  type?: 'separator' | 'radio';
  enabled?: boolean;
  checked?: boolean;
  click?: () => void;
  submenu?: MenuItemTpl[];
}

/** ㉓「大小 ▸」子菜单的数据（来自 character-stage 的当前 layout）。 */
export interface ScaleMenu {
  current: number;
  /** 常规六档 / 像素清晰档。 */
  presets: number[];
  maxScale: number;
  pixelSnap: boolean;
  dpr: number;
  /** 选档 / 恢复 100%（调用方按当前角色持久化）。 */
  set: (scale: number) => void;
}

const SAME = 1e-3;
const pctOf = (s: number): string => String(Math.round(s * 100));

/** 从 character-stage 的当前 layout 取子菜单数据（右键每次弹出现取；托盘在 layoutChanged 后重建）。 */
export function scaleMenuFromLayout(
  l: Pick<CharacterLayout, 'scale' | 'presets' | 'maxScale' | 'pixelSnap' | 'dpr'>,
  set: (scale: number) => void,
): ScaleMenu {
  return {
    current: l.scale,
    presets: l.presets,
    maxScale: l.maxScale,
    pixelSnap: l.pixelSnap,
    dpr: l.dpr,
    set,
  };
}

/**
 * ㉓ 大小子菜单（spec §2.1）：单选档位（> maxScale 置灰；像素精灵列「k×（N%）」清晰档）+ 分隔线 +
 * 恢复 100%。当前值命中某档则勾选，否则父项标「…（当前 N%）」。
 * kind：size = 右键「大小」；characterSize = 托盘「角色大小」。
 */
export function buildScaleMenuItem(
  m: ScaleMenu,
  labels: MenuLabels,
  kind: 'size' | 'characterSize',
): MenuItemTpl {
  const items: MenuItemTpl[] = m.presets.map((p) => ({
    label: m.pixelSnap
      ? labels.sizePixel
          .replace('{k}', String(Math.max(1, Math.round(p * m.dpr))))
          .replace('{pct}', pctOf(p))
      : `${pctOf(p)}%`,
    type: 'radio' as const,
    checked: Math.abs(p - m.current) < SAME,
    enabled: p <= m.maxScale + 1e-6,
    click: () => m.set(p),
  }));
  const hit = items.some((i) => i.checked);
  const title = kind === 'size' ? labels.size : labels.characterSize;
  const titleCurrent = kind === 'size' ? labels.sizeCurrent : labels.characterSizeCurrent;
  return {
    label: hit ? title : titleCurrent.replace('{pct}', pctOf(m.current)),
    submenu: [...items, { type: 'separator' }, { label: labels.sizeReset, click: () => m.set(1) }],
  };
}

export function buildCharacterMenuTemplate(
  a: CharacterMenuActions,
  labels: MenuLabels,
  scale?: ScaleMenu,
): MenuItemTpl[] {
  return [
    { label: labels.chat, click: a.chat },
    { label: labels.switchCharacter, enabled: false }, // E1/V1 角色库后开放
    { type: 'separator' },
    { label: labels.clickThrough, click: a.toggleClickThrough },
    { label: labels.toggleVisible, click: a.toggleVisible },
    ...(scale ? [buildScaleMenuItem(scale, labels, 'size')] : []),
    { type: 'separator' },
    { label: labels.settings, click: a.openHub },
  ];
}
