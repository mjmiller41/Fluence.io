import { type Document, leafGeometries } from 'scene';
import {
  type CutSettings,
  defaultCutSettings,
  generateToolpaths,
  optimizeOrder,
  type Toolpath,
} from 'cam';
import type { GcodeJob, GcodeOperation } from 'fileformats';

/**
 * Turn a document + per-layer cut settings into a CAM job: one operation per
 * visible, non-empty layer (in layer order), each with its toolpaths generated
 * from the layer's cut mode and cut-order optimized. Pure and deterministic, so
 * it can be unit-tested without a worker and golden-compared via `emitGcode`.
 *
 * Heavy (offset-fill runs Clipper2/WASM), so callers run this inside the CAM
 * worker — never on the main thread (CLAUDE.md invariant 4).
 */
export async function buildGcodeJob(
  doc: Document,
  settingsByLayer: Record<string, CutSettings> = {},
): Promise<GcodeJob> {
  const geometries = leafGeometries(doc);
  const operations: GcodeOperation[] = [];

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const settings = settingsByLayer[layer.id] ?? defaultCutSettings();
    const paths = geometries.filter((g) => g.layerId === layer.id);
    if (paths.length === 0) continue;

    const toolpaths: Toolpath[] = [];
    for (const g of paths) {
      toolpaths.push(...(await generateToolpaths(g.path, settings)));
    }
    if (toolpaths.length === 0) continue;

    operations.push({ settings, toolpaths: optimizeOrder(toolpaths) });
  }

  return { operations };
}
