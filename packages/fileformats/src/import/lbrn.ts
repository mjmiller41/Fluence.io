/**
 * LightBurn `.lbrn` / `.lbrn2` import → scene {@link Document}. Parses the XML
 * project: `CutSetting`s become layers (by index), and `Shape`s (Rect, Ellipse,
 * Path, Group, and Text via its baked backup path) map to scene shapes. LightBurn
 * is y-up millimetres like the scene, so the `XForm` affine maps straight across
 * with no axis flip.
 *
 * Built and unit-tested against the documented format and real `.lbrn2` files;
 * validate against your own LightBurn exports before relying on parity. Unmapped
 * shape types are reported via `skipped`.
 *
 * Uses the platform DOMParser (Chromium at runtime; jsdom under test).
 */
import {
  createDocument,
  createEllipse,
  createGroup,
  createLayer,
  createPath,
  createRect,
  type Document,
  type Layer,
  type Mat2D,
  matrix,
  type Segment,
  type Shape,
  type SubPath,
  type Vec2,
} from 'scene';

const NUM = '-?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][+-]?\\d+)?';

interface Vert {
  pos: Vec2;
  c0: Vec2 | null; // incoming bezier handle (used as c2 of the arriving segment)
  c1: Vec2 | null; // outgoing bezier handle (used as c1 of the leaving segment)
}

/** Parse a LightBurn VertList: `V x y[c0x..][c0y..][c1x..][c1y..]` per vertex. */
function parseVertList(s: string): Vert[] {
  const verts: Vert[] = [];
  const re = new RegExp(`V(${NUM})\\s+(${NUM})((?:c[01][xy]${NUM})*)`, 'g');
  const ctlRe = new RegExp(`c([01])([xy])(${NUM})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const pos = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    const c: Record<string, number> = {};
    let cm: RegExpExecArray | null;
    ctlRe.lastIndex = 0;
    while ((cm = ctlRe.exec(m[3])) !== null) c[`c${cm[1]}${cm[2]}`] = parseFloat(cm[3]);
    // A handle exists only when both its x and y are present; a lone `c0x1` is a
    // "straight" sentinel LightBurn writes for line vertices.
    const c0 = 'c0x' in c && 'c0y' in c ? { x: c.c0x, y: c.c0y } : null;
    const c1 = 'c1x' in c && 'c1y' in c ? { x: c.c1x, y: c.c1y } : null;
    verts.push({ pos, c0, c1 });
  }
  return verts;
}

type Prim = { type: 'L' | 'B'; i: number; j: number };

function parsePrimList(s: string): { closed: true } | Prim[] {
  const t = s.trim();
  if (t.startsWith('LineClosed')) return { closed: true };
  const prims: Prim[] = [];
  const re = /([LB])(\d+)\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    prims.push({ type: m[1] as 'L' | 'B', i: parseInt(m[2], 10), j: parseInt(m[3], 10) });
  }
  return prims;
}

function bezierSegment(verts: Vert[], i: number, j: number): Segment {
  const from = verts[i];
  const to = verts[j];
  return {
    type: 'cubic',
    c1: from.c1 ?? { ...from.pos },
    c2: to.c0 ?? { ...to.pos },
    to: { ...to.pos },
  };
}

/** Build subpaths from a vertex list and its primitive list. */
function buildSubPaths(verts: Vert[], prims: { closed: true } | Prim[]): SubPath[] {
  if (verts.length === 0) return [];
  if ('closed' in prims) {
    return [
      {
        start: { ...verts[0].pos },
        segments: verts.slice(1).map((v): Segment => ({ type: 'line', to: { ...v.pos } })),
        closed: true,
      },
    ];
  }
  const subs: SubPath[] = [];
  let cur: { startIdx: number; segs: Segment[]; startPos: Vec2 } | null = null;
  let end = -1;
  let lastJ = -1;
  const flush = (): void => {
    if (cur && cur.segs.length > 0) {
      subs.push({ start: cur.startPos, segments: cur.segs, closed: lastJ === cur.startIdx });
    }
    cur = null;
  };
  for (const p of prims) {
    if (!cur || p.i !== end) {
      flush();
      cur = { startIdx: p.i, segs: [], startPos: { ...verts[p.i].pos } };
    }
    cur.segs.push(p.type === 'L' ? { type: 'line', to: { ...verts[p.j].pos } } : bezierSegment(verts, p.i, p.j));
    end = p.j;
    lastJ = p.j;
  }
  flush();
  return subs;
}

function parseXForm(el: Element): Mat2D {
  const raw = el.querySelector('XForm')?.textContent?.trim();
  if (!raw) return matrix.identity();
  const n = raw.split(/\s+/).map(Number);
  if (n.length < 6 || n.some((v) => !Number.isFinite(v))) return matrix.identity();
  return { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
}

const LBRN_PALETTE = [
  '#000000', '#0000ff', '#ff0000', '#00e000', '#d0d000', '#ff00ff', '#00ffff', '#884400',
  '#888888', '#ff8800', '#00ff88', '#8800ff', '#ff0088', '#88ff00', '#0088ff', '#440088',
];

interface Ctx {
  layerByIndex: Map<number, Layer>;
  layers: Layer[];
  skipped: Set<string>;
  // LightBurn dedupes repeated geometry: the first shape inlines VertList/PrimList
  // with a VertID/PrimID; later identical shapes reference those ids with no
  // inline data. Cache by id so the references resolve.
  vertsById: Map<string, Vert[]>;
  primsById: Map<string, { closed: true } | Prim[]>;
}

/** Resolve (or lazily create) the layer for a shape's CutIndex. */
function layerFor(ctx: Ctx, cutIndex: number): Layer {
  let layer = ctx.layerByIndex.get(cutIndex);
  if (!layer) {
    layer = createLayer(`C${String(cutIndex).padStart(2, '0')}`, ctx.layers.length);
    layer.color = LBRN_PALETTE[cutIndex % LBRN_PALETTE.length];
    ctx.layerByIndex.set(cutIndex, layer);
    ctx.layers.push(layer);
  }
  return layer;
}

function shapeFromElement(el: Element, ctx: Ctx): Shape | null {
  const type = el.getAttribute('Type');
  const cutIndex = parseInt(el.getAttribute('CutIndex') ?? '0', 10);
  const layerId = layerFor(ctx, cutIndex).id;
  const xform = parseXForm(el);
  const numAttr = (name: string, dflt = 0): number => {
    const v = el.getAttribute(name);
    const n = v == null ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  };

  switch (type) {
    case 'Rect': {
      const w = numAttr('W');
      const h = numAttr('H');
      const cr = numAttr('Cr');
      // LightBurn rects are centred on the local origin; scene rects start at
      // their bottom-left, so shift by (-w/2,-h/2) before applying the XForm.
      return createRect(w, h, { layerId, transform: matrix.multiply(xform, matrix.translation(-w / 2, -h / 2)) }, { rx: cr, ry: cr });
    }
    case 'Ellipse':
      return createEllipse(numAttr('Rx'), numAttr('Ry'), { layerId, transform: xform });
    case 'Path':
    case 'Text': {
      const vl = el.querySelector('VertList')?.textContent ?? '';
      const pl = el.querySelector('PrimList')?.textContent ?? '';
      const vertId = el.getAttribute('VertID');
      const primId = el.getAttribute('PrimID');

      let verts: Vert[] | undefined;
      if (vl) {
        verts = parseVertList(vl);
        if (vertId) ctx.vertsById.set(vertId, verts);
      } else if (vertId) {
        verts = ctx.vertsById.get(vertId);
      }

      let prims: { closed: true } | Prim[] | undefined;
      if (pl) {
        prims = parsePrimList(pl);
        if (primId) ctx.primsById.set(primId, prims);
      } else if (primId) {
        prims = ctx.primsById.get(primId);
      }

      if (!verts || !prims) {
        ctx.skipped.add(type);
        return null;
      }
      const subs = buildSubPaths(verts, prims);
      return subs.length > 0 ? createPath(subs, { layerId, transform: xform }) : null;
    }
    case 'Group': {
      const container = el.querySelector('Children');
      const children: Shape[] = [];
      if (container) {
        for (const child of Array.from(container.children)) {
          if (child.tagName === 'Shape') {
            const s = shapeFromElement(child, ctx);
            if (s) children.push(s);
          }
        }
      }
      return children.length > 0 ? createGroup(children, { layerId, transform: xform }) : null;
    }
    default:
      if (type) ctx.skipped.add(type);
      return null;
  }
}

export interface LbrnImport {
  document: Document;
  /** Shape types present in the file but not converted. */
  skipped: string[];
}

export function importLbrn(text: string): LbrnImport {
  const dom = new DOMParser().parseFromString(text, 'application/xml');
  const root = dom.documentElement;
  if (!root || root.tagName !== 'LightBurnProject') {
    throw new Error('Not a LightBurn project (.lbrn/.lbrn2)');
  }
  const ctx: Ctx = {
    layerByIndex: new Map(),
    layers: [],
    skipped: new Set(),
    vertsById: new Map(),
    primsById: new Map(),
  };

  // Layers first, so shapes resolve their CutIndex to a named layer.
  for (const cs of Array.from(root.getElementsByTagName('CutSetting'))) {
    const index = parseInt(cs.querySelector('index')?.getAttribute('Value') ?? '', 10);
    if (!Number.isFinite(index)) continue;
    const layer = layerFor(ctx, index);
    const name = cs.querySelector('name')?.getAttribute('Value');
    if (name) layer.name = name;
  }

  const shapes: Shape[] = [];
  for (const el of Array.from(root.children)) {
    if (el.tagName !== 'Shape') continue;
    const s = shapeFromElement(el, ctx);
    if (s) shapes.push(s);
  }

  const doc = createDocument({ units: 'mm' });
  doc.layers = ctx.layers.length > 0 ? ctx.layers : [createLayer('Layer 1', 0)];
  doc.shapes = shapes;
  return { document: doc, skipped: [...ctx.skipped] };
}
