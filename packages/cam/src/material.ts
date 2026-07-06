import { type CutSettings, defaultCutSettings } from './settings';

/**
 * Material library (M2-T04): named cut presets per material/machine that apply
 * over a layer's cut settings. Pure and immutable (CRUD returns a new library),
 * so it is unit-testable and serializes losslessly for import/export.
 */
export interface MaterialPreset {
  id: string;
  /** Display name, e.g. "3mm Birch Ply — Cut". */
  name: string;
  /** Optional grouping metadata (free-form, generic — no vendor data copied). */
  material?: string;
  machine?: string;
  /** Stock thickness in millimetres. */
  thickness?: number;
  notes?: string;
  /** Cut parameters this preset applies (merged over the layer's settings). */
  settings: Partial<CutSettings>;
}

export interface MaterialLibrary {
  version: number;
  presets: MaterialPreset[];
}

export const MATERIAL_LIBRARY_VERSION = 1;

export function emptyLibrary(): MaterialLibrary {
  return { version: MATERIAL_LIBRARY_VERSION, presets: [] };
}

/** Construct a preset (caller supplies the id so the model stays deterministic). */
export function createPreset(
  id: string,
  name: string,
  settings: Partial<CutSettings>,
  meta: Pick<MaterialPreset, 'material' | 'machine' | 'thickness' | 'notes'> = {},
): MaterialPreset {
  return { id, name, settings, ...meta };
}

export function getPreset(lib: MaterialLibrary, id: string): MaterialPreset | undefined {
  return lib.presets.find((p) => p.id === id);
}

/** Add a preset (replaces any existing one with the same id). */
export function addPreset(lib: MaterialLibrary, preset: MaterialPreset): MaterialLibrary {
  const presets = lib.presets.filter((p) => p.id !== preset.id);
  presets.push(preset);
  return { ...lib, presets };
}

export function updatePreset(
  lib: MaterialLibrary,
  id: string,
  patch: Partial<Omit<MaterialPreset, 'id'>>,
): MaterialLibrary {
  return {
    ...lib,
    presets: lib.presets.map((p) =>
      p.id === id ? { ...p, ...patch, settings: { ...p.settings, ...patch.settings } } : p,
    ),
  };
}

export function removePreset(lib: MaterialLibrary, id: string): MaterialLibrary {
  return { ...lib, presets: lib.presets.filter((p) => p.id !== id) };
}

/** Apply a preset over base cut settings, yielding a complete CutSettings. */
export function applyPreset(base: CutSettings, preset: MaterialPreset): CutSettings {
  return { ...base, ...preset.settings };
}

/** Resolve a preset to full cut settings over defaults (e.g. for a new layer). */
export function presetToSettings(preset: MaterialPreset): CutSettings {
  return applyPreset(defaultCutSettings(), preset);
}

const KNOWN_KEYS: Array<keyof CutSettings> = [
  'mode',
  'speed',
  'minPower',
  'maxPower',
  'passes',
  'interval',
  'angle',
  'airAssist',
  'fillGrouping',
];

/** Keep only recognised, correctly-typed cut-setting keys from an import. */
function sanitizeSettings(raw: unknown): Partial<CutSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    if (key in src && src[key] !== undefined) out[key] = src[key];
  }
  return out as Partial<CutSettings>;
}

function sanitizePreset(raw: unknown): MaterialPreset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== 'string' || typeof src.name !== 'string') return null;
  const preset: MaterialPreset = { id: src.id, name: src.name, settings: sanitizeSettings(src.settings) };
  if (typeof src.material === 'string') preset.material = src.material;
  if (typeof src.machine === 'string') preset.machine = src.machine;
  if (typeof src.thickness === 'number') preset.thickness = src.thickness;
  if (typeof src.notes === 'string') preset.notes = src.notes;
  return preset;
}

export function serializeLibrary(lib: MaterialLibrary): string {
  return JSON.stringify({ version: MATERIAL_LIBRARY_VERSION, presets: lib.presets }, null, 2);
}

/**
 * Parse a library, dropping malformed presets. Throws only when the top-level
 * shape is not a library object, so a partially-corrupt file still imports what
 * it can rather than losing everything.
 */
export function deserializeLibrary(json: string): MaterialLibrary {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { presets?: unknown }).presets)) {
    throw new Error('Not a material library');
  }
  const presets = (parsed as { presets: unknown[] }).presets
    .map(sanitizePreset)
    .filter((p): p is MaterialPreset => p !== null);
  return { version: MATERIAL_LIBRARY_VERSION, presets };
}

/** A small generic starter set (generic values — not copied from any vendor). */
export function starterLibrary(): MaterialLibrary {
  return {
    version: MATERIAL_LIBRARY_VERSION,
    presets: [
      createPreset(
        'diode-ply-3mm-cut',
        '3mm Ply — Cut (diode)',
        { mode: 'line', speed: 240, minPower: 20, maxPower: 100, passes: 3, airAssist: true },
        { material: 'Plywood', machine: 'Diode 10W', thickness: 3 },
      ),
      createPreset(
        'diode-engrave',
        'Engrave — Light (diode)',
        { mode: 'fill', speed: 3000, minPower: 10, maxPower: 35, passes: 1, interval: 0.1 },
        { material: 'Wood', machine: 'Diode 10W' },
      ),
      createPreset(
        'co2-acrylic-3mm-cut',
        '3mm Acrylic — Cut (CO2)',
        { mode: 'line', speed: 600, minPower: 15, maxPower: 75, passes: 1, airAssist: false },
        { material: 'Acrylic', machine: 'CO2 40W', thickness: 3 },
      ),
    ],
  };
}
