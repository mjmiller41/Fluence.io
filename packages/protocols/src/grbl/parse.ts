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
  // Marlin M114 position report: "X:0.00 Y:0.00 Z:0.00 E:0.00 Count ...".
  const m114 = /^X:(-?[\d.]+)\s+Y:(-?[\d.]+)\s+Z:(-?[\d.]+)/.exec(t);
  if (m114) {
    return {
      type: 'status',
      state: 'idle',
      raw: 'Marlin',
      mpos: { x: Number(m114[1]), y: Number(m114[2]), z: Number(m114[3]) },
    };
  }
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

/** GRBL 1.1 error codes → human text (documented constants). */
const ERROR_MESSAGES: Record<number, string> = {
  1: 'Expected command letter',
  2: 'Bad number format',
  3: 'Invalid $ statement',
  4: 'Negative value',
  5: 'Homing not enabled',
  6: 'Step pulse too short',
  7: 'EEPROM read failed; defaults restored',
  8: '$ command needs idle state',
  9: 'G-code locked out during alarm or jog',
  10: 'Soft limits require homing',
  11: 'Max characters per line exceeded',
  12: '$ setting exceeds step rate',
  13: 'Safety door detected as opened',
  14: 'Build info / startup line too long',
  15: 'Jog target exceeds travel',
  16: 'Invalid jog command',
  17: 'Laser mode requires PWM output',
  20: 'Unsupported G/M command',
  21: 'Modal group violation',
  22: 'Feed rate not set',
  23: 'Command value not integer',
  24: 'Two G-code commands use axis words',
  25: 'Repeated G-code word',
  26: 'No axis words in command',
  27: 'Line number out of range',
  28: 'Missing required value word',
  29: 'Unsupported work coordinate system',
  30: 'G53 only valid with G0/G1',
  31: 'Unused axis words',
  32: 'G2/G3 arc needs in-plane axis word',
  33: 'Invalid motion target',
  34: 'Arc radius error',
  35: 'G2/G3 arc needs in-plane offset word',
  36: 'Unused value words',
  37: 'G43.1 dynamic tool-length on wrong axis',
  38: 'Tool number greater than max',
};

/** GRBL 1.1 alarm codes → human text (documented constants). */
const ALARM_MESSAGES: Record<number, string> = {
  1: 'Hard limit triggered',
  2: 'Soft limit: motion target exceeds travel',
  3: 'Reset while in motion; position lost',
  4: 'Probe fail: not in expected initial state',
  5: 'Probe fail: no contact within travel',
  6: 'Homing fail: reset during homing',
  7: 'Homing fail: safety door opened',
  8: 'Homing fail: limit switch not found',
  9: 'Homing fail: limit switch still active after pull-off',
  10: 'Homing fail: dual-axis switch not found',
};

export function errorMessage(code: number): string {
  return ERROR_MESSAGES[code] ?? `Unknown error (${code})`;
}

export function alarmMessage(code: number): string {
  return ALARM_MESSAGES[code] ?? `Unknown alarm (${code})`;
}
