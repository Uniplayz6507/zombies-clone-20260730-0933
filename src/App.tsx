import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type LoadProgress, type RunResult, type Screen, type Settings } from './types';
import { HudStore, useHud } from './react/useHudStore';
import GameCanvas from './react/GameCanvas';
import LoadingScreen from './ui/LoadingScreen';
import MainMenu from './ui/MainMenu';
import HUD from './ui/HUD';
import GameOver from './ui/GameOver';
import PauseOverlay from './ui/PauseOverlay';
import ControlsPanel from './ui/ControlsPanel';
import PerfOverlay from './ui/PerfOverlay';
import type { Engine } from './engine/Engine';

/**
 * The only React state machine in the project.
 *
 * Screen transitions happen a handful of times per session, which is exactly
 * what React is good at. Everything that changes sixty times a second is on the
 * other side of the HudStore, and never enters this component's render path.
 */
export default function App() {
  // One store for the lifetime of the app; the engine writes into it.
  const hudStore = useMemo(() => new HudStore(), []);
  const hud = useHud(hudStore);

  const [screen, setScreen] = useState<Screen>('loading');
  const [progress, setProgress] = useState<LoadProgress>({ label: 'Waking up', value: 0 });
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<RunResult | null>(null);
  const [bestWave, setBestWave] = useState(0);
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);

  /**
   * Two values the HUD needs that are not worth a snapshot field: crosshair
   * bloom and stamina. Polled at 10Hz rather than pushed, because they only
   * matter visually and a missed update is invisible.
   */
  const [gauges, setGauges] = useState({ spread: 0, stamina: 1 });
  const engineRef = useRef<Engine | null>(null);
  engineRef.current = engine;

  useEffect(() => {
    if (screen !== 'playing') return;
    const id = window.setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const p = e.world.player;
      setGauges({
        spread: Math.min(1, p.arsenal.spreadRadians() / 0.09),
        stamina: p.stamina / p.maxStamina,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [screen]);

  // Push settings changes down to the engine.
  useEffect(() => {
    engine?.applySettings(settings);
  }, [engine, settings]);

  // Escape pauses; F3 toggles the perf overlay. Registered here rather than in
  // Input because both are UI concerns, not gameplay input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        setSettings((s) => ({ ...s, showPerf: !s.showPerf }));
      }
      if (e.code === 'KeyM') {
        setSettings((s) => ({ ...s, muted: !s.muted }));
      }
      if (e.code === 'Escape' && screen === 'playing') {
        engineRef.current?.setPaused(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const handleStart = useCallback(() => {
    setResult(null);
    engineRef.current?.startRun();
  }, []);

  const handleMenu = useCallback(() => {
    setResult(null);
    engineRef.current?.toMenu();
  }, []);

  const handleGameOver = useCallback((r: RunResult) => {
    setResult(r);
    setBestWave((b) => Math.max(b, r.wave));
  }, []);

  const handleNotice = useCallback((text: string) => {
    setNotice({ text, id: Date.now() });
  }, []);

  const showLoading = screen === 'loading' || error !== null;

  return (
    <>
      {/* Mounted once, never re-rendered by the state above. */}
      <GameCanvas
        hud={hudStore}
        initialSettings={DEFAULT_SETTINGS}
        onEngine={setEngine}
        onProgress={setProgress}
        onScreen={setScreen}
        onGameOver={handleGameOver}
        onNotice={handleNotice}
        onError={setError}
      />

      {showLoading && <LoadingScreen progress={progress} error={error} />}

      {screen === 'menu' && !error && (
        <MainMenu settings={settings} onSettings={patchSettings} onStart={handleStart} bestWave={bestWave} />
      )}

      {screen === 'playing' && <HUD hud={hud} spread={gauges.spread} stamina={gauges.stamina} />}

      {screen === 'playing' && hud.paused && (
        <PauseOverlay
          onResume={() => engineRef.current?.setPaused(false)}
          onControls={() => setShowControls(true)}
          onQuit={handleMenu}
          muted={settings.muted}
          onToggleMute={() => patchSettings({ muted: !settings.muted })}
        />
      )}

      {screen === 'gameover' && result && (
        <GameOver result={result} bestWave={bestWave} onRestart={handleStart} onMenu={handleMenu} />
      )}

      {showControls && <ControlsPanel onClose={() => setShowControls(false)} />}

      {settings.showPerf && screen !== 'loading' && <PerfOverlay engine={engine} />}

      {notice && (
        <div className="notice" key={notice.id}>
          {notice.text}
        </div>
      )}
    </>
  );
}
