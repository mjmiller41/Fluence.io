/**
 * Text → vector paths via opentype.js. Converts a TrueType/OpenType font plus a
 * string into scene {@link SubPath}s (glyph outlines baked to paths), with
 * kerning, letter spacing, and multi-line layout. opentype places glyphs y-down
 * with the baseline at a given y; we negate y to land in scene's y-up mm frame.
 *
 * Pure and node-testable (parses raw font bytes) — no DOM. Font *acquisition*
 * (Local Font Access API or an uploaded file) is the caller's job. SHX stroke
 * fonts are a separate parser, tracked as M1-T06b.
 */
import opentype from 'opentype.js';
import { createPath, type PathShape, type Segment, type ShapeInit, type SubPath, type Vec2 } from 'scene';

export interface TextOptions {
  /** Em size in millimetres. */
  size: number;
  /** Extra spacing added between glyphs, in mm (default 0). */
  letterSpacing?: number;
  /** Line advance as a multiple of `size` (default 1.2). */
  lineHeight?: number;
  /** Apply the font's kerning pairs (default true). */
  kerning?: boolean;
}

type Cmd = {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

/** opentype path commands (y-down) → subpaths, elevating quadratics to cubics. */
function commandsToSubPaths(cmds: Cmd[]): SubPath[] {
  const out: SubPath[] = [];
  let sub: SubPath | null = null;
  let cur: Vec2 = { x: 0, y: 0 };
  // Glyph contours are always closed regions; opentype sometimes omits the
  // explicit 'Z', so close every contour on flush.
  const flush = (): void => {
    if (sub && sub.segments.length > 0) {
      sub.closed = true;
      out.push(sub);
    }
    sub = null;
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        flush();
        cur = { x: c.x!, y: c.y! };
        sub = { start: { ...cur }, segments: [], closed: false };
        break;
      case 'L':
        if (sub) sub.segments.push({ type: 'line', to: { x: c.x!, y: c.y! } });
        cur = { x: c.x!, y: c.y! };
        break;
      case 'C':
        if (sub)
          sub.segments.push({
            type: 'cubic',
            c1: { x: c.x1!, y: c.y1! },
            c2: { x: c.x2!, y: c.y2! },
            to: { x: c.x!, y: c.y! },
          });
        cur = { x: c.x!, y: c.y! };
        break;
      case 'Q': {
        const qc = { x: c.x1!, y: c.y1! };
        const to = { x: c.x!, y: c.y! };
        if (sub) sub.segments.push(quadToCubic(cur, qc, to));
        cur = to;
        break;
      }
      case 'Z':
        if (sub) {
          sub.closed = true;
          out.push(sub);
          sub = null;
        }
        break;
    }
  }
  flush();
  return out;
}

function quadToCubic(from: Vec2, qc: Vec2, to: Vec2): Segment {
  return {
    type: 'cubic',
    c1: { x: from.x + (2 / 3) * (qc.x - from.x), y: from.y + (2 / 3) * (qc.y - from.y) },
    c2: { x: to.x + (2 / 3) * (qc.x - to.x), y: to.y + (2 / 3) * (qc.y - to.y) },
    to,
  };
}

const flipY = (sp: SubPath): SubPath => ({
  start: { x: sp.start.x, y: -sp.start.y },
  segments: sp.segments.map((s): Segment =>
    s.type === 'line'
      ? { type: 'line', to: { x: s.to.x, y: -s.to.y } }
      : {
          type: 'cubic',
          c1: { x: s.c1.x, y: -s.c1.y },
          c2: { x: s.c2.x, y: -s.c2.y },
          to: { x: s.to.x, y: -s.to.y },
        },
  ),
  closed: sp.closed,
});

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Parse font bytes into an opentype Font (throws on an unsupported file). */
export function parseFont(bytes: ArrayBuffer | Uint8Array): opentype.Font {
  return opentype.parse(toArrayBuffer(bytes));
}

/** Kerning between two glyphs, tolerant of fonts with no kerning table. */
function kerningValue(font: opentype.Font, a: opentype.Glyph, b: opentype.Glyph): number {
  try {
    return font.getKerningValue(a, b);
  } catch {
    return 0;
  }
}

/** Lay out `text` in `font` and return the baked glyph outlines as subpaths (y-up, mm). */
export function textToSubPaths(font: opentype.Font, text: string, opts: TextOptions): SubPath[] {
  const size = opts.size;
  const letterSpacing = opts.letterSpacing ?? 0;
  const lineAdvance = (opts.lineHeight ?? 1.2) * size;
  const kerning = opts.kerning ?? true;
  const upm = font.unitsPerEm;
  const all: SubPath[] = [];

  text.split('\n').forEach((lineStr, li) => {
    let x = 0;
    const baselineY = li * lineAdvance; // opentype y-down: later lines have larger y
    const glyphs = font.stringToGlyphs(lineStr);
    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i];
      const path = glyph.getPath(x, baselineY, size);
      all.push(...commandsToSubPaths(path.commands as Cmd[]));
      let advance = ((glyph.advanceWidth ?? 0) / upm) * size;
      if (kerning && i + 1 < glyphs.length) {
        advance += (kerningValue(font, glyph, glyphs[i + 1]) / upm) * size;
      }
      x += advance + letterSpacing;
    }
  });

  return all.map(flipY);
}

/** Convenience: bake `text` to a single {@link PathShape} on the given layer. */
export function textToPathShape(
  font: opentype.Font,
  text: string,
  opts: TextOptions,
  init: ShapeInit,
): PathShape {
  return createPath(textToSubPaths(font, text, opts), init);
}
