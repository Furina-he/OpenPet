import { describe, it, expect } from 'vitest';
import {
  DesktopPluginManifestSchema,
  StarPluginMetaSchema,
  pluginToolWireName,
} from '../src/plugin-config.js';

describe('plugin-config', () => {
  it('manifest 解析 + 默认值', () => {
    const m = DesktopPluginManifestSchema.parse({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      engine: 'desktop',
    });
    expect(m.entry).toBe('main.js');
    expect(m.permissions).toEqual([]);
    expect(m.author).toBe('');
    expect(m.description).toBe('');
  });

  it('id 形状约束（目录安全）', () => {
    expect(() =>
      DesktopPluginManifestSchema.parse({ id: 'a/b', name: 'x', version: '1', engine: 'desktop' }),
    ).toThrow();
    expect(() =>
      DesktopPluginManifestSchema.parse({ id: '../x', name: 'x', version: '1', engine: 'desktop' }),
    ).toThrow();
    expect(() =>
      DesktopPluginManifestSchema.parse({ id: 'A_Upper', name: 'x', version: '1', engine: 'desktop' }),
    ).toThrow();
  });

  it('engine 只认 desktop', () => {
    expect(() =>
      DesktopPluginManifestSchema.parse({ id: 'demo', name: 'x', version: '1', engine: 'star' }),
    ).toThrow();
  });

  it('permissions 只认已知枚举', () => {
    expect(() =>
      DesktopPluginManifestSchema.parse({
        id: 'demo',
        name: 'x',
        version: '1',
        engine: 'desktop',
        permissions: ['fs'],
      }),
    ).toThrow();
    const m = DesktopPluginManifestSchema.parse({
      id: 'demo',
      name: 'x',
      version: '1',
      engine: 'desktop',
      permissions: ['tools', 'cues', 'say', 'fetch'],
    });
    expect(m.permissions).toHaveLength(4);
  });

  it('工具连线名 LLM 安全（[A-Za-z0-9_-]，≤64）', () => {
    expect(pluginToolWireName('my-plug', '查天气!')).toMatch(/^p_my-plug_[A-Za-z0-9_-]*$/);
    expect(pluginToolWireName('x'.repeat(80), 'y').length).toBeLessThanOrEqual(64);
    expect(pluginToolWireName('demo', 'echo')).toBe('p_demo_echo');
  });

  it('star 元数据缺省字段兜底', () => {
    const meta = StarPluginMetaSchema.parse({ dir: 'checkin' });
    expect(meta.name).toBe('');
    expect(meta.commands).toEqual([]);
  });
});
