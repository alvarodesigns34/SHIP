/**
 * Tripulante en primera persona (interior y EVA) en microgravedad.
 *
 * Las posiciones se expresan en espacio de NAVE (three, metros), así el
 * tripulante se mueve con la nave cuando ésta acelera o gira. Las colisiones
 * usan colisionadores simplificados derivados de la geometría (cajas de las
 * piezas reales, con una rejilla espacial) más el contorno presurizado.
 */
import * as THREE from 'three';
import { clamp, damp, t2b } from '../util';
import type { ShipModel, PartNode } from '../ship/ShipModel';

export interface Collider { box: THREE.Box3; node: PartNode; dynamic?: boolean; }

const RADIUS = 0.2;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  eva = false;
  grabbing: PartNode | null = null;
  colliders: Collider[] = [];
  evaColliders: Collider[] = [];
  private grid = new Map<number, Collider[]>();
  private evaGrid = new Map<number, Collider[]>();
  dynamic: Collider[] = [];
  noclip = false;
  jetFuel = 1;
  model: ShipModel;

  constructor(model: ShipModel) { this.model = model; }

  /** Construye colisionadores a partir de las piezas interiores (y exteriores para EVA). */
  buildColliders() {
    const m = this.model;
    const skip = /(\.LGT|LIV\.|\.TGL\.|\.HR$|\.HR\.|UTL\.C\d\.H2O|UTL\.STK|\.SCR$|\.D\d$|\.ISO$|\.SKN$|WIN\.W|\.MLI|BLK\d)/;
    this.colliders = [];
    this.dynamic = [];
    for (const { node, box } of m.partBoxes((n) => n.sector === 'int' || n.code.startsWith('FWD.INT') || n.code.startsWith('FWD.ALK.INT'))) {
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) < 0.06) continue;
      if (skip.test(node.code)) continue;
      // cajas enormes (envolventes de conjuntos dispersos) no se usan
      if (size.x > 4 || size.y > 3 || size.z > 3) continue;
      const c: Collider = { box, node, dynamic: !!node.mech };
      if (c.dynamic) this.dynamic.push(c); else this.colliders.push(c);
    }
    this.grid = this.index(this.colliders);
    // exterior (EVA): piezas exteriores grandes
    this.evaColliders = [];
    for (const { node, box } of m.partBoxes((n) => n.sector === 'ext' && !n.code.startsWith('FWD.INT') && !n.code.startsWith('FWD.ALK.INT'))) {
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) < 0.15) continue;
      if (/BLK\.S|PWR\.W\d\.TEN|\.ISO$|STR\.B\d\.SKN|MLI/.test(node.code)) continue;
      this.evaColliders.push({ box: box.clone().expandByScalar(0.02), node });
    }
    this.evaGrid = this.index(this.evaColliders);
  }

  private key(ix: number) { return ix; }
  private index(list: Collider[]) {
    const g = new Map<number, Collider[]>();
    for (const c of list) {
      const a = Math.floor(c.box.min.x), b = Math.floor(c.box.max.x);
      for (let i = a; i <= b; i++) { if (!g.has(i)) g.set(i, []); g.get(i)!.push(c); }
    }
    return g;
  }

  /** ¿Está el punto (espacio nave three) dentro del volumen presurizado? */
  static insidePressurized(p: THREE.Vector3) {
    const [x, y, z] = t2b(p);
    const r = Math.hypot(y, z);
    if (x > 0.45 && x < 8.8) return r < 1.95;
    if (x >= 8.8 && x < 9.9) return r < 1.95 - (x - 8.8) * 0.55 * 1.0;
    if (x >= 9.9 && x < 12.15) {
      if (r < 1.2) return true;
      if (Math.abs(x - 11.05) < 0.6 && Math.hypot(x - 11.05, y) < 0.6 && z > 0 && z < 2.05) return true;     // cúpula
      if (Math.hypot(x - 11.05, y) < 0.75 && z < 0 && z > -3.35) return true;                                // esclusa
      return false;
    }
    return false;
  }

  /** Paso de movimiento. move: deseo en ejes de vista; dt en segundos. */
  step(dt: number, move: THREE.Vector3, boost: boolean, grabNear: PartNode | null) {
    const q = this.viewQuat();
    const accel = this.eva ? (boost ? 1.4 : 0.7) : 2.2;
    const want = move.clone().applyQuaternion(q);
    if (this.grabbing) {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
      if (move.lengthSq() > 0.01) this.grabbing = null;
    }
    if (this.eva) {
      if (want.lengthSq() > 0 && this.jetFuel > 0) { this.vel.addScaledVector(want, accel * dt); this.jetFuel = Math.max(0, this.jetFuel - dt * 0.004 * (boost ? 2 : 1)); }
      this.vel.multiplyScalar(Math.exp(-0.35 * dt)); // asistencia de estabilización del equipo de maniobra
      this.vel.clampLength(0, 2.5);
    } else {
      this.vel.addScaledVector(want, accel * dt);
      this.vel.multiplyScalar(Math.exp(-2.2 * dt)); // el tripulante se frena con manos y pies (abstracción)
      this.vel.clampLength(0, 1.6);
    }
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    if (!this.noclip) this.collide(next);
    this.pos.copy(next);
  }

  private collide(p: THREE.Vector3) {
    if (!this.eva) {
      // contorno presurizado: si sale, vuelve al último punto válido proyectado
      if (!Player.insidePressurized(p)) {
        const back = this.pos.clone();
        // deslizamiento: probar cada eje por separado
        for (const ax of ['x', 'y', 'z'] as const) {
          const t = back.clone(); t[ax] = p[ax];
          if (Player.insidePressurized(t)) back[ax] = p[ax]; else this.vel[ax] *= -0.2;
        }
        p.copy(back);
      }
    }
    const grid = this.eva ? this.evaGrid : this.grid;
    const cand = new Set<Collider>();
    for (let i = Math.floor(p.x - 1); i <= Math.floor(p.x + 1); i++) grid.get(i)?.forEach((c) => cand.add(c));
    if (!this.eva) for (const c of this.dynamic) cand.add(c);
    for (const c of cand) {
      const box = c.dynamic ? this.model.currentBox(c.node) : c.box;
      const cl = box.clampPoint(p, new THREE.Vector3());
      const d = cl.distanceTo(p);
      if (d < RADIUS) {
        let n: THREE.Vector3;
        if (d > 1e-5) n = p.clone().sub(cl).divideScalar(d);
        else {
          // centro dentro de la caja: expulsar por la cara más cercana
          const c0 = box.getCenter(new THREE.Vector3()); const hs = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          const dl = p.clone().sub(c0);
          const pen = [hs.x - Math.abs(dl.x), hs.y - Math.abs(dl.y), hs.z - Math.abs(dl.z)];
          const i = pen.indexOf(Math.min(...pen));
          n = new THREE.Vector3(); n.setComponent(i, Math.sign(dl.getComponent(i)) || 1);
        }
        p.addScaledVector(n, RADIUS - d + 1e-3);
        const vn = this.vel.dot(n);
        if (vn < 0) this.vel.addScaledVector(n, -vn * (this.eva ? 1.3 : 1.15));
      }
    }
  }

  viewQuat() {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.5, 1.5);
  }

  /** Asidero más cercano dentro de alcance (para agarrarse). */
  nearestHandrail(maxDist = 0.9): PartNode | null {
    let best: PartNode | null = null, bd = maxDist;
    for (const n of this.model.nodes.values()) {
      if (n.kind !== 'part' || !/(\.HR($|\d|\.)|Pasamanos|HR\.H\d)/.test(n.code + '|' + n.label)) continue;
      if (this.eva !== (n.sector === 'ext' && !n.code.startsWith('FWD.INT'))) continue;
      const b = this.model.currentBox(n);
      const d = b.distanceToPoint(this.pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  serialize() { return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch, eva: this.eva }; }
  deserialize(o: any) { if (!o) return; this.pos.fromArray(o.pos); this.yaw = o.yaw; this.pitch = o.pitch; this.eva = !!o.eva; }

  static damp = damp;
}
