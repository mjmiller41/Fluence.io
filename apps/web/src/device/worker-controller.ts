/**
 * WorkerMachineController — the main-thread client for the GRBL device worker.
 * Grants a serial port (user gesture, main thread) then drives the worker-hosted
 * {@link GrblDevice} over Comlink, adapting it to the {@link MachineController}
 * surface. Status/console events arrive via Comlink-proxied callbacks.
 *
 * The Web Serial + worker path can only be verified on real hardware; the store
 * and UI are exercised against the Simulator controller instead.
 */
import * as Comlink from 'comlink';
import { type DeviceStatus, requestSerialPort } from 'device-core';
import type { ConsoleEntry } from 'protocols';
import type { MachineController } from './controller';
import type { DeviceWorkerApi } from './device-worker';

const DISCONNECTED: DeviceStatus = {
  state: 'disconnected',
  position: { x: 0, y: 0, z: 0 },
  progress: 0,
  bufferUsed: 0,
  bufferCapacity: 0,
};

/**
 * Prompt for a serial port (must run from a user gesture), then build a
 * controller bound to a fresh device worker for the chosen GRBL profile.
 */
export async function connectGrbl(profileId = 'grbl'): Promise<MachineController> {
  // User-gesture grant on the main thread; the worker reopens it via getPorts().
  await requestSerialPort();
  const worker = new Worker(new URL('./device-worker.ts', import.meta.url), { type: 'module' });
  const api = Comlink.wrap<DeviceWorkerApi>(worker);

  const statusListeners = new Set<(s: DeviceStatus) => void>();
  const consoleListeners = new Set<(e: ConsoleEntry) => void>();
  let last: DeviceStatus = DISCONNECTED;

  await api.subscribe(
    Comlink.proxy((s: DeviceStatus) => {
      last = s;
      for (const cb of statusListeners) cb(s);
    }),
    Comlink.proxy((e: ConsoleEntry) => {
      for (const cb of consoleListeners) cb(e);
    }),
  );

  const controller: MachineController = {
    connect: () => api.connect(profileId),
    disconnect: async () => {
      await api.disconnect();
      worker.terminate();
    },
    status: () => last,
    onStatus: (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onConsole: (cb) => {
      consoleListeners.add(cb);
      return () => consoleListeners.delete(cb);
    },
    stream: (lines) => ({ totalLines: lines.length, done: api.streamJob([...lines]) }),
    jog: (delta, feed) => api.jog(delta, feed),
    frame: (bounds, opts) => api.frame(bounds, opts),
    home: () => api.home(),
    setWorkOrigin: () => api.setWorkOrigin(),
    hold: () => api.hold(),
    resume: () => api.resume(),
    stop: () => api.stop(),
    sendCommand: (text) => api.sendCommand(text),
  };
  return controller;
}
