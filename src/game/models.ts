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
  const template = mergedTemplate(gltf.scene, gltf.animations);
  if (template) {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: tint ?? 0xffffff,
      roughness: template.roughness,
      metalness: template.metalness,
    });
    const mesh = attachMerged(model, template, material);
    mesh.castShadow = opts.shadows;
    const root = new THREE.Group();
    root.add(model);
    return { root, animations: template.animations, flash: new HitFlash([material]) };
  }

  // Textured multi-material model: keep its meshes, just give this instance its own materials
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

// ------------------------------------------------------------------------------------
// Mesh merging: one draw call per character
// ------------------------------------------------------------------------------------

/** One skinned geometry + bind data built once per source model, shared by all instances. */
interface MergedTemplate {
  geometry: THREE.BufferGeometry;
  boneNames: string[];
  boneInverses: THREE.Matrix4[];
  roughness: number;
  metalness: number;
  /** Clips without tracks for the meshes that were merged away (e.g. face morphs). */
  animations: THREE.AnimationClip[];
}

const templateCache = new WeakMap<THREE.Object3D, MergedTemplate | null>();

/**
 * Models made of many parts (the placeholder robot is 19 meshes / 3 materials, so
 * 19 draw calls) are baked into a single SkinnedMesh: rigid parts are skinned 100%
 * to their parent bone, and each part's flat material colour becomes a vertex colour.
 * Returns null for textured models, which can't share one plain material.
 */
function mergedTemplate(source: THREE.Object3D, clips: THREE.AnimationClip[]): MergedTemplate | null {
  if (templateCache.has(source)) return templateCache.get(source)!;
  const template = buildTemplate(source, clips);
  templateCache.set(source, template);
  return template;
}

function buildTemplate(source: THREE.Object3D, clips: THREE.AnimationClip[]): MergedTemplate | null {
  const work = clone(source);
  work.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const bones: THREE.Bone[] = [];
  work.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const materialsOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
  const textured = meshes.some((m) => materialsOf(m).some((mat) => mat.map));
  const uniqueNames = new Set(bones.map((b) => b.name)).size === bones.length;
  if (!meshes.length || !bones.length || textured || !uniqueNames || meshes.some((m) => materialsOf(m).length > 1)) {
    return null;
  }

  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const skinIdx: number[] = [];
  const skinWt: number[] = [];
  const index: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const p = geo.getAttribute("position");
    const normals = geo.getAttribute("normal");
    const color = materialsOf(mesh)[0].color;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);

    // Rigid part: follow the nearest bone above it in the hierarchy
    let rigidBone = 0;
    if (!skinned) {
      let o: THREE.Object3D | null = mesh.parent;
      while (o && !(o as THREE.Bone).isBone) o = o.parent;
      if (o) rigidBone = boneIndex.get(o as THREE.Bone) ?? 0;
    }
    const si = skinned ? geo.getAttribute("skinIndex") : null;
    const sw = skinned ? geo.getAttribute("skinWeight") : null;

    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (skinned) skinned.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (normals) n.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      else n.set(0, 1, 0);
      nrm.push(n.x, n.y, n.z);
      col.push(color.r, color.g, color.b);
      if (skinned && si && sw) {
        for (let k = 0; k < 4; k++) {
          const bone = skinned.skeleton.bones[si.getComponent(i, k)];
          skinIdx.push(boneIndex.get(bone) ?? 0);
          skinWt.push(sw.getComponent(i, k));
        }
      } else {
        skinIdx.push(rigidBone, 0, 0, 0);
        skinWt.push(1, 0, 0, 0);
      }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) index.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) index.push(base + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIdx, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWt, 4));
  geometry.setIndex(index);

  const first = materialsOf(meshes[0])[0];
  const boneNames = new Set(bones.map((b) => b.name));
  return {
    geometry,
    boneNames: bones.map((b) => b.name),
    // Bind pose = the work clone's current pose, with the model root at the origin
    boneInverses: bones.map((b) => b.matrixWorld.clone().invert()),
    roughness: first.roughness ?? 0.6,
    metalness: first.metalness ?? 0,
    animations: clips.map(
      (clip) =>
        new THREE.AnimationClip(
          clip.name,
          clip.duration,
          clip.tracks.filter((t) => boneNames.has(t.name.split(".")[0])),
        ),
    ),
  };
}

/** Replace `model`'s meshes with one SkinnedMesh of `template`, bound to `model`'s own bones. */
function attachMerged(model: THREE.Object3D, template: MergedTemplate, material: THREE.Material): THREE.SkinnedMesh {
  const remove: THREE.Object3D[] = [];
  const byName = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) remove.push(o);
    if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
  });
  for (const o of remove) o.removeFromParent();

  const bones = template.boneNames.map((name) => byName.get(name)!);
  const skeleton = new THREE.Skeleton(bones, template.boneInverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(template.geometry, material);
  // Skinned meshes animate outside their bind-pose bounds
  mesh.frustumCulled = false;
  model.add(mesh);
  // Geometry is in the model's own (unscaled) space, so the bind matrix is identity
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
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
