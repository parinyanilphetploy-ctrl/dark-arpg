/**
 * Save file shape. Bump SAVE_VERSION and add a migration in migrations.ts
 * whenever this changes. Store only IDs + rolled values — static item data
 * comes from src/data/*.json.
 */
import type { ClassId } from "../data";

export const SAVE_VERSION = 2;

export type Slot = "head" | "chest" | "hands" | "legs" | "feet" | "mainhand" | "offhand" | "ring1" | "ring2" | "amulet";
export type Rarity = "common" | "magic" | "rare" | "legendary";

export interface ItemInstance {
  uid: string;
  baseId: string;
  rarity: Rarity;
  itemLevel: number;
  affixes: { id: string; value: number }[];
  /** Generated name for rare / legendary items; others are named from base + affixes. */
  name?: string;
}

export interface SaveFile {
  version: typeof SAVE_VERSION;
  savedAt: number;
  character: {
    name: string;
    class: ClassId;
    level: number;
    xp: number;
    gold: number;
    position: { zone: string; x: number; z: number };
  };
  inventory: ItemInstance[];
  equipment: Partial<Record<Slot, ItemInstance>>;
  skills: Record<string, number>;
  quests: Record<string, "active" | "done">;
  /** Current dungeon floor; the seed regenerates the same layout after a reload. */
  progress?: { floor: number; seed: number };
}

export function newSave(cls: ClassId, name = "Wanderer"): SaveFile {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    character: {
      name,
      class: cls,
      level: 1,
      xp: 0,
      gold: 0,
      position: { zone: "town", x: 0, z: 0 },
    },
    inventory: [],
    equipment: {},
    skills: {},
    quests: {},
  };
}
