/// <reference path="./clipper2-wasm.d.ts" />
import Clipper2ZFactory from 'clipper2-wasm';
import type { FillRule, MainModule, PathsD } from 'clipper2-wasm';
import type { FillRuleName, Point, Polygons } from './types';

/**
 * Thin, memory-safe wrapper over the prebuilt Clipper2 WASM module. Uses the
 * double-precision ("D") API so coordinates are plain JS numbers. Every embind
 * handle allocated here is `delete()`d — Clipper2's objects are not GC'd.
 *
 * These functions are pure (geometry in, geometry out) and run wherever they are
 * imported; the app always calls them from the worker (see worker.ts + client.ts)
 * so heavy boolean/offset work never touches the main thread.
 */

let modulePromise: Promise<MainModule> | null = null;

/** Initialise (once) and cache the Clipper2 WASM module. */
export async function initClipper(): Promise<MainModule> {
  if (!modulePromise) {
    modulePromise = Clipper2ZFactory() as Promise<MainModule>;
  }
  return modulePromise;
}

const PRECISION = 2; // decimal places retained by the D (double) API

function fillRuleOf(mod: MainModule, name: FillRuleName): FillRule {
  switch (name) {
    case 'evenodd':
      return mod.FillRule.EvenOdd;
    case 'positive':
      return mod.FillRule.Positive;
    case 'negative':
      return mod.FillRule.Negative;
    case 'nonzero':
    default:
      return mod.FillRule.NonZero;
  }
}

function toPathsD(mod: MainModule, polys: Polygons): PathsD {
  const paths = new mod.PathsD();
  for (const ring of polys) {
    const flat: number[] = [];
    for (const [x, y] of ring) flat.push(x, y);
    const pathD = mod.MakePathD(flat);
    paths.push_back(pathD);
    pathD.delete();
  }
  return paths;
}

function fromPathsD(paths: PathsD): Polygons {
  const result: Point[][] = [];
  const count = paths.size();
  for (let i = 0; i < count; i++) {
    const path = paths.get(i);
    // clipper2z is the Z-variant: view() is [x0, y0, z0, x1, y1, z1, ...] (stride 3).
    const view = path.view();
    const ring: Point[] = [];
    for (let j = 0; j + 2 < view.length; j += 3) {
      ring.push([view[j], view[j + 1]]);
    }
    result.push(ring);
    path.delete();
  }
  return result;
}

async function run(
  op: (mod: MainModule, subjects: PathsD, clips: PathsD, fr: FillRule) => PathsD,
  subject: Polygons,
  clip: Polygons,
  fillRule: FillRuleName,
): Promise<Polygons> {
  const mod = await initClipper();
  const subjects = toPathsD(mod, subject);
  const clips = toPathsD(mod, clip);
  let solution: PathsD | null = null;
  try {
    solution = op(mod, subjects, clips, fillRuleOf(mod, fillRule));
    return fromPathsD(solution);
  } finally {
    subjects.delete();
    clips.delete();
    solution?.delete();
  }
}

export function union(
  a: Polygons,
  b: Polygons,
  fillRule: FillRuleName = 'nonzero',
): Promise<Polygons> {
  return run((m, s, c, fr) => m.UnionD(s, c, fr, PRECISION), a, b, fillRule);
}

export function difference(
  a: Polygons,
  b: Polygons,
  fillRule: FillRuleName = 'nonzero',
): Promise<Polygons> {
  return run((m, s, c, fr) => m.DifferenceD(s, c, fr, PRECISION), a, b, fillRule);
}

export function intersection(
  a: Polygons,
  b: Polygons,
  fillRule: FillRuleName = 'nonzero',
): Promise<Polygons> {
  return run((m, s, c, fr) => m.IntersectD(s, c, fr, PRECISION), a, b, fillRule);
}

export function xor(
  a: Polygons,
  b: Polygons,
  fillRule: FillRuleName = 'nonzero',
): Promise<Polygons> {
  return run((m, s, c, fr) => m.XorD(s, c, fr, PRECISION), a, b, fillRule);
}

/** Weld N closed outlines into their merged boundary (self-union of all rings). */
export function weld(groups: Polygons[], fillRule: FillRuleName = 'nonzero'): Promise<Polygons> {
  return union(groups.flat(), [], fillRule);
}

export type JoinTypeName = 'round' | 'square' | 'miter';
export type EndTypeName = 'polygon' | 'joined' | 'butt' | 'square' | 'round';

export interface OffsetOptions {
  /** Corner style. Default 'round'. */
  join?: JoinTypeName;
  /** End style. 'polygon' = closed regions (default); others offset open paths. */
  end?: EndTypeName;
  /** Miter limit for 'miter' joins. Default 2. */
  miterLimit?: number;
}

/**
 * Polygon offset / kerf compensation (positive = outward, negative = inward).
 * With `end: 'polygon'` the input is a closed region; other end types offset an
 * open path (kerf around a polyline).
 */
export async function offset(
  polys: Polygons,
  delta: number,
  opts: OffsetOptions = {},
): Promise<Polygons> {
  const mod = await initClipper();
  const joinMap = {
    round: mod.JoinType.Round,
    square: mod.JoinType.Square,
    miter: mod.JoinType.Miter,
  };
  const endMap = {
    polygon: mod.EndType.Polygon,
    joined: mod.EndType.Joined,
    butt: mod.EndType.Butt,
    square: mod.EndType.Square,
    round: mod.EndType.Round,
  };
  const paths = toPathsD(mod, polys);
  let solution: PathsD | null = null;
  try {
    solution = mod.InflatePathsD(
      paths,
      delta,
      joinMap[opts.join ?? 'round'],
      endMap[opts.end ?? 'polygon'],
      opts.miterLimit ?? 2,
      PRECISION,
      0, // arc tolerance (0 = auto)
    );
    return fromPathsD(solution);
  } finally {
    paths.delete();
    solution?.delete();
  }
}
