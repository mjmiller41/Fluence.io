import { describe, expect, it } from 'vitest';
import { transports } from './transport';
import { type SerialPortLike, WebSerialTransport } from './webserial-transport';

/** A mock SerialPort backed by real web streams (Node 20 provides them globally). */
class MockPort implements SerialPortLike {
  opened = false;
  baud = 0;
  written: number[][] = [];
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readable: ReadableStream<Uint8Array> | null = new ReadableStream<Uint8Array>({
    start: (c) => {
      this.controller = c;
    },
  });
  writable: WritableStream<Uint8Array> | null = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.written.push(Array.from(chunk));
    },
  });

  async open(options: { baudRate: number }): Promise<void> {
    this.opened = true;
    this.baud = options.baudRate;
  }
  async close(): Promise<void> {
    this.opened = false;
    try {
      this.controller.close();
    } catch {
      /* already closed */
    }
  }
  getInfo(): { usbVendorId?: number } {
    return { usbVendorId: 0x0483 };
  }
  /** Test helper: deliver inbound bytes. */
  push(bytes: number[]): void {
    this.controller.enqueue(new Uint8Array(bytes));
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('WebSerialTransport', () => {
  it('opens at the baud rate and reports isOpen/info', async () => {
    const port = new MockPort();
    const t = new WebSerialTransport(port, 115200);
    expect(t.isOpen).toBe(false);
    await t.open();
    expect(port.opened).toBe(true);
    expect(port.baud).toBe(115200);
    expect(t.isOpen).toBe(true);
    expect(t.info().usbVendorId).toBe(0x0483);
    await t.close();
  });

  it('pumps inbound bytes to subscribers and honours unsubscribe', async () => {
    const port = new MockPort();
    const t = new WebSerialTransport(port);
    const chunks: number[][] = [];
    const off = t.onData((c) => chunks.push(Array.from(c)));
    await t.open();

    port.push([1, 2, 3]);
    await tick();
    expect(chunks).toEqual([[1, 2, 3]]);

    off();
    port.push([9]);
    await tick();
    expect(chunks).toEqual([[1, 2, 3]]); // unsubscribed → nothing more

    await t.close();
  });

  it('writes outbound bytes and rejects writes when closed', async () => {
    const port = new MockPort();
    const t = new WebSerialTransport(port);
    await t.open();
    await t.write(new Uint8Array([0x3f, 0x0a])); // "?\n"
    expect(port.written).toEqual([[0x3f, 0x0a]]);
    await t.close();
    expect(t.isOpen).toBe(false);
    await expect(t.write(new Uint8Array([1]))).rejects.toThrow(/not open/);
  });

  it('is registered in the process-wide transport registry', async () => {
    expect(transports.has('webserial')).toBe(true);
    const t = await transports.create('webserial', { port: new MockPort(), baudRate: 115200 });
    expect(t.kind).toBe('webserial');
    await expect(transports.create('webserial', {})).rejects.toThrow(/requires a \{ port \}/);
  });
});
