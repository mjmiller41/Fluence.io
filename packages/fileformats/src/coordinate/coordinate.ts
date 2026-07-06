/**
 * Coordinate / units harness (development-plan §4.6). A class of bugs — mm vs
 * inch, job origin vs machine origin, workspace transforms — erodes trust fast,
 * so the transform lives behind one tested function. M0 nailed units + Y-origin;
 * M2-T07 completes the matrix: machine home corner (incl. centre datum) and the
 * 9-point job-origin anchor.
 */
export type Units = 'mm' | 'inch';

/** Design Y convention: where the design measures Y from. */
export type Origin = 'bottom-left' | 'top-left';

/** Machine home corner (sets axis directions), or a centred datum. */
export type MachineOrigin = 'front-left' | 'front-right' | 'back-left' | 'back-right' | 'center';

/** 9-point anchor on a design's bounding box (job origin). */
export type Anchor =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';

export interface Bed {
  widthMm: number;
  heightMm: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Workspace {
  units: Units;
  /** Design Y convention. */
  origin: Origin;
  bed: Bed;
  /** Machine home corner. Defaults to 'front-left' (GRBL convention). */
  machineOrigin?: MachineOrigin;
}

export const MM_PER_INCH = 25.4;

export function toMm(value: number, units: Units): number {
  return units === 'inch' ? value * MM_PER_INCH : value;
}

/**
 * Transform a design-space point (in `ws.units`, Y from `ws.origin`) to machine
 * millimetres for the configured machine home corner. GRBL's native frame is
 * front-left, Y-up; other corners flip the corresponding axis about the bed, and
 * 'center' places (0,0) at the bed centre.
 */
export function toMachineMm(p: Pt, ws: Workspace): Pt {
  const xmm = toMm(p.x, ws.units);
  const ymm = toMm(p.y, ws.units);
  // Normalise to bottom-left, Y-up on the bed first.
  const yUp = ws.origin === 'top-left' ? ws.bed.heightMm - ymm : ymm;
  const { widthMm: w, heightMm: h } = ws.bed;
  switch (ws.machineOrigin ?? 'front-left') {
    case 'front-left':
      return { x: xmm, y: yUp };
    case 'front-right':
      return { x: w - xmm, y: yUp };
    case 'back-left':
      return { x: xmm, y: h - yUp };
    case 'back-right':
      return { x: w - xmm, y: h - yUp };
    case 'center':
      return { x: xmm - w / 2, y: yUp - h / 2 };
  }
}

/** The point on a bounding box named by a 9-point anchor (in the box's units). */
export function anchorPoint(box: BBox, anchor: Anchor): Pt {
  const [vert, horiz = 'center'] = anchor.split('-');
  const fx = horiz === 'left' ? 0 : horiz === 'right' ? 1 : 0.5;
  const fy = vert === 'bottom' ? 0 : vert === 'top' ? 1 : 0.5;
  return { x: box.x + fx * box.width, y: box.y + fy * box.height };
}

/**
 * Re-origin a point so the design's `anchor` sits at (0,0) — LightBurn's
 * "user origin" / "current position" start mode, where the job is emitted
 * relative to a chosen point of its bounding box rather than absolute bed coords.
 */
export function toJobOrigin(p: Pt, bounds: BBox, anchor: Anchor): Pt {
  const a = anchorPoint(bounds, anchor);
  return { x: p.x - a.x, y: p.y - a.y };
}
