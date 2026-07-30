import { useState } from 'react';
import './MainMenu.css';
import ControlsPanel from './ControlsPanel';
import type { QualityPreset, Settings } from '../types';

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onStart: () => void;
  bestWave: number;
}

const QUALITIES: QualityPreset[] = ['low', 'medium', 'high'];

/**
 * The menu renders *over* the live 3D scene - the engine keeps rendering the
 * city with a slow crane camera behind this panel, which is free because the
 * scene is already built and the simulation is not running.
 */
export default function MainMenu({ settings, onSettings, onStart, bestWave }: Props) {
  const [showControls, setShowControls] = useState(false);

  return (
    <>
      <div className="menu">
        <div className="menu__panel">
          <div>
            <p className="kicker">Blackpine District &middot; Sector 7 quarantine</p>
            <h1 className="menu__brand">
              Rotwave
              <span>Protocol</span>
            </h1>
          </div>

          <p className="menu__tagline">
            The evacuation left you behind on Kessler Street. The Blighted come in waves, and they do
            not get tired. Earn points, buy hardware, open the shutters, and see how long you last.
          </p>

          <div className="menu__actions">
            <button className="btn btn--primary" onClick={onStart} autoFocus>
              Start Run
            </button>
            <div className="menu__row">
              <button className="btn btn--ghost" onClick={() => setShowControls(true)}>
                Controls &amp; Help
              </button>
              <button
                className="btn btn--ghost"
                aria-pressed={settings.muted}
                onClick={() => onSettings({ muted: !settings.muted })}
              >
                {settings.muted ? 'Audio: Muted' : 'Audio: On'}
              </button>
            </div>
            {bestWave > 0 && (
              <p className="kicker" style={{ marginTop: 6 }}>
                Best this session &mdash; wave {bestWave}
              </p>
            )}
          </div>

          <div className="menu__settings">
            <div className="menu__field">
              <label className="kicker">
                <span>Graphics preset</span>
                <span>{settings.quality}</span>
              </label>
              <div className="menu__segmented">
                {QUALITIES.map((q) => (
                  <button
                    key={q}
                    aria-pressed={settings.quality === q}
                    onClick={() => onSettings({ quality: q })}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="menu__field">
              <label className="kicker" htmlFor="sens">
                <span>Mouse sensitivity</span>
                <span>{settings.sensitivity.toFixed(2)}&times;</span>
              </label>
              <input
                id="sens"
                className="menu__slider"
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={settings.sensitivity}
                onChange={(e) => onSettings({ sensitivity: Number(e.target.value) })}
              />
            </div>

            <div className="menu__row">
              <button
                className="btn btn--ghost"
                aria-pressed={settings.invertY}
                onClick={() => onSettings({ invertY: !settings.invertY })}
              >
                Invert Y
              </button>
              <button
                className="btn btn--ghost"
                aria-pressed={settings.showPerf}
                onClick={() => onSettings({ showPerf: !settings.showPerf })}
              >
                Perf overlay
              </button>
            </div>
          </div>

          <p className="menu__legal">
            An original game. Not affiliated with, endorsed by, or derived from any commercial
            franchise. All characters, names, level design, models, textures and audio are original
            and generated procedurally in source.
          </p>
        </div>
        <div />
      </div>

      <div className="vignette" />
      {showControls && <ControlsPanel onClose={() => setShowControls(false)} />}
    </>
  );
}
