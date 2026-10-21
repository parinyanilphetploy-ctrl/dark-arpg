import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadModel } from "../core/Assets";

export interface CharacterModel {
  /** Feet at y = 0, facing +z. Position / rotate this. */
  root: THREE.Group;
  animations: THREE.AnimationClip[];
  flash: HitFlash;
}

/**
 * A new animated instance of a character model, scaled to `height` metres.
 * Each instance gets its own materials so tints and hit flashes stay local.
 */
export async function instantiateCharacter(
  url: string,
  height: number,
  opts: { shadows: boolean; tint?: THREE.ColorRepresentation },
): Promise<CharacterModel> {
  const gltf = await loadModel(url);
  const model = clone(gltf.scene);

  const box = bindPoseBounds(gltf.scene);
  const scale = height / (box.max.y - box.min.y);
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;

  const tint = opts.tint !== undefined ? new THREE.Color(opts.tint) : null;
  const materials: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = opts.shadows;
    // Skinned meshes animate outside their bind-pose bounds
    mesh.frustumCulled = false;
    const own = (m: THREE.Material) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      if (tint) c.color.multiply(tint);
      materials.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });

  const root = new THREE.Group();
  root.add(model);
  return { root, animations: gltf.animations, flash: new HitFlash(materials) };
}

const boundsCache = new WeakMap<THREE.Object3D, THREE.Box3>();

/**
 * Bounds measured on the loaded (never-cloned) scene. A fresh SkeletonUtils
 * clone has no computed bone matrices yet, so measuring it gives garbage.
 */
function bindPoseBounds(source: THREE.Object3D): THREE.Box3 {
  let box = boundsCache.get(source);
  if (!box) {
    box = new THREE.Box3().setFromObject(source);
    boundsCache.set(source, box);
  }
  return box;
}

/** Brief white glow on a character's materials when it takes a hit. */
export class HitFlash {
  private t = 0;

  constructor(readonly materials: THREE.MeshStandardMaterial[]) {}

  trigger(strength = 1) {
    this.t = strength;
  }

  update(dt: number) {
    if (this.t <= 0) return;
    this.t = Math.max(0, this.t - dt * 6);
    for (const m of this.materials) m.emissive.setScalar(this.t * 0.8);
  }

  dispose() {
    for (const m of this.materials) m.dispose();
  }
}

let blobTexture: THREE.Texture | null = null;

/** Cheap fake shadow for devices without shadow maps. */
export function createBlobShadow(size: number): THREE.Mesh {
  if (!blobTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(c);
  }
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  return blob;
}
