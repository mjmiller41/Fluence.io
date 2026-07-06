import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { useEditor } from './editor/store';

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
  });
});
