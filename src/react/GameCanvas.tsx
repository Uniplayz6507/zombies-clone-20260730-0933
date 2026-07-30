import { useEffect, useRef } from 'react';
import type { LoadProgress, RunResult, Screen, Settings } from '../types';
import { Engine } from '../engine/Engine';
import type { HudStore } from './useHudStore';

interface Props {
  hud: HudStore;
  initialSettings: Settings;
  onEngine: (engine: Engine | null) => void;
  onProgress: (p: LoadProgress) => void;
  onScreen: (s: Screen) => void;
  onGameOver: (r: RunResult) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * The entire React/Three boundary.
 *
 * Rules this component exists to enforce:
 *
 *  1. It mounts ONCE and is never re-rendered by parent state. Its own React
 *     output is a bare <canvas> with no props that change. Remounting it would
 *     rebuild the whole scene and, after a few cycles, lose the WebGL context.
 *  2. The engine is constructed imperatively in a useEffect and handed the canvas
 *     directly. Nothing about the 3D scene lives in React state.
 *  3. Teardown disposes everything: geometries, materials, textures, render
 *     targets, the audio context, and the rAF handle. Skipping disposal is how
 *     you get "Too many active WebGL contexts" after the third restart.
 *
 * Because of (1), "restart" recycles the existing engine rather than remounting
 * the canvas - see Engine.startRun().
 */
export default function GameCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Callbacks live in a ref so changing them never re-runs the effect.
  const cbs = useRef(props);
  cbs.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine | null = null;
    let cancelled = false;
    let observer: ResizeObserver | null = null;

    const sizeToParent = (e: Engine) => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      e.resize(w, h, window.devicePixelRatio || 1);
    };

    (async () => {
      try {
        const built = await Engine.create(
          canvas,
          cbs.current.hud,
          {
            onProgress: (p) => cbs.current.onProgress(p),
            onScreen: (s) => cbs.current.onScreen(s),
            onGameOver: (r) => cbs.current.onGameOver(r),
            onNotice: (m) => cbs.current.onNotice(m),
          },
          cbs.current.initialSettings,
        );

        if (cancelled) {
          built.dispose();
          return;
        }

        engine = built;
        sizeToParent(built);
        built.toMenu();
        built.start();
        cbs.current.onEngine(built);

        observer = new ResizeObserver(() => sizeToParent(built));
        if (canvas.parentElement) observer.observe(canvas.parentElement);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unknown error. This game needs a WebGL2-capable browser.';
        // eslint-disable-next-line no-console
        console.error('[Engine] failed to start', err);
        cbs.current.onError(message);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      cbs.current.onEngine(null);
      engine?.dispose();
      engine = null;
    };
    // Intentionally empty: this effect must run exactly once for the lifetime of
    // the application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
