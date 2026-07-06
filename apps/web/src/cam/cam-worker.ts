import * as Comlink from 'comlink';
import type { Document } from 'scene';
import type { CutSettings } from 'cam';
import {
  emitGcode,
  type MachineConfig,
  type MachineOrigin,
  simulate,
  type Simulation,
  type Workspace,
} from 'fileformats';
import { buildGcodeJob } from './build-job';

export interface GenerateResult {
  gcode: string;
  simulation: Simulation;
}

/**
 * CAM worker: builds the job, emits GRBL G-code, and simulates it — the entire
 * heavy geometry/WASM pipeline runs off the main thread (invariant 4). Mirrors
 * the geometry worker / render worker transport pattern.
 */
class CamWorker {
  async generate(
    doc: Document,
    settingsByLayer: Record<string, CutSettings>,
    machine: MachineConfig,
    machineOrigin: MachineOrigin = 'front-left',
  ): Promise<GenerateResult> {
    const job = await buildGcodeJob(doc, settingsByLayer);
    const workspace: Workspace = {
      units: 'mm',
      origin: 'bottom-left',
      bed: { widthMm: doc.width, heightMm: doc.height },
      machineOrigin,
    };
    // Saved G-code is in machine space (home-corner mapped); the simulation is
    // kept in design space so the canvas preview overlays the drawing. Distances
    // and time are origin-invariant, so the estimate is identical either way.
    const gcode = emitGcode(job, machine, workspace);
    const previewGcode = machineOrigin === 'front-left' ? gcode : emitGcode(job, machine);
    return { gcode, simulation: simulate(previewGcode, machine.travelSpeed) };
  }
}

export type CamApi = CamWorker;
Comlink.expose(new CamWorker());
