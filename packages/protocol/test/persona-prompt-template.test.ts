import { describe, it, expect } from 'vitest';
import {
  buildBehaviorPrompt,
  BEHAVIOR_FEWSHOTS,
  DEFAULT_EMOTIONS,
  DEFAULT_ACTIONS,
} from '../src/persona-prompt-template';
import { BehaviorParser, BEHAVIOR_LIMITS, type BehaviorEvent } from '../src/behavior-parser';

describe('buildBehaviorPrompt', () => {
  it('lists every default emotion and action by name', () => {
    const prompt = buildBehaviorPrompt();
    for (const e of DEFAULT_EMOTIONS) expect(prompt).toContain(e);
    for (const a of DEFAULT_ACTIONS) expect(prompt).toContain(a);
  });

  it('documents tag syntax and numeric limits from BEHAVIOR_LIMITS', () => {
    const prompt = buildBehaviorPrompt();
    expect(prompt).toContain('[intent mood=');
    expect(prompt).toContain('<emo:');
    expect(prompt).toContain('<act:');
    expect(prompt).toContain('<wait ms=');
    expect(prompt).toContain(String(BEHAVIOR_LIMITS.waitMaxMs));
    expect(prompt).toContain(String(BEHAVIOR_LIMITS.actionDurationMaxMs));
  });

  it('never mentions the say tag (V1+ stub: 不教模型输出会被丢弃的标签)', () => {
    expect(buildBehaviorPrompt()).not.toContain('<say:');
  });

  it('accepts custom emotion/action vocabularies', () => {
    const prompt = buildBehaviorPrompt({ emotions: ['blink'], actions: ['spin'] });
    // few-shot 是固定教学示例（可能含默认词），词表行本身必须被替换
    expect(prompt).toContain('可用表情：blink。');
    expect(prompt).toContain('可用动作：spin。');
    expect(prompt).not.toContain('可用表情：happy');
    expect(prompt).not.toContain('可用动作：wave');
  });

  it('includes every few-shot verbatim', () => {
    const prompt = buildBehaviorPrompt();
    for (const shot of BEHAVIOR_FEWSHOTS) expect(prompt).toContain(shot);
  });
});

describe('few-shot 自洽：示例必须被 BehaviorParser 零告警解析', () => {
  it.each(BEHAVIOR_FEWSHOTS.map((s, i) => [i + 1, s] as const))(
    'few-shot #%i parses clean: starts with intent, no warns, no tag text leakage',
    (_i, shot) => {
      const warns: string[] = [];
      const p = new BehaviorParser({ onWarn: (reason) => warns.push(reason) });
      const events: BehaviorEvent[] = [...p.feed(shot), ...p.flush()];
      expect(warns).toEqual([]);
      expect(events[0]?.type).toBe('intent');
      for (const e of events) {
        if (e.type === 'text') {
          expect(e.text).not.toMatch(/<emo:|<act:|<wait |\[intent /);
        }
      }
      expect(events.some((e) => e.type === 'emotion')).toBe(true);
    },
  );
});

describe('⑱ mood → 心情句', () => {
  it('moodSentence：>0.4 轻快 / <−0.3 低落 / 其余与缺省 null', async () => {
    const { moodSentence, MOOD_SENTENCES } = await import('../src/persona-prompt-template');
    expect(moodSentence(0.8)).toBe(MOOD_SENTENCES.high);
    expect(moodSentence(-0.5)).toBe(MOOD_SENTENCES.low);
    expect(moodSentence(0.2)).toBeNull();
    expect(moodSentence(undefined)).toBeNull();
    expect(moodSentence(Number.NaN)).toBeNull();
  });

  it('buildSystemPrompt：有 persona 时追加进【关系记忆】句；无 persona 时独立成句；neutral 不出现', async () => {
    const { buildSystemPrompt, MOOD_SENTENCES } = await import('../src/persona-prompt-template');
    const withPersona = buildSystemPrompt({
      name: '小灵',
      persona: { affinity: 50, turns: 3 },
      moodValue: 0.9,
    });
    expect(withPersona).toMatch(new RegExp(`【关系记忆】[^
]*${MOOD_SENTENCES.high}。`));
    const noPersona = buildSystemPrompt({ name: '小灵', moodValue: -0.9 });
    expect(noPersona).toContain(`【关系记忆】${MOOD_SENTENCES.low}。`);
    const neutral = buildSystemPrompt({ name: '小灵', persona: { affinity: 50, turns: 3 }, moodValue: 0 });
    expect(neutral).not.toContain(MOOD_SENTENCES.high);
    expect(neutral).not.toContain(MOOD_SENTENCES.low);
    expect(buildSystemPrompt({ name: '小灵' })).not.toContain('【关系记忆】');
  });
});
