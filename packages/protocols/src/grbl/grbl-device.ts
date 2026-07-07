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
import { type GrblResponse, parseResponse, REALTIME, splitLines } from './parse';

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
  /** Controller serial RX buffer size in bytes (GRBL default 127). */
  bufferSize?: number;
  /** Interval timer host for `?` status polling (defaults to setInterval). */
  timers?: TimerHost;
}

const enc = new TextEncoder();
const lineBytes = (line: string): number => enc.encode(line).length + 1; // + newline

export class GrblDevice implements Device {
  readonly id: string;
  readonly transportKind: string;

  private readonly bufferSize: number;
  private readonly timers: TimerHost;
  private pollHandle: unknown = null;
  private readonly listeners = new Set<StatusListener>();
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
    this.bufferSize = opts.bufferSize ?? 127;
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

  async frame(bounds: Bounds, opts: { feed?: number } = {}): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot frame while a job is streaming');
    // Basic outline trace; refined (units/feed/laser-off) in M3-T05.
    const feed = opts.feed ?? 3000;
    const { min, max } = bounds;
    const corners: Array<[number, number]> = [
      [min.x, min.y],
      [max.x, min.y],
      [max.x, max.y],
      [min.x, max.y],
      [min.x, min.y],
    ];
    await this.send(this.line('G90'));
    for (const [x, y] of corners) {
      await this.send(this.line(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feed}`));
    }
  }

  async home(): Promise<void> {
    this.ensureConnected();
    if (this.running) throw new Error('Cannot home while a job is streaming');
    await this.send(this.line('$H'));
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

  /** Request a status report (`?`); the response updates state/position. */
  async requestStatus(): Promise<void> {
    await this.send(new Uint8Array([REALTIME.STATUS]));
  }

  // ---- internals ----

  private line(text: string): Uint8Array {
    return enc.encode(`${text}\n`);
  }

  /** Serialize all writes onto one chain (a serial writable takes one writer). */
  private send(bytes: Uint8Array): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.transport.write(bytes)).catch((err) => {
      this.fault(err instanceof Error ? err.message : String(err));
    });
    return this.writeChain;
  }

  private bufferUsed(): number {
    let n = 0;
    for (const b of this.inFlight) n += b;
    return n;
  }

  /** Send as many queued lines as the RX buffer can hold (char-counting). */
  private pump(): void {
    if (!this.running || this.held) return;
    while (this.cursor < this.lines.length) {
      const bytes = lineBytes(this.lines[this.cursor]);
      // Always admit one line even if larger than the buffer (never deadlock).
      if (this.inFlight.length > 0 && this.bufferUsed() + bytes > this.bufferSize) break;
      void this.send(this.line(this.lines[this.cursor]));
      this.inFlight.push(bytes);
      this.cursor++;
    }
    this.emit();
  }

  private onData(chunk: Uint8Array): void {
    this.rx += new TextDecoder().decode(chunk);
    const { lines, rest } = splitLines(this.rx);
    this.rx = rest;
    for (const l of lines) {
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
            this.fault(`error:${resp.code}`);
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
      case 'alarm':
        this.state = 'alarm';
        this.message = `ALARM:${resp.code}`;
        if (this.running) this.fault(this.message);
        else this.emit();
        break;
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
