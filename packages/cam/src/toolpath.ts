import { flattenSubPath, type Path, pathBounds, type Rect, type Vec2 } from 'scene';
import { offset, type Polygons } from 'geometry-wasm';
import type { CutSettings, FillGrouping } from './settings';

/** A single continuous path the head follows while cutting. */
export interface Toolpath {
  points: Vec2[];
  closed: boolean;
}

function rotate(p: Vec2, cos: number, sin: number): Vec2 {
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** Closed subpaths, flattened, with any duplicated closing vertex removed. */
function regionRings(geometry: Path): Vec2[][] {
  const rings: Vec2[][] = [];
  for (const sp of geometry) {
    if (!sp.closed) continue;
    const pts = flattenSubPath(sp);
    const last = pts[pts.length - 1];
    if (pts.length > 1 && last.x === pts[0].x && last.y === pts[0].y) pts.pop();
    if (pts.length >= 3) rings.push(pts);
  }
  return rings;
}

/** Line mode: cut each subpath's outline exactly. */
export function lineToolpaths(geometry: Path): Toolpath[] {
  return geometry.map((sp) => ({ points: flattenSubPath(sp), closed: sp.closed }));
}

/** Fill mode: parallel scan lines clipped to the region (even-odd), at `angle`. */
export function fillToolpaths(geometry: Path, interval: number, angleDeg: number): Toolpath[] {
  const rings = regionRings(geometry);
  if (interval <= 0 || rings.length === 0) return [];

  const a = (angleDeg * Math.PI) / 180;
  const cosN = Math.cos(-a);
  const sinN = Math.sin(-a);
  const cosP = Math.cos(a);
  const sinP = Math.sin(a);

  const rotated = rings.map((r) => r.map((p) => rotate(p, cosN, sinN)));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rotated) {
    for (const p of r) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const out: Toolpath[] = [];
  const startY = Math.ceil(minY / interval) * interval;
  for (let y = startY; y <= maxY; y += interval) {
    const xs: number[] = [];
    for (const r of rotated) {
      for (let i = 0; i < r.length; i++) {
        const p1 = r[i];
        const p2 = r[(i + 1) % r.length];
        const yLow = Math.min(p1.y, p2.y);
        const yHigh = Math.max(p1.y, p2.y);
        if (y >= yLow && y < yHigh) {
          xs.push(p1.x + ((y - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x));
        }
      }
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      out.push({
        points: [rotate({ x: xs[i], y }, cosP, sinP), rotate({ x: xs[i + 1], y }, cosP, sinP)],
        closed: false,
      });
    }
  }
  return out;
}

/** Offset (concentric) fill: repeatedly offset inward by `interval`. */
export async function offsetFillToolpaths(
  geometry: Path,
  interval: number,
  maxRings = 1000,
): Promise<Toolpath[]> {
  let current: Polygons = regionRings(geometry).map((r) => r.map((p): [number, number] => [p.x, p.y]));
  const out: Toolpath[] = [];
  let iterations = 0;
  while (current.length > 0 && iterations < maxRings) {
    for (const ring of current) {
      out.push({ points: ring.map(([x, y]) => ({ x, y })), closed: true });
    }
    current = await offset(current, -interval);
    iterations += 1;
  }
  return out;
}

/** Concatenate several shape geometries into one region set. */
function mergePaths(geometries: Path[]): Path {
  return geometries.flat();
}

function boundsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/** Cluster geometries whose bounding boxes transitively overlap (union-find). */
function clusterByBounds(geometries: Path[]): Path[][] {
  const bounds = geometries.map((g) => pathBounds(g));
  const n = geometries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = bounds[i];
      const bj = bounds[j];
      if (bi && bj && boundsOverlap(bi, bj)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Path[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(geometries[i]);
    groups.set(root, list);
  }
  return [...groups.values()];
}

/**
 * Fill a set of shape geometries under a grouping strategy (M2-T02). The
 * strategy changes the order/scope of scan lines, which is machine-visible:
 * - `individually`: fill each shape completely before the next.
 * - `all-at-once`: one global scan-line sweep across every shape at once.
 * - `groups`: cluster shapes whose bounds overlap; sweep each cluster together.
 */
export function groupedFillToolpaths(
  geometries: Path[],
  interval: number,
  angleDeg: number,
  grouping: FillGrouping,
): Toolpath[] {
  if (grouping === 'individually') {
    return geometries.flatMap((g) => fillToolpaths(g, interval, angleDeg));
  }
  if (grouping === 'all-at-once') {
    return fillToolpaths(mergePaths(geometries), interval, angleDeg);
  }
  return clusterByBounds(geometries).flatMap((c) => fillToolpaths(mergePaths(c), interval, angleDeg));
}

/** Generate toolpaths for a shape's geometry under its cut settings. */
export async function generateToolpaths(geometry: Path, s: CutSettings): Promise<Toolpath[]> {
  switch (s.mode) {
    case 'line':
      return lineToolpaths(geometry);
    case 'fill':
      return fillToolpaths(geometry, s.interval, s.angle);
    case 'offset-fill':
      return offsetFillToolpaths(geometry, s.interval);
    case 'fill+line':
      return [...fillToolpaths(geometry, s.interval, s.angle), ...lineToolpaths(geometry)];
  }
}

const roundc = (n: number, d: number): number => {
  const f = 10 ** d;
  const v = Math.round(n * f) / f;
  return v === 0 ? 0 : v;
};

/** Deterministic serialization for golden toolpath comparisons. */
export function serializeToolpaths(paths: Toolpath[], decimals = 3): string {
  return (
    paths
      .map(
        (tp) =>
          `${tp.closed ? 'C' : 'O'} ${tp.points.map((p) => `${roundc(p.x, decimals)},${roundc(p.y, decimals)}`).join(' ')}`,
      )
      .join('\n') + '\n'
  );
}
