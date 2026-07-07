import { describe, expect, it } from 'vitest';
import type { Transport } from 'device-core';
import { GrblDevice } from './grbl-device';
import { PROFILES } from './profiles';

const enc = new TextEncoder();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A controller emulator that acks lines, answers `?`/`M114`, and records peaks. */
class Emulator implements Transport {
  readonly kind = 'emu';
  isOpen = false;
  pending: string[] = [];
  peakBytes = 0;
  peakCount = 0;
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
    if (data.length === 1) {
      if (data[0] === 0x3f) this.reply('<Run|MPos:3.000,4.000,0.000>');
      return; // other real-time bytes: no response
    }
    this.buf += new TextDecoder().decode(data);
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    for (const l of parts) {
      if (l.trim() === 'M114') {
        this.reply('X:3.00 Y:4.00 Z:0.00 E:0.00 Count X:0');
        this.reply('ok');
        continue;
      }
      this.pending.push(l);
    }
    this.peakBytes = Math.max(this.peakBytes, this.bytes());
    this.peakCount = Math.max(this.peakCount, this.pending.length);
  }
  private bytes(): number {
    return this.pending.reduce((n, l) => n + enc.encode(l).length + 1, 0);
  }
  private reply(text: string): void {
    const b = enc.encode(`${text}\r\n`);
    for (const cb of this.listeners) cb(b);
  }
  ackAll(): void {
    while (this.pending.shift()) this.reply('ok');
  }
}

async function drain(done: Promise<unknown>, emu: Emulator): Promise<void> {
  let settled = false;
  void done.then(() => (settled = true));
  for (let i = 0; i < 1000 && !settled; i++) {
    await tick();
    emu.ackAll();
  }
}

describe('GRBL device-profile conformance (M3-T06)', () => {
  for (const profile of Object.values(PROFILES)) {
    it(`${profile.name}: streams a job under its flow control`, async () => {
      const emu = new Emulator();
      const dev = new GrblDevice(emu, { profile });
      await dev.connect();
      const lines = Array.from({ length: 30 }, (_, i) => `G1 X${i}.000 Y0.000`);
      const handle = dev.stream({ lines });
      await drain(handle.done, emu);
      expect(await handle.done).toEqual({ status: 'completed', linesSent: 30 });

      if (profile.flowControl === 'ping-pong') {
        expect(emu.peakCount).toBeLessThanOrEqual(1); // one line in flight at a time
      } else {
        expect(emu.peakBytes).toBeLessThanOrEqual(profile.bufferSize); // never overflow
        expect(emu.peakCount).toBeGreaterThan(1); // buffer actually pipelined
      }
    });
  }

  it('Marlin polls M114 for position (no real-time ?)', async () => {
    const emu = new Emulator();
    const dev = new GrblDevice(emu, { profile: PROFILES.marlin });
    await dev.connect();
    await dev.requestStatus();
    await tick();
    expect(dev.status().position).toEqual({ x: 3, y: 4, z: 0 });
  });

  it('GRBL exposes the M4 dynamic-laser default, GRBL-M3 uses M3', () => {
    expect(PROFILES.grbl.laser).toBe('M4');
    expect(PROFILES['grbl-m3'].laser).toBe('M3');
    expect(PROFILES.marlin.baud).toBe(250000);
  });
});
