/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Audio procedural espacializado por compartimento (WebAudio, 100 % síntesis determinista CC0).
 *
 * Acústica diferenciada por estancia (incluyendo mezcla wet de reverberación por convolución):
 *  - Habitáculos (`quarters`): acolchado acústico muy seco (reverb 0,04, ventilación 0,45×)
 *  - Cabina (`cockpit`): seco y denso, zumbido sutil de aviónica + ventilación neutra (reverb 0,10)
 *  - Laboratorio (`lab`): flujo HEPA limpio + compresor criogénico Stirling (−80 °C) (reverb 0,16)
 *  - Servicios/Cocina (`services`): circulación ECLSS + ligera resonancia de bombas (reverb 0,18)
 *  - Nodo/Cúpula (`node`): cavidad metálica resonante (reverb 0,32)
 *  - Esclusa (`airlock`): cilindro metálico estanco resonante + silbido de presurización (reverb 0,38)
 *  - EVA (`eva`): silencio exterior + ventilador PLSS y respiración rítmica dentro del traje
 *  - Vacío (`space`): silencio estricto en modo «realista»; ambiente espacial y propulsores en «cinematico»
 */
export type SoundMode = 'realista' | 'cinematico';
export type AcousticZone = 'cockpit' | 'lab' | 'quarters' | 'services' | 'node' | 'airlock' | 'eva' | 'space';
export type FootstepSurface = 'floor' | 'ladder' | 'push';

/** Perfil acústico por estancia: ventilación, corte LPF, hum aviónica, criogénico y mezcla reverb. */
const ZONE_PROFILE: Record<AcousticZone, { fan: number; lpf: number; hum: number; cryo: number; reverb: number }> = {
  cockpit:  { fan: 0.085, lpf: 1900, hum: 0.62, cryo: 0.002, reverb: 0.10 },
  lab:      { fan: 0.110, lpf: 2400, hum: 0.48, cryo: 0.016, reverb: 0.16 },
  quarters: { fan: 0.042, lpf: 780,  hum: 0.25, cryo: 0.004, reverb: 0.04 },
  services: { fan: 0.125, lpf: 1550, hum: 0.52, cryo: 0.008, reverb: 0.18 },
  node:     { fan: 0.060, lpf: 1300, hum: 0.30, cryo: 0.000, reverb: 0.32 },
  airlock:  { fan: 0.050, lpf: 1100, hum: 0.22, cryo: 0.000, reverb: 0.38 },
  eva:      { fan: 0.000, lpf: 900,  hum: 0.00, cryo: 0.000, reverb: 0.00 },
  space:    { fan: 0.000, lpf: 900,  hum: 0.00, cryo: 0.000, reverb: 0.00 },
};

/** Genera un impulso de reverberación estéreo sintético determinista (sin Math.random()). */
function buildSyntheticIR(ctx: AudioContext, durationSec = 0.65): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * durationSec));
  const ir = ctx.createBuffer(2, len, sr);
  // Reflexiones tempranas de cavidad metálica (tiempos en ms y amplitudes)
  const early: [number, number][] = [[6, 0.42], [11, -0.34], [17, 0.28], [24, -0.22], [33, 0.16], [44, -0.12]];
  let seed = 0x51a7c0de;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const out = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const decay = Math.exp(-t * 6.8);
      // Suavizado pasa-bajo ligero para evitar brillo metálico áspero
      const raw = nextRand() * decay * 0.28;
      lp = lp * 0.62 + raw * 0.38;
      out[i] = lp;
    }
    for (const [ms, amp] of early) {
      const idx = Math.floor(((ms + ch * 1.4) / 1000) * sr);
      if (idx > 0 && idx < len) out[idx] += amp;
    }
  }
  return ir;
}

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private ambient!: GainNode;
  private reverbSend!: GainNode;
  private reverbWet!: GainNode;
  private fanGain!: GainNode;
  private fanFilter!: BiquadFilterNode;
  private humGain!: GainNode;
  private cryoGain!: GainNode;
  private airlockHissGain!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private servoGain!: GainNode;
  private servoOsc!: OscillatorNode;
  private servoOsc2!: OscillatorNode;
  private servoGearGain!: GainNode;
  private suitGain!: GainNode;
  private spaceAmbGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  mode: SoundMode = 'realista';
  volume = 0.7;
  inside = true;
  inSuit = false;
  zone: AcousticZone = 'space';
  /** Últimas ganancias objetivo calculadas en update() (para diagnóstico verificable). */
  lastTargets = { fan: 0, hum: 0, cryo: 0, engine: 0, servo: 0, suit: 0, spaceAmb: 0, reverb: 0 };

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

    // Reverberación ligera por convolución sintética determinista (mezcla por estancia)
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const conv = ctx.createConvolver();
    conv.buffer = buildSyntheticIR(ctx, 0.65);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.10;
    this.reverbSend.connect(conv).connect(this.reverbWet).connect(this.master);

    // Ruido marrón-rosa determinista en memoria (10 s en bucle)
    const len = ctx.sampleRate * 10;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    let seed = 0x243f6a88;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const w = (seed / 0xffffffff) * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    this.ambient = ctx.createGain(); this.ambient.gain.value = 1; this.ambient.connect(this.master);

    // Ventilación de cabina con filtro dinámico por compartimento
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    this.fanFilter = ctx.createBiquadFilter(); this.fanFilter.type = 'lowpass'; this.fanFilter.frequency.value = 1800;
    for (const [rate, f] of [[1, 420], [0.83, 920]] as const) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = rate;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.55;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 * rate; const lg = ctx.createGain(); lg.gain.value = f * 0.14;
      lfo.connect(lg).connect(bp.frequency); lfo.start();
      src.connect(bp).connect(this.fanFilter); src.start(0, Math.random() * 9);
    }
    this.fanFilter.connect(this.fanGain).connect(this.ambient);

    // Zumbido eléctrico de aviónica (60/120/180 Hz)
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    for (const f of [60, 120, 180]) {
      const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = f === 120 ? 0.011 : 0.005;
      o.connect(g).connect(this.humGain); o.start();
    }
    this.humGain.connect(this.ambient);

    // Compresor criogénico Stirling suave del laboratorio (−80 °C)
    this.cryoGain = ctx.createGain(); this.cryoGain.gain.value = 0;
    const cryoOsc = ctx.createOscillator(); cryoOsc.type = 'triangle'; cryoOsc.frequency.value = 84;
    const cryoLp = ctx.createBiquadFilter(); cryoLp.type = 'lowpass'; cryoLp.frequency.value = 210;
    cryoOsc.connect(cryoLp).connect(this.cryoGain).connect(this.ambient); cryoOsc.start();

    // Silbido de presurización / despresurización de esclusa
    this.airlockHissGain = ctx.createGain(); this.airlockHissGain.gain.value = 0;
    const hs = ctx.createBufferSource(); hs.buffer = this.noiseBuf; hs.loop = true; hs.playbackRate.value = 2.2;
    const hbp = ctx.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 2200; hbp.Q.value = 1.4;
    hs.connect(hbp).connect(this.airlockHissGain).connect(this.master);
    this.airlockHissGain.connect(this.reverbSend);
    hs.start();

    // Propulsión (vibración estructural amortiguada dentro; amplia en modo cinematográfico)
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 140;
    const es = ctx.createBufferSource(); es.buffer = this.noiseBuf; es.loop = true; es.playbackRate.value = 0.6;
    es.connect(this.engineFilter).connect(this.engineGain).connect(this.master); es.start();

    // Servomotores del brazo robótico (motor brushless dual + zumbido armónico de engranaje)
    this.servoGain = ctx.createGain(); this.servoGain.gain.value = 0;
    this.servoOsc = ctx.createOscillator(); this.servoOsc.type = 'triangle'; this.servoOsc.frequency.value = 145;
    this.servoOsc2 = ctx.createOscillator(); this.servoOsc2.type = 'sine'; this.servoOsc2.frequency.value = 292;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 540; sf.Q.value = 1.8;
    const sMix2 = ctx.createGain(); sMix2.gain.value = 0.45;
    this.servoOsc.connect(sf);
    this.servoOsc2.connect(sMix2).connect(sf);
    sf.connect(this.servoGain).connect(this.master);
    this.servoGain.connect(this.reverbSend);
    this.servoOsc.start();
    this.servoOsc2.start();

    this.servoGearGain = ctx.createGain(); this.servoGearGain.gain.value = 0;
    const sgSrc = ctx.createBufferSource(); sgSrc.buffer = this.noiseBuf; sgSrc.loop = true; sgSrc.playbackRate.value = 1.9;
    const sgBp = ctx.createBiquadFilter(); sgBp.type = 'bandpass'; sgBp.frequency.value = 1150; sgBp.Q.value = 3.2;
    sgSrc.connect(sgBp).connect(this.servoGearGain).connect(this.master); sgSrc.start();

    // Traje EVA: ventilador del PLSS y respiración rítmica amortiguada
    this.suitGain = ctx.createGain(); this.suitGain.gain.value = 0;
    const ss = ctx.createBufferSource(); ss.buffer = this.noiseBuf; ss.loop = true; ss.playbackRate.value = 1.4;
    const sh = ctx.createBiquadFilter(); sh.type = 'highpass'; sh.frequency.value = 1500;
    const br = ctx.createGain(); br.gain.value = 0.5;
    const blfo = ctx.createOscillator(); blfo.frequency.value = 0.22; const bg = ctx.createGain(); bg.gain.value = 0.35;
    blfo.connect(bg).connect(br.gain); blfo.start();
    ss.connect(sh).connect(br).connect(this.suitGain).connect(this.master); ss.start();

    // Ambiente espacial sutil (exclusivo del modo «cinematico» en exterior; 0 absoluto en «realista»)
    this.spaceAmbGain = ctx.createGain(); this.spaceAmbGain.gain.value = 0;
    const spLp = ctx.createBiquadFilter(); spLp.type = 'lowpass'; spLp.frequency.value = 190;
    for (const [freq, amp] of [[55, 0.018], [82.4, 0.011]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(spLp); o.start();
    }
    const spNoise = ctx.createBufferSource(); spNoise.buffer = this.noiseBuf; spNoise.loop = true; spNoise.playbackRate.value = 0.35;
    const spNG = ctx.createGain(); spNG.gain.value = 0.03;
    spNoise.connect(spNG).connect(spLp); spNoise.start();
    spLp.connect(this.spaceAmbGain).connect(this.master);
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  /** Conecta una fuente transitoria al bus seco y, según zona, al bus de reverberación. */
  private route(node: AudioNode, sendReverb = true) {
    node.connect(this.master);
    if (sendReverb && this.reverbSend) node.connect(this.reverbSend);
  }

  /** Comprueba si un sonido físico es audible según modo (realista = silencio estricto en vacío). */
  private canHearExterior(structural: boolean): boolean {
    if (this.inside) return true;
    if (this.mode === 'cinematico') return true;
    // Modo realista fuera de la nave: silencio estricto en vacío (sólo vibración estructural en contacto EVA)
    return this.inSuit && structural;
  }

  update(p: { fans: number; power: number; thrust: number; mech: number; inside: boolean; suit: boolean; zone?: AcousticZone; airlockCycling?: boolean }) {
    this.inside = p.inside; this.inSuit = p.suit;
    const z: AcousticZone = p.zone ?? (p.suit ? 'eva' : p.inside ? 'cockpit' : 'space');
    this.zone = z;
    const pr = ZONE_PROFILE[z];
    const interior = p.inside ? 1 : 0;
    const cinematic = this.mode === 'cinematico';

    // Modo realista: silencio estricto en vacío (!inside && !suit)
    const fanTarget = pr.fan * p.fans * interior;
    const humTarget = pr.hum * p.power * interior;
    const cryoTarget = pr.cryo * p.power * interior;
    const airlockTarget = p.airlockCycling && (p.inside || p.suit || cinematic) ? 0.11 : 0;
    const engTarget = p.thrust * (p.inside ? 0.42 : cinematic ? 0.38 : 0);
    const engLpf = p.inside ? 95 + 115 * p.thrust : 220 + 320 * p.thrust;
    const servoTarget = p.mech * (p.inside ? 0.028 : cinematic ? 0.036 : 0);
    const suitTarget = p.suit ? 0.055 : 0;
    const spaceAmbTarget = !p.inside && !p.suit && cinematic ? 0.45 : 0;
    const reverbTarget = p.inside ? pr.reverb : (!p.suit && cinematic ? 0.18 : 0);

    this.lastTargets = {
      fan: fanTarget, hum: humTarget, cryo: cryoTarget, engine: engTarget,
      servo: servoTarget, suit: suitTarget, spaceAmb: spaceAmbTarget, reverb: reverbTarget,
    };

    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;

    this.fanGain.gain.setTargetAtTime(fanTarget, t, 0.40);
    this.fanFilter.frequency.setTargetAtTime(pr.lpf, t, 0.40);
    this.humGain.gain.setTargetAtTime(humTarget, t, 0.40);
    this.cryoGain.gain.setTargetAtTime(cryoTarget, t, 0.45);
    this.airlockHissGain.gain.setTargetAtTime(airlockTarget, t, 0.25);

    this.engineGain.gain.setTargetAtTime(engTarget, t, 0.14);
    this.engineFilter.frequency.setTargetAtTime(engLpf, t, 0.18);

    this.servoGain.gain.setTargetAtTime(servoTarget, t, 0.08);
    this.servoGearGain.gain.setTargetAtTime(servoTarget * 0.48, t, 0.08);
    this.servoOsc.frequency.setTargetAtTime(138 + 76 * p.mech, t, 0.16);
    this.servoOsc2.frequency.setTargetAtTime(278 + 154 * p.mech, t, 0.16);

    this.suitGain.gain.setTargetAtTime(suitTarget, t, 0.45);
    this.spaceAmbGain.gain.setTargetAtTime(spaceAmbTarget, t, 0.65);
    this.reverbWet.gain.setTargetAtTime(reverbTarget, t, 0.35);
  }

  private env(g: GainNode, a: number, peak: number, dcy: number, t0?: number) {
    const t = t0 ?? this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  /** Clic mecánico de 2 etapas para interruptores con resorte (liberación + encaje de chasis). */
  click(on = true) {
    const c = this.ctx; if (!c || !this.canHearExterior(false)) return;
    const t = c.currentTime;
    // Etapa 1: resistencia / desbloqueo de palanca
    const s1 = c.createBufferSource(); s1.buffer = this.noiseBuf; s1.playbackRate.value = 2.6;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1850; f1.Q.value = 4.5;
    const g1 = c.createGain(); s1.connect(f1).connect(g1); this.route(g1, true);
    this.env(g1, 0.0015, 0.24, 0.018, t); s1.start(t, Math.random() * 5); s1.stop(t + 0.03);
    // Etapa 2: golpe seco de encaje del resorte metálico
    const t2 = t + 0.022;
    const s2 = c.createBufferSource(); s2.buffer = this.noiseBuf; s2.playbackRate.value = 3.2;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = on ? 3400 : 2450; f2.Q.value = 6.5;
    const g2 = c.createGain(); s2.connect(f2).connect(g2); this.route(g2, true);
    this.env(g2, 0.0015, 0.46, 0.042, t2); s2.start(t2, Math.random() * 5); s2.stop(t2 + 0.08);
    // Micro-resonancia de panel de consola
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(on ? 440 : 340, t2);
    o.frequency.exponentialRampToValueAtTime(160, t2 + 0.035);
    const go = c.createGain(); o.connect(go); this.route(go, false);
    this.env(go, 0.002, 0.07, 0.035, t2); o.start(t2); o.stop(t2 + 0.05);
  }

  /**
   * Pisadas y contacto por superficie:
   *  - 'floor': caucho sobre pavimento técnico
   *  - 'ladder': peldaño metálico de escalerilla
   *  - 'push': roce e impulso sobre asidero en microgravedad
   */
  footstep(strength = 0.5, surface: FootstepSurface = 'floor') {
    const c = this.ctx; if (!c || !this.canHearExterior(true)) return;
    const t = c.currentTime;
    const st = Math.max(0.1, Math.min(1.2, strength));
    if (surface === 'push') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1.1 + Math.random() * 0.3;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 820 + Math.random() * 350; f.Q.value = 1.5;
      const g = c.createGain(); s.connect(f).connect(g); this.route(g, true);
      this.env(g, 0.012, 0.14 * st, 0.11, t); s.start(t, Math.random() * 4); s.stop(t + 0.18);
      return;
    }
    if (surface === 'ladder') {
      // Impacto metálico breve con dos armónicos de peldaño
      for (const [freq, amp] of [[820 + Math.random() * 60, 0.085], [1490 + Math.random() * 90, 0.055]] as const) {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 0.86, t + 0.085);
        const g = c.createGain(); o.connect(g); this.route(g, true);
        this.env(g, 0.002, amp * st, 0.085, t); o.start(t); o.stop(t + 0.11);
      }
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 2.0;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 2.4;
      const g2 = c.createGain(); s.connect(f).connect(g2); this.route(g2, true);
      this.env(g2, 0.0015, 0.16 * st, 0.055, t); s.start(t, Math.random() * 4); s.stop(t + 0.10);
      return;
    }
    // 'floor': caucho sobre pavimento
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(112 + Math.random() * 18, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
    const g = c.createGain(); o.connect(g); this.route(g, true);
    this.env(g, 0.003, 0.21 * st, 0.13, t); o.start(t); o.stop(t + 0.22);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.85 + Math.random() * 0.35;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 850 + Math.random() * 420; f.Q.value = 1.2;
    const g2 = c.createGain(); s.connect(f).connect(g2); this.route(g2, true);
    this.env(g2, 0.002, 0.11 * st, 0.065, t); s.start(t, Math.random() * 4); s.stop(t + 0.14);
  }

  /** Sonido táctil sutil al coger (`putDown = false`) o dejar (`putDown = true`) objetos de actividades. */
  pickup(putDown = false) {
    const c = this.ctx; if (!c || !this.canHearExterior(false)) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = putDown ? 1.4 : 2.5;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = putDown ? 1250 : 2450; f.Q.value = 1.8;
    const g = c.createGain(); s.connect(f).connect(g); this.route(g, true);
    this.env(g, 0.004, putDown ? 0.13 : 0.16, putDown ? 0.07 : 0.05, t);
    s.start(t, Math.random() * 4); s.stop(t + 0.12);

    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(putDown ? 170 : 480, t);
    o.frequency.exponentialRampToValueAtTime(putDown ? 92 : 660, t + 0.055);
    const go = c.createGain(); o.connect(go); this.route(go, true);
    this.env(go, 0.003, 0.08, 0.055, t); o.start(t); o.stop(t + 0.08);
  }

  /** Secuencia mecánica de cerrojos de acoplamiento IDSS (contacto suave + retracción + doble cerrojo duro). */
  dockLock() {
    const c = this.ctx; if (!c || !this.canHearExterior(true)) return;
    const t = c.currentTime;
    const muffled = this.inside && this.mode === 'realista';
    // 1. Contacto de captura suave (soft capture)
    const o0 = c.createOscillator(); o0.type = 'sine';
    o0.frequency.setValueAtTime(80, t); o0.frequency.exponentialRampToValueAtTime(34, t + 0.34);
    const g0 = c.createGain(); o0.connect(g0); this.route(g0, true);
    this.env(g0, 0.006, 0.48, 0.38, t); o0.start(t); o0.stop(t + 0.45);
    // 2. Retracción electromecánica de actuadores del anillo IDSS
    const t1 = t + 0.28;
    const m = c.createOscillator(); m.type = 'triangle';
    m.frequency.setValueAtTime(175, t1); m.frequency.linearRampToValueAtTime(285, t1 + 0.36);
    const ml = c.createBiquadFilter(); ml.type = 'lowpass'; ml.frequency.value = muffled ? 650 : 1400;
    const gm = c.createGain(); m.connect(ml).connect(gm); this.route(gm, true);
    this.env(gm, 0.03, 0.085, 0.38, t1); m.start(t1); m.stop(t1 + 0.44);
    // 3. Dos golpes secuenciales de cierre de los 12 ganchos estructurales (hard dock latches)
    for (const off of [0.72, 0.96]) {
      const tl = t + off;
      const cl = c.createBufferSource(); cl.buffer = this.noiseBuf; cl.playbackRate.value = 2.4;
      const cf = c.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = muffled ? 720 : 1550; cf.Q.value = 3.2;
      const gc = c.createGain(); cl.connect(cf).connect(gc); this.route(gc, true);
      this.env(gc, 0.002, 0.36, 0.09, tl); cl.start(tl, Math.random() * 4); cl.stop(tl + 0.14);

      const ob = c.createOscillator(); ob.type = 'sine';
      ob.frequency.setValueAtTime(135, tl); ob.frequency.exponentialRampToValueAtTime(52, tl + 0.14);
      const gb = c.createGain(); ob.connect(gb); this.route(gb, true);
      this.env(gb, 0.003, 0.28, 0.16, tl); ob.start(tl); ob.stop(tl + 0.20);
    }
  }

  activity(kind: 'water' | 'heat' | 'exercise' | 'zip' | 'wipe', dur = 1) {
    const c = this.ctx; if (!c || !this.canHearExterior(false)) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter();
    const cfg = { water: ['bandpass', 1800, 2, 0.08, 1.6], heat: ['lowpass', 400, 0.7, 0.06, 0.5], exercise: ['bandpass', 300, 3, 0.07, 0.9], zip: ['highpass', 2500, 0.8, 0.1, 2.5], wipe: ['bandpass', 3000, 1, 0.05, 1.2] } as const;
    const [type, fr, q, vol, rate] = cfg[kind];
    f.type = type; f.frequency.value = fr; f.Q.value = q; s.playbackRate.value = rate;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.setValueAtTime(vol, t + Math.max(0.1, dur - 0.15)); g.gain.linearRampToValueAtTime(0, t + dur);
    if (kind === 'exercise') { const lfo = c.createOscillator(); lfo.frequency.value = 1.4; const lg = c.createGain(); lg.gain.value = vol * 0.8; lfo.connect(lg).connect(g.gain); lfo.start(t); lfo.stop(t + dur); }
    s.connect(f).connect(g); this.route(g, true);
    s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
  }

  thud(strength = 1) {
    const c = this.ctx; if (!c || !this.canHearExterior(true)) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const g = c.createGain(); o.connect(g); this.route(g, true);
    this.env(g, 0.005, 0.5 * strength, 0.45, t); o.start(t); o.stop(t + 0.6);
  }

  /** Avisos de aviónica diferenciados: Master Warning ('alarm'), Master Caution ('warn'), 'ok' e 'info'. */
  beep(kind: 'ok' | 'warn' | 'alarm' | 'info' = 'info') {
    const c = this.ctx; if (!c) return;
    // Avisos electrónicos se oyen en cabina, en el casco EVA o en modo cinematográfico (silencio en cámara exterior realista)
    if (!this.inside && !this.inSuit && this.mode === 'realista') return;
    const seq = kind === 'ok'
      ? [880, 1320]
      : kind === 'warn'
        ? [660, 495]
        : kind === 'alarm'
          ? [960, 740, 960, 740]
          : [1046];
    const step = kind === 'alarm' ? 0.14 : 0.125;
    seq.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = kind === 'alarm' ? 'sawtooth' : kind === 'warn' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'alarm' ? 2300 : 2800;
      o.connect(lp).connect(g); this.route(g, this.inside);
      const t0 = c.currentTime + i * step;
      const peak = kind === 'alarm' ? 0.075 : kind === 'warn' ? 0.10 : 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 0.85);
      o.start(t0); o.stop(t0 + step);
    });
  }

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
    // Modo realista: silencio estricto en vacío exterior; dentro de cabina sólo vibración estructural grave amortiguada
    if (!this.inside && this.mode === 'realista') return;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = this.inside ? 1.1 : 1.9;
    const f = c.createBiquadFilter();
    f.type = this.inside ? 'lowpass' : 'bandpass';
    f.frequency.value = this.inside ? 155 : 1450;
    const g = c.createGain(); s.connect(f).connect(g).connect(this.master);
    this.env(g, 0.005, this.inside ? 0.22 : 0.09, 0.12);
    s.start(0, Math.random() * 5); s.stop(c.currentTime + 0.2);
  }

  hatch(open: boolean) {
    if (!this.canHearExterior(true)) return;
    this.thud(0.8);
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(open ? 300 : 500, t); o.frequency.linearRampToValueAtTime(open ? 520 : 280, t + 0.6);
    const g = c.createGain(); o.connect(g); this.route(g, true);
    this.env(g, 0.05, 0.032, 0.6, t); o.start(t); o.stop(t + 0.8);
  }

  pulse() {
    const c = this.ctx; if (!c || !this.canHearExterior(false)) return;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1800, c.currentTime); o.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.25);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    const g = c.createGain(); o.connect(f).connect(g).connect(this.master); this.env(g, 0.003, 0.07, 0.25); o.start(); o.stop(c.currentTime + 0.3);
  }

  burst() {
    const c = this.ctx; if (!c || !this.canHearExterior(false)) return;
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
