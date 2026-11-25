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
const BODY_R = 0.17;       // semiprofundidad del torso: permite pasar de perfil entre consolas (0,38 m)
const EYE_STAND = 1.62;    // ojos sobre los pies de pie
const EYE_CROUCH = 0.95;
const STEP_H = 0.75;       // altura máxima que se sube sin saltar (umbral de la escotilla nodo–hábitat)
const G = 9.81;
const DECK = -1.15;        // cubierta del pasillo del hábitat (z Blender)
const CEIL = 1.15;

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
  /**
   * Locomoción interior. 'walk' = gravedad de entrenamiento de 1 g (como en una maqueta
   * de entrenamiento en tierra): se camina sobre la cubierta, se sube por escotillas y
   * escalerillas. 'float' = microgravedad real (flotar y empujarse con asideros).
   */
  locomotion: 'walk' | 'float' = 'walk';
  onGround = false;
  /** altura de los ojos sobre los pies (se reduce al agacharse) */
  eyeH = EYE_STAND;
  crouch = false;
  climbing = false;
  /** fase del paso (balanceo de cabeza y sonido de pisadas) */
  stride = 0;
  onStep: ((strength: number) => void) | null = null;
  bob = new THREE.Vector3();
  private stepOffset = 0;

  constructor(model: ShipModel) { this.model = model; }

  /** Construye colisionadores a partir de las piezas interiores (y exteriores para EVA). */
  buildColliders() {
    const m = this.model;
    const skip = /(SUIT[AB]|\.LGT|LIV\.|\.TGL\.|\.HR$|\.HR\.|UTL\.C\d\.H2O|UTL\.STK|\.SCR$|\.D\d$|\.ISO$|\.SKN$|WIN\.W|\.MLI|BLK\d)/;
    this.colliders = [];
    this.dynamic = [];
    for (const { node, box } of m.partBoxes((n) => n.sector === 'int' || n.code.startsWith('FWD.INT') || n.code.startsWith('FWD.ALK.INT'))) {
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) < 0.06) continue;
      if (skip.test(node.code)) continue;
      // cajas enormes (envolventes de conjuntos dispersos) no se usan
      if (size.x > 4 || size.y > 3 || size.z > 3) continue;
      // envolventes de conjuntos repartidos alrededor del pasillo (p. ej. soportes de
      // taquillas del nodo): su caja tapa el paso aunque la geometría real no lo haga
      const [, , zc] = t2b(box.getCenter(new THREE.Vector3()));
      const axis = new THREE.Vector3((box.min.x + box.max.x) / 2, Math.min(Math.max(-0.5, box.min.y), box.max.y), 0);
      if (size.z > 1.2 && size.x > 1.2 && box.containsPoint(axis) && Math.abs(zc) < 1.0) continue;
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
      // mamparo con la escotilla nodo–hábitat (paso libre de ~1,05 m de diámetro)
      if (x > 9.93 && x < 10.1) return r < 0.52;
      if (r < 1.2) return true;
      if (Math.abs(x - 11.05) < 0.6 && Math.hypot(x - 11.05, y) < 0.6 && z > 0 && z < 2.05) return true;     // cúpula
      const ra = Math.hypot(x - 11.05, y);
      if (z < -1.1 && z > -1.38) return ra < 0.5;                                                            // escotilla nodo–esclusa
      if (ra < 0.72 && z <= -1.38 && z > -3.35) return true;                                                 // esclusa
      return false;
    }
    return false;
  }

  /** Paso de movimiento. move: deseo en ejes de vista; dt en segundos. */
  step(dt: number, move: THREE.Vector3, boost: boolean, grabNear: PartNode | null, crouchHeld = false, upHeld = false, jumpHit = false) {
    if (!this.eva && this.locomotion === 'walk' && !this.noclip) { this.walkStep(dt, move, boost, crouchHeld, upHeld, jumpHit); return; }
    this.bob.set(0, 0, 0);
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


  // ------------------------------------------------------------ caminar (1 g)
  /** Zonas de escalerilla: pozo de la esclusa y cúpula (verticales, sin cubierta). */
  static ladderZone(p: THREE.Vector3) {
    const [x, y, z] = t2b(p);
    if (Math.hypot(x - 11.05, y) < 0.62 && z < -0.55 && z > -3.4) return 'esclusa';
    if (Math.hypot(x - 11.05, y) < 0.55 && z > 0.55) return 'cupula';
    return null;
  }

  /** Suelo bajo los pies (y three) buscando cajas y el contorno presurizado. */
  groundAt(feet: THREE.Vector3, maxUp = STEP_H) {
    const [x, yb] = t2b(feet);
    let g = -Infinity;
    const top = feet.y + maxUp;
    // cubierta del pasillo del hábitat
    if (x > 0.5 && x < 9.93 && Math.abs(yb) < 1.12) g = DECK; // la cubierta llega hasta el mamparo
    // casco presurizado: primer punto exterior bajando desde la altura de búsqueda
    const t = feet.clone(); t.y = top;
    if (Player.insidePressurized(t)) {
      for (let k = 0; k < 90; k++) { t.y -= 0.05; if (!Player.insidePressurized(t)) { g = Math.max(g, t.y + 0.05); break; } }
    }
    // cajas de piezas: superficies horizontales bajo el pie
    for (const c of this.near(feet, true)) {
      const b = c.dynamic ? this.model.currentBox(c.node) : c.box;
      if (b.max.y > top || b.max.y <= g) continue;
      if (feet.x < b.min.x - 0.06 || feet.x > b.max.x + 0.06 || feet.z < b.min.z - 0.06 || feet.z > b.max.z + 0.06) continue;
      // sólo superficies de apoyo razonables (no barras finas ni pasamanos)
      const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
      if (Math.min(sx, sz) < 0.18) continue;
      g = b.max.y;
    }
    return g;
  }

  /** Techo sobre la cabeza (y three). */
  ceilingAt(feet: THREE.Vector3) {
    const [x, yb] = t2b(feet);
    let c = Infinity;
    if (x > 0.5 && x < 8.8 && Math.abs(yb) < 1.12) c = CEIL;
    // primer punto interior por encima de los pies y, desde ahí, el primero exterior
    const t = feet.clone(); t.y += 0.3;
    let k = 0;
    while (!Player.insidePressurized(t) && k++ < 30) t.y += 0.05;
    if (Player.insidePressurized(t)) {
      for (k = 0; k < 60; k++) { t.y += 0.05; if (!Player.insidePressurized(t)) { c = Math.min(c, t.y - 0.05); break; } }
    }
    for (const col of this.near(feet, true)) {
      const b = col.dynamic ? this.model.currentBox(col.node) : col.box;
      if (b.min.y < feet.y + 0.3 || b.min.y >= c) continue;
      if (feet.x < b.min.x || feet.x > b.max.x || feet.z < b.min.z || feet.z > b.max.z) continue;
      c = b.min.y;
    }
    return c;
  }

  private near(p: THREE.Vector3, withDynamic: boolean) {
    const out = new Set<Collider>();
    for (let i = Math.floor(p.x - 1); i <= Math.floor(p.x + 1); i++) this.grid.get(i)?.forEach((c) => out.add(c));
    if (withDynamic) for (const c of this.dynamic) out.add(c);
    return out;
  }

  private walkStep(dt: number, move: THREE.Vector3, run: boolean, crouchHeld: boolean, upHeld: boolean, jump: boolean) {
    const feet = this.pos.clone(); feet.y -= this.eyeH;
    const ladder = Player.ladderZone(this.pos) ?? Player.ladderZone(feet);
    // dirección horizontal según la orientación de la vista (sin cabeceo)
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const wish = new THREE.Vector3(move.x, 0, move.z).applyQuaternion(yawQ);
    if (wish.lengthSq() > 1) wish.normalize();
    // techo aquí y un poco por delante (para agacharse antes de llegar a la escotilla)
    let ceil = this.ceilingAt(feet);
    if (wish.lengthSq() > 0.01) {
      const ahead = feet.clone().addScaledVector(wish.clone().normalize(), 0.45);
      const ga = this.groundAt(ahead);
      if (Number.isFinite(ga) && ga <= feet.y + STEP_H) ceil = Math.min(ceil, this.ceilingAt(new THREE.Vector3(ahead.x, Math.max(ga, feet.y), ahead.z)) - Math.max(0, ga - feet.y));
    }
    const room = ceil - feet.y;
    // agacharse: voluntario o forzado por el techo (escotillas de 1 m)
    const wantEye = (crouchHeld && !ladder) || room < EYE_STAND + 0.18 ? Math.max(0.5, Math.min(EYE_CROUCH, room - 0.16)) : EYE_STAND;
    this.crouch = wantEye < EYE_STAND - 0.05;
    this.eyeH = damp(this.eyeH, Math.min(wantEye, Math.max(0.5, room - 0.12)), 10, dt);
    this.climbing = !!ladder && !this.onGroundSolid(feet);
    if (this.climbing) {
      // escalerilla: se sube/baja con arriba/abajo o mirando hacia arriba/abajo al avanzar
      const vert = (upHeld ? 1 : 0) - (crouchHeld ? 1 : 0) + (-move.z) * Math.sign(this.pitch || 1) * (Math.abs(this.pitch) > 0.35 ? 1 : 0);
      this.vel.set(wish.x * 0.8, clamp(vert, -1, 1) * 0.9, wish.z * 0.8);
    } else {
      const speed = (this.crouch ? 0.9 : run ? 2.6 : 1.45);
      const target = wish.multiplyScalar(speed);
      const k = this.onGround ? 12 : 1.5;
      this.vel.x = damp(this.vel.x, target.x, k, dt);
      this.vel.z = damp(this.vel.z, target.z, k, dt);
      this.vel.y -= G * dt;
      if (jump && this.onGround && !this.crouch) { this.vel.y = 2.6; this.onGround = false; }
    }
    // --- horizontal: cilindro contra cajas y casco; escalones instantáneos (la cámara se suaviza)
    const fy = this.pos.y - this.eyeH;
    const nx = this.pos.clone(); nx.x += this.vel.x * dt; nx.z += this.vel.z * dt;
    const gN = this.groundAt(new THREE.Vector3(nx.x, fy, nx.z));
    const canStep = Number.isFinite(gN) && gN > fy + 0.01 && gN <= fy + STEP_H + 1e-3 && (this.onGround || this.climbing);
    const base = canStep ? gN : fy;
    this.resolveWalls(nx, base, base + this.eyeH + 0.1);
    const roomN = this.ceilingAt(new THREE.Vector3(nx.x, base, nx.z)) - base;
    const fits = roomN > 0.66 && Player.insidePressurized(new THREE.Vector3(nx.x, base + 0.1, nx.z)) && Player.insidePressurized(new THREE.Vector3(nx.x, base + Math.min(this.eyeH, roomN - 0.12), nx.z));
    let footY = fy;
    if (fits) {
      if (canStep && base > fy) { this.stepOffset -= base - fy; footY = base; }
      this.pos.x = nx.x; this.pos.z = nx.z;
    } else { this.vel.x = 0; this.vel.z = 0; }
    // --- vertical
    footY += this.vel.y * dt;
    const g = this.groundAt(new THREE.Vector3(this.pos.x, Math.max(footY, fy), this.pos.z), 0.05);
    const wasGround = this.onGround;
    if (footY <= g + 0.001) {
      if (!this.climbing && !wasGround && this.vel.y < -1.2) this.onStep?.(Math.min(1, -this.vel.y / 5));
      footY = g; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true;
    } else this.onGround = !this.climbing && footY - g < 0.03;
    // techo: limita la altura de los ojos (agacharse) y, si no basta, el salto
    const roomV = this.ceilingAt(new THREE.Vector3(this.pos.x, footY, this.pos.z)) - footY;
    if (this.eyeH > roomV - 0.12) { this.eyeH = Math.max(0.5, roomV - 0.12); if (this.vel.y > 0) this.vel.y = 0; }
    this.pos.y = footY + this.eyeH;
    // red de seguridad: los pies nunca salen del volumen presurizado
    if (!Player.insidePressurized(new THREE.Vector3(this.pos.x, footY + 0.1, this.pos.z))) {
      this.pos.copy(feet).setY(fy + this.eyeH); this.pos.x = feet.x; this.pos.z = feet.z; this.vel.set(0, 0, 0); this.onGround = true; return;
    }
    // la cabeza debe quedar dentro del volumen presurizado
    for (let k = 0; k < 24 && !Player.insidePressurized(this.pos) && this.eyeH > 0.5; k++) { this.eyeH -= 0.05; this.pos.y = footY + this.eyeH; }
    this.stepOffset = damp(this.stepOffset, 0, 9, dt);
    // balanceo de cabeza y pisadas
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.2) {
      const prev = this.stride;
      this.stride += hs * dt * 1.85;
      if (Math.floor(prev) !== Math.floor(this.stride)) this.onStep?.(clamp(hs / 2.6, 0.25, 0.8));
    }
    const amp = this.onGround ? clamp(hs / 1.45, 0, 1.4) : 0;
    this.bob.set(Math.cos(this.stride * Math.PI) * 0.012 * amp, -Math.abs(Math.sin(this.stride * Math.PI)) * 0.03 * amp + this.stepOffset, 0);
  }

  private onGroundSolid(feet: THREE.Vector3) { return feet.y - this.groundAt(feet, 0.05) < 0.05; }

  /** Empuja el cilindro del cuerpo fuera de las cajas que lo intersecan (plano XZ). */
  private resolveWalls(p: THREE.Vector3, y0: number, y1: number) {
    const lo = y0 + 0.08;
    for (let it = 0; it < 2; it++) {
      for (const c of this.near(p, true)) {
        const b = c.dynamic ? this.model.currentBox(c.node) : c.box;
        if (b.max.y <= lo + 0.02 || b.min.y >= y1) continue;
        // lo que queda por debajo de la altura de escalón se sube (o se pisa), no bloquea
        if (b.max.y <= y0 + STEP_H && (this.onGround || this.climbing)) continue;
        const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
        const dx = p.x - cx, dz = p.z - cz; const d = Math.hypot(dx, dz);
        if (d >= BODY_R) continue;
        if (d > 1e-5) { p.x = cx + dx / d * BODY_R; p.z = cz + dz / d * BODY_R; }
        else {
          const pen = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z];
          const i = pen.indexOf(Math.min(...pen));
          if (i === 0) p.x = b.min.x - BODY_R; else if (i === 1) p.x = b.max.x + BODY_R; else if (i === 2) p.z = b.min.z - BODY_R; else p.z = b.max.z + BODY_R;
        }
        const n = new THREE.Vector3(p.x - cx, 0, p.z - cz).normalize();
        const vn = this.vel.x * n.x + this.vel.z * n.z;
        if (vn < 0) { this.vel.x -= vn * n.x; this.vel.z -= vn * n.z; }
      }
    }
    // casco: probar a la altura de rodillas y de cabeza
    // (la cabeza se comprueba a altura agachada: el cuerpo se agacha solo bajo techos bajos)
    for (const h of [lo + 0.25, Math.min(y1 - 0.15, y0 + EYE_CROUCH * 0.85)]) {
      const t = new THREE.Vector3(p.x, h, p.z);
      if (Player.insidePressurized(t)) continue;
      const back = this.pos.clone(); back.y = h;
      for (const ax of ['x', 'z'] as const) { const tt = back.clone(); tt[ax] = p[ax]; if (Player.insidePressurized(tt)) back[ax] = p[ax]; else this.vel[ax] = 0; }
      p.x = back.x; p.z = back.z;
    }
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

  serialize() { return { pos: this.pos.toArray(), yaw: this.yaw, pitch: this.pitch, eva: this.eva, loco: this.locomotion }; }
  deserialize(o: any) { if (!o) return; this.pos.fromArray(o.pos); this.yaw = o.yaw; this.pitch = o.pitch; this.eva = !!o.eva; if (o.loco) this.locomotion = o.loco; }

  /** Coloca los pies sobre el suelo más cercano bajo un punto (al teletransportarse). */
  settle() {
    if (this.eva || this.locomotion !== 'walk') return;
    if (Player.ladderZone(this.pos)) {
      this.onGround = false;
      this.climbing = true;
      this.vel.set(0, 0, 0);
      return;
    }
    const probe = this.pos.clone();
    const g = this.groundAt(probe, 0.2);
    if (Number.isFinite(g)) { this.eyeH = EYE_STAND; const c = this.ceilingAt(new THREE.Vector3(probe.x, g, probe.z)); this.eyeH = Math.min(EYE_STAND, Math.max(0.5, c - g - 0.12)); this.pos.y = g + this.eyeH; this.onGround = true; }
    this.vel.set(0, 0, 0);
  }

  static damp = damp;
}
