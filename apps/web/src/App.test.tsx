import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import opentype from 'opentype.js';
import { App } from './App';
import { useEditor } from './editor/store';
import { createSimController } from './device/controller';

/** A tiny self-contained font (glyph 'A' = 500×700 rectangle) for text tests. */
function testFontBytes(): Uint8Array {
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 1000, path: new opentype.Path() });
  const p = new opentype.Path();
  p.moveTo(0, 0);
  p.lineTo(500, 0);
  p.lineTo(500, 700);
  p.lineTo(0, 700);
  p.close();
  const a = new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: p });
  const font = new opentype.Font({
    familyName: 'Test',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, a],
  });
  return new Uint8Array(font.toArrayBuffer());
}

afterEach(() => cleanup());

describe('editor app', () => {
  it('renders the toolbar/canvas and adds a shape via the store', () => {
    render(<App />);
    expect(screen.getByTestId('app-title').textContent).toMatch(/LaserKerf/i);
    expect(screen.getByTestId('toolbar')).toBeTruthy();
    expect(screen.getByTestId('tool-select')).toBeTruthy();
    expect(screen.getByTestId('editor-canvas')).toBeTruthy();

    const before = useEditor.getState().doc.shapes.length;
    fireEvent.click(screen.getByTestId('add-rect'));
    expect(useEditor.getState().doc.shapes.length).toBe(before + 1);
    expect(screen.getByTestId('shape-count').textContent).toBe(String(before + 1));

    // undo/redo (command stack)
    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);
    fireEvent.click(screen.getByTestId('redo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before + 1);
  });

  it('renders the layers panel and can add a layer', () => {
    render(<App />);
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    const before = useEditor.getState().doc.layers.length;
    fireEvent.click(screen.getByTestId('add-layer'));
    expect(useEditor.getState().doc.layers.length).toBe(before + 1);
  });

  it('renders the CAM panel; editing mode updates settings, save is gated on generation', () => {
    render(<App />);
    expect(screen.getByTestId('cam-panel')).toBeTruthy();
    expect(screen.getByTestId('generate-gcode')).toBeTruthy();
    // No result yet -> nothing to save.
    expect(screen.queryByTestId('save-gcode')).toBeNull();

    const active = useEditor.getState().activeLayerId;
    fireEvent.change(screen.getByTestId('cam-mode'), { target: { value: 'fill' } });
    expect(useEditor.getState().cutSettingsByLayer[active].mode).toBe('fill');

    // Machine origin (M2-T07) is wired to the store.
    fireEvent.change(screen.getByTestId('machine-origin'), { target: { value: 'center' } });
    expect(useEditor.getState().machineOrigin).toBe('center');
  });

  it('applies a material preset to the active layer and can save one back', () => {
    render(<App />);
    const select = screen.getByTestId('material-select') as HTMLSelectElement;
    // Seeded starter library is present.
    expect(select.querySelectorAll('option').length).toBeGreaterThan(1);

    const active = useEditor.getState().activeLayerId;
    // The starter "Engrave — Light (diode)" preset uses fill mode.
    fireEvent.change(select, { target: { value: 'diode-engrave' } });
    const applied = useEditor.getState().cutSettingsByLayer[active];
    expect(applied.mode).toBe('fill');
    expect(applied.speed).toBe(3000);

    // Save current layer settings as a new preset.
    const beforeCount = useEditor.getState().library.presets.length;
    fireEvent.change(screen.getByTestId('preset-name'), { target: { value: 'My Preset' } });
    fireEvent.click(screen.getByTestId('save-preset'));
    expect(useEditor.getState().library.presets.length).toBe(beforeCount + 1);
    expect(useEditor.getState().library.presets.some((p) => p.name === 'My Preset')).toBe(true);
  });

  it('inserts a material test grid as one undoable step', () => {
    render(<App />);
    const before = useEditor.getState().doc.shapes.length;
    fireEvent.click(screen.getByTestId('insert-testgrid'));
    // 5x5 = 25 cell squares (plus axis labels) added at once.
    const after = useEditor.getState().doc.shapes.length;
    expect(after).toBeGreaterThanOrEqual(before + 25);

    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);
  });

  it('node-edits a shape: enter converts to a path, ops are undoable (M1-T03)', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('add-rect'));
    const rectId = useEditor.getState().selection[0];
    expect(useEditor.getState().doc.shapes.find((s) => s.id === rectId)?.kind).toBe('rect');

    // Enter node edit via the toolbar → the rect becomes a path (same id).
    fireEvent.click(screen.getByTestId('tool-node'));
    const st = useEditor.getState();
    expect(st.tool).toBe('node');
    expect(st.nodeEditId).toBe(rectId);
    const path = st.nodeEditPath();
    expect(path?.kind).toBe('path');
    const nodeCountBefore = path!.subpaths[0].segments.length; // closed → nodeCount === segments
    expect(nodeCountBefore).toBeGreaterThanOrEqual(4);

    // Node-mode controls are present in the toolbar.
    expect(screen.getByTestId('node-edit-group')).toBeTruthy();
    expect(screen.getByTestId('node-delete')).toBeTruthy();

    // Delete a node → one fewer node, undoable.
    useEditor.getState().deleteNodeAction({ subpath: 0, node: 1 });
    expect(useEditor.getState().nodeEditPath()!.subpaths[0].segments.length).toBe(nodeCountBefore - 1);
    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().nodeEditPath()!.subpaths[0].segments.length).toBe(nodeCountBefore);

    // Convert segment 0 line ↔ curve.
    const seg0Before = useEditor.getState().nodeEditPath()!.subpaths[0].segments[0].type;
    useEditor.getState().toggleSegmentType(0, 0);
    expect(useEditor.getState().nodeEditPath()!.subpaths[0].segments[0].type).not.toBe(seg0Before);

    // Insert a node on segment 0 → one more node.
    const preInsert = useEditor.getState().nodeEditPath()!.subpaths[0].segments.length;
    useEditor.getState().insertNodeAction(0, 0, 0.5);
    expect(useEditor.getState().nodeEditPath()!.subpaths[0].segments.length).toBe(preInsert + 1);

    // Open the subpath, then exit via the toolbar.
    useEditor.getState().toggleSubpathClosed(0);
    expect(useEditor.getState().nodeEditPath()!.subpaths[0].closed).toBe(false);
    fireEvent.click(screen.getByTestId('node-done'));
    expect(useEditor.getState().tool).toBe('select');
    expect(useEditor.getState().nodeEditId).toBeNull();
  });

  it('imports an SVG into the current document, undoably (M1-T08)', async () => {
    render(<App />);
    const before = useEditor.getState().doc.shapes.length;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50">' +
      '<rect x="0" y="0" width="50" height="50" stroke="#ff0000" fill="none"/></svg>';
    await useEditor.getState().importFile('drawing.svg', svg);
    expect(useEditor.getState().doc.shapes.length).toBe(before + 1);

    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);

    // AI/PDF are not supported yet and reject with a clear message.
    await expect(useEditor.getState().importFile('art.pdf', '%PDF-1.4')).rejects.toThrow(/not supported/i);
  });

  it('imports a raster (PNG) at its physical size (M1-T09)', async () => {
    render(<App />);
    const before = useEditor.getState().doc.shapes.length;
    // Minimal PNG: signature + IHDR (300x150) + pHYs (300 dpi) + IEND.
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const bytes = new Uint8Array(8 + 25 + 21 + 12);
    bytes.set(sig, 0);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(8, 13); // IHDR length
    'IHDR'.split('').forEach((c, i) => (bytes[12 + i] = c.charCodeAt(0)));
    dv.setUint32(16, 300); // width
    dv.setUint32(20, 150); // height
    dv.setUint32(33, 9); // pHYs length
    'pHYs'.split('').forEach((c, i) => (bytes[37 + i] = c.charCodeAt(0)));
    dv.setUint32(41, 11811); // ppuX ≈ 300 dpi
    bytes[49] = 1; // unit = metre

    await useEditor.getState().importFile('photo.png', bytes);
    const shapes = useEditor.getState().doc.shapes;
    expect(shapes.length).toBe(before + 1);
    const img = shapes[shapes.length - 1];
    expect(img.kind).toBe('image');
    if (img.kind === 'image') {
      expect(img.width).toBeCloseTo(25.4, 3); // 300px / 300dpi = 1in = 25.4mm
      expect(img.height).toBeCloseTo(12.7, 3);
    }

    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);
  });

  it('imports a LightBurn .lbrn2 into the document, undoably (M1-T10)', async () => {
    render(<App />);
    const before = useEditor.getState().doc.shapes.length;
    const lbrn =
      '<?xml version="1.0"?><LightBurnProject FormatVersion="1">' +
      '<CutSetting type="Cut"><index Value="0"/><name Value="Cut"/></CutSetting>' +
      '<Shape Type="Rect" CutIndex="0" W="40" H="20" Cr="0"><XForm>1 0 0 1 100 100</XForm></Shape>' +
      '</LightBurnProject>';
    await useEditor.getState().importFile('design.lbrn2', lbrn);
    expect(useEditor.getState().doc.shapes.length).toBe(before + 1);
    expect(useEditor.getState().doc.shapes[before].kind).toBe('rect');

    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);
  });

  it('bakes text to vector paths on the active layer, undoably (M1-T06)', async () => {
    render(<App />);
    const before = useEditor.getState().doc.shapes.length;
    await useEditor.getState().addText('AA', testFontBytes(), { size: 20 });
    const shapes = useEditor.getState().doc.shapes;
    expect(shapes.length).toBe(before + 1);
    const text = shapes[shapes.length - 1];
    expect(text.kind).toBe('path');
    if (text.kind === 'path') {
      // Two 'A' rectangles → two closed subpaths.
      expect(text.subpaths.length).toBe(2);
      expect(text.subpaths.every((sp) => sp.closed)).toBe(true);
    }
    fireEvent.click(screen.getByTestId('undo'));
    expect(useEditor.getState().doc.shapes.length).toBe(before);

    // Toolbar text controls are present.
    expect(screen.getByTestId('add-text')).toBeTruthy();
    expect(screen.getByTestId('load-font')).toBeTruthy();
  });

  it('connects the Simulator and jogs from the machine panel (machine UI)', async () => {
    render(<App />);
    expect(screen.getByTestId('machine-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('connect-sim'));
    await screen.findByTestId('machine-status');
    expect(screen.getByTestId('machine-state').textContent).toBe('idle');
    expect(screen.getByTestId('jog-pad')).toBeTruthy();

    // Jog +X by the step (default 10 mm); position updates from device status.
    fireEvent.click(screen.getByTestId('jog-xplus'));
    await waitFor(() => expect(screen.getByTestId('machine-pos').textContent).toMatch(/X10\.00/));

    fireEvent.click(screen.getByTestId('disconnect-machine'));
    await waitFor(() => expect(screen.queryByTestId('machine-status')).toBeNull());
  });

  it('streams a G-code job with progress + console, and forwards controls (machine store)', async () => {
    render(<App />);
    await useEditor
      .getState()
      .connectWith(createSimController({ msPerLine: 0, sleep: () => Promise.resolve() }), 'sim');
    expect(useEditor.getState().connectionKind).toBe('sim');

    // Inject a generated G-code result and run it.
    useEditor.setState({
      gcode: {
        text: 'G0 X0\nG1 X10 Y10\nG1 X0 Y0',
        sim: {
          segments: [],
          cutDistance: 0,
          travelDistance: 0,
          cutSeconds: 0,
          travelSeconds: 0,
          totalSeconds: 0,
          bounds: null,
        },
        version: useEditor.getState().version,
      },
    });
    await useEditor.getState().runJob();
    expect(useEditor.getState().machineStatus?.progress).toBe(1);
    expect(useEditor.getState().jobRunning).toBe(false);
    expect(useEditor.getState().deviceConsole.some((e) => e.text.includes('streaming'))).toBe(true);

    // Console command + forwarding of hold/stop (no-ops when idle, must not throw).
    await useEditor.getState().sendConsole('$H');
    expect(useEditor.getState().deviceConsole.some((e) => e.dir === 'tx' && e.text === '$H')).toBe(true);
    await useEditor.getState().holdJob();
    await useEditor.getState().stopJob();

    await useEditor.getState().disconnectMachine();
    expect(useEditor.getState().connectionKind).toBeNull();
  });

  it('saves the selection as art and re-inserts it with fresh ids', () => {
    render(<App />);
    // Add a rect — it becomes the current selection.
    fireEvent.click(screen.getByTestId('add-rect'));
    const selected = useEditor.getState().selection;
    expect(selected).toHaveLength(1);

    // Save it as an art item.
    const items0 = useEditor.getState().artLibrary.items.length;
    fireEvent.change(screen.getByTestId('art-name'), { target: { value: 'My Star' } });
    fireEvent.click(screen.getByTestId('save-art'));
    expect(useEditor.getState().artLibrary.items.length).toBe(items0 + 1);

    // Insert it back — a new shape with a different id from the original.
    const shapesBefore = useEditor.getState().doc.shapes.length;
    fireEvent.click(screen.getAllByTestId('insert-art')[0]);
    const doc = useEditor.getState().doc;
    expect(doc.shapes.length).toBe(shapesBefore + 1);
    const inserted = useEditor.getState().selection[0];
    expect(inserted).not.toBe(selected[0]);
  });
});
