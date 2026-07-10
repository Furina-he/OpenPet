/** A2 桌面气泡 DOM 控制器：流式追加文本、自动消失、方向。无业务（只反映 chat 文本）。 */
import { durationMs, bubbleSide } from './bubble-timer';
import type { Prefs } from '@openpet/protocol';

export interface Bubble {
  appendStream(text: string): void;
  endStream(): void;
  /** F-IT 主动台词（pet.say）：整句显示 + 按 pref 自动消失；不入会话流。 */
  say(text: string): void;
  setDuration(pref: Prefs['display.bubbleDuration']): void;
}

export function mountBubble(el: HTMLElement): Bubble {
  let pref: Prefs['display.bubbleDuration'] = '5';
  let hideTimer: number | null = null;
  let streaming = false;

  function place(): void {
    const side = bubbleSide({
      charTopY: el.getBoundingClientRect().top,
      bubbleH: el.offsetHeight || 80,
    });
    el.classList.remove('bubble-above', 'bubble-below');
    el.classList.add(side === 'above' ? 'bubble-above' : 'bubble-below');
  }
  function show(): void {
    el.classList.remove('bubble-hidden');
    place();
  }
  function scheduleHide(): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    const ms = durationMs(pref);
    if (ms === null) return; // 常驻
    hideTimer = window.setTimeout(() => el.classList.add('bubble-hidden'), ms);
  }
  return {
    appendStream(text) {
      if (!streaming) {
        el.textContent = '';
        streaming = true;
        show();
      }
      el.textContent = (el.textContent ?? '') + text;
      if (hideTimer !== null) clearTimeout(hideTimer); // 流式中不消失
    },
    endStream() {
      streaming = false;
      scheduleHide();
    },
    say(text) {
      if (streaming) return; // 会话流优先，不打断
      el.textContent = text;
      show();
      scheduleHide();
    },
    setDuration(p) {
      pref = p;
    },
  };
}
