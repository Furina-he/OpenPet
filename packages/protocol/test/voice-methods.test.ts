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
});
