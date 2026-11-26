/**
 * Mecanismos con cinemática encadenada (no expresables como una bisagra simple):
 * brazo robótico (FK + IK por CCD), plegado en acordeón de radiadores y
 * seguimiento automático de alas solares (Sol) y antena de alta ganancia (Tierra).
 * Las bisagras simples (escotillas, contraventanas, taquillas, interruptores)
 * las resuelve ShipModel a partir de los metadatos `extras.mech`.
 */
import * as THREE from 'three';
import { b2t, clamp } from '../util';
import type { ShipModel } from './ShipModel';

export type ArmPoseName = 'estiba' | 'observacion' | 'captura' | 'servicio';
export type ArmPoseInput = ArmPoseName | 'stow' | 'deploy' | 'inspect';

export const ARM_POSES: Record<ArmPoseName, number[]> = {
  estiba: [0, 0, 0, 0, 0, 0],
  observacion: [-1.15, -0.78, -1.95, 0.65, 0.30, 0],
  captura: [0.32, -1.05, -2.32, 0.88, 0.0, 0],
  servicio: [-0.45, -1.25, -2.05, 0.98, -0.32, 0.35],
};

const POSE_ALIAS: Record<ArmPoseInput, ArmPoseName> = {
  estiba: 'estiba',
  stow: 'estiba',
  observacion: 'observacion',
  inspect: 'observacion',
  captura: 'captura',
  deploy: 'captura',
  servicio: 'servicio',
};

/** Estado compartido del brazo robótico para las pantallas MFD ARM y ARMCAM. */
export const ARM_STATUS = {
  pose: 'estiba' as ArmPoseName | 'ik' | 'manual',
  grabbed: null as string | null,
  powered: true,
  busy: 0,
  lastIkErr: null as number | null,
};

interface Joint { id: string; pivot: THREE.Vector3; axis: THREE.Vector3; min: number; max: number; angle: number; target: number; }

const X_BASE = 1.30, R_S = 2.26;
const ZT1 = R_S + 0.42, ZT2 = R_S + 0.80;
const HULL_SAFE_R = 2.25;

/** Rotación de un punto alrededor de un eje que pasa por un pivote. */
function rotAbout(p: THREE.Vector3, axis: THREE.Vector3, a: number) {
  return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, a))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}

export class Mechanisms {
  joints: Joint[];
  /** piezas aguas abajo de cada articulación (índice de articulación más distal que las mueve) */
  private armParts: [string, number][] = [
    ['RBT.J1', 0], ['RBT.J2', 1], ['RBT.J3', 1], ['RBT.BMS.B1', 1], ['RBT.CAM.C1', 2], ['RBT.J4', 2], ['RBT.BMS.B2', 2],
    ['RBT.J5', 3], ['RBT.J6', 4], ['RBT.CAM.C2', 4], ['RBT.J7', 5], ['RBT.EE', 5],
  ];
  private tip0 = b2t(X_BASE - 0.24, 0, ZT2);
  radiatorDeploy = 1;
  radiatorTarget = 1;
  armPowered = true;
  sunTracking = true;
  hgaTracking = true;
  private model: ShipModel;
  /** dirección del Sol y de la Tierra en espacio de nave (las actualiza el motor) */
  sunLocal = new THREE.Vector3(0, 1, 0);
  earthLocal = new THREE.Vector3(0, -1, 0);
  armBusy = 0;
  grabbed: string | null = null;
  activePose: ArmPoseName | 'ik' | 'manual' = 'estiba';
  lastIkErr: number | null = null;

  constructor(model: ShipModel) {
    this.model = model;
    const Y = b2t(0, 1, 0).normalize(), Z = b2t(0, 0, 1).normalize(), X = b2t(1, 0, 0).normalize();
    this.joints = [
      { id: 'J1', pivot: b2t(X_BASE, 0, R_S), axis: Z, min: -Math.PI, max: Math.PI, angle: 0, target: 0 },
      { id: 'J2', pivot: b2t(X_BASE, 0, ZT1), axis: Y, min: -1.7, max: 0.15, angle: 0, target: 0 },
      { id: 'J4', pivot: b2t(X_BASE + 4.10, 0, (ZT1 + ZT2) / 2), axis: Y, min: -3.1, max: 0.05, angle: 0, target: 0 },
      { id: 'J5', pivot: b2t(X_BASE + 0.62, 0, ZT2), axis: Y, min: -2.2, max: 2.2, angle: 0, target: 0 },
      { id: 'J6', pivot: b2t(X_BASE + 0.38, 0, ZT2), axis: Z, min: -2.2, max: 2.2, angle: 0, target: 0 },
      { id: 'J7', pivot: b2t(X_BASE + 0.14, 0, ZT2), axis: X, min: -Math.PI, max: Math.PI, angle: 0, target: 0 },
    ];
    this.syncArmStatus();
  }

  private syncArmStatus() {
    ARM_STATUS.pose = this.activePose;
    ARM_STATUS.grabbed = this.grabbed;
    ARM_STATUS.powered = this.armPowered;
    ARM_STATUS.busy = this.armBusy;
    ARM_STATUS.lastIkErr = this.lastIkErr;
  }

  /** Matriz acumulada de las articulaciones 0..k (en orden proximal → distal). */
  private chain(k: number, angles = this.joints.map((j) => j.angle)) {
    const m = new THREE.Matrix4();
    for (let i = 0; i <= k; i++) { const j = this.joints[i]; m.multiply(rotAbout(j.pivot, j.axis, angles[i])); }
    return m;
  }

  tip(angles?: number[]) { return this.tip0.clone().applyMatrix4(this.chain(5, angles)); }

  /**
   * Comprueba que el codo, la muñeca y el efector terminal permanecen fuera
   * del envolvente de seguridad del casco habitable (evita auto-colisión).
   */
  isSafeConfig(angles: number[]): boolean {
    if (Math.abs(angles[1]) < 0.05 && Math.abs(angles[2]) < 0.05) return true;
    const m1 = this.chain(1, angles);
    const m2 = this.chain(2, angles);
    const m5 = this.chain(5, angles);
    const elbow = this.joints[2].pivot.clone().applyMatrix4(m1);
    const wrist = this.joints[3].pivot.clone().applyMatrix4(m2);
    const ee = this.tip0.clone().applyMatrix4(m5);
    const midB1 = this.joints[1].pivot.clone().lerp(this.joints[2].pivot, 0.5).applyMatrix4(m1);
    const midB2 = this.joints[2].pivot.clone().lerp(this.joints[3].pivot, 0.5).applyMatrix4(m2);
    for (const p of [elbow, wrist, ee, midB1, midB2]) {
      if (p.x > -6.0 && p.x < 12.6) {
        const rad = Math.hypot(p.y, p.z);
        if (rad < HULL_SAFE_R) return false;
      }
    }
    return true;
  }

  /** Ejecuta una pasada CCD desde una semilla dada respetando límites seguros sin colisión con casco. */
  private runCCD(seed: number[], target: THREE.Vector3, iters: number): { angles: number[]; err: number } {
    const a = seed.slice();
    const order = [4, 3, 2, 1, 0];
    for (let it = 0; it < iters; it++) {
      for (const k of order) {
        const j = this.joints[k];
        const M = this.chain(k - 1 < 0 ? -1 : k - 1, a);
        const piv = j.pivot.clone().applyMatrix4(M);
        const ax = j.axis.clone().transformDirection(M);
        const tip = this.tip(a);
        const v1 = tip.sub(piv); const v2 = target.clone().sub(piv);
        v1.addScaledVector(ax, -v1.dot(ax)); v2.addScaledVector(ax, -v2.dot(ax));
        if (v1.lengthSq() < 1e-6 || v2.lengthSq() < 1e-6) continue;
        const d = Math.atan2(ax.dot(v1.clone().cross(v2)), v1.dot(v2));
        const prev = a[k];
        const cand = clamp(prev + d * 0.78, j.min, j.max);
        a[k] = cand;
        if (!this.isSafeConfig(a)) {
          // retroceso parcial si el paso completo roza el casco
          a[k] = clamp(prev + d * 0.3, j.min, j.max);
          if (!this.isSafeConfig(a)) a[k] = prev;
        }
      }
    }
    return { angles: a, err: this.tip(a).distanceTo(target) };
  }

  /** IK por descenso cíclico de coordenadas (CCD) multi-semilla hacia un punto en espacio de nave. */
  solveIK(target: THREE.Vector3, iters = 24) {
    const steps = Math.max(iters, 24);
    const cur = this.joints.map((j) => j.target);
    const yawHint = clamp(Math.atan2(-target.z, target.x - X_BASE), -Math.PI, Math.PI);
    const seeds: number[][] = [
      cur,
      [yawHint, -1.05, -2.15, 0.85, 0, 0],
      ARM_POSES.captura.slice(),
    ];
    let best = this.runCCD(seeds[0], target, steps);
    for (let s = 1; s < seeds.length; s++) {
      const r = this.runCCD(seeds[s], target, steps);
      if (r.err < best.err && this.isSafeConfig(r.angles)) best = r;
    }
    this.joints.forEach((j, i) => (j.target = best.angles[i]));
    this.activePose = 'ik';
    this.lastIkErr = best.err;
    this.syncArmStatus();
    return best.err;
  }

  /** Aplica una postura nombrada (`estiba`, `observacion`, `captura`, `servicio` o alias heredados). */
  setPose(name: ArmPoseInput) {
    const canonical = POSE_ALIAS[name] ?? 'estiba';
    const pose = ARM_POSES[canonical];
    pose.forEach((v, i) => (this.joints[i].target = clamp(v, this.joints[i].min, this.joints[i].max)));
    this.activePose = canonical;
    this.lastIkErr = null;
    this.syncArmStatus();
  }

  jogJoint(i: number, d: number) {
    const j = this.joints[i];
    if (!j) return;
    const cand = this.joints.map((jj) => jj.target);
    cand[i] = clamp(j.target + d, j.min, j.max);
    if (!this.isSafeConfig(cand)) return;
    j.target = cand[i];
    this.activePose = 'manual';
    this.syncArmStatus();
  }

  update(dt: number) {
    const model = this.model;
    // --- brazo con interpolación suave (rampa de desaceleración cerca del objetivo)
    let moving = 0;
    if (this.armPowered) {
      for (const j of this.joints) {
        const d = j.target - j.angle;
        const ad = Math.abs(d);
        if (ad > 1e-4) {
          const speed = ad < 0.22 ? 0.14 + (ad / 0.22) * 0.38 : 0.52;
          j.angle += Math.sign(d) * Math.min(ad, speed * dt);
          moving = 1;
        } else if (ad > 0) {
          j.angle = j.target;
        }
      }
    }
    this.armBusy = moving;
    this.syncArmStatus();
    for (const [code, k] of this.armParts) model.setExtra(code, this.chain(k));
    // --- radiadores (acordeón)
    const dr = this.radiatorTarget - this.radiatorDeploy;
    if (Math.abs(dr) > 1e-4) { this.radiatorDeploy += Math.sign(dr) * Math.min(Math.abs(dr), 0.12 * dt); moving = 1; }
    const s = 1 - this.radiatorDeploy;
    for (const [w, sg] of [['THR.R1', 1], ['THR.R2', -1]] as const) {
      const X = b2t(1, 0, 0).normalize();
      const zRoot = sg * 2.27, z1 = sg * (2.30 + 1.81), z2 = sg * (2.30 + 2 * 1.81);
      const xm = (-0.70 + -3.90) / 2;
      const R0 = rotAbout(b2t(xm, 0, zRoot), X, sg * s * Math.PI / 2 * 0.98);
      const R1 = R0.clone().multiply(rotAbout(b2t(xm, 0.045, z1), X, -sg * s * Math.PI * 0.98));
      const R2 = R1.clone().multiply(rotAbout(b2t(xm, -0.045, z2), X, sg * s * Math.PI * 0.98));
      model.setExtra(`${w}.PNL.P1`, R0);
      model.setExtra(`${w}.HNG1`, R1);
      model.setExtra(`${w}.PNL.P2`, R1);
      model.setExtra(`${w}.HNG2`, R2);
      model.setExtra(`${w}.PNL.P3`, R2);
    }
    // --- seguimiento solar (alas giran sobre su eje Y de Blender, con banda muerta de 0,3° para evitar vibración)
    if (this.sunTracking) {
      const sl = this.sunLocal;
      const ang = Math.atan2(sl.x, sl.y);
      for (const w of ['wing:1', 'wing:2']) {
        const cur = model.mech(w);
        if (cur && Math.abs(ang - cur.target) > 0.005) model.setMech(w, ang);
      }
    }
    // --- antena de alta ganancia: descenso de coordenadas sobre acimut/elevación
    if (this.hgaTracking) this.trackHGA();
    return moving;
  }

  private trackHGA() {
    const az = this.model.mechs.get('hga:az')?.mech;
    const el = this.model.mechs.get('hga:el')?.mech;
    if (!az || !el) return;
    const aim0 = b2t(-0.55, 0, 0).add(b2t(Math.cos((5 * Math.PI) / 4), Math.sin((5 * Math.PI) / 4), 0).normalize()).normalize();
    const f = (a: number, e: number) => aim0.clone().applyAxisAngle(el.axis, e).applyAxisAngle(az.axis, a).dot(this.earthLocal);
    let a = az.target, e = el.target;
    for (let i = 0; i < 6; i++) {
      const h = 0.02;
      const ga = (f(a + h, e) - f(a - h, e)) / (2 * h);
      const ge = (f(a, e + h) - f(a, e - h)) / (2 * h);
      a = clamp(a + ga * 0.6, az.min, az.max);
      e = clamp(e + ge * 0.6, el.min, el.max);
    }
    if (Math.abs(a - az.target) > 0.005) az.target = a;
    if (Math.abs(e - el.target) > 0.005) el.target = e;
  }

  /** Error de apuntamiento de la antena (rad) para el enlace de comunicaciones. */
  hgaError() {
    const az = this.model.mechs.get('hga:az')?.mech;
    const el = this.model.mechs.get('hga:el')?.mech;
    if (!az || !el) return Math.PI;
    const aim0 = b2t(-0.55, 0, 0).add(b2t(Math.cos((5 * Math.PI) / 4), Math.sin((5 * Math.PI) / 4), 0).normalize()).normalize();
    const aim = aim0.applyAxisAngle(el.axis, el.value).applyAxisAngle(az.axis, az.value);
    return aim.angleTo(this.earthLocal);
  }
}
