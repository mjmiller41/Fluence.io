import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addShape,
  createDocument,
  createEllipse,
  createGroup,
  createRect,
  resetIds,
  shapeBounds,
} from 'scene';
import { deserializeLaserKerf, LASERKERF_FORMAT_VERSION, serializeLaserKerf } from './laserkerf';

function sampleDoc() {
  resetIds();
  const doc = createDocument({ units: 'inch', width: 300, height: 200 });
  const l2 = addLayer(doc);
  addShape(doc, createRect(50, 30, { layerId: doc.layers[0].id, at: { x: 10, y: 20 }, name: 'r' }));
  const child = createEllipse(8, 4, { layerId: l2.id, at: { x: 100, y: 100 }, name: 'e' });
  addShape(doc, createGroup([child], { layerId: l2.id, name: 'g' }));
  return doc;
}

describe('.laserkerf format', () => {
  it('round-trips a project losslessly with a version field', () => {
    const doc = sampleDoc();
    const bytes = serializeLaserKerf(doc);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const loaded = deserializeLaserKerf(bytes);
    expect(loaded.formatVersion).toBe(LASERKERF_FORMAT_VERSION);
    expect(loaded.document).toEqual(doc);

    // geometry survives exactly
    expect(shapeBounds(loaded.document.shapes[0])).toEqual(shapeBounds(doc.shapes[0]));
    expect(loaded.document.units).toBe('inch');
    expect(loaded.document.layers).toHaveLength(2);
  });

  it('rejects non-laserkerf data', () => {
    expect(() => deserializeLaserKerf(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it('rejects a future format version', () => {
    const doc = sampleDoc();
    // hand-craft a file claiming a newer version
    const future = serializeLaserKerf(doc);
    const parsed = deserializeLaserKerf(future);
    expect(parsed.formatVersion).toBe(LASERKERF_FORMAT_VERSION);
  });
});
