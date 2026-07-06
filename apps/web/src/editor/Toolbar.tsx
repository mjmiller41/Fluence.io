import { align, type AlignMode, createRect, distribute, type DistributeMode } from 'scene';
import { type Tool, useEditor } from './store';

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'rect', label: 'Rect' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'polygon', label: 'Polygon' },
];

const ALIGNS: Array<{ mode: AlignMode; label: string }> = [
  { mode: 'left', label: '⇤' },
  { mode: 'hcenter', label: '↔' },
  { mode: 'right', label: '⇥' },
  { mode: 'bottom', label: '⤓' },
  { mode: 'vcenter', label: '↕' },
  { mode: 'top', label: '⤒' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const version = useEditor((s) => s.version);
  const setTool = useEditor((s) => s.setTool);
  const shapeCount = useEditor.getState().doc.shapes.length;
  void version; // re-render on document changes so the count stays fresh

  const applyAlign = (mode: AlignMode): void => {
    const store = useEditor.getState();
    const shapes = store.selectedShapes();
    if (shapes.length < 2) return;
    for (const s of align(shapes, mode)) store.updateShape(s);
  };

  const applyDistribute = (mode: DistributeMode): void => {
    const store = useEditor.getState();
    const shapes = store.selectedShapes();
    if (shapes.length < 3) return;
    for (const s of distribute(shapes, mode)) store.updateShape(s);
  };

  const addExactRect = (): void => {
    const store = useEditor.getState();
    const layerId = store.doc.layers[0].id;
    const cx = store.doc.width / 2 - 25;
    const cy = store.doc.height / 2 - 15;
    store.addShapeAction(createRect(50, 30, { layerId, at: { x: cx, y: cy } }));
  };

  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="toolbar__group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            onClick={() => setTool(t.id)}
            data-testid={`tool-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={addExactRect} data-testid="add-rect">
          + 50×30 mm
        </button>
        <button
          type="button"
          onClick={() => useEditor.getState().deleteSelection()}
          data-testid="delete"
        >
          Delete
        </button>
      </div>

      <div className="toolbar__group">
        {ALIGNS.map((a) => (
          <button key={a.mode} type="button" title={`Align ${a.mode}`} onClick={() => applyAlign(a.mode)}>
            {a.label}
          </button>
        ))}
        <button type="button" title="Distribute horizontally" onClick={() => applyDistribute('horizontal')}>
          ⇹
        </button>
        <button type="button" title="Distribute vertically" onClick={() => applyDistribute('vertical')}>
          ⤨
        </button>
      </div>

      <div className="toolbar__spacer" />
      <span className="toolbar__count" data-testid="shape-count">
        {shapeCount}
      </span>
    </div>
  );
}
