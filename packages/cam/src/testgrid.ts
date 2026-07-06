import {
  createPath,
  createRect,
  type Rect,
  type Shape,
  shapeGeometry,
  subpathFromPoints,
  type Vec2,
} from 'scene';
import { type CutSettings, defaultCutSettings } from './settings';
import { lineToolpaths, type Toolpath } from './toolpath';

/**
 * Material test grid (M2-T05): a parametric grid where two cut parameters vary
 * across the X and Y axes, one square per combination, with numeric axis labels
 * rendered from a self-contained stroke font. Pure and deterministic (golden
 * geometry). Generic — no vendor presets or artwork copied.
 */

/** Cut-setting keys the grid can sweep (numeric only). */
export type NumericCutKey = 'speed' | 'minPower' | 'maxPower' | 'passes' | 'interval' | 'angle';

export interface TestGridSpec {
  columns: number;
  rows: number;
  /** Square edge length (mm). Default 10. */
  cellSize?: number;
  /** Gap between squares (mm). Default 4. */
  spacing?: number;
  xParam: NumericCutKey;
  yParam: NumericCutKey;
  /** One value per column / row (length must equal columns / rows). */
  xValues: number[];
  yValues: number[];
  /** Base settings each cell is derived from. Default `defaultCutSettings()`. */
  base?: CutSettings;
  /** Label text height (mm). Default cellSize * 0.35. */
  labelSize?: number;
  /** Emit axis labels. Default true. */
  showLabels?: boolean;
}

export interface TestCell {
  col: number;
  row: number;
  bounds: Rect;
  settings: CutSettings;
}

export interface TestLabel {
  text: string;
  /** Bottom-left of the label. */
  at: Vec2;
  size: number;
}

export interface TestGrid {
  cells: TestCell[];
  labels: TestLabel[];
  bounds: Rect;
}

/** `n` evenly-spaced values from min to max inclusive (n>=1). */
export function linspace(min: number, max: number, n: number): number[] {
  if (n <= 1) return [min];
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

/** Compact numeric label: trims trailing zeros (100, 12.5, 0.1). */
function fmtLabel(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))
    .replace(/^-0$/, '0');
}

// --- 7-segment stroke font (digits, '-', '.') on a 2-wide x 4-tall glyph box ---
const A: Vec2 = { x: 0, y: 4 };
const B: Vec2 = { x: 2, y: 4 };
const C: Vec2 = { x: 0, y: 2 };
const D: Vec2 = { x: 2, y: 2 };
const E: Vec2 = { x: 0, y: 0 };
const F: Vec2 = { x: 2, y: 0 };
const seg = { a: [A, B], b: [B, D], c: [D, F], d: [E, F], e: [C, E], f: [A, C], g: [C, D] };
const GLYPHS: Record<string, Vec2[][]> = {
  '0': [seg.a, seg.b, seg.c, seg.d, seg.e, seg.f],
  '1': [seg.b, seg.c],
  '2': [seg.a, seg.b, seg.g, seg.e, seg.d],
  '3': [seg.a, seg.b, seg.g, seg.c, seg.d],
  '4': [seg.f, seg.g, seg.b, seg.c],
  '5': [seg.a, seg.f, seg.g, seg.c, seg.d],
  '6': [seg.a, seg.f, seg.g, seg.e, seg.c, seg.d],
  '7': [seg.a, seg.b, seg.c],
  '8': [seg.a, seg.b, seg.c, seg.d, seg.e, seg.f, seg.g],
  '9': [seg.a, seg.b, seg.c, seg.d, seg.f, seg.g],
  '-': [seg.g],
  '.': [
    [
      { x: 0.6, y: 0 },
      { x: 0.6, y: 0.4 },
    ],
  ],
};

const GLYPH_W = 2;
const GLYPH_H = 4;
const GLYPH_GAP = 1; // in glyph units

/** Stroke a numeric string into open polylines at `origin`, `size` mm tall. */
export function strokePolylines(text: string, origin: Vec2, size: number): Vec2[][] {
  const unit = size / GLYPH_H;
  const advance = (GLYPH_W + GLYPH_GAP) * unit;
  const out: Vec2[][] = [];
  let cursorX = origin.x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (const poly of glyph) {
        out.push(poly.map((p) => ({ x: cursorX + p.x * unit, y: origin.y + p.y * unit })));
      }
    }
    cursorX += advance;
  }
  return out;
}

/** Approximate rendered width (mm) of a label at `size`. */
function labelWidth(text: string, size: number): number {
  const unit = size / GLYPH_H;
  return text.length * (GLYPH_W + GLYPH_GAP) * unit - GLYPH_GAP * unit;
}

export function generateTestGrid(spec: TestGridSpec): TestGrid {
  const cellSize = spec.cellSize ?? 10;
  const spacing = spec.spacing ?? 4;
  const base = spec.base ?? defaultCutSettings();
  const labelSize = spec.labelSize ?? cellSize * 0.35;
  const showLabels = spec.showLabels ?? true;
  const step = cellSize + spacing;

  // Reserve a gutter on the left (row labels) and bottom (column labels).
  const gutter = showLabels ? cellSize * 0.6 + spacing : 0;
  const originX = gutter;
  const originY = gutter;

  const cells: TestCell[] = [];
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.columns; col++) {
      const bounds: Rect = {
        x: originX + col * step,
        y: originY + row * step,
        width: cellSize,
        height: cellSize,
      };
      const settings: CutSettings = { ...base };
      settings[spec.xParam] = spec.xValues[col];
      settings[spec.yParam] = spec.yValues[row];
      cells.push({ col, row, bounds, settings });
    }
  }

  const labels: TestLabel[] = [];
  if (showLabels) {
    // Column values along the bottom gutter, centred under each column.
    for (let col = 0; col < spec.columns; col++) {
      const text = fmtLabel(spec.xValues[col]);
      const cx = originX + col * step + cellSize / 2;
      labels.push({ text, at: { x: cx - labelWidth(text, labelSize) / 2, y: gutter - labelSize - 1 }, size: labelSize });
    }
    // Row values in the left gutter, at each row's vertical centre.
    for (let row = 0; row < spec.rows; row++) {
      const text = fmtLabel(spec.yValues[row]);
      const cy = originY + row * step + cellSize / 2;
      labels.push({ text, at: { x: 0, y: cy - labelSize / 2 }, size: labelSize });
    }
  }

  const width = originX + spec.columns * step - spacing;
  const height = originY + spec.rows * step - spacing;
  return { cells, labels, bounds: { x: 0, y: 0, width, height } };
}

/** Grid as scene shapes: a rect per cell plus a path per label. */
export function testGridShapes(grid: TestGrid, layerId: string): Shape[] {
  const shapes: Shape[] = grid.cells.map((cell) =>
    createRect(cell.bounds.width, cell.bounds.height, {
      layerId,
      at: { x: cell.bounds.x, y: cell.bounds.y },
    }),
  );
  for (const label of grid.labels) {
    const polylines = strokePolylines(label.text, label.at, label.size);
    if (polylines.length === 0) continue;
    shapes.push(createPath(polylines.map((pl) => subpathFromPoints(pl, false)), { layerId }));
  }
  return shapes;
}

export interface CamOperation {
  settings: CutSettings;
  toolpaths: Toolpath[];
}

/**
 * Grid as CAM operations: one operation per cell (its square outline cut with
 * that cell's settings), plus a final operation engraving all labels. This is
 * what makes a burned grid self-labeling and per-cell distinct.
 */
export function testGridOperations(grid: TestGrid, labelSettings?: CutSettings): CamOperation[] {
  const ops: CamOperation[] = grid.cells.map((cell) => ({
    settings: cell.settings,
    toolpaths: lineToolpaths(shapeGeometry(rectShape(cell.bounds))),
  }));
  const labelPaths: Toolpath[] = [];
  for (const label of grid.labels) {
    for (const pl of strokePolylines(label.text, label.at, label.size)) {
      labelPaths.push({ points: pl, closed: false });
    }
  }
  if (labelPaths.length > 0) {
    ops.push({
      settings: labelSettings ?? defaultCutSettings({ mode: 'line', speed: 3000, maxPower: 25 }),
      toolpaths: labelPaths,
    });
  }
  return ops;
}

function rectShape(b: Rect): Shape {
  return createRect(b.width, b.height, { layerId: '', at: { x: b.x, y: b.y } });
}
