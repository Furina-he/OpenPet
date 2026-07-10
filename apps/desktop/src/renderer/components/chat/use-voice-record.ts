/**
 * F-VC 语音输入（Hub ChatInput 与 overlay 输入行共用）。
 * 交互 = 点击切换（照 AstrBot ChatInput handleRecordClick / 大厂桌面端惯例，
 * 非"按住说话"——鼠标滑出按钮不再误断）：
 *   idle --点击--> recording（计时，60s 上限自动停）--点击--> transcribing --完成--> idle
 *   recording --Esc--> 丢弃回 idle
 * 录音 webm/opus → 转 16kHz mono PCM16 wav（MiMo 等引擎只吃 wav，whisper 兼容；
 * 解码失败降级发原 webm）→ voice.transcribe → onText(文本)。
 * 失败/权限拒/隐私开关关 → micError 短暂置真（按钮红态）+ console，不弹窗。
 */
import { ref, onScopeDispose, type Ref } from 'vue';

const WAV_SAMPLE_RATE = 16_000; // ASR 通用采样率；mono 16bit 下 5s ≈ 160KB，IPC base64 可接受
const MAX_RECORD_MS = 60_000; // 防忘关；单次转写也不宜过长
const TICK_MS = 100;

export type VoiceState = 'idle' | 'recording' | 'transcribing';

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  writeStr(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE)),
      WAV_SAMPLE_RATE,
    );
    const src = off.createBufferSource();
    src.buffer = decoded; // OfflineAudioContext(1ch) 自动 downmix + 重采样
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWavPcm16(rendered.getChannelData(0), WAV_SAMPLE_RATE);
  } finally {
    void ctx.close();
  }
}

export interface VoiceRecorder {
  state: Ref<VoiceState>;
  micError: Ref<boolean>;
  /** 录音已进行时长（ms，100ms 粒度）；非录音态为 0。 */
  elapsedMs: Ref<number>;
  /** idle→开录；recording→停录转写；transcribing 期间忽略。 */
  toggle: () => void;
  /** 录音中丢弃（Esc 也走这里），不转写。 */
  cancel: () => void;
}

export function createVoiceRecorder(opts: {
  /** 组件禁用态下不开录（如 !ready / disabled）；缺省恒可录。 */
  enabled?: () => boolean;
  /** 转写文本回调（追加进输入框由调用方决定）。 */
  onText: (text: string) => void;
}): VoiceRecorder {
  const state = ref<VoiceState>('idle');
  const micError = ref(false);
  const elapsedMs = ref(0);
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let errTimer = 0;
  let tickTimer = 0;
  let startedAt = 0;
  let discard = false;

  function flashError(): void {
    micError.value = true;
    clearTimeout(errTimer);
    errTimer = window.setTimeout(() => {
      micError.value = false;
    }, 1500);
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      // dataURL 前缀（data:...;base64,）剥掉，只留 base64 体
      r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
      r.onerror = () => reject(r.error ?? new Error('read blob failed'));
      r.readAsDataURL(blob);
    });
  }

  function stopRecorder(): void {
    clearInterval(tickTimer);
    elapsedMs.value = 0;
    recorder?.stop(); // → onstop → finish
  }

  async function finish(): Promise<void> {
    const rec = recorder;
    recorder = null;
    rec?.stream.getTracks().forEach((t) => t.stop());
    const raw = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
    chunks = [];
    if (discard || raw.size === 0) return; // cancel 已把 state 归位
    try {
      const blob = await toWav(raw).catch((e) => {
        console.warn('[voice] wav convert failed, sending raw webm:', e);
        return raw;
      });
      const dataBase64 = await blobToBase64(blob);
      const { text } = await window.openpet.rpc('voice.transcribe', {
        dataBase64,
        mime: blob.type,
      });
      if (text) opts.onText(text);
    } catch (e) {
      console.warn('[voice] transcribe failed:', e);
      flashError();
    } finally {
      state.value = 'idle';
    }
  }

  async function start(): Promise<void> {
    if (state.value !== 'idle' || opts.enabled?.() === false) return;
    try {
      const prefs = await window.openpet.rpc('app.prefs.getAll', {});
      if (!prefs['privacy.microphone']) throw new Error('privacy.microphone off');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      discard = false;
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => void finish();
      recorder.start();
      state.value = 'recording';
      startedAt = performance.now();
      elapsedMs.value = 0;
      tickTimer = window.setInterval(() => {
        elapsedMs.value = performance.now() - startedAt;
        if (elapsedMs.value >= MAX_RECORD_MS) stopForTranscribe();
      }, TICK_MS);
    } catch (e) {
      console.warn('[voice] mic record failed:', e);
      flashError();
    }
  }

  function stopForTranscribe(): void {
    if (state.value !== 'recording') return;
    state.value = 'transcribing';
    stopRecorder();
  }

  function cancel(): void {
    if (state.value !== 'recording') return;
    discard = true;
    state.value = 'idle';
    stopRecorder();
  }

  function toggle(): void {
    if (state.value === 'recording') stopForTranscribe();
    else if (state.value === 'idle') void start();
  }

  // Esc 丢弃录音（录音态才响应）；随组件作用域清理
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') cancel();
  };
  window.addEventListener('keydown', onKeydown);
  onScopeDispose(() => {
    window.removeEventListener('keydown', onKeydown);
    clearInterval(tickTimer);
    clearTimeout(errTimer);
    discard = true;
    recorder?.stop();
  });

  return { state, micError, elapsedMs, toggle, cancel };
}
