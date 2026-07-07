import { type Mat2D, identity, multiply } from '../geom/matrix';
import type { Path } from '../geom/path';
import { type Rect, unionRect } from '../geom/rect';
import { nextId } from './ids';
import { type LayerId, type Shape, type ShapeId, localPath, shapeBounds } from './shape';
import { transformPath } from '../geom/path';

export type Units = 'mm' | 'inch';

/** A cut layer. `color` is the layer-coding colour (generic palette, not copied data). */
export interface Layer {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface Document {
  units: Units;
  /** Bed size in millimetres. */
  width: number;
  height: number;
  layers: Layer[];
  /** Top-level shapes; array order is z-order (later = on top). */
  shapes: Shape[];
}

const LAYER_PALETTE = [
  '#111111',
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#f97316',
  '#9333ea',
  '#0891b2',
  '#ca8a04',
];

export function createLayer(name?: string, index = 0): Layer {
  return {
    id: nextId('ly'),
    name: name ?? `Layer ${index + 1}`,
    color: LAYER_PALETTE[index % LAYER_PALETTE.length],
    visible: true,
    locked: false,
  };
}

export function createDocument(
  opts: Partial<Pick<Document, 'units' | 'width' | 'height'>> = {},
): Document {
  return {
    units: opts.units ?? 'mm',
    width: opts.width ?? 400,
    height: opts.height ?? 400,
    layers: [createLayer('Layer 1', 0)],
    shapes: [],
  };
}

export function getLayer(doc: Document, id: LayerId): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

export function addLayer(doc: Document, layer?: Layer): Layer {
  const created = layer ?? createLayer(undefined, doc.layers.length);
  doc.layers.push(created);
  return created;
}

/** Remove a layer; its shapes are reassigned to the first remaining layer. */
export function removeLayer(doc: Document, id: LayerId): void {
  if (doc.layers.length <= 1) return;
  doc.layers = doc.layers.filter((l) => l.id !== id);
  const fallback = doc.layers[0].id;
  const reassign = (shapes: Shape[]): void => {
    for (const s of shapes) {
      if (s.layerId === id) s.layerId = fallback;
      if (s.kind === 'group') reassign(s.children);
    }
  };
  reassign(doc.shapes);
}

export function addShape(doc: Document, shape: Shape): Shape {
  doc.shapes.push(shape);
  return shape;
}

export function insertShape(doc: Document, shape: Shape, index: number): void {
  doc.shapes.splice(Math.max(0, Math.min(index, doc.shapes.length)), 0, shape);
}

interface RemovedShape {
  shape: Shape;
  siblings: Shape[];
  index: number;
}

function removeFrom(list: Shape[], id: ShapeId): RemovedShape | null {
  const index = list.findIndex((s) => s.id === id);
  if (index >= 0) {
    const [shape] = list.splice(index, 1);
    return { shape, siblings: list, index };
  }
  for (const s of list) {
    if (s.kind === 'group') {
      const found = removeFrom(s.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Remove a shape by id (searches into groups); returns undo context or null. */
export function removeShape(doc: Document, id: ShapeId): RemovedShape | null {
  return removeFrom(doc.shapes, id);
}

export function findShape(doc: Document, id: ShapeId): Shape | undefined {
  const search = (list: Shape[]): Shape | undefined => {
    for (const s of list) {
      if (s.id === id) return s;
      if (s.kind === 'group') {
        const inner = search(s.children);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  return search(doc.shapes);
}

/** Replace a shape (matched by id) in place, preserving z-order. */
export function replaceShape(doc: Document, shape: Shape): boolean {
  const replaceIn = (list: Shape[]): boolean => {
    const index = list.findIndex((s) => s.id === shape.id);
    if (index >= 0) {
      list[index] = shape;
      return true;
    }
    for (const s of list) {
      if (s.kind === 'group' && replaceIn(s.children)) return true;
    }
    return false;
  };
  return replaceIn(doc.shapes);
}

/** Visit every non-group leaf shape with its accumulated world transform. */
export function forEachLeaf(
  doc: Document,
  cb: (shape: Exclude<Shape, { kind: 'group' }>, world: Mat2D) => void,
): void {
  const walk = (shapes: Shape[], parent: Mat2D): void => {
    for (const s of shapes) {
      const world = multiply(parent, s.transform);
      if (s.kind === 'group') {
        walk(s.children, world);
      } else {
        cb(s, world);
      }
    }
  };
  walk(doc.shapes, identity());
}

/**
 * Document-space geometry of every leaf, tagged with its layer. Raster images
 * are skipped: they carry no vector toolpath (their `localPath` is only a
 * placeholder outline for display); raster engraving lands in M6.
 */
export function leafGeometries(doc: Document): Array<{ layerId: LayerId; path: Path }> {
  const out: Array<{ layerId: LayerId; path: Path }> = [];
  forEachLeaf(doc, (shape, world) => {
    if (shape.kind === 'image') return;
    out.push({ layerId: shape.layerId, path: transformPath(localPath(shape), world) });
  });
  return out;
}

export function documentBounds(doc: Document): Rect | null {
  let bounds: Rect | null = null;
  for (const s of doc.shapes) bounds = unionRect(bounds, shapeBounds(s));
  return bounds;
}
