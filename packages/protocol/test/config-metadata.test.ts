import { describe, it, expect } from 'vitest';
import {
  ConfigItemMetaSchema,
  pickWidget,
  splitBasicAdvanced,
  filterItems,
  type ConfigItemMeta,
} from '../src/config-metadata.js';

const meta = (o: Partial<ConfigItemMeta> & { key: string }): ConfigItemMeta =>
  ConfigItemMetaSchema.parse(o);

describe('ConfigItemMetaSchema', () => {
  it('defaults type=string, advanced=false, readonly=false', () => {
    const m = ConfigItemMetaSchema.parse({ key: 'x' });
    expect(m).toMatchObject({ key: 'x', type: 'string', advanced: false, readonly: false });
  });
});

describe('pickWidget（对齐 AstrBot 分发顺序）', () => {
  it('special 优先', () => {
    expect(pickWidget(meta({ key: 'p', special: 'selectProvider' }))).toBe('selectProvider');
  });
  it('list+options+checkbox → checkbox-group；list+options → multi-select', () => {
    expect(pickWidget(meta({ key: 'a', type: 'list', options: ['x'], renderType: 'checkbox' }))).toBe(
      'checkbox-group',
    );
    expect(pickWidget(meta({ key: 'a', type: 'list', options: ['x'] }))).toBe('multi-select');
  });
  it('options（非 list）→ select', () => {
    expect(pickWidget(meta({ key: 'a', options: ['x', 'y'] }))).toBe('select');
  });
  it('int/float：有 slider → slider，否则 number', () => {
    expect(pickWidget(meta({ key: 'n', type: 'int', slider: { min: 0, max: 10 } }))).toBe('slider');
    expect(pickWidget(meta({ key: 'n', type: 'float' }))).toBe('number');
  });
  it('string/text/bool/dict/list/file', () => {
    expect(pickWidget(meta({ key: 's', type: 'string' }))).toBe('string');
    expect(pickWidget(meta({ key: 't', type: 'text' }))).toBe('text');
    expect(pickWidget(meta({ key: 'b', type: 'bool' }))).toBe('bool');
    expect(pickWidget(meta({ key: 'd', type: 'dict' }))).toBe('dict');
    expect(pickWidget(meta({ key: 'l', type: 'list' }))).toBe('list');
    expect(pickWidget(meta({ key: 'f', type: 'file' }))).toBe('file');
  });
});

describe('splitBasicAdvanced / filterItems', () => {
  const items = [
    meta({ key: 'apiBase', label: 'API Base' }),
    meta({ key: 'timeout', label: '超时', advanced: true }),
    meta({ key: 'proxy', label: '代理', advanced: true }),
  ];
  it('按 advanced 拆分', () => {
    const { basic, advanced } = splitBasicAdvanced(items);
    expect(basic.map((i) => i.key)).toEqual(['apiBase']);
    expect(advanced.map((i) => i.key)).toEqual(['timeout', 'proxy']);
  });
  it('filterItems 按 key/label 不分大小写命中', () => {
    expect(filterItems(items, '代理').map((i) => i.key)).toEqual(['proxy']);
    expect(filterItems(items, 'API').map((i) => i.key)).toEqual(['apiBase']);
    expect(filterItems(items, '').map((i) => i.key)).toEqual(['apiBase', 'timeout', 'proxy']);
  });
});
