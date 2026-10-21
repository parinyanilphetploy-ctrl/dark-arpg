import { AFFIXES, ITEMS, type AffixDef, type ItemBase, type ItemType } from "../data";
import type { ItemInstance, Rarity, SaveFile, Slot } from "../save/schema";

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#c9c4b8",
  magic: "#6f8fff",
  rare: "#ffd94a",
  legendary: "#ff8c22",
};

const RARITY_WEIGHT: Record<Rarity, number> = { common: 70, magic: 22, rare: 7, legendary: 1 };
const AFFIX_COUNT: Record<Rarity, [number, number]> = {
  common: [0, 0],
  magic: [1, 2],
  rare: [3, 4],
  legendary: [4, 4],
};
const VALUE_MULT: Record<Rarity, number> = { common: 1, magic: 3, rare: 8, legendary: 25 };

const RARE_A = ["Grim", "Blood", "Dread", "Storm", "Gloom", "Bone", "Ash", "Wraith", "Hollow", "Rot"];
const RARE_B = ["Bite", "Ward", "Song", "Grasp", "Shell", "Fang", "Veil", "Mark", "Coil", "Thorn"];
const LEGENDARY = [
  "Doombringer",
  "Soulreaver",
  "Hellfire's Kiss",
  "The Ashen Oath",
  "Grief",
  "Bloodmoon",
  "Wraithbane",
  "Oblivion's Echo",
];

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Short unique id. (crypto.randomUUID needs HTTPS, which a phone on the LAN dev server lacks.) */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function baseOf(item: ItemInstance): ItemBase {
  return ITEMS[item.baseId];
}

/** `boost` multiplies the weight of every non-common rarity. */
export function rollRarity(boost = 1): Rarity {
  const weights = Object.entries(RARITY_WEIGHT).map(
    ([r, w]) => [r as Rarity, r === "common" ? w : w * boost] as const,
  );
  let roll = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [r, w] of weights) {
    roll -= w;
    if (roll <= 0) return r;
  }
  return "common";
}

function rollAffix(a: AffixDef, ilvl: number, high: boolean): number {
  const min = a.min + a.perLevel * (ilvl - 1);
  const max = a.max + a.perLevel * (ilvl - 1);
  // Legendaries roll in the top 40% of the range
  const t = high ? 0.6 + 0.4 * Math.random() : Math.random();
  return Math.max(1, Math.round(min + (max - min) * t));
}

/** A random item of item level `ilvl` from any base the level allows. */
export function generateItem(ilvl: number, rarityBoost = 1): ItemInstance {
  const bases = Object.entries(ITEMS).filter(([, b]) => b.levelReq <= Math.max(1, ilvl));
  const [baseId, base] = pick(bases);
  const rarity = rollRarity(rarityBoost);

  const [lo, hi] = AFFIX_COUNT[rarity];
  const count = lo + Math.floor(Math.random() * (hi - lo + 1));
  const pool = Object.entries(AFFIXES).filter(([, a]) => a.types.includes(base.type));
  // Fisher–Yates so each affix appears at most once
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const affixes = pool
    .slice(0, count)
    .map(([id, a]) => ({ id, value: rollAffix(a, ilvl, rarity === "legendary") }));

  const item: ItemInstance = { uid: uid(), baseId, rarity, itemLevel: ilvl, affixes };
  if (rarity === "rare") item.name = `${pick(RARE_A)} ${pick(RARE_B)}`;
  if (rarity === "legendary") item.name = pick(LEGENDARY);
  return item;
}

export function itemName(item: ItemInstance): string {
  if (item.name) return item.name;
  const base = baseOf(item);
  if (item.rarity !== "magic") return base.name;
  const defs = item.affixes.map((a) => AFFIXES[a.id]);
  const prefix = defs.find((d) => d.prefix)?.prefix;
  const suffix = defs.find((d) => d.suffix)?.suffix;
  return [prefix, base.name, suffix].filter(Boolean).join(" ");
}

export function affixText(a: ItemInstance["affixes"][number]): string {
  return AFFIXES[a.id].text.replace("{v}", String(a.value));
}

/** Equipment slot an item of `type` goes into (rings fill the first free ring slot). */
export function equipSlotFor(type: ItemType, equipment: SaveFile["equipment"]): Slot {
  if (type === "ring") return !equipment.ring1 ? "ring1" : !equipment.ring2 ? "ring2" : "ring1";
  return type;
}

/** Gold from salvaging. */
export function itemValue(item: ItemInstance): number {
  return Math.max(1, Math.round(item.itemLevel * 2 * VALUE_MULT[item.rarity]));
}
