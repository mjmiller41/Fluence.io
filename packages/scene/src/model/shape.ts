import { type Mat2D, identity, multiply } from '../geom/matrix';
import {
  type Path,
  type Segment,
  type SubPath,
  pathBounds,
  subpathFromPoints,
  transformPath,
} from '../geom/path';
import type { Rect } from '../geom/rect';
import { add, scale, sub, type Vec2 } from '../geom/vec';
import { nextId } from './ids';

export type ShapeId = string;
export type LayerId = string;

/** Fields common to every shape. `transform` maps local geometry into its parent. */
export interface CommonShape {
  id: ShapeId;
  layerId: LayerId;
  name?: string;
  transform: Mat2D;
  hidden?: boolean;
  locked?: boolean;
}

/** Rectangle with local origin at its bottom-left corner; rx/ry are corner radii. */
export interface RectShape extends CommonShape {
  kind: 'rect';
  width: number;
  height: number;
  rx: number;
  ry: number;
}

/** Ellipse centred on its local origin. */
export interface EllipseShape extends CommonShape {
  kind: 'ellipse';
  rx: number;
  ry: number;
}

/** Regular N-gon centred on its local origin, first vertex pointing +Y. */
export interface RegularPolygonShape extends CommonShape {
  kind: 'polygon';
  sides: number;
  radius: number;
}

/** Open or closed polyline through explicit local points. */
export interface PolylineShape extends CommonShape {
  kind: 'polyline';
  points: Vec2[];
  closed: boolean;
}

/** Freeform bezier path (from node editing or import). */
export interface PathShape extends CommonShape {
  kind: 'path';
  subpaths: SubPath[];
}

/** A group of child shapes; the group transform composes onto each child. */
export interface GroupShape extends CommonShape {
  kind: 'group';
  children: Shape[];
}

/**
 * A placed raster image. Local origin is the bottom-left corner; `width`/`height`
 * are its physical size in mm (derived from the source pixels and DPI on import).
 * `src` is a data URL; `pxWidth`/`pxHeight` are the intrinsic pixel dimensions.
 * Pixels are rendered/engraved in M6; until then it draws as its bounds box.
 */
export interface ImageShape extends CommonShape {
  kind: 'image';
  width: number;
  height: number;
  src: string;
  pxWidth: number;
  pxHeight: number;
}

export type Shape =
  | RectShape
  | EllipseShape
  | RegularPolygonShape
  | PolylineShape
  | PathShape
  | ImageShape
  | GroupShape;

const ID_PREFIX: Record<Shape['kind'], string> = {
  rect: 'rect',
  ellipse: 'ell',
  polygon: 'poly',
  polyline: 'line',
  path: 'path',
  image: 'img',
  group: 'grp',
};

/**
 * Deep-clone shapes with fresh ids (recursing into groups), so an inserted copy
 * — duplicated selection, pasted art, a library item — never shares an id with
 * the source or collides in the target document.
 */
export function reassignIds(shapes: Shape[]): Shape[] {
  return shapes.map((s) => reidInPlace(structuredClone(s)));
}

function reidInPlace(shape: Shape): Shape {
  shape.id = nextId(ID_PREFIX[shape.kind]);
  if (shape.kind === 'group') shape.children = shape.children.map(reidInPlace);
  return shape;
}

const KAPPA = 0.5522847498307936;

/** Cubic segment approximating a quarter arc from `from` to `to` around `corner`. */
function cornerSeg(from: Vec2, to: Vec2, corner: Vec2): Segment {
  const rA = sub(from, corner);
  const rB = sub(to, corner);
  return {
    type: 'cubic',
    c1: add(from, scale(rB, KAPPA)),
    c2: add(to, scale(rA, KAPPA)),
    to,
  };
}

function roundedRect(w: number, h: number, rxIn: number, ryIn: number): SubPath {
  const rx = Math.min(Math.max(rxIn, 0), w / 2);
  const ry = Math.min(Math.max(ryIn, 0), h / 2);
  if (rx === 0 || ry === 0) {
    return subpathFromPoints(
      [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      true,
    );
  }
  return {
    start: { x: rx, y: 0 },
    segments: [
      { type: 'line', to: { x: w - rx, y: 0 } },
      cornerSeg({ x: w - rx, y: 0 }, { x: w, y: ry }, { x: w - rx, y: ry }),
      { type: 'line', to: { x: w, y: h - ry } },
      cornerSeg({ x: w, y: h - ry }, { x: w - rx, y: h }, { x: w - rx, y: h - ry }),
      { type: 'line', to: { x: rx, y: h } },
      cornerSeg({ x: rx, y: h }, { x: 0, y: h - ry }, { x: rx, y: h - ry }),
      { type: 'line', to: { x: 0, y: ry } },
      cornerSeg({ x: 0, y: ry }, { x: rx, y: 0 }, { x: rx, y: ry }),
    ],
    closed: true,
  };
}

function ellipsePath(rx: number, ry: number): SubPath {
  const c = { x: 0, y: 0 };
  const right = { x: rx, y: 0 };
  const top = { x: 0, y: ry };
  const left = { x: -rx, y: 0 };
  const bottom = { x: 0, y: -ry };
  return {
    start: right,
    segments: [
      cornerSeg(right, top, c),
      cornerSeg(top, left, c),
      cornerSeg(left, bottom, c),
      cornerSeg(bottom, right, c),
    ],
    closed: true,
  };
}

function regularPolygon(sides: number, radius: number): SubPath {
  const n = Math.max(3, Math.floor(sides));
  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / n;
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return subpathFromPoints(points, true);
}

/** Untransformed geometry of a shape (empty for groups). */
export function localPath(shape: Shape): Path {
  switch (shape.kind) {
    case 'rect':
      return [roundedRect(shape.width, shape.height, shape.rx, shape.ry)];
    case 'ellipse':
      return [ellipsePath(shape.rx, shape.ry)];
    case 'polygon':
      return [regularPolygon(shape.sides, shape.radius)];
    case 'polyline':
      return [subpathFromPoints(shape.points, shape.closed)];
    case 'path':
      return shape.subpaths;
    case 'image':
      // Placeholder outline (bottom-left origin) until raster rendering lands (M6).
      return [
        subpathFromPoints(
          [
            { x: 0, y: 0 },
            { x: shape.width, y: 0 },
            { x: shape.width, y: shape.height },
            { x: 0, y: shape.height },
          ],
          true,
        ),
      ];
    case 'group':
      return [];
  }
}

/** Document-space geometry of a shape, flattening groups and applying transforms. */
export function shapeGeometry(shape: Shape, parent: Mat2D = identity()): Path {
  const world = multiply(parent, shape.transform);
  if (shape.kind === 'group') {
    return shape.children.flatMap((child) => shapeGeometry(child, world));
  }
  return transformPath(localPath(shape), world);
}

/** Document-space bounds of a shape (curve-aware). */
export function shapeBounds(shape: Shape, parent: Mat2D = identity()): Rect | null {
  return pathBounds(shapeGeometry(shape, parent));
}

/** True when a shape (and, for groups, all descendants) encloses area. */
export function isClosed(shape: Shape): boolean {
  switch (shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
      return true;
    case 'polyline':
      return shape.closed;
    case 'path':
      return shape.subpaths.every((sp) => sp.closed);
    case 'image':
      return true;
    case 'group':
      return shape.children.every(isClosed);
  }
}
