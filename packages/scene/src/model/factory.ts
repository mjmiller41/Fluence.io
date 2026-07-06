import { type Mat2D, identity, translation } from '../geom/matrix';
import type { SubPath } from '../geom/path';
import type { Vec2 } from '../geom/vec';
import { nextId } from './ids';
import type {
  EllipseShape,
  GroupShape,
  LayerId,
  PathShape,
  PolylineShape,
  RectShape,
  RegularPolygonShape,
  Shape,
} from './shape';

export interface ShapeInit {
  layerId: LayerId;
  /** Document-space placement of the shape's local origin. */
  at?: Vec2;
  transform?: Mat2D;
  name?: string;
}

function baseTransform(init: ShapeInit): Mat2D {
  if (init.transform) return init.transform;
  return init.at ? translation(init.at.x, init.at.y) : identity();
}

/** Rectangle with exact width/height (numeric entry); optional corner radii. */
export function createRect(
  width: number,
  height: number,
  init: ShapeInit,
  radii?: { rx?: number; ry?: number },
): RectShape {
  return {
    kind: 'rect',
    id: nextId('rect'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    width,
    height,
    rx: radii?.rx ?? 0,
    ry: radii?.ry ?? 0,
  };
}

export function createEllipse(rx: number, ry: number, init: ShapeInit): EllipseShape {
  return {
    kind: 'ellipse',
    id: nextId('ell'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    rx,
    ry,
  };
}

export function createPolygon(sides: number, radius: number, init: ShapeInit): RegularPolygonShape {
  return {
    kind: 'polygon',
    id: nextId('poly'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    sides: Math.max(3, Math.floor(sides)),
    radius,
  };
}

export function createPolyline(points: Vec2[], closed: boolean, init: ShapeInit): PolylineShape {
  return {
    kind: 'polyline',
    id: nextId('line'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    points: points.map((p) => ({ ...p })),
    closed,
  };
}

export function createPath(subpaths: SubPath[], init: ShapeInit): PathShape {
  return {
    kind: 'path',
    id: nextId('path'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    subpaths,
  };
}

/** Group existing shapes (kept where they are; group transform is identity). */
export function createGroup(children: Shape[], init: ShapeInit): GroupShape {
  return {
    kind: 'group',
    id: nextId('grp'),
    layerId: init.layerId,
    name: init.name,
    transform: baseTransform(init),
    children,
  };
}
