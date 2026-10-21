/**
 * Fixed-timestep game loop.
 * update() always runs at a fixed rate (deterministic gameplay, same on 30 FPS
 * phones and 144 Hz monitors); render() runs once per animation frame.
 */
export class Loop {
  readonly step: number;
  private accumulator = 0;
  private last = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private update: (dt: number) => void,
    private render: (alpha: number, frameDt: number) => void,
    hz = 60,
  ) {
    this.step = 1 / hz;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    // Clamp so a backgrounded tab doesn't trigger a huge catch-up burst
    const frameDt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.accumulator += frameDt;

    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }

    this.render(this.accumulator / this.step, frameDt);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
