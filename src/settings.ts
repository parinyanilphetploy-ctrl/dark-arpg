/** Per-device settings, kept in localStorage (small, sync, not part of the save). */

export type QualityLevel = "low" | "medium" | "high";

export interface Settings {
  quality: QualityLevel;
  masterVolume: number;
  muted: boolean;
  showFps: boolean;
}

const KEY = "arpg:settings";

export const isTouchDevice = matchMedia("(pointer: coarse)").matches;

function defaultQuality(): QualityLevel {
  if (isTouchDevice) return "low";
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? "high" : "medium";
}

const defaults: Settings = {
  quality: defaultQuality(),
  masterVolume: 0.8,
  muted: false,
  showFps: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // storage blocked (private mode etc.) — fall back to defaults
  }
  return { ...defaults };
}

/**
 * Store only what the player changed, merged into what's already stored.
 * Saving the full object would freeze auto-detected defaults (like quality) forever.
 */
export function saveSettings(patch: Partial<Settings>) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...stored, ...patch }));
  } catch {
    // ignore
  }
}

export interface QualityProfile {
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Real point lights shared by the torches nearest the player (each costs shader time). */
  torchLights: number;
  /** Floating dust particles around the player. */
  dust: number;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { maxPixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, torchLights: 0, dust: 80 },
  medium: { maxPixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 1024, torchLights: 2, dust: 200 },
  high: { maxPixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, torchLights: 4, dust: 300 },
};
