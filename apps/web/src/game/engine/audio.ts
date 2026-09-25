/**
 * All sounds are synthesised on the fly with the Web Audio API: short filtered
 * noise for the tactile "wood and felt" parts, and soft plucked tones on a
 * pentatonic scale for the musical rewards, sent through a gentle room reverb.
 */

const PENTATONIC = [0, 2, 4, 7, 9]; // major pentatonic, semitones
const BASE_MIDI = 72; // C5

function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function scaleNote(step: number, baseMidi = BASE_MIDI) {
  const octave = Math.floor(step / PENTATONIC.length);
  const idx = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return midiToHz(baseMidi + octave * 12 + PENTATONIC[idx]);
}

interface ToneOpts {
  freq: number;
  freqEnd?: number;
  glide?: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
  decay: number;
  pan?: number;
  wet?: number;
  delay?: number;
}

interface NoiseOpts {
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  pan?: number;
  wet?: number;
  delay?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wetBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private melodyStep = 3;
  private lastPlay = new Map<string, number>();
  volume = 0.8;
  muted = false;

  /** Must be called from a user gesture (iOS/Safari autoplay rules). */
  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(comp).connect(ctx.destination);
      this.master = master;

      const convolver = ctx.createConvolver();
      convolver.buffer = this.makeImpulse(ctx, 1.9, 3.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.9;
      const wetFilter = ctx.createBiquadFilter();
      wetFilter.type = 'lowpass';
      wetFilter.frequency.value = 5200;
      wet.connect(convolver).connect(wetFilter).connect(master);
      this.wetBus = wet;

      const len = ctx.sampleRate;
      const noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = noise;

      // A silent blip fully unlocks audio on iOS.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Low-passed noise with an exponential tail = soft, woody room.
        smooth = smooth * 0.55 + (Math.random() * 2 - 1) * 0.45;
        d[i] = smooth * Math.pow(1 - t, decay) * (i < 90 ? i / 90 : 1);
      }
    }
    return buf;
  }

  private ready(): AudioContext | null {
    if (!this.ctx || this.muted || this.volume <= 0) return null;
    if (this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  /** Avoids machine-gun repeats of the same sound within `ms`. */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? 0;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private out(ctx: AudioContext, pan: number, wet: number): GainNode {
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      g.connect(panner).connect(this.master!);
      if (wet > 0) {
        const send = ctx.createGain();
        send.gain.value = wet;
        panner.connect(send).connect(this.wetBus!);
      }
    } else {
      g.connect(this.master!);
    }
    return g;
  }

  private tone(o: ToneOpts) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0) + 0.005;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.glide ?? o.decay * 0.5));
    const env = ctx.createGain();
    const a = o.attack ?? 0.004;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.gain, t + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    osc.connect(env).connect(this.out(ctx, o.pan ?? 0, o.wet ?? 0));
    osc.start(t);
    osc.stop(t + a + o.decay + 0.05);
  }

  private noiseBurst(o: NoiseOpts) {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + (o.delay ?? 0) + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.value = o.freq;
    filter.Q.value = o.q ?? 0.8;
    const env = ctx.createGain();
    const a = o.attack ?? 0.002;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.gain, t + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
    src.connect(filter).connect(env).connect(this.out(ctx, o.pan ?? 0, o.wet ?? 0));
    const offset = Math.random() * 0.8;
    src.start(t, offset, a + o.decay + 0.05);
  }

  /** A soft plucked note (kalimba / marimba-ish). */
  private pluck(freq: number, gain: number, pan: number, wet: number, delay = 0, decay = 1.3) {
    this.tone({ freq, gain, decay, pan, wet, delay, attack: 0.003 });
    this.tone({ freq: freq * 2, gain: gain * 0.28, decay: decay * 0.55, pan, wet, delay, attack: 0.003 });
    this.tone({ freq: freq * 3.01, gain: gain * 0.07, decay: decay * 0.22, pan, wet, delay, attack: 0.002 });
    this.noiseBurst({ filter: 'bandpass', freq: Math.min(freq * 4, 9000), q: 2, gain: gain * 0.25, decay: 0.018, pan, wet: wet * 0.5, delay });
  }

  private vary(x: number, amount = 0.04) {
    return x * (1 + (Math.random() * 2 - 1) * amount);
  }

  // ── Game sounds ─────────────────────────────────────────────────────────

  pickup(pan = 0) {
    if (!this.throttle('pickup', 40)) return;
    this.noiseBurst({ filter: 'bandpass', freq: this.vary(2600, 0.1), q: 1.4, gain: 0.09, decay: 0.03, pan });
    this.tone({ freq: this.vary(540), freqEnd: this.vary(700), glide: 0.05, gain: 0.07, decay: 0.07, pan, wet: 0.05 });
  }

  /** Setting a piece down on the felt table (or the board). */
  drop(pan = 0, onBoard = false) {
    if (!this.throttle('drop', 40)) return;
    this.noiseBurst({ filter: 'lowpass', freq: this.vary(onBoard ? 1300 : 900, 0.1), q: 0.7, gain: 0.13, decay: 0.05, pan });
    this.tone({ freq: this.vary(onBoard ? 210 : 170), freqEnd: this.vary(onBoard ? 150 : 120), glide: 0.06, gain: 0.12, decay: 0.1, pan, wet: 0.04 });
  }

  /** Wrong spot on the map: a muted, friendly "not quite". */
  miss(pan = 0) {
    if (!this.throttle('miss', 80)) return;
    this.tone({ freq: 262, freqEnd: 220, glide: 0.08, type: 'triangle', gain: 0.05, decay: 0.16, pan, wet: 0.1 });
    this.tone({ freq: 196, gain: 0.04, decay: 0.2, pan, wet: 0.1, delay: 0.07, type: 'triangle' });
  }

  /** The satisfying "seated" click plus a note that walks up a pentatonic melody. */
  snap(pan = 0, remote = false) {
    const k = remote ? 0.55 : 1;
    // Seat: a bright tick then a woody knock, like a piece dropping into a tray.
    this.noiseBurst({ filter: 'highpass', freq: 3200, q: 0.7, gain: 0.07 * k, decay: 0.012, pan });
    this.tone({ freq: this.vary(1000, 0.02), freqEnd: 760, glide: 0.03, gain: 0.08 * k, decay: 0.05, pan, delay: 0.012 });
    this.noiseBurst({ filter: 'lowpass', freq: 700, q: 0.8, gain: 0.1 * k, decay: 0.05, pan, delay: 0.014 });
    // Melody.
    if (!remote) {
      const r = Math.random();
      const stepDelta = r < 0.18 ? -2 : r < 0.4 ? -1 : r < 0.8 ? 1 : 2;
      this.melodyStep += stepDelta;
      if (this.melodyStep > 9) this.melodyStep -= 4;
      if (this.melodyStep < 0) this.melodyStep += 3;
    }
    const step = remote ? this.melodyStep - 5 : this.melodyStep;
    const f = scaleNote(step);
    this.pluck(f, 0.13 * k, pan, 0.35, 0.05, remote ? 0.9 : 1.4);
    if (!remote) this.pluck(f * 1.5, 0.035, -pan * 0.5, 0.4, 0.09, 1.0);
  }

  deny() {
    this.tone({ freq: 330, gain: 0.04, decay: 0.05, type: 'triangle' });
    this.tone({ freq: 294, gain: 0.04, decay: 0.07, type: 'triangle', delay: 0.07 });
  }

  tap() {
    if (!this.throttle('tap', 30)) return;
    this.noiseBurst({ filter: 'bandpass', freq: 3800, q: 1.6, gain: 0.035, decay: 0.018 });
  }

  /** Soft UI click. */
  ui() {
    if (!this.throttle('ui', 30)) return;
    this.tone({ freq: 1320, gain: 0.025, decay: 0.035, type: 'sine' });
  }

  countdown(n: number) {
    const f = n > 0 ? 587.33 : 880;
    this.pluck(f, 0.09, 0, 0.25, 0, 0.6);
    if (n === 0) {
      this.pluck(f * 1.25, 0.06, -0.2, 0.3, 0.02, 0.9);
      this.pluck(f * 1.5, 0.06, 0.2, 0.3, 0.04, 1.1);
    }
  }

  /** The finished map: a warm, rising arpeggio over a soft pad. */
  complete() {
    const ctx = this.ready();
    if (!ctx) return;
    const arp = [60, 67, 74, 76, 83, 86, 91];
    arp.forEach((m, i) => this.pluck(midiToHz(m), 0.1 - i * 0.006, (i / (arp.length - 1)) * 1.2 - 0.6, 0.45, i * 0.085, 1.8));
    const pad = [48, 55, 64, 71];
    const t = ctx.currentTime + 0.05;
    for (const [i, m] of pad.entries()) {
      for (const det of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiToHz(m);
        osc.detune.value = det;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.022 - i * 0.003, t + 0.9);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
        osc.connect(lp).connect(env).connect(this.out(ctx, det < 0 ? -0.3 : 0.3, 0.6));
        osc.start(t);
        osc.stop(t + 4.4);
      }
    }
    // A few high shimmer bells.
    [98, 103, 107].forEach((m, i) => this.tone({ freq: midiToHz(m), gain: 0.012, decay: 1.4, delay: 0.7 + i * 0.16, pan: 0.5 - i * 0.4, wet: 0.8 }));
  }

  /** Someone joined the room. */
  join() {
    this.pluck(scaleNote(2), 0.05, 0, 0.3, 0, 0.7);
    this.pluck(scaleNote(4), 0.05, 0, 0.3, 0.08, 0.9);
  }
}

export const sound = new SoundEngine();
