/**
 * Manos y antebrazos en primera persona.
 *
 * Geometría propia (sin recursos externos): antebrazo con manga del mono de vuelo,
 * puño, palma, cuatro dedos de dos falanges y pulgar; en EVA, guante blanco presurizado
 * con guantelete. Las manos sólo aparecen cuando hacen algo (alcanzar un control, agarrar
 * un asidero o realizar una actividad), como en la mayoría de juegos en primera persona:
 * en reposo quedan fuera de cuadro. Todas las posiciones están en espacio de cámara.
 *
 * Animación: cada mano persigue una pose (posición de muñeca, orientación, cierre de dedos)
 * con amortiguación crítica; el antebrazo une un «hombro» fijo con la muñeca.
 */
import * as THREE from 'three';
import { damp, clamp } from '../util';

export type HandPose = { wrist: THREE.Vector3; aim: THREE.Euler; curl: number; visible: boolean; prop?: 'pouch' | 'tray' | 'board' | 'wipe' | null };

const SHOULDER = [new THREE.Vector3(-0.24, -0.34, 0.12), new THREE.Vector3(0.24, -0.34, 0.12)];
const HIDDEN = [new THREE.Vector3(-0.32, -0.75, -0.25), new THREE.Vector3(0.32, -0.75, -0.25)];

interface Hand {
  root: THREE.Group; arm: THREE.Mesh; hand: THREE.Group; fingers: THREE.Group[]; thumb: THREE.Group;
  wrist: THREE.Vector3; q: THREE.Quaternion; curl: number; side: number; vis: number;
  props: Record<string, THREE.Object3D>;
}

function mat(color: number, rough: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
}

export class Hands {
  group = new THREE.Group();
  private hands: Hand[] = [];
  private skin = mat(0xb98a6e, 0.55);
  private sleeve = mat(0x2d3a4f, 0.85);
  private cuff = mat(0x1b2230, 0.9);
  private glove = mat(0xe8e6df, 0.75);
  private gauntlet = mat(0xd9d4c8, 0.6);
  private eva = false;
  /** poses objetivo [izquierda, derecha] */
  target: HandPose[] = [this.rest(0), this.rest(1)];
  t = 0;

  constructor() {
    this.group.name = 'FirstPersonHands';
    for (let s = 0; s < 2; s++) this.hands.push(this.build(s === 0 ? -1 : 1));
    this.group.renderOrder = 10;
  }

  private rest(i: number): HandPose { return { wrist: HIDDEN[i].clone(), aim: new THREE.Euler(), curl: 0.35, visible: false }; }

  private build(side: number): Hand {
    const root = new THREE.Group();
    // antebrazo: cono truncado de manga (eje +Y local), longitud unitaria escalada en tiempo real
    const armGeo = new THREE.CylinderGeometry(0.036, 0.046, 1, 16, 1, true); armGeo.translate(0, 0.5, 0);
    const arm = new THREE.Mesh(armGeo, this.sleeve);
    const hand = new THREE.Group();
    // puño de la manga
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 16), this.cuff);
    cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.03; cuff.name = 'cuff';
    // palma: caja redondeada aproximada con cápsula aplastada
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.045, 4, 12), this.skin);
    palm.rotation.x = Math.PI / 2; palm.scale.set(1.3, 1, 0.55); palm.position.z = -0.035; palm.name = 'palm';
    hand.add(cuff, palm);
    const fingers: THREE.Group[] = [];
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Group();
      f.position.set((-0.027 + 0.018 * k) * side * -1, 0.004, -0.075);
      const len = [0.036, 0.042, 0.04, 0.032][k];
      const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, len, 3, 8), this.skin);
      p1.rotation.x = Math.PI / 2; p1.position.z = -len / 2;
      const j = new THREE.Group(); j.position.z = -len; j.name = 'j';
      const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, len * 0.75, 3, 8), this.skin);
      p2.rotation.x = Math.PI / 2; p2.position.z = -len * 0.38;
      j.add(p2); f.add(p1, j);
      hand.add(f); fingers.push(f);
    }
    const thumb = new THREE.Group();
    thumb.position.set(0.034 * side * -1 * -1, -0.004, -0.03);
    const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.04, 3, 8), this.skin);
    t1.rotation.x = Math.PI / 2; t1.position.z = -0.022;
    thumb.add(t1); thumb.rotation.y = 0.7 * side; hand.add(thumb);
    // objetos sujetos
    const props: Record<string, THREE.Object3D> = {};
    const pouch = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.018), new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.32 }));
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), mat(0xf0f0f0, 0.4));
    straw.position.y = 0.08; const clip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.01), mat(0x2a5fd0, 0.5)); clip.position.y = 0.06;
    pouch.add(bag, straw, clip); pouch.position.set(0, 0.04, -0.07);
    const tray = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.18), mat(0x8a8f96, 0.55));
    for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.09), new THREE.MeshStandardMaterial({ color: [0xb07a3a, 0xd9c79a, 0x6f8f3f][k], roughness: 0.7 })); c.position.set(-0.08 + 0.08 * k, 0.02, 0); tray.add(c); }
    tray.add(tb); tray.position.set(-0.11 * side, -0.02, -0.08);
    const board = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.3), mat(0x5b6068, 0.6));
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.002, 0.27), mat(0xf2efe6, 0.9)); paper.position.y = 0.004;
    board.add(bb, paper); board.rotation.x = 1.1; board.position.set(-0.05 * side, 0.04, -0.12);
    const wipe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.11), mat(0xf4f4f0, 0.95)); wipe.position.set(0, -0.015, -0.07);
    for (const [k, o] of Object.entries({ pouch, tray, board, wipe })) { o.visible = false; hand.add(o); props[k] = o; }
    root.add(arm, hand);
    this.group.add(root);
    return { root, arm, hand, fingers, thumb, wrist: HIDDEN[side < 0 ? 0 : 1].clone(), q: new THREE.Quaternion(), curl: 0.3, side, vis: 0, props };
  }

  setEVA(on: boolean) {
    if (on === this.eva) return;
    this.eva = on;
    for (const h of this.hands) {
      h.arm.material = on ? this.gauntlet : this.sleeve;
      h.hand.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Object.values(h.props).some((p) => p === o || p.children.includes(o))) return;
        if (o.name === 'cuff') m.material = on ? this.gauntlet : this.cuff;
        else m.material = on ? this.glove : this.skin;
      });
      // los guantes presurizados engordan dedos y palma
      h.hand.scale.setScalar(on ? 1.28 : 1);
    }
  }

  /** Alcanzar un punto (espacio de cámara) con la mano más cercana y volver. */
  reach(pCam: THREE.Vector3, dur = 0.55) {
    const i = pCam.x < 0 ? 0 : 1;
    const w = pCam.clone().multiplyScalar(0.92); w.z = Math.max(w.z, -0.62); w.y = Math.max(w.y, -0.32);
    this.pulse = { i, w, t: 0, dur };
  }
  private pulse: { i: number; w: THREE.Vector3; t: number; dur: number } | null = null;

  /** Pose continua según la actividad o el estado del jugador. */
  setActivity(kind: string | null, k: number, grabbing: boolean, evaOn: boolean) {
    const L = this.rest(0), R = this.rest(1);
    const t = this.t;
    if (evaOn) {
      // EVA: manos visibles abajo, sujetando el mando de la unidad de maniobra
      L.visible = R.visible = true;
      L.wrist.set(-0.2, -0.27, -0.36); R.wrist.set(0.2, -0.27, -0.36);
      L.aim.set(-0.3, 0.25, 0.2); R.aim.set(-0.3, -0.25, -0.2); L.curl = R.curl = 0.8;
    }
    if (grabbing) { R.visible = true; R.wrist.set(0.16, -0.12, -0.42); R.aim.set(0.2, 0, 0); R.curl = 1; }
    switch (kind) {
      case 'drink': {
        const up = smoothstep(0, 0.35, k) * (1 - smoothstep(0.85, 1, k));
        R.visible = true; R.prop = 'pouch'; R.curl = 0.75;
        R.wrist.set(0.13 - 0.08 * up, -0.27 + 0.17 * up, -0.44 + 0.12 * up); R.aim.set(-0.2 + 0.9 * up, 0.3, 0);
        break;
      }
      case 'eat': {
        L.visible = R.visible = true; L.prop = 'tray'; L.curl = 0.6; R.curl = 0.85;
        L.wrist.set(-0.12, -0.3, -0.42); L.aim.set(0.25, 0.4, 0);
        const bite = Math.max(0, Math.sin(t * 3.2)) * smoothstep(0.1, 0.25, k) * (1 - smoothstep(0.85, 1, k));
        R.wrist.set(0.06, -0.28 + 0.16 * bite, -0.42 + 0.12 * bite); R.aim.set(0.3 + 0.6 * bite, -0.2, 0);
        break;
      }
      case 'exercise': {
        L.visible = R.visible = true; L.curl = R.curl = 1;
        const pump = Math.sin(t * 7.5) * 0.012;
        L.wrist.set(-0.19, -0.22 + pump, -0.48); R.wrist.set(0.19, -0.22 - pump, -0.48);
        L.aim.set(0.1, 0.2, 0.5); R.aim.set(0.1, -0.2, -0.5);
        break;
      }
      case 'hygiene': {
        L.visible = R.visible = true; R.prop = 'wipe'; R.curl = 0.5; L.curl = 0.4;
        const w = Math.sin(t * 6);
        R.wrist.set(0.06 + 0.05 * w, -0.12 + 0.03 * Math.cos(t * 6), -0.3); R.aim.set(0.9, 0, 0.3 * w);
        L.wrist.set(-0.16, -0.32, -0.4); L.aim.set(0.1, 0.2, 0);
        break;
      }
      case 'plants': case 'sample': case 'science': {
        L.visible = R.visible = true; L.curl = R.curl = kind === 'science' ? 0.55 : 0.45;
        const wig = Math.sin(t * 2.4) * 0.03;
        const fw = kind === 'science' ? -0.5 : -0.46;
        L.wrist.set(-0.12 + wig, -0.2, fw); R.wrist.set(0.12 - wig, -0.2 + wig * 0.5, fw);
        L.aim.set(-0.35, 0.15, 0); R.aim.set(-0.35, -0.15, 0);
        break;
      }
      case 'read': {
        L.visible = R.visible = true; L.prop = 'board'; L.curl = 0.7; R.curl = 0.3;
        L.wrist.set(-0.1, -0.24, -0.4); L.aim.set(0.6, 0.3, 0);
        R.wrist.set(0.1, -0.2, -0.38 + Math.sin(t * 1.5) * 0.02); R.aim.set(0.4, -0.2, 0);
        break;
      }
      case 'sleep': {
        R.visible = true; R.curl = 0.6; R.wrist.set(0.1, -0.1 + 0.1 * smoothstep(0, 0.3, k), -0.35); R.aim.set(0.9, 0, 0); break;
      }
    }
    this.target = [L, R];
  }

  update(dt: number, cam: THREE.Camera, reduced: boolean) {
    this.t += dt;
    if (this.pulse) {
      this.pulse.t += dt;
      const u = this.pulse.t / this.pulse.dur;
      const tp = this.target[this.pulse.i];
      const a = Math.sin(Math.min(1, u) * Math.PI);
      tp.visible = true;
      tp.wrist.lerpVectors(this.pulse.i === 0 ? new THREE.Vector3(-0.22, -0.4, -0.3) : new THREE.Vector3(0.22, -0.4, -0.3), this.pulse.w, a);
      tp.aim.set(-0.1, 0, 0); tp.curl = 0.25 + 0.4 * (1 - a);
      if (u >= 1) this.pulse = null;
    }
    this.group.position.copy(cam.position);
    this.group.quaternion.copy(cam.quaternion);
    const k = reduced ? 30 : 11;
    this.hands.forEach((h, i) => {
      const tp = this.target[i];
      const goal = tp.visible ? tp.wrist : HIDDEN[i];
      h.wrist.set(damp(h.wrist.x, goal.x, k, dt), damp(h.wrist.y, goal.y, k, dt), damp(h.wrist.z, goal.z, k, dt));
      h.vis = damp(h.vis, tp.visible ? 1 : 0, 8, dt);
      const qg = new THREE.Quaternion().setFromEuler(tp.aim);
      h.q.slerp(qg, clamp(dt * k, 0, 1));
      h.curl = damp(h.curl, tp.curl, 9, dt);
      // mano
      h.hand.position.copy(h.wrist);
      h.hand.quaternion.copy(h.q);
      for (const f of h.fingers) { f.rotation.x = -h.curl * 0.9; (f.getObjectByName('j') as THREE.Object3D).rotation.x = -h.curl * 1.1; }
      h.thumb.rotation.x = -h.curl * 0.6;
      for (const [name, o] of Object.entries(h.props)) o.visible = tp.visible && tp.prop === name;
      // antebrazo: del «hombro» a la muñeca (por detrás de la mano)
      const sh = SHOULDER[i];
      const elbowTo = h.wrist.clone().add(new THREE.Vector3(0, 0, 0.045).applyQuaternion(h.q));
      const dir = elbowTo.clone().sub(sh);
      const len = dir.length();
      h.arm.position.copy(sh);
      h.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      h.arm.scale.set(1, len, 1);
      h.root.visible = h.vis > 0.02;
    });
  }

  dispose() {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    [this.skin, this.sleeve, this.cuff, this.glove, this.gauntlet].forEach((m) => m.dispose());
    this.group.removeFromParent();
  }
}

function smoothstep(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
