import { describe, expect, it } from 'vitest';
import { createRect } from './factory';
import {
  addArtItem,
  type ArtItem,
  artCategories,
  artItemsByCategory,
  deserializeArtLibrary,
  emptyArtLibrary,
  getArtItem,
  removeArtItem,
  serializeArtLibrary,
} from './art';

const item = (id: string, category = 'Shapes'): ArtItem => ({
  id,
  name: `Item ${id}`,
  category,
  shapes: [createRect(10, 10, { layerId: 'l' })],
});

describe('art library CRUD', () => {
  it('adds, gets and removes items immutably', () => {
    const lib0 = emptyArtLibrary();
    const lib1 = addArtItem(lib0, item('a'));
    expect(lib0.items).toHaveLength(0);
    expect(getArtItem(lib1, 'a')?.name).toBe('Item a');
    expect(getArtItem(removeArtItem(lib1, 'a'), 'a')).toBeUndefined();
  });

  it('groups by category', () => {
    let lib = emptyArtLibrary();
    lib = addArtItem(lib, item('a', 'Icons'));
    lib = addArtItem(lib, item('b', 'Shapes'));
    lib = addArtItem(lib, item('c', 'Icons'));
    expect(artCategories(lib)).toEqual(['Icons', 'Shapes']);
    expect(artItemsByCategory(lib, 'Icons').map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('art library import/export', () => {
  it('round-trips shape geometry losslessly through JSON', () => {
    const lib = addArtItem(emptyArtLibrary(), item('a'));
    expect(deserializeArtLibrary(serializeArtLibrary(lib))).toEqual(lib);
  });

  it('drops malformed items and defaults a missing category', () => {
    const json = JSON.stringify({
      version: 1,
      items: [
        { id: 'ok', name: 'Good', shapes: [{ kind: 'rect' }] },
        { id: 'empty', name: 'No shapes', shapes: [] },
        { id: 'x', name: 'No shapes field' },
        'garbage',
      ],
    });
    const lib = deserializeArtLibrary(json);
    expect(lib.items).toHaveLength(1);
    expect(lib.items[0].id).toBe('ok');
    expect(lib.items[0].category).toBe('Uncategorized');
  });

  it('throws on input that is not an art library', () => {
    expect(() => deserializeArtLibrary('{"items":5}')).toThrow();
  });
});
