export interface JobSettings {
  units: 'mm' | 'inch';
  feedMmPerMin: number;
  power: number;
}

/**
 * Placeholder GRBL preamble emitter for the M0 golden harness. The real CAM
 * G-code generator lands in M2 (M2-T08); this exists only so the golden-output
 * pipeline is proven end to end against a committed fixture.
 */
export function emitGcodeHeader(s: JobSettings): string {
  const unitsLine = s.units === 'mm' ? 'G21 ; millimetres' : 'G20 ; inches';
  return (
    [
      '; LaserKerf M0 golden sample -- GRBL header',
      unitsLine,
      'G90 ; absolute positioning',
      'M5 ; laser off',
      `F${s.feedMmPerMin}`,
      `S${s.power}`,
    ].join('\n') + '\n'
  );
}
