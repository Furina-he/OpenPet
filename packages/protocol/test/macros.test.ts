import { describe, expect, it } from 'vitest';
import { expandMacros } from '../src/macros.js';

const ctx = { char: '芙宁娜', user: '旅行者' };

describe('expandMacros（⑤ 宏子集）', () => {
  it('替换 {{char}} / {{user}}，大小写不敏感', () => {
    expect(expandMacros('我是{{char}}，你好 {{User}}！', ctx)).toBe('我是芙宁娜，你好 旅行者！');
  });
  it('替换值含 $& 等特殊序列不被解释', () => {
    expect(expandMacros('{{user}}', { char: 'a', user: '$&$1' })).toBe('$&$1');
  });
  it('{{time}}/{{date}} 按注入时钟与 locale 格式化', () => {
    const now = new Date(2026, 6, 12, 8, 5); // 本地 2026-07-12 08:05
    expect(expandMacros('现在 {{time}}', { ...ctx, now })).toBe('现在 08:05');
    expect(expandMacros('今天 {{date}}', { ...ctx, now })).toBe('今天 2026年7月12日');
  });
  it('{{random:a,b,c}} 用注入随机源取一项；空列表→空串', () => {
    expect(expandMacros('{{random: 甲, 乙, 丙 }}', { ...ctx, random: () => 0.99 })).toBe('丙');
    expect(expandMacros('{{random:}}', ctx)).toBe('');
  });
  it('未知宏原样保留', () => {
    expect(expandMacros('{{idle_duration}} 不动', ctx)).toBe('{{idle_duration}} 不动');
  });
});
