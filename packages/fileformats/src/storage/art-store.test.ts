import { describe, expect, it } from 'vitest';
import { addArtItem, type ArtItem, createEllipse, emptyArtLibrary } from 'scene';
import { OpfsBlobStore } from './opfs';
import { MemoryDirectoryHandle } from './memory-opfs';
import { ArtStore } from './art-store';

const newStore = (): ArtStore =>
  new ArtStore(
    new OpfsBlobStore(new MemoryDirectoryHandle() as unknown as FileSystemDirectoryHandle, 'art'),
  );

const item: ArtItem = {
  id: 'circle',
  name: 'Circle',
  category: 'Shapes',
  shapes: [createEllipse(5, 5, { layerId: 'l' })],
};

describe('ArtStore', () => {
  it('returns an empty library before anything is saved', async () => {
    expect(await newStore().load()).toEqual(emptyArtLibrary());
  });

  it('persists and reloads shape geometry losslessly', async () => {
    const store = newStore();
    const lib = addArtItem(emptyArtLibrary(), item);
    await store.save(lib);
    expect(await store.load()).toEqual(lib);
  });
});
