import { z } from 'zod';

/**
 * Persona State — 角色随互动演化的情感/关系 KV（tech-design §8 Persona 层）。
 * 始终全量注入 system prompt。MVP 字段最小集；约定/关系图谱等富 KV 留 V1+。
 */
export const PersonaStateBlobSchema = z.object({
  affinity: z.number().min(0).max(100),
  turns: z.number().int().nonnegative(),
  lastMood: z.string().optional(),
  lastEnergy: z.string().optional(),
  lastInteraction: z.number().int().nonnegative().optional(),
});
export type PersonaStateBlob = z.infer<typeof PersonaStateBlobSchema>;

export const DEFAULT_PERSONA_STATE: PersonaStateBlob = { affinity: 50, turns: 0 };

export interface TurnSignal {
  mood?: string;
  energy?: string;
  ts: number;
}

/**
 * 每轮 assistant 收尾后演进 persona（纯函数；不可变返回新对象）。
 * 条件展开 optional 键，避免 exactOptionalPropertyTypes 下的显式 undefined。
 */
export function updatePersonaState(prev: PersonaStateBlob, turn: TurnSignal): PersonaStateBlob {
  const lastMood = turn.mood ?? prev.lastMood;
  const lastEnergy = turn.energy ?? prev.lastEnergy;
  return {
    affinity: Math.min(100, prev.affinity + 1),
    turns: prev.turns + 1,
    lastInteraction: turn.ts,
    ...(lastMood !== undefined ? { lastMood } : {}),
    ...(lastEnergy !== undefined ? { lastEnergy } : {}),
  };
}

/** D7 存储占用统计（app.storageUsage 的 result 形状）。 */
export interface StorageUsage {
  dbBytes: number;
  messageCount: number;
  characterCount: number;
}

/** .dsbak 导出包内 manifest.json 的元信息（不含任何密钥）。 */
export interface ExportManifest {
  schemaVersion: number;
  exportedAt: number;
  characterIds: string[];
  messageCount: number;
}
