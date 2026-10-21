/**
 * Procedural sound: every effect and the ambient bed are synthesized with
 * WebAudio, so the game ships no audio files. Browsers (iOS especially) only
 * allow audio after a user gesture, so nothing plays until unlock().
 */
export type Sfx =
  | "swing"
  | "hit"
  | "crit"
  | "monsterDeath"
  | "playerHurt"
  | "gold"
  | "pickup"
  | "dropMagic"
  | "dropRare"
  | "dropLegendary"
  | "levelUp"
  | "potion"
  | "portal";

/** Minimum gap between two plays of the same sound, so big fights don't clip. */
const MIN_GAP: Partial<Record<Sfx, number>> = { hit: 0.03, crit: 0.05, swing: 0.05, gold: 0.06, playerHurt: 0.08 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private lastPlayed = new Map<Sfx, number>();
  private dripTimer = 0;

  constructor(
    private volume: number,
    private muted: boolean,
  ) {}

  get isMuted() {
    return this.muted;
  }

  /** Call from a pointer / key handler. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.startAmbient();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Lets the app persist the mute choice. */
  onMuteChange: (muted: boolean) => void = () => {};

  setMuted(muted: boolean) {
    this.muted = muted;
    this.onMuteChange(muted);
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  /** Called every frame: schedules the occasional distant water drip. */
  update(dt: number) {
    if (!this.ctx) return;
    this.dripTimer -= dt;
    if (this.dripTimer <= 0) {
      this.dripTimer = 4 + Math.random() * 7;
      this.drip();
    }
  }

  play(name: Sfx) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap && now - (this.lastPlayed.get(name) ?? -1) < gap) return;
    this.lastPlayed.set(name, now);

    switch (name) {
      case "swing":
        this.noiseBurst(now, 0.14, "bandpass", 700, 2600, 0.22, 1.2);
        break;
      case "hit":
        this.noiseBurst(now, 0.07, "lowpass", 2200, 900, 0.35);
        this.tone(now, "sine", 150, 55, 0.14, 0.5);
        break;
      case "crit":
        this.noiseBurst(now, 0.1, "lowpass", 4000, 1200, 0.45);
        this.tone(now, "sine", 180, 45, 0.2, 0.7);
        this.tone(now, "square", 1400, 900, 0.05, 0.08);
        break;
      case "monsterDeath":
        this.tone(now, "sawtooth", 170, 45, 0.55, 0.18, 600);
        this.noiseBurst(now + 0.05, 0.4, "lowpass", 800, 200, 0.15);
        break;
      case "playerHurt":
        this.tone(now, "square", 230, 110, 0.16, 0.12, 900);
        this.noiseBurst(now, 0.06, "lowpass", 1500, 600, 0.2);
        break;
      case "gold":
        this.tone(now, "sine", 1900, 1900, 0.09, 0.12);
        this.tone(now + 0.06, "sine", 2500, 2500, 0.12, 0.1);
        break;
      case "pickup":
        this.tone(now, "triangle", 520, 780, 0.08, 0.15);
        break;
      case "dropMagic":
        this.tone(now, "triangle", 880, 880, 0.25, 0.1);
        break;
      case "dropRare":
        this.tone(now, "triangle", 880, 880, 0.3, 0.12);
        this.tone(now + 0.08, "triangle", 1320, 1320, 0.35, 0.1);
        break;
      case "dropLegendary":
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(now + i * 0.07, "triangle", f, f, 0.6, 0.12));
        this.noiseBurst(now, 0.8, "highpass", 6000, 3000, 0.04);
        break;
      case "levelUp":
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(now + i * 0.09, "triangle", f, f, 0.45, 0.16));
        break;
      case "potion":
        for (let i = 0; i < 4; i++) {
          const f = 300 + Math.random() * 300;
          this.tone(now + i * 0.06, "sine", f, f * 1.8, 0.07, 0.12);
        }
        break;
      case "portal":
        this.noiseBurst(now, 1.2, "bandpass", 200, 3000, 0.25, 2);
        this.tone(now, "sine", 60, 120, 1.2, 0.3);
        break;
    }
  }

  // ------------------------------------------------------------ building blocks

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Oscillator sweeping from f0 to f1 with a fast attack / exponential decay. */
  private tone(at: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, lowpass?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = this.envelope(at, dur, gain);
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      osc.connect(f).connect(g);
    } else {
      osc.connect(g);
    }
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Filtered noise with the filter frequency sweeping f0 → f1. */
  private noiseBurst(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 0.7) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    src.connect(f).connect(this.envelope(at, dur, gain));
    src.start(at, Math.random() * 1.5);
    src.stop(at + dur + 0.05);
  }

  private envelope(at: number, dur: number, gain: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(this.master);
    return g;
  }

  /** Low detuned drone + slow "wind" noise: the dungeon's background hum. */
  private startAmbient() {
    const ctx = this.ctx!;
    const bed = ctx.createGain();
    bed.gain.value = 0.06;
    bed.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.connect(bed);
    for (const f of [55, 55.4, 82.4]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    // Slowly breathing filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 400;
    bp.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.25;
    wind.connect(bp).connect(windGain).connect(bed);
    wind.start();
  }

  /** A single distant water drip, panned somewhere random. */
  private drip() {
    const ctx = this.ctx!;
    if (this.muted) return;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(1400 + Math.random() * 500, at);
    osc.frequency.exponentialRampToValueAtTime(700, at + 0.12);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
    osc.connect(g).connect(pan).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.2);
  }
}
