import * as Comlink from 'comlink';
import type { CamApi } from './cam-worker';

export interface CamClient {
  api: Comlink.Remote<CamApi>;
  terminate(): void;
}

/** Spin up the CAM worker and wrap it with Comlink. Terminate when done. */
export function createCamClient(): CamClient {
  const worker = new Worker(new URL('./cam-worker.ts', import.meta.url), { type: 'module' });
  return { api: Comlink.wrap<CamApi>(worker), terminate: () => worker.terminate() };
}
