import type { Shape } from './shape';

/**
 * Art library (M2-T06): reusable clip-art / shape groups, organised by category.
 * An item stores a scene-shape fragment (plain JSON data, like the document
 * body), so it serialises losslessly. Pure and immutable — CRUD returns a new
 * library. Persistence lives in `fileformats` (ArtStore); this is just the model
 * so the editor can consume it without pulling in the codec bundle.
 */
export interface ArtItem {
  id: string;
  name: string;
  category: string;
  /** Reusable shapes in art-local coordinates (re-id'd on insertion). */
  shapes: Shape[];
  createdAt?: number;
}

export interface ArtLibrary {
  version: number;
  items: ArtItem[];
}

export const ART_LIBRARY_VERSION = 1;

export function emptyArtLibrary(): ArtLibrary {
  return { version: ART_LIBRARY_VERSION, items: [] };
}

export function getArtItem(lib: ArtLibrary, id: string): ArtItem | undefined {
  return lib.items.find((i) => i.id === id);
}

/** Add an item (replacing any with the same id). */
export function addArtItem(lib: ArtLibrary, item: ArtItem): ArtLibrary {
  const items = lib.items.filter((i) => i.id !== item.id);
  items.push(item);
  return { ...lib, items };
}

export function removeArtItem(lib: ArtLibrary, id: string): ArtLibrary {
  return { ...lib, items: lib.items.filter((i) => i.id !== id) };
}

/** Distinct categories present, sorted. */
export function artCategories(lib: ArtLibrary): string[] {
  return [...new Set(lib.items.map((i) => i.category))].sort();
}

export function artItemsByCategory(lib: ArtLibrary, category: string): ArtItem[] {
  return lib.items.filter((i) => i.category === category);
}

export function serializeArtLibrary(lib: ArtLibrary): string {
  return JSON.stringify({ version: ART_LIBRARY_VERSION, items: lib.items }, null, 2);
}

function sanitizeItem(raw: unknown): ArtItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== 'string' || typeof src.name !== 'string') return null;
  if (!Array.isArray(src.shapes) || src.shapes.length === 0) return null;
  const item: ArtItem = {
    id: src.id,
    name: src.name,
    category: typeof src.category === 'string' ? src.category : 'Uncategorized',
    shapes: src.shapes as Shape[],
  };
  if (typeof src.createdAt === 'number') item.createdAt = src.createdAt;
  return item;
}

/**
 * Parse an art library, dropping malformed items. Throws only when the top-level
 * shape is not a library object, so a partially-corrupt file still imports what
 * it can.
 */
export function deserializeArtLibrary(json: string): ArtLibrary {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new Error('Not an art library');
  }
  const items = (parsed as { items: unknown[] }).items
    .map(sanitizeItem)
    .filter((i): i is ArtItem => i !== null);
  return { version: ART_LIBRARY_VERSION, items };
}
