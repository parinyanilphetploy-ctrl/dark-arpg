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
