import { describe, expect, it } from 'vitest';
import { sceneToLineBatches } from './render';
import { addShape, createDocument } from './model/document';
import { createRect } from './model/factory';
import { vec } from './geom/vec';

describe('sceneToLineBatches', () => {
  it('emits one batch per used layer with segment pairs', () => {
    const doc = createDocument();
    const layer = doc.layers[0].id;
    addShape(doc, createRect(10, 10, { layerId: layer }));
    const batches = sceneToLineBatches(doc);
    expect(batches).toHaveLength(1);
    expect(batches[0].color).toBe(doc.layers[0].color);
    // A closed rectangle flattens to 4 segments -> 4 * 4 floats.
    expect(batches[0].segments.length).toBe(16);
  });

  it('skips hidden shapes and hidden layers', () => {
    const doc = createDocument();
    const layer = doc.layers[0].id;
    const r = addShape(doc, createRect(10, 10, { layerId: layer, at: vec(0, 0) }));
    r.hidden = true;
    expect(sceneToLineBatches(doc)).toHaveLength(0);

    r.hidden = false;
    doc.layers[0].visible = false;
    expect(sceneToLineBatches(doc)).toHaveLength(0);
  });
});
