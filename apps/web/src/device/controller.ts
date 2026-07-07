/**
 * MachineController — the app-facing surface for driving a laser: connect,
 * stream a job, jog/frame/home/origin, hold/resume/stop, a raw console, and
 * status/console subscriptions. The editor store and MachinePanel depend only on
 * this interface, so the same UI drives the offline Simulator (below) or a real
 * GRBL board in a Web Worker (worker-controller.ts) without knowing which.
 */
import { type Bounds, type DeviceStatus, FakeDevice, type FakeDeviceOptions, type JobResult, type Vec3 } from 'device-core';
import type { ConsoleEntry } from 'protocols';

export interface StreamHandle {
  readonly totalLines: number;
  done: Promise<JobResult>;
}

export interface MachineController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): DeviceStatus;
  onStatus(cb: (s: DeviceStatus) => void): () => void;
  onConsole(cb: (e: ConsoleEntry) => void): () => void;

  stream(lines: readonly string[]): StreamHandle;
  jog(delta: Vec3, feed: number): Promise<void>;
  frame(bounds: Bounds, opts?: { feed?: number; power?: number }): Promise<void>;
  home(): Promise<void>;
  setWorkOrigin(): Promise<void>;
  hold(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  sendCommand(text: string): Promise<void>;
}

/**
 * Simulator controller: a headless {@link FakeDevice} behind the MachineController
 * surface. Lets the whole control UI be exercised (and unit-tested) with no
 * hardware; `sendCommand` echoes to the console for feedback.
 */
export function createSimController(opts: FakeDeviceOptions = {}): MachineController {
  const dev = new FakeDevice(opts);
  const consoleListeners = new Set<(e: ConsoleEntry) => void>();
  const emitConsole = (e: ConsoleEntry): void => {
    for (const cb of consoleListeners) cb(e);
  };
  return {
    connect: () => dev.connect(),
    disconnect: () => dev.disconnect(),
    status: () => dev.status(),
    onStatus: (cb) => dev.onStatus(cb),
    onConsole: (cb) => {
      consoleListeners.add(cb);
      return () => consoleListeners.delete(cb);
    },
    stream: (lines) => {
      emitConsole({ dir: 'tx', text: `; streaming ${lines.length} lines (simulator)` });
      const handle = dev.stream({ lines });
      void handle.done.then((r) => emitConsole({ dir: 'rx', text: `; ${r.status} (${r.linesSent} lines)` }));
      return { totalLines: handle.totalLines, done: handle.done };
    },
    jog: (delta, feed) => dev.jog({ feed, delta }),
    frame: (bounds, opts) => dev.frame(bounds, opts),
    home: () => dev.home(),
    setWorkOrigin: async () => {
      emitConsole({ dir: 'tx', text: 'G10 L20 P0 X0 Y0' });
    },
    hold: () => dev.hold(),
    resume: () => dev.resume(),
    stop: () => dev.stop(),
    sendCommand: async (text) => {
      const t = text.trim();
      if (t) emitConsole({ dir: 'tx', text: t });
    },
  };
}
