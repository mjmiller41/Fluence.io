import { describe, expect, it } from 'vitest';
import { createRect, shapeGeometry } from 'scene';
import { assertGolden } from 'golden';
import { groupedFillToolpaths, serializeToolpaths } from './toolpath';

const rectAt = (x: number) => shapeGeometry(createRect(10, 10, { layerId: 'l', at: { x, y: 0 } }));
const A = rectAt(0);
const B = rectAt(20); // 10mm gap from A -> disjoint bounds
const overlapping = rectAt(5); // overlaps A

const lines = (s: string): string[] => s.trim().split('\n').sort();

describe('fill grouping', () => {
  it('all-at-once and individually cover the same lines in a different order', () => {
    const individually = groupedFillToolpaths([A, B], 2, 0, 'individually');
    const allAtOnce = groupedFillToolpaths([A, B], 2, 0, 'all-at-once');

    expect(individually).toHaveLength(allAtOnce.length);
    // Same set of cut segments...
    expect(lines(serializeToolpaths(individually))).toEqual(lines(serializeToolpaths(allAtOnce)));
    // ...but a different emission order (grouped by shape vs swept by row).
    expect(serializeToolpaths(individually)).not.toBe(serializeToolpaths(allAtOnce));
  });

  it('individually fills shape A completely before shape B', () => {
    const tp = groupedFillToolpaths([A, B], 2, 0, 'individually');
    // First half of the paths belong to A (x < 10), second half to B (x >= 20).
    const half = tp.length / 2;
    expect(tp.slice(0, half).every((t) => t.points.every((p) => p.x <= 10))).toBe(true);
    expect(tp.slice(half).every((t) => t.points.every((p) => p.x >= 20))).toBe(true);
  });

  it('groups clusters overlapping shapes together, disjoint shapes apart', () => {
    // Disjoint -> same as individually.
    expect(serializeToolpaths(groupedFillToolpaths([A, B], 2, 0, 'groups'))).toBe(
      serializeToolpaths(groupedFillToolpaths([A, B], 2, 0, 'individually')),
    );
    // Overlapping -> one cluster -> same as all-at-once.
    expect(serializeToolpaths(groupedFillToolpaths([A, overlapping], 2, 0, 'groups'))).toBe(
      serializeToolpaths(groupedFillToolpaths([A, overlapping], 2, 0, 'all-at-once')),
    );
  });

  it('all-at-once sweep matches the committed fixture', () =>
    assertGolden(
      new URL('./__golden__/fill-group-all.txt', import.meta.url),
      serializeToolpaths(groupedFillToolpaths([A, B], 2, 0, 'all-at-once')),
    ));
});
