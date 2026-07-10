export interface SkillContext {
  chat: { systemSay(text: string): void };
  timer: { in(spec: string, cb: () => void): void };
}

export interface SkillConfig {
  id: string;
  setup(ctx: SkillContext): void | Promise<void>;
}

/** Skill 插件声明（thin：Worker 内 setup 经 SDK 上行到 Main PluginHost）。 */
export function defineSkill(config: SkillConfig): SkillConfig {
  return config;
}
