import type { CutSettings, Toolpath } from 'cam';
import type { Vec2 } from 'scene';
import { toMachineMm, type Workspace } from '../coordinate/coordinate';

/**
 * GRBL G-code emitter (development-plan §4.3, M2-T08). Machine output is golden —
 * any change here must match or deliberately update the committed fixtures.
 */
export interface MachineConfig {
  units: 'mm' | 'inch';
  /** Max spindle/laser S value (GRBL power scale), e.g. 1000. */
  powerMax: number;
  /** 'M4' = dynamic power (recommended for lasers); 'M3' = constant. */
  laserMode: 'M3' | 'M4';
  /** Rapid-travel feed (mm/min) — used for the time estimate, not emitted. */
  travelSpeed: number;
  /** Return to origin at end of job. */
  returnToOrigin: boolean;
}

export function defaultMachine(over: Partial<MachineConfig> = {}): MachineConfig {
  return { units: 'mm', powerMax: 1000, laserMode: 'M4', travelSpeed: 6000, returnToOrigin: true, ...over };
}

export interface GcodeOperation {
  settings: CutSettings;
  toolpaths: Toolpath[];
}

export interface GcodeJob {
  operations: GcodeOperation[];
}

const fmt = (n: number): string => {
  const v = Math.round(n * 1000) / 1000;
  return (v === 0 ? 0 : v).toString();
};

const unitScale = (units: MachineConfig['units']): number => (units === 'inch' ? 1 / 25.4 : 1);

/**
 * Emit GRBL G-code for a job. Deterministic (golden-tested).
 *
 * `workspace` (optional) maps design points to the machine home corner via the
 * coordinate harness (M2-T07). It is design-space (mm, so its unit conversion is
 * a no-op) — only the origin/axis mapping applies; `machine.units` then scales
 * the result for output. Omitting it (or a front-left workspace) is the identity,
 * so existing golden fixtures are unaffected.
 */
export function emitGcode(
  job: GcodeJob,
  machine: MachineConfig = defaultMachine(),
  workspace?: Workspace,
): string {
  const scale = unitScale(machine.units);
  const xy = (p: Vec2): string => {
    const m = workspace ? toMachineMm(p, workspace) : p;
    return `X${fmt(m.x * scale)} Y${fmt(m.y * scale)}`;
  };
  const lines: string[] = [
    '; Fluence G-code',
    machine.units === 'mm' ? 'G21' : 'G20',
    'G90',
    'M5',
  ];

  for (const op of job.operations) {
    const power = Math.round((op.settings.maxPower / 100) * machine.powerMax);
    const feed = Math.round(op.settings.speed * scale);
    for (let pass = 0; pass < Math.max(1, op.settings.passes); pass++) {
      for (const tp of op.toolpaths) {
        if (tp.points.length < 2) continue;
        lines.push(`G0 ${xy(tp.points[0])}`);
        lines.push(`${machine.laserMode} S${power}`);
        lines.push(`G1 ${xy(tp.points[1])} F${feed}`);
        for (let i = 2; i < tp.points.length; i++) lines.push(`G1 ${xy(tp.points[i])}`);
        lines.push('M5');
      }
    }
  }

  lines.push('M5');
  if (machine.returnToOrigin) lines.push('G0 X0 Y0');
  lines.push('; end');
  return lines.join('\n') + '\n';
}
