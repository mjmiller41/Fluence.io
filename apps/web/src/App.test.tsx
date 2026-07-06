import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { useEditor } from './editor/store';

afterEach(() => cleanup());

describe('editor app', () => {
  it('renders the toolbar/canvas and adds a shape via the store', () => {
    render(<App />);
    expect(screen.getByTestId('app-title').textContent).toMatch(/Fluence/i);
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
