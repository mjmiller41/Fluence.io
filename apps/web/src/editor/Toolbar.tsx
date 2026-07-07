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
  const fontRef = useRef<HTMLInputElement>(null);
  const fontBytesRef = useRef<Uint8Array | null>(null);
  const [fontName, setFontName] = useState<string | null>(null);
  const [textValue, setTextValue] = useState('Text');
  const [textSize, setTextSize] = useState(20);

  const loadFontFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    fontBytesRef.current = new Uint8Array(await file.arrayBuffer());
    setFontName(file.name);
  };

  const onFontClick = async (): Promise<void> => {
    // Prefer the Chromium Local Font Access API; fall back to a file picker.
    const query = (globalThis as { queryLocalFonts?: () => Promise<Array<{ fullName?: string; blob(): Promise<Blob> }>> })
      .queryLocalFonts;
    if (typeof query === 'function') {
      try {
        const fonts = await query();
        if (fonts.length > 0) {
          fontBytesRef.current = new Uint8Array(await (await fonts[0].blob()).arrayBuffer());
          setFontName(fonts[0].fullName ?? 'system font');
          return;
        }
      } catch {
        /* permission denied / unsupported → fall through to the file picker */
      }
    }
    fontRef.current?.click();
  };

  const onAddText = async (): Promise<void> => {
    if (!fontBytesRef.current) {
      setImportError('Load a font first (Font button)');
      return;
    }
    setImportError(null);
    try {
      await useEditor.getState().addText(textValue, fontBytesRef.current, { size: textSize });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Text failed');
    }
  };

  const onImportChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    setImportError(null);
    try {
      const isRaster = /\.(png|jpe?g)$/i.test(file.name);
      const data = isRaster ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      await useEditor.getState().importFile(file.name, data);
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
          accept=".svg,.dxf,.png,.jpg,.jpeg,.ai,.pdf"
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
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          data-testid="text-input"
          title="Text to engrave"
          style={{ width: 80 }}
        />
        <input
          type="number"
          value={textSize}
          min={1}
          onChange={(e) => setTextSize(Number(e.target.value) || 1)}
          data-testid="text-size"
          title="Text size (mm)"
          style={{ width: 48 }}
        />
        <button type="button" onClick={() => void onFontClick()} data-testid="load-font" title="Load a font">
          Font{fontName ? ' ✓' : ''}
        </button>
        <button type="button" onClick={() => void onAddText()} data-testid="add-text" title="Add text as paths">
          Text
        </button>
        <input
          ref={fontRef}
          type="file"
          accept=".ttf,.otf"
          onChange={(e) => void loadFontFile(e)}
          data-testid="font-file"
          style={{ display: 'none' }}
        />
      </div>

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
