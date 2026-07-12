import { describe, it, expect } from 'vitest';
import { nextTheme, themeTitleKey, avatarInitialOf } from '../src/renderer/settings/shell-view.js';

describe('nextTheme（顶栏主题三态循环）', () => {
  it('light → dark → system → light', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });

  it('title key 跟随当前态', () => {
    expect(themeTitleKey('light')).toBe('settings.shell.themeLight');
    expect(themeTitleKey('dark')).toBe('settings.shell.themeDark');
    expect(themeTitleKey('system')).toBe('settings.shell.themeSystem');
  });
});

describe('avatarInitialOf（角色卡头像首字符）', () => {
  it('中英文取首字符；带空白先 trim', () => {
    expect(avatarInitialOf('小灵')).toBe('小');
    expect(avatarInitialOf(' Furina ')).toBe('F');
  });

  it('emoji 码点安全不劈半', () => {
    expect(avatarInitialOf('🐧企鹅')).toBe('🐧');
  });

  it('空名回退 O', () => {
    expect(avatarInitialOf('')).toBe('O');
    expect(avatarInitialOf('   ')).toBe('O');
  });
});
