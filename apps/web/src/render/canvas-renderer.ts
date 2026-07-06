import * as Comlink from 'comlink';
import type { LineBatch } from 'scene';
import type { RendererApi, Viewport } from './renderer-worker';

/**
 * Main-thread handle to the WebGL2 render worker. Ownership of the canvas is
 * transferred to the worker via OffscreenCanvas, so all GL work runs off the
 * main thread (CLAUDE.md invariant 4).
 */
export class CanvasRenderer {
  private readonly worker: Worker;
  private readonly api: Comlink.Remote<RendererApi>;
  private readonly ready: Promise<unknown>;

  constructor(canvas: HTMLCanvasElement) {
    this.worker = new Worker(new URL('./renderer-worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<RendererApi>(this.worker);
    const offscreen = canvas.transferControlToOffscreen();
    this.ready = this.api.init(Comlink.transfer(offscreen, [offscreen]));
  }

  async draw(batches: LineBatch[], viewport: Viewport, selection?: Float32Array): Promise<void> {
    await this.ready;
    await this.api.draw(batches, viewport, selection);
  }

  destroy(): void {
    this.worker.terminate();
  }
}
