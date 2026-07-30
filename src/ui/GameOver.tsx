import './GameOver.css';
import type { RunResult } from '../types';

interface Props {
  result: RunResult;
  bestWave: number;
  onRestart: () => void;
  onMenu: () => void;
}

function flavour(wave: number): string {
  if (wave <= 2) return 'You did not make it out of Kessler Street. The Blighted barely had to try.';
  if (wave <= 5) return 'A respectable showing. The shutters were right there, though.';
  if (wave <= 9) return 'You got deep enough to be useful. Then the runners arrived.';
  if (wave <= 14) return 'Genuinely good. Somewhere around here the maths stops being on your side.';
  return 'Nobody survives Blackpine. You just took longer about it than most.';
}

export default function GameOver({ result, bestWave, onRestart, onMenu }: Props) {
  const accuracy = result.shotsFired > 0 ? Math.round((result.shotsHit / result.shotsFired) * 100) : 0;
  const minutes = Math.floor(result.timeSurvived / 60);
  const seconds = Math.floor(result.timeSurvived % 60);

  return (
    <div className="over">
      <div className="over__box">
        <p className="kicker">Signal lost &middot; Blackpine District</p>
        <h1>You Died</h1>
        <p className="over__flavour">{flavour(result.wave)}</p>

        <div className="over__grid">
          <div className="over__stat over__stat--hero">
            <span>Wave reached</span>
            <b>{result.wave}</b>
          </div>
          <div className="over__stat over__stat--hero">
            <span>Points</span>
            <b>{result.points.toLocaleString()}</b>
          </div>
          <div className="over__stat">
            <span>Kills</span>
            <b>{result.kills}</b>
          </div>
          <div className="over__stat">
            <span>Headshots</span>
            <b>{result.headshots}</b>
          </div>
          <div className="over__stat">
            <span>Knife kills</span>
            <b>{result.meleeKills}</b>
          </div>
          <div className="over__stat">
            <span>Accuracy</span>
            <b>{accuracy}%</b>
          </div>
          <div className="over__stat">
            <span>Survived</span>
            <b>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </b>
          </div>
          <div className="over__stat">
            <span>Last held</span>
            <b style={{ fontSize: 16, fontFamily: 'var(--font-mono)' }}>{result.bestWeapon}</b>
          </div>
        </div>

        <div className="over__row">
          <button className="btn btn--primary" onClick={onRestart} autoFocus>
            Run it again
          </button>
          <button className="btn btn--ghost" onClick={onMenu}>
            Main menu
          </button>
        </div>

        <p className="over__hint">
          Best this session: wave {Math.max(bestWave, result.wave)}
        </p>
      </div>
    </div>
  );
}
