import { describe, expect, it } from 'vitest';
import { addPreset, createPreset, emptyLibrary, starterLibrary } from 'cam';
import { OpfsBlobStore } from './opfs';
import { MemoryDirectoryHandle } from './memory-opfs';
import { MaterialStore } from './material-store';

const newStore = (): MaterialStore =>
  new MaterialStore(
    new OpfsBlobStore(new MemoryDirectoryHandle() as unknown as FileSystemDirectoryHandle, 'materials'),
  );

describe('MaterialStore', () => {
  it('returns an empty library before anything is saved', async () => {
    expect(await newStore().load()).toEqual(emptyLibrary());
  });

  it('persists and reloads a library losslessly', async () => {
    const store = newStore();
    const lib = addPreset(starterLibrary(), createPreset('x', 'Custom', { speed: 555, passes: 2 }));
    await store.save(lib);
    expect(await store.load()).toEqual(lib);
  });

  it('overwrites on re-save', async () => {
    const store = newStore();
    await store.save(addPreset(emptyLibrary(), createPreset('a', 'A', {})));
    await store.save(addPreset(emptyLibrary(), createPreset('b', 'B', {})));
    const lib = await store.load();
    expect(lib.presets.map((p) => p.id)).toEqual(['b']);
  });
});
