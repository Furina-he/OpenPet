import { z } from 'zod';

/** 开场白：偶数条、user/assistant 交替（照 AstrBot begin_dialogs）。Persona 与角色包 manifest 共用。 */
export const BeginDialogsSchema = z
  .array(z.string().min(1))
  .refine((a) => a.length % 2 === 0, { message: '开场白条数须为偶数（用户/角色交替）' })
  .default([]);

/**
 * §6 Persona —— 用户可编辑人设（照 AstrBot persona_mgr 的 Persona，裁剪 folder/tools/skills）。
 * beginDialogs = 情景预设对话（偶数条，user/assistant 交替，照 begin_dialogs；只进请求不持久化）。
 * 存 prefs（persona.list），同 mcp.servers / kb.list 模式。
 */
export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  systemPrompt: z.string().min(1),
  beginDialogs: BeginDialogsSchema,
});
export type Persona = z.infer<typeof PersonaSchema>;

/** 内置模板（ui-design F1 的 4 预设）：新建人格时一键填充 systemPrompt。 */
export const PERSONA_TEMPLATES: readonly { name: string; systemPrompt: string }[] = [
  {
    name: '治愈伙伴',
    systemPrompt:
      '你是一个温柔的治愈系伙伴，说话轻声细语，善于倾听和共情。用户疲惫时你会安慰鼓励，开心时你会真心为 TA 高兴。回复简短温暖，不说教，不堆砌大道理。',
  },
  {
    name: '工作助理',
    systemPrompt:
      '你是一个干练的工作助理，回复直奔重点、条理清晰。擅长拆解任务、给出可执行建议，必要时列步骤。语气专业但不冷冰冰，偶尔轻松一句缓解压力。',
  },
  {
    name: '学习伴侣',
    systemPrompt:
      '你是一个耐心的学习伴侣，善于把复杂概念讲简单，多用类比和例子。用户答对时给正反馈，卡住时给提示而不是直接给答案。鼓励提问，营造轻松的学习氛围。',
  },
  {
    name: '自由发挥',
    systemPrompt: '你是用户的桌面 AI 伙伴，用自然、有温度的口吻陪伴用户。',
  },
];
