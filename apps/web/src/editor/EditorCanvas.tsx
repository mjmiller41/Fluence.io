import { type PointerEvent as RPointerEvent, useEffect, useRef, type WheelEvent as RWheelEvent } from 'react';
import {
  createEllipse,
  createPolygon,
  createRect,
  type Rect,
  type Shape,
  shapeBounds,
  sceneToLineBatches,
  translatedShape,
  type LineBatch,
  type Vec2,
} from 'scene';
import { CanvasRenderer } from '../render/canvas-renderer';
import type { Viewport } from '../render/renderer-worker';
import { useEditor } from './store';

function rectSegments(r: Rect): number[] {
  const x2 = r.x + r.width;
  const y2 = r.y + r.height;
  return [r.x, r.y, x2, r.y, x2, r.y, x2, y2, x2, y2, r.x, y2, r.x, y2, r.x, r.y];
}

interface View {
  panX: number;
  panY: number;
  zoom: number;
}

interface PointerState {
  mode: 'none' | 'pan' | 'move' | 'draw';
  startDoc: Vec2;
  originals: Shape[];
}

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const view = useRef<View>({ panX: 40, panY: 560, zoom: 1 });
  const size = useRef({ w: 800, h: 600, dpr: 1 });
  const pointer = useRef<PointerState>({ mode: 'none', startDoc: { x: 0, y: 0 }, originals: [] });
  const previewBatch = useRef<LineBatch | null>(null);
  const rafPending = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // No OffscreenCanvas (e.g. jsdom unit tests): render is a no-op; the editor
    // state still functions and is exercised by the Playwright suite in Chromium.
    if (typeof canvas.transferControlToOffscreen !== 'function') return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const measure = (): void => {
      const parent = canvas.parentElement;
      const rect = parent?.getBoundingClientRect();
      size.current = {
        w: rect?.width ?? 800,
        h: rect?.height ?? 600,
        dpr: globalThis.devicePixelRatio || 1,
      };
      canvas.style.width = `${size.current.w}px`;
      canvas.style.height = `${size.current.h}px`;
    };

    measure();
    fitToBed();
    scheduleDraw();

    const ro = new ResizeObserver(() => {
      measure();
      scheduleDraw();
    });
    ro.observe(canvas.parentElement ?? canvas);

    const unsub = useEditor.subscribe(() => scheduleDraw());
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') useEditor.getState().deleteSelection();
      else if (e.key === 'Escape') useEditor.getState().select([]);
      else if (mod && key === 'a') {
        e.preventDefault();
        useEditor.getState().selectAll();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    globalThis.addEventListener('keydown', onKey);

    return () => {
      ro.disconnect();
      unsub();
      globalThis.removeEventListener('keydown', onKey);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  function fitToBed(): void {
    const doc = useEditor.getState().doc;
    const { w: cw, h: ch } = size.current;
    const zoom = Math.min(cw / doc.width, ch / doc.height) * 0.85 || 1;
    view.current = {
      zoom,
      panX: cw / 2 - (doc.width / 2) * zoom,
      panY: ch / 2 + (doc.height / 2) * zoom,
    };
  }

  function screenToDoc(sx: number, sy: number): Vec2 {
    const v = view.current;
    return { x: (sx - v.panX) / v.zoom, y: (v.panY - sy) / v.zoom };
  }

  function scheduleDraw(): void {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      draw();
    });
  }

  function draw(): void {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const { doc, selection, gcode, showGcodePreview, version } = useEditor.getState();

    const bed: LineBatch = {
      layerId: '__bed',
      color: '#223040',
      segments: new Float32Array(rectSegments({ x: 0, y: 0, width: doc.width, height: doc.height })),
    };
    const batches = [bed, ...sceneToLineBatches(doc, 0.1)];

    // G-code simulation overlay: travel (dim) under cut (cyan). Hidden once the
    // design changes out from under the last-generated result (version drift).
    if (showGcodePreview && gcode && gcode.version === version) {
      const cut: number[] = [];
      const travel: number[] = [];
      for (const seg of gcode.sim.segments) {
        const bucket = seg.cut ? cut : travel;
        bucket.push(seg.from.x, seg.from.y, seg.to.x, seg.to.y);
      }
      batches.push({ layerId: '__travel', color: '#3a4c63', segments: new Float32Array(travel) });
      batches.push({ layerId: '__cut', color: '#22d3ee', segments: new Float32Array(cut) });
    }

    if (previewBatch.current) batches.push(previewBatch.current);

    const selSegments: number[] = [];
    for (const id of selection) {
      const shape = doc.shapes.find((s) => s.id === id);
      if (!shape) continue;
      const b = shapeBounds(shape);
      if (b) selSegments.push(...rectSegments(b));
    }

    const viewport: Viewport = {
      panX: view.current.panX,
      panY: view.current.panY,
      zoom: view.current.zoom,
      width: size.current.w,
      height: size.current.h,
      dpr: size.current.dpr,
    };
    void renderer.draw(batches, viewport, new Float32Array(selSegments));
  }

  function hitTest(p: Vec2): Shape | null {
    const { doc } = useEditor.getState();
    for (let i = doc.shapes.length - 1; i >= 0; i--) {
      const shape = doc.shapes[i];
      const b = shapeBounds(shape);
      if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
        return shape;
      }
    }
    return null;
  }

  const onWheel = (e: RWheelEvent): void => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToDoc(sx, sy);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    v.zoom = Math.max(0.05, Math.min(200, v.zoom * factor));
    v.panX = sx - before.x * v.zoom;
    v.panY = sy + before.y * v.zoom;
    scheduleDraw();
  };

  const onPointerDown = (e: RPointerEvent): void => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const doc = screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
    const state = useEditor.getState();

    if (state.tool === 'select') {
      const hit = hitTest(doc);
      if (hit) {
        if (!state.selection.includes(hit.id)) state.select([hit.id]);
        pointer.current = {
          mode: 'move',
          startDoc: doc,
          originals: state.selectedShapes().map((s) => ({ ...s })),
        };
      } else {
        if (!e.shiftKey) state.select([]);
        pointer.current = { mode: 'pan', startDoc: { x: e.clientX, y: e.clientY }, originals: [] };
      }
    } else {
      pointer.current = { mode: 'draw', startDoc: doc, originals: [] };
    }
  };

  const onPointerMove = (e: RPointerEvent): void => {
    const ps = pointer.current;
    if (ps.mode === 'none') return;
    const rect = canvasRef.current!.getBoundingClientRect();

    if (ps.mode === 'pan') {
      view.current.panX += e.clientX - ps.startDoc.x;
      view.current.panY += e.clientY - ps.startDoc.y;
      ps.startDoc = { x: e.clientX, y: e.clientY };
      scheduleDraw();
      return;
    }

    const doc = screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
    if (ps.mode === 'move') {
      const dx = Math.round(doc.x - ps.startDoc.x);
      const dy = Math.round(doc.y - ps.startDoc.y);
      const store = useEditor.getState();
      for (const original of ps.originals) store.previewUpdate(translatedShape(original, dx, dy));
    } else if (ps.mode === 'draw') {
      previewBatch.current = {
        layerId: '__preview',
        color: '#f0653a',
        segments: new Float32Array(
          rectSegments(normalizeRect(ps.startDoc, doc)),
        ),
      };
      scheduleDraw();
    }
  };

  const onPointerUp = (e: RPointerEvent): void => {
    const ps = pointer.current;
    const rect = canvasRef.current!.getBoundingClientRect();
    const doc = screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
    const store = useEditor.getState();

    if (ps.mode === 'draw') {
      const r = normalizeRect(ps.startDoc, doc);
      const w = Math.max(r.width, 0.5) || 20;
      const h = Math.max(r.height, 0.5) || 20;
      const layerId = store.activeLayerId;
      let shape: Shape;
      if (store.tool === 'ellipse') {
        shape = createEllipse(w / 2, h / 2, { layerId, at: { x: r.x + w / 2, y: r.y + h / 2 } });
      } else if (store.tool === 'polygon') {
        shape = createPolygon(6, Math.max(w, h) / 2, {
          layerId,
          at: { x: r.x + w / 2, y: r.y + h / 2 },
        });
      } else {
        shape = createRect(w, h, { layerId, at: { x: r.x, y: r.y } });
      }
      store.addShapeAction(shape);
      store.setTool('select');
      previewBatch.current = null;
    } else if (ps.mode === 'move') {
      store.commitTransform(ps.originals);
    }
    pointer.current = { mode: 'none', startDoc: { x: 0, y: 0 }, originals: [] };
    scheduleDraw();
  };

  return (
    <div className="editor-canvas" data-testid="editor-canvas">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}

function normalizeRect(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
