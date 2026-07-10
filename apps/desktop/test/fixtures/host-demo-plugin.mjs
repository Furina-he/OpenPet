// host 测试 fixture：echo/boom/fetchit 工具 + cue + activate say（permissions 由 init 决定）。
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
      description: 'crash the worker',
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
  cues: [{ on: 'chat.done', say: ['plugin cue hi'] }],
  activate(ctx) {
    ctx.say('hi from plugin');
  },
};
