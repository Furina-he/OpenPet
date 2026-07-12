import { describe, it, expect } from 'vitest';
import {
  CUBISM_CORE_CANDIDATES,
  cubismCoreMissingMessage,
} from '../../src/renderer/character/cubism-core-chain.js';

describe('Cubism Core 三级加载链契约', () => {
  it('候选顺序：public 相对路径优先，asset://cubism 兜底（与 Main reservedHosts 键一致）', () => {
    expect(CUBISM_CORE_CANDIDATES).toEqual([
      '../live2dcubismcore.min.js',
      'asset://cubism/live2dcubismcore.min.js',
    ]);
  });

  it('缺失文案指向 userData 的 cubism 子目录（打包用户）与 public（dev）', () => {
    const msg = cubismCoreMissingMessage();
    expect(msg).toContain('cubism');
    expect(msg).toContain('数据目录');
    expect(msg).toContain('public');
  });
});
