import { type ArtLibrary, deserializeArtLibrary, emptyArtLibrary, serializeArtLibrary } from 'scene';
import { OpfsBlobStore } from './opfs';

const KEY = 'art-library.json';

/**
 * OPFS-backed persistence for the art library (M2-T06). One JSON blob that
 * survives offline; injectable OpfsBlobStore so it is testable with the
 * in-memory double.
 */
export class ArtStore {
  constructor(private readonly blobs: OpfsBlobStore) {}

  static async open(): Promise<ArtStore> {
    return new ArtStore(await OpfsBlobStore.open('art'));
  }

  async load(): Promise<ArtLibrary> {
    if (!(await this.blobs.has(KEY))) return emptyArtLibrary();
    const bytes = await this.blobs.readBlob(KEY);
    return deserializeArtLibrary(new TextDecoder().decode(bytes));
  }

  async save(lib: ArtLibrary): Promise<void> {
    await this.blobs.writeBlob(KEY, new TextEncoder().encode(serializeArtLibrary(lib)));
  }
}
