/** §6 人格页表单/卡片纯逻辑（SFC 薄渲染，此处可测）。 */
import type { Persona } from '@openpet/protocol';

export interface PersonaDraft {
  id?: string;
  name: string;
  systemPrompt: string;
  beginDialogs: string[];
}

// 返回 i18n key（渲染处 t(key)）。
export function validateDraft(d: PersonaDraft): string | null {
  if (!d.name.trim()) return 'settings.persona.errNameEmpty';
  if (!d.systemPrompt.trim()) return 'settings.persona.errPromptEmpty';
  const dialogs = d.beginDialogs.map((s) => s.trim());
  if (dialogs.some((s) => s.length === 0)) return 'settings.persona.errDialogEmpty';
  if (dialogs.length % 2 !== 0) return 'settings.persona.errDialogPair';
  return null;
}

export function draftToPersona(d: PersonaDraft, genId: () => string): Persona {
  return {
    id: d.id ?? genId(),
    name: d.name.trim(),
    systemPrompt: d.systemPrompt.trim(),
    beginDialogs: d.beginDialogs.map((s) => s.trim()),
  };
}

export function promptPreview(p: Persona, max = 80): string {
  const t = p.systemPrompt.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
