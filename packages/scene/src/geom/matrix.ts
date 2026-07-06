import type { Vec2 } from './vec';

/**
 * 2D affine transform stored as the six values of the matrix
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 * mapping (x, y) -> (a·x + c·y + e, b·x + d·y + f). Same convention as SVG/Canvas.
 */
export interface Mat2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const identity = (): Mat2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const translation = (tx: number, ty: number): Mat2D => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: tx,
  f: ty,
});

export const scaling = (sx: number, sy: number): Mat2D => ({
  a: sx,
  b: 0,
  c: 0,
  d: sy,
  e: 0,
  f: 0,
});

export function rotation(radians: number): Mat2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Compose transforms: `multiply(m1, m2)` applies m2 first, then m1. */
export function multiply(m1: Mat2D, m2: Mat2D): Mat2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** Compose a chain left-to-right so the last argument is applied first. */
export function compose(...mats: Mat2D[]): Mat2D {
  return mats.reduce((acc, m) => multiply(acc, m), identity());
}

export function apply(m: Mat2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Apply only the linear part (no translation) — for directions/extents. */
export function applyVector(m: Mat2D, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

export function invert(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) throw new Error('Cannot invert a singular matrix');
  const inv = 1 / det;
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

/** Transform about a document-space pivot: T(pivot)·op·T(-pivot). */
export function aroundPivot(op: Mat2D, pivot: Vec2): Mat2D {
  return compose(translation(pivot.x, pivot.y), op, translation(-pivot.x, -pivot.y));
}

export interface DecomposedTransform {
  translation: Vec2;
  /** Rotation in radians. */
  rotation: number;
  scale: Vec2;
}

/** Decompose into translation, rotation, and (possibly negative) scale. */
export function decompose(m: Mat2D): DecomposedTransform {
  const scaleX = Math.hypot(m.a, m.b);
  const rotationRad = Math.atan2(m.b, m.a);
  // Remove rotation to recover the y scale (accounts for shear-free transforms).
  const scaleY = (m.a * m.d - m.b * m.c) / (scaleX || 1);
  return {
    translation: { x: m.e, y: m.f },
    rotation: rotationRad,
    scale: { x: scaleX, y: scaleY },
  };
}
