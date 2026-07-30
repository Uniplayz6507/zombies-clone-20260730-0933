import './LoadingScreen.css';
import type { LoadProgress } from '../types';

interface Props {
  progress: LoadProgress;
  error?: string | null;
}

/**
 * Shown while the engine generates every procedural texture, model, animation
 * clip and audio buffer, then pre-compiles shaders. All of that happens *here*
 * so that nothing loads once a wave is running (see ARCHITECTURE.md section 5).
 */
export default function LoadingScreen({ progress, error }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, progress.value)) * 100);

  return (
    <div className="loading">
      <div className="loading__inner">
        <h1 className="loading__title">
          Rotwave <em>Protocol</em>
        </h1>
        <p className="loading__sub kicker">Blackpine District &middot; Wave Survival</p>

        {error ? (
          <div className="loading__error">
            <strong>Failed to start.</strong>
            <br />
            {error}
          </div>
        ) : (
          <>
            <div className="loading__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="loading__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="loading__meta">
              <span>{progress.label}</span>
              <strong>{pct}%</strong>
            </div>
          </>
        )}

        <p className="loading__note">
          Every model, texture, animation and sound in this game is generated in code at load time.
          Nothing is downloaded, nothing is streamed mid-match, and no third-party or commercial game
          assets are used.
        </p>
      </div>
      <div className="grain" />
    </div>
  );
}
