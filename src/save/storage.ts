import { get, setMany } from "idb-keyval";
import { migrate } from "./migrations";
import { type SaveFile } from "./schema";

/**
 * Local save in IndexedDB with a rolling backup:
 * every write moves the previous main save into the backup slot first,
 * so a corrupted / half-written save can fall back one step.
 *
 * Browsers abort IndexedDB transactions still pending when a page unloads,
 * so on hide/close we also write a synchronous mirror to localStorage.
 * loadGame() takes whichever of the two is newer.
 */
const MAIN = "save:main";
const BACKUP = "save:backup";
const MIRROR = "arpg:save-mirror";

export async function requestPersistentStorage() {
  try {
    // Asks the browser not to evict our data (matters most on iOS Safari)
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // not supported — fine
  }
}

/** Raw stored data was found but none of it could be loaded. Never overwrite in this case. */
export class UnreadableSaveError extends Error {}

/** Last save we wrote / loaded; becomes the backup on the next write. */
let lastWritten: SaveFile | null = null;
/** Set when any slot held data, readable or not. */
let foundData = false;

function readMirror(): SaveFile | null {
  try {
    const raw = localStorage.getItem(MIRROR);
    if (!raw) return null;
    foundData = true;
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn("Save mirror unreadable", err);
    return null;
  }
}

async function readIdb(): Promise<SaveFile | null> {
  for (const key of [MAIN, BACKUP]) {
    try {
      const raw = await get(key);
      if (!raw) continue;
      foundData = true;
      return migrate(raw);
    } catch (err) {
      console.warn(`Save slot "${key}" unreadable, trying next`, err);
    }
  }
  return null;
}

/**
 * Returns null only when there is genuinely no save. If saves exist but none
 * can be read (e.g. a broken migration), throws UnreadableSaveError so the
 * caller doesn't start a new game on top of them and destroy the player's progress.
 */
export async function loadGame(): Promise<SaveFile | null> {
  foundData = false;
  const idb = await readIdb();
  const mirror = readMirror();
  const newest = mirror && (!idb || mirror.savedAt > idb.savedAt) ? mirror : idb;
  if (!newest) {
    if (foundData) throw new UnreadableSaveError("A save exists but could not be loaded");
    return null;
  }
  lastWritten = idb;
  // Bring IndexedDB up to date if the mirror was ahead
  if (newest === mirror) await saveGame(structuredClone(mirror));
  return structuredClone(newest);
}

/** Synchronous save for unload paths; always completes before the page goes away. */
function saveMirror(save: SaveFile) {
  try {
    save.savedAt = Date.now();
    localStorage.setItem(MIRROR, JSON.stringify(save));
  } catch {
    // quota / private mode — the IndexedDB save is still attempted
  }
}

/** Main + backup are written together in one IndexedDB transaction. */
export function saveGame(save: SaveFile): Promise<void> {
  save.savedAt = Date.now();
  const snapshot = structuredClone(save);
  const entries: [string, SaveFile][] = [[MAIN, snapshot]];
  if (lastWritten) entries.push([BACKUP, lastWritten]);
  lastWritten = snapshot;
  return setMany(entries);
}

/**
 * Autosave on an interval and whenever the page is hidden
 * (mobile users swipe the app away without warning).
 */
export function startAutosave(getSave: () => SaveFile, intervalMs = 45_000) {
  const tick = () => void saveGame(getSave());
  const flushNow = () => {
    const save = getSave();
    saveMirror(save);
    void saveGame(save);
  };
  const onHide = () => document.visibilityState === "hidden" && flushNow();

  const id = setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flushNow);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flushNow);
  };
}

/** Download the save as a .json file (manual backup / move to another device). */
export function exportSave(save: SaveFile) {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `arpg-save-${new Date(save.savedAt).toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importSave(file: File): Promise<SaveFile> {
  const save = migrate(JSON.parse(await file.text()));
  await saveGame(save);
  return save;
}
