import * as THREE from "three";

export interface ClipSpec {
  clip: string;
  /** Play once and hold the last frame (attacks, death). */
  once?: boolean;
  speed?: number;
}

/** Maps gameplay states to animation clips and cross-fades between them. */
export class Animator<S extends string> {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<S, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], specs: Record<S, ClipSpec>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [state, spec] of Object.entries(specs) as [S, ClipSpec][]) {
      const clip = THREE.AnimationClip.findByName(clips, spec.clip);
      if (!clip) {
        console.warn(`Missing animation clip "${spec.clip}"`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      action.timeScale = spec.speed ?? 1;
      if (spec.once) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }
  }

  /** Switch to `state`'s clip; no-op if it's already playing. */
  play(state: S, fade = 0.2) {
    const next = this.actions.get(state);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  setSpeed(state: S, speed: number) {
    const a = this.actions.get(state);
    if (a) a.timeScale = speed;
  }

  /** Real-time length of a state's clip, after its speed. */
  duration(state: S, fallback = 0.5): number {
    const a = this.actions.get(state);
    return a ? a.getClip().duration / Math.abs(a.timeScale) : fallback;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}
