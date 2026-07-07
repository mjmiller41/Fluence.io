/**
 * Device worker: hosts the GRBL streaming loop off the main thread (CLAUDE.md
 * invariant 4). It opens a Web-Serial port that the main thread already granted
 * (`navigator.serial.getPorts()` — Web Serial is exposed in dedicated workers on
 * Chromium desktop), drives a {@link GrblDevice}, and forwards status/console
 * events to Comlink-proxied callbacks. Exposed via Comlink; the main thread talks
 * to it through {@link WorkerMachineController}.
 */
import * as Comlink from 'comlink';
import { type Bounds, type DeviceStatus, type SerialPortLike, type Vec3, WebSerialTransport } from 'device-core';
import { type ConsoleEntry, type DeviceProfile, GrblDevice, PROFILES } from 'protocols';

interface WorkerSerial {
  getPorts(): Promise<SerialPortLike[]>;
}

class DeviceWorker {
  private device: GrblDevice | null = null;
  private onStatus: ((s: DeviceStatus) => void) | null = null;
  private onConsole: ((e: ConsoleEntry) => void) | null = null;

  subscribe(status: (s: DeviceStatus) => void, console: (e: ConsoleEntry) => void): void {
    this.onStatus = status;
    this.onConsole = console;
  }

  async connect(profileId = 'grbl'): Promise<void> {
    const serial = (self.navigator as unknown as { serial?: WorkerSerial }).serial;
    if (!serial) throw new Error('Web Serial is unavailable in this worker (Chromium desktop only)');
    const ports = await serial.getPorts();
    if (ports.length === 0) {
      throw new Error('No granted serial port — click Connect and pick your controller first');
    }
    const profile: DeviceProfile = PROFILES[profileId] ?? PROFILES.grbl;
    // Most recently granted port (the one the user just picked).
    const transport = new WebSerialTransport(ports[ports.length - 1], profile.baud);
    const device = new GrblDevice(transport, { profile });
    device.onStatus((s) => this.onStatus?.(s));
    device.onConsole((e) => this.onConsole?.(e));
    await device.connect();
    device.startStatusPoll(250);
    this.device = device;
  }

  async disconnect(): Promise<void> {
    await this.device?.disconnect();
    this.device = null;
  }

  private get dev(): GrblDevice {
    if (!this.device) throw new Error('Not connected');
    return this.device;
  }

  streamJob(lines: string[]): Promise<import('device-core').JobResult> {
    return this.dev.stream({ lines }).done;
  }
  jog(delta: Vec3, feed: number): Promise<void> {
    return this.dev.jog({ feed, delta });
  }
  frame(bounds: Bounds, opts?: { feed?: number; power?: number }): Promise<void> {
    return this.dev.frame(bounds, opts);
  }
  home(): Promise<void> {
    return this.dev.home();
  }
  setWorkOrigin(): Promise<void> {
    return this.dev.setWorkOrigin();
  }
  hold(): Promise<void> {
    return this.dev.hold();
  }
  resume(): Promise<void> {
    return this.dev.resume();
  }
  stop(): Promise<void> {
    return this.dev.stop();
  }
  sendCommand(text: string): Promise<void> {
    return this.dev.sendCommand(text);
  }
}

export type DeviceWorkerApi = DeviceWorker;
Comlink.expose(new DeviceWorker());
