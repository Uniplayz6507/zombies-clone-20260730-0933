import { SCORING } from '../content/waves.data';

/**
 * Points.
 *
 * Deliberately a single currency used for both survival tools (ammo, doors) and
 * power (weapons, Retool). Every kill is therefore a decision about what you are
 * saving for, which is the entire economic loop of the genre.
 */
export class Economy {
  points = SCORING.startingPoints;
  totalEarned = 0;
  totalSpent = 0;

  reset(): void {
    this.points = SCORING.startingPoints;
    this.totalEarned = 0;
    this.totalSpent = 0;
  }

  award(amount: number): void {
    if (amount <= 0) return;
    this.points += amount;
    this.totalEarned += amount;
  }

  canAfford(cost: number): boolean {
    return this.points >= cost;
  }

  /** Returns false and changes nothing if the player cannot afford it. */
  spend(cost: number): boolean {
    if (this.points < cost) return false;
    this.points -= cost;
    this.totalSpent += cost;
    return true;
  }
}
