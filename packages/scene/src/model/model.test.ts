import { beforeEach, describe, expect, it } from 'vitest';
import { vec } from '../geom/vec';
import { rotatedShape, scaledShape, translatedShape } from './transform';
import { isClosed, shapeBounds } from './shape';
import { createEllipse, createGroup, createPolygon, createRect } from './factory';
import {
  addShape,
  createDocument,
  findShape,
  leafGeometries,
  removeLayer,
  removeShape,
  replaceShape,
} from './document';
import { align, distribute } from './align';
import { snapPoint } from './snapping';
import { resetIds } from './ids';

const LY = 'ly_test';
const init = { layerId: LY };

beforeEach(() => resetIds());

describe('shape geometry', () => {
  it('produces exact bounds for primitives', () => {
    expect(shapeBounds(createRect(20, 10, init))).toEqual({ x: 0, y: 0, width: 20, height: 10 });

    const ell = shapeBounds(createEllipse(10, 5, init))!;
    expect(ell.x).toBeCloseTo(-10, 6);
    expect(ell.y).toBeCloseTo(-5, 6);
    expect(ell.width).toBeCloseTo(20, 6);
    expect(ell.height).toBeCloseTo(10, 6);

    const poly = shapeBounds(createPolygon(4, 10, init))!; // vertices at +/-10 on each axis
    expect(poly.width).toBeCloseTo(20, 6);
    expect(poly.height).toBeCloseTo(20, 6);
  });

  it('rounded rect stays within its box', () => {
    const b = shapeBounds(createRect(20, 10, init, { rx: 3, ry: 3 }))!;
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.width).toBeCloseTo(20, 6);
    expect(b.height).toBeCloseTo(10, 6);
  });

  it('classifies closed vs open shapes', () => {
    expect(isClosed(createRect(1, 1, init))).toBe(true);
    expect(isClosed(createEllipse(1, 1, init))).toBe(true);
  });
});

describe('transforms', () => {
  it('translate/scale/rotate move bounds correctly', () => {
    const r = createRect(20, 10, init);
    expect(shapeBounds(translatedShape(r, 5, 5))).toEqual({ x: 5, y: 5, width: 20, height: 10 });
    expect(shapeBounds(scaledShape(r, 2, 2, vec(0, 0)))).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 20,
    });
    const rotated = shapeBounds(rotatedShape(r, Math.PI / 2, vec(10, 5)))!;
    expect(rotated.x).toBeCloseTo(5, 6);
    expect(rotated.y).toBeCloseTo(-5, 6);
    expect(rotated.width).toBeCloseTo(10, 6);
    expect(rotated.height).toBeCloseTo(20, 6);
  });
});

describe('document', () => {
  it('adds, finds, replaces, and removes shapes (incl. inside groups)', () => {
    const doc = createDocument();
    const layer = doc.layers[0].id;
    const a = addShape(doc, createRect(10, 10, { layerId: layer }));
    const b = createRect(10, 10, { layerId: layer, at: vec(20, 0) });
    const group = createGroup([b], { layerId: layer });
    addShape(doc, group);

    expect(findShape(doc, a.id)?.id).toBe(a.id);
    expect(findShape(doc, b.id)?.id).toBe(b.id); // found inside the group

    const moved = translatedShape(a, 3, 3);
    expect(replaceShape(doc, moved)).toBe(true);
    expect(shapeBounds(findShape(doc, a.id)!)).toEqual({ x: 3, y: 3, width: 10, height: 10 });

    const removed = removeShape(doc, b.id);
    expect(removed?.shape.id).toBe(b.id);
    expect(findShape(doc, b.id)).toBeUndefined();
  });

  it('removeLayer reassigns orphaned shapes', () => {
    const doc = createDocument();
    const l2 = { id: 'ly_2', name: 'L2', color: '#f00', visible: true, locked: false };
    doc.layers.push(l2);
    const s = addShape(doc, createRect(5, 5, { layerId: 'ly_2' }));
    removeLayer(doc, 'ly_2');
    expect(doc.layers).toHaveLength(1);
    expect(findShape(doc, s.id)?.layerId).toBe(doc.layers[0].id);
  });

  it('flattens groups to leaf geometries with world transforms', () => {
    const doc = createDocument();
    const layer = doc.layers[0].id;
    const child = createRect(10, 10, { layerId: layer, at: vec(5, 5) });
    addShape(doc, createGroup([child], { layerId: layer }));
    const leaves = leafGeometries(doc);
    expect(leaves).toHaveLength(1);
  });
});

describe('align & distribute', () => {
  const build = () => {
    const a = createRect(10, 10, init);
    const b = createRect(10, 10, { layerId: LY, at: vec(20, 5) });
    return { a, b };
  };

  it('aligns left and bottom edges to the selection box', () => {
    const { a, b } = build();
    const left = align([a, b], 'left');
    expect(shapeBounds(left[0])!.x).toBeCloseTo(0, 6);
    expect(shapeBounds(left[1])!.x).toBeCloseTo(0, 6);

    const bottom = align([a, b], 'bottom');
    expect(shapeBounds(bottom[0])!.y).toBeCloseTo(0, 6);
    expect(shapeBounds(bottom[1])!.y).toBeCloseTo(0, 6);
  });

  it('distributes centres evenly', () => {
    const a = createRect(10, 10, init); // center x 5
    const b = createRect(10, 10, { layerId: LY, at: vec(15, 0) }); // center x 20
    const c = createRect(10, 10, { layerId: LY, at: vec(100, 0) }); // center x 105
    const out = distribute([a, b, c], 'horizontal');
    const centerX = (s: (typeof out)[number]) => {
      const bb = shapeBounds(s)!;
      return bb.x + bb.width / 2;
    };
    // evenly spaced centers: 5, 55, 105
    expect(centerX(out[1])).toBeCloseTo(55, 6);
  });
});

describe('snapping', () => {
  it('snaps to grid within threshold', () => {
    expect(snapPoint(vec(2.3, 7.8), { gridSize: 1, threshold: 0.5 }).point).toEqual({ x: 2, y: 8 });
    // outside threshold -> unchanged
    expect(snapPoint(vec(2.5, 7.5), { gridSize: 1, threshold: 0.2 }).point).toEqual({
      x: 2.5,
      y: 7.5,
    });
  });

  it('snaps to candidate points', () => {
    const res = snapPoint(vec(10.4, 9.7), { threshold: 1, points: [vec(10, 10)] });
    expect(res.point).toEqual({ x: 10, y: 10 });
    expect(res.snappedX && res.snappedY).toBe(true);
  });
});
