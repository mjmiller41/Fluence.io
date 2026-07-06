import { type Document, leafGeometries } from 'scene';
import {
  type CutSettings,
  defaultCutSettings,
  generateToolpaths,
  groupedFillToolpaths,
  lineToolpaths,
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
    const layerGeoms = paths.map((p) => p.path);

    let toolpaths: Toolpath[];
    if (settings.mode === 'fill' || settings.mode === 'fill+line') {
      // Fill grouping (M2-T02) is itself the scan-line ordering, so it is
      // preserved as-is; only the outline cut of fill+line is travel-optimized.
      const fills = groupedFillToolpaths(
        layerGeoms,
        settings.interval,
        settings.angle,
        settings.fillGrouping,
      );
      const outlines =
        settings.mode === 'fill+line' ? optimizeOrder(layerGeoms.flatMap((g) => lineToolpaths(g))) : [];
      toolpaths = [...fills, ...outlines];
    } else {
      // Line / offset-fill: order shapes to minimise rapid travel (M2-T03).
      const perShape: Toolpath[] = [];
      for (const g of layerGeoms) perShape.push(...(await generateToolpaths(g, settings)));
      toolpaths = optimizeOrder(perShape);
    }
    if (toolpaths.length === 0) continue;

    operations.push({ settings, toolpaths });
  }

  return { operations };
}
