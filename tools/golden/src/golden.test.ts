/// <reference types="node" />
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { assertGolden } from './golden';

const dir = mkdtempSync(join(tmpdir(), 'laserkerf-golden-'));

describe('assertGolden', () => {
  afterAll(() => {
    // temp dir is under the OS tmp; left for the OS to reap.
  });

  it('passes when bytes match the fixture', () => {
    const path = join(dir, 'match.bin');
    writeFileSync(path, 'G21\nG90\n');
    expect(() => assertGolden(path, 'G21\nG90\n')).not.toThrow();
  });

  it('throws a helpful error on mismatch', () => {
    const path = join(dir, 'mismatch.bin');
    writeFileSync(path, 'G21\nG90\n');
    expect(() => assertGolden(path, 'G20\nG90\n')).toThrow(/Golden mismatch/);
  });

  it('creates the fixture on first run, then throws to force a second verifying run', () => {
    const path = join(dir, 'new-fixture.bin');
    expect(() => assertGolden(path, 'hello')).toThrow(/did not exist and was created/);
    // second run now verifies against the freshly-written fixture
    expect(() => assertGolden(path, 'hello')).not.toThrow();
  });
});
