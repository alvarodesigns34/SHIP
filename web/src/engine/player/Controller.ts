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

/** Zonas de escalerilla en espacio nave three (x, z=-yBlender, y=zBlender). */
const LADDERS = [
  { id: 'cupula', x: 11.05, z: 0, r: 0.6, y0: 0.2, y1: 2.2 },
  { id: 'esclusa', x: 11.05, z: 0, r: 0.62, y0: -3.45, y1: -0.45 },
];

export type Locomotion = 'walk' | 'float';

export class Controller {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0; pitch = 0;
  locomotion: Locomotion = 'walk';
  eyeH = EYE_STAND;
  crouch = false;
  crouchToggle = false;
  onGround = false;
  climbing = false;
  noclip = false;
  stride = 0;
  bob = new THREE.Vector3();
  onStep: ((k: number) => void) | null = null;
  grid: VoxelGrid | null = null;
  /** suavizado del escalón (la cámara no salta al subir) */
  private stepOffset = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** aceleraciones/velocidades configurables (accesibilidad) */
  speed = { walk: 1.35, run: 2.3, crouch: 0.75, float: 1.4 };

  viewQuat(out = new THREE.Quaternion()) { return out.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); }
  look(dx: number, dy: number) { this.yaw -= dx; this.pitch = clamp(this.pitch - dy, -1.52, 1.52); }

  ladder(p = this.pos) {
    for (const l of LADDERS) if (Math.hypot(p.x - l.x, p.z - l.z) < l.r && p.y > l.y0 && p.y < l.y1 + 0.3) return l;
    return null;
  }

  private solidAt(x: number, y: number, z: number) {
    const g = this.grid!;
    return g.get(Math.floor((x - g.min.x) / g.s), Math.floor((y - g.min.y) / g.s), Math.floor((z - g.min.z) / g.s)) !== 0;
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
        if (g.get(i, j, k) && !g.get(i, j + 1, k)) { best = Math.max(best, g.min.y + (j + 1) * s); break; }
      }
    }
    return best;
  }

  /** Altura libre sobre los pies. */
  clearance(x: number, feetY: number, z: number) {
    const g = this.grid!;
    for (let h = 0.25; h < 2.4; h += g.s) if (this.solidAt(x, feetY + h, z) || this.solidAt(x + 0.1, feetY + h, z) || this.solidAt(x - 0.1, feetY + h, z) || this.solidAt(x, feetY + h, z + 0.1) || this.solidAt(x, feetY + h, z - 0.1)) return h;
    return 2.4;
  }

  /** Empuja una esfera fuera de la geometría; devuelve la normal media de contacto. */
  private pushSphere(c: THREE.Vector3, r: number, horizontal: boolean, nOut: THREE.Vector3) {
    const g = this.grid!;
    nOut.set(0, 0, 0);
    for (let it = 0; it < 4; it++) {
      const d = g.nearest(c, r, this.tmp);
      if (!Number.isFinite(d)) break;
      const n = this.tmp2.copy(c).sub(this.tmp);
      if (horizontal) n.y = 0;
      let len = n.length();
      if (len < 1e-5) { n.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).negate(); len = 1; }
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
    this.bob.set(0, 0, 0);
    const want = move.clone();
    if (opts.up) want.y += 1;
    if (opts.crouch) want.y -= 1;
    want.applyQuaternion(this.viewQuat());
    if (want.lengthSq() > 1) want.normalize();
    const vmax = this.speed.float * (opts.run ? 1.6 : 1);
    // empuje suave: aproximarse a la velocidad deseada con constante de tiempo de ~0,5 s; deriva al soltar
    if (want.lengthSq() > 0.001) this.vel.lerp(want.multiplyScalar(vmax), 1 - Math.exp(-dt * 2.4));
    else this.vel.multiplyScalar(Math.exp(-dt * 0.9));
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
    this.eyeH = EYE_STAND; this.onGround = false; this.climbing = false;
  }

  private walkStep(dt: number, move: THREE.Vector3, opts: { run?: boolean; crouch?: boolean; up?: boolean; jump?: boolean }) {
    const feet = this.pos.y - this.eyeH;
    const lad = this.ladder(new THREE.Vector3(this.pos.x, feet + 0.4, this.pos.z)) ?? this.ladder(this.pos);
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // dirección horizontal deseada según la orientación (sin cabeceo)
    const wx = move.x * cosY + move.z * sinY;
    const wz = -move.x * sinY + move.z * cosY;
    const wl = Math.hypot(wx, wz);
    const wantCrouch = opts.crouch || this.crouchToggle;
    // --- escalerilla
    const groundHere = this.groundAt(this.pos.x, feet + 0.05, this.pos.z, 0.1);
    this.climbing = !!lad && (Math.abs(feet - groundHere) > 0.08 || opts.up || (wantCrouch && !!lad && lad.id === 'esclusa'));
    if (this.climbing) {
      let vert = (opts.up ? 1 : 0) - (wantCrouch ? 1 : 0);
      if (vert === 0 && Math.abs(move.z) > 0.1 && Math.abs(this.pitch) > 0.4) vert = -Math.sign(move.z) * Math.sign(this.pitch);
      this.vel.set(wx * 0.7, vert * 0.85, wz * 0.7);
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
      const k2 = c.clone().setY(base + STEP + R_BODY * 0.5);
      const nrm2 = new THREE.Vector3();
      this.pushSphere(k2, R_BODY * 0.9, true, nrm2);
      let px = c.x + (k2.x - nx), pz = c.z + (k2.z - nz);
      for (const nn of [nrm, nrm2]) if (nn.lengthSq() > 0) { const vn = this.vel.x * nn.x + this.vel.z * nn.z; if (vn < 0) { this.vel.x -= vn * nn.x; this.vel.z -= vn * nn.z; } }
      // ¿cabe de pie o agachado en la nueva posición?
      const room = this.clearance(px, base, pz);
      if (room < EYE_CROUCH - 0.2 + 0.12) { px = this.pos.x; pz = this.pos.z; this.vel.x = this.vel.z = 0; base = footY; }
      if (base > footY) { this.stepOffset -= base - footY; footY = base; }
      this.pos.x = px; this.pos.z = pz;
      // vertical
      footY += this.vel.y * h;
      const g = this.groundAt(this.pos.x, Math.max(footY, base) + 0.02, this.pos.z, 0.05);
      if (footY <= g + 1e-3 && !this.climbing) {
        if (!this.onGround && this.vel.y < -1.4) this.onStep?.(Math.min(1, -this.vel.y / 5));
        footY = g; if (this.vel.y < 0) this.vel.y = 0; landed = true;
      }
      if (this.climbing) {
        // dentro del pozo: nunca por debajo del suelo de la esclusa ni por encima de la cúpula
        if (footY < g) footY = g;
      }
    }
    this.onGround = landed || (!this.climbing && footY - this.groundAt(this.pos.x, footY + 0.02, this.pos.z, 0.05) < 0.03);
    // --- altura de ojos: agacharse voluntario o forzado por el techo
    const room = this.clearance(this.pos.x, footY, this.pos.z);
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
    // balanceo de cabeza discreto y pasos
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.25) {
      const prev = this.stride;
      this.stride += hs * dt * 1.7;
      if (Math.floor(prev) !== Math.floor(this.stride)) this.onStep?.(clamp(hs / 2.3, 0.25, 0.8));
    }
    const amp = this.onGround ? clamp(hs / 1.35, 0, 1.3) : 0;
    this.bob.set(Math.cos(this.stride * Math.PI) * 0.006 * amp, -Math.abs(Math.sin(this.stride * Math.PI)) * 0.014 * amp + this.stepOffset, 0);
  }

  /** Coloca al tripulante de pie sobre el suelo bajo `eye` (sin teletransportes dentro de paredes). */
  settle() {
    this.vel.set(0, 0, 0);
    if (!this.grid || this.locomotion !== 'walk') return;
    if (this.ladder()) { this.climbing = true; return; }
    const g = this.groundAt(this.pos.x, this.pos.y, this.pos.z, 0.2);
    if (Number.isFinite(g)) {
      const room = this.clearance(this.pos.x, g, this.pos.z);
      this.eyeH = Math.min(EYE_STAND, room - 0.14);
      this.pos.y = g + this.eyeH;
      this.onGround = true;
    }
  }

  /** ¿Punto libre (para puntos de aparición y validación)? */
  free(p: THREE.Vector3, r = R_HEAD) { return !this.grid || !Number.isFinite(this.grid.nearest(p, r, this.tmp)); }

  serialize() { return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch, loco: this.locomotion }; }
  deserialize(o: any) { if (!o?.pos) return; this.pos.fromArray(o.pos); this.yaw = o.yaw ?? 0; this.pitch = o.pitch ?? 0; if (o.loco === 'walk' || o.loco === 'float') this.locomotion = o.loco; }
}
