import { describe, it } from 'vitest';
import { assertGolden } from 'golden';
import { difference, intersection, offset, union, weld, xor } from './clipper';
import { serializePolygons } from './serialize';
import type { Polygons } from './types';

// Two 10x10 squares overlapping in a 5x5 region.
const A: Polygons = [
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
];
const B: Polygons = [
  [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ],
];

const golden = (name: string): URL => new URL(`./__golden__/${name}.txt`, import.meta.url);

describe('boolean / offset / weld golden geometry', () => {
  it('union', async () => assertGolden(golden('union'), serializePolygons(await union(A, B))));
  it('difference', async () =>
    assertGolden(golden('difference'), serializePolygons(await difference(A, B))));
  it('intersection', async () =>
    assertGolden(golden('intersection'), serializePolygons(await intersection(A, B))));
  it('xor', async () => assertGolden(golden('xor'), serializePolygons(await xor(A, B))));

  it('offset outward (closed)', async () =>
    assertGolden(golden('offset-out'), serializePolygons(await offset(A, 2))));
  it('offset inward (closed)', async () =>
    assertGolden(golden('offset-in'), serializePolygons(await offset(A, -2))));

  it('offset an open path (kerf around a polyline)', async () => {
    const openLine: Polygons = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ];
    assertGolden(
      golden('offset-open'),
      serializePolygons(await offset(openLine, 1, { end: 'round' })),
    );
  });

  it('weld joins N overlapping outlines into one boundary', async () => {
    const C: Polygons = [
      [
        [8, 0],
        [18, 0],
        [18, 10],
        [8, 10],
      ],
    ];
    assertGolden(golden('weld'), serializePolygons(await weld([A, C])));
  });
});
