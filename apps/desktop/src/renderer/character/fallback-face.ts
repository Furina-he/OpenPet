/** 8 情绪 emoji 脸 —— VRM 不可用时的降级渲染（S4 验证的行为通道载体）。 */
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

export interface FallbackFace {
  apply(name: string): void;
  setAction(name: string, durationMs: number | null): void;
  setIntent(mood: string, energy: string): void;
  reset(): void;
}

export function mountFallbackFace(root: HTMLElement): FallbackFace {
  root.innerHTML = `
    <div class="face-disc">
      <div class="face" id="fb-face">😐</div>
    </div>
    <div class="hud" id="fb-emotion">emotion: neutral</div>
    <div class="hud" id="fb-intent"></div>
    <div class="hud" id="fb-action"></div>
  `;
  const faceEl = root.querySelector<HTMLDivElement>('#fb-face')!;
  const emotionEl = root.querySelector<HTMLDivElement>('#fb-emotion')!;
  const intentEl = root.querySelector<HTMLDivElement>('#fb-intent')!;
  const actionEl = root.querySelector<HTMLDivElement>('#fb-action')!;

  return {
    apply(name) {
      faceEl.textContent = FACE[name] ?? '🙂';
      emotionEl.textContent = `emotion: ${name}`;
      faceEl.classList.add('pop');
      setTimeout(() => faceEl.classList.remove('pop'), 180);
    },
    setAction(name, durationMs) {
      actionEl.textContent = `action: ${name}${durationMs ? ` (${durationMs}ms)` : ''}`;
      setTimeout(() => {
        if (actionEl.textContent?.startsWith(`action: ${name}`)) actionEl.textContent = '';
      }, durationMs ?? 800);
    },
    setIntent(mood, energy) {
      intentEl.textContent = `intent: mood=${mood} energy=${energy}`;
    },
    reset() {
      faceEl.textContent = FACE['neutral']!;
      emotionEl.textContent = 'emotion: neutral';
      intentEl.textContent = '';
      actionEl.textContent = '';
    },
  };
}
