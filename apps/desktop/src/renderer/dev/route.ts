// apps/desktop/src/renderer/dev/route.ts
/** 从 location.search 取 ?page= 作初始路由（截特定 Hub 页用；prod 无该参数则回退默认）。 */
export function initialRoute(search: string, fallback: string): string {
  return new URLSearchParams(search).get('page') ?? fallback;
}
