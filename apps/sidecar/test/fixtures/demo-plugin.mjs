// Desktop 插件 fixture：1 工具 + 1 崩溃工具 + 1 fetch 工具 + 1 cue + activate say。
// T2 plugin-entry 测试 / T3 desktop-plugin-host 测试共用。
let saved;

export default {
  tools: [
    {
      name: 'echo',
      description: 'echo args back',
      parameters: { type: 'object' },
      execute: (args) => ({ echoed: args }),
    },
    {
      name: 'boom',
      description: 'crash the worker (supervision test)',
      parameters: { type: 'object' },
      execute: () => process.exit(1),
    },
    {
      name: 'fetchit',
      description: 'proxy fetch roundtrip',
      parameters: { type: 'object' },
      execute: async (args, ctx) => await ctx.fetch(String(args.url)),
    },
  ],
  cues: [{ id: 'plug-cue', on: 'chat.done', do: [] }],
  activate(ctx) {
    saved = ctx;
    ctx.say('hi from plugin');
  },
  onConfigChanged(config) {
    saved?.log(`config-changed:${JSON.stringify(config)}`);
  },
};
