/** A2 桌面气泡 DOM 控制器：流式追加文本、自动消失、定位。无业务（只反映 chat 文本）。 */
import { durationMs, placeBubble } from './bubble-timer';
import type { ContentBox } from './interaction-zones';
import type { Prefs } from '@openpet/protocol';

export interface Bubble {
  appendStream(text: string): void;
  endStream(): void;
  /** F-IT 主动台词（pet.say）：整句显示 + 按 pref 自动消失；不入会话流。 */
  say(text: string): void;
  setDuration(pref: Prefs['display.bubbleDuration']): void;
  /** ㉓ 几何变了（缩放 / 换屏）：可见时按新轮廓重新定位。 */
  relayout(): void;
}

/**
 * ㉓ contour：轮廓（窗口坐标，精灵轮廓 ?? 模型框）；气泡贴在它的顶上方。
 * workArea：所在显示器工作区（layout.screen.workArea）；null = 只按窗口定位。
 */
export function mountBubble(
  el: HTMLElement,
  contour: () => ContentBox,
  workArea: () => { x: number; y: number; width: number; height: number } | null = () => null,
): Bubble {
  let pref: Prefs['display.bubbleDuration'] = '5';
  let hideTimer: number | null = null;
  let streaming = false;

  function place(): void {
    const pos = placeBubble({
      boxTop: contour().top,
      bubbleW: el.offsetWidth || 200,
      bubbleH: el.offsetHeight || 80,
      windowW: window.innerWidth,
      windowH: window.innerHeight,
      windowScreen: { x: window.screenX, y: window.screenY },
      workArea: workArea(),
    });
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
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
      place(); // 贴轮廓：随文本增高上移，不压到头上（100% VRM 轮廓顶 = 0 → 恒 top 12）
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
    relayout() {
      if (!el.classList.contains('bubble-hidden')) place();
    },
  };
}
