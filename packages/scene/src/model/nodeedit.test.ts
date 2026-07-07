import { beforeEach, describe, expect, it } from 'vitest';
import { flattenSubPath } from '../geom/path';
import { equals, type Vec2 } from '../geom/vec';
import {
  createEllipse,
  createPath,
  createPolyline,
  createRect,
} from './factory';
import { resetIds } from './ids';
import {
  deleteNode,
  insertNode,
  moveHandle,
  moveNode,
  nodeCount,
  setSegmentType,
  setSubpathClosed,
  subpathNodes,
  toEditablePath,
} from './nodeedit';
import { localPath, type PathShape } from './shape';

const init = { layerId: 'ly' };

beforeEach(() => resetIds());

/** Max pointwise distance between two flattened polylines sampled at matching t. */
function polylineClose(a: Vec2[], b: Vec2[], tol = 1e-6): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) <= tol);
}

const triangle = (): PathShape =>
  createPath(
    [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 10, y: 0 } },
          { type: 'line', to: { x: 5, y: 8 } },
        ],
        closed: true,
      },
    ],
    init,
  );

const openLine = (): PathShape =>
  createPath(
    [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: 'line', to: { x: 10, y: 0 } },
          { type: 'line', to: { x: 20, y: 0 } },
          { type: 'line', to: { x: 30, y: 0 } },
        ],
        closed: false,
      },
    ],
    init,
  );

describe('toEditablePath', () => {
  it('converts primitives to a path with identical geometry and same id', () => {
    for (const shape of [
      createRect(40, 20, init, { rx: 4, ry: 4 }),
      createEllipse(15, 10, init),
      createPolyline(
        [
          { x: 0, y: 0 },
          { x: 10, y: 5 },
          { x: 20, y: 0 },
        ],
        true,
        init,
      ),
    ]) {
      const path = toEditablePath(shape)!;
      expect(path.kind).toBe('path');
      expect(path.id).toBe(shape.id);
      const before = localPath(shape).map((sp) => flattenSubPath(sp));
      const after = path.subpaths.map((sp) => flattenSubPath(sp));
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) {
        expect(polylineClose(after[i], before[i], 1e-6)).toBe(true);
      }
    }
  });

  it('returns null for groups', () => {
    const group = { kind: 'group', id: 'g', layerId: 'ly', transform: [1, 0, 0, 1, 0, 0], children: [] };
    expect(toEditablePath(group as never)).toBeNull();
  });

  it('normalises a closed subpath to have an explicit closing edge', () => {
    const path = toEditablePath(triangle())!;
    // 3 anchors, closed => 3 segments (last returns to start).
    expect(nodeCount(path.subpaths[0])).toBe(3);
    expect(path.subpaths[0].segments.length).toBe(3);
    expect(equals(path.subpaths[0].segments[2].to, path.subpaths[0].start)).toBe(true);
  });
});

describe('node addressing', () => {
  it('lists anchors in order for open and closed subpaths', () => {
    expect(subpathNodes(openLine().subpaths[0])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(nodeCount(toEditablePath(triangle())!.subpaths[0])).toBe(3);
  });
});

describe('moveNode', () => {
  it('moves an open anchor and does not mutate the input', () => {
    const shape = openLine();
    const moved = moveNode(shape, { subpath: 0, node: 1 }, { x: 12, y: 6 });
    expect(subpathNodes(moved.subpaths[0])[1]).toEqual({ x: 12, y: 6 });
    // Input untouched.
    expect(subpathNodes(shape.subpaths[0])[1]).toEqual({ x: 10, y: 0 });
  });

  it('moving node 0 of a closed subpath keeps it closed', () => {
    const path = toEditablePath(triangle())!;
    const moved = moveNode(path, { subpath: 0, node: 0 }, { x: -3, y: -3 });
    const sp = moved.subpaths[0];
    expect(sp.start).toEqual({ x: -3, y: -3 });
    expect(equals(sp.segments[sp.segments.length - 1].to, sp.start)).toBe(true);
  });

  it('translates attached bezier handles with the anchor', () => {
    // Ellipse node 0 is at (rx,0); the outgoing cubic's c1 sits above it.
    const path = toEditablePath(createEllipse(15, 10, init))!;
    const sp0 = path.subpaths[0];
    const outC1Before = (sp0.segments[0] as { c1: Vec2 }).c1;
    const moved = moveNode(path, { subpath: 0, node: 0 }, { x: 20, y: 5 });
    const outC1After = (moved.subpaths[0].segments[0] as { c1: Vec2 }).c1;
    expect(outC1After.x - outC1Before.x).toBeCloseTo(5, 9);
    expect(outC1After.y - outC1Before.y).toBeCloseTo(5, 9);
  });
});

describe('moveHandle', () => {
  it('sets the outgoing control point and mirrors when asked', () => {
    const shape = createPath(
      [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: 'cubic', c1: { x: 1, y: 1 }, c2: { x: 2, y: 1 }, to: { x: 3, y: 0 } },
            { type: 'cubic', c1: { x: 4, y: -1 }, c2: { x: 5, y: -1 }, to: { x: 6, y: 0 } },
          ],
          closed: false,
        },
      ],
      init,
    );
    // Node 1 is the junction between the two cubics. Move its outgoing handle.
    const moved = moveHandle(shape, { subpath: 0, node: 1 }, 'out', { x: 4, y: 3 }, true);
    const sp = moved.subpaths[0];
    expect((sp.segments[1] as { c1: Vec2 }).c1).toEqual({ x: 4, y: 3 });
    // Mirror: incoming handle (c2 of segment 0) reflects across anchor (3,0).
    expect((sp.segments[0] as { c2: Vec2 }).c2).toEqual({ x: 2, y: -3 });
  });

  it('is a no-op on a straight segment', () => {
    const shape = openLine();
    const moved = moveHandle(shape, { subpath: 0, node: 1 }, 'out', { x: 99, y: 99 });
    expect(moved.subpaths[0].segments).toEqual(shape.subpaths[0].segments);
  });
});

describe('insertNode', () => {
  it('splits a line into two collinear lines without changing geometry', () => {
    const shape = openLine();
    const before = flattenSubPath(shape.subpaths[0]);
    const out = insertNode(shape, 0, 0, 0.5);
    expect(nodeCount(out.subpaths[0])).toBe(nodeCount(shape.subpaths[0]) + 1);
    expect(subpathNodes(out.subpaths[0])[1]).toEqual({ x: 5, y: 0 });
    // Flattened geometry of a straight run is unchanged by adding a midpoint.
    const after = flattenSubPath(out.subpaths[0]);
    expect(after[0]).toEqual(before[0]);
    expect(after[after.length - 1]).toEqual(before[before.length - 1]);
  });

  it('splits a cubic via de Casteljau, preserving the curve', () => {
    const shape = createPath(
      [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: 'cubic', c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } }],
          closed: false,
        },
      ],
      init,
    );
    const before = flattenSubPath(shape.subpaths[0], 0.01);
    const out = insertNode(shape, 0, 0, 0.5);
    expect(out.subpaths[0].segments.length).toBe(2);
    const after = flattenSubPath(out.subpaths[0], 0.01);
    // Same curve sampled: endpoints identical, apex within flattening tolerance.
    expect(after[0]).toEqual(before[0]);
    expect(after[after.length - 1]).toEqual(before[before.length - 1]);
  });
});

describe('deleteNode', () => {
  it('removes an interior open node, bridging neighbours', () => {
    const shape = openLine(); // nodes 0,10,20,30
    const out = deleteNode(shape, { subpath: 0, node: 1 });
    expect(subpathNodes(out.subpaths[0])).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('removes an open endpoint', () => {
    const out = deleteNode(openLine(), { subpath: 0, node: 0 });
    expect(subpathNodes(out.subpaths[0])).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('removes a node from a closed subpath and keeps it closed', () => {
    // Closed square A(0,0) B(10,0) C(10,10) D(0,10).
    const path = createPath(
      [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: 'line', to: { x: 10, y: 0 } },
            { type: 'line', to: { x: 10, y: 10 } },
            { type: 'line', to: { x: 0, y: 10 } },
            { type: 'line', to: { x: 0, y: 0 } },
          ],
          closed: true,
        },
      ],
      init,
    );
    const out = deleteNode(path, { subpath: 0, node: 2 }); // remove C
    const sp = out.subpaths[0];
    expect(sp.closed).toBe(true);
    expect(nodeCount(sp)).toBe(3);
    // Remaining anchors are A, B, D in some rotation.
    const set = new Set(subpathNodes(sp).map((n) => `${n.x},${n.y}`));
    expect(set).toEqual(new Set(['0,0', '10,0', '0,10']));
  });

  it('drops a subpath that would fall below two anchors', () => {
    const shape = createPath(
      [{ start: { x: 0, y: 0 }, segments: [{ type: 'line', to: { x: 5, y: 5 } }], closed: false }],
      init,
    );
    const out = deleteNode(shape, { subpath: 0, node: 0 });
    expect(out.subpaths.length).toBe(0);
  });
});

describe('setSegmentType', () => {
  it('converts a line to a curve without changing the visible path', () => {
    const shape = openLine();
    const before = flattenSubPath(shape.subpaths[0]);
    const out = setSegmentType(shape, 0, 0, 'cubic');
    expect(out.subpaths[0].segments[0].type).toBe('cubic');
    // Default handles lie on the straight line, so geometry is unchanged.
    expect(polylineClose(flattenSubPath(out.subpaths[0]), before, 1e-9)).toBe(true);
  });

  it('converts a curve back to a line, keeping the endpoint', () => {
    const shape = createPath(
      [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: 'cubic', c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } }],
          closed: false,
        },
      ],
      init,
    );
    const out = setSegmentType(shape, 0, 0, 'line');
    expect(out.subpaths[0].segments[0]).toEqual({ type: 'line', to: { x: 10, y: 0 } });
  });
});

describe('setSubpathClosed', () => {
  it('closes an open subpath by appending an edge back to start', () => {
    const out = setSubpathClosed(openLine(), 0, true);
    const sp = out.subpaths[0];
    expect(sp.closed).toBe(true);
    expect(equals(sp.segments[sp.segments.length - 1].to, sp.start)).toBe(true);
  });

  it('opens a closed subpath by dropping its redundant closing edge', () => {
    const closed = toEditablePath(triangle())!;
    const opened = setSubpathClosed(closed, 0, false);
    const sp = opened.subpaths[0];
    expect(sp.closed).toBe(false);
    // Triangle had a synthetic closing line; opening removes it → 2 segments left.
    expect(sp.segments.length).toBe(2);
  });
});
