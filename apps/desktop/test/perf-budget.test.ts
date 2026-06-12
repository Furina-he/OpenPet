import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  measureSceneBudget,
  checkBudget,
  BUDGET_LIMITS,
} from '../src/renderer/character/perf-budget';

function meshWithTriangles(tris: number, texture?: THREE.Texture): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(tris * 9); // 3 顶点 × xyz，非索引几何
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial();
  if (texture) mat.map = texture;
  return new THREE.Mesh(geo, mat);
}

function fakeTexture(w: number, h: number): THREE.Texture {
  const t = new THREE.Texture();
  t.image = { width: w, height: h };
  return t;
}

describe('measureSceneBudget', () => {
  it('counts triangles across meshes (indexed and non-indexed)', () => {
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(100));
    const indexed = meshWithTriangles(0);
    const geo = indexed.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geo.setIndex(Array.from({ length: 300 }, (_, i) => i % 3)); // 100 个三角面
    scene.add(indexed);
    expect(measureSceneBudget(scene).triangles).toBe(200);
  });

  it('sums unique textures only once (材质间共享纹理不重复计)', () => {
    const tex = fakeTexture(1024, 1024); // 4MB
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(1, tex));
    scene.add(meshWithTriangles(1, tex));
    expect(measureSceneBudget(scene).textureBytes).toBe(1024 * 1024 * 4);
  });

  it('handles texture without image gracefully', () => {
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(1, new THREE.Texture()));
    expect(measureSceneBudget(scene).textureBytes).toBe(0);
  });

  it('finds textures inside ShaderMaterial uniforms (VRM MToon 形态)', () => {
    const tex = fakeTexture(512, 256); // 512KB
    const mesh = meshWithTriangles(1);
    mesh.material = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } } });
    const scene = new THREE.Object3D();
    scene.add(mesh);
    expect(measureSceneBudget(scene).textureBytes).toBe(512 * 256 * 4);
  });
});

describe('checkBudget', () => {
  it('limits match tech-design §7 (8万面 / 64MB)', () => {
    expect(BUDGET_LIMITS.maxTriangles).toBe(80_000);
    expect(BUDGET_LIMITS.maxTextureBytes).toBe(64 * 1024 * 1024);
  });

  it('flags overruns', () => {
    expect(checkBudget({ triangles: 80_001, textureBytes: 0 })).toEqual([
      expect.stringContaining('triangles'),
    ]);
    expect(checkBudget({ triangles: 0, textureBytes: 64 * 1024 * 1024 + 1 })).toEqual([
      expect.stringContaining('texture'),
    ]);
    expect(checkBudget({ triangles: 1000, textureBytes: 1000 })).toEqual([]);
  });
});
