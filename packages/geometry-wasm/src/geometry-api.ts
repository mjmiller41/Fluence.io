import { difference, intersection, offset, union, weld, xor } from './clipper';

/**
 * The geometry operations exposed across the worker/Comlink boundary. Kept in
 * its own module (no `Comlink.expose` side effect) so it can be imported by both
 * the worker entry (worker.ts) and by tests that exercise the Comlink protocol
 * in-process.
 */
export const geometryApi = { union, difference, intersection, xor, weld, offset };
export type GeometryApi = typeof geometryApi;
