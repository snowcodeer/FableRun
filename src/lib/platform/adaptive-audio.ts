export interface AdaptiveAudioMix {
  /** Narrative danger level, clamped to 0-1. */
  intensity: number;
  /** Runner performance from -1 (struggling) to 1 (strong). */
  performance?: number;
}
export type AdaptiveAudioStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "unsupported"
  | "error";

export interface AdaptiveAudioResult {
  supported: boolean;
  status: AdaptiveAudioStatus;
  muted: boolean;
  mix: Required<AdaptiveAudioMix>;
  /** Must be called from a user gesture before any sound is created. */
  start: () => Promise<boolean>;
  pause: () => Promise<void>;
  /** Browsers may require this to be called from a user gesture. */
  resume: () => Promise<boolean>;
  stop: () => Promise<void>;
  setMix: (mix: AdaptiveAudioMix) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;

  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function clampAudio(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Dependency-free procedural score. It owns every node it creates and can be
 * safely stopped on route changes. Construction is silent; `start()` is the
 * only operation that creates an AudioContext.
 */
export class AdaptiveAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private chaseGain: GainNode | null = null;
  private longLivedNodes: AudioScheduledSourceNode[] = [];
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private nextBeatAt = 0;
  private beatIndex = 0;
  private generation = 0;
  private muted = false;
  private mix: Required<AdaptiveAudioMix> = { intensity: 0, performance: 0 };

  static isSupported(): boolean {
    return getAudioContextConstructor() !== null;
  }

  async start(): Promise<boolean> {
    if (this.context) return this.resume();

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) return false;

    const context = new AudioContextClass();
    const generation = ++this.generation;
    this.context = context;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;

    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(compressor);
    compressor.connect(context.destination);

    this.createAmbientLayer(context);
    this.createChaseLayer(context);
    this.applyMix();

    try {
      await context.resume();
    } catch {
      if (this.context === context) this.context = null;
      if (context.state !== "closed") await context.close().catch(() => undefined);
      return false;
    }
    if (this.context !== context || this.generation !== generation) {
      if (context.state !== "closed") await context.close().catch(() => undefined);
      return false;
    }
    this.nextBeatAt = context.currentTime + 0.05;
    this.startScheduler();
    return context.state === "running";
  }

  setMix(mix: AdaptiveAudioMix): void {
    this.mix = {
      intensity: clampAudio(mix.intensity, 0, 1),
      performance: clampAudio(mix.performance ?? 0, -1, 1),
    };
    this.applyMix();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) return;

    this.master.gain.setTargetAtTime(
      muted ? 0 : 0.55,
      this.context.currentTime,
      0.04,
    );
  }

  async pause(): Promise<void> {
    this.generation += 1;
    this.stopScheduler();
    const context = this.context;
    if (context?.state === "running") {
      await context.suspend().catch(() => undefined);
    }
  }

  async resume(): Promise<boolean> {
    if (!this.context) return this.start();
    const context = this.context;
    const generation = ++this.generation;
    await context.resume().catch(() => undefined);
    if (
      this.context !== context ||
      this.generation !== generation ||
      context.state !== "running"
    ) {
      return false;
    }
    this.nextBeatAt = context.currentTime + 0.05;
    this.startScheduler();
    return true;
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.stopScheduler();
    for (const node of this.longLivedNodes) {
      try {
        node.stop();
      } catch {
        // A node can already be stopped during strict-mode teardown.
      }
    }
    this.longLivedNodes = [];

    const context = this.context;
    this.context = null;
    this.master = null;
    this.ambientGain = null;
    this.chaseGain = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }

  private createAmbientLayer(context: AudioContext): void {
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 43;
    filter.type = "lowpass";
    filter.frequency.value = 180;
    gain.gain.value = 0.025;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    this.ambientGain = gain;
    this.longLivedNodes.push(oscillator);
  }

  private createChaseLayer(context: AudioContext): void {
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = 86;
    filter.type = "lowpass";
    filter.frequency.value = 260;
    gain.gain.value = 0;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    this.chaseGain = gain;
    this.longLivedNodes.push(oscillator);
  }

  private applyMix(): void {
    if (!this.context) return;
    const urgency = clampAudio(
      this.mix.intensity + Math.max(0, -this.mix.performance) * 0.22,
      0,
      1,
    );
    const now = this.context.currentTime;
    this.ambientGain?.gain.setTargetAtTime(0.02 + urgency * 0.04, now, 0.15);
    this.chaseGain?.gain.setTargetAtTime(
      urgency > 0.58 ? (urgency - 0.58) * 0.075 : 0,
      now,
      0.08,
    );
  }

  private startScheduler(): void {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => this.scheduleAhead(), 80);
    this.scheduleAhead();
  }

  private stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private scheduleAhead(): void {
    const context = this.context;
    if (!context || context.state !== "running") return;

    const urgency = clampAudio(
      this.mix.intensity + Math.max(0, -this.mix.performance) * 0.22,
      0,
      1,
    );
    const bpm = 66 + urgency * 76;
    const beatDuration = 60 / bpm;

    while (this.nextBeatAt < context.currentTime + 0.2) {
      this.scheduleHeartbeat(context, this.nextBeatAt, urgency);
      if (urgency > 0.18) this.scheduleBass(context, this.nextBeatAt, urgency);
      if (urgency > 0.4 && this.beatIndex % 2 === 0) {
        this.schedulePercussion(context, this.nextBeatAt, urgency);
      }
      if (urgency > 0.72) {
        this.schedulePercussion(
          context,
          this.nextBeatAt + beatDuration / 2,
          urgency * 0.72,
        );
      }
      this.nextBeatAt += beatDuration;
      this.beatIndex += 1;
    }
  }

  private scheduleHeartbeat(
    context: AudioContext,
    at: number,
    urgency: number,
  ): void {
    this.scheduleTone(context, at, 56 + urgency * 18, 0.07, 0.08 + urgency * 0.05);
    this.scheduleTone(
      context,
      at + 0.115,
      48 + urgency * 15,
      0.055,
      0.05 + urgency * 0.035,
    );
  }

  private scheduleBass(
    context: AudioContext,
    at: number,
    urgency: number,
  ): void {
    this.scheduleTone(context, at, 39 + urgency * 13, 0.16, 0.035 + urgency * 0.055);
  }

  private scheduleTone(
    context: AudioContext,
    at: number,
    frequency: number,
    duration: number,
    volume: number,
  ): void {
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, frequency * 0.72),
      at + duration,
    );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private schedulePercussion(
    context: AudioContext,
    at: number,
    urgency: number,
  ): void {
    if (!this.master) return;
    const frameCount = Math.floor(context.sampleRate * 0.075);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    // A deterministic LCG makes the procedural texture repeatable in demos.
    let seed = (this.beatIndex + 1) * 2_654_435_761;
    for (let index = 0; index < frameCount; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      channel[index] = (seed / 0xffffffff) * 2 - 1;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 780 + urgency * 1_100;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.04 + urgency * 0.045, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.075);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(at);
    source.stop(at + 0.08);
  }
}
