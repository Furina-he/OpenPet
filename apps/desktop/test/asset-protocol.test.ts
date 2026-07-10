import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveAssetPath } from '../electron/main/asset-protocol';

const ROOT = path.resolve('/data/characters');
const resolved = (...p: string[]) => path.resolve(ROOT, ...p);

describe('resolveAssetPath', () => {
  it('maps asset://<id>/<file> into the character dir', () => {
    expect(resolveAssetPath([ROOT], 'asset://default/model.vrm')).toBe(
      resolved('default', 'model.vrm'),
    );
    expect(resolveAssetPath([ROOT], 'asset://miko-2/assets/tex.png')).toBe(
      resolved('miko-2', 'assets', 'tex.png'),
    );
  });

  it('ignores query string and decodes percent-encoding', () => {
    expect(resolveAssetPath([ROOT], 'asset://default/model.vrm?v=1')).toBe(
      resolved('default', 'model.vrm'),
    );
    expect(resolveAssetPath([ROOT], 'asset://default/a%20b.png')).toBe(
      resolved('default', 'a b.png'),
    );
  });

  it('404s traversal / absolute / backslash / drive-letter attempts', () => {
    // 字面 .. 在 WHATWG URL 解析阶段就被规范化（asset://default/../other/x →
    // pathname /other/x），结果仍被限制在本包内 —— 安全不变量是「限制」而非 404
    const literalDotDot = resolveAssetPath([ROOT], 'asset://default/../other/secret.vrm');
    expect(literalDotDot).toBe(resolved('default', 'other', 'secret.vrm'));
    // 编码 %2e%2e 同样在 URL 解析阶段被当 dot-segment 规范化（WHATWG spec）：
    // /%2e%2e/secret.vrm → /secret.vrm，仍限制在本包内；段检查 + 前缀校验是后备防线
    expect(resolveAssetPath([ROOT], 'asset://default/%2e%2e/secret.vrm')).toBe(
      resolved('default', 'secret.vrm'),
    );
    expect(resolveAssetPath([ROOT], 'asset://default/a%5Cb.png')).toBeNull(); // 反斜杠
    expect(resolveAssetPath([ROOT], 'asset://default//etc/passwd')).toBeNull(); // 空段
    expect(resolveAssetPath([ROOT], 'asset://default/C:/win.ini')).toBeNull(); // 段含冒号
  });

  it('404s bad character id host', () => {
    expect(resolveAssetPath([ROOT], 'asset://../model.vrm')).toBeNull();
    expect(resolveAssetPath([ROOT], 'asset:///model.vrm')).toBeNull(); // 空 host
    expect(resolveAssetPath([ROOT], 'asset://a_b/model.vrm')).toBeNull(); // 下划线不在 id 词表
  });

  it('404s empty path and non-asset scheme and garbage', () => {
    expect(resolveAssetPath([ROOT], 'asset://default/')).toBeNull();
    expect(resolveAssetPath([ROOT], 'asset://default')).toBeNull();
    expect(resolveAssetPath([ROOT], 'file:///etc/passwd')).toBeNull();
    expect(resolveAssetPath([ROOT], 'not a url')).toBeNull();
  });

  it('cross-package escape is impossible (URL normalization + prefix check 双保险)', () => {
    // URL 解析把 sub/../../default2/x.png 规范化为 /default2/x.png —— 仍在本包内；
    // 任何输入的解析结果都必须落在 <root>/<id>/ 前缀下
    const r = resolveAssetPath([ROOT], 'asset://default/sub/../../default2/x.png');
    expect(r).toBe(resolved('default', 'default2', 'x.png'));
    expect(r!.startsWith(resolved('default') + path.sep)).toBe(true);
  });

  it('多根解析：按顺序找存在的文件，均不存在 → 首根路径（自然 404）', () => {
    const hits = new Set(['/r2/miko/model.vrm'.split('/').join(path.sep)]);
    const exists = (p: string): boolean => hits.has(p.replace(/^([A-Za-z]:)?/, ''));
    const got = resolveAssetPath(['/r1', '/r2'], 'asset://miko/model.vrm', exists);
    expect(got?.replace(/\\/g, '/')).toContain('/r2/miko/model.vrm');
  });
});
