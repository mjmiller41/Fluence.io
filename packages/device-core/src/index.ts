/**
 * device-core — the sacred device abstraction (CLAUDE.md invariant 2).
 * UI/CAM import from here; they never touch a transport directly.
 */
export type {
  Vec3,
  Bounds,
  MachineState,
  DeviceStatus,
  Job,
  JobResult,
  JobHandle,
  JogOptions,
  StatusListener,
} from './types';
export type { Device } from './device';
export {
  TransportRegistry,
  LoopbackTransport,
  transports,
  type Transport,
  type TransportFactory,
} from './transport';
export { FakeDevice, type FakeDeviceOptions } from './fake-device';
export {
  GRBL_BAUD,
  isWebSerialSupported,
  listSerialPorts,
  requestSerialPort,
  type SerialPortLike,
  WebSerialTransport,
  type WebSerialConfig,
} from './webserial-transport';
