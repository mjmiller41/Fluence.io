/**
 * protocols — machine-control codecs (grbl, ruida, galvo/ezcad).
 *
 * Scaffold for M0. Codecs are pure, transport-agnostic byte encoders/decoders
 * (no I/O — that belongs to `device-core` transports and the Agent). GRBL lands
 * in M2, Ruida in M4, galvo in M7. Each codec is validated by the conformance
 * harness below against captured/emulator fixtures.
 */
export const PROTOCOLS_SCAFFOLD = true as const;
export {
  runConformance,
  hex,
  type Codec,
  type ConformanceVector,
  type ConformanceResult,
} from './conformance/harness';
export { type GrblResponse, parseResponse, REALTIME, splitLines } from './grbl/parse';
export { GrblDevice, type GrblDeviceOptions, type TimerHost } from './grbl/grbl-device';
