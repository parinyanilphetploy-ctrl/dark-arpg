import Stats from "three/addons/libs/stats.module.js";
import { registerSW } from "virtual:pwa-register";
import { AudioEngine } from "./core/Audio";
import { Input } from "./core/Input";
import { Loop } from "./core/Loop";
import { bindResize, createRenderer, DynamicResolution } from "./core/Renderer";
import { Game } from "./game/Game";
import { newSave } from "./save/schema";
import { loadGame, requestPersistentStorage, saveGame, startAutosave, UnreadableSaveError } from "./save/storage";
import { QUALITY, isTouchDevice, loadSettings, saveSettings } from "./settings";
import { chooseClass } from "./ui/ClassSelect";
import { createTouchControls } from "./ui/TouchControls";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const debug = document.getElementById("debug")!;
  const settings = loadSettings();
  const quality = QUALITY[settings.quality];

  void requestPersistentStorage();
  // ?newgame starts a fresh character (replaces the current save)
  const forceNew = new URLSearchParams(location.search).has("newgame");
  let save = forceNew ? null : await loadGame();
  if (!save) {
    document.getElementById("loading")!.classList.add("hidden");
    save = newSave(await chooseClass());
    await saveGame(save);
    if (forceNew) history.replaceState(null, "", location.pathname);
  }
  const current = save;
  startAutosave(() => current);

  const audio = new AudioEngine(settings.masterVolume, settings.muted);
  audio.onMuteChange = (muted) => saveSettings({ muted });
  // Browsers only start audio from a user gesture
  const unlockAudio = () => audio.unlock();
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });

  const renderer = createRenderer(canvas, quality);
  const input = new Input(canvas);
  const game = await Game.create(input, save, quality, audio);
  bindResize(renderer, game.camera);
  if (isTouchDevice) createTouchControls(input);
  // Inspect from the browser console during development
  if (import.meta.env.DEV) Object.assign(window, { game });

  const dynRes = new DynamicResolution(renderer, quality.maxPixelRatio);
  // Debug overlay (FPS meter + text) in development, or in a build with ?debug
  const showDebug = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");
  const stats = new Stats();
  if (showDebug && settings.showFps) {
    // Top-right under the debug text, clear of the HP bar
    Object.assign(stats.dom.style, { left: "auto", right: "8px", top: "84px", zIndex: "1" });
    document.body.appendChild(stats.dom);
  }

  let debugTimer = 0;
  const loop = new Loop(
    (dt) => game.update(dt),
    (alpha, frameDt) => {
      game.render(alpha, frameDt);
      renderer.render(game.scene, game.camera);
      dynRes.update(frameDt);
      if (!showDebug) return;
      stats.update();

      debugTimer += frameDt;
      if (debugTimer > 0.5) {
        debugTimer = 0;
        const p = game.player.pos;
        debug.textContent = [
          `quality: ${settings.quality}${isTouchDevice ? " (touch)" : ""}`,
          `draw calls: ${renderer.info.render.calls}  res: ${Math.round(dynRes.scale * 100)}% (${dynRes.pixelRatio.toFixed(2)}x)`,
          `pos: ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${game.player.animState}`,
          `monsters: ${game.monsters.filter((m) => m.alive).length}  drawn: ${game.monsters.filter((m) => m.root.visible).length}`,
        ].join("\n");
      }
    },
  );
  loop.start();

  // Backgrounded (app switched, screen locked): stop rendering and audio to save battery
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      loop.stop();
      audio.suspend();
    } else {
      loop.start();
      audio.resume();
    }
  });

  document.getElementById("loading")!.classList.add("hidden");
}

// Offline support + install to home screen (production builds only; the dev server has no service worker)
if (import.meta.env.PROD) registerSW({ immediate: true });

boot().catch((err) => {
  console.error(err);
  const loading = document.getElementById("loading")!;
  loading.classList.remove("hidden");
  // Saves are left untouched so a fixed build can still load them
  loading.textContent =
    err instanceof UnreadableSaveError ? "Your save could not be loaded. It has not been changed." : "Failed to start — see console";
});
