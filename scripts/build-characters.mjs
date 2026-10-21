// Turn the KayKit Adventurers character GLBs into the game's class models:
// keep only the class weapon / parts and the 4 clips the game plays (renamed to
// idle / run / attack / death), regrade the colour atlas towards the game's gothic
// palette (cloth → blood red, darker overall), then meshopt-compress.
//
//   node scripts/build-characters.mjs <folder with Knight.glb, Rogue.glb, Mage.glb, Rogue_Hooded.glb>
//
// Source: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (CC0)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const CLASSES = {
  warrior: {
    source: "Knight.glb",
    keep: ["2H_Sword", "Knight_Cape"],
    clips: { idle: "2H_Melee_Idle", run: "Running_A", attack: "2H_Melee_Attack_Slice", death: "Death_A" },
  },
  dualblade: {
    source: "Rogue.glb",
    keep: ["Knife", "Knife_Offhand", "Rogue_Cape"],
    clips: { idle: "Idle", run: "Running_A", attack: "Dualwield_Melee_Attack_Slice", death: "Death_A" },
  },
  mage: {
    source: "Mage.glb",
    keep: ["2H_Staff", "Mage_Cape"],
    clips: { idle: "Idle", run: "Running_A", attack: "Spellcast_Shoot", death: "Death_A" },
  },
  archer: {
    source: "Rogue_Hooded.glb",
    keep: ["2H_Crossbow", "Rogue_Cape"],
    clips: { idle: "Idle", run: "Running_A", attack: "2H_Ranged_Shoot", death: "Death_A" },
  },
};

/** KayKit heads are chibi-sized; shrink them towards adult proportions. */
const HEAD_SCALE = 0.62;
const LEG_SCALE = 1.7;
const ARM_SCALE = 1.25;

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: node scripts/build-characters.mjs <kaykit gltf folder>");
  process.exit(1);
}
const outDir = "public/models/characters";
mkdirSync(outDir, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

for (const [id, cfg] of Object.entries(CLASSES)) {
  const doc = await io.read(join(srcDir, cfg.source));
  const root = doc.getRoot();

  // Rigid props (weapons, shields, hats) are unskinned mesh nodes; drop the ones this class doesn't use
  for (const node of root.listNodes()) {
    if (node.getMesh() && !node.getSkin() && !cfg.keep.includes(node.getName())) node.dispose();
  }

  const wanted = new Map(Object.entries(cfg.clips).map(([state, clip]) => [clip, state]));
  for (const anim of root.listAnimations()) {
    const state = wanted.get(anim.getName());
    if (state) {
      anim.setName(state);
      continue;
    }
    // Disposing the animation alone leaves its samplers holding their accessors.
    // Inputs are shared between clips, so let prune() drop the orphaned ones.
    for (const c of anim.listChannels()) c.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
  }
  const missing = [...wanted.keys()].filter((c) => !root.listAnimations().some((a) => a.getName() === wanted.get(c)));
  if (missing.length) throw new Error(`${cfg.source}: missing clips ${missing.join(", ")}`);

  scaleBone(root, "head", [HEAD_SCALE, HEAD_SCALE, HEAD_SCALE]);
  // Longer legs: stretch both thighs along the bone (shins inherit it) and lift the hips to match
  const legLength = ["lowerleg.l", "foot.l"].reduce((s, n) => s + boneNode(root, n).getTranslation()[1], 0);
  scaleBone(root, "upperleg.l", [1, LEG_SCALE, 1]);
  scaleBone(root, "upperleg.r", [1, LEG_SCALE, 1]);
  liftBone(root, "hips", legLength * (LEG_SCALE - 1));
  scaleBone(root, "upperarm.l", [1, ARM_SCALE, 1]);
  scaleBone(root, "upperarm.r", [1, ARM_SCALE, 1]);

  for (const tex of root.listTextures()) {
    if (tex.getMimeType() === "image/png") tex.setImage(gothicGrade(tex.getImage()));
  }

  await doc.transform(prune(), dedup(), resample(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const out = join(outDir, `${id}.glb`);
  await io.write(out, doc);
  console.log(`${out}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

/**
 * Scale a bone (and everything skinned to it) in the rest pose and in every clip.
 * The clips key scale on every bone, so the rest pose alone would be overwritten.
 */
function scaleBone(root, name, factor) {
  editBone(root, name, "scale", (v, axis) => v * factor[axis]);
}

/** Raise a bone by `dy` in the rest pose and in every clip. */
function liftBone(root, name, dy) {
  editBone(root, name, "translation", (v, axis) => (axis === 1 ? v + dy : v));
}

function boneNode(root, name) {
  const bone = root.listNodes().find((n) => n.getName() === name);
  if (!bone) throw new Error(`bone ${name} not found`);
  return bone;
}

/** Apply `f(value, axis)` to a bone's vec3 `path` in the rest pose and every clip keyframe. */
function editBone(root, name, path, f) {
  const bone = boneNode(root, name);
  const rest = path === "scale" ? bone.getScale() : bone.getTranslation();
  const edited = rest.map((v, axis) => f(v, axis));
  if (path === "scale") bone.setScale(edited);
  else bone.setTranslation(edited);
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetNode() !== bone || ch.getTargetPath() !== path) continue;
      const sampler = ch.getSampler();
      // Outputs can be shared between channels, so edit a copy
      const out = sampler.getOutput().clone();
      out.setArray(out.getArray().map((v, i) => f(v, i % 3)));
      sampler.setOutput(out);
    }
  }
}

/**
 * KayKit atlases are flat colour swatches. Skin / hair tones stay, greys and metals
 * get darker, every other (cloth) colour becomes blood red at a lower lightness.
 */
function gothicGrade(bytes) {
  const png = PNG.sync.read(Buffer.from(bytes));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    let [h, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    if (h >= 5 && h <= 50) {
      l *= 0.92; // skin, hair, leather, gold (light tones have high HSL saturation, so hue only)
    } else if (s < 0.18) {
      l *= 0.78; // steel, cloth greys, white trims
    } else {
      h = 352;
      s = Math.min(1, s * 0.9);
      l *= 0.62;
    }
    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r * 255;
    d[i + 1] = g * 255;
    d[i + 2] = b * 255;
  }
  return new Uint8Array(PNG.sync.write(png));
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
