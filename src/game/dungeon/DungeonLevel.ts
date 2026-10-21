import * as THREE from "three";
import type { QualityProfile } from "../../settings";
import { CELL, cellToWorld, isFloor, roomCenter, type DungeonLayout, type Room } from "./Generator";
import { mulberry32 } from "./rng";
import { brickWallTexture, glowTexture, stoneFloorTexture } from "./textures";

const WALL_HEIGHT = 3.2;
/** Walls between the camera and the floor are drawn short so they never hide the player. */
const LOW_WALL_HEIGHT = 0.5;
const TORCH_HEIGHT = 2.2;
const PILLAR_SIZE = new THREE.Vector3(1.2, WALL_HEIGHT, 1.2);
/** How often the pooled torch lights are re-assigned to the nearest torches (s). */
const LIGHT_REASSIGN = 0.25;

/**
 * Three.js scene objects for one dungeon floor, built from a layout.
 * Draw-call budget: floor 1, walls 2, pillars 1, torch flames 1, glows 1, portal ~3.
 */
export class DungeonLevel {
  readonly group = new THREE.Group();
  /** Meshes the navmesh is built from (floor + pillars). */
  readonly navSources: THREE.Mesh[] = [];
  readonly startPos: THREE.Vector3;
  readonly exitPos: THREE.Vector3;

  private torches: THREE.Vector3[] = [];
  private lights: THREE.PointLight[] = [];
  private lightTimer = 0;
  private time = 0;
  private portal = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(
    readonly layout: DungeonLayout,
    quality: QualityProfile,
    seed: number,
  ) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    this.buildFloor(rng);
    this.buildWalls(quality);
    this.buildPillars(quality);
    this.buildTorches(quality);

    const s = roomCenter(layout.start);
    const sw = cellToWorld(layout, s.x, s.y);
    this.startPos = new THREE.Vector3(sw.x, 0, sw.z);
    const e = roomCenter(layout.exit);
    const ew = cellToWorld(layout, e.x, e.y);
    this.exitPos = new THREE.Vector3(ew.x, 0, ew.z);
    this.buildPortal(quality);
  }

  /** One merged mesh for all floor cells: renders in one draw call and doubles as navmesh input. */
  private buildFloor(rng: () => number) {
    const { layout } = this;
    const pos: number[] = [];
    const uv: number[] = [];
    const color: number[] = [];
    const index: number[] = [];
    const h = CELL / 2;
    for (let y = 0; y < layout.h; y++) {
      for (let x = 0; x < layout.w; x++) {
        if (!isFloor(layout, x, y)) continue;
        const c = cellToWorld(layout, x, y);
        const base = pos.length / 3;
        pos.push(c.x - h, 0, c.z - h, c.x + h, 0, c.z - h, c.x + h, 0, c.z + h, c.x - h, 0, c.z + h);
        // Random 90° rotation per tile hides the repeat
        const rot = Math.floor(rng() * 4);
        const quad = [0, 0, 1, 0, 1, 1, 0, 1];
        for (let k = 0; k < 4; k++) uv.push(quad[((k + rot) % 4) * 2], quad[((k + rot) % 4) * 2 + 1]);
        const shade = 0.75 + rng() * 0.3;
        for (let k = 0; k < 4; k++) color.push(shade, shade * 0.97, shade * 0.93);
        index.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: stoneFloorTexture(), vertexColors: true, roughness: 0.92 });
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.navSources.push(floor);
    this.disposables.push(geo, mat);
  }

  /** A wall block on every solid cell that touches floor (including diagonally). */
  private buildWalls(quality: QualityProfile) {
    const { layout } = this;
    const tall: THREE.Vector2[] = [];
    const low: THREE.Vector2[] = [];
    for (let y = 0; y < layout.h; y++) {
      for (let x = 0; x < layout.w; x++) {
        if (isFloor(layout, x, y)) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++)
          for (let dx = -1; dx <= 1 && !touches; dx++) touches = isFloor(layout, x + dx, y + dy);
        if (!touches) continue;
        // Floor directly "north" (towards the back of the screen) = this wall faces the camera
        (isFloor(layout, x, y - 1) ? low : tall).push(new THREE.Vector2(x, y));
      }
    }

    const tex = brickWallTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    this.disposables.push(mat);
    const make = (cells: THREE.Vector2[], height: number) => {
      const geo = new THREE.BoxGeometry(CELL, height, CELL);
      // Scale UVs on the sides so bricks keep their size on tall and short walls
      const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, uvAttr.getY(i) * (height / CELL));
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      const m = new THREE.Matrix4();
      cells.forEach((c, i) => {
        const w = cellToWorld(layout, c.x, c.y);
        mesh.setMatrixAt(i, m.makeTranslation(w.x, height / 2, w.z));
      });
      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo);
    };
    make(tall, WALL_HEIGHT);
    make(low, LOW_WALL_HEIGHT);
  }

  /** Four pillars in big rooms (not the start room): cover to fight around. */
  private buildPillars(quality: QualityProfile) {
    const { layout } = this;
    const spots: { x: number; z: number }[] = [];
    for (const r of layout.rooms) {
      if (r === layout.start || r.w < 7 || r.h < 7) continue;
      for (const [px, py] of [
        [r.x + 2, r.y + 2],
        [r.x + r.w - 3, r.y + 2],
        [r.x + 2, r.y + r.h - 3],
        [r.x + r.w - 3, r.y + r.h - 3],
      ]) {
        spots.push(cellToWorld(layout, px, py));
      }
    }
    if (!spots.length) return;
    const geo = new THREE.BoxGeometry(PILLAR_SIZE.x, PILLAR_SIZE.y, PILLAR_SIZE.z);
    const mat = new THREE.MeshStandardMaterial({ map: brickWallTexture(), roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(s.x, PILLAR_SIZE.y / 2, s.z));
      const src = new THREE.Mesh(geo);
      src.position.set(s.x, PILLAR_SIZE.y / 2, s.z);
      this.navSources.push(src);
    });
    mesh.castShadow = quality.shadows;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  /**
   * Torches on the back (north) wall of every room. All flames are one
   * InstancedMesh and all glows one Points object; only a small pool of real
   * PointLights (size from quality) follows the torches nearest the player.
   */
  private buildTorches(quality: QualityProfile) {
    const { layout } = this;
    for (const r of layout.rooms) this.torchesForRoom(r);
    if (!this.torches.length) return;

    const flameGeo = new THREE.ConeGeometry(0.12, 0.35, 6);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const flames = new THREE.InstancedMesh(flameGeo, flameMat, this.torches.length);
    const m = new THREE.Matrix4();
    this.torches.forEach((t, i) => flames.setMatrixAt(i, m.makeTranslation(t.x, t.y, t.z)));
    this.group.add(flames);

    const glowGeo = new THREE.BufferGeometry().setFromPoints(this.torches);
    const glowMat = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xff8a30,
      size: 2.2,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.group.add(new THREE.Points(glowGeo, glowMat));
    this.disposables.push(flameGeo, flameMat, glowGeo, glowMat);

    for (let i = 0; i < quality.torchLights; i++) {
      const light = new THREE.PointLight(0xff8a3c, 0, 9, 2);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  private torchesForRoom(r: Room) {
    const { layout } = this;
    const wallY = r.y - 1;
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) {
      // Skip corridor openings in the wall
      if (isFloor(layout, x, wallY)) continue;
      const w = cellToWorld(layout, x, r.y);
      this.torches.push(new THREE.Vector3(w.x, TORCH_HEIGHT, w.z - CELL / 2 + 0.2));
    }
  }

  private buildPortal(quality: QualityProfile) {
    // Blood-red rune circle, matching the red magic in the character sheets
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xff3040 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 32),
      new THREE.MeshBasicMaterial({
        color: 0xa0101e,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.04;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.85, 4, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xd0202e,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 2;
    this.portal.add(ring, disc, beam);
    if (quality.torchLights > 0) {
      const light = new THREE.PointLight(0xff2a3a, 12, 8, 2);
      light.position.y = 1.5;
      this.portal.add(light);
    }
    this.portal.position.copy(this.exitPos);
    this.group.add(this.portal);
    for (const o of [ring, disc, beam]) this.disposables.push(o.geometry, o.material as THREE.Material);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.time += dt;

    this.lightTimer -= dt;
    if (this.lights.length && this.lightTimer <= 0) {
      this.lightTimer = LIGHT_REASSIGN;
      const nearest = [...this.torches]
        .sort((a, b) => a.distanceToSquared(playerPos) - b.distanceToSquared(playerPos))
        .slice(0, this.lights.length);
      this.lights.forEach((l, i) => {
        const t = nearest[i];
        if (t) l.position.set(t.x, t.y + 0.2, t.z + 0.4);
        l.visible = !!t;
      });
    }
    // Flicker: two incommensurate sines per light look organic enough
    this.lights.forEach((l, i) => {
      const f = Math.sin(this.time * 9.1 + i * 2.3) * 0.5 + Math.sin(this.time * 23.7 + i) * 0.5;
      l.intensity = 14 + f * 3;
    });

    const pulse = 1 + Math.sin(this.time * 3) * 0.06;
    this.portal.scale.set(pulse, 1, pulse);
    this.portal.rotation.y += dt * 0.6;
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
