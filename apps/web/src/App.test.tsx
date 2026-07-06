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
  });
});
