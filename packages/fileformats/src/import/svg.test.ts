// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pathBounds, rectCenter, shapeGeometry } from 'scene';
import { importSvg } from './svg';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
  <rect x="0" y="0" width="100" height="50" stroke="#ff0000" fill="none"/>
  <g transform="translate(10,10)">
    <circle cx="0" cy="0" r="5" stroke="#0000ff"/>
  </g>
  <path d="M0 0 L10 0" stroke="#00ff00"/>
</svg>`;

describe('importSvg', () => {
  it('reads physical size and units from width/height + viewBox', () => {
    const doc = importSvg(SVG);
    expect(doc.units).toBe('mm');
    expect(doc.width).toBeCloseTo(100, 6);
    expect(doc.height).toBeCloseTo(50, 6);
  });

  it('groups shapes into one layer per stroke colour', () => {
    const doc = importSvg(SVG);
    expect(doc.shapes).toHaveLength(3);
    expect(doc.layers).toHaveLength(3); // red, blue, green
    expect(doc.layers.map((l) => l.color).sort()).toEqual(['#0000ff', '#00ff00', '#ff0000']);
  });

  it('maps SVG y-down to scene y-up (the rect covers the whole bed)', () => {
    const doc = importSvg(SVG);
    const rect = doc.shapes[0];
    const b = pathBounds(shapeGeometry(rect))!;
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(50, 6);
  });

  it('applies nested transforms (translated circle sits at flipped 10,40)', () => {
    const doc = importSvg(SVG);
    const circle = doc.shapes[1];
    const c = rectCenter(pathBounds(shapeGeometry(circle))!);
    expect(c.x).toBeCloseTo(10, 6);
    expect(c.y).toBeCloseTo(40, 6); // SVG (10,10) → scene (10, 50-10)
  });

  it('throws on non-SVG input', () => {
    expect(() => importSvg('<html><body>nope</body></html>')).toThrow();
  });
});
