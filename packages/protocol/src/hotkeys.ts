/**
 * J2 热键规则（纯）：accelerator 合法性 + 应用内冲突。不允许单键/纯修饰/ESC。
 * 提升到 protocol 后由 Main（hotkey-service）与 renderer（KeyCap/HotkeysPage）共用，单一真源。
 */
const MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

export interface Validation {
  ok: boolean;
  reason?: string;
}
export function validateAccelerator(acc: string): Validation {
  const parts = acc
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: '需至少一个修饰键 + 一个普通键' };
  const mods = parts.filter((p) => MODIFIERS.has(p));
  const keys = parts.filter((p) => !MODIFIERS.has(p));
  if (mods.length === 0) return { ok: false, reason: '缺少修饰键' };
  if (keys.length !== 1) return { ok: false, reason: '需恰好一个普通键' };
  if (keys[0]!.toLowerCase() === 'escape' || keys[0] === 'Esc') {
    return { ok: false, reason: '不允许 ESC' };
  }
  return { ok: true };
}

/** 返回与 acc 冲突的功能 id（排除自身）；无则 null。 */
export function findConflict(
  map: Record<string, string>,
  selfId: string,
  acc: string,
): string | null {
  for (const [id, v] of Object.entries(map)) {
    if (id !== selfId && v === acc) return id;
  }
  return null;
}
