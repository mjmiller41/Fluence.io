import { create } from 'zustand';
import type { BooleanMode } from './boolean';
import {
  addShape,
  createDocument,
  type Document,
  findShape,
  removeShape,
  replaceShape,
  type Shape,
  type ShapeId,
} from 'scene';

export type Tool = 'select' | 'rect' | 'ellipse' | 'polygon';

export interface EditorState {
  doc: Document;
  selection: ShapeId[];
  tool: Tool;
  /** Bumped whenever the (mutable) document changes so views re-render/redraw. */
  version: number;

  setTool(tool: Tool): void;
  select(ids: ShapeId[]): void;
  selectAll(): void;
  addShapeAction(shape: Shape): void;
  updateShape(shape: Shape): void;
  deleteSelection(): void;
  selectedShapes(): Shape[];
  booleanAction(mode: BooleanMode): Promise<void>;
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: createDocument(),
  selection: [],
  tool: 'select',
  version: 0,

  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: ids }),
  selectAll: () => set((s) => ({ selection: s.doc.shapes.map((sh) => sh.id) })),

  addShapeAction: (shape) => {
    const { doc } = get();
    addShape(doc, shape);
    set((s) => ({ selection: [shape.id], version: s.version + 1 }));
  },

  updateShape: (shape) => {
    const { doc } = get();
    replaceShape(doc, shape);
    set((s) => ({ version: s.version + 1 }));
  },

  deleteSelection: () => {
    const { doc, selection } = get();
    for (const id of selection) removeShape(doc, id);
    set((s) => ({ selection: [], version: s.version + 1 }));
  },

  selectedShapes: () => {
    const { doc, selection } = get();
    return selection
      .map((id) => findShape(doc, id))
      .filter((s): s is Shape => s !== undefined);
  },

  booleanAction: async (mode) => {
    const shapes = get().selectedShapes();
    if (shapes.length < 2) return;
    // Lazy import keeps the Clipper2 WASM out of the initial bundle.
    const { booleanShapes } = await import('./boolean');
    const result = await booleanShapes(mode, shapes, shapes[0].layerId);
    const { doc } = get();
    for (const s of shapes) removeShape(doc, s.id);
    addShape(doc, result);
    set((s) => ({ selection: [result.id], version: s.version + 1 }));
  },
}));
