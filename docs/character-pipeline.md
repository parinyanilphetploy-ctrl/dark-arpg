# Character pipeline: concept sheet → playable 3D character

How to turn the sheets in `character sheet/` into GLB models the game loads.
The code side is done: drop a file at the path in `src/data/classes.json` and that
class uses it. The files there now are recoloured KayKit stand-ins built by
`scripts/build-characters.mjs`; replacing one only means overwriting its GLB (and its
`clips` names). A missing file falls back to the tinted placeholder robot.

## Targets (mobile first)

| | Budget |
|---|---|
| Triangles | 8k–15k per character (hero), 3k–6k per monster |
| Meshes / materials | **1 mesh, 1 material** (every extra mesh or material = another draw call) |
| Textures | one 1024² base colour (2048² max for the hero), WebP |
| Skeleton | Mixamo standard (≈65 bones), max 4 weights per vertex |
| Final GLB | under 3–4 MB per character |
| Height / facing | feet at origin, facing +Z (glTF export from Blender handles this) |

## 1. Prepare the reference
- Crop the **FRONT** view from the sheet into its own image (full body, T- or A-pose
  if possible, plain background). Crop **SIDE** and **BACK** too if the tool accepts
  multiple views.
- Loose capes and long hair/coat tails are the hardest parts to rig: expect to
  shorten or simplify them.

## 2. Image → 3D model (AI generation)
Use an image-to-3D tool, e.g. **Meshy**, **Tripo**, or **Rodin (Hyper3D)**.
- Upload the front view (+ side / back for multi-view mode).
- Ask for a **low-poly / game-ready** result with PBR textures, around 10k triangles.
- Generate a few variants and keep the one whose silhouette is closest to the sheet.
- Check each tool's licence / plan terms for commercial use before shipping.

Alternative for higher quality: commission a 3D artist with the sheets (the sheets
already have front / side / back views, which is what they need).

## 3. Clean up in Blender (free)
1. Import the generated model (GLB / FBX).
2. Join everything into **one mesh** (`Ctrl+J`) and give it **one material**.
3. Decimate if over budget (Modifier → Decimate, ratio until ~10k tris).
4. Put the feet at the origin, scale to real size (warrior ≈ 1.85 m), apply all
   transforms (`Ctrl+A` → All Transforms).
5. Export **FBX** for Mixamo.

## 4. Rig + animations with Mixamo (free, needs an Adobe account)
1. Upload the FBX at mixamo.com; place the chin / wrists / elbows / knees / groin markers.
2. Download these animations ("Without Skin" except the first one, which should be
   "With Skin"), **30 fps**, and tick **In Place** for movement clips:

| State | Warrior | Dual Blade | Mage | Archer |
|---|---|---|---|---|
| idle | Great Sword Idle | Sword And Shield Idle | Standing Idle | Standing Idle |
| run | Great Sword Run | Running | Running | Running |
| attack | Great Sword Slash | Sword And Shield Slash | Standing 1H Magic Attack | Standing Draw Arrow |
| death | Dying | Dying | Dying | Dying |

(Names are search terms on Mixamo; any similar clip works.)

## 5. Combine into one GLB (Blender)
1. Import the skinned FBX, then import each animation FBX and copy its action onto the
   skinned armature (Dope Sheet → Action Editor).
2. Rename the actions to short names, e.g. `idle`, `run`, `attack`, `death`.
3. Push each action down to its own NLA track.
4. File → Export → glTF 2.0 (`.glb`), with Animations on, "Export all actions" mode.

## 6. Compress
```bash
npx @gltf-transform/cli optimize warrior.glb warrior.opt.glb --compress meshopt --texture-compress webp --texture-size 1024
```
Meshopt decoding is already set up in `src/core/Assets.ts`.

## 7. Plug into the game
1. Save as `public/models/characters/<class>.glb` (`warrior`, `dualblade`, `mage`, `archer`).
2. In `src/data/classes.json`, set that class's `clips` to the action names from step 5:
   ```json
   "clips": { "idle": "idle", "run": "run", "attack": "attack", "death": "death" }
   ```
3. Tune `attack.hitAt` (fraction of the attack clip where the blade connects / the
   arrow leaves the bow) and `attack.animSpeed` so the hit lines up with the motion.
4. Start a new character with `http://localhost:5173/?newgame`, pick the class,
   and check: size, facing, all four animations, the draw-call number in the debug
   overlay (one character should add only ~1–2).

## Monsters
Same steps; monster models live in `public/models/` and are referenced from
`src/game/Monster.ts` (`MODEL_URL`, one per monster type is the next code change).
