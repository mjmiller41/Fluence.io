/**
 * Web Serial transport for GRBL (M3-T01). Wraps a `SerialPort` as a raw byte
 * pipe: opens at a baud rate, pumps inbound bytes to subscribers, and writes
 * outbound bytes. The GRBL streaming/real-time logic is layered on top in later
 * M3 cards; this file knows nothing about G-code.
 *
 * Web Serial is Chromium-desktop only (CLAUDE.md invariant 7). The class takes a
 * `SerialPortLike` by injection so it unit-tests with a mock port under node; the
 * `requestSerialPort`/`listSerialPorts` helpers touch `navigator.serial` and are
 * only callable in the browser.
 */
import { type Transport, transports } from './transport';

/** The slice of the Web Serial `SerialPort` API this transport uses. */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

interface SerialLike {
  requestPort(options?: { filters?: Array<{ usbVendorId?: number }> }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

/** GRBL's default serial baud rate. */
export const GRBL_BAUD = 115200;

export interface WebSerialConfig {
  port: SerialPortLike;
  baudRate?: number;
}

export class WebSerialTransport implements Transport {
  readonly kind = 'webserial';
  private open_ = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pumping: Promise<void> | null = null;
  private readonly listeners = new Set<(chunk: Uint8Array) => void>();

  constructor(
    private readonly port: SerialPortLike,
    private readonly baudRate: number = GRBL_BAUD,
  ) {}

  get isOpen(): boolean {
    return this.open_;
  }

  /** Vendor/product ids of the underlying port, when the platform exposes them. */
  info(): { usbVendorId?: number; usbProductId?: number } {
    return this.port.getInfo?.() ?? {};
  }

  async open(): Promise<void> {
    if (this.open_) return;
    await this.port.open({ baudRate: this.baudRate });
    this.open_ = true;
    this.pumping = this.pump();
  }

  private async pump(): Promise<void> {
    while (this.open_ && this.port.readable) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            for (const cb of this.listeners) cb(value);
          }
        }
      } catch {
        // Stream error (unplugged mid-read): stop pumping; close()/reconnect handle recovery.
        break;
      } finally {
        reader.releaseLock();
        this.reader = null;
      }
      break; // a clean `done` means the port closed; don't spin.
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.open_ || !this.port.writable) {
      throw new Error('Transport is not open');
    }
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    if (!this.open_) return;
    this.open_ = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* reader already released */
    }
    try {
      await this.pumping;
    } catch {
      /* pump settled */
    }
    await this.port.close();
    this.listeners.clear();
  }

  onData(cb: (chunk: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

function getSerial(): SerialLike {
  const serial = (globalThis.navigator as unknown as { serial?: SerialLike } | undefined)?.serial;
  if (!serial) {
    throw new Error('Web Serial API unavailable (Chromium desktop only)');
  }
  return serial;
}

/** True when the running browser supports Web Serial. */
export function isWebSerialSupported(): boolean {
  return !!(globalThis.navigator as unknown as { serial?: unknown } | undefined)?.serial;
}

/**
 * Prompt the user to pick a serial port (MUST be called from a user gesture) and
 * return a transport for it. `usbVendorId` filters narrow the chooser.
 */
export async function requestSerialPort(
  filters?: Array<{ usbVendorId?: number }>,
  baudRate: number = GRBL_BAUD,
): Promise<WebSerialTransport> {
  const port = await getSerial().requestPort(filters ? { filters } : undefined);
  return new WebSerialTransport(port, baudRate);
}

/**
 * Transports for ports the user has already granted (persistent grants), so a
 * previously-paired board reconnects without re-picking (`navigator.serial.getPorts`).
 */
export async function listSerialPorts(baudRate: number = GRBL_BAUD): Promise<WebSerialTransport[]> {
  const ports = await getSerial().getPorts();
  return ports.map((p) => new WebSerialTransport(p, baudRate));
}

// Self-register into the process-wide registry (config carries the chosen port).
transports.register('webserial', (config) => {
  const c = (config ?? {}) as Partial<WebSerialConfig>;
  if (!c.port) throw new Error('webserial transport requires a { port } config');
  return new WebSerialTransport(c.port, c.baudRate);
});
