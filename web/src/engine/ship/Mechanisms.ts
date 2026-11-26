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

interface Joint { id: string; pivot: THREE.Vector3; axis: THREE.Vector3; min: number; max: number; angle: number; target: number; }

const X_BASE = 1.30, R_S = 2.26;
const ZT1 = R_S + 0.42, ZT2 = R_S + 0.80;

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
  }

  /** Matriz acumulada de las articulaciones 0..k (en orden proximal → distal). */
  private chain(k: number, angles = this.joints.map((j) => j.angle)) {
    const m = new THREE.Matrix4();
    for (let i = 0; i <= k; i++) { const j = this.joints[i]; m.multiply(rotAbout(j.pivot, j.axis, angles[i])); }
    return m;
  }

  tip(angles?: number[]) { return this.tip0.clone().applyMatrix4(this.chain(5, angles)); }

  /** IK por descenso cíclico de coordenadas (CCD) hacia un punto en espacio de nave. */
  solveIK(target: THREE.Vector3, iters = 18) {
    const a = this.joints.map((j) => j.target);
    const order = [3, 2, 1, 0];
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
        let d = Math.atan2(ax.dot(v1.clone().cross(v2)), v1.dot(v2));
        a[k] = clamp(a[k] + d * 0.8, j.min, j.max);
      }
    }
    this.joints.forEach((j, i) => (j.target = a[i]));
    return this.tip(a).distanceTo(target);
  }

  setPose(name: 'stow' | 'deploy' | 'inspect') {
    const poses: Record<string, number[]> = {
      stow: [0, 0, 0, 0, 0, 0],
      deploy: [0.35, -1.05, -2.35, 0.9, 0, 0],
      inspect: [-1.2, -0.75, -2.0, 0.6, 0.3, 0],
    };
    poses[name].forEach((v, i) => (this.joints[i].target = v));
  }

  jogJoint(i: number, d: number) {
    const j = this.joints[i];
    j.target = clamp(j.target + d, j.min, j.max);
  }

  update(dt: number) {
    const model = this.model;
    // --- brazo
    let moving = 0;
    if (this.armPowered) {
      for (const j of this.joints) {
        const d = j.target - j.angle;
        if (Math.abs(d) > 1e-4) { j.angle += Math.sign(d) * Math.min(Math.abs(d), 0.35 * dt); moving = 1; }
      }
    }
    this.armBusy = moving;
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
