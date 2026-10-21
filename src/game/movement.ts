import * as THREE from "three";

const WAYPOINT_EPS = 0.12;
const dir = new THREE.Vector3();

/**
 * Advance from `from` up to `dist` metres along `path`, consuming reached
 * waypoints in place. Writes the new position into `out` and returns the
 * heading (yaw) moved in, or null if nothing moved.
 */
export function stepAlongPath(
  from: THREE.Vector3,
  path: THREE.Vector3[],
  dist: number,
  out: THREE.Vector3,
): number | null {
  out.copy(from);
  let yaw: number | null = null;
  while (path.length && dist > 0) {
    const wp = path[0];
    dir.subVectors(wp, out).setY(0);
    const len = dir.length();
    if (len <= dist || len < WAYPOINT_EPS) {
      out.copy(wp);
      path.shift();
      dist -= len;
      if (len > 1e-4) yaw = Math.atan2(dir.x, dir.z);
    } else {
      out.addScaledVector(dir.divideScalar(len), dist);
      yaw = Math.atan2(dir.x, dir.z);
      dist = 0;
    }
  }
  return yaw;
}

export function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function yawTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Signed shortest difference b - a, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  const d = b - a;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** Frame-rate independent turn of `current` towards `target`. */
export function dampYaw(current: number, target: number, speed: number, dt: number): number {
  return current + angleDiff(current, target) * (1 - Math.exp(-speed * dt));
}
