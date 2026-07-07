import { useEffect, useRef, useState } from 'react';
import { useEditor } from './store';

const GRBL_PROFILES = [
  { id: 'grbl', label: 'GRBL 1.1' },
  { id: 'grbl-m3', label: 'GRBL-M3' },
  { id: 'grbl-lpc', label: 'GRBL-LPC' },
  { id: 'smoothieware', label: 'Smoothieware' },
  { id: 'marlin', label: 'Marlin' },
  { id: 'cohesion3d', label: 'Cohesion3D' },
];

/** Machine-control panel: connect, status, run/pause/stop, jog, frame/home, console. */
export function MachinePanel() {
  const kind = useEditor((s) => s.connectionKind);
  const busy = useEditor((s) => s.machineBusy);
  const status = useEditor((s) => s.machineStatus);
  const jobRunning = useEditor((s) => s.jobRunning);
  const consoleLines = useEditor((s) => s.deviceConsole);
  const hasGcode = useEditor((s) => s.gcode !== null);

  const [profile, setProfile] = useState('grbl');
  const [step, setStep] = useState(10);
  const [feed, setFeed] = useState(1000);
  const [cmd, setCmd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines]);

  const connected = kind !== null;
  const st = useEditor.getState();

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pos = status?.position ?? { x: 0, y: 0, z: 0 };
  const jog = (dx: number, dy: number, dz: number): void =>
    void guard(() => st.jogMachine({ x: dx * step, y: dy * step, z: dz * step }, feed));

  return (
    <div className="machine-panel" data-testid="machine-panel">
      <h3>Machine</h3>

      {!connected ? (
        <div className="machine-panel__connect">
          <button type="button" disabled={busy} onClick={() => void guard(() => st.connectMachine('sim'))} data-testid="connect-sim">
            Simulator
          </button>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} data-testid="grbl-profile">
            {GRBL_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => void guard(() => st.connectMachine('grbl', profile))} data-testid="connect-grbl">
            Connect (Serial)
          </button>
        </div>
      ) : (
        <div className="machine-panel__status" data-testid="machine-status">
          <span className="tag">{kind === 'sim' ? 'Simulator' : 'GRBL'}</span>
          <span data-testid="machine-state">{status?.state ?? 'idle'}</span>
          <span data-testid="machine-pos">
            X{pos.x.toFixed(2)} Y{pos.y.toFixed(2)} Z{(pos.z ?? 0).toFixed(2)}
          </span>
          <button type="button" onClick={() => void guard(() => st.disconnectMachine())} data-testid="disconnect-machine">
            Disconnect
          </button>
        </div>
      )}

      {connected && (
        <>
          <div className="machine-panel__job">
            <button type="button" disabled={!hasGcode || jobRunning} onClick={() => void guard(() => st.runJob())} data-testid="run-job">
              ▶ Run
            </button>
            <button type="button" disabled={!jobRunning} onClick={() => void guard(() => st.holdJob())} data-testid="hold-job">
              ⏸ Hold
            </button>
            <button type="button" disabled={!jobRunning} onClick={() => void guard(() => st.resumeJob())} data-testid="resume-job">
              ⏵ Resume
            </button>
            <button type="button" disabled={!jobRunning} onClick={() => void guard(() => st.stopJob())} data-testid="stop-job">
              ⏹ Stop
            </button>
            {jobRunning && (
              <progress value={status?.progress ?? 0} max={1} data-testid="job-progress" />
            )}
          </div>

          <div className="machine-panel__jog" data-testid="jog-pad">
            <div className="machine-panel__jogrow">
              <button type="button" disabled={jobRunning} onClick={() => jog(0, 1, 0)} data-testid="jog-yplus">Y+</button>
              <button type="button" disabled={jobRunning} onClick={() => jog(0, 0, 1)} data-testid="jog-zplus">Z+</button>
            </div>
            <div className="machine-panel__jogrow">
              <button type="button" disabled={jobRunning} onClick={() => jog(-1, 0, 0)} data-testid="jog-xminus">X−</button>
              <button type="button" disabled={jobRunning} onClick={() => jog(1, 0, 0)} data-testid="jog-xplus">X+</button>
            </div>
            <div className="machine-panel__jogrow">
              <button type="button" disabled={jobRunning} onClick={() => jog(0, -1, 0)} data-testid="jog-yminus">Y−</button>
              <button type="button" disabled={jobRunning} onClick={() => jog(0, 0, -1)} data-testid="jog-zminus">Z−</button>
            </div>
            <label>
              step
              <input type="number" min={0.1} value={step} onChange={(e) => setStep(Number(e.target.value) || 1)} data-testid="jog-step" style={{ width: 56 }} />
            </label>
            <label>
              feed
              <input type="number" min={1} value={feed} onChange={(e) => setFeed(Number(e.target.value) || 1)} data-testid="jog-feed" style={{ width: 64 }} />
            </label>
          </div>

          <div className="machine-panel__actions">
            <button type="button" disabled={jobRunning} onClick={() => void guard(() => st.frameJob())} data-testid="frame-job">Frame</button>
            <button type="button" disabled={jobRunning} onClick={() => void guard(() => st.homeMachine())} data-testid="home-machine">Home</button>
            <button type="button" disabled={jobRunning} onClick={() => void guard(() => st.setWorkOrigin())} data-testid="set-origin">Set origin</button>
          </div>

          <div className="machine-panel__console">
            <div className="machine-panel__console-log" ref={consoleRef} data-testid="console-log">
              {consoleLines.map((e, i) => (
                <div key={i} className={`console-line console-line--${e.dir}`}>
                  <span className="console-dir">{e.dir === 'tx' ? '»' : '«'}</span> {e.text}
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = cmd;
                setCmd('');
                void guard(() => st.sendConsole(text));
              }}
            >
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="$H, G0 X0, ?"
                disabled={jobRunning}
                data-testid="console-input"
              />
              <button type="submit" disabled={jobRunning} data-testid="console-send">Send</button>
              <button type="button" onClick={() => st.clearConsole()} data-testid="console-clear">Clear</button>
            </form>
          </div>
        </>
      )}

      {error && (
        <div className="machine-panel__error" role="alert" data-testid="machine-error">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
