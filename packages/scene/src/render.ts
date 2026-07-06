import { flattenPath, transformPath } from './geom/path';
import { type Document, forEachLeaf } from './model/document';
import { localPath } from './model/shape';

/** A batch of line segments (flat [x0,y0,x1,y1,...]) sharing a colour. */
export interface LineBatch {
  color: string;
  layerId: string;
  segments: Float32Array;
}

/**
 * Convert a document into per-layer line-segment batches ready for a GPU line
 * renderer. Pure and deterministic (no DOM), so it is unit-testable and can run
 * either on the main thread or inside the render worker.
 */
export function sceneToLineBatches(doc: Document, tolerance = 0.1): LineBatch[] {
  const byLayer = new Map<string, number[]>();

  forEachLeaf(doc, (shape, world) => {
    if (shape.hidden) return;
    const layer = doc.layers.find((l) => l.id === shape.layerId);
    if (layer && !layer.visible) return;

    const polylines = flattenPath(transformPath(localPath(shape), world), tolerance);
    const arr = byLayer.get(shape.layerId) ?? [];
    for (const poly of polylines) {
      for (let i = 1; i < poly.length; i++) {
        arr.push(poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
      }
    }
    byLayer.set(shape.layerId, arr);
  });

  const batches: LineBatch[] = [];
  for (const [layerId, arr] of byLayer) {
    const layer = doc.layers.find((l) => l.id === layerId);
    batches.push({
      layerId,
      color: layer?.color ?? '#000000',
      segments: new Float32Array(arr),
    });
  }
  return batches;
}
