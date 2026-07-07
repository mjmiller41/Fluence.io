/**
 * GRBL device driver — implements the `Device` abstraction over a raw
 * {@link Transport} using GRBL's **character-counting** streaming protocol
 * (M3-T02). It keeps the controller's ~127-byte RX buffer as full as possible
 * without overflowing: lines are sent while the sum of in-flight (sent, not yet
 * acknowledged) bytes fits, and each `ok`/`error` frees the oldest line.
 *
 * This is the object the app runs inside the streaming Web Worker (CLAUDE.md
 * invariant 4). It is transport-agnostic and unit-testable with a mock transport
 * that emulates GRBL acks. Real-time controls, status polling, alarm decoding,
 * framing, and profiles are refined in M3-T03..T06.
 */
import type {
  Bounds,
  Device,
  DeviceStatus,
  Job,
  JobHandle,
  JobResult,
  JogOptions,
  MachineState,
  StatusListener,
  Transport,
  Vec3,
} from 'device-core';
import { alarmMessage, errorMessage, type GrblResponse, parseResponse, REALTIME, splitLines } from './parse';
import { DEFAULT_PROFILE, type DeviceProfile } from './profiles';

/** A raw console line, direction-tagged (M3-T04). */
export interface ConsoleEntry {
  dir: 'tx' | 'rx';
  text: string;
}

const REALTIME_SYMBOL: Record<number, string> = {
  [REALTIME.STATUS]: '?',
  [REALTIME.HOLD]: '!',
  [REALTIME.RESUME]: '~',
  [REALTIME.RESET]: '^X',
  [REALTIME.JOG_CANCEL]: 'jog-cancel',
};

/** Injectable interval timer (so status polling is testable without wall-clock). */
export interface TimerHost {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: TimerHost = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface GrblDeviceOptions {
  id?: string;
  /** Controller serial RX buffer size in bytes (overrides the profile default). */
  bufferSize?: number;
  /** Dialect profile (GRBL, GRBL-M3, Smoothieware, Marlin, …). Defaults to GRBL. */
  profile?: DeviceProfile;
  /** Interval timer host for `?` status polling (defaults to setInterval). */
  timers?: TimerHost;
}

const enc = new TextEncoder();
const lineBytes = (line: string): number => enc.encode(line).length + 1; // + newline

export class GrblDevice implements Device {
  readonly id: string;
  readonly transportKind: string;
  readonly profile: DeviceProfile;

  private readonly bufferSize: number;
  private readonly timers: TimerHost;
  private pollHandle: unknown = null;
  private readonly listeners = new Set<StatusListener>();
  private readonly consoleListeners = new Set<(e: ConsoleEntry) => void>();
  private unsubscribe: (() => void) | null = null;
  private rx = '';
  private writeChain: Promise<void> = Promise.resolve();

  private state: MachineState = 'disconnected';
  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private message: string | undefined;

  // Streaming state.
  private lines: readonly string[] = [];
  private cursor = 0; // next line to send
  private acked = 0;
  private inFlight: number[] = []; // byte sizes of sent-but-unacked lines
  private running = false;
  private held = false;
  private resolveDone: ((r: JobResult) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    opts: GrblDeviceOptions = {},
  ) {
    this.id = opts.id ?? 'grbl-0';
    this.transportKind = transport.kind;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
    this.bufferSize = opts.bufferSize ?? this.profile.bufferSize;
    this.timers = opts.timers ?? defaultTimers;
  }

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') return;
    if (!this.transport.isOpen) await this.transport.open();
    this.unsubscribe = this.transport.onData((chunk) => this.onData(chunk));
    this.state = 'idle';
    this.emit();
  }

  async disconnect(): Promise<void> {
    this.stopStatusPoll();
    this.abortStream('stopped');
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.transport.isOpen) await this.transport.close();
    this.state = 'disconnected';
    this.emit();
  }

  /** Begin polling `?` at `intervalMs` so status/position stay live (M3-T03). */
  startStatusPoll(intervalMs = 200): void {
    this.stopStatusPoll();
    this.pollHandle = this.timers.set(() => void this.requestStatus(), intervalMs);
  }

  stopStatusPoll(): void {
    if (this.pollHandle !== null) {
      this.timers.clear(this.pollHandle);
      this.pollHandle = null;
    }
  }

  status(): DeviceStatus {
    return {
      state: this.state,
      position: { ...this.position },
      progress: this.lines.length === 0 ? 0 : this.acked / this.lines.length,
      bufferUsed: this.bufferUsed(),
      bufferCapacity: this.bufferSize,
      message: this.message,
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to the raw TX/RX console stream (M3-T04). */
  onConsole(listener: (entry: ConsoleEntry) => void): () => void {
    this.consoleListeners.add(listener);
    return () => {
      this.consoleListeners.delete(listener);
    };
  }

  /**
   * Re-attach to the transport after a drop (auto-detection of an unplug is
   * app-level via `listSerialPorts`; this restores a clean, idle device state).
   */
  async reconnect(): Promise<void> {
    this.unsubscribe?.();
    if (!this.transport.isOpen) await this.transport.open();
    this.unsubscribe = this.transport.onData((chunk) => this.onData(chunk));
    this.rx = '';
    this.state = 'idle';
    this.message = undefined;
    this.emit();
  }

  stream(job: Job): JobHandle {
    this.ensureConnected();
    if (this.running) throw new Error('A job is already streaming');
    this.lines = job.lines;
    this.cursor = 0;
    this.acked = 0;
    this.inFlight = [];
    this.held = false;
    this.running = true;
    this.message = undefined;
    this.state = 'run';
    this.emit();

    const done = new Promise<JobResult>((resolve) => {
      this.resolveDone = resolve;
    });
    this.pump();
    // An empty job completes immediately.
    if (this.lines.length === 0) this.finishStream('completed');
    return { totalLines: this.lines.length, linesSent: () => this.acked, done };
  }

  async jog(opts: JogOptions): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot jog while a job is streaming');
    const d = opts.delta;
    const axes = [
      `X${(d.x ?? 0).toFixed(3)}`,
      `Y${(d.y ?? 0).toFixed(3)}`,
      d.z ? `Z${d.z.toFixed(3)}` : '',
    ].join('');
    await this.send(this.line(`$J=G91 ${axes} F${opts.feed}`));
  }

  /** Instantly cancel any in-progress jog (real-time byte, bypasses the buffer). */
  async cancelJog(): Promise<void> {
    await this.send(new Uint8Array([REALTIME.JOG_CANCEL]));
  }

  /**
   * Trace the bounding box (M3-T05). With no `power` it is a laser-off G0 rapid
   * frame for positioning; with `power` it runs a visible low-power outline
   * (`M3 S<power>` … `M5`) at `feed`. Corners go min→max and back to the start.
   */
  async frame(bounds: Bounds, opts: { feed?: number; power?: number } = {}): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot frame while a job is streaming');
    const { min, max } = bounds;
    const corners: Array<[number, number]> = [
      [min.x, min.y],
      [max.x, min.y],
      [max.x, max.y],
      [min.x, max.y],
      [min.x, min.y],
    ];
    await this.send(this.line('G90'));
    if (opts.power != null) {
      const feed = opts.feed ?? 3000;
      await this.send(this.line(`G0 X${min.x.toFixed(3)} Y${min.y.toFixed(3)}`));
      await this.send(this.line(`M3 S${opts.power}`));
      for (const [x, y] of corners.slice(1)) {
        await this.send(this.line(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feed}`));
      }
      await this.send(this.line('M5'));
    } else {
      // Positioning frame: rapids with the laser off (no S word).
      for (const [x, y] of corners) {
        await this.send(this.line(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`));
      }
    }
  }

  async home(): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot home while a job is streaming');
    await this.send(this.line('$H'));
  }

  /** Set the current position as the work-coordinate origin (G10 L20 P0). */
  async setWorkOrigin(): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot set origin while a job is streaming');
    await this.send(this.line('G10 L20 P0 X0 Y0'));
  }

  /** Send a raw command line (console entry). Not allowed mid-stream. */
  async sendCommand(text: string): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot send a command while a job is streaming');
    const trimmed = text.trim();
    if (trimmed) await this.send(this.line(trimmed));
  }

  async hold(): Promise<void> {
    this.held = true;
    await this.send(new Uint8Array([REALTIME.HOLD]));
  }

  async resume(): Promise<void> {
    this.held = false;
    await this.send(new Uint8Array([REALTIME.RESUME]));
    this.pump();
  }

  async stop(): Promise<void> {
    await this.send(new Uint8Array([REALTIME.RESET]));
    this.abortStream('stopped');
  }

  /**
   * Request a status report. GRBL-family controllers answer the real-time `?`
   * byte; Marlin has no real-time status, so poll `M114` as a normal line.
   */
  async requestStatus(): Promise<void> {
    if (this.profile.realtimeStatus) await this.send(new Uint8Array([REALTIME.STATUS]));
    else await this.send(this.line('M114'));
  }

  // ---- internals ----

  private line(text: string): Uint8Array {
    return enc.encode(`${text}\n`);
  }

  /** Serialize all writes onto one chain (a serial writable takes one writer). */
  private send(bytes: Uint8Array): Promise<void> {
    this.logTx(bytes);
    this.writeChain = this.writeChain.then(() => this.transport.write(bytes)).catch((err) => {
      this.fault(err instanceof Error ? err.message : String(err));
    });
    return this.writeChain;
  }

  private logTx(bytes: Uint8Array): void {
    if (this.consoleListeners.size === 0) return;
    const text =
      bytes.length === 1 && REALTIME_SYMBOL[bytes[0]]
        ? REALTIME_SYMBOL[bytes[0]]
        : new TextDecoder().decode(bytes).replace(/\r?\n$/, '');
    this.emitConsole('tx', text);
  }

  private emitConsole(dir: 'tx' | 'rx', text: string): void {
    if (text === '') return;
    for (const l of this.consoleListeners) l({ dir, text });
  }

  private bufferUsed(): number {
    let n = 0;
    for (const b of this.inFlight) n += b;
    return n;
  }

  /**
   * Send queued lines subject to the profile's flow control: char-counting fills
   * the RX buffer by bytes; ping-pong (Marlin) sends one line and waits for `ok`.
   */
  private pump(): void {
    if (!this.running || this.held) return;
    while (this.cursor < this.lines.length) {
      const bytes = lineBytes(this.lines[this.cursor]);
      if (this.profile.flowControl === 'ping-pong') {
        if (this.inFlight.length > 0) break;
      } else if (this.inFlight.length > 0 && this.bufferUsed() + bytes > this.bufferSize) {
        // Always admit one line even if larger than the buffer (never deadlock).
        break;
      }
      void this.send(this.line(this.lines[this.cursor]));
      this.inFlight.push(bytes);
      this.cursor++;
      if (this.profile.flowControl === 'ping-pong') break;
    }
    this.emit();
  }

  private onData(chunk: Uint8Array): void {
    this.rx += new TextDecoder().decode(chunk);
    const { lines, rest } = splitLines(this.rx);
    this.rx = rest;
    for (const l of lines) {
      this.emitConsole('rx', l.trim());
      const resp = parseResponse(l);
      if (resp) this.handle(resp);
    }
  }

  private handle(resp: GrblResponse): void {
    switch (resp.type) {
      case 'ok':
      case 'error':
        if (this.running && this.inFlight.length > 0) {
          this.inFlight.shift();
          this.acked++;
          if (resp.type === 'error') {
            this.fault(`error:${resp.code} — ${errorMessage(resp.code)}`);
            return;
          }
          this.emit();
          if (this.acked >= this.lines.length && this.cursor >= this.lines.length) {
            this.finishStream('completed');
          } else {
            this.pump();
          }
        }
        break;
      case 'alarm': {
        const text = `ALARM:${resp.code} — ${alarmMessage(resp.code)}`;
        this.state = 'alarm';
        this.message = text;
        if (this.running) this.fault(text);
        else this.emit();
        break;
      }
      case 'status':
        if (!this.running) this.state = resp.state;
        if (resp.wpos) this.position = resp.wpos;
        else if (resp.mpos) this.position = resp.mpos;
        this.emit();
        break;
      case 'welcome':
      case 'message':
        break;
    }
  }

  private finishStream(status: 'completed' | 'stopped'): void {
    if (!this.running) return;
    this.running = false;
    this.inFlight = [];
    this.state = 'idle';
    this.emit();
    this.resolveDone?.({ status, linesSent: this.acked });
    this.resolveDone = null;
  }

  private abortStream(status: 'stopped'): void {
    if (!this.running) return;
    this.running = false;
    this.held = false;
    this.inFlight = [];
    this.resolveDone?.({ status, linesSent: this.acked });
    this.resolveDone = null;
  }

  private fault(error: string): void {
    if (!this.running) {
      this.message = error;
      this.state = 'error';
      this.emit();
      return;
    }
    this.running = false;
    this.held = false;
    this.inFlight = [];
    this.state = 'error';
    this.message = error;
    this.emit();
    this.resolveDone?.({ status: 'faulted', linesSent: this.acked, error });
    this.resolveDone = null;
  }

  private ensureConnected(): void {
    if (this.state === 'disconnected') throw new Error('Device is not connected');
  }

  private emit(): void {
    const snap = this.status();
    for (const l of this.listeners) l(snap);
  }
}
