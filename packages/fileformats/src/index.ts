/**
 * fileformats — project storage today (OPFS + IndexedDB + autosave); the
 * `.laserkerf` format, `.lbrn` import, and SVG/DXF/AI/PDF + G-code/.rd codecs land
 * in M1/M2/M4. The golden-output harness for machine code also lives here
 * (`pnpm --filter fileformats test:golden`).
 */
export * from './storage/index';
export * from './coordinate/coordinate';
export {
  deserializeLaserKerf,
  LASERKERF_FORMAT_VERSION,
  serializeLaserKerf,
  type LoadedLaserKerf,
} from './laserkerf/laserkerf';
export {
  defaultMachine,
  emitGcode,
  type GcodeJob,
  type GcodeOperation,
  type MachineConfig,
} from './gcode/gcode';
export { simulate, type Simulation, type SimSegment } from './gcode/simulate';
export { importSvg } from './import/svg';
export { importDxf, type DxfImport } from './import/dxf';
