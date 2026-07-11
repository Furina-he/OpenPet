/**
 * ⑩.7 试讲（E4 testGreeting）：取生效 persona 组 system prompt（行为标签段用角色词表）
 * → provider 一次性非流式单发（镜像 memory-extractor：openai 兼容 + bearer）→
 * BehaviorParser 解析首个表情/动作 + 干净台词 → 走既有 cue 播放通道广播。
 * 明确不落库：不建 session、不进记忆、不计统计（绕过 ChatService）。
 */
import {
  BehaviorParser,
  buildSystemPrompt,
  type CharacterManifest,
} from '@openpet/protocol';
import type { FetchLike } from './rerank-client.js';
import { RpcError } from './router.js';

export interface GreetingMessage {
  role: 'system' | 'user';
  content: string;
}

/** 纯函数：prompt 形状（persona 生效链正文 + 行为标签段 + 30 字内问候指令）。 */
export function buildGreetingMessages(
  manifest: CharacterManifest,
  persona: { systemPrompt: string } | null,
): GreetingMessage[] {
  const system = buildSystemPrompt({
    name: manifest.name,
    ...(persona?.systemPrompt ? { personaPrompt: persona.systemPrompt } : {}),
    ...(manifest.emotions ? { emotions: Object.keys(manifest.emotions) } : {}),
    ...(manifest.actions ? { actions: manifest.actions } : {}),
  });
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        '请用不超过 30 个字向用户打个招呼（试讲）。可以带一个表情标签和一个动作标签，不要问问题。',
    },
  ];
}

export interface GreetingDeps {
  fetchImpl: FetchLike;
  resolveTarget: () => { apiBase: string; model: string; key: string; adapter: string } | null;
  broadcast: (channel: string, params: unknown) => void;
}

/** 执行试讲：单发 → 解析 → 广播（behavior.applyEmotion / behavior.playAction / pet.say）。 */
export async function runTestGreeting(
  manifest: CharacterManifest,
  persona: { systemPrompt: string } | null,
  deps: GreetingDeps,
): Promise<void> {
  const target = deps.resolveTarget();
  if (!target) throw new RpcError(-32001, 'chat provider 未配置，请先在「模型 API」选择默认模型');
  const res = await deps.fetchImpl(`${target.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(target.key ? { authorization: `Bearer ${target.key}` } : {}),
    },
    body: JSON.stringify({
      model: target.model,
      stream: false,
      messages: buildGreetingMessages(manifest, persona),
    }),
  });
  if (!res.ok) throw new RpcError(-32000, `试讲上游失败：HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new RpcError(-32000, '试讲上游返回空回复');

  const parser = new BehaviorParser();
  let emotion: { name: string; weight: number } | null = null;
  let action: { name: string; durationMs: number | null } | null = null;
  let text = '';
  for (const ev of [...parser.feed(content), ...parser.flush()]) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'emotion' && !emotion) emotion = { name: ev.name, weight: ev.weight };
    else if (ev.type === 'action' && !action) action = { name: ev.name, durationMs: ev.durationMs };
  }
  if (emotion) deps.broadcast('behavior.applyEmotion', emotion);
  if (action) deps.broadcast('behavior.playAction', action);
  const say = text.trim();
  if (say) deps.broadcast('pet.say', { text: say });
}
