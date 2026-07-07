import { describe, expect, it } from 'vitest';
import { flattenSubPath, localPath, pathBounds, shapeGeometry } from 'scene';
import { importDxf } from './dxf';

/** Build a DXF group-code string from (code, value) pairs. */
function dxf(pairs: Array<[number, string | number]>): string {
  return pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
}

const ENTITIES_OPEN: Array<[number, string | number]> = [
  [0, 'SECTION'],
  [2, 'ENTITIES'],
];
const ENTITIES_CLOSE: Array<[number, string | number]> = [
  [0, 'ENDSEC'],
  [0, 'EOF'],
];

function withUnits(units: number, ents: Array<[number, string | number]>): string {
  return dxf([
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$INSUNITS'],
    [70, units],
    [0, 'ENDSEC'],
    ...ENTITIES_OPEN,
    ...ents,
    ...ENTITIES_CLOSE,
  ]);
}

describe('importDxf', () => {
  it('imports LINE, CIRCLE, ARC and a closed LWPOLYLINE; skips SPLINE', () => {
    const text = withUnits(4, [
      [0, 'LINE'],
      [10, 0],
      [20, 0],
      [11, 10],
      [21, 0],
      [0, 'CIRCLE'],
      [10, 0],
      [20, 0],
      [40, 5],
      [0, 'ARC'],
      [10, 0],
      [20, 0],
      [40, 5],
      [50, 0],
      [51, 90],
      [0, 'LWPOLYLINE'],
      [90, 4],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 10],
      [20, 0],
      [10, 10],
      [20, 10],
      [10, 0],
      [20, 10],
      [0, 'SPLINE'],
    ]);
    const { document, skipped } = importDxf(text);
    expect(document.shapes).toHaveLength(4); // line, circle, arc, lwpolyline
    expect(skipped).toContain('SPLINE');

    // CIRCLE r=5 centred at origin → bounds [-5,5]².
    const circle = document.shapes[1];
    const b = pathBounds(shapeGeometry(circle))!;
    expect(b.x).toBeCloseTo(-5, 3);
    expect(b.width).toBeCloseTo(10, 3);

    // ARC 0°→90°: starts at (5,0), ends at (0,5).
    const arc = document.shapes[2];
    const sp = localPath(arc)[0];
    expect(sp.start.x).toBeCloseTo(5, 6);
    const end = sp.segments[sp.segments.length - 1].to;
    expect(end.x).toBeCloseTo(0, 4);
    expect(end.y).toBeCloseTo(5, 4);

    // LWPOLYLINE closed square.
    const poly = document.shapes[3];
    expect(localPath(poly)[0].closed).toBe(true);
    const pb = pathBounds(shapeGeometry(poly))!;
    expect(pb.width).toBeCloseTo(10, 6);
    expect(pb.height).toBeCloseTo(10, 6);
  });

  it('applies a bulge as a circular arc', () => {
    const text = withUnits(4, [
      [0, 'LWPOLYLINE'],
      [90, 2],
      [70, 0],
      [10, 0],
      [20, 0],
      [42, 1], // bulge=1 → 180° arc on the segment leaving this vertex
      [10, 10],
      [20, 0],
    ]);
    const { document } = importDxf(text);
    const sp = localPath(document.shapes[0])[0];
    const ys = flattenSubPath(sp, 0.01).map((p) => Math.abs(p.y));
    // Semicircle of radius 5 → apex |y| ≈ 5.
    expect(Math.max(...ys)).toBeCloseTo(5, 1);
  });

  it('scales inch drawings to millimetres via $INSUNITS', () => {
    const ents: Array<[number, string | number]> = [
      [0, 'LINE'],
      [10, 0],
      [20, 0],
      [11, 1],
      [21, 0],
    ];
    const mm = importDxf(withUnits(4, ents));
    const inch = importDxf(withUnits(1, ents));
    const mmEnd = localPath(mm.document.shapes[0])[0].segments[0].to;
    const inchEnd = localPath(inch.document.shapes[0])[0].segments[0].to;
    expect(mmEnd.x).toBeCloseTo(1, 6);
    expect(inchEnd.x).toBeCloseTo(25.4, 6);
  });
});
