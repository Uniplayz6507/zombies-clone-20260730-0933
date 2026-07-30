import './HUD.css';
import type { HudSnapshot } from '../types';

interface Props {
  hud: HudSnapshot;
  /** 0-1, drives crosshair bloom. */
  spread: number;
  stamina: number;
}

/**
 * The 2D overlay.
 *
 * Re-renders roughly ten times a second (whenever the engine flushes a changed
 * HUD snapshot), never sixty. One-shot animations are driven by monotonic
 * counters used as React keys: bumping the counter remounts the element, which
 * restarts its CSS animation. That keeps every transient effect off the
 * per-frame state path entirely.
 */
export default function HUD({ hud, spread, stamina }: Props) {
  const health01 = hud.maxHealth > 0 ? hud.health / hud.maxHealth : 0;
  const healthClass = health01 < 0.3 ? 'hud__bar hud__bar--crit' : health01 < 0.6 ? 'hud__bar hud__bar--warn' : 'hud__bar';
  const lowAmmo = hud.magSize > 0 && hud.mag <= Math.max(1, Math.floor(hud.magSize * 0.25));

  // Crosshair gap grows with accumulated inaccuracy, so the reticle tells you
  // when to stop holding the trigger.
  const gap = 4 + spread * 18;

  return (
    <div className="hud">
      {/* Damage flash: keyed on the tick so each hit replays the animation. */}
      {hud.damageTick > 0 && <div className="hud__damage" key={`dmg-${hud.damageTick}`} />}

      {/* Crosshair */}
      {!hud.melee && (
        <div className="hud__cross">
          <span style={{ transform: `translateY(${-gap}px)` }} />
          <span style={{ transform: `translateY(${gap}px)` }} />
          <span style={{ transform: `translateX(${-gap}px)` }} />
          <span style={{ transform: `translateX(${gap}px)` }} />
        </div>
      )}
      <div className="hud__dot" />

      {hud.hitmarker > 0 && (
        <div className="hud__hit" key={`hit-${hud.hitmarker}`}>
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {hud.headshotMarker > 0 && (
        <div className="hud__hit hud__hit--head" key={`head-${hud.headshotMarker}`}>
          <i />
          <i />
          <i />
          <i />
        </div>
      )}

      {/* Wave */}
      <div className="hud__corner hud__corner--tl">
        <p className="hud__label">Wave</p>
        <p className="hud__big">{hud.wave.toString().padStart(2, '0')}</p>
        <p className="hud__sub">
          {hud.phase === 'intermission'
            ? 'Regrouping'
            : `${hud.zombiesAlive} active${hud.zombiesLeft > 0 ? ` \u00b7 ${hud.zombiesLeft} inbound` : ''}`}
        </p>
      </div>

      {/* Points */}
      <div className="hud__corner hud__corner--tr">
        <p className="hud__label">Points</p>
        <p className="hud__big hud__big--points">{hud.points.toLocaleString()}</p>
      </div>

      {/* Health + stamina */}
      <div className="hud__corner hud__corner--bl">
        <div className="hud__health">
          <p className="hud__label">
            Condition &middot; {Math.max(0, Math.round(hud.health))}
          </p>
          <div className={healthClass}>
            <i style={{ width: `calc(${Math.max(0, health01) * 100}% - 2px)` }} />
          </div>
          <div className="hud__stamina">
            <i style={{ width: `${Math.max(0, Math.min(1, stamina)) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Weapon + ammo */}
      <div className="hud__corner hud__corner--br">
        <p className="hud__weapon">
          {hud.weaponUpgraded && <em>Retooled </em>}
          {hud.weaponName.replace('Retooled ', '')}
        </p>
        {hud.reloading ? (
          <p className="hud__reloading">Reloading</p>
        ) : (
          <div className={lowAmmo ? 'hud__ammo hud__ammo--low' : 'hud__ammo'}>
            <b>{Number.isFinite(hud.mag) ? hud.mag : '\u221e'}</b>
            <s>/ {Number.isFinite(hud.reserve) ? hud.reserve : '\u221e'}</s>
          </div>
        )}
      </div>

      {/* Intermission / countdown clock */}
      {(hud.phase === 'intermission' || hud.phase === 'countdown') && hud.clock > 0 && (
        <div className="hud__clock">
          {hud.phase === 'countdown' ? 'First contact in' : 'Next wave in'}
          <b>{hud.clock}</b>
        </div>
      )}

      {/* Interaction prompt */}
      {hud.prompt && (
        <div className={hud.promptAffordable || hud.promptCost === 0 ? 'hud__prompt' : 'hud__prompt hud__prompt--poor'}>
          <kbd>E</kbd>
          <span>{hud.prompt}</span>
          {hud.promptCost > 0 && <b>{hud.promptCost.toLocaleString()}</b>}
        </div>
      )}

      {/* Wave banner */}
      {hud.banner && (
        <div className="hud__banner" key={`banner-${hud.bannerTick}`}>
          <h2>{hud.banner}</h2>
          {hud.bannerSub && <p>{hud.bannerSub}</p>}
        </div>
      )}

      {/* Toast */}
      {hud.toast && (
        <div className="hud__toast" key={`toast-${hud.toastTick}`}>
          {hud.toast}
        </div>
      )}
    </div>
  );
}
