import { describe, expect, it } from 'vitest';
import { flattenSubPath } from 'scene';
import { parsePathData } from './svg-path';

const last = <T>(a: T[]): T => a[a.length - 1];

describe('parsePathData', () => {
  it('parses absolute M/L/Z into a closed triangle', () => {
    const sp = parsePathData('M0 0 L10 0 L5 8 Z');
    expect(sp).toHaveLength(1);
    expect(sp[0].start).toEqual({ x: 0, y: 0 });
    expect(sp[0].closed).toBe(true);
    expect(sp[0].segments.map((s) => s.to)).toEqual([
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
  });

  it('treats relative commands and implicit lineto after M', () => {
    // m starts a subpath, then implicit relative linetos.
    const sp = parsePathData('m 1 1 2 0 0 2');
    expect(sp[0].start).toEqual({ x: 1, y: 1 });
    expect(sp[0].segments.map((s) => s.to)).toEqual([
      { x: 3, y: 1 },
      { x: 3, y: 3 },
    ]);
  });

  it('handles H and V', () => {
    const sp = parsePathData('M0 0 H10 V5 h-4');
    expect(sp[0].segments.map((s) => s.to)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 6, y: 5 },
    ]);
  });

  it('parses cubic C and smooth S (reflected control point)', () => {
    const sp = parsePathData('M0 0 C0 5 5 5 5 0 S10 -5 10 0');
    expect(sp[0].segments).toHaveLength(2);
    const s0 = sp[0].segments[0];
    const s1 = sp[0].segments[1];
    expect(s0.type).toBe('cubic');
    expect(s1.type).toBe('cubic');
    // S reflects previous c2 (5,5) about the current point (5,0) → (5,-5).
    if (s1.type === 'cubic') expect(s1.c1).toEqual({ x: 5, y: -5 });
  });

  it('elevates quadratic Q to cubic with correct endpoints', () => {
    const sp = parsePathData('M0 0 Q5 10 10 0');
    const seg = sp[0].segments[0];
    expect(seg.type).toBe('cubic');
    expect(seg.to).toEqual({ x: 10, y: 0 });
    if (seg.type === 'cubic') {
      // 2/3 rule: c1 = P0 + 2/3(Q-P0) = (10/3, 20/3).
      expect(seg.c1.x).toBeCloseTo(10 / 3, 9);
      expect(seg.c1.y).toBeCloseTo(20 / 3, 9);
    }
  });

  it('converts an arc A to cubics with correct endpoints and bulge', () => {
    const sp = parsePathData('M0 0 A5 5 0 0 1 10 0');
    expect(sp[0].start).toEqual({ x: 0, y: 0 });
    expect(last(sp[0].segments).to.x).toBeCloseTo(10, 6);
    expect(last(sp[0].segments).to.y).toBeCloseTo(0, 6);
    // Half-circle of radius 5: some flattened point reaches |y| ≈ 5.
    const ys = flattenSubPath(sp[0], 0.01).map((p) => Math.abs(p.y));
    expect(Math.max(...ys)).toBeCloseTo(5, 1);
  });

  it('splits multiple subpaths on repeated M', () => {
    const sp = parsePathData('M0 0 L1 0 M5 5 L6 5');
    expect(sp).toHaveLength(2);
    expect(sp[1].start).toEqual({ x: 5, y: 5 });
  });
});
