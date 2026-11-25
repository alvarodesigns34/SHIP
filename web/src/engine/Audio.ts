/**
 * Audio procedural (WebAudio). No hay muestras grabadas: todo se sintetiza,
 * así que no existen bucles audibles. Modo «realista»: en el vacío solo se oye
 * lo que se transmite por la estructura o por el traje. Modo «cinematográfico»:
 * se añaden efectos exteriores estilizados.
 */
export type SoundMode = 'realista' | 'cinematico';

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private ambient!: GainNode;
  private fanGain!: GainNode;
  private humGain!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private servoGain!: GainNode;
  private servoOsc!: OscillatorNode;
  private suitGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  mode: SoundMode = 'realista';
  volume = 0.7;
  /** contexto acústico actual */
  inside = true;
  inSuit = false;

  /** Debe llamarse tras un gesto del usuario. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // ruido marrón (10 s, con variación lenta para evitar periodicidad perceptible)
    const len = ctx.sampleRate * 10;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.ambient = ctx.createGain(); this.ambient.gain.value = 1; this.ambient.connect(this.master);
    // ventilación: ruido filtrado con modulación lenta (dos capas desfasadas)
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    for (const [rate, f] of [[1, 420], [0.83, 900]] as const) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 * rate; const lg = ctx.createGain(); lg.gain.value = f * 0.15;
      lfo.connect(lg).connect(bp.frequency); lfo.start();
      src.connect(bp).connect(this.fanGain); src.start(0, Math.random() * 9);
    }
    this.fanGain.connect(this.ambient);
    // zumbido eléctrico muy tenue (60/120 Hz)
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    for (const f of [60, 120, 180]) {
      const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = f === 120 ? 0.012 : 0.006;
      o.connect(g).connect(this.humGain); o.start();
    }
    this.humGain.connect(this.ambient);
    // motor / propulsión (rumor estructural)
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 160;
    const es = ctx.createBufferSource(); es.buffer = this.noiseBuf; es.loop = true; es.playbackRate.value = 0.6;
    es.connect(this.engineFilter).connect(this.engineGain).connect(this.master); es.start();
    // servomotores (mecanismos)
    this.servoGain = ctx.createGain(); this.servoGain.gain.value = 0;
    this.servoOsc = ctx.createOscillator(); this.servoOsc.type = 'sawtooth'; this.servoOsc.frequency.value = 180;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 700; sf.Q.value = 2;
    this.servoOsc.connect(sf).connect(this.servoGain).connect(this.master); this.servoOsc.start();
    // traje EVA: ventilador del traje y respiración suave
    this.suitGain = ctx.createGain(); this.suitGain.gain.value = 0;
    const ss = ctx.createBufferSource(); ss.buffer = this.noiseBuf; ss.loop = true; ss.playbackRate.value = 1.4;
    const sh = ctx.createBiquadFilter(); sh.type = 'highpass'; sh.frequency.value = 1500;
    const br = ctx.createGain(); br.gain.value = 0.5;
    const blfo = ctx.createOscillator(); blfo.frequency.value = 0.22; const bg = ctx.createGain(); bg.gain.value = 0.35;
    blfo.connect(bg).connect(br.gain); blfo.start();
    ss.connect(sh).connect(br).connect(this.suitGain).connect(this.master); ss.start();
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  /** Actualización continua: niveles de ambiente según contexto y estado de la nave. */
  update(p: { fans: number; power: number; thrust: number; mech: number; inside: boolean; suit: boolean }) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.inside = p.inside; this.inSuit = p.suit;
    const interior = p.inside ? 1 : 0;
    this.fanGain.gain.setTargetAtTime(0.09 * p.fans * interior, t, 0.4);
    this.humGain.gain.setTargetAtTime(0.5 * p.power * interior, t, 0.4);
    // la propulsión solo se oye dentro (vibración estructural) o en modo cinematográfico
    const eng = p.thrust * (p.inside ? 0.5 : this.mode === 'cinematico' ? 0.35 : 0);
    this.engineGain.gain.setTargetAtTime(eng, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(120 + 260 * p.thrust, t, 0.2);
    const servo = p.mech * (p.inside || p.suit || this.mode === 'cinematico' ? 0.035 : 0);
    this.servoGain.gain.setTargetAtTime(servo, t, 0.08);
    this.servoOsc.frequency.setTargetAtTime(150 + 90 * p.mech, t, 0.2);
    this.suitGain.gain.setTargetAtTime(p.suit ? 0.05 : 0, t, 0.5);
  }

  private env(g: GainNode, a: number, peak: number, dcy: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  private audible(structural: boolean) {
    return this.inside || this.inSuit || this.mode === 'cinematico' || structural;
  }

  click(on = true) {
    const c = this.ctx; if (!c || !this.audible(false)) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 3;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = on ? 3200 : 2400; f.Q.value = 6;
    const g = c.createGain(); s.connect(f).connect(g).connect(this.master); this.env(g, 0.002, 0.5, 0.05); s.start(0, Math.random() * 5); s.stop(c.currentTime + 0.1);
  }

  thud(strength = 1) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, c.currentTime); o.frequency.exponentialRampToValueAtTime(38, c.currentTime + 0.35);
    const g = c.createGain(); o.connect(g).connect(this.master); this.env(g, 0.005, 0.5 * strength, 0.45); o.start(); o.stop(c.currentTime + 0.6);
  }

  beep(kind: 'ok' | 'warn' | 'alarm' | 'info' = 'info') {
    const c = this.ctx; if (!c) return;
    const seq = kind === 'ok' ? [880, 1320] : kind === 'warn' ? [660, 520] : kind === 'alarm' ? [740, 740, 740] : [1046];
    seq.forEach((f, i) => {
      const o = c.createOscillator(); o.type = kind === 'alarm' ? 'square' : 'sine'; o.frequency.value = f;
      const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      o.connect(lp).connect(g).connect(this.master);
      const t0 = c.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(kind === 'alarm' ? 0.08 : 0.12, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      o.start(t0); o.stop(t0 + 0.13);
    });
  }

  /** Tono de comunicaciones (bip de apertura/cierre del circuito de voz) y voz sintética opcional. */
  comms(text?: string) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.frequency.value = 2525; const g = c.createGain();
    o.connect(g).connect(this.master); this.env(g, 0.005, 0.05, 0.22); o.start(); o.stop(c.currentTime + 0.25);
    if (text && 'speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 1.05; u.pitch = 0.9; u.volume = this.volume * 0.8;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
      } catch { /* opcional */ }
    }
  }

  rcs() {
    const c = this.ctx; if (!c) return;
    if (!this.inside && !this.inSuit && this.mode !== 'cinematico') return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1.8;
    const f = c.createBiquadFilter(); f.type = this.inside ? 'lowpass' : 'bandpass'; f.frequency.value = this.inside ? 220 : 1400;
    const g = c.createGain(); s.connect(f).connect(g).connect(this.master); this.env(g, 0.004, this.inside ? 0.25 : 0.08, 0.12);
    s.start(0, Math.random() * 5); s.stop(c.currentTime + 0.2);
  }

  hatch(open: boolean) {
    this.thud(0.8);
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(open ? 300 : 500, c.currentTime); o.frequency.linearRampToValueAtTime(open ? 520 : 280, c.currentTime + 0.6);
    const g = c.createGain(); o.connect(g).connect(this.master); this.env(g, 0.05, 0.03, 0.6); o.start(); o.stop(c.currentTime + 0.8);
  }

  pulse() {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1800, c.currentTime); o.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.25);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    const g = c.createGain(); o.connect(f).connect(g).connect(this.master); this.env(g, 0.003, 0.07, 0.25); o.start(); o.stop(c.currentTime + 0.3);
  }

  burst() {
    const c = this.ctx; if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.9;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, c.currentTime); f.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.6);
    const g = c.createGain(); s.connect(f).connect(g).connect(this.master); this.env(g, 0.005, 0.18, 0.6); s.start(0, Math.random() * 5); s.stop(c.currentTime + 0.8);
  }

  shutter() {
    const c = this.ctx; if (!c) return;
    [0, 0.06].forEach((dt) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 4;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000;
      const g = c.createGain(); s.connect(f).connect(g).connect(this.master);
      const t0 = c.currentTime + dt; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      s.start(t0, Math.random() * 5); s.stop(t0 + 0.07);
    });
  }
}
