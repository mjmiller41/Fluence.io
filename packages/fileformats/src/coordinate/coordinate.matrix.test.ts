import { describe, expect, it } from 'vitest';
import {
  type Anchor,
  anchorPoint,
  type MachineOrigin,
  type Pt,
  toJobOrigin,
  toMachineMm,
  toMm,
  type Workspace,
} from './coordinate';

const bed = { widthMm: 400, heightMm: 300 };

describe('coordinate/units matrix', () => {
  it('converts mm and inch to mm', () => {
    expect(toMm(10, 'mm')).toBe(10);
    expect(toMm(1, 'inch')).toBeCloseTo(25.4, 6);
  });

  // units x design-origin (machine origin defaults to front-left).
  const baseCases: Array<{ ws: Workspace; input: Pt; expected: Pt }> = [
    { ws: { units: 'mm', origin: 'bottom-left', bed }, input: { x: 10, y: 20 }, expected: { x: 10, y: 20 } },
    { ws: { units: 'mm', origin: 'top-left', bed }, input: { x: 10, y: 20 }, expected: { x: 10, y: 280 } },
    { ws: { units: 'inch', origin: 'bottom-left', bed }, input: { x: 1, y: 2 }, expected: { x: 25.4, y: 50.8 } },
    { ws: { units: 'inch', origin: 'top-left', bed }, input: { x: 1, y: 2 }, expected: { x: 25.4, y: 249.2 } },
  ];

  for (const c of baseCases) {
    it(`${c.ws.units} / ${c.ws.origin}`, () => {
      const m = toMachineMm(c.input, c.ws);
      expect(m.x).toBeCloseTo(c.expected.x, 6);
      expect(m.y).toBeCloseTo(c.expected.y, 6);
    });
  }

  // Full machine-origin matrix (mm, design bottom-left, input (10,20)).
  const originCases: Array<{ mo: MachineOrigin; expected: Pt }> = [
    { mo: 'front-left', expected: { x: 10, y: 20 } },
    { mo: 'front-right', expected: { x: 390, y: 20 } },
    { mo: 'back-left', expected: { x: 10, y: 280 } },
    { mo: 'back-right', expected: { x: 390, y: 280 } },
    { mo: 'center', expected: { x: -190, y: -130 } },
  ];

  for (const c of originCases) {
    it(`machine origin ${c.mo}`, () => {
      const m = toMachineMm({ x: 10, y: 20 }, { units: 'mm', origin: 'bottom-left', bed, machineOrigin: c.mo });
      expect(m.x).toBeCloseTo(c.expected.x, 6);
      expect(m.y).toBeCloseTo(c.expected.y, 6);
    });
  }

  it('composes inch + top-left design + back-right machine origin', () => {
    // (1,2) in -> (25.4, 50.8) mm; top-left => yUp = 300-50.8 = 249.2;
    // back-right => x = 400-25.4 = 374.6, y = 300-249.2 = 50.8.
    const m = toMachineMm({ x: 1, y: 2 }, { units: 'inch', origin: 'top-left', bed, machineOrigin: 'back-right' });
    expect(m.x).toBeCloseTo(374.6, 6);
    expect(m.y).toBeCloseTo(50.8, 6);
  });
});

describe('job-origin anchors', () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };
  const expected: Record<Anchor, Pt> = {
    'bottom-left': { x: 0, y: 0 },
    'bottom-center': { x: 50, y: 0 },
    'bottom-right': { x: 100, y: 0 },
    'center-left': { x: 0, y: 30 },
    center: { x: 50, y: 30 },
    'center-right': { x: 100, y: 30 },
    'top-left': { x: 0, y: 60 },
    'top-center': { x: 50, y: 60 },
    'top-right': { x: 100, y: 60 },
  };

  for (const anchor of Object.keys(expected) as Anchor[]) {
    it(`anchorPoint ${anchor}`, () => {
      expect(anchorPoint(box, anchor)).toEqual(expected[anchor]);
    });
  }

  it('toJobOrigin re-origins a point to the chosen anchor', () => {
    const bounds = { x: 10, y: 10, width: 100, height: 60 };
    expect(toJobOrigin({ x: 10, y: 10 }, bounds, 'bottom-left')).toEqual({ x: 0, y: 0 });
    expect(toJobOrigin({ x: 10, y: 10 }, bounds, 'center')).toEqual({ x: -50, y: -30 });
    expect(toJobOrigin({ x: 10, y: 10 }, bounds, 'top-right')).toEqual({ x: -100, y: -60 });
  });
});
