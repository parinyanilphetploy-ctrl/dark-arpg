import * as THREE from "three";
import { getNavMeshPositionsAndIndices, init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";

let ready: Promise<void> | null = null;

/**
 * Recast navmesh built from the level's walkable + blocking geometry.
 * Used for click-to-move pathfinding and to keep direct (WASD / joystick)
 * movement on walkable ground. Monsters will use the same query in Phase 2.
 */
export class Navigation {
  private constructor(
    private navMesh: NavMesh,
    private query: NavMeshQuery,
  ) {}

  /** `meshes` = everything that is either floor or an obstacle. World transforms are baked in. */
  static async build(meshes: THREE.Mesh[], agentRadius = 0.4): Promise<Navigation> {
    // Load the WASM module once, however many floors get built
    ready ??= init();
    await ready;

    const positions: number[] = [];
    const indices: number[] = [];
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry.index ? mesh.geometry : mesh.geometry.toNonIndexed();
      const pos = geo.getAttribute("position");
      const base = positions.length / 3;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        positions.push(v.x, v.y, v.z);
      }
      if (geo.index) {
        for (let i = 0; i < geo.index.count; i++) indices.push(base + geo.index.getX(i));
      } else {
        for (let i = 0; i < pos.count; i++) indices.push(base + i);
      }
    }

    const cs = 0.2;
    const ch = 0.2;
    const result = generateSoloNavMesh(positions, indices, {
      cs,
      ch,
      walkableSlopeAngle: 45,
      walkableHeight: Math.ceil(1.8 / ch),
      walkableClimb: Math.floor(0.4 / ch),
      walkableRadius: Math.ceil(agentRadius / cs),
      maxEdgeLen: 12,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
    });
    if (!result.success) throw new Error(`Navmesh build failed: ${result.error}`);

    return new Navigation(result.navMesh, new NavMeshQuery(result.navMesh));
  }

  /** Straight-line waypoints from `from` to the nearest reachable point to `to`. */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const { success, path } = this.query.computePath(from, to);
    if (!success) return [];
    return path.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  }

  /** Nearest point on the navmesh, or null if nothing walkable is nearby. */
  closestPoint(p: THREE.Vector3): THREE.Vector3 | null {
    const r = this.query.findClosestPoint(p);
    return r.success ? new THREE.Vector3(r.point.x, r.point.y, r.point.z) : null;
  }

  /** How far a straight line from `from` towards `to` gets before leaving walkable ground (≤ full length). */
  clearDistance(from: THREE.Vector3, to: THREE.Vector3): number {
    const full = Math.hypot(to.x - from.x, to.z - from.z);
    const start = this.query.findClosestPoint(from);
    if (!start.success) return 0;
    const r = this.query.raycast(start.polyRef, start.point, to);
    // t > 1 (FLT_MAX) means nothing was hit
    return r.success ? full * Math.min(1, r.t) : full;
  }

  randomPoint(): THREE.Vector3 | null {
    const r = this.query.findRandomPoint();
    return r.success ? new THREE.Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z) : null;
  }

  /**
   * Move from `from` towards `to` but slide along walls instead of passing
   * through them. Writes the result into `out`.
   */
  moveAlong(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const start = this.query.findClosestPoint(from);
    if (!start.success) return out.copy(from);
    const r = this.query.moveAlongSurface(start.polyRef, start.point, to);
    if (!r.success) return out.copy(from);
    return out.set(r.resultPosition.x, r.resultPosition.y, r.resultPosition.z);
  }

  /** Free the WASM-side memory; the object is unusable afterwards. */
  dispose() {
    this.query.destroy();
    this.navMesh.destroy();
  }

  /** Debug visual of the walkable area. */
  createDebugMesh(): THREE.Mesh {
    const [positions, indices] = getNavMeshPositionsAndIndices(this.navMesh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x2f8fff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    mesh.position.y = 0.03;
    return mesh;
  }
}
