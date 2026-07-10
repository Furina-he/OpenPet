import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { zhCN } from '../src/renderer/i18n/locales/zh-CN';
import { en } from '../src/renderer/i18n/locales/en';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [`${prefix}${k}`]
      : flatten(v as Record<string, unknown>, `${prefix}${k}.`),
  );
}

describe('i18n locales', () => {
  it('zh-CN 与 en 键集合完全相等（防漏译）', () => {
    expect(flatten(en).sort()).toEqual(flatten(zhCN).sort());
  });
  it('所有词条非空', () => {
    const check = (o: Record<string, unknown>): void =>
      Object.values(o).forEach((v) =>
        typeof v === 'string' ? expect(v.length).toBeGreaterThan(0) : check(v as never),
      );
    check(zhCN);
    check(en);
  });
  it('所有词条可被 vue-i18n 编译——裸 @/| 是消息语法，会炸整页（2026-07-08 实证）', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      fallbackLocale: 'zh-CN',
      messages: { 'zh-CN': zhCN, en },
    });
    for (const [locale, msgs] of [
      ['zh-CN', zhCN],
      ['en', en],
    ] as const) {
      i18n.global.locale.value = locale;
      for (const key of flatten(msgs)) {
        expect(() => i18n.global.t(key), `${locale} → ${key}`).not.toThrow();
      }
    }
  });
});
