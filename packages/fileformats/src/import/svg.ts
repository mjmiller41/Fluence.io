/**
 * SVG document import → scene {@link Document}. Walks the element tree, resolving
 * nested `transform`s, converting each graphic element to path geometry, and
 * grouping shapes into layers by stroke/fill colour (laser-tool convention).
 * Coordinates are mapped SVG (y-down, user units) → scene (y-up, millimetres)
 * using the viewBox and width/height, with a 96-dpi fallback when units are
 * absent.
 *
 * Uses the platform `DOMParser` (Chromium at runtime; jsdom under test). The
 * heavy lifting — path-data and transform parsing, arc conversion — lives in the
 * pure, node-tested `svg-path`/`svg-transform` modules.
 */
import {
  createDocument,
  createLayer,
  createPath,
  type Document,
  type Layer,
  type Mat2D,
  matrix,
  type Shape,
  type SubPath,
  type Vec2,
} from 'scene';
import { parsePathData } from './svg-path';
import { parseTransform } from './svg-transform';

const MM_PER_PX = 25.4 / 96;
const KAPPA = 0.5522847498307936;

/** Parse an SVG length like "100mm", "9.6cm", "300", "300px" into millimetres. */
function lengthMm(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|px|pt|pc)?\s*$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'mm':
      return n;
    case 'cm':
      return n * 10;
    case 'in':
      return n * 25.4;
    case 'pt':
      return (n * 25.4) / 72;
    case 'pc':
      return (n * 25.4) / 6;
    default:
      return n * MM_PER_PX; // px or unitless user units → 96 dpi
  }
}

interface RootFrame {
  root: Mat2D;
  widthMm: number;
  heightMm: number;
}

/** Compute the SVG→mm (y-flipped) root transform and physical document size. */
function rootFrame(svg: Element): RootFrame {
  const vb = svg.getAttribute('viewBox');
  let minX = 0;
  let minY = 0;
  let vbW: number;
  let vbH: number;
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number);
    [minX, minY, vbW, vbH] = p;
  } else {
    vbW = lengthMm(svg.getAttribute('width')) ?? 100;
    vbH = lengthMm(svg.getAttribute('height')) ?? 100;
    // No viewBox: user units already equal our mm interpretation below.
    return {
      root: { a: 1, b: 0, c: 0, d: -1, e: 0, f: vbH },
      widthMm: vbW,
      heightMm: vbH,
    };
  }
  const widthMm = lengthMm(svg.getAttribute('width')) ?? vbW * MM_PER_PX;
  const heightMm = lengthMm(svg.getAttribute('height')) ?? vbH * MM_PER_PX;
  const scaleX = widthMm / vbW;
  const scaleY = heightMm / vbH;
  // docX = scaleX*(x-minX); docY = scaleY*((minY+vbH) - y)  → y-flip.
  return {
    root: { a: scaleX, b: 0, c: 0, d: -scaleY, e: -scaleX * minX, f: scaleY * (minY + vbH) },
    widthMm,
    heightMm,
  };
}

const num = (el: Element, name: string, dflt = 0): number => {
  const v = el.getAttribute(name);
  const n = v == null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

/** A KAPPA-cubic ellipse (SVG coords) centred at (cx,cy). */
function ellipseSub(cx: number, cy: number, rx: number, ry: number): SubPath {
  const p = (x: number, y: number): Vec2 => ({ x, y });
  const right = p(cx + rx, cy);
  const top = p(cx, cy - ry);
  const left = p(cx - rx, cy);
  const bottom = p(cx, cy + ry);
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    start: right,
    segments: [
      { type: 'cubic', c1: p(cx + rx, cy - ky), c2: p(cx + kx, cy - ry), to: top },
      { type: 'cubic', c1: p(cx - kx, cy - ry), c2: p(cx - rx, cy - ky), to: left },
      { type: 'cubic', c1: p(cx - rx, cy + ky), c2: p(cx - kx, cy + ry), to: bottom },
      { type: 'cubic', c1: p(cx + kx, cy + ry), c2: p(cx + rx, cy + ky), to: right },
    ],
    closed: true,
  };
}

function pointsSub(raw: string, closed: boolean): SubPath | null {
  const nums = raw.split(/[\s,]+/).filter((s) => s.length > 0).map(Number);
  if (nums.length < 4) return null;
  const start = { x: nums[0], y: nums[1] };
  const segments: SubPath['segments'] = [];
  for (let i = 2; i + 1 < nums.length; i += 2) segments.push({ type: 'line', to: { x: nums[i], y: nums[i + 1] } });
  return { start, segments, closed };
}

function rectSub(x: number, y: number, w: number, h: number, rx: number, ry: number): SubPath {
  if (rx <= 0 && ry <= 0) {
    return {
      start: { x, y },
      segments: [
        { type: 'line', to: { x: x + w, y } },
        { type: 'line', to: { x: x + w, y: y + h } },
        { type: 'line', to: { x, y: y + h } },
      ],
      closed: true,
    };
  }
  const r = Math.min(rx || ry, w / 2);
  const s = Math.min(ry || rx, h / 2);
  const kx = r * KAPPA;
  const ky = s * KAPPA;
  const p = (px: number, py: number): Vec2 => ({ x: px, y: py });
  return {
    start: p(x + r, y),
    segments: [
      { type: 'line', to: p(x + w - r, y) },
      { type: 'cubic', c1: p(x + w - r + kx, y), c2: p(x + w, y + s - ky), to: p(x + w, y + s) },
      { type: 'line', to: p(x + w, y + h - s) },
      { type: 'cubic', c1: p(x + w, y + h - s + ky), c2: p(x + w - r + kx, y + h), to: p(x + w - r, y + h) },
      { type: 'line', to: p(x + r, y + h) },
      { type: 'cubic', c1: p(x + r - kx, y + h), c2: p(x, y + h - s + ky), to: p(x, y + h - s) },
      { type: 'line', to: p(x, y + s) },
      { type: 'cubic', c1: p(x, y + s - ky), c2: p(x + r - kx, y), to: p(x + r, y) },
    ],
    closed: true,
  };
}

/** Geometry (SVG coords) for a single graphic element, or null if not one. */
function elementGeometry(el: Element): SubPath[] | null {
  switch (el.tagName.toLowerCase()) {
    case 'path': {
      const d = el.getAttribute('d');
      return d ? parsePathData(d) : [];
    }
    case 'rect':
      return [rectSub(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'), num(el, 'rx'), num(el, 'ry'))];
    case 'circle': {
      const r = num(el, 'r');
      return r > 0 ? [ellipseSub(num(el, 'cx'), num(el, 'cy'), r, r)] : [];
    }
    case 'ellipse':
      return [ellipseSub(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry'))];
    case 'line':
      return [
        {
          start: { x: num(el, 'x1'), y: num(el, 'y1') },
          segments: [{ type: 'line', to: { x: num(el, 'x2'), y: num(el, 'y2') } }],
          closed: false,
        },
      ];
    case 'polyline': {
      const sp = pointsSub(el.getAttribute('points') ?? '', false);
      return sp ? [sp] : [];
    }
    case 'polygon': {
      const sp = pointsSub(el.getAttribute('points') ?? '', true);
      return sp ? [sp] : [];
    }
    default:
      return null;
  }
}

interface Collected {
  subpaths: SubPath[];
  world: Mat2D;
  color: string;
}

export function importSvg(text: string): Document {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = dom.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Not an SVG document');
  }
  const frame = rootFrame(svg);
  const collected: Collected[] = [];

  const walk = (el: Element, parentWorld: Mat2D, parentColor: string): void => {
    const world = matrix.multiply(parentWorld, parseTransform(el.getAttribute('transform')));
    const stroke = el.getAttribute('stroke');
    const fill = el.getAttribute('fill');
    const color = stroke && stroke !== 'none' ? stroke.toLowerCase() : fill && fill !== 'none' ? fill.toLowerCase() : parentColor;
    const geom = elementGeometry(el);
    if (geom) {
      if (geom.length > 0) collected.push({ subpaths: geom, world, color });
      return; // graphic elements have no graphic children
    }
    for (const child of Array.from(el.children)) walk(child, world, color);
  };
  walk(svg, frame.root, '#000000');

  const doc = createDocument({ units: 'mm', width: round2(frame.widthMm), height: round2(frame.heightMm) });
  doc.layers = [];
  const layerByColor = new Map<string, Layer>();
  const shapes: Shape[] = [];
  for (const c of collected) {
    let layer = layerByColor.get(c.color);
    if (!layer) {
      layer = createLayer(`Imported ${doc.layers.length + 1}`, doc.layers.length);
      if (/^#|^rgb|^[a-z]+$/i.test(c.color)) layer.color = c.color;
      layerByColor.set(c.color, layer);
      doc.layers.push(layer);
    }
    shapes.push(createPath(c.subpaths, { layerId: layer.id, transform: c.world }));
  }
  if (doc.layers.length === 0) doc.layers = [createLayer('Layer 1', 0)];
  doc.shapes = shapes;
  return doc;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
