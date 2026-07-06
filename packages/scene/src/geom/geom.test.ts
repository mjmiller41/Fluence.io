import { describe, expect, it } from 'vitest';
import { add, distance, rotate, sub, vec } from './vec';
import {
  apply,
  aroundPivot,
  compose,
  decompose,
  invert,
  multiply,
  rotation,
  scaling,
  translation,
} from './matrix';
import { flattenSubPath, pathBounds, pathLength, subpathFromPoints, transformPath } from './path';

describe('vec', () => {
  it('does basic arithmetic', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec(3, 4), vec(1, 1))).toEqual({ x: 2, y: 3 });
    expect(distance(vec(0, 0), vec(3, 4))).toBe(5);
  });
  it('rotates 90 degrees', () => {
    const r = rotate(vec(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
  });
});

describe('matrix', () => {
  it('compose applies the last matrix first', () => {
    // scale by 2 then translate by (10, 0): point (1,0) -> (2,0) -> (12,0)
    const m = compose(translation(10, 0), scaling(2, 2));
    expect(apply(m, vec(1, 0))).toEqual({ x: 12, y: 0 });
  });

  it('invert round-trips a point', () => {
    const m = compose(translation(5, -3), rotation(0.7), scaling(2, 1.5));
    const p = vec(4, 9);
    const back = apply(invert(m), apply(m, p));
    expect(back.x).toBeCloseTo(4, 9);
    expect(back.y).toBeCloseTo(9, 9);
  });

  it('aroundPivot rotates about a fixed point', () => {
    const m = aroundPivot(rotation(Math.PI / 2), vec(10, 10));
    const fixed = apply(m, vec(10, 10));
    expect(fixed.x).toBeCloseTo(10, 9);
    expect(fixed.y).toBeCloseTo(10, 9);
    const moved = apply(m, vec(11, 10)); // 1mm right of pivot -> 1mm above pivot
    expect(moved.x).toBeCloseTo(10, 9);
    expect(moved.y).toBeCloseTo(11, 9);
  });

  it('decompose recovers translation, rotation, and scale', () => {
    const m = compose(translation(7, 8), rotation(Math.PI / 6), scaling(3, 2));
    const d = decompose(m);
    expect(d.translation).toEqual({ x: 7, y: 8 });
    expect(d.rotation).toBeCloseTo(Math.PI / 6, 9);
    expect(d.scale.x).toBeCloseTo(3, 9);
    expect(d.scale.y).toBeCloseTo(2, 9);
  });

  it('multiply matches sequential apply', () => {
    const m1 = rotation(0.3);
    const m2 = translation(2, 5);
    const p = vec(1, 1);
    const lhs = apply(multiply(m1, m2), p);
    const rhs = apply(m1, apply(m2, p));
    expect(lhs.x).toBeCloseTo(rhs.x, 12);
    expect(lhs.y).toBeCloseTo(rhs.y, 12);
  });
});

describe('path', () => {
  it('flattens a straight subpath to its endpoints', () => {
    const sp = subpathFromPoints(
      [vec(0, 0), vec(10, 0), vec(10, 10)],
      false,
    );
    expect(flattenSubPath(sp)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('flattens a cubic and measures a ~unit quarter arc-ish curve', () => {
    const sp = {
      start: vec(0, 0),
      segments: [{ type: 'cubic' as const, c1: vec(0, 10), c2: vec(10, 10), to: vec(10, 0) }],
      closed: false,
    };
    const poly = flattenSubPath(sp, 0.01);
    expect(poly.length).toBeGreaterThan(4); // curve subdivided
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it('computes bounds and length of a closed square', () => {
    const square = [subpathFromPoints([vec(0, 0), vec(10, 0), vec(10, 10), vec(0, 10)], true)];
    expect(pathBounds(square)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(pathLength(square)).toBeCloseTo(40, 6); // closed perimeter
  });

  it('transforms a path', () => {
    const square = [subpathFromPoints([vec(0, 0), vec(10, 0), vec(10, 10), vec(0, 10)], true)];
    const moved = transformPath(square, translation(5, 5));
    expect(pathBounds(moved)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });
});
