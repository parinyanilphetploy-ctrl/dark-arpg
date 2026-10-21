import affixesJson from "./affixes.json";
import classesJson from "./classes.json";
import itemsJson from "./items.json";
import monstersJson from "./monsters.json";

/** Typed access to static game data. Add skills.json etc. here. */

export type ItemType = "mainhand" | "offhand" | "head" | "chest" | "hands" | "legs" | "feet" | "ring" | "amulet";

export interface ItemBase {
  name: string;
  type: ItemType;
  icon: string;
  levelReq: number;
  baseDamage?: [number, number];
  armor?: number;
}

export type StatKey =
  | "damageFlat"
  | "damagePct"
  | "maxHp"
  | "armor"
  | "critChance"
  | "attackSpeed"
  | "moveSpeed"
  | "lifeOnHit"
  | "lifeRegen"
  | "thorns";

export interface AffixDef {
  /** Display text; {v} is replaced by the rolled value. */
  text: string;
  stat: StatKey;
  /** Roll range at item level 1; both ends grow by perLevel per item level. */
  min: number;
  max: number;
  perLevel: number;
  /** Item types this affix can roll on. */
  types: ItemType[];
  /** Used to name magic items: "<prefix> Base <suffix>". */
  prefix?: string;
  suffix?: string;
}

export interface MonsterDef {
  name: string;
  hp: number;
  damage: [number, number];
  /** m/s */
  speed: number;
  attackRange: number;
  /** Seconds between attacks. */
  attackCooldown: number;
  /** Playback speed of the attack animation (higher = faster wind-up). */
  attackAnimSpeed: number;
  aggroRange: number;
  xp: number;
  height: number;
  tint: string;
  /** Whether hits interrupt it (small monsters yes, brutes no). */
  stagger: boolean;
  moveClip: string;
  /** Chance to drop an item / gold on death, 0..1. */
  dropChance: number;
  goldChance: number;
  /** Multiplies the odds of magic+ drops. */
  rarityBoost: number;
}

export type ClassId = "warrior" | "dualblade" | "mage" | "archer";

export interface ProjectileDef {
  /** m/s */
  speed: number;
  /** Hit radius around the projectile. */
  radius: number;
  color: string;
  /** Visual size. */
  size: number;
  /** Explodes on first hit / wall, damaging everything within this radius. */
  explode?: number;
  /** Passes through this many extra monsters. */
  pierce?: number;
}

export interface ClassDef {
  name: string;
  description: string;
  /** GLB for this class. Missing file → the placeholder robot tinted with `tint`. */
  model: string;
  height: number;
  tint: string;
  /** Animation clip names inside `model` for each gameplay state. */
  clips: { idle: string; run: string; attack: string; death: string };
  attack: {
    kind: "melee" | "projectile";
    /** Melee reach, or how far a projectile flies (m). */
    range: number;
    /** Melee swing width, degrees. */
    arc?: number;
    animSpeed: number;
    /** Fraction of the attack animation where the hit lands / projectile is released. */
    hitAt: number;
    projectile?: ProjectileDef;
  };
  baseHp: number;
  damageMult: number;
  moveSpeed: number;
}

// JSON imports widen tuples to number[], so go through unknown
export const ITEMS = itemsJson as unknown as Record<string, ItemBase>;
export const AFFIXES = affixesJson as unknown as Record<string, AffixDef>;
export const MONSTERS = monstersJson as unknown as Record<string, MonsterDef>;
export const CLASSES = classesJson as unknown as Record<ClassId, ClassDef>;
