import { type ChangeEvent, useRef, useState } from 'react';
import { type CutMode, defaultCutSettings } from 'cam';
import { useEditor } from './store';

const MODES: CutMode[] = ['line', 'fill', 'offset-fill', 'fill+line'];

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function CamPanel() {
  const version = useEditor((s) => s.version);
  const gcode = useEditor((s) => s.gcode);
  const busy = useEditor((s) => s.gcodeBusy);
  const showPreview = useEditor((s) => s.showGcodePreview);
  const activeLayerId = useEditor((s) => s.activeLayerId);
  const library = useEditor((s) => s.library);
  void version; // re-render when settings/document change

  const [presetName, setPresetName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const store = useEditor.getState();
  const settings = store.cutSettingsByLayer[activeLayerId] ?? defaultCutSettings();
  const isFill = settings.mode !== 'line';
  const stale = gcode !== null && gcode.version !== version;

  const patch = (p: Parameters<typeof store.setLayerCutSettings>[1]): void =>
    store.setLayerCutSettings(activeLayerId, p);

  const onImportFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    void file.text().then((json) => store.importLibrary(json));
  };

  const onSavePreset = (): void => {
    void store.saveLayerAsPreset(activeLayerId, presetName);
    setPresetName('');
  };

  return (
    <section className="cam" data-testid="cam-panel">
      <div className="cam__header">Cut settings</div>

      <label className="cam__field">
        <span>Mode</span>
        <select
          value={settings.mode}
          data-testid="cam-mode"
          onChange={(e) => patch({ mode: e.target.value as CutMode })}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="cam__field">
        <span>Speed (mm/min)</span>
        <input
          type="number"
          min={1}
          value={settings.speed}
          data-testid="cam-speed"
          onChange={(e) => patch({ speed: Number(e.target.value) })}
        />
      </label>

      <label className="cam__field">
        <span>Max power (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          value={settings.maxPower}
          onChange={(e) => patch({ maxPower: Number(e.target.value) })}
        />
      </label>

      <label className="cam__field">
        <span>Passes</span>
        <input
          type="number"
          min={1}
          value={settings.passes}
          onChange={(e) => patch({ passes: Math.max(1, Math.round(Number(e.target.value))) })}
        />
      </label>

      {isFill && (
        <label className="cam__field">
          <span>Interval (mm)</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={settings.interval}
            onChange={(e) => patch({ interval: Number(e.target.value) })}
          />
        </label>
      )}

      <div className="cam__header">Material library</div>

      <label className="cam__field">
        <span>Apply</span>
        <select
          value=""
          data-testid="material-select"
          onChange={(e) => {
            if (e.target.value) store.applyMaterial(activeLayerId, e.target.value);
          }}
        >
          <option value="">Choose preset…</option>
          {library.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="cam__material-save">
        <input
          type="text"
          placeholder="New preset name"
          value={presetName}
          data-testid="preset-name"
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button
          type="button"
          data-testid="save-preset"
          disabled={presetName.trim() === ''}
          onClick={onSavePreset}
        >
          Save layer
        </button>
      </div>

      <div className="cam__material-io">
        <button type="button" data-testid="import-library" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button type="button" data-testid="export-library" onClick={() => store.exportLibrary()}>
          Export
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onImportFile}
        />
      </div>

      <button
        type="button"
        className="cam__generate"
        data-testid="generate-gcode"
        disabled={busy}
        onClick={() => void store.generateGcode()}
      >
        {busy ? 'Generating…' : 'Generate G-code'}
      </button>

      {gcode && (
        <div className="cam__result" data-testid="cam-result">
          <div className="cam__stat">
            <span>Time</span>
            <span>{fmtTime(gcode.sim.totalSeconds)}</span>
          </div>
          <div className="cam__stat">
            <span>Cut</span>
            <span>{gcode.sim.cutDistance.toFixed(1)} mm</span>
          </div>
          <div className="cam__stat">
            <span>Travel</span>
            <span>{gcode.sim.travelDistance.toFixed(1)} mm</span>
          </div>
          {stale && (
            <div className="cam__stale" data-testid="cam-stale">
              design changed — regenerate
            </div>
          )}
          <label className="cam__toggle">
            <input
              type="checkbox"
              checked={showPreview}
              onChange={() => store.toggleGcodePreview()}
            />
            Show path preview
          </label>
          <button type="button" data-testid="save-gcode" onClick={() => void store.saveGcode()}>
            Save .gcode
          </button>
        </div>
      )}
    </section>
  );
}
