import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, BEHAVIOR_FEWSHOTS } from '../src/persona-prompt-template';
import { DEFAULT_PERSONA_STATE } from '../src/state';

describe('buildSystemPrompt', () => {
  it('includes character name and behavior tag spec', () => {
    const sp = buildSystemPrompt({
      name: '小灵',
      persona: DEFAULT_PERSONA_STATE,
      emotions: ['happy', 'shy'],
      actions: ['wave'],
    });
    expect(sp).toContain('小灵');
    expect(sp).toContain('行为标签');
    expect(sp).toContain('happy');
  });

  it('summarizes persona affinity and last mood', () => {
    const sp = buildSystemPrompt({
      name: '小灵',
      persona: { ...DEFAULT_PERSONA_STATE, affinity: 72, turns: 30, lastMood: 'happy' },
    });
    expect(sp).toMatch(/72/);
    expect(sp).toMatch(/happy/);
  });

  it('omits the relationship line when no persona is given', () => {
    const sp = buildSystemPrompt({ name: 'X' });
    expect(sp).not.toContain('关系记忆');
  });

  it('embeds the canonical few-shot examples (reuses parser-validated source)', () => {
    // few-shot 的零告警自洽由 persona-prompt-template.test.ts 保证；此处只需确认
    // system prompt 复用同源示例（不另起一份会漂移的 few-shot）。
    const sp = buildSystemPrompt({ name: 'X', persona: { ...DEFAULT_PERSONA_STATE, lastMood: 'shy' } });
    for (const shot of BEHAVIOR_FEWSHOTS) expect(sp).toContain(shot);
  });
});
