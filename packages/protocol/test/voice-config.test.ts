import { describe, it, expect } from 'vitest';
import {
  VoiceProfileSchema,
  resolveVoiceProfile,
  type VoiceProfile,
} from '../src/voice-config.js';
import { PrefsSchema } from '../src/prefs.js';
import { CharacterManifestSchema } from '../src/character-manifest.js';

const preset = (over: Partial<VoiceProfile> = {}): VoiceProfile =>
  VoiceProfileSchema.parse({
    id: 'vp_preset1',
    name: '预设音色',
    kind: 'preset',
    engine: 'openai',
    voiceName: 'alloy',
    ...over,
  });

describe('VoiceProfileSchema 三 kind 校验', () => {
  it('preset：voiceName 必填', () => {
    expect(preset().voiceName).toBe('alloy');
    expect(
      VoiceProfileSchema.safeParse({ id: 'vp_1', name: 'x', kind: 'preset', engine: 'openai' })
        .success,
    ).toBe(false);
  });

  it('preset：engine 限 openai/mimo', () => {
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_1',
        name: 'x',
        kind: 'preset',
        engine: 'gptsovits',
        voiceName: 'alloy',
      }).success,
    ).toBe(false);
    expect(preset({ engine: 'mimo', voiceName: 'mimo_default' }).engine).toBe('mimo');
  });

  it('design：stylePrompt 必填且 engine=mimo', () => {
    const ok = VoiceProfileSchema.safeParse({
      id: 'vp_d1',
      name: '设计音色',
      kind: 'design',
      engine: 'mimo',
      stylePrompt: '温柔的少女音',
      dialect: '粤语',
      seedText: '你好呀',
    });
    expect(ok.success).toBe(true);
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_d2',
        name: 'x',
        kind: 'design',
        engine: 'openai',
        stylePrompt: '低沉男声',
      }).success,
    ).toBe(false);
    expect(
      VoiceProfileSchema.safeParse({ id: 'vp_d3', name: 'x', kind: 'design', engine: 'mimo' })
        .success,
    ).toBe(false);
  });

  it('clone：refAudioFile 路线需 refText；fishaudio 可仅 referenceId', () => {
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c1',
        name: '克隆音色',
        kind: 'clone',
        engine: 'gptsovits',
        refAudioFile: 'ref.wav',
        refText: '参考音频说的话',
      }).success,
    ).toBe(true);
    // 缺 refText
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c2',
        name: 'x',
        kind: 'clone',
        engine: 'gptsovits',
        refAudioFile: 'ref.wav',
      }).success,
    ).toBe(false);
    // 既无 refAudioFile 也无 referenceId
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c3',
        name: 'x',
        kind: 'clone',
        engine: 'fishaudio',
        refText: 'x',
      }).success,
    ).toBe(false);
    // fishaudio 平台模型：仅 referenceId（32hex）即可
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c4',
        name: 'x',
        kind: 'clone',
        engine: 'fishaudio',
        referenceId: '626bb6d3f3364c9cbc3aa6a67300a664',
      }).success,
    ).toBe(true);
    // referenceId 只属 fishaudio
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c5',
        name: 'x',
        kind: 'clone',
        engine: 'gptsovits',
        referenceId: '626bb6d3f3364c9cbc3aa6a67300a664',
      }).success,
    ).toBe(false);
    // clone engine 限 gptsovits/fishaudio
    expect(
      VoiceProfileSchema.safeParse({
        id: 'vp_c6',
        name: 'x',
        kind: 'clone',
        engine: 'openai',
        refAudioFile: 'ref.wav',
        refText: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('resolveVoiceProfile 生效序', () => {
  const vDefault = preset({ id: 'vp_default', name: '默认' });
  const vChar = preset({ id: 'vp_char', name: '角色绑定' });
  const voices = [vDefault, vChar];

  it('①角色 manifest.voice 最优先', () => {
    expect(resolveVoiceProfile('vp_char', 'vp_default', voices, 'alloy')).toEqual({
      via: 'character',
      profile: vChar,
    });
  });

  it('②角色未绑定 → defaultVoiceId', () => {
    expect(resolveVoiceProfile(undefined, 'vp_default', voices, 'alloy')).toEqual({
      via: 'default',
      profile: vDefault,
    });
  });

  it('③音色库无命中 → 旧 source.config.voice 作 legacy', () => {
    expect(resolveVoiceProfile(undefined, '', voices, 'alloy')).toEqual({
      via: 'legacy',
      voiceName: 'alloy',
    });
  });

  it('④全部未设 → null（引擎缺省）', () => {
    expect(resolveVoiceProfile(undefined, '', voices, undefined)).toBeNull();
  });

  it('空串视为未设；指向已删音色时降级下一层', () => {
    expect(resolveVoiceProfile('', 'vp_default', voices, undefined)).toEqual({
      via: 'default',
      profile: vDefault,
    });
    expect(resolveVoiceProfile('vp_gone', 'vp_default', voices, undefined)).toEqual({
      via: 'default',
      profile: vDefault,
    });
    expect(resolveVoiceProfile('vp_gone', 'vp_gone2', voices, undefined)).toBeNull();
  });
});

describe('工坊 prefs 键', () => {
  const d = PrefsSchema.parse({});
  it('音色库/默认/引擎连接默认值', () => {
    expect(d['voice.voices']).toEqual([]);
    expect(d['voice.defaultVoiceId']).toBe('');
    expect(d['voice.engines.gptsovits.apiBase']).toBe('http://127.0.0.1:9880');
    expect(d['voice.engines.fishaudio.apiBase']).toBe('https://api.fish-audio.cn');
    expect(d['voice.engines.fishaudio.key']).toBe('');
    expect(d['voice.engines.mimo.designModel']).toBe('mimo-v2.5-tts-voicedesign');
  });
  it('输出/嘴型/输入/高级默认值与边界', () => {
    expect(d['voice.rate']).toBe(1);
    expect(PrefsSchema.shape['voice.rate'].safeParse(0.4).success).toBe(false);
    expect(PrefsSchema.shape['voice.rate'].safeParse(2.1).success).toBe(false);
    expect(d['voice.mouthSync']).toBe(true);
    expect(d['voice.mouthStrength']).toBe(1);
    expect(PrefsSchema.shape['voice.mouthStrength'].safeParse(2.5).success).toBe(false);
    expect(d['voice.bargeIn']).toBe(false);
    expect(d['voice.micDeviceId']).toBe('');
  });
  it('voice.voices 数组元素过 VoiceProfileSchema', () => {
    expect(PrefsSchema.shape['voice.voices'].safeParse([{ id: 'bad' }]).success).toBe(false);
    expect(PrefsSchema.shape['voice.voices'].safeParse([preset()]).success).toBe(true);
  });
});

describe('manifest.voice（F-VC-05）', () => {
  const base = { id: 'furina', name: 'Furina', version: '1.0.0', engine: 'vrm', model: 'a.vrm' };
  it('可选；填了须非空', () => {
    expect(CharacterManifestSchema.safeParse(base).success).toBe(true);
    expect(CharacterManifestSchema.safeParse({ ...base, voice: 'vp_char' }).success).toBe(true);
    expect(CharacterManifestSchema.safeParse({ ...base, voice: '' }).success).toBe(false);
  });
});
