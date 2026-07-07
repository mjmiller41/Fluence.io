/**
 * SVG path-data (`d` attribute) parser → scene {@link SubPath}[]. Pure and
 * coordinate-agnostic (parses in SVG user units, y-down; the caller applies the
 * viewBox flip + unit scale). Supports the full command set — M/L/H/V/C/S/Q/T/A/Z
 * in both absolute and relative forms — elevating quadratics to cubics and
 * converting elliptical arcs to cubic beziers.
 */
import type { Segment, SubPath, Vec2 } from 'scene';

type Cmd = { code: string; args: number[] };

/** Tokenise a `d` string into commands with their flat argument lists. */
function tokenize(d: string): Cmd[] {
  const cmds: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
  let cur: Cmd | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) {
      cur = { code: m[1], args: [] };
      cmds.push(cur);
    } else if (cur) {
      cur.args.push(parseFloat(m[2]));
    }
  }
  return cmds;
}

const line = (to: Vec2): Segment => ({ type: 'line', to });
const cubic = (c1: Vec2, c2: Vec2, to: Vec2): Segment => ({ type: 'cubic', c1, c2, to });

/**
 * Convert an SVG endpoint-parameterised arc (rx ry φ largeArc sweep → end) into
 * a sequence of cubic segments. Follows the SVG implementation notes (F.6).
 */
function arcToCubics(
  from: Vec2,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  to: Vec2,
): Segment[] {
  if (rx === 0 || ry === 0) return [line(to)];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  // Step 1: transform to the ellipse's local frame.
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  // Correct out-of-range radii.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  // Step 2: centre.
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (from.x + to.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (from.y + to.y) / 2;
  // Step 3: angles.
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;
  // Split into ≤90° cubic segments.
  const segCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segCount;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: Segment[] = [];
  let th = theta1;
  for (let i = 0; i < segCount; i++) {
    const cos1 = Math.cos(th);
    const sin1 = Math.sin(th);
    const cos2 = Math.cos(th + delta);
    const sin2 = Math.sin(th + delta);
    const p1 = {
      x: cx + rx * cos1 * cosP - ry * sin1 * sinP,
      y: cy + rx * cos1 * sinP + ry * sin1 * cosP,
    };
    const p2 = {
      x: cx + rx * cos2 * cosP - ry * sin2 * sinP,
      y: cy + rx * cos2 * sinP + ry * sin2 * cosP,
    };
    const c1 = {
      x: p1.x + t * (-rx * sin1 * cosP - ry * cos1 * sinP),
      y: p1.y + t * (-rx * sin1 * sinP + ry * cos1 * cosP),
    };
    const c2 = {
      x: p2.x - t * (-rx * sin2 * cosP - ry * cos2 * sinP),
      y: p2.y - t * (-rx * sin2 * sinP + ry * cos2 * cosP),
    };
    out.push(cubic(c1, c2, p2));
    th += delta;
  }
  return out;
}

/** Parse an SVG `d` string into subpaths (SVG coordinates, y-down). */
export function parsePathData(d: string): SubPath[] {
  const cmds = tokenize(d);
  const subpaths: SubPath[] = [];
  let sub: SubPath | null = null;
  let cur: Vec2 = { x: 0, y: 0 };
  let startPt: Vec2 = { x: 0, y: 0 };
  // Reflection points for S/T (previous cubic c2 / quadratic control).
  let prevCubicC2: Vec2 | null = null;
  let prevQuadC: Vec2 | null = null;

  const flush = (): void => {
    if (sub && sub.segments.length > 0) subpaths.push(sub);
    sub = null;
  };

  for (const { code, args } of cmds) {
    const rel = code === code.toLowerCase();
    const abs = (x: number, y: number): Vec2 =>
      rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
    const up = code.toUpperCase();

    if (up === 'Z') {
      if (sub) {
        sub.closed = true;
        subpaths.push(sub);
        cur = { ...startPt };
        sub = null;
      }
      prevCubicC2 = prevQuadC = null;
      continue;
    }
    if (up === 'M') {
      flush();
      let i = 0;
      cur = abs(args[i], args[i + 1]);
      startPt = { ...cur };
      sub = { start: { ...cur }, segments: [], closed: false };
      i += 2;
      // Subsequent pairs after an M are implicit L (lineto).
      for (; i + 1 < args.length; i += 2) {
        const p = rel ? { x: cur.x + args[i], y: cur.y + args[i + 1] } : { x: args[i], y: args[i + 1] };
        sub.segments.push(line(p));
        cur = p;
      }
      prevCubicC2 = prevQuadC = null;
      continue;
    }
    if (!sub) {
      sub = { start: { ...cur }, segments: [], closed: false };
      startPt = { ...cur };
    }

    switch (up) {
      case 'L':
        for (let i = 0; i + 1 < args.length; i += 2) {
          const p = abs(args[i], args[i + 1]);
          sub.segments.push(line(p));
          cur = p;
        }
        prevCubicC2 = prevQuadC = null;
        break;
      case 'H':
        for (const x of args) {
          const p = { x: rel ? cur.x + x : x, y: cur.y };
          sub.segments.push(line(p));
          cur = p;
        }
        prevCubicC2 = prevQuadC = null;
        break;
      case 'V':
        for (const y of args) {
          const p = { x: cur.x, y: rel ? cur.y + y : y };
          sub.segments.push(line(p));
          cur = p;
        }
        prevCubicC2 = prevQuadC = null;
        break;
      case 'C':
        for (let i = 0; i + 5 < args.length; i += 6) {
          const c1 = abs(args[i], args[i + 1]);
          const c2 = abs(args[i + 2], args[i + 3]);
          const p = abs(args[i + 4], args[i + 5]);
          sub.segments.push(cubic(c1, c2, p));
          prevCubicC2 = c2;
          cur = p;
        }
        prevQuadC = null;
        break;
      case 'S':
        for (let i = 0; i + 3 < args.length; i += 4) {
          const c1 = prevCubicC2 ? { x: 2 * cur.x - prevCubicC2.x, y: 2 * cur.y - prevCubicC2.y } : { ...cur };
          const c2 = abs(args[i], args[i + 1]);
          const p = abs(args[i + 2], args[i + 3]);
          sub.segments.push(cubic(c1, c2, p));
          prevCubicC2 = c2;
          cur = p;
        }
        prevQuadC = null;
        break;
      case 'Q':
        for (let i = 0; i + 3 < args.length; i += 4) {
          const qc = abs(args[i], args[i + 1]);
          const p = abs(args[i + 2], args[i + 3]);
          sub.segments.push(quadToCubic(cur, qc, p));
          prevQuadC = qc;
          cur = p;
        }
        prevCubicC2 = null;
        break;
      case 'T':
        for (let i = 0; i + 1 < args.length; i += 2) {
          const qc: Vec2 = prevQuadC ? { x: 2 * cur.x - prevQuadC.x, y: 2 * cur.y - prevQuadC.y } : { ...cur };
          const p = abs(args[i], args[i + 1]);
          sub.segments.push(quadToCubic(cur, qc, p));
          prevQuadC = qc;
          cur = p;
        }
        prevCubicC2 = null;
        break;
      case 'A':
        for (let i = 0; i + 6 < args.length; i += 7) {
          const p = rel ? { x: cur.x + args[i + 5], y: cur.y + args[i + 6] } : { x: args[i + 5], y: args[i + 6] };
          for (const seg of arcToCubics(cur, args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], p)) {
            sub.segments.push(seg);
          }
          cur = p;
        }
        prevCubicC2 = prevQuadC = null;
        break;
    }
  }
  flush();
  return subpaths;
}

function quadToCubic(from: Vec2, qc: Vec2, to: Vec2): Segment {
  return cubic(
    { x: from.x + (2 / 3) * (qc.x - from.x), y: from.y + (2 / 3) * (qc.y - from.y) },
    { x: to.x + (2 / 3) * (qc.x - to.x), y: to.y + (2 / 3) * (qc.y - to.y) },
    to,
  );
}
