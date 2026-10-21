import { CLASSES } from "../data";
import { BAG_SIZE, type Inventory } from "../game/Inventory";
import { affixText, baseOf, itemName, itemValue, RARITY_COLOR } from "../game/items";
import { computeStats, damageReduction, type Stats } from "../game/stats";
import type { ItemInstance, SaveFile, Slot } from "../save/schema";

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: "head", label: "Helm" },
  { slot: "amulet", label: "Amulet" },
  { slot: "mainhand", label: "Weapon" },
  { slot: "chest", label: "Chest" },
  { slot: "offhand", label: "Off-hand" },
  { slot: "hands", label: "Gloves" },
  { slot: "legs", label: "Pants" },
  { slot: "ring1", label: "Ring" },
  { slot: "feet", label: "Boots" },
  { slot: "ring2", label: "Ring" },
];

type Selection = { from: "bag"; index: number } | { from: "equip"; slot: Slot } | null;

/** One line in the stats panel and in the compare box. */
const STAT_ROWS: { label: string; value: (s: Stats) => number; fmt: (v: number) => string }[] = [
  { label: "Damage", value: (s) => (s.damage[0] + s.damage[1]) / 2, fmt: (v) => v.toFixed(1) },
  { label: "Life", value: (s) => s.maxHp, fmt: (v) => String(Math.round(v)) },
  { label: "Armor", value: (s) => s.armor, fmt: (v) => String(Math.round(v)) },
  { label: "Crit chance", value: (s) => s.critChance * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Attack speed", value: (s) => (s.attackSpeed - 1) * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Move speed", value: (s) => (s.moveSpeed - 1) * 100, fmt: (v) => `${v.toFixed(0)}%` },
  { label: "Life per hit", value: (s) => s.lifeOnHit, fmt: (v) => String(Math.round(v)) },
  { label: "Life per second", value: (s) => s.lifeRegen, fmt: (v) => String(Math.round(v)) },
  { label: "Thorns", value: (s) => s.thorns, fmt: (v) => String(Math.round(v)) },
];

/**
 * Inventory + equipment panel. Tap an item to see details, compare with what's
 * equipped, and equip / salvage / drop it. The game pauses while it's open.
 */
export class InventoryUI {
  isOpen = false;
  onToggle: (open: boolean) => void = () => {};
  /** The player chose to drop this item on the ground. */
  onDrop: (item: ItemInstance) => void = () => {};

  private root: HTMLElement;
  private selection: Selection = null;

  constructor(
    private inv: Inventory,
    private save: SaveFile,
  ) {
    this.root = document.getElementById("inventory")!;
    this.root.addEventListener("click", (e) => this.onClick(e));
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.isOpen) this.close();
    });
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.selection = null;
    this.root.classList.add("open");
    this.render();
    this.onToggle(true);
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove("open");
    this.onToggle(false);
  }

  render() {
    if (!this.isOpen) return;
    const { character } = this.save;
    const stats = computeStats(character.class, character.level, this.inv.equipment);

    const equipCells = SLOTS.map(({ slot, label }) => {
      const item = this.inv.equipment[slot];
      const sel = this.selection?.from === "equip" && this.selection.slot === slot;
      return `<button class="cell equip ${sel ? "sel" : ""}" data-slot="${slot}"
        style="${item ? `--rc:${RARITY_COLOR[item.rarity]}` : ""}">
        ${item ? baseOf(item).icon : `<span class="slot-label">${label}</span>`}</button>`;
    }).join("");

    const bagCells = Array.from({ length: BAG_SIZE }, (_, i) => {
      const item = this.inv.items[i];
      const sel = this.selection?.from === "bag" && this.selection.index === i;
      if (!item) return `<div class="cell empty"></div>`;
      return `<button class="cell ${sel ? "sel" : ""}" data-bag="${i}" style="--rc:${RARITY_COLOR[item.rarity]}">
        ${baseOf(item).icon}</button>`;
    }).join("");

    const statRows = STAT_ROWS.map((r) => `<div><span>${r.label}</span><b>${r.fmt(r.value(stats))}</b></div>`).join("");
    const dr = Math.round(damageReduction(stats.armor) * 100);

    // Re-rendering replaces the panel, so carry its scroll position over (matters on phones)
    const scrollTop = this.root.querySelector(".inv-panel")?.scrollTop ?? 0;
    this.root.innerHTML = `
      <div class="inv-panel">
        <header>
          <h2>Inventory</h2>
          <span class="gold">${character.gold} Gold</span>
          <button class="close" data-action="close" aria-label="Close">✕</button>
        </header>
        <div class="inv-body">
          <section class="inv-char">
            <div class="equip-grid">${equipCells}</div>
            <div class="stats">
              <div><span>Class</span><b>${CLASSES[character.class].name}</b></div>
              <div><span>Level</span><b>${character.level}</b></div>
              <div><span>Damage range</span><b>${stats.damage[0]}–${stats.damage[1]}</b></div>
              ${statRows}
              <div><span>Damage reduction</span><b>${dr}%</b></div>
            </div>
          </section>
          <section class="inv-bag">
            <div class="bag-grid">${bagCells}</div>
            <div class="detail">${this.detailHtml(stats)}</div>
          </section>
        </div>
      </div>`;
    this.root.querySelector(".inv-panel")!.scrollTop = scrollTop;
  }

  private selectedItem(): ItemInstance | undefined {
    const s = this.selection;
    if (!s) return undefined;
    return s.from === "bag" ? this.inv.items[s.index] : this.inv.equipment[s.slot];
  }

  private detailHtml(current: Stats): string {
    const item = this.selectedItem();
    if (!item) return `<p class="hint">Tap an item to inspect it.</p>`;
    const base = baseOf(item);
    const color = RARITY_COLOR[item.rarity];
    const lvlOk = this.inv.canEquip(item);

    const baseLine = base.baseDamage
      ? `${base.baseDamage[0]}–${base.baseDamage[1]} Damage`
      : base.armor
        ? `${base.armor} Armor`
        : "";
    const subtitle = item.name ? `${item.rarity} ${base.name}` : `${item.rarity} ${base.type}`;

    let compare = "";
    let actions = "";
    if (this.selection?.from === "bag") {
      const { class: cls, level } = this.save.character;
      const after = computeStats(cls, level, this.inv.previewEquip(item));
      const diffs = STAT_ROWS.map((r) => {
        const d = r.value(after) - r.value(current);
        if (Math.abs(d) < 0.05) return "";
        return `<div class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${r.fmt(Math.abs(d))} ${r.label}</div>`;
      }).join("");
      compare = `<div class="compare"><div class="compare-title">If equipped</div>${diffs || "<div>No change</div>"}</div>`;
      actions = `
        <button data-action="equip" ${lvlOk ? "" : "disabled"}>Equip</button>
        <button data-action="salvage">Salvage (+${itemValue(item)} Gold)</button>
        <button data-action="drop">Drop</button>`;
    } else {
      actions = `<button data-action="unequip" ${this.inv.full ? "disabled" : ""}>Unequip</button>`;
    }

    return `
      <div class="item-name" style="color:${color}">${itemName(item)}</div>
      <div class="item-sub">${subtitle} · item level ${item.itemLevel}</div>
      ${baseLine ? `<div class="item-base">${baseLine}</div>` : ""}
      ${item.affixes.map((a) => `<div class="affix">${affixText(a)}</div>`).join("")}
      <div class="item-req ${lvlOk ? "" : "bad"}">Requires level ${base.levelReq}</div>
      ${compare}
      <div class="actions">${actions}</div>`;
  }

  private onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-bag],[data-slot],[data-action]");
    if (!t) {
      // Click on the dim backdrop closes the panel
      if (e.target === this.root) this.close();
      return;
    }

    if (t.dataset.bag !== undefined) {
      this.selection = { from: "bag", index: Number(t.dataset.bag) };
    } else if (t.dataset.slot) {
      const slot = t.dataset.slot as Slot;
      this.selection = this.inv.equipment[slot] ? { from: "equip", slot } : null;
    } else {
      this.runAction(t.dataset.action!);
    }
    this.render();
    // On narrow screens the detail box is below the grids: bring it into view
    if (this.selection) this.root.querySelector(".detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private runAction(action: string) {
    const s = this.selection;
    if (action === "close") return this.close();
    if (!s) return;
    if (s.from === "bag") {
      if (action === "equip") this.inv.equip(s.index);
      if (action === "salvage") this.inv.salvage(s.index);
      if (action === "drop") {
        const item = this.inv.remove(s.index);
        if (item) this.onDrop(item);
      }
    } else if (action === "unequip") {
      this.inv.unequip(s.slot);
    }
    this.selection = null;
  }
}
