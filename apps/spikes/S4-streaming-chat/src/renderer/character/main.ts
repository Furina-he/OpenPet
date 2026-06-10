// Character renderer — the "dumb player" end of the behavior track. It holds no
// business state: it just subscribes to behavior.* notifications and reflects
// them. S3 proved real VRM BlendShape switching; here we use a lightweight
// emoji face (the VRM model is gitignored / not in the repo) so the spike stays
// self-contained while still proving the behavior channel drives the renderer
// live, in lockstep with the text stream.

interface DesksoulApi {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  on: (channel: string, cb: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    desksoul: DesksoulApi;
  }
}

const faceEl = document.getElementById('face') as HTMLDivElement;
const emotionEl = document.getElementById('emotion') as HTMLDivElement;
const intentEl = document.getElementById('intent') as HTMLDivElement;
const actionEl = document.getElementById('action') as HTMLDivElement;

// 8 emotions → emoji (mirrors S3's EMOTIONS set) + neutral reset.
const FACE: Record<string, string> = {
  neutral: '😐',
  happy: '😊',
  angry: '😠',
  sad: '😢',
  relaxed: '😌',
  surprised: '😲',
  shy: '😳',
  thinking: '🤔',
  confused: '😕',
};

window.desksoul.on('behavior.applyEmotion', (payload) => {
  const { name, weight } = payload as { name: string; weight: number };
  faceEl.textContent = FACE[name] ?? '🙂';
  emotionEl.textContent = `emotion: ${name} (w=${weight})`;
  // brief pop so rapid emotion changes are visible during the stream
  faceEl.classList.add('pop');
  setTimeout(() => faceEl.classList.remove('pop'), 180);
});

window.desksoul.on('behavior.playAction', (payload) => {
  const { name, durationMs } = payload as { name: string; durationMs: number | null };
  actionEl.textContent = `action: ${name}${durationMs ? ` (${durationMs}ms)` : ''}`;
  const hold = durationMs ?? 800;
  setTimeout(() => {
    if (actionEl.textContent?.startsWith(`action: ${name}`)) actionEl.textContent = '';
  }, hold);
});

window.desksoul.on('behavior.setIntent', (payload) => {
  const { mood, energy } = payload as { mood: string; energy: string };
  intentEl.textContent = `intent: mood=${mood} energy=${energy}`;
});

// Reset face when a reply finishes so the next turn starts neutral.
window.desksoul.on('chat.done', () => {
  setTimeout(() => {
    faceEl.textContent = FACE.neutral!;
    emotionEl.textContent = 'emotion: neutral';
    intentEl.textContent = '';
    actionEl.textContent = '';
  }, 1200);
});

export {};
