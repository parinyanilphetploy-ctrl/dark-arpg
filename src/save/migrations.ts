import { CLASSES } from "../data";
import { SAVE_VERSION, type SaveFile } from "./schema";

/** migrations[n] upgrades a save from version n to n + 1. */
const migrations: Record<number, (s: any) => any> = {
  // v2: the four classes from the character sheets replace the original two
  1: (s) => ({
    ...s,
    version: 2,
    character: { ...s.character, class: s.character.class === "sorcerer" ? "mage" : "warrior" },
  }),
};

export function migrate(raw: unknown): SaveFile {
  let s = raw as any;
  if (!s || typeof s.version !== "number") throw new Error("Not a save file");
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer game version (${s.version})`);

  while (s.version < SAVE_VERSION) {
    const step = migrations[s.version];
    if (!step) throw new Error(`No migration from save version ${s.version}`);
    s = step(s);
  }
  // Repair values that no longer exist in game data rather than crash later
  if (!(s.character?.class in CLASSES)) s = { ...s, character: { ...s.character, class: "warrior" } };
  return s as SaveFile;
}
