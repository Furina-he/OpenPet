import { describe, it, expect } from 'vitest';
import type { ModelEntry, ProviderSource, VoiceProfile } from '@openpet/protocol';
import {
  appendChip,
  bindingLabel,
  draftToProfile,
  emptyDraft,
  mimoSourceOptions,
  newVoiceId,
  sortCards,
  toCardVm,
  ttsModelOptions,
  validateRefUpload,
} from '../src/renderer/settings/voice-studio-state.js';

const id = () => 'vp_fixed';

describe('draftToProfile', () => {
  it('preset：engine/voiceName 组装 + 校验通过', () => {
    const d = { ...emptyDraft(), name: '预设 A', voiceName: 'nova' };
    const r = draftToProfile(d, id);
    expect(r).toEqual({
      ok: true,
      profile: { id: 'vp_fixed', name: '预设 A', kind: 'preset', engine: 'openai', voiceName: 'nova' },
    });
  });

  it('preset：voiceName 空 → 失败并指出字段', () => {
    const r = draftToProfile({ ...emptyDraft(), name: 'x' }, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('voiceName');
  });

  it('design：engine 固定 mimo；空串字段剔除', () => {
    const d = {
      ...emptyDraft(),
      kind: 'design' as const,
      name: '设计 A',
      stylePrompt: ' 温柔少女 ',
      dialect: '',
      seedText: '',
    };
    const r = draftToProfile(d, id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.engine).toBe('mimo');
      expect(r.profile.stylePrompt).toBe('温柔少女');
      expect(r.profile.dialect).toBeUndefined();
    }
  });

  it('clone：refAudioFile+refText → gptsovits 通过；referenceId 只在 fishaudio 生效', () => {
    const okGsv = draftToProfile(
      { ...emptyDraft(), kind: 'clone', name: 'c', refAudioFile: 'ref.wav', refText: '参考' },
      id,
    );
    expect(okGsv.ok).toBe(true);

    // gptsovits 下填了 referenceId 也不会带上（referenceId 仅 fishaudio）
    const gsvWithRef = draftToProfile(
      {
        ...emptyDraft(),
        kind: 'clone',
        name: 'c',
        refAudioFile: 'ref.wav',
        refText: '参考',
        referenceId: '626bb6d3f3364c9cbc3aa6a67300a664',
      },
      id,
    );
    expect(gsvWithRef.ok && !('referenceId' in gsvWithRef.profile && gsvWithRef.profile.referenceId)).toBe(
      true,
    );

    const okFishRef = draftToProfile(
      {
        ...emptyDraft(),
        kind: 'clone',
        name: 'c',
        cloneEngine: 'fishaudio',
        referenceId: '626bb6d3f3364c9cbc3aa6a67300a664',
      },
      id,
    );
    expect(okFishRef.ok).toBe(true);

    const missing = draftToProfile({ ...emptyDraft(), kind: 'clone', name: 'c' }, id);
    expect(missing.ok).toBe(false);
  });
});

describe('卡片 VM', () => {
  const preset: VoiceProfile = {
    id: 'vp_1',
    name: 'A',
    kind: 'preset',
    engine: 'openai',
    voiceName: 'nova',
  };
  const design: VoiceProfile = {
    id: 'vp_2',
    name: 'B',
    kind: 'design',
    engine: 'mimo',
    stylePrompt: '温柔',
    dialect: '粤语',
  };

  it('detail 按 kind 取材；isDefault 对齐 defaultId', () => {
    expect(toCardVm(preset, 'vp_1')).toMatchObject({ isDefault: true, detail: 'nova' });
    expect(toCardVm(design, 'vp_1')).toMatchObject({ isDefault: false, detail: '温柔 · 粤语' });
  });

  it('sortCards 默认置顶、其余稳定', () => {
    const cards = [toCardVm(preset, 'vp_2'), toCardVm(design, 'vp_2')];
    expect(sortCards(cards).map((c) => c.id)).toEqual(['vp_2', 'vp_1']);
  });
});

describe('显式连接绑定（真窗反馈）', () => {
  const src = (over: Partial<ProviderSource>): ProviderSource =>
    ({
      id: 'src',
      adapter: 'openai',
      capability: 'tts',
      apiBase: 'http://x/v1',
      key: '',
      enabled: true,
      ...over,
    }) as ProviderSource;
  const sources: ProviderSource[] = [
    src({ id: 'oa', name: 'OpenAI TTS' }),
    src({ id: 'mimo', name: 'MiMo', icon: 'mimo' }),
    src({ id: 'off', enabled: false }),
    src({ id: 'chat', capability: 'chat' }),
  ];
  const models: ModelEntry[] = [
    { id: 'oa/tts-1', sourceId: 'oa', model: 'tts-1', enabled: true, caps: {} },
    { id: 'oa/tts-off', sourceId: 'oa', model: 'tts-off', enabled: false, caps: {} },
    { id: 'mimo/m1', sourceId: 'mimo', model: 'mimo-v2.5-tts', enabled: true, caps: {} },
    { id: 'off/m', sourceId: 'off', model: 'x', enabled: true, caps: {} },
    { id: 'chat/m', sourceId: 'chat', model: 'gpt', enabled: true, caps: {} },
  ];

  it('ttsModelOptions：只列启用 TTS 源下的启用模型，带 mimo 判别', () => {
    expect(ttsModelOptions(sources, models)).toEqual([
      { value: 'oa/tts-1', label: 'OpenAI TTS · tts-1', mimo: false },
      { value: 'mimo/m1', label: 'MiMo · mimo-v2.5-tts', mimo: true },
    ]);
  });

  it('mimoSourceOptions：仅启用的 MiMo TTS 源', () => {
    expect(mimoSourceOptions(sources)).toEqual([{ value: 'mimo', label: 'MiMo' }]);
  });

  it('draftToProfile 带上 modelId / sourceId（空串剔除）', () => {
    const p1 = draftToProfile(
      { ...emptyDraft(), name: 'a', voiceName: 'nova', modelId: 'oa/tts-1' },
      () => 'vp_1',
    );
    expect(p1.ok && p1.profile.modelId).toBe('oa/tts-1');
    const p2 = draftToProfile(
      { ...emptyDraft(), kind: 'design', name: 'b', stylePrompt: '温柔', sourceId: 'mimo' },
      () => 'vp_2',
    );
    expect(p2.ok && p2.profile.sourceId).toBe('mimo');
    const p3 = draftToProfile({ ...emptyDraft(), name: 'c', voiceName: 'nova' }, () => 'vp_3');
    expect(p3.ok && p3.profile.modelId).toBeUndefined();
  });

  it('bindingLabel：preset 查模型 / design 拼 designModel / clone 报引擎 / 失效回默认', () => {
    const dm = 'mimo-v2.5-tts-voicedesign';
    expect(
      bindingLabel(
        { kind: 'preset', engine: 'openai', modelId: 'oa/tts-1' },
        sources,
        models,
        dm,
        '默认 TTS',
      ),
    ).toBe('OpenAI TTS · tts-1');
    expect(
      bindingLabel({ kind: 'preset', engine: 'openai' }, sources, models, dm, '默认 TTS'),
    ).toBe('默认 TTS');
    expect(
      bindingLabel(
        { kind: 'preset', engine: 'openai', modelId: 'gone' },
        sources,
        models,
        dm,
        '默认 TTS',
      ),
    ).toBe('默认 TTS');
    expect(
      bindingLabel(
        { kind: 'design', engine: 'mimo', sourceId: 'mimo' },
        sources,
        models,
        dm,
        '默认 TTS',
      ),
    ).toBe(`MiMo · ${dm}`);
    expect(
      bindingLabel({ kind: 'clone', engine: 'gptsovits' }, sources, models, dm, '默认 TTS'),
    ).toBe('GPT-SoVITS');
  });
});

describe('工具函数', () => {
  it('appendChip 去重 + 空格拼接', () => {
    expect(appendChip('', '温柔')).toBe('温柔');
    expect(appendChip('温柔', '少女')).toBe('温柔 少女');
    expect(appendChip('温柔 少女', '温柔')).toBe('温柔 少女');
  });

  it('validateRefUpload 类型/大小预检', () => {
    expect(validateRefUpload('a.wav', 1024)).toBeNull();
    expect(validateRefUpload('a.MP3', 1024)).toBeNull();
    expect(validateRefUpload('a.webm', 1024)).toBe('type');
    expect(validateRefUpload('a.wav', 10 * 1024 * 1024 + 1)).toBe('size');
  });

  it('newVoiceId：vp_ 前缀 + 去连字符截断', () => {
    expect(newVoiceId(() => 'ab-cd-ef-gh-ij-kl-mn')).toBe('vp_abcdefghijkl');
  });
});
