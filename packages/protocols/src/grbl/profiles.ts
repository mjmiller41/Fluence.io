/**
 * GRBL-family device profiles (M3-T06). The dialect differences that actually
 * change how we drive a controller are: serial RX buffer size, flow-control
 * style (GRBL's character-counting vs a ping-pong "wait for ok" like Marlin),
 * the laser command (dynamic-power `M4` vs constant-power `M3`), and the status
 * mechanism (real-time `?` vs a polled `M114`). `GrblDevice` reads these to
 * adapt; CAM reads `laser`/`baud` for machine config.
 */
export interface DeviceProfile {
  id: string;
  name: string;
  /** Serial RX buffer size in bytes. */
  bufferSize: number;
  /** Streaming flow control. */
  flowControl: 'char-counting' | 'ping-pong';
  /** Laser power command: dynamic (GRBL 1.1) vs constant. */
  laser: 'M4' | 'M3';
  /** True when the controller answers the real-time `?` status query. */
  realtimeStatus: boolean;
  baud: number;
}

export const PROFILES: Record<string, DeviceProfile> = {
  grbl: { id: 'grbl', name: 'GRBL 1.1', bufferSize: 127, flowControl: 'char-counting', laser: 'M4', realtimeStatus: true, baud: 115200 },
  'grbl-m3': { id: 'grbl-m3', name: 'GRBL-M3 (constant power)', bufferSize: 127, flowControl: 'char-counting', laser: 'M3', realtimeStatus: true, baud: 115200 },
  'grbl-lpc': { id: 'grbl-lpc', name: 'GRBL-LPC', bufferSize: 256, flowControl: 'char-counting', laser: 'M4', realtimeStatus: true, baud: 115200 },
  smoothieware: { id: 'smoothieware', name: 'Smoothieware', bufferSize: 256, flowControl: 'char-counting', laser: 'M3', realtimeStatus: true, baud: 115200 },
  marlin: { id: 'marlin', name: 'Marlin', bufferSize: 96, flowControl: 'ping-pong', laser: 'M3', realtimeStatus: false, baud: 250000 },
  cohesion3d: { id: 'cohesion3d', name: 'Cohesion3D (Smoothie)', bufferSize: 256, flowControl: 'char-counting', laser: 'M3', realtimeStatus: true, baud: 115200 },
};

export const DEFAULT_PROFILE = PROFILES.grbl;
