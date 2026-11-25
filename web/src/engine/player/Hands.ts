/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Manos y antebrazos anatómicos articulados en primera persona (25 huesos por mano).
 *
 * Activo: `public/models/hands_fp.glb` construido a partir de manos anatómicas
 * WebXR riggeadas (licencia MIT, immersive-web/webxr-input-profiles) con:
 *   - Malla anatómica continua (SkinnedMesh) + cinemática directa exacta sobre los 25 huesos
 *   - Manga textil Varro-Lindqvist con puño acanalado y banda bermellón
 *   - Guante presurizado EVA inflado sobre el MISMO esqueleto de 25 huesos
 *   - Objetos 3D detallados: bolsa de bebida de aluminio sellada con pajita curva,
 *     bandeja de comida con sobres y cuchara, tableta de vuelo iluminada y paño textil.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { damp, clamp } from '../util';

export type HandPose = {
  wrist: THREE.Vector3;
  aim: THREE.Euler;
  curl: number;
  /** índice extendido para pulsar interruptores / pantallas (0 = igual que curl, 1 = señalar) */
  point?: number;
  visible: boolean;
  prop?: 'pouch' | 'tray' | 'board' | 'wipe' | null;
};

const HIDDEN = [new THREE.Vector3(-0.34, -0.78, -0.22), new THREE.Vector3(0.34, -0.78, -0.22)];

interface BoneChain {
  bones: (THREE.Bone | undefined)[];
  p0: (THREE.Vector3 | undefined)[];
  q0: (THREE.Quaternion | undefined)[];
}

interface HandRig {
  root: THREE.Group;
  skinMesh: THREE.Object3D | null;
  evaGlove: THREE.Object3D | null;
  sleeve: THREE.Object3D | null;
  evaGauntlet: THREE.Object3D | null;
  fingers: BoneChain[]; // [index, middle, ring, pinky] -> [prox, inter, dist, tip]
  thumb: BoneChain;     // [meta, prox, dist, tip]
  wrist: THREE.Vector3;
  q: THREE.Quaternion;
  curl: number;
  point: number;
  side: number; // -1 = left, +1 = right
  vis: number;
  props: Record<string, THREE.Object3D>;
}

const FINGER_NAMES = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const;
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class Hands {
  group = new THREE.Group();
  private hands: HandRig[] = [];
  private eva = false;
  private loaded = false;
  target: HandPose[] = [this.rest(0), this.rest(1)];
  t = 0;
  private pulse: { i: number; w: THREE.Vector3; t: number; dur: number } | null = null;
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private thumbAxisL = new THREE.Vector3(-0.18, 0.88, -0.44).normalize();
  private thumbAxisR = new THREE.Vector3(0.18, 0.88, 0.44).normalize();

  constructor(modelUrl = 'models/hands_fp.glb') {
    this.group.name = 'FirstPersonHands';
    this.group.renderOrder = 10;
    for (let s = 0; s < 2; s++) {
      const root = new THREE.Group();
      root.visible = false;
      this.group.add(root);
      this.hands.push({
        root, skinMesh: null, evaGlove: null, sleeve: null, evaGauntlet: null,
        fingers: [], thumb: { bones: [], p0: [], q0: [] },
        wrist: HIDDEN[s].clone(), q: new THREE.Quaternion(), curl: 0.35, point: 0,
        side: s === 0 ? -1 : 1, vis: 0, props: {},
      });
    }
    this.loadRig(modelUrl);
  }

  private async loadRig(url: string) {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      for (let s = 0; s < 2; s++) {
        const tag = s === 0 ? 'L' : 'R';
        const srcRoot = gltf.scene.getObjectByName(`Hand_${tag}`);
        if (!srcRoot) continue;
        const h = this.hands[s];
        h.root.add(srcRoot);

        srcRoot.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.frustumCulled = false;
            m.castShadow = false;
            m.receiveShadow = true;
            m.renderOrder = 10;
          }
        });

        h.skinMesh = srcRoot.getObjectByName(`SkinHand_${tag}`) ?? null;
        h.evaGlove = srcRoot.getObjectByName(`EVAGlove_${tag}`) ?? null;
        h.sleeve = srcRoot.getObjectByName(`Sleeve_${tag}`) ?? null;
        h.evaGauntlet = srcRoot.getObjectByName(`EVAGauntlet_${tag}`) ?? null;

        // Collect all 25 anatomical bones inside this side's Armature (handles glTF sanitized names!)
        const boneMap = new Map<string, THREE.Bone>();
        srcRoot.traverse((o) => {
          if ((o as THREE.Bone).isBone) boneMap.set(o.name, o as THREE.Bone);
        });
        const findBone = (base: string) => {
          for (const [k, b] of boneMap) {
            if (k === base || k.startsWith(base)) return b;
          }
          return undefined;
        };
        const makeChain = (names: string[]): BoneChain => {
          const bones = names.map(findBone);
          return {
            bones,
            p0: bones.map((b) => b?.position.clone()),
            q0: bones.map((b) => b?.quaternion.clone()),
          };
        };

        h.fingers = FINGER_NAMES.map((fn) =>
          makeChain([`${fn}-phalanx-proximal`, `${fn}-phalanx-intermediate`, `${fn}-phalanx-distal`, `${fn}-tip`])
        );
        h.thumb = makeChain(['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']);

        // Held 3D props inside Props_L / Props_R — hide ALL children unconditionally first!
        const propsNode = srcRoot.getObjectByName(`Props_${tag}`);
        if (propsNode) {
          for (const child of propsNode.children) {
            child.visible = false;
            for (const pname of ['prop_pouch', 'prop_tray', 'prop_board', 'prop_wipe'] as const) {
              if (child.name.startsWith(pname)) {
                h.props[pname.replace('prop_', '')] = child;
              }
            }
          }
        }
      }
      this.loaded = true;
      this.applyEVAMode();
    } catch (err) {
      console.warn('[Hands] fallback: failed to load hands_fp.glb', err);
    }
  }

  private rest(i: number): HandPose {
    return { wrist: HIDDEN[i].clone(), aim: new THREE.Euler(), curl: 0.35, point: 0, visible: false };
  }

  private applyEVAMode() {
    for (const h of this.hands) {
      if (h.skinMesh) h.skinMesh.visible = !this.eva;
      if (h.sleeve) h.sleeve.visible = !this.eva;
      if (h.evaGlove) h.evaGlove.visible = this.eva;
      if (h.evaGauntlet) h.evaGauntlet.visible = this.eva;
    }
  }

  setEVA(on: boolean) {
    if (on === this.eva) return;
    this.eva = on;
    if (this.loaded) this.applyEVAMode();
  }

  /** Alcanzar un punto (espacio de cámara) con el dedo índice extendido y volver. */
  reach(pCam: THREE.Vector3, dur = 0.58) {
    const i = pCam.x < 0 ? 0 : 1;
    const w = pCam.clone().multiplyScalar(0.84);
    w.z = clamp(w.z, -0.58, -0.26);
    w.y = clamp(w.y, -0.28, 0.16);
    this.pulse = { i, w, t: 0, dur };
  }

  /** Pose continua según la actividad, estado del jugador o pilotaje sentado. */
  setActivity(kind: string | null, k: number, grabbing: boolean, evaOn: boolean, seated = false) {
    const L = this.rest(0), R = this.rest(1);
    const t = this.t;
    if (evaOn) {
      L.visible = R.visible = true;
      L.wrist.set(-0.22, -0.26, -0.34); R.wrist.set(0.22, -0.26, -0.34);
      L.aim.set(-0.22, 0.25, 0.32); R.aim.set(-0.22, -0.25, -0.32);
      L.curl = R.curl = 0.78;
    } else if (seated && !kind) {
      // Manos reposando limpiamente en la zona inferior sobre THC (izq.) y RHC (dcha.)
      const sway = Math.sin(t * 1.1) * 0.003;
      L.visible = R.visible = true;
      L.wrist.set(-0.26, -0.33 + sway, -0.33); R.wrist.set(0.25, -0.31 - sway, -0.32);
      L.aim.set(-0.18, 0.22, 0.38); R.aim.set(-0.14, -0.22, -0.78);
      L.curl = 0.78; R.curl = 0.88;
    }
    if (grabbing) {
      R.visible = true; R.wrist.set(0.17, -0.14, -0.40); R.aim.set(0.15, -0.15, -0.45); R.curl = 0.95;
    }
    switch (kind) {
      case 'drink': {
        const up = smoothstep(0, 0.35, k) * (1 - smoothstep(0.85, 1, k));
        R.visible = true; R.prop = 'pouch'; R.curl = 0.88;
        R.wrist.set(0.14 - 0.06 * up, -0.25 + 0.12 * up, -0.37 + 0.06 * up);
        R.aim.set(-0.12 + 0.55 * up, 0.32, -0.92);
        break;
      }
      case 'eat': {
        L.visible = R.visible = true; L.prop = 'tray'; L.curl = 0.45; R.curl = 0.82;
        L.wrist.set(-0.14, -0.28, -0.40); L.aim.set(0.18, 0.32, 0.15);
        const bite = Math.max(0, Math.sin(t * 3.2)) * smoothstep(0.1, 0.25, k) * (1 - smoothstep(0.85, 1, k));
        R.wrist.set(0.08, -0.26 + 0.15 * bite, -0.38 + 0.10 * bite);
        R.aim.set(0.25 + 0.55 * bite, -0.22, -0.5);
        break;
      }
      case 'exercise': {
        L.visible = R.visible = true; L.curl = R.curl = 0.95;
        const pump = Math.sin(t * 7.5) * 0.014;
        L.wrist.set(-0.20, -0.22 + pump, -0.44); R.wrist.set(0.20, -0.22 - pump, -0.44);
        L.aim.set(0.1, 0.2, 0.45); R.aim.set(0.1, -0.2, -0.45);
        break;
      }
      case 'hygiene': {
        L.visible = R.visible = true; R.prop = 'wipe'; R.curl = 0.58; L.curl = 0.35;
        const w = Math.sin(t * 6);
        R.wrist.set(0.07 + 0.05 * w, -0.14 + 0.03 * Math.cos(t * 6), -0.30);
        R.aim.set(0.82, 0.1, -0.4 + 0.28 * w);
        L.wrist.set(-0.18, -0.30, -0.38); L.aim.set(0.1, 0.2, 0.2);
        break;
      }
      case 'plants': case 'sample': case 'science': {
        L.visible = R.visible = true; L.curl = R.curl = kind === 'science' ? 0.55 : 0.42;
        L.point = R.point = 0.4;
        const wig = Math.sin(t * 2.4) * 0.025;
        const fw = kind === 'science' ? -0.46 : -0.42;
        L.wrist.set(-0.13 + wig, -0.20, fw); R.wrist.set(0.13 - wig, -0.20 + wig * 0.5, fw);
        L.aim.set(-0.30, 0.20, 0.35); R.aim.set(-0.30, -0.20, -0.35);
        break;
      }
      case 'read': {
        L.visible = R.visible = true; L.prop = 'board'; L.curl = 0.65; R.curl = 0.45; R.point = 0.85;
        L.wrist.set(-0.12, -0.24, -0.38); L.aim.set(0.45, 0.28, 0.32);
        R.wrist.set(0.11, -0.20, -0.34 + Math.sin(t * 1.5) * 0.018); R.aim.set(0.32, -0.25, -0.35);
        break;
      }
      case 'sleep': {
        R.visible = true; R.curl = 0.55;
        R.wrist.set(0.12, -0.12 + 0.08 * smoothstep(0, 0.3, k), -0.34);
        R.aim.set(0.8, 0, -0.3);
        break;
      }
    }
    this.target = [L, R];
  }

  /**
   * Cinemática directa exacta en el espacio del Armature sobre huesos planos WebXR:
   * gira cada falange y traslada las falanges distales + punta alrededor de cada nudillo.
   */
  private applyChainFK(ch: BoneChain, axis: THREE.Vector3, angles: [number, number, number]) {
    const b0 = ch.bones[0], p0 = ch.p0[0], q0 = ch.q0[0];
    if (!b0 || !p0 || !q0) return;

    let cumAng = angles[0];
    this.tmpQ.setFromAxisAngle(axis, cumAng);
    b0.position.copy(p0);
    b0.quaternion.copy(this.tmpQ).multiply(q0);

    let prevPos = b0.position;
    for (let j = 1; j < ch.bones.length; j++) {
      const bj = ch.bones[j], pj = ch.p0[j], pjPrev = ch.p0[j - 1], qj = ch.q0[j];
      if (!bj || !pj || !pjPrev || !qj) break;
      // Trasladar el hueso j rotando su vector de segmento desde el hueso anterior con la rotación acumulada actual
      this.tmpV.copy(pj).sub(pjPrev).applyQuaternion(this.tmpQ);
      bj.position.copy(prevPos).add(this.tmpV);
      if (j < 3) {
        cumAng += angles[j];
        this.tmpQ.setFromAxisAngle(axis, cumAng);
      }
      bj.quaternion.copy(this.tmpQ).multiply(qj);
      prevPos = bj.position;
    }
  }

  /** Flexión anatómica real en las 3 falanges + punta de cada dedo y oposición del pulgar. */
  private poseSkeleton(h: HandRig) {
    // En Armature_R, dedos -> -Y, palma -> -X => rotación NEGATIVA en +Z flexiona hacia la palma!
    // En Armature_L, dedos -> -Y, palma -> +X => rotación POSITIVA en +Z flexiona hacia la palma!
    const curlSign = h.side > 0 ? -1 : 1;
    h.fingers.forEach((f, idx) => {
      const fCurl = idx === 0
        ? h.curl * (1 - h.point)
        : clamp(h.curl + h.point * 0.35 + idx * 0.04, 0, 1.05);
      this.applyChainFK(f, AXIS_Z, [
        fCurl * 0.92 * curlSign,
        fCurl * 1.12 * curlSign,
        fCurl * 0.72 * curlSign,
      ]);
    });
    const tc = clamp(h.curl * 0.85 + h.point * 0.2, 0, 1);
    const tAxis = h.side > 0 ? this.thumbAxisR : this.thumbAxisL;
    this.applyChainFK(h.thumb, tAxis, [
      tc * 0.42 * curlSign,
      tc * 0.55 * curlSign,
      tc * 0.45 * curlSign,
    ]);
  }

  update(dt: number, cam: THREE.Camera, reduced: boolean) {
    this.t += dt;
    if (this.pulse) {
      this.pulse.t += dt;
      const u = this.pulse.t / this.pulse.dur;
      const tp = this.target[this.pulse.i];
      const a = Math.sin(Math.min(1, u) * Math.PI);
      tp.visible = true;
      const base = this.pulse.i === 0 ? new THREE.Vector3(-0.22, -0.38, -0.26) : new THREE.Vector3(0.22, -0.38, -0.26);
      tp.wrist.lerpVectors(base, this.pulse.w, a);
      tp.aim.set(-0.08, this.pulse.i === 0 ? 0.12 : -0.12, this.pulse.i === 0 ? 0.15 : -0.15);
      tp.curl = 0.65;
      tp.point = a;
      if (u >= 1) this.pulse = null;
    }
    this.group.position.copy(cam.position);
    this.group.quaternion.copy(cam.quaternion);

    const k = reduced ? 30 : 12;
    this.hands.forEach((h, i) => {
      const tp = this.target[i];
      const goal = tp.visible ? tp.wrist : HIDDEN[i];
      h.wrist.set(damp(h.wrist.x, goal.x, k, dt), damp(h.wrist.y, goal.y, k, dt), damp(h.wrist.z, goal.z, k, dt));
      h.vis = damp(h.vis, tp.visible ? 1 : 0, 9, dt);
      const qg = new THREE.Quaternion().setFromEuler(tp.aim);
      h.q.slerp(qg, clamp(dt * k, 0, 1));
      h.curl = damp(h.curl, tp.curl, 10, dt);
      h.point = damp(h.point, tp.point ?? 0, 12, dt);

      h.root.position.copy(h.wrist);
      h.root.quaternion.copy(h.q);
      h.root.visible = this.loaded && h.vis > 0.02;

      if (h.root.visible) {
        this.poseSkeleton(h);
        for (const [name, o] of Object.entries(h.props)) {
          o.visible = tp.visible && tp.prop === name;
        }
      }
    });
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const ms = Array.isArray(m.material) ? m.material : [m.material];
        ms.forEach((mm) => mm?.dispose());
      }
    });
    this.group.removeFromParent();
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
