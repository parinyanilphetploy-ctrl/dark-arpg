import * as THREE from "three";
import type { ProjectileDef } from "../data";
import { glowTexture } from "./dungeon/textures";
import type { Monster } from "./Monster";
import { distXZ } from "./movement";
import type { Navigation } from "./Navigation";

const FLIGHT_HEIGHT = 1.1;

interface Shot {
  def: ProjectileDef;
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** Distance left before hitting a wall / max range. */
  remaining: number;
  piercesLeft: number;
  hit: Set<Monster>;
}

/**
 * Player projectiles (arrows, spell orbs). Each flies straight on the ground
 * plane, stops at walls (navmesh raycast at launch) or after its range, and
 * reports hits through onHit / onExplode so damage stays in Game.
 */
export class Projectiles {
  /** A projectile touched a monster (pierce / single-target projectiles). */
  onHit: (m: Monster) => void = () => {};
  /** An exploding projectile went off at `at`. */
  onExplode: (at: THREE.Vector3, radius: number) => void = () => {};

  private shots: Shot[] = [];
  private materials = new Map<string, THREE.SpriteMaterial>();

  constructor(private scene: THREE.Scene) {}

  fire(def: ProjectileDef, from: THREE.Vector3, yaw: number, range: number, nav: Navigation) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const to = from.clone().addScaledVector(dir, range);
    const sprite = new THREE.Sprite(this.material(def.color));
    sprite.scale.setScalar(def.size * 2.5);
    const pos = from.clone().setY(from.y + FLIGHT_HEIGHT);
    sprite.position.copy(pos);
    this.scene.add(sprite);
    this.shots.push({
      def,
      sprite,
      pos,
      dir,
      remaining: nav.clearDistance(from, to),
      piercesLeft: def.pierce ?? 0,
      hit: new Set(),
    });
  }

  update(dt: number, monsters: Monster[]) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const step = Math.min(s.def.speed * dt, s.remaining);
      s.pos.addScaledVector(s.dir, step);
      s.remaining -= step;
      s.sprite.position.copy(s.pos);

      let done = s.remaining <= 0;
      for (const m of monsters) {
        if (done || !m.alive || s.hit.has(m)) continue;
        if (distXZ(s.pos, m.pos) > s.def.radius + m.radius) continue;
        if (s.def.explode) {
          done = true;
          break;
        }
        s.hit.add(m);
        this.onHit(m);
        if (s.piercesLeft-- <= 0) done = true;
      }

      if (done) {
        if (s.def.explode) this.onExplode(s.pos.clone().setY(0), s.def.explode);
        this.scene.remove(s.sprite);
        this.shots.splice(i, 1);
      }
    }
  }

  clear() {
    for (const s of this.shots) this.scene.remove(s.sprite);
    this.shots.length = 0;
  }

  private material(color: string) {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      this.materials.set(color, m);
    }
    return m;
  }
}
