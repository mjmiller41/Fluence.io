import { describe, expect, it } from 'vitest';
import opentype from 'opentype.js';
import { flattenSubPath, pathBounds, type SubPath } from 'scene';
import { parseFont, textToSubPaths } from './text';

/** Bounds of a single subpath. */
const bounds = (sp: SubPath) => pathBounds([sp])!;

/**
 * A tiny synthetic font: glyph 'A' is a 500×700 rectangle in em units (1000 upm)
 * with advance 600. Fully self-contained, so the test is portable and its output
 * is exactly predictable.
 */
function testFont(): opentype.Font {
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 1000, path: new opentype.Path() });
  const p = new opentype.Path();
  p.moveTo(0, 0);
  p.lineTo(500, 0);
  p.lineTo(500, 700);
  p.lineTo(0, 700);
  p.close();
  const a = new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: p });
  return new opentype.Font({
    familyName: 'Test',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, a],
  });
}

describe('textToSubPaths', () => {
  it('bakes a glyph to a scene subpath at the right size, y-up', () => {
    const sp = textToSubPaths(testFont(), 'A', { size: 10 });
    expect(sp).toHaveLength(1);
    expect(sp[0].closed).toBe(true);
    const b = bounds(sp[0]);
    // 500/1000*10 = 5 wide, 700/1000*10 = 7 tall, sitting above the baseline (y>=0).
    expect(b.width).toBeCloseTo(5, 6);
    expect(b.height).toBeCloseTo(7, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.y + b.height).toBeCloseTo(7, 6);
  });

  it('advances by the glyph width and adds letter spacing', () => {
    const plain = textToSubPaths(testFont(), 'AA', { size: 10 });
    // Second glyph starts at advance 600/1000*10 = 6.
    expect(bounds(plain[1]).x).toBeCloseTo(6, 6);

    const spaced = textToSubPaths(testFont(), 'AA', { size: 10, letterSpacing: 2 });
    expect(bounds(spaced[1]).x).toBeCloseTo(8, 6);
  });

  it('lays out multiple lines downward', () => {
    const sp = textToSubPaths(testFont(), 'A\nA', { size: 10, lineHeight: 1.2 });
    expect(sp).toHaveLength(2);
    const top = bounds(sp[0]);
    const below = bounds(sp[1]);
    // Second line's baseline is 12mm below the first (1.2 * 10).
    expect(below.y).toBeCloseTo(top.y - 12, 6);
  });

  it('round-trips through parseFont(font bytes)', () => {
    const bytes = new Uint8Array(testFont().toArrayBuffer());
    const parsed = parseFont(bytes);
    const sp = textToSubPaths(parsed, 'A', { size: 10 });
    // Same rectangle geometry after a serialize→parse round-trip.
    const poly = flattenSubPath(sp[0]);
    const b = bounds(sp[0]);
    expect(b.width).toBeCloseTo(5, 3);
    expect(b.height).toBeCloseTo(7, 3);
    expect(poly.length).toBeGreaterThanOrEqual(4);
  });
});
