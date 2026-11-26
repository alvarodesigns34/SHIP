/**
 * ALCIÓN HX-4 · REBIRTH — controlador en primera persona.
 *
 * - Posición del ojo en espacio de NAVE (three, metros): el tripulante viaja con la nave.
 * - Colisión contra la rejilla de vóxeles del interior real (no cajas envolventes ni excepciones
 *   por código): cápsula de esferas (rodillas, torso, cabeza). La cabeza mantiene ≥ 0,16 m a
 *   cualquier superficie: la cámara no puede atravesar paredes ni mobiliario.
 * - "Caminar" es una licencia de juego (gravedad de entrenamiento 1 g): aceleración y frenado
 *   suaves, subida automática de escalones ≤ 0,36 m, agacharse automático bajo techos bajos,
 *   escalerillas en el pozo de la cúpula y de la esclusa.
 * - "Flotar" es microgravedad: inercia, empuje con amortiguación (manos y pies) y rebote blando.
 * - Subpasos de ≤ 3 cm: sin efecto túnel aunque el frame dure 100 ms.
 */
import * as THREE from 'three';
import type { VoxelGrid } from '../interior/Interior';
import { clamp, damp } from '../util';

const EYE_STAND = 1.66;
const EYE_CROUCH = 1.02;
const STEP = 0.36;
const G = 9.81;
const R_BODY = 0.21;
const R_HEAD = 0.16;
const MAX_ROLL = THREE.MathUtils.degToRad(2.0);
const LOOK_DAMP = 28;

/** Zonas de escalerilla en espacio nave three (x, z=-yBlender, y=zBlender). */
const LADDERS = [
  { id: 'cupula', x: 11.05, z: 0, r: 0.6, y0: 0.2, y1: 2.2 },
  { id: 'esclusa', x: 11.05, z: 0, r: 0.62, y0: -3.45, y1: -0.45 },
];

export type Locomotion = 'walk' | 'float';
export type StepSurface = 'floor' | 'ladder' | 'push';

export class Controller {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  private _yaw = 0;
  private _pitch = 0;
  yawTarget = 0;
  pitchTarget = 0;
  /** Inclinación lateral sutil de cámara al girar o caminar lateralmente (rad, máx ±2,0°). */
  camRoll = 0;
  locomotion: Locomotion = 'walk';
  eyeH = EYE_STAND;
  crouch = false;
  crouchToggle = false;
  onGround = false;
  climbing = false;
  /** Verdadero en microgravedad cuando hay una superficie o asidero al alcance (< 0,88 m). */
  nearSurface = false;
  noclip = false;
  reducedMotion = false;
  stride = 0;
  bob = new THREE.Vector3();
  onStep: ((strength: number, surface: StepSurface) => void) | null = null;
  grid: VoxelGrid | null = null;
  /** bits de ocupación que bloquean (estructura + escotillas cerradas) */
  mask = 1;
  /** suavizado del escalón (la cámara no salta al subir) */
  private stepOffset = 0;
  private ladderStride = 0;
  private pushCooldown = 0;
  private pushKick = 0;
  private nearPt = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** aceleraciones/velocidades configurables (accesibilidad) */
  speed = { walk: 1.35, run: 2.3, crouch: 0.75, float: 1.4 };

  /** La asignación directa sincroniza objetivo y valor actual al instante (tests y cámaras fijas). */
  get yaw() { return this._yaw; }
  set yaw(v: number) { this._yaw = v; this.yawTarget = v; }
  get pitch() { return this._pitch; }
  set pitch(v: number) { this._pitch = v; this.pitchTarget = v; }

  viewQuat(out = new THREE.Quaternion(), withRoll = true) {
    const r = withRoll && !this.reducedMotion ? this.camRoll : 0;
    return out.setFromEuler(new THREE.Euler(this._pitch, this._yaw, r, 'YXZ'));
  }

  look(dx: number, dy: number) {
    this.yawTarget -= dx;
    this.pitchTarget = clamp(this.pitchTarget - dy, -1.52, 1.52);
  }

  /** Amortiguación rápida de la vista (~28 rad/s) e inclinación lateral (roll) al girar/desplazarse. */
  stepLook(dt: number, reduced = this.reducedMotion, seated = false) {
    this.reducedMotion = reduced;
    if (reduced || dt <= 0) {
      this._yaw = this.yawTarget;
      this._pitch = this.pitchTarget;
      this.camRoll = 0;
      return;
    }
    const prevYaw = this._yaw;
    this._yaw = damp(this._yaw, this.yawTarget, LOOK_DAMP, dt);
    this._pitch = damp(this._pitch, this.pitchTarget, LOOK_DAMP, dt);
    if (Math.abs(this.yawTarget - this._yaw) < 1e-5) this._yaw = this.yawTarget;
    if (Math.abs(this.pitchTarget - this._pitch) < 1e-5) this._pitch = this.pitchTarget;

    if (seated) {
      this.camRoll = damp(this.camRoll, 0, 14, dt);
      return;
    }
    const yawRate = (this._yaw - prevYaw) / Math.max(dt, 1e-4);
    const sinY = Math.sin(this._yaw), cosY = Math.cos(this._yaw);
    const vRight = this.vel.x * cosY - this.vel.z * sinY;
    const strafeRoll = -clamp(vRight / 2.2, -1, 1) * 0.022;
    const turnRoll = clamp(yawRate * 0.009, -0.016, 0.016);
    const climbRoll = this.climbing
      ? Math.sin(this.ladderStride * Math.PI) * 0.012 * clamp(Math.abs(this.vel.y) / 0.85, 0, 1)
      : 0;
    const targetRoll = clamp(strafeRoll + turnRoll + climbRoll, -MAX_ROLL, MAX_ROLL);
    this.camRoll = damp(this.camRoll, targetRoll, 10, dt);
  }

  ladder(p = this.pos) {
    for (const l of LADDERS) if (Math.hypot(p.x - l.x, p.z - l.z) < l.r && p.y > l.y0 && p.y < l.y1 + 0.3) return l;
    return null;
  }

  private solidAt(x: number, y: number, z: number) {
    const g = this.grid!;
    return (g.get(Math.floor((x - g.min.x) / g.s), Math.floor((y - g.min.y) / g.s), Math.floor((z - g.min.z) / g.s)) & this.mask) !== 0;
  }

  /** Superficie de apoyo más alta bajo los pies (en un disco de radio 0,1 m), entre y−0,5 y y+STEP. */
  groundAt(x: number, y: number, z: number, up = STEP) {
    const g = this.grid!;
    const s = g.s;
    let best = -Infinity;
    const j1 = Math.floor((y + up - g.min.y) / s), j0 = Math.floor((y - 0.6 - g.min.y) / s);
    for (const [ox, oz] of [[0, 0], [0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]]) {
      const i = Math.floor((x + ox - g.min.x) / s), k = Math.floor((z + oz - g.min.z) / s);
      for (let j = j1; j >= j0; j--) {
        if ((g.get(i, j, k) & this.mask) && !(g.get(i, j + 1, k) & this.mask)) { best = Math.max(best, g.min.y + (j + 1) * s); break; }
      }
    }
    return best;
  }

  /** Altura libre sobre los pies. */
  clearance(x: number, feetY: number, z: number) {
    const g = this.grid!;
    // sólo cuenta como techo lo que está por encima de la altura de escalón (los escalones vecinos no son techo)
    for (let h = STEP + 0.06; h < 2.4; h += g.s) {
      if (this.solidAt(x, feetY + h, z)) return h;
      if (h > 0.9 && (this.solidAt(x + 0.1, feetY + h, z) || this.solidAt(x - 0.1, feetY + h, z) || this.solidAt(x, feetY + h, z + 0.1) || this.solidAt(x, feetY + h, z - 0.1))) return h;
    }
    return 2.4;
  }

  /** Empuja una esfera fuera de la geometría; devuelve la normal media de contacto. */
  private pushSphere(c: THREE.Vector3, r: number, horizontal: boolean, nOut: THREE.Vector3) {
    const g = this.grid!;
    nOut.set(0, 0, 0);
    for (let it = 0; it < 4; it++) {
      const d = g.nearest(c, r, this.tmp, this.mask);
      if (!Number.isFinite(d)) break;
      const n = this.tmp2.copy(c).sub(this.tmp);
      if (horizontal) n.y = 0;
      let len = n.length();
      if (len < 1e-5) { n.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw)).negate(); len = 1; }
      n.divideScalar(len);
      const pen = r - d + 1e-4;
      c.addScaledVector(n, pen);
      nOut.add(n);
    }
    return nOut.lengthSq() > 0 ? nOut.normalize() : nOut;
  }

  /** move: x lateral, y vertical, z (−adelante) en ejes de vista. */
  step(dt: number, move: THREE.Vector3, opts: { run?: boolean; crouch?: boolean; up?: boolean; jump?: boolean }) {
    if (!this.grid || this.noclip) { this.pos.addScaledVector(move, dt * 2); return; }
    if (this.locomotion === 'float') this.floatStep(dt, move, opts);
    else this.walkStep(dt, move, opts);
  }

  private floatStep(dt: number, move: THREE.Vector3, opts: { run?: boolean; up?: boolean; crouch?: boolean }) {
    this.pushCooldown = Math.max(0, this.pushCooldown - dt);
    const dSurf = this.grid!.nearest(this.pos, 0.90, this.nearPt, this.mask);
    this.nearSurface = Number.isFinite(dSurf) && dSurf < 0.88;

    const want = move.clone();
    if (opts.up) want.y += 1;
    if (opts.crouch) want.y -= 1;
    want.applyQuaternion(this.viewQuat(undefined, false));
    const wantLen = want.length();
    if (wantLen > 1) want.divideScalar(wantLen);
    const vmax = this.speed.float * (opts.run ? 1.6 : 1);

    if (want.lengthSq() > 0.001) {
      const wantDir = this.tmp2.copy(want).normalize();
      const along = this.vel.dot(wantDir);
      // Impulso inicial táctil desde superficies y asideros cercanos (< 0,88 m)
      if (this.nearSurface && this.pushCooldown <= 0 && want.lengthSq() > 0.04 && along < 0.55) {
        this.vel.addScaledVector(wantDir, 0.52);
        if (this.vel.length() > vmax) this.vel.setLength(vmax);
        this.pushCooldown = 0.6;
        this.pushKick = 0.016;
        this.onStep?.(0.35, 'push');
      }
      // Empuje más firme junto a superficies/asideros; suave y controlado en espacio libre
      const rate = this.nearSurface ? 2.9 : 1.9;
      this.vel.lerp(want.multiplyScalar(vmax), 1 - Math.exp(-dt * rate));
    } else {
      this.vel.multiplyScalar(Math.exp(-dt * 0.9));
    }

    const n = Math.max(1, Math.ceil(this.vel.length() * dt / 0.03));
    const h = dt / n;
    const nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.pos.addScaledVector(this.vel, h);
      const c = this.pos.clone();
      this.pushSphere(c, R_BODY, false, nrm);
      if (nrm.lengthSq() > 0) {
        const vn = this.vel.dot(nrm);
        if (vn < 0) this.vel.addScaledVector(nrm, -vn * 1.25);
        this.pos.copy(c);
      }
    }
    this.pushKick = damp(this.pushKick, 0, 11, dt);
    if (this.reducedMotion) this.bob.set(0, 0, 0);
    else this.bob.set(0, -this.pushKick, 0);
    this.eyeH = EYE_STAND; this.onGround = false; this.climbing = false;
  }

  private walkStep(dt: number, move: THREE.Vector3, opts: { run?: boolean; crouch?: boolean; up?: boolean; jump?: boolean }) {
    this.nearSurface = false;
    // pies por debajo de una superficie (teletransporte, cambio de modo): recolocarlos encima
    if (!this.ladder()) {
      const f0 = this.pos.y - this.eyeH;
      const gUp = this.groundAt(this.pos.x, f0 + 0.02, this.pos.z, 0.45);
      if (gUp > f0 + 0.004) { this.pos.y += gUp - f0; if (this.vel.y < 0) this.vel.y = 0; }
    }
    const feet = this.pos.y - this.eyeH;
    const lad = this.ladder(new THREE.Vector3(this.pos.x, feet + 0.4, this.pos.z)) ?? this.ladder(this.pos);
    const sinY = Math.sin(this._yaw), cosY = Math.cos(this._yaw);
    // dirección horizontal deseada según la orientación (sin cabeceo)
    const wx = move.x * cosY + move.z * sinY;
    const wz = -move.x * sinY + move.z * cosY;
    const wl = Math.hypot(wx, wz);
    const wantCrouch = opts.crouch || this.crouchToggle;
    // --- escalerilla fluida con centrado lateral, ritmo de peldaños y salida limpia arriba/abajo
    const groundHere = this.groundAt(this.pos.x, feet + 0.05, this.pos.z, 0.1);
    let vert = (opts.up ? 1 : 0) - (wantCrouch ? 1 : 0);
    if (vert === 0 && Math.abs(move.z) > 0.1 && Math.abs(this._pitch) > 0.4) vert = -Math.sign(move.z) * Math.sign(this._pitch);
    const nearDeck = Number.isFinite(groundHere) && Math.abs(feet - groundHere) <= 0.09;
    const wantExitLadder = nearDeck && Math.abs(vert) < 0.05 && wl > 0.15;
    this.climbing = !!lad && !wantExitLadder && (!nearDeck || opts.up || (wantCrouch && lad.id === 'esclusa'));
    if (this.climbing && lad) {
      // centrado lateral suave hacia el eje de la escalerilla cuando se sube o baja sin empujar hacia afuera
      let tx = wx * 0.78, tz = wz * 0.78;
      if (Math.abs(vert) > 0.05 && wl < 0.25) {
        tx += clamp((lad.x - this.pos.x) * 4.5, -0.45, 0.45);
        tz += clamp((lad.z - this.pos.z) * 4.5, -0.45, 0.45);
      }
      this.vel.x = damp(this.vel.x, tx, 12, dt);
      this.vel.y = damp(this.vel.y, vert * 0.90, 12, dt);
      this.vel.z = damp(this.vel.z, tz, 12, dt);
    } else {
      const sp = wantCrouch || this.crouch ? this.speed.crouch : opts.run ? this.speed.run : this.speed.walk;
      const tx = wl > 1 ? wx / wl * sp : wx * sp, tz = wl > 1 ? wz / wl * sp : wz * sp;
      // aceleración 7 m/s² aprox.; frenado algo más rápido para sentir peso pero no inercia de patinaje
      const k = this.onGround ? (wl > 0.05 ? 7.5 : 10) : 1.2;
      this.vel.x = damp(this.vel.x, tx, k, dt);
      this.vel.z = damp(this.vel.z, tz, k, dt);
      this.vel.y -= G * dt;
      if (opts.jump && this.onGround && !this.crouch) { this.vel.y = 2.4; this.onGround = false; }
    }
    // --- integración con subpasos
    const n = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.y, this.vel.z) * dt / 0.03));
    const h = dt / n;
    let footY = feet;
    const nrm = new THREE.Vector3();
    const c = new THREE.Vector3();
    let landed = false;
    for (let i = 0; i < n; i++) {
      const nx = this.pos.x + this.vel.x * h, nz = this.pos.z + this.vel.z * h;
      // escalón: si delante hay una superficie más alta pero ≤ STEP, subir
      let base = footY;
      if (!this.climbing && this.onGround) {
        const gN = this.groundAt(nx, footY + 0.02, nz);
        if (gN > footY + 0.015 && gN <= footY + STEP) base = gN;
      }
      // cuerpo: torso y rodillas (por encima del escalón) contra paredes, sólo horizontal
      c.set(nx, base + Math.min(1.05, this.eyeH - 0.35), nz);
      this.pushSphere(c, R_BODY, true, nrm);
      const k2 = c.clone().setY(base + STEP + R_BODY * 0.9 + 0.03);
      const nrm2 = new THREE.Vector3();
      this.pushSphere(k2, R_BODY * 0.9, true, nrm2);
      let px = c.x + (k2.x - nx), pz = c.z + (k2.z - nz);
      for (const nn of [nrm, nrm2]) if (nn.lengthSq() > 0) { const vn = this.vel.x * nn.x + this.vel.z * nn.z; if (vn < 0) { this.vel.x -= vn * nn.x; this.vel.z -= vn * nn.z; } }
      // ¿cabe de pie o agachado en la nueva posición?
      const room = this.clearance(px, base, pz);
      if (room < 0.78) { px = this.pos.x; pz = this.pos.z; this.vel.x = this.vel.z = 0; base = footY; }
      if (base > footY) { this.stepOffset -= base - footY; footY = base; }
      this.pos.x = px; this.pos.z = pz;
      // vertical
      footY += this.vel.y * h;
      const g = this.groundAt(this.pos.x, Math.max(footY, base) + 0.02, this.pos.z, 0.05);
      if (footY <= g + 1e-3 && !this.climbing) {
        if (!this.onGround && this.vel.y < -1.4) this.onStep?.(Math.min(1, -this.vel.y / 5), 'floor');
        footY = g; if (this.vel.y < 0) this.vel.y = 0; landed = true;
      }
      if (this.climbing) {
        // dentro del pozo: nunca por debajo del suelo de la esclusa ni por encima de la cúpula
        if (footY < g) { footY = g; if (this.vel.y < 0) this.vel.y = 0; }
      }
    }
    this.onGround = landed || (!this.climbing && footY - this.groundAt(this.pos.x, footY + 0.02, this.pos.z, 0.05) < 0.03);
    // --- altura de ojos: agacharse voluntario, forzado por el techo o anticipado (escotillas por delante)
    let room = this.clearance(this.pos.x, footY, this.pos.z);
    if (wl > 0.05 && !this.climbing) {
      for (const ahead of [0.3, 0.55]) {
        const ax = this.pos.x + (wx / wl) * ahead, az = this.pos.z + (wz / wl) * ahead;
        const ga = this.groundAt(ax, footY + 0.02, az);
        const fa = ga > footY && ga <= footY + STEP ? ga : footY;
        const ra = this.clearance(ax, fa, az) + (fa - footY);
        if (ra > EYE_CROUCH - 0.35) room = Math.min(room, ra);
      }
    }
    const target = Math.min(wantCrouch && !this.climbing ? EYE_CROUCH : EYE_STAND, room - 0.14);
    this.eyeH = damp(this.eyeH, Math.max(0.6, target), 9, dt);
    if (this.eyeH > room - 0.12) this.eyeH = Math.max(0.6, room - 0.12);
    this.crouch = this.eyeH < EYE_STAND - 0.12;
    this.pos.y = footY + this.eyeH;
    // cabeza: margen garantizado a toda superficie (también al inclinarse en espacios estrechos)
    const head = this.pos.clone();
    this.pushSphere(head, R_HEAD, false, nrm);
    if (head.distanceToSquared(this.pos) > 0) { this.pos.x = head.x; this.pos.z = head.z; if (head.y < this.pos.y) { this.eyeH -= this.pos.y - head.y; this.pos.y = head.y; } }
    this.stepOffset = damp(this.stepOffset, 0, 10, dt);

    // balanceo de cabeza orgánico y pasos sincronizados en el valle de cada zancada
    if (this.climbing) {
      const vs = Math.abs(this.vel.y);
      if (vs > 0.15) {
        const prevL = this.ladderStride;
        this.ladderStride += vs * dt * 2.85; // ~0,35 m por peldaño
        if (Math.floor(prevL) !== Math.floor(this.ladderStride)) this.onStep?.(0.55, 'ladder');
      }
      if (this.reducedMotion) {
        this.bob.set(0, 0, 0);
      } else {
        const camp = clamp(vs / 0.85, 0, 1);
        this.bob.set(
          Math.sin(this.ladderStride * Math.PI) * 0.010 * camp,
          Math.cos(this.ladderStride * 2 * Math.PI) * 0.007 * camp + this.stepOffset,
          0,
        );
      }
    } else {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && hs > 0.25) {
        const prev = this.stride;
        this.stride += hs * dt * 1.72;
        // Valle de zancada en semienteros (0,5, 1,5, 2,5...): coincide con el mínimo de -sin²(π·stride)
        if (Math.floor(prev + 0.5) !== Math.floor(this.stride + 0.5)) {
          this.onStep?.(clamp(hs / 2.3, 0.25, 0.8), 'floor');
        }
      }
      if (this.reducedMotion) {
        this.bob.set(0, 0, 0);
      } else {
        const amp = this.onGround ? clamp(hs / 1.35, 0, 1.35) : 0;
        const s = Math.sin(this.stride * Math.PI);
        this.bob.set(
          Math.cos(this.stride * Math.PI) * 0.008 * amp,
          -(s * s) * 0.017 * amp + this.stepOffset,
          0,
        );
      }
    }
  }

  /** Coloca al tripulante de pie sobre el suelo bajo `eye` (sin teletransportes dentro de paredes). */
  settle() {
    this.vel.set(0, 0, 0);
    if (!this.grid || this.locomotion !== 'walk') return;
    if (this.ladder()) { this.climbing = true; return; }
    const g = this.groundAt(this.pos.x, this.pos.y - 1.3, this.pos.z, 1.2);
    if (Number.isFinite(g)) {
      const room = this.clearance(this.pos.x, g, this.pos.z);
      this.eyeH = Math.min(EYE_STAND, room - 0.14);
      this.pos.y = g + this.eyeH;
      this.onGround = true;
    }
    const nrm = new THREE.Vector3();
    const head = this.pos.clone();
    this.pushSphere(head, R_HEAD, false, nrm);
    if (head.distanceToSquared(this.pos) > 0) this.pos.copy(head);
  }

  /** ¿Punto libre (para puntos de aparición y validación)? */
  free(p: THREE.Vector3, r = R_HEAD) { return !this.grid || !Number.isFinite(this.grid.nearest(p, r, this.tmp, this.mask)); }

  serialize() { return { pos: this.pos.toArray(), yaw: this._yaw, pitch: this._pitch, loco: this.locomotion }; }
  deserialize(o: any) { if (!o?.pos) return; this.pos.fromArray(o.pos); this.yaw = o.yaw ?? 0; this.pitch = o.pitch ?? 0; if (o.loco === 'walk' || o.loco === 'float') this.locomotion = o.loco; }
}
