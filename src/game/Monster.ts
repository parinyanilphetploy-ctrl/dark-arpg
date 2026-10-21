import * as THREE from "three";
import { MONSTERS, type MonsterDef } from "../data";
import type { QualityProfile } from "../settings";
import { Animator } from "./Animator";
import { rollDamage } from "./combat";
import { createBlobShadow, instantiateCharacter, type CharacterModel, type HitFlash } from "./models";
import { dampYaw, distXZ, stepAlongPath, yawTo } from "./movement";
import type { Navigation } from "./Navigation";
import type { Player } from "./Player";

const MODEL_URL = "models/robot.glb";
const TURN_SPEED = 10;
/** Re-plan the chase path this often (s); pathfinding every tick is wasteful. */
const REPATH_INTERVAL = 0.25;
/** Fraction of the attack animation where the blow lands. */
const ATTACK_HIT_AT = 0.5;
const STAGGER_TIME = 0.25;
const CORPSE_TIME = 3;
const SINK_TIME = 1.2;
/** Give up the chase when the player gets this much further than aggro range. */
const LEASH_FACTOR = 1.6;
/** Health / damage growth per monster level. */
const LEVEL_SCALING = 0.15;

type State = "idle" | "chase" | "attack" | "stagger" | "dead";
type Anim = "idle" | "move" | "attack" | "dead";

/**
 * A melee monster: idles until the player comes within aggro range, chases
 * along the navmesh, winds up and hits, staggers when hit (if allowed), dies.
 */
export class Monster {
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  /** Invisible cylinder used to click / tap on the monster. */
  readonly proxy: THREE.Mesh;
  readonly radius: number;
  readonly maxHp: number;
  hp: number;
  readonly xpReward: number;
  private damage: [number, number];

  private prevPos = new THREE.Vector3();
  private yaw = Math.random() * Math.PI * 2;
  private targetYaw = this.yaw;
  private state: State = "idle";
  private path: THREE.Vector3[] = [];
  private repathTimer = 0;
  private cooldown = 0;
  private attackTime = 0;
  private attackLanded = false;
  private staggerTime = 0;
  private deadTime = 0;
  private knock = new THREE.Vector3();

  private animator: Animator<Anim>;
  private flash: HitFlash;
  private desired = new THREE.Vector3();

  private constructor(
    readonly def: MonsterDef,
    /** Monster level scales health, damage and XP; also the item level of its drops. */
    readonly level: number,
    model: CharacterModel,
  ) {
    this.root = model.root;
    this.flash = model.flash;
    const scale = 1 + LEVEL_SCALING * (level - 1);
    this.maxHp = this.hp = Math.round(def.hp * scale);
    this.damage = [Math.round(def.damage[0] * scale), Math.round(def.damage[1] * scale)];
    this.xpReward = Math.round(def.xp * (1 + 0.25 * (level - 1)));
    this.radius = def.height * 0.25;
    this.animator = new Animator<Anim>(model.root, model.animations, {
      idle: { clip: "Idle" },
      move: { clip: def.moveClip },
      attack: { clip: "Punch", once: true, speed: def.attackAnimSpeed },
      dead: { clip: "Death", once: true },
    });
    this.animator.play("idle", 0);

    this.proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius + 0.15, this.radius + 0.15, def.height),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.proxy.position.y = def.height / 2;
    this.proxy.userData.monster = this;
    this.root.add(this.proxy);
  }

  static async create(id: string, level: number, quality: QualityProfile): Promise<Monster> {
    const def = MONSTERS[id];
    if (!def) throw new Error(`Unknown monster "${id}"`);
    const model = await instantiateCharacter(MODEL_URL, def.height, { shadows: quality.shadows, tint: def.tint });
    const m = new Monster(def, level, model);
    if (!quality.shadows) m.root.add(createBlobShadow(def.height * 0.75));
    return m;
  }

  get alive() {
    return this.state !== "dead";
  }

  /** Dead, faded out, and ready to be removed from the scene. */
  get removable() {
    return this.state === "dead" && this.deadTime > CORPSE_TIME + SINK_TIME;
  }

  setPosition(p: THREE.Vector3) {
    this.pos.copy(p);
    this.prevPos.copy(p);
    this.root.position.copy(p);
  }

  /** Fixed-step AI update. Returns damage dealt to the player this tick. */
  update(dt: number, player: Player, nav: Navigation): number {
    this.prevPos.copy(this.pos);
    this.cooldown -= dt;

    if (this.state === "dead") {
      this.deadTime += dt;
      if (this.deadTime > CORPSE_TIME) this.pos.y -= dt * 0.8; // sink into the ground
      return 0;
    }

    if (this.knock.lengthSq() > 1e-4) {
      this.desired.copy(this.pos).addScaledVector(this.knock, dt);
      nav.moveAlong(this.pos, this.desired, this.pos);
      this.knock.multiplyScalar(Math.exp(-12 * dt));
    }

    if (this.state === "stagger") {
      this.staggerTime -= dt;
      if (this.staggerTime > 0) return 0;
      this.state = "chase";
    }

    if (!player.alive) {
      this.state = "idle";
      this.path = [];
      this.animator.play("idle");
      return 0;
    }

    const dist = distXZ(this.pos, player.pos);
    const reach = this.def.attackRange + player.radius;
    let damage = 0;

    switch (this.state) {
      case "idle":
        if (dist < this.def.aggroRange) this.state = "chase";
        break;

      case "attack": {
        this.attackTime += dt;
        const duration = this.animator.duration("attack");
        if (!this.attackLanded) {
          this.targetYaw = yawTo(this.pos, player.pos);
          if (this.attackTime >= duration * ATTACK_HIT_AT) {
            this.attackLanded = true;
            // Player can dodge by stepping out of reach during the wind-up
            if (dist <= reach + 0.3) damage = rollDamage(this.damage).amount;
          }
        }
        if (this.attackTime >= duration) {
          this.cooldown = this.def.attackCooldown;
          this.state = "chase";
        }
        break;
      }

      case "chase":
        if (dist > this.def.aggroRange * LEASH_FACTOR) {
          this.state = "idle";
          this.path = [];
          this.animator.play("idle");
        } else if (dist <= reach) {
          this.path = [];
          this.targetYaw = yawTo(this.pos, player.pos);
          if (this.cooldown <= 0) this.startAttack();
          else this.animator.play("idle");
        } else {
          this.repathTimer -= dt;
          if (this.repathTimer <= 0 || !this.path.length) {
            this.repathTimer = REPATH_INTERVAL;
            this.path = nav.findPath(this.pos, player.pos).slice(1);
          }
          const yaw = stepAlongPath(this.pos, this.path, this.def.speed * dt, this.desired);
          if (yaw !== null) this.targetYaw = yaw;
          nav.moveAlong(this.pos, this.desired, this.pos);
          this.animator.play("move");
        }
        break;
    }
    return damage;
  }

  /** Apply a hit coming from `from`. Returns true if this killed the monster. */
  takeHit(amount: number, from: THREE.Vector3): boolean {
    if (this.state === "dead") return false;
    this.hp = Math.max(0, this.hp - amount);
    this.flash.trigger();

    this.knock.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (this.knock.lengthSq() > 1e-6) this.knock.normalize().multiplyScalar(this.def.stagger ? 7 : 2.5);

    if (this.hp === 0) {
      this.state = "dead";
      this.path = [];
      this.proxy.removeFromParent();
      this.animator.play("dead", 0.1);
      return true;
    }

    if (this.def.stagger && !(this.state === "attack" && this.attackLanded)) {
      // Interrupts a wind-up that hasn't landed yet
      this.state = "stagger";
      this.staggerTime = STAGGER_TIME;
      this.animator.play("idle", 0.05);
    } else if (this.state === "idle") {
      this.state = "chase";
    }
    return false;
  }

  /** `visible` = near the camera; far monsters skip drawing and animation entirely. */
  render(alpha: number, frameDt: number, visible: boolean) {
    this.root.visible = visible;
    if (!visible) {
      this.root.position.copy(this.pos);
      return;
    }
    this.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.yaw = dampYaw(this.yaw, this.targetYaw, TURN_SPEED, frameDt);
    this.root.rotation.y = this.yaw;
    this.animator.update(frameDt);
    this.flash.update(frameDt);
  }

  dispose() {
    this.flash.dispose();
    this.proxy.geometry.dispose();
  }

  private startAttack() {
    this.state = "attack";
    this.attackTime = 0;
    this.attackLanded = false;
    this.animator.play("attack", 0.1);
  }
}
