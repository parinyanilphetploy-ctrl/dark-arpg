import * as THREE from "three";
import type { ItemInstance, Rarity } from "../save/schema";
import type { WorldLabels } from "../ui/WorldLabels";
import { itemName, RARITY_COLOR } from "./items";
import type { Navigation } from "./Navigation";

export type DropContent = { kind: "item"; item: ItemInstance } | { kind: "gold"; amount: number };

const POP_TIME = 0.45;
const SCATTER_MIN = 0.6;
const SCATTER_MAX = 1.6;

const itemGeo = new THREE.BoxGeometry(0.45, 0.08, 0.3);
const goldGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.08, 10);
const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.5, 6, 1, true);
beamGeo.translate(0, 1.75, 0);
const materials = new Map<string, THREE.Material>();

function material(key: string, make: () => THREE.Material) {
  let m = materials.get(key);
  if (!m) materials.set(key, (m = make()));
  return m;
}

/** An item or gold pile lying on the ground with a clickable name label. */
export class GroundDrop {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly label: HTMLButtonElement;
  private from = new THREE.Vector3();
  private age = 0;

  constructor(
    readonly content: DropContent,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ) {
    this.from.copy(from);
    this.pos.copy(to);

    if (content.kind === "gold") {
      const mesh = new THREE.Mesh(
        goldGeo,
        material("gold", () => new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.8, roughness: 0.3 })),
      );
      this.root.add(mesh);
    } else {
      const rarity = content.item.rarity;
      const color = RARITY_COLOR[rarity];
      const mesh = new THREE.Mesh(
        itemGeo,
        material(`item-${rarity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })),
      );
      mesh.rotation.y = Math.random() * Math.PI;
      this.root.add(mesh);
      if (rarity === "rare" || rarity === "legendary") this.root.add(beam(rarity));
    }
    this.root.position.copy(from);

    this.label = document.createElement("button");
    this.label.className = "loot-label";
    if (content.kind === "gold") {
      this.label.textContent = `${content.amount} Gold`;
      this.label.style.color = "#f2c14e";
    } else {
      this.label.textContent = itemName(content.item);
      this.label.style.color = RARITY_COLOR[content.item.rarity];
    }
  }

  /** Pop out of the monster in a little arc, then settle. */
  update(dt: number) {
    if (this.age >= POP_TIME) return;
    this.age = Math.min(POP_TIME, this.age + dt);
    const t = this.age / POP_TIME;
    this.root.position.lerpVectors(this.from, this.pos, t);
    this.root.position.y += Math.sin(t * Math.PI) * 1.2;
  }
}

function beam(rarity: Rarity) {
  const m = new THREE.Mesh(
    beamGeo,
    material(
      `beam-${rarity}`,
      () =>
        new THREE.MeshBasicMaterial({
          color: RARITY_COLOR[rarity],
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
    ),
  );
  return m;
}

/** All ground drops: spawning, label placement, removal. */
export class LootSystem {
  readonly drops: GroundDrop[] = [];
  /** Called when the player clicks / taps a drop's label. */
  onLabelClick: (drop: GroundDrop) => void = () => {};

  private v = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private labels: WorldLabels,
    private labelRoot: HTMLElement,
  ) {}

  spawn(content: DropContent, from: THREE.Vector3, nav: Navigation): GroundDrop {
    const a = Math.random() * Math.PI * 2;
    const r = SCATTER_MIN + Math.random() * (SCATTER_MAX - SCATTER_MIN);
    this.v.set(from.x + Math.cos(a) * r, from.y, from.z + Math.sin(a) * r);
    const to = nav.closestPoint(this.v) ?? from.clone();

    const drop = new GroundDrop(content, from, to);
    drop.label.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.onLabelClick(drop);
    });
    this.scene.add(drop.root);
    this.labelRoot.appendChild(drop.label);
    this.drops.push(drop);
    return drop;
  }

  remove(drop: GroundDrop) {
    const i = this.drops.indexOf(drop);
    if (i < 0) return;
    this.drops.splice(i, 1);
    this.scene.remove(drop.root);
    drop.label.remove();
  }

  update(dt: number) {
    for (const d of this.drops) d.update(dt);
  }

  /** Call after the camera has moved this frame. */
  placeLabels() {
    for (const d of this.drops) {
      this.v.copy(d.root.position).setY(d.root.position.y + 0.35);
      d.label.style.display = this.labels.place(d.label, this.v) ? "" : "none";
    }
  }
}
