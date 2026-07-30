import './GameOver.css';

interface Props {
  onResume: () => void;
  onControls: () => void;
  onQuit: () => void;
  muted: boolean;
  onToggleMute: () => void;
}

/**
 * Shown whenever pointer lock is lost - by pressing Escape, alt-tabbing, or the
 * cursor slipping onto the taskbar. The simulation is frozen while this is up,
 * which is the entire point.
 */
export default function PauseOverlay({ onResume, onControls, onQuit, muted, onToggleMute }: Props) {
  return (
    <div className="pause">
      <div className="pause__box">
        <h2>Paused</h2>
        <p>Blackpine is holding its breath</p>
        <div className="pause__row">
          <button className="btn btn--primary" onClick={onResume} autoFocus>
            Resume
          </button>
          <button className="btn btn--ghost" onClick={onControls}>
            Controls
          </button>
          <button className="btn btn--ghost" aria-pressed={muted} onClick={onToggleMute}>
            {muted ? 'Audio: Muted' : 'Audio: On'}
          </button>
          <button className="btn btn--ghost" onClick={onQuit}>
            Abandon run
          </button>
        </div>
      </div>
    </div>
  );
}
