import { describe, expect, it } from 'vitest';
import { resolveLink } from '@openpet/protocol';
import { renderMemoryMarkdown } from '../src/renderer/settings/memory-markdown.js';

const PAGES = [
  { path: 'user/profile.md' },
  { path: 'user/people/王小明.md' },
  { path: 'user/topics/爬山.md' },
];
const FROM = 'user/topics/爬山.md';
const resolve = (t: string, markdown: boolean): string | null =>
  resolveLink(t, FROM, PAGES, { markdown });
const html = (md: string): string => renderMemoryMarkdown(md, resolve);

describe('㉒ memory-markdown 渲染', () => {
  it('四种双链写法 + 嵌入 + md 链接 → ds-wikilink（data-target = 页路径）', () => {
    const out = html('[[王小明]] [[王小明|小王]] [[王小明#近况]] [[王小明#近况|他]] ![[爬山]] [档案](../profile.md)');
    expect(out).toContain('<a class="ds-wikilink" href="#" data-target="user/people/王小明.md">王小明</a>');
    expect(out).toContain('data-target="user/people/王小明.md">小王</a>');
    expect(out).toContain('data-target="user/people/王小明.md">王小明 › 近况</a>');
    expect(out).toContain('data-target="user/people/王小明.md">他</a>');
    expect(out).toContain('data-target="user/topics/爬山.md">爬山</a>');
    expect(out).toContain('data-target="user/profile.md">档案</a>');
  });

  it('未建页面：is-ghost + data-ghost；路径形式显示末段', () => {
    const out = html('[[珠峰]] [[user/topics/不存在|别处]]');
    expect(out).toContain('<a class="ds-wikilink is-ghost" href="#" data-ghost="珠峰">珠峰</a>');
    expect(out).toContain('data-ghost="不存在">别处</a>');
  });

  it('行内 #标签 → chip（纯数字 / 标题 / 词中 # 不算）；锁定标记 → 🔒 徽标', () => {
    const out = html('## 杂项\n\n<!-- locked -->\n手写 #同事 #work/proj 与 #123 a#b');
    expect(out).toContain('<span class="ds-tag-chip" data-tag="同事">#同事</span>');
    expect(out).toContain('data-tag="work/proj"');
    expect(out).not.toContain('data-tag="123"');
    expect(out).not.toContain('data-tag="b"');
    expect(out).toContain('<h2>杂项</h2>');
    expect(out).toContain('ds-lock-badge');
    expect(out).not.toContain('<!--');
  });

  it('外链只放行 http(s) / mailto，带 rel=noopener', () => {
    const out = html('[官网](https://example.com) [信](mailto:a@b.c)');
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">官网</a>');
    expect(out).toContain('href="mailto:a@b.c"');
  });

  it('XSS：img onerror / script / javascript: 链接 / 属性引号逃逸 / 图片 → 全部转义或降级', () => {
    const cases = [
      '<img src=x onerror=alert(1)>',
      '<script>window.openpet.rpc("memory.clear",{})</script>',
      '[点我](javascript:alert(1))',
      '[点我](JaVaScRiPt:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '![alt" onerror="alert(1)](x.png)',
      '[[王小明|x" onmouseover="alert(1)]]',
      '[[a"><img src=x onerror=alert(1)>]]',
      'inline <b onclick="alert(1)">b</b> html',
      '<a href="javascript:alert(1)">a</a>',
    ];
    for (const md of cases) {
      const out = html(md);
      expect(out, md).not.toMatch(/<img|<script|<b |<a href="javascript|<a href="data/i);
      expect(out, md).not.toMatch(/\son\w+="/i);
      expect(out, md).not.toMatch(/href="(?!https?:|mailto:|#)/i);
    }
    expect(html('<img src=x onerror=alert(1)>')).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html('[点我](javascript:alert(1))')).toContain('点我');
    expect(html('![猫咪](x.png)')).toContain('猫咪');
  });
});
