/**
 * ㉒ 请求代数守卫（spec §4.1 / §4.6；照 LivingMemory 的教训）：快速连点节点 / 连发「试一句」时，
 * 慢到的旧响应丢弃，不覆盖当前结果。
 */
export function createLatestRequest() {
  let current = 0;
  return {
    /** 发一个新号（之前的号全部作废）。 */
    next(): number {
      return ++current;
    },
    isCurrent(n: number): boolean {
      return n === current;
    },
    /** 作废所有在途请求（如关闭面板）。 */
    invalidate(): void {
      current++;
    },
  };
}
