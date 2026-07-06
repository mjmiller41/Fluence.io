import { useEffect, useState } from 'react';
import { CamPanel } from './editor/CamPanel';
import { EditorCanvas } from './editor/EditorCanvas';
import { LayersPanel } from './editor/LayersPanel';
import { Toolbar } from './editor/Toolbar';
import { useEditor } from './editor/store';

export function App() {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Load the persisted material library once (no-ops if OPFS is unavailable).
  useEffect(() => {
    void useEditor.getState().loadLibrary();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-bar">
        <h1 data-testid="app-title">Fluence</h1>
        <span className="app-bar__milestone">M2 · CAM &amp; G-code</span>
        <span
          className={`badge ${online ? 'badge--online' : 'badge--offline'}`}
          data-testid="net-status"
        >
          {online ? 'online' : 'offline'}
        </span>
      </header>
      <Toolbar />
      <div className="editor-body">
        <EditorCanvas />
        <div className="side-panels">
          <LayersPanel />
          <CamPanel />
        </div>
      </div>
    </div>
  );
}
