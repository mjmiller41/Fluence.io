import type { Polygons } from './types';

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r; // normalise -0
}

/**
 * Deterministic textual serialization of polygon geometry — one ring per line,
 * "x,y" points space-separated. Used for golden geometry comparisons; Clipper2
 * output is deterministic, so these fixtures are stable.
 */
export function serializePolygons(polys: Polygons, decimals = 3): string {
  return (
    polys
      .map((ring) => ring.map(([x, y]) => `${round(x, decimals)},${round(y, decimals)}`).join(' '))
      .join('\n') + '\n'
  );
}
