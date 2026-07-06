import { describe, expect, it } from 'vitest';
import { identity } from '../geom/matrix';
import { createRect } from './factory';
import { reassignIds, type Shape } from './shape';

describe('reassignIds', () => {
  it('deep-clones with fresh ids and recurses into groups', () => {
    const rect = createRect(10, 10, { layerId: 'l' });
    const child = createRect(5, 5, { layerId: 'l' });
    const group: Shape = {
      kind: 'group',
      id: 'g_orig',
      layerId: 'l',
      transform: identity(),
      children: [child],
    };

    const [r2, g2] = reassignIds([rect, group]);

    expect(r2.id).not.toBe(rect.id);
    expect(g2.id).not.toBe('g_orig');
    expect(g2.kind).toBe('group');
    if (g2.kind === 'group') {
      expect(g2.children[0].id).not.toBe(child.id);
    }
  });

  it('produces independent deep copies (mutation does not leak to the source)', () => {
    const rect = createRect(10, 10, { layerId: 'l' });
    const [clone] = reassignIds([rect]);
    if (clone.kind === 'rect') clone.width = 999;
    expect(rect.width).toBe(10);
  });
});
