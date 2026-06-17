/** Toast 队列纯逻辑（ui-design §2.6.3）：顶栏薄条保留最新 1 条；浮卡最多 3 条挤旧。 */
export interface Toast {
  id: number;
  kind: 'bar' | 'float';
  text: string;
}

export class ToastQueue {
  items: Toast[] = [];
  private nextId = 1;

  push(t: { kind: 'bar' | 'float'; text: string }): number {
    const id = this.nextId++;
    if (t.kind === 'bar') {
      this.items = this.items.filter((x) => x.kind !== 'bar');
    }
    this.items.push({ id, ...t });
    const floats = this.items.filter((x) => x.kind === 'float');
    if (floats.length > 3) {
      const dropId = floats[0]!.id;
      this.items = this.items.filter((x) => x.id !== dropId);
    }
    return id;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((x) => x.id !== id);
  }
}
