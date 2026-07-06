import { describe, expect, it } from 'vitest';
import { defaultCutSettings } from './settings';
import {
  addPreset,
  applyPreset,
  createPreset,
  deserializeLibrary,
  emptyLibrary,
  getPreset,
  removePreset,
  serializeLibrary,
  starterLibrary,
  updatePreset,
} from './material';

const cut = createPreset('a', 'Cut', { mode: 'line', speed: 300, maxPower: 90, passes: 2 });
const engrave = createPreset('b', 'Engrave', { mode: 'fill', speed: 3000, maxPower: 25, interval: 0.1 });

describe('material library CRUD', () => {
  it('adds, gets, updates and removes presets immutably', () => {
    const lib0 = emptyLibrary();
    const lib1 = addPreset(lib0, cut);
    expect(lib0.presets).toHaveLength(0); // original untouched
    expect(lib1.presets).toHaveLength(1);
    expect(getPreset(lib1, 'a')?.name).toBe('Cut');

    const lib2 = addPreset(lib1, engrave);
    expect(lib2.presets).toHaveLength(2);

    const lib3 = updatePreset(lib2, 'a', { name: 'Deep Cut', settings: { passes: 4 } });
    const updated = getPreset(lib3, 'a');
    expect(updated?.name).toBe('Deep Cut');
    expect(updated?.settings.passes).toBe(4);
    expect(updated?.settings.speed).toBe(300); // merged, not replaced

    const lib4 = removePreset(lib3, 'a');
    expect(getPreset(lib4, 'a')).toBeUndefined();
    expect(lib4.presets).toHaveLength(1);
  });

  it('add replaces a preset with the same id', () => {
    const lib = addPreset(addPreset(emptyLibrary(), cut), createPreset('a', 'Replaced', { speed: 1 }));
    expect(lib.presets).toHaveLength(1);
    expect(getPreset(lib, 'a')?.name).toBe('Replaced');
  });
});

describe('applyPreset', () => {
  it('merges preset settings over base cut settings', () => {
    const base = defaultCutSettings({ mode: 'line', speed: 1000, angle: 45 });
    const result = applyPreset(base, engrave);
    expect(result.mode).toBe('fill');
    expect(result.speed).toBe(3000);
    expect(result.interval).toBe(0.1);
    expect(result.angle).toBe(45); // untouched keys survive
  });
});

describe('import/export', () => {
  it('round-trips a library losslessly through JSON', () => {
    const lib = starterLibrary();
    const restored = deserializeLibrary(serializeLibrary(lib));
    expect(restored).toEqual(lib);
  });

  it('drops malformed presets but keeps valid ones', () => {
    const json = JSON.stringify({
      version: 1,
      presets: [
        { id: 'ok', name: 'Good', settings: { speed: 500, bogusKey: 9 } },
        { id: 42, name: 'no id type' },
        'garbage',
        { name: 'missing id', settings: {} },
      ],
    });
    const lib = deserializeLibrary(json);
    expect(lib.presets).toHaveLength(1);
    expect(lib.presets[0].id).toBe('ok');
    // Unknown keys are stripped on import.
    expect('bogusKey' in lib.presets[0].settings).toBe(false);
    expect(lib.presets[0].settings.speed).toBe(500);
  });

  it('throws on input that is not a library', () => {
    expect(() => deserializeLibrary('[]')).toThrow();
    expect(() => deserializeLibrary('{"presets":"nope"}')).toThrow();
  });
});
