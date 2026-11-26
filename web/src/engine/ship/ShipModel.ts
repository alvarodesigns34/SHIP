/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Modelo de la nave sobre THREE.BatchedMesh preservando identidad de cada pieza,
 * canal UV1 para lightmaps horneados en Cycles, atenuación dinámica por bahía
 * vinculada a los interruptores de cabina, y actualización optimizada sin GC.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { b2tv, stageOf } from '../util';
import { enhanceMaterial } from './materialsLib';

export type Sector = 'ext' | 'int';

export interface MechDef {
  type: 'hinge' | 'slide';
  pivot: THREE.Vector3;
  axis: THREE.Vector3;
  min: number;
  max: number;
  rest: number;
  id: string;
  speed: number;
  value: number;
  target: number;
}

export interface PartNode {
  code: string;
  label: string;
  desc: string;
  func: string;
  kind: 'group' | 'part';
  depth: number;
  obj: THREE.Object3D;
  parent: PartNode | null;
  children: PartNode[];
  ex: THREE.Vector3;
  base: THREE.Matrix4;
  center0: THREE.Vector3;
  box0: THREE.Box3;
  meshes: THREE.Mesh[];
  materials: { name: string; desc: string }[];
  tris: number;
  parts: number;
  sector: Sector;
  hidden: boolean;
  mech: MechDef | null;
  ctl: string | null;
  inspect: boolean;
  /** explosión local adicional (explosión de subsistema) */
  localEx: number;
}

interface Inst { batch: Batch; id: number; mesh: THREE.Mesh; node: PartNode; }
interface Batch { key: string; bm: THREE.BatchedMesh; material: THREE.Material; xray: THREE.Material; insts: Inst[]; sector: Sector; }

export const SECTION = { on: { value: 0 }, capA: { value: new THREE.Color(0xe2572b) }, capB: { value: new THREE.Color(0x7a2a12) } };

/**
 * Intensidades de luz en tiempo real por bahía [A, B, C, D, Nodo/Esclusa] que modulan
 * dinámicamente el lightmap horneado en Cycles cuando el usuario acciona los interruptores LT_A..LT_N.
 */
export const BAY_LIGHTS = {
  /** [Bay A Cockpit, Bay B Lab, Bay C Quarters, Bay D Services, Node+Airlock] */
  value: [1.0, 1.0, 1.0, 1.0, 1.0],
};

/** Cascos interiores del sector 'ext' que también tienen UVMap_LM horneado en Cycles. */
const INNER_SHELL_CODES = new Set([
  'HAB.STR.CON', 'HAB.STR.DOM',
  'FWD.STR.BRL', 'FWD.STR.BHF', 'FWD.STR.BHA', 'FWD.STR.CPR',
  'FWD.ALK.STR', 'FWD.ALK.HO.DOOR', 'FWD.ALK.HO.FRM',
]);

function patchMaterial(m: THREE.Material, emissiveByColor: boolean, hasBakedLM: boolean) {
  if (m.userData.alcPatched) return;
  m.userData.alcPatched = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uSection = SECTION.on;
    sh.uniforms.uCapA = SECTION.capA;
    sh.uniforms.uCapB = SECTION.capB;
    sh.uniforms.uBayLight = BAY_LIGHTS;

    if (hasBakedLM) {
      // Pasamos la coordenada X en espacio de la nave (misma dirección X en Blender y Three.js)
      // para atenuar el lightmap horneado de cada bahía según su interruptor físico LT_A..LT_N!
      sh.vertexShader = 'varying float vShipX;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 alcPos = vec4(transformed, 1.0);
         #ifdef USE_BATCHING
           alcPos = batchingMatrix * alcPos;
         #endif
         vShipX = alcPos.x;`
      );
      sh.fragmentShader = 'uniform float uBayLight[5];\nvarying float vShipX;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <lightmap_fragment>',
        `#include <lightmap_fragment>
         #ifdef USE_LIGHTMAP
           // Mezcla suave entre bahías contiguas (D < 2.65, C < 4.70, B < 6.75, A < 9.60, Nodo >= 9.60)
           float wD = 1.0 - smoothstep(2.40, 2.90, vShipX);
           float wC = smoothstep(2.40, 2.90, vShipX) * (1.0 - smoothstep(4.45, 4.95, vShipX));
           float wB = smoothstep(4.45, 4.95, vShipX) * (1.0 - smoothstep(6.50, 7.00, vShipX));
           float wA = smoothstep(6.50, 7.00, vShipX) * (1.0 - smoothstep(9.20, 9.85, vShipX));
           float wN = smoothstep(9.20, 9.85, vShipX);
           float bayGain = wD * uBayLight[3] + wC * uBayLight[2] + wB * uBayLight[1] + wA * uBayLight[0] + wN * uBayLight[4];
           // Mantener un tenue rebote de luz de emergencia/pantallas (0.09) cuando una bahía se apaga
           reflectedLight.indirectDiffuse *= mix(0.09, 1.0, clamp(bayGain, 0.0, 1.25));
         #endif`
      );
    }

    sh.fragmentShader = 'uniform float uSection; uniform vec3 uCapA; uniform vec3 uCapB;\n' + sh.fragmentShader;
    if (emissiveByColor) {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor;\n#endif'
      );
    }
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      if (uSection > 0.5 && !gl_FrontFacing) { float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 14.0)); gl_FragColor = vec4(mix(uCapA, uCapB, s) * 0.85, 1.0); }`
    );
  };
  m.customProgramCacheKey = () => `alc-${emissiveByColor ? 'em' : 'std'}-${hasBakedLM ? 'lm' : 'nolm'}`;
}

function xrayMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0x9fb6d4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      gl_FragColor = vec4(vec3(0.62, 0.71, 0.83) * (fr + 0.025), fr * 0.55 + 0.025);`
    );
  };
  m.customProgramCacheKey = () => 'xray';
  return m;
}

/**
 * Convierte cualquier geometría (incluida la cuantizada con meshopt) a un formato
 * común para los BatchedMesh, PRESERVANDO el canal `uv1` (TEXCOORD_1) de lightmaps Cycles!
 */
function normalizeGeometry(g: THREE.BufferGeometry, includeUV1: boolean): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
  }
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (nor) for (let i = 0; i < n; i++) {
    N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i);
  }
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < n; i++) {
    U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i);
  }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));

  if (includeUV1) {
    const U1 = new Float32Array(n * 2);
    const uv1 = g.attributes.uv1 as THREE.BufferAttribute | undefined;
    if (uv1) {
      for (let i = 0; i < n; i++) { U1[i * 2] = uv1.getX(i); U1[i * 2 + 1] = uv1.getY(i); }
    } else {
      // Punto neutro luminoso (0.004, 0.004) en el atlas para piezas sin UV1
      for (let i = 0; i < n; i++) { U1[i * 2] = 0.004; U1[i * 2 + 1] = 0.004; }
    }
    out.setAttribute('uv1', new THREE.BufferAttribute(U1, 2));
  }

  const idx = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!nor) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const STANDALONE_MAT = /^M_Screen/;

export type ExplodePreset = 'all' | 'hull' | 'interior' | 'service' | 'power';

export class ShipModel {
  root = new THREE.Group();
  rig = new THREE.Object3D();
  nodes = new Map<string, PartNode>();
  top: PartNode | null = null;
  batches: Batch[] = [];
  standalone: { mesh: THREE.Mesh; src: THREE.Mesh; node: PartNode }[] = [];
  proxies = new THREE.Group();
  mechs = new Map<string, PartNode>();
  controls = new Map<string, PartNode[]>();
  explode = 0;
  explodePreset: ExplodePreset = 'all';
  xray = false;
  selected: PartNode | null = null;
  isolate: PartNode | null = null;
  interiorLoaded = false;
  extra = new Map<string, THREE.Matrix4>();
  hideExteriorSkin = false;
  showInterior = true;
  private dirty = true;
  private visDirty = true;
  private lastHideSkin = false;
  private lastShowInt = true;
  private instByMesh = new Map<THREE.Mesh, Inst[]>();
  stats = { batches: 0, instances: 0, tris: 0 };

  constructor() {
    this.root.add(this.proxies);
  }

  async load(base: string, onProgress: (s: string, p: number) => void) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const ext = await loader.loadAsync(base + 'alcion_hx4_exterior.glb', (e) => onProgress('Estructura exterior', e.total ? e.loaded / e.total : 0));
    onProgress('Construyendo lotes de dibujado', 1);
    this.ingest(ext.scene, 'ext');
    return loader;
  }

  async loadInterior(loader: GLTFLoader, base: string) {
    const int = await loader.loadAsync(base + 'alcion_hx4_interior.glb');
    this.ingest(int.scene, 'int');
    this.interiorLoaded = true;
  }

  private ingest(gscene: THREE.Group, sector: Sector) {
    const rootObj = gscene.getObjectByName('ALCION') ?? gscene.children[0];
    if (sector === 'ext') {
      this.rig.add(rootObj);
    } else {
      for (const pn of ['HAB', 'FWD']) {
        const src = gscene.getObjectByName(pn);
        const dst = this.nodes.get(pn)?.obj;
        if (!src || !dst) continue;
        for (const ch of [...src.children]) dst.add(ch);
      }
    }
    const fresh: PartNode[] = [];
    const register = (o: THREE.Object3D, parent: PartNode | null) => {
      const ud: any = o.userData ?? {};
      let node: PartNode | null = parent;
      if (ud.code && !this.nodes.has(ud.code)) {
        const exb = ud.ex ?? [0, 0, 0];
        o.updateMatrix();
        node = {
          code: ud.code, label: ud.label ?? ud.code, desc: ud.desc ?? '', func: ud.func ?? '', kind: ud.kind === 'part' ? 'part' : 'group',
          depth: ud.depth ?? 0, obj: o, parent, children: [], ex: b2tv(exb), base: o.matrix.clone(), center0: new THREE.Vector3(), box0: new THREE.Box3(),
          meshes: [], materials: [], tris: 0, parts: 0, sector, hidden: false, mech: null, ctl: ud.ctl ?? null, inspect: !!ud.inspect, localEx: 0,
        };
        if (ud.mech) {
          const m = ud.mech;
          node.mech = { type: m.type, pivot: b2tv(m.pivot), axis: b2tv(m.axis).normalize(), min: m.min, max: m.max, rest: m.rest, id: m.id, speed: m.speed ?? 1, value: m.rest, target: m.rest };
          this.mechs.set(m.id, node);
        }
        if (node.ctl) {
          if (!this.controls.has(node.ctl)) this.controls.set(node.ctl, []);
          this.controls.get(node.ctl)!.push(node);
        }
        o.matrixAutoUpdate = false;
        this.nodes.set(ud.code, node);
        fresh.push(node);
        if (parent) parent.children.push(node); else this.top = node;
      } else if (ud.code) node = this.nodes.get(ud.code)!;
      for (const ch of o.children) register(ch, node);
    };
    if (sector === 'ext') register(rootObj, null);
    else for (const pn of ['HAB', 'FWD']) {
      const p = this.nodes.get(pn)!;
      for (const ch of p.obj.children) {
        if (!this.nodes.has((ch.userData as any)?.code) || this.nodes.get((ch.userData as any).code)!.obj !== ch) register(ch, p);
      }
    }
    this.rig.updateMatrixWorld(true);

    const groups = new Map<string, { mat: THREE.Material; lm: boolean; items: { mesh: THREE.Mesh; node: PartNode }[] }>();
    const nodeOf = (o: THREE.Object3D | null): PartNode | null => {
      while (o) { const c = (o.userData as any)?.code; if (c && this.nodes.has(c)) return this.nodes.get(c)!; o = o.parent; }
      return null;
    };
    rootObj.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    const scan = sector === 'ext' ? [rootObj] : fresh.filter((n) => n.parent && !fresh.includes(n.parent)).map((n) => n.obj);
    for (const s of scan) s.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

    for (const mesh of meshes) {
      const node = nodeOf(mesh);
      if (!node) continue;
      // Interior sector + inner pressure shells receive Cycles baked lightmap via uv1!
      const wantLM = false as boolean;
      const mat = enhanceMaterial(mesh.material as THREE.Material, wantLM) as THREE.MeshStandardMaterial;
      mesh.material = mat;
      mesh.visible = false;

      if (STANDALONE_MAT.test(mat.name) || (node.ctl ?? '').startsWith('scr:')) {
        const m2 = new THREE.Mesh(mesh.geometry, mat);
        m2.matrixAutoUpdate = false;
        m2.castShadow = false; m2.receiveShadow = false;
        m2.userData.node = node;
        patchMaterial(mat, false, false);
        this.root.add(m2);
        this.standalone.push({ mesh: m2, src: mesh, node });
        continue;
      }
      const key = `${sector}:${wantLM ? 'lm' : 'std'}:${mat.name}`;
      if (!groups.has(key)) groups.set(key, { mat, lm: wantLM, items: [] });
      groups.get(key)!.items.push({ mesh, node });
    }

    for (const [key, { mat, lm, items }] of groups) {
      const geos = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
      let v = 0, i = 0;
      for (const it of items) {
        if (!geos.has(it.mesh.geometry)) {
          const ng = normalizeGeometry(it.mesh.geometry, lm);
          geos.set(it.mesh.geometry, ng);
          v += ng.attributes.position.count; i += ng.index!.count;
        }
      }
      const emissive = /^M_(LED|NavLight|Screen|CrewAtlasEmit)/.test(mat.name) || ((mat as THREE.MeshStandardMaterial).emissiveIntensity > 0 && (mat as any).emissive?.getHex?.() > 0);
      patchMaterial(mat, emissive, !!(mat as any).userData?.hasBakedLM);
      const bm = new THREE.BatchedMesh(items.length + geos.size + 8, v, i, mat);
      bm.castShadow = !(mat as any).userData?.glass;
      bm.receiveShadow = true;
      bm.perObjectFrustumCulled = true;
      bm.sortObjects = !!(mat as THREE.Material).transparent;
      bm.renderOrder = (mat as THREE.Material).transparent ? 2 : 0;
      const gid = new Map<THREE.BufferGeometry, number>();
      for (const [src, ng] of geos) gid.set(src, bm.addGeometry(ng));
      const batch: Batch = { key, bm, material: mat, xray: xrayMaterial(), insts: [], sector };
      const col = new THREE.Color();
      const variant = /^M_(Shield|BetaCloth|MLI|Interior|Fabric|Radiator|Dish)/.test(mat.name);
      for (const it of items) {
        const id = bm.addInstance(gid.get(it.mesh.geometry)!);
        bm.setMatrixAt(id, it.mesh.matrixWorld);
        if (variant) {
          const h = hash(it.node.code);
          col.setRGB(0.95 + 0.05 * h, 0.95 + 0.05 * hash(it.node.code + 'g') * 0.9 + 0.05 * h * 0.1, 0.94 + 0.06 * hash(it.node.code + 'b') * 0.8);
        } else col.setRGB(1, 1, 1);
        bm.setColorAt(id, col);
        const inst: Inst = { batch, id, mesh: it.mesh, node: it.node };
        batch.insts[id] = inst;
        if (!this.instByMesh.has(it.mesh)) this.instByMesh.set(it.mesh, []);
        this.instByMesh.get(it.mesh)!.push(inst);
        this.stats.instances++;
      }
      bm.userData.batch = batch;
      this.root.add(bm);
      this.batches.push(batch);
      this.stats.batches++;
    }
    this.computeBoxes();
    this.dirty = true;
    this.visDirty = true;
  }

  private computeBoxes() {
    const saved = this.explode;
    this.explode = 0;
    this.applyTransforms(true);
    const visit = (n: PartNode) => {
      n.box0.makeEmpty(); n.meshes = []; n.tris = 0; n.parts = n.kind === 'part' ? 1 : 0;
      const mats = new Map<string, string>();
      n.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        n.meshes.push(m);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        n.box0.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
        const idx = m.geometry.index;
        n.tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
        const mm = m.material as THREE.Material;
        if (mm.name && !mats.has(mm.name)) mats.set(mm.name, (mm as any).userData?.desc ?? '');
      });
      n.materials = [...mats.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name));
      n.box0.getCenter(n.center0);
      for (const c of n.children) { visit(c); n.parts += c.parts; }
    };
    if (this.top) visit(this.top);
    this.stats.tris = this.top ? this.top.tris : 0;
    this.explode = saved;
    this.applyTransforms(true);
  }

  // ------------------------------------------------------------ transformaciones sin asignaciones por fotograma
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private tmp3 = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  private presetMatches(code: string): boolean {
    switch (this.explodePreset) {
      case 'all': return true;
      case 'hull': return code.startsWith('HAB.MMOD') || code.startsWith('HAB.MLI') || code.startsWith('FWD.MMOD') || code.startsWith('FWD.CUP');
      case 'interior': return code.startsWith('HAB.INT') || code.startsWith('HAB.UTL') || code.startsWith('FWD.INT') || code.startsWith('HAB.MMOD');
      case 'service': return code.startsWith('SVC') || code.startsWith('PRP');
      case 'power': return code.startsWith('PWR') || code.startsWith('THR') || code.startsWith('COM') || code.startsWith('RBT');
    }
  }

  private composeLocal(n: PartNode) {
    let k = (n.parent && this.explode > 0 && this.presetMatches(n.code)) ? stageOf(n.depth, this.explode) : 0;
    let exk = k;
    let a: PartNode | null = n.parent;
    while (a) { if (a.localEx > 0) { exk = Math.max(exk, a.localEx); break; } a = a.parent; }
    const m = n.obj.matrix;
    m.copy(n.base);
    const mech = n.mech;
    if (mech && Math.abs(mech.value) > 1e-6) {
      if (mech.type === 'hinge') {
        this.q.setFromAxisAngle(mech.axis, mech.value);
        this.tmp.makeTranslation(mech.pivot.x, mech.pivot.y, mech.pivot.z)
          .multiply(this.tmp2.makeRotationFromQuaternion(this.q))
          .multiply(this.tmp3.makeTranslation(-mech.pivot.x, -mech.pivot.y, -mech.pivot.z));
      } else {
        this.tmp.makeTranslation(mech.axis.x * mech.value, mech.axis.y * mech.value, mech.axis.z * mech.value);
      }
      m.premultiply(this.tmp);
    }
    const ex = this.extra.get(n.code);
    if (ex) m.premultiply(ex);
    if (exk > 0) m.premultiply(this.tmp.makeTranslation(n.ex.x * exk, n.ex.y * exk, n.ex.z * exk));
    n.obj.matrixWorldNeedsUpdate = true;
  }

  markDirty() { this.dirty = true; }
  /** Invalida sólo la rama de `n` (mecanismos, brazo, radiadores). */
  markNodeDirty(n: PartNode | undefined | null) { if (n) this.dirtyNodes.add(n); }
  private dirtyNodes = new Set<PartNode>();
  private subtreeInsts = new Map<PartNode, Inst[]>();
  private subtreeStandalone = new Map<PartNode, { mesh: THREE.Mesh; src: THREE.Mesh; node: PartNode }[]>();
  /** número de matrices de instancia escritas en el último fotograma (instrumentación) */
  lastMatrixWrites = 0;
  private instsUnder(n: PartNode) {
    let l = this.subtreeInsts.get(n);
    if (!l) {
      const set = new Set<THREE.Mesh>();
      n.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) set.add(o as THREE.Mesh); });
      l = [];
      for (const m of set) for (const it of this.instByMesh.get(m) ?? []) l.push(it);
      this.subtreeInsts.set(n, l);
      this.subtreeStandalone.set(n, this.standalone.filter((s) => set.has(s.src)));
    }
    return l;
  }
  markVisDirty() { this.visDirty = true; }

  applyTransforms(force = false) {
    this.lastMatrixWrites = 0;
    if (!this.dirty && !force && this.dirtyNodes.size) {
      // actualización parcial: sólo las ramas invalidadas (sin recorrer las ~800 piezas)
      const roots = [...this.dirtyNodes].filter((n) => { for (let p = n.parent; p; p = p.parent) if (this.dirtyNodes.has(p)) return false; return true; });
      for (const n of roots) {
        n.obj.traverse((o) => { const c = (o.userData as any)?.code; const nn = c ? this.nodes.get(c) : null; if (nn && nn.obj === o) this.composeLocal(nn); });
        n.obj.updateMatrixWorld(true);
        for (const it of this.instsUnder(n)) { it.batch.bm.setMatrixAt(it.id, it.mesh.matrixWorld); this.lastMatrixWrites++; }
        for (const st of this.subtreeStandalone.get(n) ?? []) st.mesh.matrix.copy(st.src.matrixWorld);
      }
      for (const p of this.proxies.children as THREE.Mesh[]) p.matrix.copy((p.userData.src as THREE.Mesh).matrixWorld);
      this.dirtyNodes.clear();
      return true;
    }
    this.dirtyNodes.clear();
    if (!this.dirty && !force) return false;
    for (const n of this.nodes.values()) this.composeLocal(n);
    this.rig.updateMatrixWorld(true);
    for (const b of this.batches) {
      for (const it of b.insts) if (it) { b.bm.setMatrixAt(it.id, it.mesh.matrixWorld); this.lastMatrixWrites++; }
    }
    for (const s of this.standalone) s.mesh.matrix.copy(s.src.matrixWorld);
    for (const p of this.proxies.children as THREE.Mesh[]) p.matrix.copy((p.userData.src as THREE.Mesh).matrixWorld);
    this.dirty = false;
    return true;
  }

  /** Fija una transformación adicional (brazo, radiadores) invalidando sólo si cambia. */
  setExtra(code: string, m: THREE.Matrix4) {
    const cur = this.extra.get(code);
    if (cur && cur.equals(m)) return;
    if (cur) cur.copy(m); else this.extra.set(code, m.clone());
    this.markNodeDirty(this.nodes.get(code));
  }

  setExplode(t: number, preset?: ExplodePreset) {
    this.explode = t;
    if (preset) this.explodePreset = preset;
    this.dirty = true;
  }

  setExplodePreset(preset: ExplodePreset) {
    this.explodePreset = preset;
    this.dirty = true;
  }

  stepMechs(dt: number) {
    let act = 0;
    for (const n of this.mechs.values()) {
      const m = n.mech!;
      const d = m.target - m.value;
      if (Math.abs(d) < 1e-4) { if (m.value !== m.target) { m.value = m.target; this.markNodeDirty(n); } continue; }
      const step = Math.sign(d) * Math.min(Math.abs(d), m.speed * dt);
      m.value += step;
      this.markNodeDirty(n);
      if (!n.code.includes('TGL') && !n.code.includes('.L')) act = Math.max(act, 1);
      else act = Math.max(act, 0.25);
    }
    return act;
  }

  mech(id: string) { return this.mechs.get(id)?.mech ?? null; }
  setMech(id: string, target: number, instant = false) {
    const m = this.mech(id);
    if (!m) return;
    m.target = Math.min(m.max, Math.max(m.min, target));
    if (instant) { m.value = m.target; this.markNodeDirty(this.mechs.get(id)); }
  }
  toggleMech(id: string) {
    const m = this.mech(id);
    if (!m) return false;
    const open = Math.abs(m.target - m.rest) < 1e-3 ? (Math.abs(m.min - m.rest) > Math.abs(m.max - m.rest) ? m.min : m.max) : m.rest;
    m.target = open;
    return open !== m.rest;
  }

  // ------------------------------------------------------------ visibilidad (sólo se recalcula cuando cambia!)
  /** Estructura oculta bajo la piel exterior (casco presurizado, isogrid, MLI, soportes): sólo en ingeniería. */
  private innerPrefixes = ['HAB.STR', 'HAB.MLI', 'HAB.MMOD.R1.STO', 'HAB.MMOD.R2.STO', 'HAB.MMOD.R3.STO', 'HAB.MMOD.R4.STO'];
  private isInner(n: PartNode) { return this.innerPrefixes.some((p) => n.code === p || n.code.startsWith(p + '.')); }
  profile: 'immersive' | 'engineering' = 'immersive';
  setProfile(p: 'immersive' | 'engineering') { if (p !== this.profile) { this.profile = p; this.visDirty = true; } }
  /** visibilidad global del exterior (p. ej. interior sin ventanas a la vista) */
  setShown(v: boolean) { for (const b of this.batches) b.bm.visible = v && (b.sector === 'ext' || this.showInterior); for (const s of this.standalone) s.mesh.visible = v; }

  /** Sincroniza visibilidad exterior/interior sin ensuciar cada fotograma. */
  setInteriorVisibility(hideSkin: boolean, showInt: boolean) {
    if (hideSkin !== this.lastHideSkin || showInt !== this.lastShowInt) {
      this.hideExteriorSkin = hideSkin;
      this.showInterior = showInt;
      this.lastHideSkin = hideSkin;
      this.lastShowInt = showInt;
      this.visDirty = true;
    }
  }

  updateVisibility() {
    if (!this.visDirty) return;
    const keep = this.isolate ? new Set(this.isolate.meshes) : null;
    const selected = this.selected ? new Set(this.selected.meshes) : null;
    const hiddenBy = (n: PartNode) => { let p: PartNode | null = n; while (p) { if (p.hidden) return true; p = p.parent; } return false; };
    for (const b of this.batches) {
      b.bm.visible = b.sector === 'ext' || this.showInterior;
      b.bm.material = this.xray ? b.xray : b.material;
      b.bm.castShadow = !this.xray && !(b.material as any).userData?.glass;
      for (const it of b.insts) {
        if (!it) continue;
        let v = !hiddenBy(it.node) && (!keep || keep.has(it.mesh));
        if (this.profile === 'immersive' && this.isInner(it.node)) v = false;
        if (selected && selected.has(it.mesh)) v = false;
        b.bm.setVisibleAt(it.id, v);
      }
    }
    for (const s of this.standalone) s.mesh.visible = !hiddenBy(s.node) && (!keep || keep.has(s.src)) && (s.node.sector === 'ext' || this.showInterior);
    for (const p of [...this.proxies.children]) this.proxies.remove(p);
    if (this.selected) {
      for (const m of this.selected.meshes) {
        if (!this.instByMesh.has(m)) continue;
        if (hiddenBy(this.nodeOfMesh(m)!) || (keep && !keep.has(m))) continue;
        const p = new THREE.Mesh(m.geometry, m.material);
        p.matrixAutoUpdate = false;
        p.matrix.copy(m.matrixWorld);
        p.userData.src = m;
        p.castShadow = true; p.receiveShadow = true;
        this.proxies.add(p);
      }
    }
    this.visDirty = false;
  }

  nodeOfMesh(m: THREE.Mesh): PartNode | null {
    let o: THREE.Object3D | null = m;
    while (o) { const c = (o.userData as any)?.code; if (c && this.nodes.has(c)) return this.nodes.get(c)!; o = o.parent; }
    return null;
  }

  setXray(on: boolean) { this.xray = on; this.visDirty = true; }
  select(n: PartNode | null) { this.selected = n; this.visDirty = true; }
  setIsolate(n: PartNode | null) { this.isolate = n; this.visDirty = true; }
  setHidden(n: PartNode, h: boolean) { n.hidden = h; this.visDirty = true; }
  showAll() { for (const n of this.nodes.values()) n.hidden = false; this.isolate = null; this.visDirty = true; }

  setNodeColor(n: PartNode, c: THREE.Color) {
    for (const m of n.meshes) for (const it of this.instByMesh.get(m) ?? []) it.batch.bm.setColorAt(it.id, c);
  }

  // ------------------------------------------------------------ selección y plano de corte
  clip: THREE.Plane | null = null;

  pick(raycaster: THREE.Raycaster): { node: PartNode; point: THREE.Vector3; dist: number } | null {
    const objs: THREE.Object3D[] = [
      ...this.batches.filter((b) => b.bm.visible).map((b) => b.bm),
      ...this.standalone.filter((s) => s.mesh.visible).map((s) => s.mesh),
      ...this.proxies.children,
    ];
    const hits = raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      if (SECTION.on.value > 0.5 && this.clip && this.clip.distanceToPoint(h.point) < 0) continue;
      const obj = h.object as any;
      if (obj.userData?.batch && h.batchId != null) {
        const inst = (obj.userData.batch as Batch).insts[h.batchId];
        if (inst) return { node: inst.node, point: h.point.clone(), dist: h.distance };
      }
      if (obj.userData?.node) return { node: obj.userData.node as PartNode, point: h.point.clone(), dist: h.distance };
      if (obj.userData?.src) {
        const n = this.nodeOfMesh(obj.userData.src as THREE.Mesh);
        if (n) return { node: n, point: h.point.clone(), dist: h.distance };
      }
    }
    return null;
  }

  currentBox(n: PartNode) {
    const b = new THREE.Box3();
    for (const m of n.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    }
    return b;
  }

  /** Caja local (espacio nave) de cada pieza interior, para colisionadores. */
  partBoxes(filter: (n: PartNode) => boolean) {
    const out: { node: PartNode; box: THREE.Box3 }[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind !== 'part' || !filter(n)) continue;
      const b = this.currentBox(n);
      if (!b.isEmpty()) out.push({ node: n, box: b });
    }
    return out;
  }

  setClip(plane: THREE.Plane | null) {
    this.clip = plane;
    SECTION.on.value = plane ? 1 : 0;
    const planes = plane ? [plane] : [];
    for (const b of this.batches) {
      b.material.clippingPlanes = planes;
      b.material.side = plane ? THREE.DoubleSide : (b.material.name === 'M_Leaf' ? THREE.DoubleSide : THREE.FrontSide);
      b.xray.clippingPlanes = planes;
    }
    for (const s of this.standalone) (s.mesh.material as THREE.Material).clippingPlanes = planes;
  }
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
