import { describe, it, expect } from 'vitest';
import { ToastQueue } from '../src/renderer/components/toast-queue';

describe('ToastQueue', () => {
  it('keeps at most 3 float toasts, dropping the oldest', () => {
    const q = new ToastQueue();
    q.push({ kind: 'float', text: 'a' });
    q.push({ kind: 'float', text: 'b' });
    q.push({ kind: 'float', text: 'c' });
    q.push({ kind: 'float', text: 'd' });
    expect(q.items.filter((t) => t.kind === 'float').map((t) => t.text)).toEqual(['b', 'c', 'd']);
  });

  it('keeps only the latest top-bar toast', () => {
    const q = new ToastQueue();
    q.push({ kind: 'bar', text: '✓ 已保存' });
    q.push({ kind: 'bar', text: '✓ 已保存' });
    expect(q.items.filter((t) => t.kind === 'bar')).toHaveLength(1);
  });

  it('dismiss removes by id', () => {
    const q = new ToastQueue();
    const id = q.push({ kind: 'float', text: 'x' });
    q.dismiss(id);
    expect(q.items).toHaveLength(0);
  });
});
