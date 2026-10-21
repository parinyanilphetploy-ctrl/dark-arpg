# Dark ARPG

3D isometric action RPG (Diablo-style) that runs in the browser on PC and mobile.
Stack: TypeScript + Vite + Three.js. Static site, no backend.

## Commands
- `npm run dev`: dev server, exposed on the LAN (open the printed Network URL on a phone)
- `npm run build`: type-check + production build into `dist/` (includes the PWA service worker)
- `npm run preview`: serve `dist/` on port 4173 — the only way to test the service worker / offline
- `npm run typecheck`
- `node scripts/make-icons.mjs`: regenerate the app icons in `public/icons/`

## Layout
- `src/core/`: engine-level pieces (fixed-timestep `Loop`, `Renderer`, unified `Input`, cached `Assets`)
- `src/game/`: gameplay. `Game` builds the level, wires input, spawns waves and resolves combat;
  `Player` / `Monster` = model, animation state machine, movement, health (monster AI:
  idle → chase → attack, stagger, death); `Navigation` = Recast navmesh (pathfinding + keeping
  direct movement on walkable ground); `models.ts` (character instancing, hit flash, blob shadow),
  `Animator.ts`, `movement.ts`, `combat.ts`, `fx.ts` (sparks, camera shake).
  Open the game with `?nav` to draw the navmesh. In dev, `window.game` is the live Game.
- `src/game/dungeon/`: `Generator.ts` (seeded rooms + corridors grid, start / exit rooms),
  `DungeonLevel.ts` (floor = one merged mesh that is also the navmesh source, walls / pillars /
  torch flames instanced, pooled torch lights, exit portal), `textures.ts` (canvas-painted
  textures, no image files). Save keeps `progress.{floor, seed}` so a reload rebuilds the same floor.
- `src/core/Audio.ts`: all SFX + ambient synthesized with WebAudio (no audio files); starts on
  the first pointer / key press (mobile autoplay rules).
- `src/data/classes.json`: the 4 playable classes (model path, clip names, attack kind / range /
  timing, base life, damage and speed). Missing model file → tinted placeholder robot.
  `game/Projectiles.ts` handles ranged attacks (archer pierce, mage explosion).
  Making the real models: `docs/character-pipeline.md`. `?newgame` opens class select.
- `src/data/monsters.json`: monster stats; balance here, not in code.
- Loot: `items.json` (bases), `affixes.json` (random stats, scaled by item level),
  `game/items.ts` (rarity roll, generation, naming), `game/stats.ts` (final stats from level +
  equipment, armor → damage reduction, XP curve), `game/Inventory.ts` (bag + equipment in the save),
  `game/Loot.ts` (ground drops + clickable labels), `ui/InventoryUI.ts` (panel, compare, equip).
  Every item type must have at least 4 eligible affixes (legendaries roll 4).
  Monster level = wave; it scales monster HP/damage/XP and is the item level of its drops.
- `src/ui/`: `Hud` (HP, XP, potions, banner), `WorldLabels` (damage numbers, monster HP bars as DOM)
- `src/ui/TouchControls.ts`: floating joystick (left zone) + attack/skill buttons, shown on touch devices
- `src/data/`: static game data as JSON (items, later monsters/skills/loot), typed in `data/index.ts`
- `src/save/`: player save in IndexedDB (`idb-keyval`), versioned schema + migrations, rolling backup, autosave
- `src/settings.ts`: per-device settings in localStorage + quality presets
- `src/ui/`: HTML/CSS overlay UI

## Art direction
Reference sheets: `character sheet/` (Warrior with greatsword, Dual Blade, Mage, Archer).
Gothic dark fantasy: near-black base, blood red cloth and red magic glow, worn dark steel with
silver edges, ember-orange fire light. Use these colours for UI, VFX and lighting. The robot
model is a placeholder until 3D characters are made from these sheets.

## Mobile / PWA
- `game/models.ts` bakes untextured multi-part models into one SkinnedMesh with vertex colours
  (robot: 19 draw calls → 1). Textured models are left as they are, so ship them as one mesh.
- `core/Renderer.ts` `DynamicResolution` lowers the pixel ratio when frames are slow and backs off
  if that doesn't help (frame-rate-capped devices such as iOS Low Power Mode).
- The loop and audio stop while the page is hidden.
- PWA via `vite-plugin-pwa` (config in `vite.config.ts`): precaches the whole game for offline
  play, auto-updates on the next launch. Only active in production builds.
- The debug overlay and FPS meter show in dev, or in a build opened with `?debug`.

## Rules
- Gameplay logic runs in `update(dt)` at a fixed 60 Hz; `render()` only interpolates and draws.
- Mobile first on performance: < 100 draw calls on `low`, use `InstancedMesh` for repeated props,
  no realtime shadows or post-processing on `low`, pool frequently spawned objects.
- Saves store IDs + rolled values only, never copies of static data. Changing `SaveFile`
  means bumping `SAVE_VERSION` and adding a migration.
- `loadGame` throws `UnreadableSaveError` when saves exist but can't be read; never treat that
  as "no save" (starting a new game would overwrite the player's progress).
- Models go in `public/models/` as GLB, compressed with gltf-transform (meshopt + KTX2).
  Record the source and license of every asset in `public/models/CREDITS.md`.
- Anything that blocks movement must be passed to `Navigation.build` as well as rendered.
- Walls whose floor neighbour is "north" (towards the back of the screen) are built low, so
  they never hide the player from the fixed isometric camera.
- Monsters beyond `CULL_DISTANCE` from the camera are hidden and not animated; keep that when
  adding enemy types. Point-light count must stay constant per floor (changing it recompiles shaders).
- `saveSettings` takes only the changed fields; never save the whole settings object.
- Controls: PC = left click/hold to move, click a monster to attack-move, WASD, Space or right
  click to attack (aims at cursor), Q = potion, I = inventory (game pauses while open).
  Click a drop's label to pick it up; gold is collected by walking over it. Mobile = joystick or tap to move, tap a monster to
  attack it, on-screen buttons (attack auto-targets the nearest monster).
- Hits land partway through the attack animation (`ATTACK_HIT_AT`), not on button press.
- Measure model bounds on the loaded scene, never on a SkeletonUtils clone (bones not computed yet).
