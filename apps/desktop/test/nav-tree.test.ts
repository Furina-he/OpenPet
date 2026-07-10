import { describe, it, expect } from 'vitest';
import { NAV_TREE, flattenRoutes, isActive } from '../src/renderer/settings/nav-tree';

describe('Hub nav-tree', () => {
  it('exposes the §3.3 top groups', () => {
    expect(NAV_TREE.map((g) => g.id)).toContain('system');
    expect(NAV_TREE.map((g) => g.id)).toContain('model');
  });

  it('flattenRoutes yields every leaf route id', () => {
    expect(flattenRoutes()).toContain('system.display');
  });

  it('isActive matches the current route', () => {
    expect(isActive('system.display', 'system.display')).toBe(true);
    expect(isActive('system.display', 'system.privacy')).toBe(false);
  });
});
