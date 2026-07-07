import { beforeEach, describe, expect, it } from 'vitest';
import { createDocument, leafGeometries } from './document';
import { createImage, createRect } from './factory';
import { resetIds } from './ids';
import { isClosed, shapeBounds } from './shape';

const init = { layerId: 'ly' };

beforeEach(() => resetIds());

describe('ImageShape', () => {
  it('has bounds at its physical size, placed at its origin', () => {
    const img = createImage('data:image/png;base64,AA', 300, 150, 25.4, 12.7, {
      layerId: 'ly',
      at: { x: 10, y: 20 },
    });
    const b = shapeBounds(img)!;
    expect(b.x).toBeCloseTo(10, 6);
    expect(b.y).toBeCloseTo(20, 6);
    expect(b.width).toBeCloseTo(25.4, 6);
    expect(b.height).toBeCloseTo(12.7, 6);
    expect(isClosed(img)).toBe(true);
  });

  it('is skipped by leafGeometries (no vector toolpath for CAM)', () => {
    const doc = createDocument();
    const ly = doc.layers[0].id;
    doc.shapes = [
      createRect(10, 10, { layerId: ly }),
      createImage('data:image/png;base64,AA', 100, 100, 10, 10, { layerId: ly }),
    ];
    const geoms = leafGeometries(doc);
    // Only the rect contributes cuttable geometry; the image is excluded.
    expect(geoms).toHaveLength(1);
  });

  it('round-trips its data through structuredClone (JSON-safe fields)', () => {
    const img = createImage('data:image/png;base64,AAAA', 4, 2, 4, 2, init);
    const copy = JSON.parse(JSON.stringify(img));
    expect(copy.src).toBe('data:image/png;base64,AAAA');
    expect(copy.pxWidth).toBe(4);
  });
});
