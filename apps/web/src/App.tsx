import { useEffect, useState } from 'react';
import { EditorCanvas } from './editor/EditorCanvas';
import { Toolbar } from './editor/Toolbar';

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

  return (
    <div className="app-shell">
      <header className="app-bar">
        <h1 data-testid="app-title">Fluence</h1>
        <span className="app-bar__milestone">M1 · Design &amp; vector engine</span>
        <span
          className={`badge ${online ? 'badge--online' : 'badge--offline'}`}
          data-testid="net-status"
        >
          {online ? 'online' : 'offline'}
        </span>
      </header>
      <Toolbar />
      <EditorCanvas />
    </div>
  );
}
