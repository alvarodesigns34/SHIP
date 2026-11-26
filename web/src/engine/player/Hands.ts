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
import { damp, clamp, b2t } from '../util';

export type HandPose = {
  wrist: THREE.Vector3;
  aim: THREE.Euler;
  /** Orientación exacta en espacio del padre (prioritaria sobre `aim` en modo nave). */
  quat?: THREE.Quaternion | null;
  curl: number;
  /** índice extendido para pulsar interruptores / pantallas (0 = igual que curl, 1 = señalar) */
  point?: number;
  visible: boolean;
  prop?: 'pouch' | 'tray' | 'board' | 'wipe' | null;
};

export interface FlightStickInput {
  tx: number;
  ty: number;
  tz: number;
  throttle: number;
  pitch: number;
  yaw: number;
  roll: number;
}

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

/** Construye un cuaternión ortonormal derecho a partir de ejes aproximados de antebrazo (+Z) y dorso (+Y). */
function basisFromForearmBack(zForearm: THREE.Vector3, yBackHint: THREE.Vector3, out = new THREE.Quaternion()) {
  const z = zForearm.clone().normalize();
  const x = new THREE.Vector3().crossVectors(yBackHint, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export class Hands {
  group = new THREE.Group();
  private hands: HandRig[] = [];
  private eva = false;
  loaded = false;
  attachMode: 'camera' | 'ship' = 'camera';
  private shipRoot: THREE.Object3D | null = null;
  private seatSide = 0.78;
  private snapNext = false;
  target: HandPose[] = [this.rest(0), this.rest(1)];
  t = 0;
  private pulse: { i: number; w: THREE.Vector3; q: THREE.Quaternion | null; space: 'camera' | 'ship'; t: number; dur: number } | null = null;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private thumbAxisL = new THREE.Vector3(-0.18, 0.88, -0.44).normalize();
  private thumbAxisR = new THREE.Vector3(0.18, 0.88, 0.44).normalize();

  // Orientaciones base ortonormales en espacio local de nave (Three.js: +X proa, +Y cenit, +Z estribor)
  // Mano izquierda (THC barra horizontal en T): antebrazo hacia popa/abajo convergiendo ligeramente al hombro (+Z), dorso arriba, palma abajo envolviendo la T.
  private readonly thcBaseQ = basisFromForearmBack(
    new THREE.Vector3(-0.95, -0.20, 0.14),
    new THREE.Vector3(-0.20, 0.95, -0.18),
  );
  // Mano derecha (RHC palanca vertical sidestick): antebrazo hacia popa/abajo convergiendo ligeramente al hombro (-Z), dorso a estribor (+Z), palma a babor (-Z), pulgar arriba (+Y).
  private readonly rhcBaseQ = basisFromForearmBack(
    new THREE.Vector3(-0.95, -0.20, -0.14),
    new THREE.Vector3(0.08, 0.18, 0.98),
  );

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
    return { wrist: HIDDEN[i].clone(), aim: new THREE.Euler(), quat: null, curl: 0.35, point: 0, visible: false };
  }

  /** Acopla las manos al sistema de referencia de la nave/asiento (NO siguen la cámara al girar la cabeza). */
  attachToShip(shipRoot: THREE.Object3D) {
    if (this.attachMode === 'ship' && this.shipRoot === shipRoot && this.group.parent === shipRoot) return;
    shipRoot.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.group.scale.set(1, 1, 1);
    this.attachMode = 'ship';
    this.shipRoot = shipRoot;
    this.pulse = null;
    this.snapNext = true;
  }

  /** Acopla las manos al espacio de cámara (actividades de pie/flotando, alcance de interruptores, EVA). */
  attachToCamera(worldScene: THREE.Object3D) {
    if (this.attachMode === 'camera' && this.group.parent === worldScene) return;
    worldScene.add(this.group);
    this.attachMode = 'camera';
    this.shipRoot = null;
    this.pulse = null;
    this.snapNext = true;
    for (let i = 0; i < 2; i++) {
      this.hands[i].wrist.copy(HIDDEN[i]);
      this.hands[i].vis = 0;
    }
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

  /** Ancla la mano i a un punto en espacio de cámara (p. ej. un controlador físico). */
  anchor(i: number, pCam: THREE.Vector3, curl = 0.85) {
    const t = this.target[i];
    t.visible = true; t.wrist.copy(pCam); t.quat = null; t.curl = curl; t.point = 0; t.prop = null;
    t.aim.set(-0.35, i === 0 ? 0.18 : -0.18, i === 0 ? 0.25 : -0.25);
  }

  /** Oculta ambas manos (salvo un alcance en curso). */
  hideAll() {
    for (const t of this.target) {
      t.visible = false;
      t.prop = null;
      t.quat = null;
    }
  }

  /**
   * Coloca ambas manos en espacio LOCAL DE NAVE agarrando físicamente los controladores del asiento:
   * - Mano izquierda (0): empuñadura en T del controlador de traslación (THC, `habitat.py` babor del asiento).
   * - Mano derecha (1): empuñadura vertical del sidestick de rotación (RHC, `habitat.py` estribor del asiento).
   * Los antebrazos descansan sobre los reposabrazos apuntando hacia los hombros; girar la cabeza no mueve las manos.
   */
  setSeatedControls(seatSide: number, input: FlightStickInput) {
    this.seatSide = seatSide;
    const breath = Math.sin(this.t * 1.4) * 0.0018;

    // --- 1. MANO IZQUIERDA sobre THC (barra horizontal en T en Blender (7.80, seatSide + 0.30, -0.305))
    const thcGrip = b2t(7.80, seatSide + 0.30, -0.302);
    const txOff = clamp(input.tx * 0.022 + input.throttle * 0.014, -0.024, 0.028);
    const tyOff = clamp(input.ty * 0.015, -0.018, 0.018);
    const tzOff = clamp(input.tz * 0.015, -0.018, 0.018);
    thcGrip.x += txOff;
    thcGrip.y += tyOff + breath;
    thcGrip.z += tzOff;

    const qL = this.thcBaseQ.clone();
    // ligero cabeceo de muñeca al empujar/tirar del THC
    const qTiltL = this.tmpQ.setFromEuler(new THREE.Euler(-txOff * 3.8, -tzOff * 2.5, 0, 'XYZ'));
    qL.multiply(qTiltL);
    // desplazar desde el centro de la barra T hasta la articulación de la muñeca:
    // centro de palma en espacio local de Hand_L = (0, -0.024, -0.080)
    const palmOffL = this.tmpV.set(0, -0.024, -0.080).applyQuaternion(qL);
    const wristL = thcGrip.clone().sub(palmOffL);

    // --- 2. MANO DERECHA sobre RHC sidestick (Blender base (7.80, seatSide - 0.30, -0.47), pivote z=-0.43, agarre z=-0.308)
    const rhcPivot = b2t(7.80, seatSide - 0.30, -0.43);
    const rhcGrip = b2t(7.796, seatSide - 0.30, -0.308);
    rhcGrip.y -= breath;

    // deflexión angular del sidestick alrededor de la rótula inferior
    const pitchAng = clamp(input.pitch * 0.14, -0.16, 0.16);
    const rollAng = clamp(-input.roll * 0.14, -0.16, 0.16);
    const yawAng = clamp(input.yaw * 0.10, -0.12, 0.12);
    const qStick = this.tmpQ2.setFromEuler(new THREE.Euler(rollAng, yawAng, pitchAng, 'ZXY'));

    const qR = qStick.clone().multiply(this.rhcBaseQ);
    // centro de palma en espacio local de Hand_R = (0, -0.020, -0.090) -> cierra dedos a ras sobre el mango vertical
    const palmOffR = this.tmpV2.set(0, -0.020, -0.090).applyQuaternion(qR);
    const wristRRest = rhcGrip.clone().sub(palmOffR);
    const wristR = wristRRest.sub(rhcPivot).applyQuaternion(qStick).add(rhcPivot);

    const L = this.target[0];
    const R = this.target[1];
    L.visible = true;
    L.wrist.copy(wristL);
    L.quat = qL;
    L.curl = 0.94;
    L.point = 0;
    L.prop = null;

    R.visible = true;
    R.wrist.copy(wristR);
    R.quat = qR;
    R.curl = 0.95;
    R.point = 0;
    R.prop = null;
  }

  /** Alcanzar un punto (espacio de cámara) con el dedo índice extendido y volver. */
  reach(pCam: THREE.Vector3, dur = 0.58) {
    const i = pCam.x < 0 ? 0 : 1;
    const w = pCam.clone().multiplyScalar(0.84);
    w.z = clamp(w.z, -0.58, -0.26);
    w.y = clamp(w.y, -0.28, 0.16);
    this.pulse = { i, w, q: null, space: 'camera', t: 0, dur };
  }

  /** Alcanza un punto en espacio MUNDO (funciona tanto sentado en modo nave como de pie/flotando en modo cámara). */
  reachWorld(worldPos: THREE.Vector3, cam: THREE.Camera, dur = 0.56) {
    if (this.attachMode === 'ship' && this.shipRoot) {
      const pShip = this.shipRoot.worldToLocal(worldPos.clone());
      // elegir la mano del lado más cercano al interruptor/pantalla respecto al eje del asiento
      const seatZ = -this.seatSide;
      const i = pShip.z < seatZ ? 0 : 1;
      const anchor = this.target[i].wrist.clone();
      // limitar el estiramiento máximo para mantener postura natural del brazo
      const dir = pShip.clone().sub(anchor);
      const dist = dir.length();
      if (dist > 0.62) dir.multiplyScalar(0.62 / dist);
      // retroceder ~14 cm desde el interruptor para que la punta del índice lo toque sin atravesarlo
      const reachLen = Math.max(0.05, dir.length() - 0.14);
      const w = anchor.clone().add(dir.normalize().multiplyScalar(reachLen));
      const forearmDir = anchor.clone().sub(w);
      if (forearmDir.lengthSq() < 1e-4) forearmDir.set(-1, -0.2, 0);
      const q = basisFromForearmBack(forearmDir, new THREE.Vector3(0, 1, i === 0 ? -0.25 : 0.25));
      this.pulse = { i, w, q, space: 'ship', t: 0, dur };
    } else {
      this.reach(cam.worldToLocal(worldPos.clone()), dur);
    }
  }

  /** Devuelve posición y rotación en espacio MUNDO de la palma de la mano `i` (para acoplar objetos físicos reales). */
  palmWorldTransform(i: number, outPos: THREE.Vector3, outQuat?: THREE.Quaternion): boolean {
    const h = this.hands[i];
    if (!h || !this.loaded) return false;
    this.group.updateMatrixWorld(true);
    outPos.set(0, -0.032, -0.092).applyMatrix4(h.root.matrixWorld);
    if (outQuat) h.root.getWorldQuaternion(outQuat);
    return true;
  }

  /** Pose continua según la actividad, estado del jugador o pilotaje sentado (modo cámara). */
  setActivity(kind: string | null, k: number, grabbing: boolean, evaOn: boolean, seated = false, externalProp = false) {
    const L = this.rest(0), R = this.rest(1);
    const t = this.t;
    if (evaOn) {
      L.visible = R.visible = true;
      L.wrist.set(-0.22, -0.26, -0.34); R.wrist.set(0.22, -0.26, -0.34);
      L.aim.set(-0.22, 0.25, 0.32); R.aim.set(-0.22, -0.25, -0.32);
      L.curl = R.curl = 0.78;
    } else if (seated && !kind) {
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
        R.visible = true; R.prop = externalProp ? null : 'pouch'; R.curl = 0.88;
        R.wrist.set(0.14 - 0.06 * up, -0.25 + 0.12 * up, -0.37 + 0.06 * up);
        R.aim.set(-0.12 + 0.55 * up, 0.32, -0.92);
        break;
      }
      case 'eat': {
        L.visible = R.visible = true; L.prop = externalProp ? null : 'tray'; L.curl = 0.45; R.curl = 0.82;
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
        L.visible = R.visible = true; R.prop = externalProp ? null : 'wipe'; R.curl = 0.58; L.curl = 0.35;
        const w = Math.sin(t * 6);
        R.wrist.set(0.07 + 0.05 * w, -0.14 + 0.03 * Math.cos(t * 6), -0.30);
        R.aim.set(0.82, 0.1, -0.4 + 0.28 * w);
        L.wrist.set(-0.18, -0.30, -0.38); L.aim.set(0.1, 0.2, 0.2);
        break;
      }
      case 'plants': case 'sample': case 'science': {
        L.visible = R.visible = true; L.curl = R.curl = kind === 'science' ? 0.55 : 0.42;
        L.point = R.point = externalProp ? 0.15 : 0.4;
        const wig = Math.sin(t * 2.4) * 0.025;
        const fw = kind === 'science' ? -0.46 : -0.42;
        L.wrist.set(-0.13 + wig, -0.20, fw); R.wrist.set(0.13 - wig, -0.20 + wig * 0.5, fw);
        L.aim.set(-0.30, 0.20, 0.35); R.aim.set(-0.30, -0.20, -0.35);
        break;
      }
      case 'read': case 'tablet': {
        L.visible = R.visible = true; L.prop = externalProp ? null : 'board'; L.curl = 0.65; R.curl = 0.45; R.point = 0.85;
        L.wrist.set(-0.14, -0.24, -0.38); L.aim.set(0.45, 0.28, 0.32);
        R.wrist.set(0.11, -0.20, -0.34 + Math.sin(t * 1.5) * 0.018); R.aim.set(0.32, -0.25, -0.35);
        break;
      }
      case 'photo': {
        L.visible = R.visible = true; L.curl = 0.72; R.curl = 0.78; R.point = 0.35;
        L.wrist.set(-0.13, -0.16, -0.34); L.aim.set(0.25, 0.28, 0.38);
        R.wrist.set(0.13, -0.16, -0.34); R.aim.set(0.25, -0.28, -0.38);
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
    if (this.pulse && this.pulse.space === this.attachMode) {
      this.pulse.t += dt;
      const u = this.pulse.t / this.pulse.dur;
      const tp = this.target[this.pulse.i];
      const a = Math.sin(Math.min(1, u) * Math.PI);
      tp.visible = true;
      if (this.pulse.space === 'ship') {
        const basePos = tp.wrist.clone();
        const baseQ = (tp.quat ?? new THREE.Quaternion().setFromEuler(tp.aim)).clone();
        tp.wrist.lerpVectors(basePos, this.pulse.w, a);
        if (this.pulse.q) tp.quat = baseQ.slerp(this.pulse.q, a);
        tp.curl = 0.82 - 0.18 * a;
        tp.point = a;
      } else {
        const base = this.pulse.i === 0 ? new THREE.Vector3(-0.22, -0.38, -0.26) : new THREE.Vector3(0.22, -0.38, -0.26);
        tp.wrist.lerpVectors(base, this.pulse.w, a);
        tp.quat = null;
        tp.aim.set(-0.08, this.pulse.i === 0 ? 0.12 : -0.12, this.pulse.i === 0 ? 0.15 : -0.15);
        tp.curl = 0.65;
        tp.point = a;
      }
      if (u >= 1) this.pulse = null;
    }

    if (this.attachMode === 'camera') {
      this.group.position.copy(cam.position);
      this.group.quaternion.copy(cam.quaternion);
    }

    const snap = this.snapNext;
    this.snapNext = false;
    const k = reduced ? 30 : 14;
    this.hands.forEach((h, i) => {
      const tp = this.target[i];
      const goal = tp.visible ? tp.wrist : (this.attachMode === 'ship' ? h.wrist : HIDDEN[i]);
      const qg = tp.quat ? this.tmpQ.copy(tp.quat) : this.tmpQ.setFromEuler(tp.aim);

      if (snap && tp.visible) {
        h.wrist.copy(goal);
        h.q.copy(qg);
        h.curl = tp.curl;
        h.point = tp.point ?? 0;
        h.vis = 1;
      } else {
        h.wrist.set(damp(h.wrist.x, goal.x, k, dt), damp(h.wrist.y, goal.y, k, dt), damp(h.wrist.z, goal.z, k, dt));
        h.vis = damp(h.vis, tp.visible ? 1 : 0, 10, dt);
        h.q.slerp(qg, clamp(dt * k, 0, 1));
        h.curl = damp(h.curl, tp.curl, 12, dt);
        h.point = damp(h.point, tp.point ?? 0, 14, dt);
      }

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
    void this.tmpM;
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
