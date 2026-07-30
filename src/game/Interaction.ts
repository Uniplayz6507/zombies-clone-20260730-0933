import { DOORS, STATIONS, type Zone } from '../content/level.city';
import { effectiveSpec, WEAPONS } from '../content/weapons.data';
import type { SlotId } from './weapons/Arsenal';
import type { Economy } from './Economy';
import type { EventQueue } from './events';
import type { Player } from './Player';

/**
 * Contextual interaction.
 *
 * Pure functions over explicit arguments rather than methods on World, so this
 * module has no circular dependency and can be reasoned about (and tested) on its
 * own. Gating is distance *and* facing: you have to be looking at a panel to buy
 * from it, which stops accidental purchases while backpedalling past one.
 */

export type PromptKind = 'door' | 'buy' | 'refill' | 'ammo' | 'upgrade' | 'blocked';

export interface Prompt {
  kind: PromptKind;
  id: string;
  label: string;
  cost: number;
  affordable: boolean;
}

const REACH = 2.7;
const FACING_DOT = 0.35;

function inFront(player: Player, x: number, z: number): boolean {
  const dx = x - player.pos.x;
  const dz = z - player.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > REACH) return false;
  if (d < 0.3) return true;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  return (dx / d) * fx + (dz / d) * fz > FACING_DOT;
}

/** Nearest eligible interactable, or null. Called once per simulation step. */
export function findPrompt(player: Player, economy: Economy, openDoors: ReadonlySet<string>): Prompt | null {
  let best: Prompt | null = null;
  let bestD = Infinity;

  const consider = (x: number, z: number, p: Prompt) => {
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  };

  for (const door of DOORS) {
    if (openDoors.has(door.id)) continue;
    if (!inFront(player, door.px, door.pz)) continue;
    consider(door.px, door.pz, {
      kind: 'door',
      id: door.id,
      label: `Open ${door.label}`,
      cost: door.cost,
      affordable: economy.canAfford(door.cost),
    });
  }

  const arsenal = player.arsenal;

  for (const st of STATIONS) {
    if (!inFront(player, st.x, st.z)) continue;

    if (st.kind === 'weapon' && st.weapon) {
      const id = st.weapon as SlotId;
      const slot = arsenal.slots[id];
      if (!slot.owned) {
        consider(st.x, st.z, {
          kind: 'buy',
          id: st.id,
          label: `Buy ${st.label}`,
          cost: st.cost,
          affordable: economy.canAfford(st.cost),
        });
      } else {
        const spec = effectiveSpec(id, slot.upgraded);
        const full = slot.reserve >= spec.reserveMax && slot.mag >= spec.magSize;
        const cost = WEAPONS[id].refill;
        consider(st.x, st.z, {
          kind: full ? 'blocked' : 'refill',
          id: st.id,
          label: full ? `${st.label} - ammo full` : `Refill ${st.label}`,
          cost: full ? 0 : cost,
          affordable: !full && economy.canAfford(cost),
        });
      }
    } else if (st.kind === 'ammo') {
      consider(st.x, st.z, {
        kind: 'ammo',
        id: st.id,
        label: 'Ammo Cache - all weapons',
        cost: st.cost,
        affordable: economy.canAfford(st.cost),
      });
    } else {
      const slot = arsenal.slot;
      const already = slot.upgraded;
      consider(st.x, st.z, {
        kind: already ? 'blocked' : 'upgrade',
        id: st.id,
        label: already ? `${WEAPONS[slot.id].name} already retooled` : `Retool ${WEAPONS[slot.id].name}`,
        cost: already ? 0 : st.cost,
        affordable: !already && economy.canAfford(st.cost),
      });
    }
  }

  return best;
}

export interface InteractResult {
  /** Zone unlocked by this interaction, if any. */
  unlockedZone: Zone | null;
  /** Door opened, if any - the caller must recompute the nav flow field. */
  openedDoor: string | null;
}

const NOTHING: InteractResult = { unlockedZone: null, openedDoor: null };

/** Apply a prompt. Returns what changed so the caller can react. */
export function resolveInteract(
  prompt: Prompt,
  player: Player,
  economy: Economy,
  openDoors: Set<string>,
  events: EventQueue,
): InteractResult {
  if (prompt.kind === 'blocked') {
    events.push({ type: 'denied', reason: prompt.label });
    return NOTHING;
  }

  if (!economy.canAfford(prompt.cost)) {
    events.push({ type: 'denied', reason: `Need ${prompt.cost - economy.points} more points` });
    return NOTHING;
  }

  const arsenal = player.arsenal;

  switch (prompt.kind) {
    case 'door': {
      const door = DOORS.find((d) => d.id === prompt.id);
      if (!door) return NOTHING;
      economy.spend(door.cost);
      openDoors.add(door.id);
      events.push({ type: 'purchase', kind: 'door', label: door.label, cost: door.cost });
      events.push({ type: 'doorOpen', id: door.id, label: door.label });
      return { unlockedZone: door.opensZone, openedDoor: door.id };
    }
    case 'buy': {
      const st = STATIONS.find((s) => s.id === prompt.id);
      if (!st?.weapon) return NOTHING;
      economy.spend(st.cost);
      arsenal.grant(st.weapon as SlotId, events);
      events.push({ type: 'purchase', kind: 'weapon', label: st.label, cost: st.cost });
      return NOTHING;
    }
    case 'refill': {
      const st = STATIONS.find((s) => s.id === prompt.id);
      if (!st?.weapon) return NOTHING;
      const id = st.weapon as SlotId;
      const slot = arsenal.slots[id];
      const spec = effectiveSpec(id, slot.upgraded);
      economy.spend(prompt.cost);
      slot.reserve = spec.reserveMax;
      if (slot.mag < spec.magSize) slot.mag = spec.magSize;
      events.push({ type: 'purchase', kind: 'ammo', label: `${st.label} ammo`, cost: prompt.cost });
      return NOTHING;
    }
    case 'ammo': {
      economy.spend(prompt.cost);
      arsenal.refillAll();
      events.push({ type: 'purchase', kind: 'ammo', label: 'Ammo Cache', cost: prompt.cost });
      return NOTHING;
    }
    case 'upgrade': {
      economy.spend(prompt.cost);
      const name = WEAPONS[arsenal.slot.id].name;
      arsenal.upgradeCurrent();
      events.push({ type: 'purchase', kind: 'upgrade', label: `Retooled ${name}`, cost: prompt.cost });
      return NOTHING;
    }
    default:
      return NOTHING;
  }
}
