import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods.js';
import { PrefsSchema } from '../src/prefs.js';

describe('voice protocol', () => {
  it('prefs voice.autoSpeak 默认 false', () => {
    expect(PrefsSchema.parse({})['voice.autoSpeak']).toBe(false);
  });
  it('voice.speak / voice.transcribe / voice.audio 注册', () => {
    expect(Methods['voice.speak'].params.safeParse({ text: '你好' }).success).toBe(true);
    expect(
      Methods['voice.transcribe'].params.safeParse({ dataBase64: 'AA==', mime: 'audio/webm' })
        .success,
    ).toBe(true);
    expect(
      Methods['voice.audio'].params.safeParse({ dataBase64: 'AA==', mime: 'audio/mpeg' }).success,
    ).toBe(true);
  });
  it('voice.speak 空文本拒绝', () => {
    expect(Methods['voice.speak'].params.safeParse({ text: '' }).success).toBe(false);
  });

  // --- ⑩.6 音色工坊 RPC ---
  it('voice.audio 可带 rate（播放端兜底变速）', () => {
    expect(
      Methods['voice.audio'].params.safeParse({ dataBase64: 'AA==', mime: 'audio/wav', rate: 1.5 })
        .success,
    ).toBe(true);
  });
  it('voice.previewProfile：profile 过 VoiceProfileSchema + 非空文本', () => {
    const profile = {
      id: 'vp_1',
      name: 'x',
      kind: 'preset',
      engine: 'openai',
      voiceName: 'alloy',
    };
    expect(
      Methods['voice.previewProfile'].params.safeParse({ profile, text: '试听' }).success,
    ).toBe(true);
    expect(
      Methods['voice.previewProfile'].params.safeParse({ profile: { id: 'bad' }, text: '试听' })
        .success,
    ).toBe(false);
    expect(Methods['voice.previewProfile'].params.safeParse({ profile, text: '' }).success).toBe(
      false,
    );
  });
  it('voice.testEngine 仅 gptsovits/fishaudio', () => {
    expect(Methods['voice.testEngine'].params.safeParse({ engine: 'gptsovits' }).success).toBe(
      true,
    );
    expect(Methods['voice.testEngine'].params.safeParse({ engine: 'fishaudio' }).success).toBe(
      true,
    );
    expect(Methods['voice.testEngine'].params.safeParse({ engine: 'openai' }).success).toBe(false);
  });
  it('voice.stopPlayback / voice.stop（bargeIn）注册', () => {
    expect(Methods['voice.stopPlayback'].params.safeParse({}).success).toBe(true);
    expect(Methods['voice.stop'].params.safeParse({}).success).toBe(true);
  });
  it('voice.saveRefAudio / commitRefAudio / removeVoiceDir 注册', () => {
    expect(
      Methods['voice.saveRefAudio'].params.safeParse({ dataBase64: 'AA==', mime: 'audio/wav' })
        .success,
    ).toBe(true);
    expect(
      Methods['voice.commitRefAudio'].params.safeParse({ voiceId: 'vp_1', file: 'ref.wav' })
        .success,
    ).toBe(true);
    expect(Methods['voice.removeVoiceDir'].params.safeParse({ id: 'vp_1' }).success).toBe(true);
    expect(Methods['voice.removeVoiceDir'].params.safeParse({ id: '' }).success).toBe(false);
  });
});
