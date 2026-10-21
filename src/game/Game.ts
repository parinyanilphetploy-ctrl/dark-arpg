import * as THREE from "three";
import type { AudioEngine } from "../core/Audio";
import { CLASSES } from "../data";
import type { Input } from "../core/Input";
import type { SaveFile } from "../save/schema";
import { saveGame } from "../save/storage";
import type { QualityProfile } from "../settings";
import { Hud } from "../ui/Hud";
import { InventoryUI } from "../ui/InventoryUI";
import { WorldLabels } from "../ui/WorldLabels";
import { rollDamage } from "./combat";
import { DungeonLevel } from "./dungeon/DungeonLevel";
import { cellToWorld, generateDungeon, type DungeonLayout, type Room } from "./dungeon/Generator";
import { randomSeed } from "./dungeon/rng";
import { glowTexture } from "./dungeon/textures";
import { CameraShake, Dust, Sparks } from "./fx";
import { Inventory } from "./Inventory";
import { generateItem, itemName, uid } from "./items";
import { LootSystem, type GroundDrop } from "./Loot";
import { Monster } from "./Monster";
import { angleDiff, distXZ, yawTo } from "./movement";
import { Navigation } from "./Navigation";
import { Player } from "./Player";
import { Projectiles } from "./Projectiles";
import { computeStats, damageReduction, MAX_LEVEL, xpToNext, type Stats } from "./stats";

const CAMERA_OFFSET = new THREE.Vector3(0, 16, 11);
const CAMERA_LOOK_HEIGHT = 1;
/** While the pointer is held, re-plan the path at most this often (s). */
const REPATH_INTERVAL = 0.1;
/** Attack button / Space with no mouse aim: auto-target monsters this close. */
const AUTO_TARGET_RANGE = 5;
const RESPAWN_DELAY = 3;
/** Freeze-frame on hit, seconds. Small values = punchy, large = sluggish. */
const HIT_STOP = 0.05;
const HIT_STOP_CRIT = 0.09;
/** Distance at which a clicked drop is picked up / gold is collected automatically. */
const PICKUP_RANGE = 1.2;
const GOLD_AUTO_RANGE = 1.4;
const PORTAL_RANGE = 1.1;
/** Monsters further than this from the camera aren't drawn or animated. */
const CULL_DISTANCE = 24;
const FOG_COLOR = 0x070405;

/**
 * The running game: dungeon floors, player, monster packs, combat and hit
 * feedback, loot, inventory, levelling, and the isometric follow camera.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
  readonly monsters: Monster[] = [];
  floor = 1;

  private level: DungeonLevel | null = null;
  private nav!: Navigation;
  private loading = false;
  /** Huge invisible plane: click / tap picking works anywhere, then the navmesh snaps it. */
  private ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  private sun: THREE.DirectionalLight;

  private raycaster = new THREE.Raycaster();
  private camTarget = new THREE.Vector3();
  private repathTimer = 0;
  private chaseTimer = 0;
  private marker = createClickMarker();
  private markerAge = Infinity;

  /** Monster the player clicked: walk to it, then attack. */
  private attackTarget: Monster | null = null;
  /** Drop label the player clicked: walk to it, then pick it up. */
  private pickupTarget: GroundDrop | null = null;
  private bars = new Map<Monster, HTMLElement>();
  private labels: WorldLabels;
  private hud = new Hud();
  private loot: LootSystem;
  readonly inventory: Inventory;
  private inventoryUI: InventoryUI;
  private stats!: Stats;
  private sparks = new Sparks();
  private projectiles: Projectiles;
  private dust: Dust;
  private shake = new CameraShake();
  private hitStop = 0;
  private respawnTimer = 0;
  private tmp = new THREE.Vector3();

  private constructor(
    private input: Input,
    private save: SaveFile,
    readonly player: Player,
    private quality: QualityProfile,
    private audio: AudioEngine,
  ) {
    const { scene } = this;
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, 12, 30);

    // Dim cold fill; the player's torch and wall torches do the real lighting
    scene.add(new THREE.HemisphereLight(0x4a4258, 0x140a08, 0.55));
    this.sun = new THREE.DirectionalLight(0x8090c0, 0.45);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.setScalar(quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -18;
    sc.right = sc.top = 18;
    scene.add(this.sun, this.sun.target);

    // The player carries a warm light: the classic ARPG pool of light in the dark
    const torch = new THREE.PointLight(0xffa060, 28, 15, 1.6);
    torch.position.set(0, 3, 0.5);
    player.root.add(torch);

    this.dust = new Dust(quality.dust, glowTexture());
    scene.add(player.root, this.marker, this.sparks.points, this.dust.points, this.ground);

    this.projectiles = new Projectiles(scene);
    this.projectiles.onHit = (m) => this.afterHits(this.hitMonster(m) ? 1 : 0, false);
    this.projectiles.onExplode = (at, radius) => {
      this.tmp.copy(at).setY(1);
      this.sparks.burst(this.tmp, 30);
      this.shake.add(0.12);
      let hits = 0;
      let crit = false;
      for (const m of this.monsters) {
        if (!m.alive || distXZ(at, m.pos) > radius + m.radius) continue;
        hits++;
        crit = this.hitMonster(m) || crit;
      }
      this.afterHits(hits, crit);
    };

    const labelRoot = document.getElementById("labels")!;
    this.labels = new WorldLabels(labelRoot, this.camera);
    this.loot = new LootSystem(scene, this.labels, labelRoot);
    this.loot.onLabelClick = (drop) => {
      if (!player.alive || this.inventoryUI.isOpen) return;
      this.attackTarget = null;
      this.pickupTarget = drop;
      this.chaseTimer = 0;
    };

    this.inventory = new Inventory(save);
    this.inventory.onChange = () => {
      this.refreshStats();
      this.inventoryUI.render();
    };
    this.inventoryUI = new InventoryUI(this.inventory, save);
    this.inventoryUI.onDrop = (item) => this.loot.spawn({ kind: "item", item }, player.pos, this.nav);
    this.hud.onBag = () => this.inventoryUI.toggle();
    this.hud.onSound = () => {
      audio.setMuted(!audio.isMuted);
      this.hud.setSound(audio.isMuted);
    };
    this.hud.setSound(audio.isMuted);
    this.refreshStats();
  }

  static async create(input: Input, save: SaveFile, quality: QualityProfile, audio: AudioEngine): Promise<Game> {
    const player = await Player.create(CLASSES[save.character.class], quality);

    // Starter kit for a fresh character
    const c = save.character;
    if (c.level === 1 && !save.equipment.mainhand && save.inventory.length === 0) {
      save.equipment.mainhand = { uid: uid(), baseId: "rusty_sword", rarity: "common", itemLevel: 1, affixes: [] };
    }
    save.progress ??= { floor: 1, seed: randomSeed() };

    const game = new Game(input, save, player, quality, audio);
    player.hp = player.maxHp;
    await game.loadFloor(save.progress.floor, save.progress.seed, true);
    return game;
  }

  /** Recompute stats from level + equipment; call after either changes. */
  private refreshStats() {
    const c = this.save.character;
    this.stats = computeStats(c.class, c.level, this.save.equipment);
    this.player.applyStats(this.stats);
  }

  // ------------------------------------------------------------------ floors

  /** Build floor `floor` from `seed`. `resume` = put the player back at the saved position. */
  private async loadFloor(floor: number, seed: number, resume: boolean) {
    this.loading = true;
    this.floor = floor;

    // Tear down the previous floor
    this.level?.dispose();
    this.nav?.dispose();
    for (const m of this.monsters) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.monsters.length = 0;
    for (const bar of this.bars.values()) bar.remove();
    this.bars.clear();
    for (const d of [...this.loot.drops]) this.loot.remove(d);
    this.projectiles.clear();
    this.attackTarget = this.pickupTarget = null;

    const layout = generateDungeon(seed, floor);
    const level = new DungeonLevel(layout, this.quality, seed);
    this.level = level;
    this.scene.add(level.group);
    this.nav = await Navigation.build(level.navSources);
    // Open with ?nav to see the walkable area
    if (new URLSearchParams(location.search).has("nav")) level.group.add(this.nav.createDebugMesh());

    const saved = this.save.character.position;
    const resumeAt = resume ? this.nav.closestPoint(this.tmp.set(saved.x, 0, saved.z)) : null;
    const spawn = resumeAt && distXZ(resumeAt, this.tmp) < 2 ? resumeAt : (this.nav.closestPoint(level.startPos) ?? level.startPos);
    this.player.setPosition(spawn);
    this.camTarget.copy(spawn);

    await this.populate(layout, floor);
    this.render(0, 0);
    this.loading = false;
    this.hud.banner(`Floor ${floor}`);
  }

  /** Monster packs in every room except the start; the exit room gets the toughest pack. */
  private async populate(layout: DungeonLayout, floor: number) {
    const spawns: { id: string; room: Room }[] = [];
    for (const room of layout.rooms) {
      if (room === layout.start) continue;
      const isExit = room === layout.exit;
      const ghouls = isExit ? 2 + Math.floor(floor / 2) : 2 + Math.floor(Math.random() * 3);
      const brutes = isExit ? 1 + Math.floor(floor / 3) : Math.random() < 0.12 + 0.05 * floor ? 1 : 0;
      for (let i = 0; i < ghouls; i++) spawns.push({ id: "ghoul", room });
      for (let i = 0; i < brutes; i++) spawns.push({ id: "brute", room });
    }

    const monsters = await Promise.all(spawns.map((s) => Monster.create(s.id, floor, this.quality)));
    monsters.forEach((m, i) => {
      const r = spawns[i].room;
      const cell = cellToWorld(
        layout,
        r.x + 1 + Math.floor(Math.random() * (r.w - 2)),
        r.y + 1 + Math.floor(Math.random() * (r.h - 2)),
      );
      m.setPosition(this.nav.closestPoint(this.tmp.set(cell.x, 0, cell.z)) ?? this.tmp);
      this.scene.add(m.root);
      this.monsters.push(m);
      this.bars.set(m, this.labels.createBar());
    });
  }

  private async descend() {
    if (this.loading) return;
    this.loading = true;
    this.audio.play("portal");
    this.hud.fade(true);
    await new Promise((r) => setTimeout(r, 650));
    const next = { floor: this.floor + 1, seed: randomSeed() };
    this.save.progress = next;
    this.player.potions = this.player.maxPotions;
    await this.loadFloor(next.floor, next.seed, false);
    this.save.character.position = { zone: "dungeon", x: this.player.pos.x, z: this.player.pos.z };
    void saveGame(this.save);
    this.hud.fade(false);
  }

  // -------------------------------------------------------------- main loop

  update(dt: number) {
    if (this.loading) return;
    if (this.input.consume("inventory")) this.inventoryUI.toggle();
    // Single-player: the world pauses while the inventory is open
    if (this.inventoryUI.isOpen) {
      this.input.consumePointer();
      return;
    }
    // Hit-stop: freeze the simulation for a few frames so impacts feel heavy
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    this.input.poll();
    const { player, nav } = this;

    const swings = player.swings;
    if (player.alive) this.handlePlayerInput(dt);
    if (player.swings !== swings) this.audio.play("swing");
    if (player.update(dt, this.input.move, nav)) this.resolvePlayerAttack();
    this.projectiles.update(dt, this.monsters);
    this.loot.update(dt);
    if (player.alive) this.collectGold();

    for (const m of this.monsters) {
      const damage = m.update(dt, player, nav);
      if (damage > 0) this.damagePlayer(damage, m);
    }
    if (player.alive && this.stats.lifeRegen) player.heal(this.stats.lifeRegen * dt);
    this.separate();
    this.removeDeadMonsters();

    if (player.alive && this.level && distXZ(player.pos, this.level.exitPos) < PORTAL_RANGE) void this.descend();

    if (!player.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0 && this.level) {
        player.respawn(nav.closestPoint(this.level.startPos) ?? this.level.startPos);
        this.hud.banner("Rise again");
      }
    }

    this.save.character.position.x = player.pos.x;
    this.save.character.position.z = player.pos.z;
  }

  render(alpha: number, frameDt: number) {
    // Animations freeze during hit-stop too
    const animDt = this.hitStop > 0 ? 0 : frameDt;
    this.player.render(alpha, animDt);
    for (const m of this.monsters) {
      m.render(alpha, animDt, distXZ(m.root.position, this.camTarget) < CULL_DISTANCE);
    }
    this.sparks.update(frameDt);
    this.dust.update(frameDt, this.camTarget);
    this.level?.update(frameDt, this.player.pos);
    this.audio.update(frameDt);
    this.updateMarker(frameDt);

    // Smooth camera follow (frame-rate independent damping) + shake
    const k = frameDt > 0 ? 1 - Math.exp(-8 * frameDt) : 1;
    this.camTarget.lerp(this.player.root.position, k);
    this.camera.position.copy(this.camTarget).add(CAMERA_OFFSET).add(this.shake.offset(frameDt));
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + CAMERA_LOOK_HEIGHT, this.camTarget.z);
    this.camera.updateMatrixWorld();
    // Shadow camera follows the player so a small shadow map covers what's on screen
    this.sun.position.copy(this.camTarget).add(this.tmp.set(-8, 18, 6));
    this.sun.target.position.copy(this.camTarget);

    for (const [m, bar] of this.bars) {
      if (m.alive && m.hp < m.maxHp && m.root.visible) {
        this.tmp.copy(m.root.position).setY(m.root.position.y + m.def.height + 0.35);
        this.labels.placeBar(bar, this.tmp, m.hp / m.maxHp);
      } else {
        bar.style.display = "none";
      }
    }
    this.loot.placeLabels();
    this.labels.update(frameDt);
    this.hud.update(frameDt, this.player, this.save, this.floor);
  }

  // ---------------------------------------------------------------- player

  private handlePlayerInput(dt: number) {
    const { input, player, nav } = this;

    if (input.consume("attack")) {
      this.attackTarget = null;
      const autoRange = Math.max(AUTO_TARGET_RANGE, player.attackRange);
      const aim = input.pointerIsMouse ? this.pickGround() : this.nearestMonster(autoRange)?.pos;
      player.attack(aim ?? undefined);
    }
    if (input.consume("potion")) {
      const healed = player.drinkPotion();
      if (healed) {
        this.audio.play("potion");
        this.tmp.copy(player.pos).setY(player.pos.y + 2);
        this.labels.float(this.tmp, `+${healed}`, "heal");
      }
    }
    if (input.move.lengthSq() > 0.01) this.attackTarget = this.pickupTarget = null;

    this.repathTimer -= dt;
    if (this.repathTimer <= 0 && input.consumePointer()) {
      this.repathTimer = REPATH_INTERVAL;
      this.pickupTarget = null;
      const monster = this.pickMonster();
      if (monster) {
        this.attackTarget = monster;
        this.chaseTimer = 0;
      } else {
        this.attackTarget = null;
        const hit = this.pickGround();
        const dest = hit && player.moveTo(hit, nav);
        // While holding, don't restart the marker animation on every re-path
        if (dest && (!input.pointerDown || this.markerAge > 0.3)) this.showMarker(dest);
      }
    }

    // Walk to a clicked drop and pick it up
    const drop = this.pickupTarget;
    if (drop) {
      if (!this.loot.drops.includes(drop)) {
        this.pickupTarget = null;
      } else if (distXZ(player.pos, drop.pos) <= PICKUP_RANGE) {
        this.pickupTarget = null;
        this.pickUp(drop);
      } else {
        this.chaseTimer -= dt;
        if (this.chaseTimer <= 0) {
          this.chaseTimer = 0.2;
          player.moveTo(drop.pos, nav);
        }
      }
    }

    // Attack-move: walk to the clicked monster, swing when in reach
    const target = this.attackTarget;
    if (!target) return;
    if (!target.alive) {
      this.attackTarget = null;
    } else if (distXZ(player.pos, target.pos) <= this.engageRange() + target.radius) {
      // One click = one swing; holding keeps swinging
      if (player.attack(target.pos) && !input.pointerDown) this.attackTarget = null;
    } else {
      this.chaseTimer -= dt;
      if (this.chaseTimer <= 0) {
        this.chaseTimer = 0.2;
        player.moveTo(target.pos, nav);
      }
    }
  }

  /** Distance at which attack-move stops walking and attacks (ranged classes keep some distance). */
  private engageRange() {
    return this.player.isRanged ? this.player.attackRange * 0.85 : this.player.attackRange;
  }

  /**
   * The player's attack just landed. Ranged classes release a projectile;
   * melee classes damage everything in the arc in front.
   */
  private resolvePlayerAttack() {
    const { player } = this;
    const projectile = player.cls.attack.projectile;
    if (projectile) {
      this.projectiles.fire(projectile, player.pos, player.facing, player.attackRange, this.nav);
      return;
    }

    let hits = 0;
    let crit = false;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = distXZ(player.pos, m.pos);
      if (d > player.attackRange + m.radius) continue;
      const off = Math.abs(angleDiff(player.facing, yawTo(player.pos, m.pos)));
      if (d > m.radius && off > player.attackArc / 2) continue;
      hits++;
      crit = this.hitMonster(m) || crit;
    }
    this.afterHits(hits, crit);
  }

  /** Roll and apply one player hit on `m` with its feedback. Returns true if it was a crit. */
  private hitMonster(m: Monster): boolean {
    const { player } = this;
    const roll = rollDamage(player.damage, player.critChance);
    const killed = m.takeHit(roll.amount, player.pos);
    this.tmp.copy(m.pos).setY(m.pos.y + m.def.height * 0.9);
    this.labels.float(this.tmp, String(roll.amount), roll.crit ? "crit" : "normal");
    this.tmp.y = m.pos.y + m.def.height * 0.6;
    this.sparks.burst(this.tmp, roll.crit ? 26 : 12);
    if (killed) this.onMonsterKilled(m);
    return roll.crit;
  }

  /** Shared feedback after an attack connected with `hits` monsters. */
  private afterHits(hits: number, crit: boolean) {
    if (!hits) return;
    if (this.player.lifeOnHit) this.player.heal(this.player.lifeOnHit * hits);
    this.audio.play(crit ? "crit" : "hit");
    this.hitStop = crit ? HIT_STOP_CRIT : HIT_STOP;
    if (crit) this.shake.add(0.2);
  }

  private onMonsterKilled(m: Monster) {
    this.audio.play("monsterDeath");
    this.tmp.copy(m.pos).setY(m.pos.y + m.def.height * 1.2);
    this.labels.float(this.tmp, `+${m.xpReward} XP`, "xp");
    this.grantXp(m.xpReward);
    this.dropLoot(m);
  }

  private damagePlayer(raw: number, attacker: Monster) {
    const { player } = this;
    if (!player.alive) return;
    const amount = Math.max(1, Math.round(raw * (1 - damageReduction(this.stats.armor))));
    player.takeDamage(amount);
    this.audio.play("playerHurt");

    if (this.stats.thorns > 0 && attacker.alive) {
      const killed = attacker.takeHit(this.stats.thorns, player.pos);
      this.tmp.copy(attacker.pos).setY(attacker.pos.y + attacker.def.height * 0.9);
      this.labels.float(this.tmp, String(this.stats.thorns), "normal");
      if (killed) this.onMonsterKilled(attacker);
    }
    this.tmp.copy(player.pos).setY(player.pos.y + 2);
    this.labels.float(this.tmp, String(amount), "player");
    this.shake.add(0.3);
    if (!player.alive) {
      this.attackTarget = null;
      this.respawnTimer = RESPAWN_DELAY;
      this.hud.banner("You died", RESPAWN_DELAY);
    }
  }

  private grantXp(amount: number) {
    const c = this.save.character;
    if (c.level >= MAX_LEVEL) return;
    c.xp += amount;
    let leveled = false;
    while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
      c.xp -= xpToNext(c.level);
      c.level++;
      leveled = true;
    }
    if (!leveled) return;

    this.refreshStats();
    this.player.hp = this.player.maxHp;
    this.player.potions = this.player.maxPotions;
    this.audio.play("levelUp");
    this.hud.banner(`Level ${c.level}`);
    this.tmp.copy(this.player.pos).setY(this.player.pos.y + 2.4);
    this.labels.float(this.tmp, "LEVEL UP", "level");
    this.tmp.y = this.player.pos.y + 1;
    this.sparks.burst(this.tmp, 60);
    this.inventoryUI.render();
    void saveGame(this.save);
  }

  // ------------------------------------------------------------------- loot

  private dropLoot(m: Monster) {
    const { def } = m;
    if (Math.random() < def.goldChance) {
      const amount = Math.round((2 + Math.random() * 4) * m.level * (def.rarityBoost > 1 ? 3 : 1));
      this.loot.spawn({ kind: "gold", amount }, m.pos, this.nav);
    }
    if (Math.random() < def.dropChance) {
      const item = generateItem(m.level, def.rarityBoost);
      this.loot.spawn({ kind: "item", item }, m.pos, this.nav);
      if (item.rarity === "magic") this.audio.play("dropMagic");
      if (item.rarity === "rare") this.audio.play("dropRare");
      if (item.rarity === "legendary") this.audio.play("dropLegendary");
    }
  }

  private pickUp(drop: GroundDrop) {
    const c = drop.content;
    if (c.kind === "gold") {
      this.save.character.gold += c.amount;
      this.audio.play("gold");
    } else {
      if (!this.inventory.add(c.item)) {
        this.hud.banner("Inventory is full");
        return;
      }
      this.audio.play("pickup");
      this.tmp.copy(this.player.pos).setY(this.player.pos.y + 2.2);
      this.labels.float(this.tmp, itemName(c.item), "xp");
      if (c.item.rarity === "legendary") void saveGame(this.save);
    }
    this.loot.remove(drop);
  }

  /** Gold is picked up just by walking over it. */
  private collectGold() {
    for (let i = this.loot.drops.length - 1; i >= 0; i--) {
      const d = this.loot.drops[i];
      if (d.content.kind === "gold" && distXZ(this.player.pos, d.pos) <= GOLD_AUTO_RANGE) this.pickUp(d);
    }
  }

  // --------------------------------------------------------------- monsters

  private removeDeadMonsters() {
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (!m.removable) continue;
      this.scene.remove(m.root);
      m.dispose();
      this.bars.get(m)?.remove();
      this.bars.delete(m);
      this.monsters.splice(i, 1);
    }
  }

  /** Push overlapping monsters apart (and off the player) so they surround instead of stacking. */
  private separate() {
    const alive = this.monsters.filter((m) => m.alive);
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        this.pushApart(a.pos, b.pos, a.radius + b.radius, 0.5);
      }
      if (this.player.alive) this.pushApart(a.pos, this.player.pos, a.radius + this.player.radius, 1);
    }
  }

  /** Moves `a` (and `b` by the remaining share) apart until `minDist`, staying on the navmesh. */
  private pushApart(a: THREE.Vector3, b: THREE.Vector3, minDist: number, aShare: number) {
    let dx = a.x - b.x;
    let dz = a.z - b.z;
    let d = Math.hypot(dx, dz);
    if (d >= minDist) return;
    if (d < 1e-4) {
      dx = Math.random() - 0.5;
      dz = Math.random() - 0.5;
      d = Math.hypot(dx, dz);
    }
    const overlap = minDist - d;
    const nx = dx / d;
    const nz = dz / d;
    this.tmp.set(a.x + nx * overlap * aShare, a.y, a.z + nz * overlap * aShare);
    this.nav.moveAlong(a, this.tmp, a);
    if (aShare < 1) {
      const bShare = 1 - aShare;
      this.tmp.set(b.x - nx * overlap * bShare, b.y, b.z - nz * overlap * bShare);
      this.nav.moveAlong(b, this.tmp, b);
    }
  }

  private nearestMonster(maxDist: number): Monster | null {
    let best: Monster | null = null;
    let bestD = maxDist;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = distXZ(this.player.pos, m.pos);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- picking

  private pickMonster(): Monster | null {
    this.raycaster.setFromCamera(this.input.pointer, this.camera);
    const proxies = this.monsters.filter((m) => m.alive && m.root.visible).map((m) => m.proxy);
    const hit = this.raycaster.intersectObjects(proxies, false)[0];
    return (hit?.object.userData.monster as Monster | undefined) ?? null;
  }

  private pickGround(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.input.pointer, this.camera);
    return this.raycaster.intersectObject(this.ground)[0]?.point ?? null;
  }

  private showMarker(p: THREE.Vector3) {
    this.marker.position.set(p.x, p.y + 0.05, p.z);
    this.marker.visible = true;
    this.markerAge = 0;
  }

  private updateMarker(dt: number) {
    if (!this.marker.visible) return;
    this.markerAge += dt;
    const t = this.markerAge / 0.5;
    if (t >= 1) {
      this.marker.visible = false;
      return;
    }
    this.marker.scale.setScalar(1.2 - 0.7 * t);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  }
}

function createClickMarker() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xd8c9a8, transparent: true, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  return ring;
}
