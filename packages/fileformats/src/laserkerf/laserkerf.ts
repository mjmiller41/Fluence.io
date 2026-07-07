import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Document } from 'scene';

/**
 * `.laserkerf` — the open, versioned project format: a zip of a JSON document
 * (`document.json`). Raster images (M1-T09) are stored inline on the image shape
 * as a data URL, so they round-trip through the JSON; a future revision may split
 * large rasters into separate zip assets. Versioned from day one with a migration
 * hook so older files keep opening (development-plan §1.2).
 */
export const LASERKERF_FORMAT_VERSION = 1;

interface LaserKerfFile {
  app: 'laserkerf';
  formatVersion: number;
  document: Document;
}

export interface LoadedLaserKerf {
  formatVersion: number;
  document: Document;
}

/** Serialize a document to `.laserkerf` bytes (zip of document.json). */
export function serializeLaserKerf(doc: Document): Uint8Array {
  const file: LaserKerfFile = {
    app: 'laserkerf',
    formatVersion: LASERKERF_FORMAT_VERSION,
    document: doc,
  };
  return zipSync({ 'document.json': strToU8(JSON.stringify(file)) }, { level: 6 });
}

/** Parse `.laserkerf` bytes back into a document, migrating older versions. */
export function deserializeLaserKerf(data: Uint8Array): LoadedLaserKerf {
  const entries = unzipSync(data);
  const docEntry = entries['document.json'];
  if (!docEntry) throw new Error('Not a .laserkerf file: document.json is missing');

  const raw = JSON.parse(strFromU8(docEntry)) as Partial<LaserKerfFile>;
  if (raw.app !== 'laserkerf' || typeof raw.formatVersion !== 'number' || !raw.document) {
    throw new Error('Not a valid .laserkerf file');
  }

  const migrated = migrate(raw as LaserKerfFile);
  return { formatVersion: migrated.formatVersion, document: migrated.document };
}

/** Upgrade older documents to the current schema. v1 is current. */
function migrate(file: LaserKerfFile): LaserKerfFile {
  if (file.formatVersion > LASERKERF_FORMAT_VERSION) {
    throw new Error(
      `.laserkerf v${file.formatVersion} is newer than supported (v${LASERKERF_FORMAT_VERSION}); please update LaserKerf`,
    );
  }
  // Future: if (file.formatVersion < N) file = upgradeToN(file);
  return { ...file, formatVersion: LASERKERF_FORMAT_VERSION };
}
