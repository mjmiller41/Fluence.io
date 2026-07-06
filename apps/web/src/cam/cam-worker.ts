import * as Comlink from 'comlink';
import type { Document } from 'scene';
import type { CutSettings } from 'cam';
import { emitGcode, type MachineConfig, simulate, type Simulation } from 'fileformats';
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
  ): Promise<GenerateResult> {
    const job = await buildGcodeJob(doc, settingsByLayer);
    const gcode = emitGcode(job, machine);
    return { gcode, simulation: simulate(gcode, machine.travelSpeed) };
  }
}

export type CamApi = CamWorker;
Comlink.expose(new CamWorker());
