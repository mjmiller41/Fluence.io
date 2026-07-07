/**
 * GRBL response parsing — pure, transport-agnostic (no I/O). Turns a line of
 * controller text into a typed {@link GrblResponse}, and provides the real-time
 * command bytes GRBL reads out-of-band from the serial stream. The streaming
 * device (`grbl-device.ts`) consumes these; the codec itself never touches a
 * transport (CLAUDE.md invariant 2).
 */
import type { MachineState, Vec3 } from 'device-core';

/** Real-time command bytes (sent raw, bypassing the line buffer). */
export const REALTIME = {
  STATUS: 0x3f, // '?'
  HOLD: 0x21, // '!'  feed-hold
  RESUME: 0x7e, // '~'  cycle-start/resume
  RESET: 0x18, // Ctrl-X soft reset
  JOG_CANCEL: 0x85, // cancel an in-progress jog (GRBL 1.1)
} as const;

export type GrblResponse =
  | { type: 'ok' }
  | { type: 'error'; code: number }
  | { type: 'alarm'; code: number }
  | { type: 'status'; state: MachineState; raw: string; mpos?: Vec3; wpos?: Vec3 }
  | { type: 'welcome'; version: string }
  | { type: 'message'; text: string };

const STATE_MAP: Record<string, MachineState> = {
  Idle: 'idle',
  Run: 'run',
  Hold: 'hold',
  Jog: 'jog',
  Home: 'home',
  Alarm: 'alarm',
  Door: 'hold',
  Check: 'run',
  Sleep: 'idle',
};

function toVec3(csv: string): Vec3 | undefined {
  const n = csv.split(',').map(Number);
  if (n.length < 2 || n.some((v) => !Number.isFinite(v))) return undefined;
  return { x: n[0], y: n[1], z: n[2] };
}

/** Parse a GRBL status report like `<Idle|MPos:0.000,0.000,0.000|FS:0,0>`. */
function parseStatus(t: string): GrblResponse {
  const inner = t.slice(1, -1);
  const parts = inner.split('|');
  const rawState = parts[0].split(':')[0]; // e.g. "Hold:0" → "Hold"
  let mpos: Vec3 | undefined;
  let wpos: Vec3 | undefined;
  for (const p of parts.slice(1)) {
    const idx = p.indexOf(':');
    if (idx < 0) continue;
    const key = p.slice(0, idx);
    const val = p.slice(idx + 1);
    if (key === 'MPos') mpos = toVec3(val);
    else if (key === 'WPos') wpos = toVec3(val);
  }
  return { type: 'status', state: STATE_MAP[rawState] ?? 'idle', raw: rawState, mpos, wpos };
}

/** Parse one line of GRBL output. Returns null for blank lines. */
export function parseResponse(line: string): GrblResponse | null {
  const t = line.trim();
  if (t === '') return null;
  if (t === 'ok') return { type: 'ok' };
  const err = /^error:(\d+)/.exec(t);
  if (err) return { type: 'error', code: Number(err[1]) };
  const alarm = /^ALARM:(\d+)/.exec(t);
  if (alarm) return { type: 'alarm', code: Number(alarm[1]) };
  if (t.startsWith('<') && t.endsWith('>')) return parseStatus(t);
  const welcome = /^Grbl\s+(\S+)/.exec(t);
  if (welcome) return { type: 'welcome', version: welcome[1] };
  return { type: 'message', text: t };
}

/**
 * Split a rolling byte/text buffer into complete lines, returning the finished
 * lines and the leftover partial. GRBL terminates lines with `\r\n` or `\n`.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}
