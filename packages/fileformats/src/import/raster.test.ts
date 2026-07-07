import { describe, expect, it } from 'vitest';
import { dataUrl, imageInfo, physicalSizeMm, toBase64 } from './raster';

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out; // CRC left zero (parser does not validate it)
}

function pngBytes(w: number, h: number, ppuX?: number): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, w);
  new DataView(ihdrData.buffer).setUint32(4, h);
  const parts = [sig, chunk('IHDR', ihdrData)];
  if (ppuX !== undefined) {
    const phys = new Uint8Array(9);
    const dv = new DataView(phys.buffer);
    dv.setUint32(0, ppuX);
    dv.setUint32(4, ppuX);
    phys[8] = 1; // unit = metre
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IEND', new Uint8Array(0)));
  return concat(...parts);
}

function jpegBytes(w: number, h: number): Uint8Array {
  const soi = new Uint8Array([0xff, 0xd8]);
  // APP0 JFIF, 72 dpi.
  const app0 = new Uint8Array(2 + 16);
  const a = new DataView(app0.buffer);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  a.setUint16(2, 16);
  'JFIF\0'.split('').forEach((c, i) => (app0[4 + i] = c.charCodeAt(0)));
  app0[4 + 7] = 1; // units = dpi
  a.setUint16(4 + 8, 72); // x density
  a.setUint16(4 + 10, 72);
  // SOF0.
  const sof = new Uint8Array(2 + 15);
  const s = new DataView(sof.buffer);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  s.setUint16(2, 15);
  sof[4] = 8; // precision
  s.setUint16(5, h);
  s.setUint16(7, w);
  return concat(soi, app0, sof);
}

describe('imageInfo', () => {
  it('reads PNG size and pHYs DPI', () => {
    const info = imageInfo(pngBytes(300, 150, 11811)); // 11811 ppm ≈ 300 dpi
    expect(info.width).toBe(300);
    expect(info.height).toBe(150);
    expect(info.dpi).toBe(300);
  });

  it('defaults DPI to 96 when PNG has no pHYs', () => {
    expect(imageInfo(pngBytes(96, 96)).dpi).toBe(96);
  });

  it('reads JPEG size and JFIF density', () => {
    const info = imageInfo(jpegBytes(200, 100));
    expect(info.width).toBe(200);
    expect(info.height).toBe(100);
    expect(info.dpi).toBe(72);
  });

  it('throws on non-image bytes', () => {
    expect(() => imageInfo(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('physicalSizeMm', () => {
  it('converts pixels at DPI to millimetres', () => {
    const { widthMm, heightMm } = physicalSizeMm({ width: 300, height: 150, dpi: 300 });
    expect(widthMm).toBeCloseTo(25.4, 6);
    expect(heightMm).toBeCloseTo(12.7, 6);
  });
});

describe('toBase64 / dataUrl', () => {
  it('encodes bytes to base64', () => {
    expect(toBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
    expect(toBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
  });

  it('builds a data URL', () => {
    expect(dataUrl(new Uint8Array([0]), 'image/png')).toMatch(/^data:image\/png;base64,/);
  });
});
