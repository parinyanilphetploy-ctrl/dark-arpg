import type { ItemInstance, SaveFile, Slot } from "../save/schema";
import { baseOf, equipSlotFor, itemValue } from "./items";

export const BAG_SIZE = 30;

/**
 * Bag + equipment, stored directly in the save file (bag order = grid order).
 * Every change calls onChange so stats and UI can refresh.
 */
export class Inventory {
  onChange: () => void = () => {};

  constructor(private save: SaveFile) {}

  get items(): ItemInstance[] {
    return this.save.inventory;
  }

  get equipment(): SaveFile["equipment"] {
    return this.save.equipment;
  }

  get full() {
    return this.items.length >= BAG_SIZE;
  }

  add(item: ItemInstance): boolean {
    if (this.full) return false;
    this.items.push(item);
    this.onChange();
    return true;
  }

  canEquip(item: ItemInstance): boolean {
    return baseOf(item).levelReq <= this.save.character.level;
  }

  /** Slot `item` would go into, and what's there now. */
  targetSlot(item: ItemInstance): Slot {
    return equipSlotFor(baseOf(item).type, this.equipment);
  }

  /** Equipment as it would be with `item` equipped (for stat comparison). */
  previewEquip(item: ItemInstance): SaveFile["equipment"] {
    return { ...this.equipment, [this.targetSlot(item)]: item };
  }

  /** Equip the bag item at `index`; the replaced item takes its bag cell. */
  equip(index: number): boolean {
    const item = this.items[index];
    if (!item || !this.canEquip(item)) return false;
    const slot = this.targetSlot(item);
    const prev = this.equipment[slot];
    this.equipment[slot] = item;
    if (prev) this.items[index] = prev;
    else this.items.splice(index, 1);
    this.onChange();
    return true;
  }

  unequip(slot: Slot): boolean {
    const item = this.equipment[slot];
    if (!item || this.full) return false;
    delete this.equipment[slot];
    this.items.push(item);
    this.onChange();
    return true;
  }

  /** Take an item out of the bag (e.g. to drop it on the ground). */
  remove(index: number): ItemInstance | undefined {
    const [item] = this.items.splice(index, 1);
    if (item) this.onChange();
    return item;
  }

  /** Destroy the bag item at `index` for gold. Returns the gold gained. */
  salvage(index: number): number {
    const item = this.items[index];
    if (!item) return 0;
    const gold = itemValue(item);
    this.items.splice(index, 1);
    this.save.character.gold += gold;
    this.onChange();
    return gold;
  }
}
