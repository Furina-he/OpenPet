// components/im/platform-meta.ts —— IM 平台展示元数据（照 AstrBot platformUtils：logo / 教程链接）。
// logo 资产拷自 AstrBot dashboard（platform_logos），品牌名不入 i18n。
import type { ImPlatform, ImPlatformType } from '@openpet/protocol';

export interface ImPlatformMeta {
  type: ImPlatformType;
  label: string;
  logo: string;
  endpointOf: (p: ImPlatform) => string;
  /** 照 AstrBot getTutorialLink：对话框「查看教程」外链。 */
  tutorial: string;
}

export const IM_PLATFORM_META: Record<ImPlatformType, ImPlatformMeta> = {
  'onebot-v11': {
    type: 'onebot-v11',
    label: 'QQ · OneBot v11',
    logo: new URL('../../assets/platform-logos/onebot.png', import.meta.url).href,
    endpointOf: (p) => p.wsUrl,
    tutorial: 'https://napneko.github.io/guide/napcat',
  },
  telegram: {
    type: 'telegram',
    label: 'Telegram Bot',
    logo: new URL('../../assets/platform-logos/telegram.svg', import.meta.url).href,
    endpointOf: (p) => p.apiBase,
    tutorial: 'https://core.telegram.org/bots/tutorial',
  },
};
