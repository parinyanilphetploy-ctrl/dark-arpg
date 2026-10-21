import { AFFIXES, CLASSES, type ClassId, type StatKey } from "../data";
import type { SaveFile } from "../save/schema";
import { baseOf } from "./items";

export const MAX_LEVEL = 50;
const HP_PER_LEVEL = 10;
const DAMAGE_PER_LEVEL = 1;
const BASE_CRIT = 0.1;
/** Damage when no weapon is equipped. */
const FISTS: [number, number] = [6, 10];

/** Final character stats after level and equipment. */
export interface Stats {
  damage: [number, number];
  armor: number;
  maxHp: number;
  /** 0..1 */
  critChance: number;
  /** Multipliers, 1 = base. */
  attackSpeed: number;
  moveSpeed: number;
  lifeOnHit: number;
  /** HP per second. */
  lifeRegen: number;
  /** Damage dealt back to a monster each time it hits the player. */
  thorns: number;
}

export function computeStats(classId: ClassId, level: number, equipment: SaveFile["equipment"]): Stats {
  const cls = CLASSES[classId];
  const sum: Record<StatKey, number> = {
    damageFlat: 0,
    damagePct: 0,
    maxHp: 0,
    armor: 0,
    critChance: 0,
    attackSpeed: 0,
    moveSpeed: 0,
    lifeOnHit: 0,
    lifeRegen: 0,
    thorns: 0,
  };
  let weapon = FISTS;
  let armor = 0;
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    const base = baseOf(item);
    if (base.baseDamage) weapon = base.baseDamage;
    if (base.armor) armor += base.armor;
    for (const a of item.affixes) sum[AFFIXES[a.id].stat] += a.value;
  }

  const flat = sum.damageFlat + (level - 1) * DAMAGE_PER_LEVEL;
  const mult = (1 + sum.damagePct / 100) * cls.damageMult;
  return {
    damage: [Math.round((weapon[0] + flat) * mult), Math.round((weapon[1] + flat) * mult)],
    armor: armor + sum.armor,
    maxHp: cls.baseHp + (level - 1) * HP_PER_LEVEL + sum.maxHp,
    critChance: BASE_CRIT + sum.critChance / 100,
    attackSpeed: 1 + sum.attackSpeed / 100,
    moveSpeed: cls.moveSpeed + sum.moveSpeed / 100,
    lifeOnHit: sum.lifeOnHit,
    lifeRegen: sum.lifeRegen,
    thorns: sum.thorns,
  };
}

/** Fraction of incoming damage removed by armor (diminishing returns, capped). */
export function damageReduction(armor: number): number {
  return Math.min(0.75, armor / (armor + 100));
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.6));
}
