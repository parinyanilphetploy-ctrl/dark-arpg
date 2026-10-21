import * as THREE from "three";
import type { QualityProfile } from "../settings";

/** WebGL renderer + resize handling, configured from a quality profile. */
export function createRenderer(canvas: HTMLCanvasElement, q: QualityProfile) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Frame time above this (≈ under 45 FPS) lowers the resolution. */
const SLOW_FRAME = 1 / 45;
/** Frame time below this (≈ a steady 55+ FPS) lets it creep back up. */
const FAST_FRAME = 1 / 55;
const SAMPLE_TIME = 1;
const STEP = 0.1;
const MIN_SCALE = 0.5;

/**
 * Dynamic resolution: keeps the frame rate up on weak phones by rendering
 * fewer pixels. Averages frame time over a second, drops the pixel ratio
 * quickly when slow, and raises it slowly (only after sustained headroom) so it
 * doesn't oscillate.
 */
export class DynamicResolution {
  /** Fraction of the maximum pixel ratio currently used. */
  scale = 1;
  private time = 0;
  private frames = 0;
  private fastStreak = 0;
  /** Average frame time measured right before the last drop. */
  private avgBeforeDrop = 0;
  /** Seconds during which no further drops are tried. */
  private holdOff = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private maxPixelRatio: number,
  ) {}

  update(frameDt: number) {
    // Ignore hitches from tab switches / loading
    if (frameDt > 0.2) return;
    this.time += frameDt;
    this.frames++;
    if (this.time < SAMPLE_TIME) return;

    const avg = this.time / this.frames;
    this.holdOff -= this.time;
    this.time = 0;
    this.frames = 0;
    if (avg > SLOW_FRAME) {
      this.fastStreak = 0;
      if (this.avgBeforeDrop && avg > this.avgBeforeDrop * 0.95) {
        // Fewer pixels didn't help: the frame rate is capped (e.g. iOS Low Power Mode
        // locks 30 FPS) or the CPU is the bottleneck. Undo the drop and stop trying for a while.
        this.set(this.scale + STEP);
        this.avgBeforeDrop = 0;
        this.holdOff = 20;
      } else if (this.holdOff <= 0 && this.scale > MIN_SCALE) {
        this.avgBeforeDrop = avg;
        this.set(this.scale - STEP);
      } else {
        this.avgBeforeDrop = 0;
      }
    } else if (avg < FAST_FRAME && this.scale < 1) {
      this.avgBeforeDrop = 0;
      // Need 3 good seconds in a row before going back up
      if (++this.fastStreak >= 3) {
        this.fastStreak = 0;
        this.set(this.scale + STEP);
      }
    } else {
      this.fastStreak = 0;
      this.avgBeforeDrop = 0;
    }
  }

  get pixelRatio() {
    return this.renderer.getPixelRatio();
  }

  private set(scale: number) {
    this.scale = THREE.MathUtils.clamp(Math.round(scale * 10) / 10, MIN_SCALE, 1);
    this.renderer.setPixelRatio(this.scale * Math.min(window.devicePixelRatio, this.maxPixelRatio));
  }
}

export function bindResize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep roughly the same visible world width in portrait as in landscape
    camera.fov = w < h ? 55 : 35;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();
  return resize;
}
