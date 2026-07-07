/**
 * Node editing — pure operations on a {@link PathShape}'s subpaths: move anchors
 * and bezier handles, insert/delete nodes, convert segments between line and
 * curve, and open/close subpaths. Every op returns a NEW PathShape (same id, so
 * the editor can swap it via `updateShapeCommand` for undo/redo); inputs are
 * never mutated.
 *
 * Node addressing. A subpath's nodes are its anchor points: node 0 is `start`,
 * node k (k>=1) is `segments[k-1].to`. `segments[i]` is the edge leaving node i.
 * Closed subpaths are normalised so the final segment returns to `start` (the
 * closing edge is explicit, matching the ellipse/rect factories), giving
 * `nodeCount === segments.length`. Open subpaths have `segments.length + 1`
 * nodes and no closing edge.
 */
import { type Segment, type SubPath } from '../geom/path';
import { add, equals, lerp, scale, sub, type Vec2 } from '../geom/vec';
import type { PathShape, Shape } from './shape';
import { localPath } from './shape';

/** Address of an anchor node within a path: which subpath, which node. */
export interface NodeRef {
  subpath: number;
  node: number;
}

/** Which bezier handle of a node: the outgoing (`out`) or incoming (`in`) control point. */
export type HandleSide = 'in' | 'out';

const clone = (shape: PathShape): PathShape => structuredClone(shape);

/** Ensure a closed subpath's last segment returns to `start` (explicit closing edge). */
function normalizeSubpath(sp: SubPath): void {
  if (!sp.closed || sp.segments.length === 0) return;
  const last = sp.segments[sp.segments.length - 1];
  if (!equals(last.to, sp.start)) {
    sp.segments.push({ type: 'line', to: { ...sp.start } });
  }
}

/** Number of anchor nodes in a (normalised) subpath. */
export function nodeCount(sp: SubPath): number {
  return sp.closed ? sp.segments.length : sp.segments.length + 1;
}

/** Local-space position of anchor node `k`. */
export function nodePosition(sp: SubPath, k: number): Vec2 {
  return k === 0 ? sp.start : sp.segments[k - 1].to;
}

/** All anchor positions of a subpath, in order (for hit-testing / rendering). */
export function subpathNodes(sp: SubPath): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < nodeCount(sp); k++) out.push(nodePosition(sp, k));
  return out;
}

/** Index into `segments` of the edge entering node `k`, or -1 if none (open endpoint). */
function incomingIndex(sp: SubPath, k: number): number {
  if (k >= 1) return k - 1;
  return sp.closed ? sp.segments.length - 1 : -1;
}

/** Index into `segments` of the edge leaving node `k`, or -1 if none (open endpoint). */
function outgoingIndex(sp: SubPath, k: number): number {
  return k < sp.segments.length ? k : -1;
}

function setAnchor(sp: SubPath, k: number, p: Vec2): void {
  if (k === 0) {
    sp.start = { ...p };
    // A normalised closed subpath's last segment ends at `start`; keep it closed.
    if (sp.closed && sp.segments.length > 0) {
      sp.segments[sp.segments.length - 1].to = { ...p };
    }
  } else {
    sp.segments[k - 1].to = { ...p };
  }
}

function validSubpath(shape: PathShape, ref: NodeRef): SubPath | null {
  const sp = shape.subpaths[ref.subpath];
  if (!sp) return null;
  normalizeSubpath(sp);
  if (ref.node < 0 || ref.node >= nodeCount(sp)) return null;
  return sp;
}

/**
 * Convert any leaf shape into an editable {@link PathShape}, preserving its id,
 * transform, and world geometry. Returns null for groups (node-edit one leaf at
 * a time). A path is returned as a normalised clone.
 */
export function toEditablePath(shape: Shape): PathShape | null {
  if (shape.kind === 'group') return null;
  const subpaths = structuredClone(localPath(shape));
  for (const sp of subpaths) normalizeSubpath(sp);
  return {
    id: shape.id,
    layerId: shape.layerId,
    name: shape.name,
    transform: structuredClone(shape.transform),
    hidden: shape.hidden,
    locked: shape.locked,
    kind: 'path',
    subpaths,
  };
}

/**
 * Move anchor node `ref` to `to` (local coords). Bezier handles attached to the
 * node translate rigidly with it, so incident curves keep their shape.
 */
export function moveNode(shape: PathShape, ref: NodeRef, to: Vec2): PathShape {
  const next = clone(shape);
  const sp = validSubpath(next, ref);
  if (!sp) return next;
  const delta = sub(to, nodePosition(sp, ref.node));
  const inIdx = incomingIndex(sp, ref.node);
  const outIdx = outgoingIndex(sp, ref.node);
  setAnchor(sp, ref.node, to);
  const inSeg = inIdx >= 0 ? sp.segments[inIdx] : null;
  if (inSeg && inSeg.type === 'cubic') inSeg.c2 = add(inSeg.c2, delta);
  const outSeg = outIdx >= 0 ? sp.segments[outIdx] : null;
  if (outSeg && outSeg.type === 'cubic') outSeg.c1 = add(outSeg.c1, delta);
  return next;
}

/**
 * Move one bezier handle of node `ref` to `to`. `side` picks the outgoing (`out`,
 * the `c1` of the leaving segment) or incoming (`in`, the `c2` of the entering
 * segment) control point. No-op if that segment is a straight line. When `mirror`
 * is set, the opposite handle is reflected across the anchor to keep the node
 * smooth (only if that opposite segment is also a curve).
 */
export function moveHandle(
  shape: PathShape,
  ref: NodeRef,
  side: HandleSide,
  to: Vec2,
  mirror = false,
): PathShape {
  const next = clone(shape);
  const sp = validSubpath(next, ref);
  if (!sp) return next;
  const primaryIdx = side === 'out' ? outgoingIndex(sp, ref.node) : incomingIndex(sp, ref.node);
  const primary = primaryIdx >= 0 ? sp.segments[primaryIdx] : null;
  if (!primary || primary.type !== 'cubic') return next;
  if (side === 'out') primary.c1 = { ...to };
  else primary.c2 = { ...to };
  if (mirror) {
    const anchor = nodePosition(sp, ref.node);
    const reflected = sub(scale(anchor, 2), to);
    const otherIdx =
      side === 'out' ? incomingIndex(sp, ref.node) : outgoingIndex(sp, ref.node);
    const other = otherIdx >= 0 ? sp.segments[otherIdx] : null;
    if (other && other.type === 'cubic') {
      if (side === 'out') other.c2 = reflected;
      else other.c1 = reflected;
    }
  }
  return next;
}

/** De Casteljau split of a cubic at parameter t; returns the two halves. */
function splitCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): [Segment, Segment] {
  const a = lerp(p0, c1, t);
  const b = lerp(c1, c2, t);
  const c = lerp(c2, p1, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return [
    { type: 'cubic', c1: a, c2: d, to: f },
    { type: 'cubic', c1: e, c2: c, to: p1 },
  ];
}

/**
 * Insert a node on the edge `segments[segmentIndex]` of `subpath`, splitting it
 * at parameter `t` in (0,1). Lines split into two lines; curves split via de
 * Casteljau so the path shape is unchanged.
 */
export function insertNode(
  shape: PathShape,
  subpath: number,
  segmentIndex: number,
  t = 0.5,
): PathShape {
  const next = clone(shape);
  const sp = next.subpaths[subpath];
  if (!sp) return next;
  normalizeSubpath(sp);
  const seg = sp.segments[segmentIndex];
  if (!seg) return next;
  const clampT = Math.min(Math.max(t, 1e-4), 1 - 1e-4);
  const from = segmentIndex === 0 ? sp.start : sp.segments[segmentIndex - 1].to;
  let replacement: [Segment, Segment];
  if (seg.type === 'line') {
    const mid = lerp(from, seg.to, clampT);
    replacement = [
      { type: 'line', to: mid },
      { type: 'line', to: { ...seg.to } },
    ];
  } else {
    replacement = splitCubic(from, seg.c1, seg.c2, seg.to, clampT);
  }
  sp.segments.splice(segmentIndex, 1, ...replacement);
  return next;
}

/**
 * Delete anchor node `ref`, bridging its neighbours with a straight edge (other
 * segments keep their curvature). Subpaths that would fall below two anchors are
 * removed entirely.
 */
export function deleteNode(shape: PathShape, ref: NodeRef): PathShape {
  const next = clone(shape);
  const sp = validSubpath(next, ref);
  if (!sp) return next;
  const k = ref.node;
  const count = nodeCount(sp);

  if (count - 1 < 2) {
    next.subpaths.splice(ref.subpath, 1);
    return next;
  }

  if (!sp.closed) {
    if (k === 0) {
      // Second node becomes the new start; drop the first edge.
      sp.start = { ...sp.segments[0].to };
      sp.segments.shift();
    } else if (k === sp.segments.length) {
      sp.segments.pop();
    } else {
      const nextPos = sp.segments[k].to;
      sp.segments.splice(k - 1, 2, { type: 'line', to: { ...nextPos } });
    }
    return next;
  }

  // Closed: node k has incoming edge (k-1 mod count) and outgoing edge k.
  // Remove both, bridge the surviving neighbours with a line.
  const m = sp.segments.length;
  const prevPos = nodePosition(sp, (k - 1 + count) % count);
  const nextPos = nodePosition(sp, (k + 1) % count);
  const inIdx = (k - 1 + m) % m;
  const outIdx = k % m;
  const bridge: Segment = { type: 'line', to: { ...nextPos } };
  // Rebuild the segment ring: keep every edge except the two incident to k,
  // splicing one bridge edge in the gap. Rotating so index 0 starts a run keeps
  // the math simple.
  const kept: Segment[] = [];
  for (let i = 0; i < m; i++) {
    if (i === inIdx || i === outIdx) continue;
    kept.push(sp.segments[i]);
  }
  // The kept edges plus the bridge form the new ring; the subpath's `start` must
  // be an anchor that still exists. Anchor (k-1) survives — anchor it there.
  sp.start = { ...prevPos };
  // Order edges starting from the one leaving (k-1): that is the bridge, then the
  // kept edges walking forward from node (k+1) back around to node (k-1).
  const ring: Segment[] = [bridge];
  let node = (k + 1) % count;
  while (node !== (k - 1 + count) % count) {
    ring.push(sp.segments[node % m]);
    node = (node + 1) % count;
  }
  sp.segments = ring;
  return next;
}

/**
 * Convert the edge `segments[segmentIndex]` of `subpath` between a straight line
 * and a cubic curve. A new curve gets default handles at the 1/3 and 2/3 points,
 * so the visible geometry is unchanged until a handle is dragged.
 */
export function setSegmentType(
  shape: PathShape,
  subpath: number,
  segmentIndex: number,
  type: 'line' | 'cubic',
): PathShape {
  const next = clone(shape);
  const sp = next.subpaths[subpath];
  if (!sp) return next;
  normalizeSubpath(sp);
  const seg = sp.segments[segmentIndex];
  if (!seg) return next;
  const from = segmentIndex === 0 ? sp.start : sp.segments[segmentIndex - 1].to;
  if (type === 'line') {
    sp.segments[segmentIndex] = { type: 'line', to: { ...seg.to } };
  } else {
    sp.segments[segmentIndex] = {
      type: 'cubic',
      c1: lerp(from, seg.to, 1 / 3),
      c2: lerp(from, seg.to, 2 / 3),
      to: { ...seg.to },
    };
  }
  return next;
}

/**
 * Open or close a subpath. Closing appends an explicit edge back to `start`;
 * opening drops a trailing edge that merely returns to `start` (so the shape is
 * unchanged apart from the join).
 */
export function setSubpathClosed(shape: PathShape, subpath: number, closed: boolean): PathShape {
  const next = clone(shape);
  const sp = next.subpaths[subpath];
  if (!sp) return next;
  if (closed) {
    if (sp.segments.length === 0) return next;
    const last = sp.segments[sp.segments.length - 1];
    if (!equals(last.to, sp.start)) sp.segments.push({ type: 'line', to: { ...sp.start } });
    sp.closed = true;
  } else {
    // Drop a redundant closing edge if the last segment just returns to start.
    const last = sp.segments[sp.segments.length - 1];
    if (last && last.type === 'line' && equals(last.to, sp.start)) sp.segments.pop();
    sp.closed = false;
  }
  return next;
}
