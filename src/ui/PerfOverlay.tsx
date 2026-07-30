import { useEffect, useState } from 'react';
import './HUD.css';
import type { Engine } from '../engine/Engine';

interface Props {
  engine: Engine | null;
  zombieTris?: number;
}

/**
 * F3 overlay. Reports p50/p95 frametime rather than instantaneous FPS, because
 * the p95 is the number that actually tells you whether the game feels smooth.
 *
 * Polls on an interval rather than subscribing to the render loop: putting this
 * on the per-frame path would defeat the entire point of keeping React out of it.
 */
export default function PerfOverlay({ engine }: Props) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(() => {
      const p = engine.perfStats;
      const w = engine.world;
      setBad(p.p95 > 20);
      setText(
        [
          `fps  ${p.fps.toFixed(0).padStart(3)}   p50 ${p.p50.toFixed(1)}ms   p95 ${p.p95.toFixed(1)}ms`,
          `draw ${p.drawCalls.toString().padStart(3)}   tris ${(p.triangles / 1000).toFixed(0)}k   prog ${p.programs}`,
          `geo  ${p.geometries.toString().padStart(3)}   tex  ${p.textures}`,
          `blighted ${w.horde.countAlive()} alive / ${w.horde.countActive()} active`,
          `wave ${w.waves.wave} ${w.waves.phase}   pts ${w.economy.points}`,
        ].join('\n'),
      );
    }, 250);
    return () => window.clearInterval(id);
  }, [engine]);

  if (!engine || !text) return null;
  return <div className={bad ? 'perf perf--bad' : 'perf'}>{text}</div>;
}
