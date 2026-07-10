import { z } from 'zod';

/** 配置项元数据（对齐 AstrBot itemMeta；camelCase）。 */
export const ConfigItemMetaSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'text', 'int', 'float', 'bool', 'list', 'dict', 'file']).default('string'),
  label: z.string().optional(),
  description: z.string().optional(),
  hint: z.string().optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
  labels: z.array(z.string()).optional(),
  renderType: z.enum(['checkbox']).optional(),
  slider: z.object({ min: z.number(), max: z.number(), step: z.number().optional() }).optional(),
  /** = AstrBot _special：selectProvider / selectPersona / selectKnowledgeBase 等。 */
  special: z.string().optional(),
  /** = AstrBot collapsed：归入"高级（默认折叠）"。 */
  advanced: z.boolean().default(false),
  readonly: z.boolean().default(false),
});
export type ConfigItemMeta = z.infer<typeof ConfigItemMetaSchema>;

export type WidgetKind =
  | 'selectProvider'
  | 'selectPersona'
  | 'selectKnowledgeBase'
  | 'checkbox-group'
  | 'multi-select'
  | 'select'
  | 'slider'
  | 'number'
  | 'string'
  | 'text'
  | 'bool'
  | 'dict'
  | 'list'
  | 'file';

/** metadata → 控件类型（分发顺序对齐 AstrBot ConfigItemRenderer）。纯函数。 */
export function pickWidget(m: ConfigItemMeta): WidgetKind {
  if (m.special === 'selectProvider') return 'selectProvider';
  if (m.special === 'selectPersona') return 'selectPersona';
  if (m.special === 'selectKnowledgeBase') return 'selectKnowledgeBase';
  if (m.type === 'list' && m.options && m.renderType === 'checkbox') return 'checkbox-group';
  if (m.type === 'list' && m.options) return 'multi-select';
  if (m.options) return 'select';
  if (m.type === 'int' || m.type === 'float') return m.slider ? 'slider' : 'number';
  if (m.type === 'text') return 'text';
  if (m.type === 'bool') return 'bool';
  if (m.type === 'dict') return 'dict';
  if (m.type === 'list') return 'list';
  if (m.type === 'file') return 'file';
  return 'string';
}

/** 按 advanced 标记拆分 basic / advanced（折叠）两组。纯函数。 */
export function splitBasicAdvanced(items: ConfigItemMeta[]): {
  basic: ConfigItemMeta[];
  advanced: ConfigItemMeta[];
} {
  return {
    basic: items.filter((i) => !i.advanced),
    advanced: items.filter((i) => i.advanced),
  };
}

/** 搜索过滤：空串返回全部；否则按 key/label/description 不分大小写包含。纯函数。 */
export function filterItems(items: ConfigItemMeta[], query: string): ConfigItemMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    [i.key, i.label ?? '', i.description ?? ''].some((t) => t.toLowerCase().includes(q)),
  );
}
