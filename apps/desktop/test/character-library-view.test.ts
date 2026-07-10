import { describe, expect, it } from 'vitest';
import type { CharacterManifest } from '@openpet/protocol';
import { toCardVm, sortCards } from '../src/renderer/settings/character-library-view.js';

const m = (over: Partial<CharacterManifest> = {}): CharacterManifest =>
  ({
    id: 'miko',
    name: '巫女',
    version: '1.0.0',
    engine: 'vrm',
    model: 'model.vrm',
    ...over,
  }) as CharacterManifest;

describe('character-library-view（E1）', () => {
  it('toCardVm：preview → asset URL；无 preview → null；persona/cues 计入', () => {
    const vm = toCardVm({
      characterId: 'miko',
      manifest: m({
        preview: 'img/card.png',
        persona: { systemPrompt: 'x', beginDialogs: [] },
        cues: [{ on: 'tap.head' }],
      }),
      builtin: false,
      active: true,
    });
    expect(vm).toMatchObject({
      id: 'miko',
      name: '巫女',
      engine: 'vrm',
      builtin: false,
      active: true,
      previewUrl: 'asset://miko/img/card.png',
      hasPersona: true,
      cueCount: 1,
    });
    expect(
      toCardVm({ characterId: 'a', manifest: m({ id: 'a' }), builtin: true, active: false })
        .previewUrl,
    ).toBeNull();
  });
  it('sortCards：当前优先 → 内置优先 → 名称', () => {
    const cards = [
      { id: 'b', name: 'B', active: false, builtin: false },
      { id: 'c', name: 'C', active: true, builtin: false },
      { id: 'a', name: 'A', active: false, builtin: true },
    ];
    expect(sortCards(cards as never[]).map((c) => (c as { id: string }).id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
