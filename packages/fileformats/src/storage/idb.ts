import { openDB, type IDBPDatabase } from 'idb';

/** Lightweight project metadata; the heavy project blob lives in OPFS. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number;
  /** OPFS key of the project blob this metadata describes. */
  blobKey: string;
  schemaVersion: number;
}

const DB_NAME = 'laserkerf';
const STORE = 'projects';
const UPDATED_INDEX = 'updatedAt';

/** IndexedDB-backed metadata store (fast, indexed queries over small records). */
export class MetaStore {
  private constructor(private readonly db: IDBPDatabase) {}

  static async open(dbName = DB_NAME): Promise<MetaStore> {
    const db = await openDB(dbName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex(UPDATED_INDEX, 'updatedAt');
        }
      },
    });
    return new MetaStore(db);
  }

  async put(meta: ProjectMeta): Promise<void> {
    await this.db.put(STORE, meta);
  }

  async get(id: string): Promise<ProjectMeta | undefined> {
    return (await this.db.get(STORE, id)) as ProjectMeta | undefined;
  }

  async all(): Promise<ProjectMeta[]> {
    return (await this.db.getAll(STORE)) as ProjectMeta[];
  }

  /** Most-recently-updated projects first, via the `updatedAt` index. */
  async recent(limit = 20): Promise<ProjectMeta[]> {
    const ascending = (await this.db.getAllFromIndex(STORE, UPDATED_INDEX)) as ProjectMeta[];
    return ascending.reverse().slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(STORE, id);
  }

  close(): void {
    this.db.close();
  }
}
