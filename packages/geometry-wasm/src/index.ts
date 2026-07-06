/**
 * geometry-wasm — Clipper2 (C++ -> WASM) boolean/offset geometry.
 * The app should use `createGeometryClient()` so work runs off the main thread;
 * the bare functions are exported for tests and headless callers.
 */
export type { Point, Ring, Polygons, FillRuleName, BooleanOpKind } from './types';
export { polygonArea, totalAbsArea } from './poly';
export {
  initClipper,
  union,
  difference,
  intersection,
  xor,
  weld,
  offset,
  type OffsetOptions,
  type JoinTypeName,
  type EndTypeName,
} from './clipper';
export { serializePolygons } from './serialize';
export { createGeometryClient, type GeometryClient } from './client';
export type { GeometryApi } from './geometry-api';
