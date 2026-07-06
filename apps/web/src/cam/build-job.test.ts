// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDocument, createLayer, createRect } from 'scene';
import { defaultCutSettings } from 'cam';
import { defaultMachine, emitGcode, simulate } from 'fileformats';
import { buildGcodeJob } from './build-job';

function twoLayerDoc() {
  const doc = createDocument({ width: 200, height: 200 });
  const layerA = doc.layers[0];
  const layerB = createLayer('Layer 2', 1);
  doc.layers.push(layerB);
  doc.shapes.push(createRect(20, 10, { layerId: layerA.id, at: { x: 0, y: 0 } }));
  doc.shapes.push(createRect(30, 30, { layerId: layerB.id, at: { x: 50, y: 50 } }));
  return { doc, layerA, layerB };
}

describe('buildGcodeJob', () => {
  it('emits one operation per visible, non-empty layer in layer order', async () => {
    const { doc, layerA, layerB } = twoLayerDoc();
    const job = await buildGcodeJob(doc, {
      [layerA.id]: defaultCutSettings({ mode: 'line', speed: 800 }),
      [layerB.id]: defaultCutSettings({ mode: 'line', speed: 1200 }),
    });
    expect(job.operations).toHaveLength(2);
    expect(job.operations[0].settings.speed).toBe(800);
    expect(job.operations[1].settings.speed).toBe(1200);
  });

  it('skips hidden layers and layers with no geometry', async () => {
    const { doc, layerB } = twoLayerDoc();
    layerB.visible = false; // hidden -> excluded
    doc.layers.push(createLayer('empty', 2)); // no shapes -> excluded
    const job = await buildGcodeJob(doc);
    expect(job.operations).toHaveLength(1);
  });

  it('feeds the golden-tested emitter/simulator (rect outline perimeter)', async () => {
    const doc = createDocument({ width: 200, height: 200 });
    doc.shapes.push(createRect(20, 10, { layerId: doc.layers[0].id, at: { x: 0, y: 0 } }));
    const job = await buildGcodeJob(doc, {
      [doc.layers[0].id]: defaultCutSettings({ mode: 'line', speed: 600 }),
    });
    const sim = simulate(emitGcode(job, defaultMachine()), 6000);
    // 20 x 10 rectangle outline = 60 mm of cutting.
    expect(sim.cutDistance).toBeCloseTo(60, 3);
    expect(sim.bounds).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });
});
