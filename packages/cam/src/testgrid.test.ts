import { describe, expect, it } from 'vitest';
import { shapeGeometry } from 'scene';
import { assertGolden } from 'golden';
import { lineToolpaths, serializeToolpaths } from './toolpath';
import {
  generateTestGrid,
  linspace,
  strokePolylines,
  type TestGridSpec,
  testGridOperations,
  testGridShapes,
} from './testgrid';

const spec: TestGridSpec = {
  columns: 3,
  rows: 2,
  cellSize: 10,
  spacing: 4,
  xParam: 'maxPower',
  yParam: 'speed',
  xValues: [20, 60, 100],
  yValues: [1000, 3000],
};

describe('linspace', () => {
  it('spreads n values inclusive of both ends', () => {
    expect(linspace(0, 100, 3)).toEqual([0, 50, 100]);
    expect(linspace(5, 5, 1)).toEqual([5]);
    expect(linspace(0, 10, 6)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

describe('generateTestGrid', () => {
  it('creates one cell per combination with the swept params applied', () => {
    const grid = generateTestGrid(spec);
    expect(grid.cells).toHaveLength(6);

    const first = grid.cells.find((c) => c.col === 0 && c.row === 0)!;
    expect(first.settings.maxPower).toBe(20);
    expect(first.settings.speed).toBe(1000);

    const last = grid.cells.find((c) => c.col === 2 && c.row === 1)!;
    expect(last.settings.maxPower).toBe(100);
    expect(last.settings.speed).toBe(3000);
  });

  it('labels each column and row with its value', () => {
    const grid = generateTestGrid(spec);
    const texts = grid.labels.map((l) => l.text);
    expect(texts).toContain('20');
    expect(texts).toContain('100');
    expect(texts).toContain('1000');
    expect(texts).toContain('3000');
    // 3 column labels + 2 row labels
    expect(grid.labels).toHaveLength(5);
  });

  it('omits labels when showLabels is false', () => {
    expect(generateTestGrid({ ...spec, showLabels: false }).labels).toHaveLength(0);
  });
});

describe('strokePolylines', () => {
  it('renders known glyphs and skips unknown characters', () => {
    expect(strokePolylines('1', { x: 0, y: 0 }, 4)).toHaveLength(2); // segments b + c
    expect(strokePolylines('8', { x: 0, y: 0 }, 4)).toHaveLength(7); // all 7 segments
    expect(strokePolylines(' ', { x: 0, y: 0 }, 4)).toHaveLength(0);
  });
});

describe('testGridOperations', () => {
  it('emits one op per cell plus a label engrave op, each with its settings', () => {
    const grid = generateTestGrid(spec);
    const ops = testGridOperations(grid);
    expect(ops).toHaveLength(6 + 1); // cells + labels
    expect(ops[0].settings.maxPower).toBe(20);
    expect(ops.every((o) => o.toolpaths.length > 0)).toBe(true);
  });
});

describe('test grid geometry (golden)', () => {
  it('3x2 grid shapes match the committed fixture', () => {
    const grid = generateTestGrid(spec);
    const toolpaths = testGridShapes(grid, 'l').flatMap((s) => lineToolpaths(shapeGeometry(s)));
    return assertGolden(
      new URL('./__golden__/testgrid-3x2.txt', import.meta.url),
      serializeToolpaths(toolpaths),
    );
  });
});
