import { describe, expect, it } from 'vitest';
import type { Transport } from 'device-core';
import { type ConsoleEntry, GrblDevice } from './grbl-device';
import { alarmMessage, errorMessage, REALTIME } from './parse';

const enc = new TextEncoder();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * A mock GRBL controller. It receives streamed lines, tracks the bytes resident
 * in its RX buffer (received but not yet acked), records the peak, and lets the
 * test acknowledge lines one at a time or all at once.
 */
class MockGrbl implements Transport {
  readonly kind = 'mock';
  isOpen = false;
  pending: string[] = [];
  realtime: number[] = [];
  peakBytes = 0;
  private buf = '';
  private readonly listeners = new Set<(c: Uint8Array) => void>();

  async open(): Promise<void> {
    this.isOpen = true;
  }
  async close(): Promise<void> {
    this.isOpen = false;
  }
  onData(cb: (c: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async write(data: Uint8Array): Promise<void> {
    if (data.length === 1 && [0x3f, 0x21, 0x7e, 0x18, 0x85].includes(data[0])) {
      this.realtime.push(data[0]);
      if (data[0] === REALTIME.STATUS) this.reply('<Run|MPos:1.000,2.000,0.000>');
      return;
    }
    this.buf += new TextDecoder().decode(data);
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    for (const l of parts) this.pending.push(l);
    this.peakBytes = Math.max(this.peakBytes, this.pendingBytes());
  }
  private pendingBytes(): number {
    return this.pending.reduce((n, l) => n + enc.encode(l).length + 1, 0);
  }
  reply(text: string): void {
    const bytes = enc.encode(`${text}\r\n`);
    for (const cb of this.listeners) cb(bytes);
  }
  ackOne(): void {
    if (this.pending.shift()) this.reply('ok');
  }
  ackAll(): void {
    while (this.pending.length > 0) this.ackOne();
  }
}

async function drain(done: Promise<unknown>, mock: MockGrbl): Promise<void> {
  let settled = false;
  void done.then(() => (settled = true));
  for (let i = 0; i < 500 && !settled; i++) {
    await tick();
    mock.ackAll();
  }
}

describe('GrblDevice streaming (char-counting)', () => {
  it('streams every line and never overflows the RX buffer', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 40 });
    await dev.connect();
    const lines = Array.from({ length: 30 }, (_, i) => `G1 X${i}.000 Y0.000`); // > buffer total
    const handle = dev.stream({ lines });
    await drain(handle.done, mock);
    const result = await handle.done;
    expect(result).toEqual({ status: 'completed', linesSent: 30 });
    expect(handle.totalLines).toBe(30);
    // Char-counting held the in-flight bytes within the buffer at all times...
    expect(mock.peakBytes).toBeLessThanOrEqual(40);
    // ...and actually filled it (not a slow one-line-at-a-time trickle).
    expect(mock.peakBytes).toBeGreaterThan(20);
  });

  it('completes an empty job immediately', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    await dev.connect();
    const handle = dev.stream({ lines: [] });
    expect(await handle.done).toEqual({ status: 'completed', linesSent: 0 });
  });

  it('faults the job on a GRBL error response', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 100 });
    await dev.connect();
    const handle = dev.stream({ lines: ['G1 X1', 'BAD', 'G1 X2'] });
    await tick();
    mock.pending.shift(); // first line accepted
    mock.reply('ok');
    await tick();
    mock.pending.shift(); // second line rejected
    mock.reply('error:20');
    const result = await handle.done;
    expect(result.status).toBe('faulted');
    expect(dev.status().state).toBe('error');
  });

  it('faults on an ALARM during a job', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 100 });
    await dev.connect();
    const handle = dev.stream({ lines: ['G1 X1', 'G1 X2'] });
    await tick();
    mock.reply('ALARM:1');
    const result = await handle.done;
    expect(result.status).toBe('faulted');
    expect(dev.status().message).toContain('ALARM:1');
  });

  it('pauses on hold and continues on resume', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 20 });
    await dev.connect();
    const lines = Array.from({ length: 10 }, (_, i) => `G1 X${i}`);
    const handle = dev.stream({ lines });
    await tick();
    await dev.hold();
    expect(mock.realtime).toContain(REALTIME.HOLD);
    // Drain what is already in flight; held → no new lines beyond the buffer.
    mock.ackAll();
    await tick();
    const sentWhileHeld = dev.status().progress;
    await tick();
    mock.ackAll();
    expect(dev.status().progress).toBeCloseTo(sentWhileHeld, 5); // no progress while held

    await dev.resume();
    expect(mock.realtime).toContain(REALTIME.RESUME);
    await drain(handle.done, mock);
    expect((await handle.done).status).toBe('completed');
  });

  it('updates position from a status report', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    await dev.connect();
    await dev.requestStatus();
    await tick();
    expect(dev.status().position).toEqual({ x: 1, y: 2, z: 0 });
  });

  it('sends a soft-reset and stops the job on stop()', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 20 });
    await dev.connect();
    const handle = dev.stream({ lines: Array.from({ length: 10 }, (_, i) => `G1 X${i}`) });
    await tick();
    await dev.stop();
    expect(mock.realtime).toContain(REALTIME.RESET);
    expect((await handle.done).status).toBe('stopped');
  });
});

describe('GrblDevice real-time controls (M3-T03)', () => {
  it('polls ? on an interval and stops cleanly', async () => {
    const captured: Array<() => void> = [];
    let cleared = false;
    const timers = {
      set: (fn: () => void) => {
        captured.push(fn);
        return 1;
      },
      clear: () => {
        cleared = true;
      },
    };
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { timers });
    await dev.connect();
    dev.startStatusPoll(200);
    captured[0]?.();
    captured[0]?.();
    await tick();
    // Two poll ticks → two '?' real-time bytes.
    expect(mock.realtime.filter((b) => b === REALTIME.STATUS)).toHaveLength(2);
    dev.stopStatusPoll();
    expect(cleared).toBe(true);
  });

  it('decodes error and alarm codes to human text on fault (M3-T04)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 100 });
    await dev.connect();
    const h = dev.stream({ lines: ['G1 X1'] });
    await tick();
    mock.pending.shift();
    mock.reply('error:20');
    await h.done;
    expect(dev.status().message).toBe(`error:20 — ${errorMessage(20)}`);
    expect(errorMessage(20)).toBe('Unsupported G/M command');
    expect(alarmMessage(1)).toBe('Hard limit triggered');
  });

  it('streams a raw TX/RX console (M3-T04)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    const log: ConsoleEntry[] = [];
    dev.onConsole((e) => log.push(e));
    await dev.connect();
    const h = dev.stream({ lines: ['G0 X5'] });
    await tick();
    mock.ackAll();
    await h.done;
    await dev.requestStatus();
    await tick();
    expect(log).toContainEqual({ dir: 'tx', text: 'G0 X5' });
    expect(log).toContainEqual({ dir: 'rx', text: 'ok' });
    expect(log).toContainEqual({ dir: 'tx', text: '?' }); // real-time byte symbol
  });

  it('reconnects after a transport drop (M3-T04)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    await dev.connect();
    await mock.close();
    await dev.reconnect();
    expect(mock.isOpen).toBe(true);
    expect(dev.status().state).toBe('idle');
    // Streaming works again after reconnect.
    const h = dev.stream({ lines: ['G0 X0'] });
    await tick();
    mock.ackAll();
    expect((await h.done).status).toBe('completed');
  });

  it('frames the bounds as a laser-off rapid box (M3-T05)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    const tx: string[] = [];
    dev.onConsole((e) => e.dir === 'tx' && tx.push(e.text));
    await dev.connect();
    await dev.frame({ min: { x: 0, y: 0 }, max: { x: 100, y: 50 } });
    // G90 + 5 rapid corners (min→max→back to start), no laser S word.
    expect(tx).toEqual([
      'G90',
      'G0 X0.000 Y0.000',
      'G0 X100.000 Y0.000',
      'G0 X100.000 Y50.000',
      'G0 X0.000 Y50.000',
      'G0 X0.000 Y0.000',
    ]);
    expect(tx.some((l) => /S\d/.test(l))).toBe(false);
  });

  it('runs a low-power outline when power is given (M3-T05)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    const tx: string[] = [];
    dev.onConsole((e) => e.dir === 'tx' && tx.push(e.text));
    await dev.connect();
    await dev.frame({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, { power: 20, feed: 2000 });
    expect(tx).toContain('M3 S20');
    expect(tx).toContain('M5');
    expect(tx.some((l) => l.startsWith('G1') && l.includes('F2000'))).toBe(true);
  });

  it('homes with $H and sets the work origin with G10 L20 (M3-T05)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    const tx: string[] = [];
    dev.onConsole((e) => e.dir === 'tx' && tx.push(e.text));
    await dev.connect();
    await dev.home();
    await dev.setWorkOrigin();
    expect(tx).toContain('$H');
    expect(tx).toContain('G10 L20 P0 X0 Y0');
  });

  it('cancels a jog with the real-time byte', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock);
    await dev.connect();
    await dev.cancelJog();
    expect(mock.realtime).toContain(REALTIME.JOG_CANCEL);
  });

  it('sends a hold real-time byte during a stream (bypasses the line buffer)', async () => {
    const mock = new MockGrbl();
    const dev = new GrblDevice(mock, { bufferSize: 16 });
    await dev.connect();
    // Many lines queued; buffer tiny so most are still pending.
    dev.stream({ lines: Array.from({ length: 50 }, (_, i) => `G1 X${i}.000`) });
    await tick();
    expect(mock.pending.length).toBeGreaterThan(0); // job not drained
    await dev.hold();
    // The '!' reached the controller even though line writes are still outstanding.
    expect(mock.realtime).toContain(REALTIME.HOLD);
  });
});
