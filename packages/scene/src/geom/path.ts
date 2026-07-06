import { type Mat2D, apply } from './matrix';
import { boundsOfPoints, unionRect, type Rect } from './rect';
import type { Vec2 } from './vec';

/**
 * A path segment. Fluence keeps geometry as lines + cubic beziers (quadratics are
 * elevated to cubics on import). Each segment's `to` is its end point; the start
 * comes from the previous segment (or the subpath `start`).
 */
export type Segment =
  | { type: 'line'; to: Vec2 }
  | { type: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 };

export interface SubPath {
  start: Vec2;
  segments: Segment[];
  closed: boolean;
}

/** A shape's geometry: one or more subpaths (outer + holes, or disjoint runs). */
export type Path = SubPath[];

export const subpathFromPoints = (points: readonly Vec2[], closed: boolean): SubPath => {
  if (points.length === 0) {
    return { start: { x: 0, y: 0 }, segments: [], closed };
  }
  const [first, ...rest] = points;
  return {
    start: { ...first },
    segments: rest.map((p): Segment => ({ type: 'line', to: { ...p } })),
    closed,
  };
};

/** Sample a cubic bezier at parameter t in [0, 1]. */
export function cubicAt(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
  };
}

function flattenCubic(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p1: Vec2,
  tolerance: number,
  out: Vec2[],
  depth = 0,
): void {
  // Adaptive subdivision: recurse until the control points are within tolerance
  // of the chord (flat enough), then emit the endpoint.
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const d1 = Math.abs((c1.x - p1.x) * dy - (c1.y - p1.y) * dx);
  const d2 = Math.abs((c2.x - p1.x) * dy - (c2.y - p1.y) * dx);
  if (depth >= 18 || (d1 + d2) * (d1 + d2) <= tolerance * tolerance * (dx * dx + dy * dy)) {
    out.push({ ...p1 });
    return;
  }
  const p01 = mid(p0, c1);
  const p12 = mid(c1, c2);
  const p23 = mid(c2, p1);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth + 1);
  flattenCubic(p0123, p123, p23, p1, tolerance, out, depth + 1);
}

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Flatten a subpath to a polyline within `tolerance` (mm). */
export function flattenSubPath(sp: SubPath, tolerance = 0.05): Vec2[] {
  const out: Vec2[] = [{ ...sp.start }];
  let prev = sp.start;
  for (const seg of sp.segments) {
    if (seg.type === 'line') {
      out.push({ ...seg.to });
    } else {
      flattenCubic(prev, seg.c1, seg.c2, seg.to, tolerance, out);
    }
    prev = seg.to;
  }
  if (sp.closed && (out.length < 2 || !pointsEqual(out[0], out[out.length - 1]))) {
    out.push({ ...sp.start });
  }
  return out;
}

const pointsEqual = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** Flatten a whole path into one polyline per subpath. */
export function flattenPath(path: Path, tolerance = 0.05): Vec2[][] {
  return path.map((sp) => flattenSubPath(sp, tolerance));
}

export function transformSubPath(sp: SubPath, m: Mat2D): SubPath {
  return {
    start: apply(m, sp.start),
    segments: sp.segments.map((seg): Segment =>
      seg.type === 'line'
        ? { type: 'line', to: apply(m, seg.to) }
        : { type: 'cubic', c1: apply(m, seg.c1), c2: apply(m, seg.c2), to: apply(m, seg.to) },
    ),
    closed: sp.closed,
  };
}

export const transformPath = (path: Path, m: Mat2D): Path =>
  path.map((sp) => transformSubPath(sp, m));

/** Tight-ish bounds of a path (via flattening, so curves are respected). */
export function pathBounds(path: Path, tolerance = 0.05): Rect | null {
  let bounds: Rect | null = null;
  for (const sp of path) {
    bounds = unionRect(bounds, boundsOfPoints(flattenSubPath(sp, tolerance)));
  }
  return bounds;
}

/** Total flattened length of a path (mm). */
export function pathLength(path: Path, tolerance = 0.05): number {
  let total = 0;
  for (const poly of flattenPath(path, tolerance)) {
    for (let i = 1; i < poly.length; i++) {
      total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    }
  }
  return total;
}
