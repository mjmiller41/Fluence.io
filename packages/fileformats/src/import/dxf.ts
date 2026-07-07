/**
 * DXF (ASCII) import → scene {@link Document}. Parses the group-code stream and
 * converts the common entity types used by laser/CAD workflows: LINE,
 * LWPOLYLINE (incl. bulge arcs), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE. DXF is
 * y-up in drawing units, so no axis flip is needed; `$INSUNITS` sets the mm
 * scale. SPLINE and other entity types are skipped (reported via `skipped`).
 */
import {
  createDocument,
  createLayer,
  createPath,
  type Document,
  type Segment,
  type SubPath,
  type Vec2,
} from 'scene';

interface Pair {
  code: number;
  value: string;
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

/** mm per drawing unit from the $INSUNITS header code (default: assume mm). */
function unitScale(pairs: Pair[]): number {
  const idx = pairs.findIndex((p) => p.code === 9 && p.value.trim() === '$INSUNITS');
  if (idx < 0) return 1;
  const val = pairs[idx + 1];
  switch (val && parseInt(val.value.trim(), 10)) {
    case 1:
      return 25.4; // inches
    case 2:
      return 304.8; // feet
    case 4:
      return 1; // mm
    case 5:
      return 10; // cm
    case 6:
      return 1000; // metres
    default:
      return 1;
  }
}

/** Circular arc from angle `a0` sweeping `sweep` radians (signed) as ≤90° cubics. */
function arcCubicsSweep(cx: number, cy: number, r: number, a0: number, sweep: number): Segment[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const delta = sweep / n;
  const t = (4 / 3) * Math.tan(delta / 4); // signed: negative delta flips handles
  const out: Segment[] = [];
  let a = a0;
  for (let i = 0; i < n; i++) {
    const p1 = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    const p2 = { x: cx + r * Math.cos(a + delta), y: cy + r * Math.sin(a + delta) };
    const c1 = { x: p1.x - t * r * Math.sin(a), y: p1.y + t * r * Math.cos(a) };
    const c2 = { x: p2.x + t * r * Math.sin(a + delta), y: p2.y - t * r * Math.cos(a + delta) };
    out.push({ type: 'cubic', c1, c2, to: p2 });
    a += delta;
  }
  return out;
}

/** Positive CCW sweep from a0 to a1 (DXF arc convention). */
function ccwSweep(a0: number, a1: number): number {
  let s = a1 - a0;
  while (s <= 0) s += 2 * Math.PI;
  return s;
}

/**
 * Polyline segment with a DXF bulge (b = tan(θ/4), signed: + = CCW) → cubic arc.
 * Centre sits on the chord's perpendicular bisector at h = (d/2)·cot(θ/2).
 */
function bulgeCubics(p1: Vec2, p2: Vec2, b: number): Segment[] {
  if (b === 0) return [{ type: 'line', to: { ...p2 } }];
  const theta = 4 * Math.atan(b);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy);
  const r = d / (2 * Math.abs(Math.sin(theta / 2)));
  const h = (d / 2) * (Math.cos(theta / 2) / Math.sin(theta / 2));
  const cx = (p1.x + p2.x) / 2 - (dy / d) * h;
  const cy = (p1.y + p2.y) / 2 + (dx / d) * h;
  const a0 = Math.atan2(p1.y - cy, p1.x - cx);
  return arcCubicsSweep(cx, cy, r, a0, theta);
}

interface Entity {
  type: string;
  pairs: Pair[];
}

/** Split the ENTITIES section into individual entities (each starts at code 0). */
function entities(pairs: Pair[]): Entity[] {
  let inEntities = false;
  const out: Entity[] = [];
  let cur: Entity | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      const v = value.trim();
      if (v === 'SECTION') {
        inEntities = pairs[i + 1]?.code === 2 && pairs[i + 1].value.trim() === 'ENTITIES';
        cur = null;
        continue;
      }
      if (v === 'ENDSEC') {
        inEntities = false;
        cur = null;
        continue;
      }
      if (inEntities) {
        cur = { type: v, pairs: [] };
        out.push(cur);
      }
      continue;
    }
    if (cur) cur.pairs.push({ code, value });
  }
  return out;
}

const first = (e: Entity, code: number): number | undefined => {
  const p = e.pairs.find((q) => q.code === code);
  return p ? parseFloat(p.value) : undefined;
};

function polylineSub(verts: { x: number; y: number; bulge: number }[], closed: boolean): SubPath | null {
  if (verts.length < 2) return null;
  const segments: Segment[] = [];
  for (let i = 0; i < verts.length - 1; i++) {
    for (const s of bulgeCubics(verts[i], verts[i + 1], verts[i].bulge)) segments.push(s);
  }
  if (closed) {
    for (const s of bulgeCubics(verts[verts.length - 1], verts[0], verts[verts.length - 1].bulge)) segments.push(s);
  }
  return { start: { x: verts[0].x, y: verts[0].y }, segments, closed };
}

function entitySub(e: Entity): SubPath | null {
  switch (e.type) {
    case 'LINE':
      return {
        start: { x: first(e, 10) ?? 0, y: first(e, 20) ?? 0 },
        segments: [{ type: 'line', to: { x: first(e, 11) ?? 0, y: first(e, 21) ?? 0 } }],
        closed: false,
      };
    case 'CIRCLE': {
      const cx = first(e, 10) ?? 0;
      const cy = first(e, 20) ?? 0;
      const r = first(e, 40) ?? 0;
      if (r <= 0) return null;
      return { start: { x: cx + r, y: cy }, segments: arcCubicsSweep(cx, cy, r, 0, 2 * Math.PI), closed: true };
    }
    case 'ARC': {
      const cx = first(e, 10) ?? 0;
      const cy = first(e, 20) ?? 0;
      const r = first(e, 40) ?? 0;
      const a0 = ((first(e, 50) ?? 0) * Math.PI) / 180;
      const a1 = ((first(e, 51) ?? 0) * Math.PI) / 180;
      if (r <= 0) return null;
      return {
        start: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
        segments: arcCubicsSweep(cx, cy, r, a0, ccwSweep(a0, a1)),
        closed: false,
      };
    }
    case 'ELLIPSE': {
      const cx = first(e, 10) ?? 0;
      const cy = first(e, 20) ?? 0;
      const mx = first(e, 11) ?? 0;
      const my = first(e, 21) ?? 0;
      const ratio = first(e, 40) ?? 1;
      const t0 = first(e, 41) ?? 0;
      const t1 = first(e, 42) ?? 2 * Math.PI;
      const majR = Math.hypot(mx, my);
      const rot = Math.atan2(my, mx);
      const minR = majR * ratio;
      const pt = (t: number): Vec2 => {
        const ex = majR * Math.cos(t);
        const ey = minR * Math.sin(t);
        return { x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) };
      };
      // Sample the ellipse arc into a fine polyline (good enough; CAM flattens).
      const closed = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
      const n = 64;
      const start = pt(t0);
      const segments: Segment[] = [];
      for (let i = 1; i <= n; i++) segments.push({ type: 'line', to: pt(t0 + ((t1 - t0) * i) / n) });
      return { start, segments, closed };
    }
    case 'LWPOLYLINE': {
      const closed = ((first(e, 70) ?? 0) & 1) === 1;
      const verts: { x: number; y: number; bulge: number }[] = [];
      let vx: number | null = null;
      let bulge = 0;
      for (const p of e.pairs) {
        if (p.code === 10) {
          if (vx !== null) verts.push({ x: vx, y: 0, bulge }); // guard (shouldn't happen)
          vx = parseFloat(p.value);
          bulge = 0;
        } else if (p.code === 20 && vx !== null) {
          verts.push({ x: vx, y: parseFloat(p.value), bulge });
          vx = null;
        } else if (p.code === 42) {
          bulge = parseFloat(p.value);
          if (verts.length) verts[verts.length - 1].bulge = bulge;
        }
      }
      return polylineSub(verts, closed);
    }
    default:
      return null;
  }
}

export interface DxfImport {
  document: Document;
  /** Entity types encountered but not converted (e.g. SPLINE, TEXT). */
  skipped: string[];
}

export function importDxf(text: string): DxfImport {
  const pairs = tokenize(text);
  const scale = unitScale(pairs);
  const ents = entities(pairs);
  const skipped = new Set<string>();

  // POLYLINE/VERTEX/SEQEND spans need stitching across entities.
  const subpaths: SubPath[] = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === 'POLYLINE') {
      const closed = ((first(e, 70) ?? 0) & 1) === 1;
      const verts: { x: number; y: number; bulge: number }[] = [];
      let j = i + 1;
      for (; j < ents.length && ents[j].type === 'VERTEX'; j++) {
        verts.push({ x: first(ents[j], 10) ?? 0, y: first(ents[j], 20) ?? 0, bulge: first(ents[j], 42) ?? 0 });
      }
      if (ents[j] && ents[j].type === 'SEQEND') j++;
      const sp = polylineSub(verts, closed);
      if (sp) subpaths.push(sp);
      i = j - 1;
      continue;
    }
    const sp = entitySub(e);
    if (sp) subpaths.push(sp);
    else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') skipped.add(e.type);
  }

  const scaled = scale === 1 ? subpaths : subpaths.map((sp) => scaleSub(sp, scale));
  const doc = createDocument({ units: 'mm' });
  const layer = doc.layers[0] ?? createLayer('Layer 1', 0);
  doc.layers = [layer];
  doc.shapes = scaled.map((sp) => createPath([sp], { layerId: layer.id }));
  return { document: doc, skipped: [...skipped] };
}

const scaleV = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

function scaleSub(sp: SubPath, s: number): SubPath {
  return {
    start: scaleV(sp.start, s),
    segments: sp.segments.map((seg): Segment =>
      seg.type === 'line'
        ? { type: 'line', to: scaleV(seg.to, s) }
        : { type: 'cubic', c1: scaleV(seg.c1, s), c2: scaleV(seg.c2, s), to: scaleV(seg.to, s) },
    ),
    closed: sp.closed,
  };
}
