import { type ChangeEvent, useRef, useState } from 'react';
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

  const importRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const onImportChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    setImportError(null);
    try {
      await useEditor.getState().importFile(file.name, await file.text());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const applyAlign = (mode: AlignMode): void => {
    const store = useEditor.getState();
    const shapes = store.selectedShapes();
    if (shapes.length < 2) return;
    const before = shapes.map((s) => ({ ...s }));
    store.applyUpdates(before, align(shapes, mode));
  };

  const applyDistribute = (mode: DistributeMode): void => {
    const store = useEditor.getState();
    const shapes = store.selectedShapes();
    if (shapes.length < 3) return;
    const before = shapes.map((s) => ({ ...s }));
    store.applyUpdates(before, distribute(shapes, mode));
  };

  const addExactRect = (): void => {
    const store = useEditor.getState();
    const cx = store.doc.width / 2 - 25;
    const cy = store.doc.height / 2 - 15;
    store.addShapeAction(createRect(50, 30, { layerId: store.activeLayerId, at: { x: cx, y: cy } }));
  };

  const store = useEditor.getState();
  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="toolbar__group">
        <button
          type="button"
          onClick={() => store.undo()}
          disabled={!store.canUndo()}
          data-testid="undo"
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => store.redo()}
          disabled={!store.canRedo()}
          data-testid="redo"
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷
        </button>
        <button type="button" onClick={() => void store.saveProject()} data-testid="save-project">
          Save
        </button>
        <button type="button" onClick={() => void store.openProject()} data-testid="open-project">
          Open
        </button>
        <button type="button" onClick={() => importRef.current?.click()} data-testid="import-btn" title="Import SVG/DXF">
          Import
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".svg,.dxf,.ai,.pdf"
          onChange={(e) => void onImportChange(e)}
          data-testid="import-file"
          style={{ display: 'none' }}
        />
        {importError && (
          <span className="toolbar__error" data-testid="import-error" role="alert" title={importError}>
            ⚠ {importError}
          </span>
        )}
      </div>

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
        <button
          type="button"
          className={tool === 'node' ? 'active' : ''}
          onClick={() => useEditor.getState().enterNodeEdit()}
          data-testid="tool-node"
          title="Edit nodes (double-click a shape)"
        >
          Nodes
        </button>
      </div>

      {tool === 'node' && <NodeEditGroup />}

      <div className="toolbar__group">
        <button type="button" onClick={addExactRect} data-testid="add-rect">
          + 50×30 mm
        </button>
        <button
          type="button"
          onClick={() => useEditor.getState().selectAll()}
          data-testid="select-all"
        >
          All
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
        <button type="button" onClick={() => void useEditor.getState().booleanAction('union')} data-testid="op-union">
          Union
        </button>
        <button
          type="button"
          onClick={() => void useEditor.getState().booleanAction('difference')}
          data-testid="op-difference"
        >
          Diff
        </button>
        <button
          type="button"
          onClick={() => void useEditor.getState().booleanAction('intersection')}
          data-testid="op-intersect"
        >
          Intersect
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

/** Node-editor controls (M1-T03), shown only while the node tool is active. */
function NodeEditGroup() {
  const nodeSel = useEditor((s) => s.nodeSel);
  const version = useEditor((s) => s.version);
  void version;
  // The edge acted on by segment controls: the one arriving at the selected
  // node (or, for a start node with no incoming edge, the one leaving it).
  const segIndex = nodeSel && nodeSel.node >= 1 ? nodeSel.node - 1 : 0;
  return (
    <div className="toolbar__group" data-testid="node-edit-group">
      <button
        type="button"
        disabled={!nodeSel}
        onClick={() => nodeSel && useEditor.getState().deleteNodeAction(nodeSel)}
        data-testid="node-delete"
      >
        Del node
      </button>
      <button
        type="button"
        disabled={!nodeSel}
        onClick={() => nodeSel && useEditor.getState().toggleSegmentType(nodeSel.subpath, segIndex)}
        data-testid="node-toggle-seg"
        title="Convert segment line ↔ curve"
      >
        Line/Curve
      </button>
      <button
        type="button"
        disabled={!nodeSel}
        onClick={() => nodeSel && useEditor.getState().toggleSubpathClosed(nodeSel.subpath)}
        data-testid="node-toggle-closed"
        title="Open / close this subpath"
      >
        Open/Close
      </button>
      <button type="button" onClick={() => useEditor.getState().exitNodeEdit()} data-testid="node-done">
        Done
      </button>
    </div>
  );
}
