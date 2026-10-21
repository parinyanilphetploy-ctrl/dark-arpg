import type { Player } from "../game/Player";
import { xpToNext } from "../game/stats";
import type { SaveFile } from "../save/schema";

/** Player-facing HUD: health + XP bars, info line, centre banner messages. */
export class Hud {
  /** Fired by the bag button. */
  onBag: () => void = () => {};
  /** Fired by the sound button. */
  onSound: () => void = () => {};

  private soundBtn = document.getElementById("sound-btn")!;
  private fadeEl = document.getElementById("fade")!;

  private hpFill = document.querySelector<HTMLElement>("#player-hp .fill")!;
  private hpText = document.querySelector<HTMLElement>("#player-hp .text")!;
  private xpFill = document.querySelector<HTMLElement>("#player-xp .fill")!;
  private info = document.getElementById("hud-info")!;
  private bannerEl = document.getElementById("banner")!;
  private bannerTimer = 0;
  private last = "";

  constructor() {
    const bag = document.getElementById("bag-btn")!;
    bag.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onBag();
    });
    this.soundBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.onSound();
    });
  }

  setSound(muted: boolean) {
    this.soundBtn.textContent = muted ? "🔇" : "🔊";
  }

  /** Black full-screen fade (between floors). */
  fade(on: boolean) {
    this.fadeEl.classList.toggle("on", on);
  }

  update(dt: number, player: Player, save: SaveFile, floor: number) {
    const { maxHp, potions } = player;
    // Regen makes hp fractional; round so the DOM isn't rewritten every frame
    const hp = Math.ceil(player.hp);
    const { level, xp, gold } = save.character;
    // Touch the DOM only when something changed
    const key = `${hp}|${maxHp}|${potions}|${level}|${xp}|${gold}|${floor}`;
    if (key !== this.last) {
      this.last = key;
      this.hpFill.style.transform = `scaleX(${hp / maxHp})`;
      this.hpText.textContent = `${hp} / ${maxHp}`;
      this.xpFill.style.transform = `scaleX(${Math.min(1, xp / xpToNext(level))})`;
      this.info.textContent = `Lv ${level} · ${gold} Gold · Potions ${potions} · Floor ${floor}`;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove("show");
    }
  }

  banner(text: string, seconds = 1.8) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("show");
    this.bannerTimer = seconds;
  }
}
