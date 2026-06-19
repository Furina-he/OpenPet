/** D3/C2 provider 配置的纯视图计算（无 Vue 依赖，便于单测）。 */

export interface ProviderRow {
  id: string;
  name: string;
  kind: 'chat' | 'embedding';
  hasKey: boolean;
  enabled: boolean;
  models: string[];
}

export interface ListRow {
  id: string;
  name: string;
  model: string;
  hasKey: boolean;
  lastTestOk: boolean | null;
}

/** 某 provider 的可选模型：ollama 有检测结果优先用之，否则用 provider.models。 */
export function modelsFor(providers: ProviderRow[], ollamaModels: string[], id: string): string[] {
  if (id === 'ollama' && ollamaModels.length) return ollamaModels;
  return providers.find((p) => p.id === id)?.models ?? [];
}

/** 左栏列表行：当前 provider 显示已选 activeModel，其余显示各自首个模型。 */
export function buildRows(
  providers: ProviderRow[],
  activeId: string,
  activeModel: string,
  ollamaModels: string[],
  testOk: Record<string, boolean | null>,
): ListRow[] {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    model:
      p.id === activeId && activeModel
        ? activeModel
        : (modelsFor(providers, ollamaModels, p.id)[0] ?? ''),
    hasKey: p.hasKey,
    lastTestOk: testOk[p.id] ?? null,
  }));
}

/** 默认模型下拉显示值：已选模型属当前列表则用它，否则回退首个（= worker 缺省 defaultModels[0]）。 */
export function activeModelValue(activeModels: string[], savedModel: string): string {
  return savedModel && activeModels.includes(savedModel) ? savedModel : (activeModels[0] ?? '');
}
