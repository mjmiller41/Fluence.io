// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pathBounds, rectCenter, shapeGeometry } from 'scene';
import { importLbrn } from './lbrn';

// Synthetic .lbrn2 mirroring the real format: CutSetting layers, a centred Rect,
// an Ellipse, a closed Path (LineClosed), a bezier Path, a VertID-dedup
// reference to the first path, a Group, and a Bitmap (skipped).
const LBRN = `<?xml version="1.0"?>
<LightBurnProject FormatVersion="1" MaterialHeight="0">
  <CutSetting type="Cut"><index Value="0"/><name Value="Cut"/></CutSetting>
  <CutSetting type="Scan"><index Value="1"/><name Value="Engrave"/></CutSetting>
  <Shape Type="Rect" CutIndex="0" W="40" H="20" Cr="0"><XForm>1 0 0 1 100 100</XForm></Shape>
  <Shape Type="Ellipse" CutIndex="1" Rx="10" Ry="5"><XForm>1 0 0 1 50 50</XForm></Shape>
  <Shape Type="Path" CutIndex="0" VertID="1" PrimID="0"><XForm>1 0 0 1 0 0</XForm><VertList>V0 0c0x1c1x1V10 0c0x1c1x1V10 10c0x1c1x1V0 10c0x1c1x1</VertList><PrimList>LineClosed</PrimList></Shape>
  <Shape Type="Path" CutIndex="0" VertID="2" PrimID="1"><XForm>1 0 0 1 20 0</XForm><VertList>V0 0c1x2c1y5V10 0c0x8c0y5</VertList><PrimList>B0 1</PrimList></Shape>
  <Shape Type="Path" CutIndex="0" VertID="1" PrimID="0"><XForm>1 0 0 1 40 0</XForm></Shape>
  <Shape Type="Group" CutIndex="0"><XForm>1 0 0 1 0 0</XForm><Children><Shape Type="Rect" CutIndex="1" W="5" H="5" Cr="0"><XForm>1 0 0 1 5 5</XForm></Shape></Children></Shape>
  <Shape Type="Bitmap" CutIndex="0"><XForm>1 0 0 1 0 0</XForm></Shape>
</LightBurnProject>`;

describe('importLbrn', () => {
  it('maps CutSettings to named layers', () => {
    const { document } = importLbrn(LBRN);
    expect(document.layers).toHaveLength(2);
    expect(document.layers.map((l) => l.name)).toEqual(['Cut', 'Engrave']);
  });

  it('imports rect/ellipse/path/group and skips bitmaps', () => {
    const { document, skipped } = importLbrn(LBRN);
    expect(document.shapes.map((s) => s.kind)).toEqual([
      'rect',
      'ellipse',
      'path',
      'path',
      'path',
      'group',
    ]);
    expect(skipped).toContain('Bitmap');
  });

  it('centres LightBurn rects on their XForm origin', () => {
    const rect = importLbrn(LBRN).document.shapes[0];
    const c = rectCenter(pathBounds(shapeGeometry(rect))!);
    const b = pathBounds(shapeGeometry(rect))!;
    expect(c.x).toBeCloseTo(100, 6);
    expect(c.y).toBeCloseTo(100, 6);
    expect(b.width).toBeCloseTo(40, 6);
    expect(b.height).toBeCloseTo(20, 6);
  });

  it('builds a closed polygon from LineClosed', () => {
    const path = importLbrn(LBRN).document.shapes[2];
    expect(path.kind).toBe('path');
    if (path.kind === 'path') expect(path.subpaths[0].closed).toBe(true);
  });

  it('builds a cubic from a B primitive using c1/c0 handles', () => {
    const path = importLbrn(LBRN).document.shapes[3];
    if (path.kind === 'path') {
      const seg = path.subpaths[0].segments[0];
      expect(seg.type).toBe('cubic');
      if (seg.type === 'cubic') {
        expect(seg.c1).toEqual({ x: 2, y: 5 });
        expect(seg.c2).toEqual({ x: 8, y: 5 });
      }
    }
  });

  it('resolves a VertID/PrimID dedup reference to the shared geometry', () => {
    // Third path references VertID 1 (the square) with no inline list, shifted +40x.
    const ref = importLbrn(LBRN).document.shapes[4];
    const b = pathBounds(shapeGeometry(ref))!;
    expect(b.x).toBeCloseTo(40, 6);
    expect(b.width).toBeCloseTo(10, 6);
  });

  it('throws on non-LightBurn XML', () => {
    expect(() => importLbrn('<svg></svg>')).toThrow();
  });
});
