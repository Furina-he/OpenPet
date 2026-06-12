/**
 * 性能预算（tech-design §7）：单角色 ≤8 万三角面、纹理总量 ≤64MB。
 * 加载完成后测一次：超标 console.warn（预算是告警线，不拒载——拒载的
 * 用户体验问题留给角色包商店审核，V1+）。
 */
import * as THREE from 'three';

export const BUDGET_LIMITS = {
  maxTriangles: 80_000,
  maxTextureBytes: 64 * 1024 * 1024,
} as const;

export interface SceneBudget {
  triangles: number;
  textureBytes: number;
}

export function measureSceneBudget(root: THREE.Object3D): SceneBudget {
  let triangles = 0;
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (geo.index) triangles += geo.index.count / 3;
    else if (geo.attributes['position']) triangles += geo.attributes['position'].count / 3;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const value of Object.values(mat)) {
        if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
      }
    }
  });

  let textureBytes = 0;
  for (const tex of textures) {
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) textureBytes += img.width * img.height * 4; // RGBA8 估算
  }
  return { triangles, textureBytes };
}

/** 超标项的人类可读告警列表；空数组 = 预算内。 */
export function checkBudget(b: SceneBudget): string[] {
  const warnings: string[] = [];
  if (b.triangles > BUDGET_LIMITS.maxTriangles) {
    warnings.push(`triangles ${b.triangles} > budget ${BUDGET_LIMITS.maxTriangles}`);
  }
  if (b.textureBytes > BUDGET_LIMITS.maxTextureBytes) {
    warnings.push(
      `texture bytes ${b.textureBytes} > budget ${BUDGET_LIMITS.maxTextureBytes} (est. RGBA8)`,
    );
  }
  return warnings;
}
