/** ⑳ 引擎标签（VRM / Live2D / 帧动画）：已知引擎走 i18n，未知引擎回退原始串大写（前向兼容）。 */
export const ENGINE_LABEL_KEYS: Readonly<Record<string, string>> = {
  vrm: 'settings.characters.engines.vrm',
  live2d: 'settings.characters.engines.live2d',
  sprite: 'settings.characters.engines.sprite',
};

export function engineLabel(engine: string, t: (key: string) => string): string {
  const key = ENGINE_LABEL_KEYS[engine];
  return key ? t(key) : engine.toUpperCase();
}
