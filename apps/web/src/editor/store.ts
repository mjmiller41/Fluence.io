import { create } from 'zustand';
import type { BooleanMode } from './boolean';
import {
  addArtItem,
  addLayerCommand,
  addShapeCommand,
  type ArtLibrary,
  type Command,
  composite,
  createDocument,
  createImage,
  createLayer,
  deleteNode,
  type Document,
  documentBounds,
  emptyArtLibrary,
  findShape,
  getArtItem,
  History,
  insertNode,
  type Layer,
  type LayerId,
  type NodeRef,
  type PathShape,
  reassignIds,
  removeArtItem,
  removeShapeCommand,
  replaceShape,
  setSegmentType,
  setSubpathClosed,
  type Shape,
  shapeBounds,
  type ShapeId,
  toEditablePath,
  translatedShape,
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
import type { MachineConfig, MachineOrigin, Simulation } from 'fileformats';
import type { Bounds, DeviceStatus, Vec3 } from 'device-core';
import type { ConsoleEntry } from 'protocols';
import { createSimController, type MachineController } from '../device/controller';

export type Tool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'node';

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

/** Persist the art library to OPFS (best-effort, same rationale as the material library). */
async function persistArt(lib: ArtLibrary): Promise<void> {
  try {
    const { ArtStore } = await import('fileformats');
    await (await ArtStore.open()).save(lib);
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
  /** Shape currently open in the node editor (M1-T03), or null. Always a path. */
  nodeEditId: ShapeId | null;
  /** The node selected within the node editor, addressed within the edited path. */
  nodeSel: NodeRef | null;
  /** Bumped whenever the (mutable) document changes so views re-render/redraw. */
  version: number;

  /** Per-layer cut settings (CAM). Missing layers fall back to defaults. */
  cutSettingsByLayer: Record<LayerId, CutSettings>;
  machine: MachineConfig;
  /** Machine home corner for coordinate mapping (M2-T07). */
  machineOrigin: MachineOrigin;
  gcode: GcodeResult | null;
  gcodeBusy: boolean;
  showGcodePreview: boolean;
  /** Material preset library (M2-T04). Persisted to OPFS. */
  library: MaterialLibrary;
  /** Art library (M2-T06): reusable shape fragments. Persisted to OPFS. */
  artLibrary: ArtLibrary;

  setTool(tool: Tool): void;
  select(ids: ShapeId[]): void;
  selectAll(): void;
  setActiveLayer(id: LayerId): void;

  addShapeAction(shape: Shape): void;
  /** Add many shapes as one undoable step (e.g. an imported or generated set). */
  insertShapes(shapes: Shape[]): void;
  /** Live mutation during a drag (no history entry). */
  previewUpdate(shape: Shape): void;
  /** Commit a completed drag as one undo step given the pre-drag shapes. */
  commitTransform(before: Shape[]): void;
  /** Apply + record a set of shape updates (align/distribute/node edits). */
  applyUpdates(before: Shape[], after: Shape[]): void;
  deleteSelection(): void;
  selectedShapes(): Shape[];
  booleanAction(mode: BooleanMode): Promise<void>;

  /** Enter node-edit on the first selected shape, converting it to a path if needed. */
  enterNodeEdit(): void;
  exitNodeEdit(): void;
  setNodeSel(ref: NodeRef | null): void;
  /** The path currently under the node editor, or null. */
  nodeEditPath(): PathShape | null;
  deleteNodeAction(ref: NodeRef): void;
  insertNodeAction(subpath: number, segmentIndex: number, t?: number): void;
  /** Flip the segment leaving/at the given edge between line and curve. */
  toggleSegmentType(subpath: number, segmentIndex: number): void;
  toggleSubpathClosed(subpath: number): void;

  addLayerAction(): void;
  updateLayer(id: LayerId, patch: Partial<Omit<Layer, 'id'>>): void;

  setMachineOrigin(origin: MachineOrigin): void;
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

  /** Load the art library from OPFS. */
  loadArt(): Promise<void>;
  /** Store the current selection as a reusable art item (deep-copied, persisted). */
  saveSelectionAsArt(name: string, category: string): Promise<void>;
  /** Insert an art item's shapes into the document with fresh ids (undoable). */
  insertArt(itemId: string): void;
  removeArt(itemId: string): Promise<void>;

  /** Build CAM job -> G-code -> simulation in the CAM worker (off main thread). */
  generateGcode(): Promise<void>;
  /** Save the last generated G-code to disk (File System Access, download fallback). */
  saveGcode(): Promise<void>;
  toggleGcodePreview(): void;

  loadDocument(doc: Document): void;
  /** Merge a parsed document's layers + shapes into the current doc (undoable). */
  importDocument(imported: Document): void;
  /** Import a file by name + contents (string for SVG/DXF, bytes for PNG/JPEG); throws if unsupported. */
  importFile(name: string, data: string | Uint8Array): Promise<void>;
  /** Bake `text` in the given font to vector paths and insert it, centred (undoable). */
  addText(
    text: string,
    fontBytes: ArrayBuffer | Uint8Array,
    opts: { size: number; letterSpacing?: number; lineHeight?: number },
  ): Promise<void>;
  saveProject(): Promise<void>;
  openProject(): Promise<void>;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // --- Machine control (device) ---
  /** The active machine controller (Simulator or GRBL worker), or null. */
  machineCtl: MachineController | null;
  connectionKind: 'sim' | 'grbl' | null;
  /** A connect/disconnect is in progress. */
  machineBusy: boolean;
  machineStatus: DeviceStatus | null;
  deviceConsole: ConsoleEntry[];
  jobRunning: boolean;

  /** Connect via the Simulator, or a GRBL board over Web Serial (worker). */
  connectMachine(kind: 'sim' | 'grbl', profileId?: string): Promise<void>;
  /** Attach an already-built controller (used by connectMachine and tests). */
  connectWith(controller: MachineController, kind: 'sim' | 'grbl'): Promise<void>;
  disconnectMachine(): Promise<void>;
  /** Stream the last-generated G-code to the machine (progress via status). */
  runJob(): Promise<void>;
  holdJob(): Promise<void>;
  resumeJob(): Promise<void>;
  stopJob(): Promise<void>;
  jogMachine(delta: Vec3, feed: number): Promise<void>;
  frameJob(opts?: { power?: number }): Promise<void>;
  homeMachine(): Promise<void>;
  setWorkOrigin(): Promise<void>;
  sendConsole(text: string): Promise<void>;
  clearConsole(): void;
}

/** Console cap + the current connection's status/console unsubscribers. */
const MAX_CONSOLE = 500;
let machineUnsubs: Array<() => void> = [];

const initialDoc = createDocument();

export const useEditor = create<EditorState>((set, get) => ({
  doc: initialDoc,
  history: new History(),
  selection: [],
  activeLayerId: initialDoc.layers[0].id,
  tool: 'select',
  nodeEditId: null,
  nodeSel: null,
  version: 0,

  cutSettingsByLayer: {},
  machine: DEFAULT_MACHINE,
  machineOrigin: 'front-left',
  gcode: null,
  gcodeBusy: false,
  showGcodePreview: true,
  library: starterLibrary(),
  artLibrary: emptyArtLibrary(),

  machineCtl: null,
  connectionKind: null,
  machineBusy: false,
  machineStatus: null,
  deviceConsole: [],
  jobRunning: false,

  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: ids }),
  selectAll: () => set((s) => ({ selection: s.doc.shapes.map((sh) => sh.id) })),
  setActiveLayer: (id) => set({ activeLayerId: id }),

  addShapeAction: (shape) => {
    const { doc, history } = get();
    history.execute(addShapeCommand(doc, shape));
    set((s) => ({ selection: [shape.id], version: s.version + 1 }));
  },

  insertShapes: (shapes) => {
    if (shapes.length === 0) return;
    const { doc, history } = get();
    history.execute(composite('Insert', shapes.map((sh) => addShapeCommand(doc, sh))));
    set((s) => ({ selection: shapes.map((sh) => sh.id), version: s.version + 1 }));
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

  enterNodeEdit: () => {
    const shape = get().selectedShapes()[0];
    if (!shape || shape.kind === 'group') return;
    if (shape.kind !== 'path') {
      const path = toEditablePath(shape);
      if (!path) return;
      get().applyUpdates([shape], [path]);
    }
    set({ tool: 'node', nodeEditId: shape.id, nodeSel: null, selection: [shape.id] });
  },

  exitNodeEdit: () => set({ tool: 'select', nodeEditId: null, nodeSel: null }),

  setNodeSel: (ref) => set({ nodeSel: ref }),

  nodeEditPath: () => {
    const id = get().nodeEditId;
    if (!id) return null;
    const shape = findShape(get().doc, id);
    return shape && shape.kind === 'path' ? shape : null;
  },

  deleteNodeAction: (ref) => {
    const before = get().nodeEditPath();
    if (!before) return;
    get().applyUpdates([before], [deleteNode(before, ref)]);
    set({ nodeSel: null });
  },

  insertNodeAction: (subpath, segmentIndex, t) => {
    const before = get().nodeEditPath();
    if (!before) return;
    get().applyUpdates([before], [insertNode(before, subpath, segmentIndex, t)]);
  },

  toggleSegmentType: (subpath, segmentIndex) => {
    const before = get().nodeEditPath();
    if (!before) return;
    const cur = before.subpaths[subpath]?.segments[segmentIndex];
    if (!cur) return;
    const next = setSegmentType(before, subpath, segmentIndex, cur.type === 'cubic' ? 'line' : 'cubic');
    get().applyUpdates([before], [next]);
  },

  toggleSubpathClosed: (subpath) => {
    const before = get().nodeEditPath();
    if (!before) return;
    const sp = before.subpaths[subpath];
    if (!sp) return;
    get().applyUpdates([before], [setSubpathClosed(before, subpath, !sp.closed)]);
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

  setMachineOrigin: (origin) => set((s) => ({ machineOrigin: origin, version: s.version + 1 })),

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
    a.download = 'laserkerf-materials.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  loadArt: async () => {
    try {
      const { ArtStore } = await import('fileformats');
      const lib = await (await ArtStore.open()).load();
      set((s) => ({ artLibrary: lib, version: s.version + 1 }));
    } catch {
      // OPFS unavailable (tests / unsupported browser): keep the empty library.
    }
  },

  saveSelectionAsArt: async (name, category) => {
    const trimmedName = name.trim();
    const shapes = get().selectedShapes();
    if (!trimmedName || shapes.length === 0) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `art-${get().artLibrary.items.length + 1}`;
    const artLibrary = addArtItem(get().artLibrary, {
      id,
      name: trimmedName,
      category: category.trim() || 'Uncategorized',
      shapes: reassignIds(shapes),
    });
    set((s) => ({ artLibrary, version: s.version + 1 }));
    await persistArt(artLibrary);
  },

  insertArt: (itemId) => {
    const item = getArtItem(get().artLibrary, itemId);
    if (item) get().insertShapes(reassignIds(item.shapes));
  },

  removeArt: async (itemId) => {
    const artLibrary = removeArtItem(get().artLibrary, itemId);
    set((s) => ({ artLibrary, version: s.version + 1 }));
    await persistArt(artLibrary);
  },

  generateGcode: async () => {
    if (get().gcodeBusy) return;
    const { doc, cutSettingsByLayer, machine, machineOrigin, version } = get();
    set({ gcodeBusy: true });
    const { createCamClient } = await import('../cam/cam-client');
    const client = createCamClient();
    try {
      const { gcode, simulation } = await client.api.generate(
        doc,
        cutSettingsByLayer,
        machine,
        machineOrigin,
      );
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
        suggestedName: 'laserkerf.gcode',
        types: [{ description: 'G-code', accept: { 'text/plain': ['.gcode', '.nc'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'laserkerf.gcode';
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
      tool: 'select',
      nodeEditId: null,
      nodeSel: null,
      cutSettingsByLayer: {},
      gcode: null,
      version: s.version + 1,
    })),

  importDocument: (imported) => {
    if (imported.shapes.length === 0) return;
    const { doc, history } = get();
    const cmds: Command[] = [
      ...imported.layers.map((l) => addLayerCommand(doc, l)),
      ...imported.shapes.map((s) => addShapeCommand(doc, s)),
    ];
    history.execute(composite('Import', cmds));
    set((s) => ({ selection: imported.shapes.map((sh) => sh.id), version: s.version + 1 }));
  },

  importFile: async (name, data) => {
    const lower = name.toLowerCase();
    const isVector =
      lower.endsWith('.svg') || lower.endsWith('.dxf') || lower.endsWith('.lbrn') || lower.endsWith('.lbrn2');
    if (isVector) {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const { importSvg, importDxf, importLbrn } = await import('fileformats');
      if (lower.endsWith('.svg')) get().importDocument(importSvg(text));
      else if (lower.endsWith('.dxf')) get().importDocument(importDxf(text).document);
      else get().importDocument(importLbrn(text).document);
      return;
    }
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const { imageInfo, physicalSizeMm, dataUrl, mimeForName } = await import('fileformats');
      const info = imageInfo(bytes);
      const { widthMm, heightMm } = physicalSizeMm(info);
      const { doc, activeLayerId } = get();
      const at = { x: doc.width / 2 - widthMm / 2, y: doc.height / 2 - heightMm / 2 };
      const img = createImage(dataUrl(bytes, mimeForName(name)), info.width, info.height, widthMm, heightMm, {
        layerId: activeLayerId,
        at,
      });
      get().insertShapes([img]);
      return;
    }
    if (lower.endsWith('.ai') || lower.endsWith('.pdf')) {
      throw new Error('AI/PDF import is not supported yet (tracked as M1-T08b).');
    }
    throw new Error(`Unsupported file type: ${name}`);
  },

  addText: async (text, fontBytes, opts) => {
    if (!text.trim()) return;
    const { parseFont, textToPathShape } = await import('fileformats');
    const font = parseFont(fontBytes);
    const baked = textToPathShape(font, text, opts, { layerId: get().activeLayerId });
    const b = shapeBounds(baked);
    const { doc } = get();
    const shape = b
      ? translatedShape(baked, doc.width / 2 - (b.x + b.width / 2), doc.height / 2 - (b.y + b.height / 2))
      : baked;
    get().insertShapes([shape]);
  },

  saveProject: async () => {
    const { ProjectStore, serializeLaserKerf } = await import('fileformats');
    const store = await ProjectStore.open();
    await store.save('current', 'Untitled', serializeLaserKerf(get().doc));
  },

  openProject: async () => {
    const { ProjectStore, deserializeLaserKerf } = await import('fileformats');
    const store = await ProjectStore.open();
    const loaded = await store.load('current');
    if (!loaded) return;
    get().loadDocument(deserializeLaserKerf(loaded.bytes).document);
  },

  connectWith: async (controller, kind) => {
    await get().disconnectMachine();
    set({ machineBusy: true });
    try {
      machineUnsubs = [
        controller.onStatus((s) => set({ machineStatus: s })),
        controller.onConsole((e) =>
          set((st) => ({ deviceConsole: [...st.deviceConsole, e].slice(-MAX_CONSOLE) })),
        ),
      ];
      await controller.connect();
      set({ machineCtl: controller, connectionKind: kind, machineStatus: controller.status() });
    } catch (err) {
      machineUnsubs.forEach((f) => f());
      machineUnsubs = [];
      set({ machineCtl: null, connectionKind: null });
      throw err;
    } finally {
      set({ machineBusy: false });
    }
  },

  connectMachine: async (kind, profileId) => {
    if (kind === 'sim') {
      await get().connectWith(createSimController(), 'sim');
      return;
    }
    const { connectGrbl } = await import('../device/worker-controller');
    await get().connectWith(await connectGrbl(profileId), 'grbl');
  },

  disconnectMachine: async () => {
    const ctl = get().machineCtl;
    machineUnsubs.forEach((f) => f());
    machineUnsubs = [];
    set({ machineCtl: null, connectionKind: null, machineStatus: null, jobRunning: false });
    if (ctl) await ctl.disconnect();
  },

  runJob: async () => {
    const { machineCtl, gcode, jobRunning } = get();
    if (!machineCtl || !gcode || jobRunning) return;
    const lines = gcode.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    set({ jobRunning: true });
    try {
      await machineCtl.stream(lines).done;
    } finally {
      set({ jobRunning: false });
    }
  },

  holdJob: async () => {
    await get().machineCtl?.hold();
  },
  resumeJob: async () => {
    await get().machineCtl?.resume();
  },
  stopJob: async () => {
    await get().machineCtl?.stop();
  },

  jogMachine: async (delta, feed) => {
    if (!get().jobRunning) await get().machineCtl?.jog(delta, feed);
  },

  frameJob: async (opts) => {
    const { machineCtl, doc, jobRunning } = get();
    if (!machineCtl || jobRunning) return;
    const b = documentBounds(doc);
    if (!b) return;
    const bounds: Bounds = {
      min: { x: b.x, y: b.y },
      max: { x: b.x + b.width, y: b.y + b.height },
    };
    await machineCtl.frame(bounds, opts);
  },

  homeMachine: async () => {
    if (!get().jobRunning) await get().machineCtl?.home();
  },
  setWorkOrigin: async () => {
    if (!get().jobRunning) await get().machineCtl?.setWorkOrigin();
  },
  sendConsole: async (text) => {
    await get().machineCtl?.sendCommand(text);
  },
  clearConsole: () => set({ deviceConsole: [] }),

  undo: () => {
    if (get().history.undo()) set((s) => ({ selection: [], version: s.version + 1 }));
  },
  redo: () => {
    if (get().history.redo()) set((s) => ({ selection: [], version: s.version + 1 }));
  },
  canUndo: () => get().history.canUndo(),
  canRedo: () => get().history.canRedo(),
}));
