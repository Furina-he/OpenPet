import { describe, expect, it } from 'vitest';
import {
  applyRegexRules,
  formatIdleDuration,
  REGEX_PRESETS,
  RegexRuleSchema,
  splitCompleteSegments,
  typingDelayMs,
} from '../src/humanize.js';

describe('splitCompleteSegments', () => {
  it('句边界切段，吸附闭合引号，剩余进 rest', () => {
    expect(splitCompleteSegments('你来啦！今天怎么样？我还在想')).toEqual({
      segments: ['你来啦！', '今天怎么样？'],
      rest: '我还在想',
    });
    expect(splitCompleteSegments('她说"走吧。"然后')).toEqual({
      segments: ['她说"走吧。"'],
      rest: '然后',
    });
    expect(splitCompleteSegments('第一行\n第二行没结尾')).toEqual({
      segments: ['第一行'],
      rest: '第二行没结尾',
    });
    expect(splitCompleteSegments('没有边界')).toEqual({ segments: [], rest: '没有边界' });
  });
});

describe('typingDelayMs', () => {
  it('按字数线性 + clamp', () => {
    const cfg = { charMs: 45, minMs: 350, maxMs: 2200 };
    expect(typingDelayMs(2, cfg)).toBe(350);
    expect(typingDelayMs(20, cfg)).toBe(900);
    expect(typingDelayMs(999, cfg)).toBe(2200);
  });
});

describe('applyRegexRules', () => {
  it('启用规则依序应用（$1 反引/忽略大小写）；非法正则静默跳过；禁用不应用', () => {
    const rules = [
      RegexRuleSchema.parse({ id: '1', find: '作为(一个)?AI[^。！？!?]*[。！？!?]', replace: '' }),
      RegexRuleSchema.parse({ id: '2', find: '((', replace: 'x' }), // 非法
      RegexRuleSchema.parse({ id: '3', find: '哦', replace: '喔', enabled: false }),
      RegexRuleSchema.parse({ id: '4', find: '', replace: 'y' }), // 空 find（D2 新增未填写行）= no-op
    ];
    expect(applyRegexRules('作为一个AI我没有情感。但今天天气不错哦', rules)).toBe(
      '但今天天气不错哦',
    );
  });
  it('预置库：AI 自称句被默认开启的规则剥离', () => {
    const out = applyRegexRules('作为一个人工智能助手，我无法有情绪。真的吗？', REGEX_PRESETS);
    expect(out).not.toContain('人工智能');
    expect(out).toContain('真的吗？');
  });
});

describe('formatIdleDuration', () => {
  it('人话时长', () => {
    expect(formatIdleDuration(30_000)).toBe('刚刚');
    expect(formatIdleDuration(5 * 60_000)).toBe('5 分钟');
    expect(formatIdleDuration(3 * 3_600_000)).toBe('3 小时');
    expect(formatIdleDuration(2 * 86_400_000)).toBe('2 天');
  });
});
