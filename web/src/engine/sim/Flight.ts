/**
 * Dinámica de vuelo de 6 grados de libertad, inspirada en la mecánica
 * newtoniana y simplificada como abstracción de videojuego (no es un sistema
 * de guiado real). Integración con paso fijo (120 Hz) separada del renderizado;
 * el renderizado interpola entre los dos últimos estados.
 */
import * as THREE from 'three';
import { clamp } from '../util';

export interface FlightInput {
  t: THREE.Vector3;   // traslación deseada (-1..1) en ejes de nave: x proa, y arriba, z estribor
  r: THREE.Vector3;   // rotación deseada (-1..1): x alabeo, y guiñada, z cabeceo
  throttle: number;   // 0..1 motores principales
  brake: boolean;
}

export interface BodyState { pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; w: THREE.Vector3; }

export const STEP = 1 / 120;

export class Flight {
  state: BodyState = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3() };
  prev: BodyState = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3() };
  assist = true;
  /** 1 = valores físicos aproximados; >1 = escala arcade */
  thrustScale = 10;
  massKg = 26000;
  rcsAccel = 0.012;      // m/s² por eje (física aproximada: 4 propulsores ×150 N / 26 t ≈ 0,02)
  rotAccel = 0.010;      // rad/s²
  mainAccel = 0.069;     // m/s² a pleno empuje (4 × 450 N / 26 t)
  rcsArmed = true;
  mainArmed = true;
  docked: string | null = null;
  throttle = 0;
  rcsActivity = 0;
  /** propulsores RCS que disparan en este paso (para efectos visuales) */
  rcsFiring = new THREE.Vector3();
  rotFiring = new THREE.Vector3();
  /** reloj físico determinista de vuelo en segundos (paso fijo STEP = 1/120 s) */
  simSeconds = 0;
  private acc = 0;
  input: FlightInput = { t: new THREE.Vector3(), r: new THREE.Vector3(), throttle: 0, brake: false };

  /** Avanza la simulación con paso fijo. Devuelve alpha de interpolación. */
  advance(dt: number) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 24) {
      this.copyState(this.prev, this.state);
      this.step(STEP);
      this.simSeconds += STEP;
      this.acc -= STEP; n++;
    }
    return this.acc / STEP;
  }

  private copyState(d: BodyState, s: BodyState) { d.pos.copy(s.pos); d.vel.copy(s.vel); d.q.copy(s.q); d.w.copy(s.w); }

  private step(h: number) {
    const s = this.state;
    const inp = this.input;
    if (this.docked) { s.vel.set(0, 0, 0); s.w.set(0, 0, 0); this.rcsActivity = 0; this.rcsFiring.set(0, 0, 0); this.rotFiring.set(0, 0, 0); return; }
    const k = this.thrustScale;
    // ---- rotación (cuerpo)
    const rotCmd = inp.r.clone();
    if (!this.rcsArmed) rotCmd.set(0, 0, 0);
    if (this.assist) {
      // estabilización de actitud: amortigua la velocidad angular en los ejes sin mando
      for (const ax of ['x', 'y', 'z'] as const) {
        if (Math.abs(rotCmd[ax]) < 0.05 && this.rcsArmed) rotCmd[ax] = clamp(-s.w[ax] / (this.rotAccel * k * 0.5), -1, 1);
      }
    }
    this.rotFiring.copy(rotCmd);
    s.w.addScaledVector(rotCmd, this.rotAccel * k * h);
    const maxW = 0.45;
    s.w.clampLength(0, maxW);
    // integración de la orientación: q' = q ⊗ exp(w h / 2)
    const wl = s.w.length();
    if (wl > 1e-9) {
      const dq = new THREE.Quaternion().setFromAxisAngle(s.w.clone().divideScalar(wl), wl * h);
      s.q.multiply(dq).normalize();
    }
    // ---- traslación
    const tCmd = inp.t.clone();
    if (!this.rcsArmed) tCmd.set(0, 0, 0);
    const local = s.vel.clone().applyQuaternion(s.q.clone().invert());
    if (inp.brake && this.rcsArmed) {
      for (const ax of ['x', 'y', 'z'] as const) tCmd[ax] = clamp(-local[ax] / (this.rcsAccel * k * 0.6), -1, 1);
    } else if (this.assist) {
      // asistencia: frena la deriva lateral suavemente cuando no hay mando en ese eje
      for (const ax of ['y', 'z'] as const) if (Math.abs(tCmd[ax]) < 0.05 && this.rcsArmed) tCmd[ax] = clamp(-local[ax] / (this.rcsAccel * k * 2.5), -0.4, 0.4);
    }
    this.rcsFiring.copy(tCmd);
    const accLocal = tCmd.multiplyScalar(this.rcsAccel * k);
    this.throttle = this.mainArmed ? inp.throttle : 0;
    accLocal.x += this.mainAccel * k * this.throttle;
    s.vel.addScaledVector(accLocal.applyQuaternion(s.q), h);
    s.pos.addScaledVector(s.vel, h);
    this.rcsActivity = Math.min(1, this.rcsFiring.length() + this.rotFiring.length());
  }

  /** Estado interpolado para el renderizado. */
  interp(alpha: number, out: BodyState) {
    out.pos.lerpVectors(this.prev.pos, this.state.pos, alpha);
    out.q.slerpQuaternions(this.prev.q, this.state.q, alpha);
    out.vel.copy(this.state.vel);
    out.w.copy(this.state.w);
    return out;
  }

  teleport(pos: THREE.Vector3, q?: THREE.Quaternion) {
    this.state.pos.copy(pos); this.state.vel.set(0, 0, 0); this.state.w.set(0, 0, 0);
    if (q) this.state.q.copy(q);
    this.copyState(this.prev, this.state);
  }

  /**
   * Telemetría orbital kepleriana educativa (derivada de la órbita de referencia y del
   * Δv acumulado relativo de la nave; no es un propagador de vuelo real).
   */
  computeOrbit(body: 'Tierra' | 'Luna', altKm: number) {
    const mu = body === 'Luna' ? 4902.8 : 398600.4418; // km³/s²
    const R = body === 'Luna' ? 1737.4 : 6371.0;
    const r = R + Math.max(10, altKm);
    const vCirc = Math.sqrt(mu / r); // km/s
    // Componente progrado aproximado (+X local)
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.state.q);
    const dvProKmS = this.state.vel.dot(fwd) / 1000;
    const v = Math.max(0.2, vCirc + dvProKmS);
    const invA = 2 / r - (v * v) / mu;
    const a = invA > 1e-6 ? 1 / invA : r * 2;
    const periodMin = (2 * Math.PI * Math.sqrt(Math.pow(Math.max(r, a), 3) / mu)) / 60;
    const e = clamp(Math.abs(1 - r / Math.max(r * 0.5, a)), 0, 0.35);
    const apogeeKm = Math.max(0, a * (1 + e) - R);
    const perigeeKm = Math.max(0, a * (1 - e) - R);
    const inclinationDeg = body === 'Luna' ? 89.2 : 51.6;
    return { vOrbKmS: v, periodMin, apogeeKm, perigeeKm, inclinationDeg };
  }

  serialize() {
    const s = this.state;
    return { pos: s.pos.toArray(), vel: s.vel.toArray(), q: s.q.toArray(), w: s.w.toArray(), assist: this.assist, thrustScale: this.thrustScale };
  }
  deserialize(o: any) {
    if (!o) return;
    this.state.pos.fromArray(o.pos); this.state.vel.fromArray(o.vel); this.state.q.fromArray(o.q); this.state.w.fromArray(o.w);
    this.assist = o.assist; this.thrustScale = o.thrustScale ?? this.thrustScale;
    this.copyState(this.prev, this.state);
  }
}
