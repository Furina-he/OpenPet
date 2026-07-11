/** ⑩.7 试讲链路：prompt 形状 + provider 单发 + 行为标签解析 → cue 通道播放（不落库）。 */
import { describe, expect, it, vi } from 'vitest';
import type { CharacterManifest } from '@openpet/protocol';
import { buildGreetingMessages, runTestGreeting } from '../electron/main/character-greeting.js';

const MANIFEST: CharacterManifest = {
  id: 'miko',
  name: '巫女',
  version: '1.0.0',
  engine: 'vrm',
  model: 'model.vrm',
  emotions: { happy: { happy: 1 }, shy: { happy: 0.4 } },
  actions: ['wave', 'nod'],
};

describe('buildGreetingMessages（prompt 形状）', () => {
  it('system = 生效 persona 正文 + 行为标签段（角色词表）；user = 30 字内问候指令', () => {
    const msgs = buildGreetingMessages(MANIFEST, { systemPrompt: '你是神社巫女。' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('你是神社巫女。');
    expect(msgs[0]!.content).toContain('行为标签');
    expect(msgs[0]!.content).toContain('happy, shy'); // manifest 词表而非默认 8 表情
    expect(msgs[0]!.content).toContain('wave, nod');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('30');
  });
  it('无生效 persona → 内置一句兜底（含角色名）', () => {
    const msgs = buildGreetingMessages(MANIFEST, null);
    expect(msgs[0]!.content).toContain('巫女');
  });
});

function okFetch(content: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));
}
const TARGET = { apiBase: 'https://api.test/v1', model: 'gpt-x', key: 'sk-1', adapter: 'openai' };

describe('runTestGreeting（单发 + 解析 + 播放）', () => {
  it('解析出表情/动作/干净台词并走既有广播通道', async () => {
    const fetchImpl = okFetch('<emo:happy/>你好呀！<act:wave/>今天也一起加油！');
    const broadcast = vi.fn();
    await runTestGreeting(MANIFEST, null, {
      fetchImpl: fetchImpl as never,
      resolveTarget: () => TARGET,
      broadcast,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(JSON.parse(init.body).stream).toBe(false);
    expect(init.headers.authorization).toBe('Bearer sk-1');
    expect(broadcast).toHaveBeenCalledWith('behavior.applyEmotion', { name: 'happy', weight: 1 });
    expect(broadcast).toHaveBeenCalledWith('behavior.playAction', { name: 'wave', durationMs: null });
    expect(broadcast).toHaveBeenCalledWith('pet.say', { text: '你好呀！今天也一起加油！' });
  });
  it('无标签 → 只有台词广播', async () => {
    const broadcast = vi.fn();
    await runTestGreeting(MANIFEST, null, {
      fetchImpl: okFetch('主人好～') as never,
      resolveTarget: () => TARGET,
      broadcast,
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('pet.say', { text: '主人好～' });
  });
  it('chat provider 未配置 → 抛错（按钮侧禁用/toast）', async () => {
    await expect(
      runTestGreeting(MANIFEST, null, {
        fetchImpl: okFetch('x') as never,
        resolveTarget: () => null,
        broadcast: vi.fn(),
      }),
    ).rejects.toThrow(/provider|模型/);
  });
  it('上游 HTTP 失败 → 抛错', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(
      runTestGreeting(MANIFEST, null, {
        fetchImpl: bad as never,
        resolveTarget: () => TARGET,
        broadcast: vi.fn(),
      }),
    ).rejects.toThrow(/500/);
  });
  it('上游空回复 → 抛错不广播', async () => {
    const broadcast = vi.fn();
    await expect(
      runTestGreeting(MANIFEST, null, {
        fetchImpl: okFetch('') as never,
        resolveTarget: () => TARGET,
        broadcast,
      }),
    ).rejects.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
