/**
 * cam — CAM core: cut settings, layer cut modes -> toolpaths, and cut-order
 * optimization. Consumes the scene model + geometry-wasm; the G-code emitter that
 * turns a job into machine code lives in `fileformats` (golden-tested).
 */
export type { CutMode, FillGrouping, CutSettings } from './settings';
export { defaultCutSettings } from './settings';
export type { MaterialPreset, MaterialLibrary } from './material';
export {
  addPreset,
  applyPreset,
  createPreset,
  deserializeLibrary,
  emptyLibrary,
  getPreset,
  MATERIAL_LIBRARY_VERSION,
  presetToSettings,
  removePreset,
  serializeLibrary,
  starterLibrary,
  updatePreset,
} from './material';
export type { Toolpath } from './toolpath';
export {
  fillToolpaths,
  generateToolpaths,
  lineToolpaths,
  offsetFillToolpaths,
  serializeToolpaths,
} from './toolpath';
export type { OrderOptions } from './order';
export { optimizeOrder, totalTravel } from './order';
