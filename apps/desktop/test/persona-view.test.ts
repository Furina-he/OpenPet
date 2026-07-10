import { describe, expect, it } from 'vitest';
import { validateDraft, draftToPersona, promptPreview } from '../src/renderer/settings/persona-view.js';

describe('persona-view（§6 表单逻辑）', () => {
  it('校验：空名/空 prompt/开场白奇数或空条目', () => {
    expect(validateDraft({ name: '', systemPrompt: 'x', beginDialogs: [] })).toBe('settings.persona.errNameEmpty');
    expect(validateDraft({ name: 'a', systemPrompt: ' ', beginDialogs: [] })).toBe('settings.persona.errPromptEmpty');
    expect(validateDraft({ name: 'a', systemPrompt: 'x', beginDialogs: ['1'] })).toBe('settings.persona.errDialogPair');
    expect(validateDraft({ name: 'a', systemPrompt: 'x', beginDialogs: ['1', ' '] })).toBe('settings.persona.errDialogEmpty');
    expect(validateDraft({ name: 'a', systemPrompt: 'x', beginDialogs: ['1', '2'] })).toBeNull();
  });
  it('draftToPersona：trim + 新建生成 id / 编辑保留 id', () => {
    const p = draftToPersona({ name: ' 猫娘 ', systemPrompt: ' 你是猫娘。 ', beginDialogs: [' a ', 'b'] }, () => 'gen1');
    expect(p).toEqual({ id: 'gen1', name: '猫娘', systemPrompt: '你是猫娘。', beginDialogs: ['a', 'b'] });
    expect(draftToPersona({ id: 'p1', name: 'x', systemPrompt: 'y', beginDialogs: [] }, () => 'gen2').id).toBe('p1');
  });
  it('promptPreview 截断', () => {
    expect(promptPreview({ id: 'i', name: 'n', systemPrompt: 'a'.repeat(100), beginDialogs: [] }, 10)).toBe('aaaaaaaaaa…');
  });
});
