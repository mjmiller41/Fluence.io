import { OpfsBlobStore } from './opfs';
import { MetaStore, type ProjectMeta } from './idb';

/**
 * Facade tying the two storage tiers together: project blobs in OPFS, metadata
 * in IndexedDB. This is the seam the `.laserkerf` format (M1-T11) will serialize
 * into; for M0 it round-trips opaque bytes so the storage layer can be verified
 * end to end.
 */
export class ProjectStore {
  constructor(
    private readonly blobs: OpfsBlobStore,
    private readonly meta: MetaStore,
  ) {}

  /** Open against the real OPFS + IndexedDB (browser only). */
  static async open(): Promise<ProjectStore> {
    const [blobs, meta] = await Promise.all([OpfsBlobStore.open('projects'), MetaStore.open()]);
    return new ProjectStore(blobs, meta);
  }

  async save(
    id: string,
    name: string,
    bytes: Uint8Array,
    schemaVersion = 1,
    now = Date.now(),
  ): Promise<ProjectMeta> {
    const blobKey = `project__${id}`;
    await this.blobs.writeBlob(blobKey, bytes);
    const existing = await this.meta.get(id);
    const meta: ProjectMeta = {
      id,
      name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sizeBytes: bytes.byteLength,
      blobKey,
      schemaVersion,
    };
    await this.meta.put(meta);
    return meta;
  }

  async load(id: string): Promise<{ meta: ProjectMeta; bytes: Uint8Array } | null> {
    const meta = await this.meta.get(id);
    if (!meta) return null;
    const bytes = await this.blobs.readBlob(meta.blobKey);
    return { meta, bytes };
  }

  /** Project metadata, most-recently-updated first. */
  async list(): Promise<ProjectMeta[]> {
    return this.meta.recent(100);
  }

  async remove(id: string): Promise<void> {
    const meta = await this.meta.get(id);
    if (meta) await this.blobs.deleteBlob(meta.blobKey);
    await this.meta.delete(id);
  }
}
