import type { Vec2 } from '../geom/vec';

export interface SnapConfig {
  /** Grid spacing in mm; omit or 0 to disable grid snapping. */
  gridSize?: number;
  /** Snap distance in mm (typically screen pixels converted to document units). */
  threshold: number;
  /** Candidate snap points (object key points, guide intersections). */
  points?: readonly Vec2[];
}

export interface SnapResult {
  point: Vec2;
  snappedX: boolean;
  snappedY: boolean;
}

interface AxisSnap {
  value: number;
  snapped: boolean;
}

function snapAxis(value: number, config: SnapConfig, pick: (p: Vec2) => number): AxisSnap {
  let best = value;
  let bestDist = config.threshold;
  let snapped = false;

  if (config.gridSize && config.gridSize > 0) {
    const gridValue = Math.round(value / config.gridSize) * config.gridSize;
    const dist = Math.abs(gridValue - value);
    if (dist <= bestDist) {
      best = gridValue;
      bestDist = dist;
      snapped = true;
    }
  }

  for (const p of config.points ?? []) {
    const candidate = pick(p);
    const dist = Math.abs(candidate - value);
    if (dist <= bestDist) {
      best = candidate;
      bestDist = dist;
      snapped = true;
    }
  }

  return { value: best, snapped };
}

/** Snap a point to the grid and/or nearby candidate points, per axis independently. */
export function snapPoint(point: Vec2, config: SnapConfig): SnapResult {
  const sx = snapAxis(point.x, config, (p) => p.x);
  const sy = snapAxis(point.y, config, (p) => p.y);
  return { point: { x: sx.value, y: sy.value }, snappedX: sx.snapped, snappedY: sy.snapped };
}

export const MM_PER_INCH = 25.4;
export const toMm = (value: number, units: 'mm' | 'inch'): number =>
  units === 'inch' ? value * MM_PER_INCH : value;
export const fromMm = (mm: number, units: 'mm' | 'inch'): number =>
  units === 'inch' ? mm / MM_PER_INCH : mm;
