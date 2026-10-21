import * as THREE from "three";
import type { ClassDef } from "../data";
import type { QualityProfile } from "../settings";
import { Animator } from "./Animator";
import { createBlobShadow, instantiateCharacter, type CharacterModel, type HitFlash } from "./models";
import { dampYaw, stepAlongPath } from "./movement";
import type { Navigation } from "./Navigation";
import type { Stats } from "./stats";

/** Stand-in used for any class whose own model file isn't there yet. */
const PLACEHOLDER_MODEL = "models/robot.glb";
const PLACEHOLDER_CLIPS: ClassDef["clips"] = { idle: "Idle", run: "Running", attack: "Punch", death: "Death" };
const RUN_SPEED = 6; // m/s
const TURN_SPEED = 14;
/** Fraction of the attack animation after which the swing is over and the player can act. */
const ATTACK_END_AT = 0.8;

type State = "idle" | "run" | "attack" | "dead";

/**
 * The player character: model + animation state machine + movement + health.
 * Movement is either along a navmesh path (click / tap) or direct
 * (WASD / joystick), always kept on walkable ground by the navmesh.
 * Class (model, clips, reach, attack timing) comes from data/classes.json.
 */
export class Player {
  // Combat stats; set from class + level + equipment via applyStats()
  maxHp = 100;
  hp = 100;
  damage: [number, number] = [4, 8];
  critChance = 0.1;
  lifeOnHit = 0;
  private moveSpeed = 1;

  /** Melee reach, or projectile range. */
  readonly attackRange: number;
  /** Full width of a melee swing in front of the player, radians. */
  readonly attackArc: number;
  readonly radius = 0.4;
  readonly maxPotions = 3;
  potions = this.maxPotions;
  /** Count of attacks started (lets the game react to new swings, e.g. play a sound). */
  swings = 0;

  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private yaw = 0;
  private targetYaw = 0;

  private path: THREE.Vector3[] = [];
  private state: State = "idle";
  private attackTime = 0;
  private attackLanded = false;

  private animator: Animator<State>;
  private flash: HitFlash;
  private desired = new THREE.Vector3();

  private constructor(
    readonly cls: ClassDef,
    model: CharacterModel,
    clips: ClassDef["clips"],
  ) {
    this.root = model.root;
    this.flash = model.flash;
    this.attackRange = cls.attack.range;
    this.attackArc = THREE.MathUtils.degToRad(cls.attack.arc ?? 120);
    this.animator = new Animator<State>(model.root, model.animations, {
      idle: { clip: clips.idle },
      run: { clip: clips.run },
      attack: { clip: clips.attack, once: true, speed: cls.attack.animSpeed },
      dead: { clip: clips.death, once: true },
    });
    this.animator.play("idle", 0);
  }

  static async create(cls: ClassDef, quality: QualityProfile): Promise<Player> {
    let model: CharacterModel;
    let clips = cls.clips;
    try {
      model = await instantiateCharacter(cls.model, cls.height, { shadows: quality.shadows });
    } catch {
      // No real model for this class yet: tinted robot, so classes still look different
      console.info(`[player] ${cls.model} not found, using placeholder`);
      model = await instantiateCharacter(PLACEHOLDER_MODEL, cls.height, { shadows: quality.shadows, tint: cls.tint });
      clips = PLACEHOLDER_CLIPS;
    }
    const p = new Player(cls, model, clips);
    if (!quality.shadows) p.root.add(createBlobShadow(1.4));
    return p;
  }

  get isRanged() {
    return this.cls.attack.kind === "projectile";
  }

  get alive() {
    return this.state !== "dead";
  }

  /** Direction the player is facing / swinging, radians. */
  get facing() {
    return this.targetYaw;
  }

  get animState(): State {
    return this.state;
  }

  setPosition(p: THREE.Vector3) {
    this.pos.copy(p);
    this.prevPos.copy(p);
    this.root.position.copy(p);
  }

  /** Path-find to `point`. Returns the final reachable point, or null. */
  moveTo(point: THREE.Vector3, nav: Navigation): THREE.Vector3 | null {
    // Can't move while dead or before the current swing has landed
    if (this.state === "dead" || (this.state === "attack" && !this.attackLanded)) return null;
    const path = nav.findPath(this.pos, point);
    // First point is our own position
    this.path = path.slice(1);
    return this.path.length ? this.path[this.path.length - 1] : null;
  }

  /** Start an attack, optionally turning to face `aimAt`. Returns false if busy. */
  attack(aimAt?: THREE.Vector3): boolean {
    if (this.state === "attack" || this.state === "dead") return false;
    this.path = [];
    if (aimAt) {
      const dx = aimAt.x - this.pos.x;
      const dz = aimAt.z - this.pos.z;
      if (dx * dx + dz * dz > 0.01) this.targetYaw = this.yaw = Math.atan2(dx, dz);
    }
    this.attackTime = 0;
    this.attackLanded = false;
    this.swings++;
    this.setState("attack");
    return true;
  }

  takeDamage(amount: number) {
    if (this.state === "dead") return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash.trigger(0.8);
    if (this.hp === 0) {
      this.path = [];
      this.setState("dead");
    }
  }

  applyStats(s: Stats) {
    this.maxHp = s.maxHp;
    this.hp = Math.min(this.hp, this.maxHp);
    this.damage = s.damage;
    this.critChance = s.critChance;
    this.lifeOnHit = s.lifeOnHit;
    this.moveSpeed = s.moveSpeed;
    this.animator.setSpeed("attack", this.cls.attack.animSpeed * s.attackSpeed);
  }

  heal(amount: number): number {
    if (this.state === "dead") return 0;
    const healed = Math.min(this.maxHp - this.hp, amount);
    this.hp += healed;
    return healed;
  }

  /** Drink a potion: heals 40% of max HP. Returns the amount healed (0 if none used). */
  drinkPotion(): number {
    if (this.state === "dead" || this.potions <= 0 || this.hp >= this.maxHp) return 0;
    this.potions--;
    return this.heal(Math.round(this.maxHp * 0.4));
  }

  respawn(at: THREE.Vector3) {
    this.hp = this.maxHp;
    this.potions = this.maxPotions;
    this.setPosition(at);
    this.setState("idle");
  }

  /**
   * Fixed-step gameplay update. `move` = direct input (x, z), length 0..1.
   * Returns true on the tick an attack lands, so the game can resolve hits.
   */
  update(dt: number, move: THREE.Vector2, nav: Navigation): boolean {
    this.prevPos.copy(this.pos);
    if (this.state === "dead") return false;

    let landed = false;
    if (this.state === "attack") {
      this.attackTime += dt;
      const duration = this.animator.duration("attack");
      if (!this.attackLanded && this.attackTime >= duration * this.cls.attack.hitAt) {
        this.attackLanded = true;
        landed = true;
      }
      // After the blow lands, moving cancels the rest of the swing
      const cancel = this.attackLanded && (move.lengthSq() > 0.01 || this.path.length > 0);
      if (this.attackTime < duration * ATTACK_END_AT && !cancel) return landed;
      this.setState("idle");
    }

    let moving = false;
    if (move.lengthSq() > 0.01) {
      // Direct control cancels any click-to-move path
      this.path = [];
      const step = RUN_SPEED * this.moveSpeed * dt;
      this.desired.set(this.pos.x + move.x * step, this.pos.y, this.pos.z + move.y * step);
      this.targetYaw = Math.atan2(move.x, move.y);
      moving = true;
    } else if (this.path.length) {
      const yaw = stepAlongPath(this.pos, this.path, RUN_SPEED * this.moveSpeed * dt, this.desired);
      if (yaw !== null) this.targetYaw = yaw;
      moving = true;
    }

    if (moving) nav.moveAlong(this.pos, this.desired, this.pos);
    this.setState(moving ? "run" : "idle");
    return landed;
  }

  /** Per-frame visuals: interpolate position, turn smoothly, advance animation. */
  render(alpha: number, frameDt: number) {
    this.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.yaw = dampYaw(this.yaw, this.targetYaw, TURN_SPEED, frameDt);
    this.root.rotation.y = this.yaw;
    this.animator.update(frameDt);
    this.flash.update(frameDt);
  }

  private setState(next: State) {
    if (this.state === next) return;
    this.state = next;
    this.animator.play(next, next === "attack" ? 0.08 : next === "dead" ? 0.1 : 0.2);
  }
}
