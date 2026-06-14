export interface ToolConfig {
  id: string;
  description?: string;
  run(args: unknown): unknown | Promise<unknown>;
}

/** Tool 插件声明（thin：Main PluginGateway 经 plugin.invokeTool 调用 run）。 */
export function defineTool(config: ToolConfig): ToolConfig {
  return config;
}
