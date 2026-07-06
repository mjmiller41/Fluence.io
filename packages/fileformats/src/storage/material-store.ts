import { deserializeLibrary, emptyLibrary, type MaterialLibrary, serializeLibrary } from 'cam';
import { OpfsBlobStore } from './opfs';

const KEY = 'library.json';

/**
 * OPFS-backed persistence for the material library (M2-T04). The library is one
 * small JSON blob that survives offline like project blobs do. Depends only on
 * an OpfsBlobStore, so it is testable with the in-memory OPFS double.
 */
export class MaterialStore {
  constructor(private readonly blobs: OpfsBlobStore) {}

  /** Open against the real origin-private file system (browser only). */
  static async open(): Promise<MaterialStore> {
    return new MaterialStore(await OpfsBlobStore.open('materials'));
  }

  /** Load the saved library, or an empty one if nothing has been saved yet. */
  async load(): Promise<MaterialLibrary> {
    if (!(await this.blobs.has(KEY))) return emptyLibrary();
    const bytes = await this.blobs.readBlob(KEY);
    return deserializeLibrary(new TextDecoder().decode(bytes));
  }

  async save(lib: MaterialLibrary): Promise<void> {
    await this.blobs.writeBlob(KEY, new TextEncoder().encode(serializeLibrary(lib)));
  }
}
