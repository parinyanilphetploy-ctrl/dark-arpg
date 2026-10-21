import * as THREE from "three";

/**
 * Procedurally painted canvas textures, so the dungeon needs no image downloads.
 * Each is generated once and cached.
 */
const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, paint: (g: CanvasRenderingContext2D, s: number) => void) {
  let tex = cache.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!, size);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function speckle(g: CanvasRenderingContext2D, s: number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Worn flagstones, one cell = one texture repeat. */
export function stoneFloorTexture() {
  return canvasTexture("floor", 256, (g, s) => {
    g.fillStyle = "#1c1814";
    g.fillRect(0, 0, s, s);
    const half = s / 2;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const l = 26 + Math.random() * 14;
        g.fillStyle = `hsl(28, 10%, ${l}%)`;
        g.fillRect(tx * half + 3, ty * half + 3, half - 6, half - 6);
      }
    }
    speckle(g, s, 2500, 0.18);
    // A few cracks
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (Math.random() - 0.5) * 50;
        y += (Math.random() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Rough brick courses for walls. */
export function brickWallTexture() {
  return canvasTexture("wall", 256, (g, s) => {
    g.fillStyle = "#120e0b";
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const bh = s / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? bh : 0;
      for (let x = -offset; x < s; x += bh * 2) {
        const l = 18 + Math.random() * 12;
        g.fillStyle = `hsl(20, 12%, ${l}%)`;
        g.fillRect(x + 2, r * bh + 2, bh * 2 - 4, bh - 4);
      }
    }
    speckle(g, s, 2000, 0.2);
  });
}

/** Soft radial dot for glows and particles. */
export function glowTexture() {
  return canvasTexture("glow", 64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}
