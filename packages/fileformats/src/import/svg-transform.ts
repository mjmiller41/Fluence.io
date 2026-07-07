/**
 * SVG `transform` attribute parser → scene {@link Mat2D}. Supports matrix,
 * translate, scale, rotate (with optional centre), skewX, skewY, composed
 * left-to-right (leftmost is the outermost transform, per SVG).
 */
import { type Mat2D, matrix } from 'scene';

const { identity, multiply, translation, scaling, rotation, compose } = matrix;

const DEG = Math.PI / 180;

function skewX(a: number): Mat2D {
  return { a: 1, b: 0, c: Math.tan(a * DEG), d: 1, e: 0, f: 0 };
}
function skewY(a: number): Mat2D {
  return { a: 1, b: Math.tan(a * DEG), c: 0, d: 1, e: 0, f: 0 };
}

function one(name: string, n: number[]): Mat2D {
  switch (name) {
    case 'matrix':
      return { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
    case 'translate':
      return translation(n[0] || 0, n[1] || 0);
    case 'scale':
      return scaling(n[0], n.length > 1 ? n[1] : n[0]);
    case 'rotate': {
      const r = rotation((n[0] || 0) * DEG);
      if (n.length >= 3) return compose(translation(n[1], n[2]), r, translation(-n[1], -n[2]));
      return r;
    }
    case 'skewX':
      return skewX(n[0] || 0);
    case 'skewY':
      return skewY(n[0] || 0);
    default:
      return identity();
  }
}

export function parseTransform(input: string | null | undefined): Mat2D {
  if (!input) return identity();
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let result = identity();
  while ((m = re.exec(input)) !== null) {
    const nums = m[2]
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    result = multiply(result, one(m[1], nums));
  }
  return result;
}
