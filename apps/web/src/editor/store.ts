import { create } from 'zustand';
import type { BooleanMode } from './boolean';
import {
  addLayerCommand,
  addShapeCommand,
  type Command,
  composite,
  createDocument,
  createLayer,
  type Document,
  findShape,
  History,
  type Layer,
  type LayerId,
  removeShapeCommand,
  replaceShape,
  type Shape,
  type ShapeId,
  updateLayerCommand,
  updateShapeCommand,
} from 'scene';
import {
  addPreset,
  createPreset,
  type CutSettings,
  defaultCutSettings,
  deserializeLibrary,
  getPreset,
  type MaterialLibrary,
  removePreset,
  serializeLibrary,
  starterLibrary,
} from 'cam';
import type { MachineConfig, Simulation } from 'fileformats';

export type Tool = 'select' | 'rect' | 'ellipse' | 'polygon';

/**
 * Persist the material library to OPFS (lazy-loads the fileformats codec bundle).
 * Best-effort: the in-memory library is the session source of truth, so a failed
 * write (OPFS unavailable / tests / private mode) is swallowed rather than thrown.
 */
async function persistLibrary(lib: MaterialLibrary): Promise<void> {
  try {
    const { MaterialStore } = await import('fileformats');
    await (await MaterialStore.open()).save(lib);
  } catch {
    /* best-effort */
  }
}

/**
 * Default GRBL machine profile. Kept as a literal (rather than importing
 * `defaultMachine()` from `fileformats`) so the fileformats codec bundle stays
 * lazily loaded — it is only pulled in on generate/save/open, not app boot.
 */
const DEFAULT_MACHINE: MachineConfig = {
  units: 'mm',
  powerMax: 1000,
  laserMode: 'M4',
  travelSpeed: 6000,
  returnToOrigin: true,
};

/** A generated G-code result plus the simulation used for preview/estimates. */
export interface GcodeResult {
  text: string;
  sim: Simulation;
  /** Document version it was generated from; if it differs from the store's
   *  current version, the design changed and the result is stale. */
  version: number;
}

export interface EditorState {
  doc: Document;
  history: History;
  selection: ShapeId[];
  activeLayerId: LayerId;
  tool: Tool;
  /** Bumped whenever the (mutable) document changes so views re-render/redraw. */
  version: number;

  /** Per-layer cut settings (CAM). Missing layers fall back to defaults. */
  cutSettingsByLayer: Record<LayerId, CutSettings>;
  machine: MachineConfig;
  gcode: GcodeResult | null;
  gcodeBusy: boolean;
  showGcodePreview: boolean;
  /** Material preset library (M2-T04). Persisted to OPFS. */
  library: MaterialLibrary;

  setTool(tool: Tool): void;
  select(ids: ShapeId[]): void;
  selectAll(): void;
  setActiveLayer(id: LayerId): void;

  addShapeAction(shape: Shape): void;
  /** Live mutation during a drag (no history entry). */
  previewUpdate(shape: Shape): void;
  /** Commit a completed drag as one undo step given the pre-drag shapes. */
  commitTransform(before: Shape[]): void;
  /** Apply + record a set of shape updates (align/distribute/node edits). */
  applyUpdates(before: Shape[], after: Shape[]): void;
  deleteSelection(): void;
  selectedShapes(): Shape[];
  booleanAction(mode: BooleanMode): Promise<void>;

  addLayerAction(): void;
  updateLayer(id: LayerId, patch: Partial<Omit<Layer, 'id'>>): void;

  /** Merge a cut-settings patch for one layer (creating defaults if absent). */
  setLayerCutSettings(id: LayerId, patch: Partial<CutSettings>): void;
  /** Load the material library from OPFS (seeding a starter set on first run). */
  loadLibrary(): Promise<void>;
  /** Apply a preset's settings over a layer's current cut settings. */
  applyMaterial(id: LayerId, presetId: string): void;
  /** Save a layer's current settings as a new named preset (persisted). */
  saveLayerAsPreset(id: LayerId, name: string): Promise<void>;
  removeMaterial(presetId: string): Promise<void>;
  /** Merge presets from an exported library JSON string (persisted). */
  importLibrary(json: string): Promise<void>;
  /** Download the library as JSON. */
  exportLibrary(): void;
  /** Build CAM job -> G-code -> simulation in the CAM worker (off main thread). */
  generateGcode(): Promise<void>;
  /** Save the last generated G-code to disk (File System Access, download fallback). */
  saveGcode(): Promise<void>;
  toggleGcodePreview(): void;

  loadDocument(doc: Document): void;
  saveProject(): Promise<void>;
  openProject(): Promise<void>;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

const initialDoc = createDocument();

export const useEditor = create<EditorState>((set, get) => ({
  doc: initialDoc,
  history: new History(),
  selection: [],
  activeLayerId: initialDoc.layers[0].id,
  tool: 'select',
  version: 0,

  cutSettingsByLayer: {},
  machine: DEFAULT_MACHINE,
  gcode: null,
  gcodeBusy: false,
  showGcodePreview: true,
  library: starterLibrary(),

  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: ids }),
  selectAll: () => set((s) => ({ selection: s.doc.shapes.map((sh) => sh.id) })),
  setActiveLayer: (id) => set({ activeLayerId: id }),

  addShapeAction: (shape) => {
    const { doc, history } = get();
    history.execute(addShapeCommand(doc, shape));
    set((s) => ({ selection: [shape.id], version: s.version + 1 }));
  },

  previewUpdate: (shape) => {
    replaceShape(get().doc, shape);
    set((s) => ({ version: s.version + 1 }));
  },

  commitTransform: (before) => {
    const { doc, history } = get();
    const cmds = before
      .map((b): Command | null => {
        const after = findShape(doc, b.id);
        return after ? updateShapeCommand(doc, b, after) : null;
      })
      .filter((c): c is Command => c !== null);
    if (cmds.length > 0) history.record(composite('Transform', cmds));
  },

  applyUpdates: (before, after) => {
    const { doc, history } = get();
    history.execute(composite('Modify', before.map((b, i) => updateShapeCommand(doc, b, after[i]))));
    set((s) => ({ version: s.version + 1 }));
  },

  deleteSelection: () => {
    const { doc, history, selection } = get();
    if (selection.length === 0) return;
    history.execute(composite('Delete', selection.map((id) => removeShapeCommand(doc, id))));
    set((s) => ({ selection: [], version: s.version + 1 }));
  },

  selectedShapes: () => {
    const { doc, selection } = get();
    return selection.map((id) => findShape(doc, id)).filter((s): s is Shape => s !== undefined);
  },

  booleanAction: async (mode) => {
    const shapes = get().selectedShapes();
    if (shapes.length < 2) return;
    const { booleanShapes } = await import('./boolean');
    const result = await booleanShapes(mode, shapes, shapes[0].layerId);
    const { doc, history } = get();
    history.execute(
      composite('Boolean', [
        ...shapes.map((s) => removeShapeCommand(doc, s.id)),
        addShapeCommand(doc, result),
      ]),
    );
    set((s) => ({ selection: [result.id], version: s.version + 1 }));
  },

  addLayerAction: () => {
    const { doc, history } = get();
    const layer = createLayer(undefined, doc.layers.length);
    history.execute(addLayerCommand(doc, layer));
    set((s) => ({ activeLayerId: layer.id, version: s.version + 1 }));
  },

  updateLayer: (id, patch) => {
    const { doc, history } = get();
    history.execute(updateLayerCommand(doc, id, patch));
    set((s) => ({ version: s.version + 1 }));
  },

  setLayerCutSettings: (id, patch) => {
    set((s) => ({
      cutSettingsByLayer: {
        ...s.cutSettingsByLayer,
        [id]: { ...(s.cutSettingsByLayer[id] ?? defaultCutSettings()), ...patch },
      },
      version: s.version + 1,
    }));
  },

  loadLibrary: async () => {
    try {
      const { MaterialStore } = await import('fileformats');
      let lib = await (await MaterialStore.open()).load();
      if (lib.presets.length === 0) {
        lib = starterLibrary();
        await persistLibrary(lib);
      }
      set((s) => ({ library: lib, version: s.version + 1 }));
    } catch {
      // OPFS unavailable (tests / unsupported browser): keep the in-memory
      // starter library seeded at store init.
    }
  },

  applyMaterial: (id, presetId) => {
    const preset = getPreset(get().library, presetId);
    if (preset) get().setLayerCutSettings(id, preset.settings);
  },

  saveLayerAsPreset: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const settings = get().cutSettingsByLayer[id] ?? defaultCutSettings();
    const uuid = globalThis.crypto?.randomUUID?.();
    const presetId = uuid ?? `preset-${get().library.presets.length + 1}-${settings.mode}`;
    const library = addPreset(get().library, createPreset(presetId, trimmed, { ...settings }));
    set((s) => ({ library, version: s.version + 1 }));
    await persistLibrary(library);
  },

  removeMaterial: async (presetId) => {
    const library = removePreset(get().library, presetId);
    set((s) => ({ library, version: s.version + 1 }));
    await persistLibrary(library);
  },

  importLibrary: async (json) => {
    const incoming = deserializeLibrary(json);
    let library = get().library;
    for (const preset of incoming.presets) library = addPreset(library, preset);
    set((s) => ({ library, version: s.version + 1 }));
    await persistLibrary(library);
  },

  exportLibrary: () => {
    const blob = new Blob([serializeLibrary(get().library)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluence-materials.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  generateGcode: async () => {
    if (get().gcodeBusy) return;
    const { doc, cutSettingsByLayer, machine, version } = get();
    set({ gcodeBusy: true });
    const { createCamClient } = await import('../cam/cam-client');
    const client = createCamClient();
    try {
      const { gcode, simulation } = await client.api.generate(doc, cutSettingsByLayer, machine);
      set({ gcode: { text: gcode, sim: simulation, version }, showGcodePreview: true });
    } finally {
      client.terminate();
      set({ gcodeBusy: false });
    }
  },

  saveGcode: async () => {
    const { gcode } = get();
    if (!gcode) return;
    const blob = new Blob([gcode.text], { type: 'text/plain' });
    const picker = (
      globalThis as unknown as {
        showSaveFilePicker?: (opts: unknown) => Promise<{
          createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
        }>;
      }
    ).showSaveFilePicker;
    if (typeof picker === 'function') {
      const handle = await picker({
        suggestedName: 'fluence.gcode',
        types: [{ description: 'G-code', accept: { 'text/plain': ['.gcode', '.nc'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fluence.gcode';
      a.click();
      URL.revokeObjectURL(url);
    }
  },

  toggleGcodePreview: () => set((s) => ({ showGcodePreview: !s.showGcodePreview })),

  loadDocument: (doc) =>
    set((s) => ({
      doc,
      history: new History(),
      selection: [],
      activeLayerId: doc.layers[0].id,
      cutSettingsByLayer: {},
      gcode: null,
      version: s.version + 1,
    })),

  saveProject: async () => {
    const { ProjectStore, serializeFluence } = await import('fileformats');
    const store = await ProjectStore.open();
    await store.save('current', 'Untitled', serializeFluence(get().doc));
  },

  openProject: async () => {
    const { ProjectStore, deserializeFluence } = await import('fileformats');
    const store = await ProjectStore.open();
    const loaded = await store.load('current');
    if (!loaded) return;
    get().loadDocument(deserializeFluence(loaded.bytes).document);
  },

  undo: () => {
    if (get().history.undo()) set((s) => ({ selection: [], version: s.version + 1 }));
  },
  redo: () => {
    if (get().history.redo()) set((s) => ({ selection: [], version: s.version + 1 }));
  },
  canUndo: () => get().history.canUndo(),
  canRedo: () => get().history.canRedo(),
}));
