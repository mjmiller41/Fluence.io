import { aroundPivot, multiply, rotation, scaling, translation } from '../geom/matrix';
import type { Vec2 } from '../geom/vec';
import type { Shape } from './shape';

// Pure transform operations: each returns a new shape with an updated transform,
// so the command stack can restore the previous transform for undo.

export function translatedShape(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, transform: multiply(translation(dx, dy), shape.transform) };
}

export function scaledShape(shape: Shape, sx: number, sy: number, pivot: Vec2): Shape {
  return { ...shape, transform: multiply(aroundPivot(scaling(sx, sy), pivot), shape.transform) };
}

export function rotatedShape(shape: Shape, radians: number, pivot: Vec2): Shape {
  return { ...shape, transform: multiply(aroundPivot(rotation(radians), pivot), shape.transform) };
}
