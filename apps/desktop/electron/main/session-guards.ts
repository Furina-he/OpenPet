/** 会话管理守卫与指针回退（纯函数；spec §2.3）。 */

/** IM 会话（im:*）生命周期归 im-service：管理操作拒绝。 */
export function assertNotImSession(id: string): void {
  if (id.startsWith('im:')) throw new Error('IM 会话为只读，不能改名/置顶/删除');
}

/** 删除会话后的指针回退：非当前会话返回 null（不改）；当前会话回退最近桌面会话，无则 'default'。 */
export function nextActiveAfterDelete(
  deletedId: string,
  current: string,
  remainingDesktopIds: string[],
): string | null {
  if (current !== deletedId) return null;
  return remainingDesktopIds[0] ?? 'default';
}

export interface ActiveSessionDeps {
  getMap: () => Record<string, string>;
  setMap: (map: Record<string, string>) => void;
  broadcast: (channel: string, params: unknown) => void;
}

/**
 * 写当前会话指针并广播 prefs.changed。必须走这里——PrefsStore.set 只落盘不广播
 *（广播是 prefs-service 'app.prefs.set' handler 的职责），直调会导致 Hub/浮层
 * 收不到变更、界面不重建（2026-07-10 真窗 bug：新建会话无反应）。
 */
export function writeActiveSession(
  deps: ActiveSessionDeps,
  characterId: string,
  sessionId: string,
): void {
  const map = { ...deps.getMap(), [characterId]: sessionId };
  deps.setMap(map);
  deps.broadcast('app.prefs.changed', { key: 'chat.activeSessions', value: map });
}
