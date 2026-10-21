export const CRIT_CHANCE = 0.15;
export const CRIT_MULTIPLIER = 1.75;

export interface DamageRoll {
  amount: number;
  crit: boolean;
}

export function rollDamage([min, max]: [number, number], critChance = 0): DamageRoll {
  const base = min + Math.random() * (max - min);
  const crit = Math.random() < critChance;
  return { amount: Math.round(crit ? base * CRIT_MULTIPLIER : base), crit };
}
