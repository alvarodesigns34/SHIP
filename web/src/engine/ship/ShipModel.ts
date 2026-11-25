/**
 * Modelo de la nave para el motor.
 *
 * Jerarquía lógica completa (nave → módulo → sistema → conjunto → pieza) en un
 * «rig» de transformaciones que NO se dibuja. El dibujado se hace con
 * THREE.BatchedMesh: un lote por material y sector (exterior/interior), con
 * una instancia por primitiva. Cada instancia conserva su identidad
 * (instancia → pieza), de modo que la selección, el aislamiento, la vista
 * explosionada y los mecanismos siguen funcionando pieza a pieza con una
 * sola llamada de dibujo por material.
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

function patchMaterial(m: THREE.Material, emissiveByColor: boolean) {
  if (m.userData.alcPatched) return;
  m.userData.alcPatched = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uSection = SECTION.on;
    sh.uniforms.uCapA = SECTION.capA;
    sh.uniforms.uCapB = SECTION.capB;
    sh.fragmentShader = 'uniform float uSection; uniform vec3 uCapA; uniform vec3 uCapB;\n' + sh.fragmentShader;
    if (emissiveByColor) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor;\n#endif');
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (uSection > 0.5 && !gl_FrontFacing) { float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 14.0)); gl_FragColor = vec4(mix(uCapA, uCapB, s) * 0.85, 1.0); }`);
  };
  m.customProgramCacheKey = () => (emissiveByColor ? 'alc-em' : 'alc');
}

function xrayMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x9fb6d4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      gl_FragColor = vec4(vec3(0.62, 0.71, 0.83) * (fr + 0.025), fr * 0.55 + 0.025);`);
  };
  m.customProgramCacheKey = () => 'xray';
  return m;
}

/** Convierte cualquier geometría (incluida la cuantizada) a un formato común para los lotes. */
function normalizeGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (nor) for (let i = 0; i < n; i++) { N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i); }
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (uv) for (let i = 0; i < n; i++) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  const idx = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!nor) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const STANDALONE_MAT = /^M_Screen/;

export class ShipModel {
  /** raíz de dibujado (se mueve con la nave) */
  root = new THREE.Group();
  /** rig lógico de transformaciones (no se dibuja) */
  rig = new THREE.Object3D();
  nodes = new Map<string, PartNode>();
  top: PartNode | null = null;
  batches: Batch[] = [];
  standalone: { mesh: THREE.Mesh; src: THREE.Mesh; node: PartNode }[] = [];
  proxies = new THREE.Group();
  mechs = new Map<string, PartNode>();
  controls = new Map<string, PartNode[]>();
  explode = 0;
  xray = false;
  selected: PartNode | null = null;
  isolate: PartNode | null = null;
  interiorLoaded = false;
  /** matrices adicionales de mecanismos especiales (brazo, radiadores) */
  extra = new Map<string, THREE.Matrix4>();
  hideExteriorSkin = false;
  showInterior = true;
  private dirty = true;
  private visDirty = true;
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
    else for (const pn of ['HAB', 'FWD']) { const p = this.nodes.get(pn)!; for (const ch of p.obj.children) if (!this.nodes.has((ch.userData as any)?.code) || this.nodes.get((ch.userData as any).code)!.obj !== ch) register(ch, p); }
    this.rig.updateMatrixWorld(true);
    // reunir mallas por material
    const groups = new Map<string, { mat: THREE.Material; items: { mesh: THREE.Mesh; node: PartNode }[] }>();
    const nodeOf = (o: THREE.Object3D | null): PartNode | null => { while (o) { const c = (o.userData as any)?.code; if (c && this.nodes.has(c)) return this.nodes.get(c)!; o = o.parent; } return null; };
    rootObj.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    const scan = sector === 'ext' ? [rootObj] : fresh.filter((n) => n.parent && !fresh.includes(n.parent)).map((n) => n.obj);
    for (const s of scan) s.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const mesh of meshes) {
      const node = nodeOf(mesh);
      if (!node) continue;
      const mat = enhanceMaterial(mesh.material as THREE.Material) as THREE.MeshStandardMaterial;
      mesh.material = mat;
      mesh.visible = false;
      if (STANDALONE_MAT.test(mat.name) || (node.ctl ?? '').startsWith('scr:')) {
        const m2 = new THREE.Mesh(mesh.geometry, mat);
        m2.matrixAutoUpdate = false;
        m2.castShadow = false; m2.receiveShadow = false;
        m2.userData.node = node;
        patchMaterial(mat, false);
        this.root.add(m2);
        this.standalone.push({ mesh: m2, src: mesh, node });
        continue;
      }
      const key = sector + ':' + mat.name;
      if (!groups.has(key)) groups.set(key, { mat, items: [] });
      groups.get(key)!.items.push({ mesh, node });
    }
    for (const [key, { mat, items }] of groups) {
      const geos = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
      let v = 0, i = 0;
      for (const it of items) {
        if (!geos.has(it.mesh.geometry)) {
          const ng = normalizeGeometry(it.mesh.geometry);
          geos.set(it.mesh.geometry, ng);
          v += ng.attributes.position.count; i += ng.index!.count;
        }
      }
      const emissive = /^M_(LED|NavLight|Screen)/.test(mat.name) || (mat as THREE.MeshStandardMaterial).emissiveIntensity > 0 && (mat as any).emissive?.getHex?.() > 0;
      patchMaterial(mat, emissive);
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
        // variación sutil entre piezas: lote de fabricación, exposición UV, polvo
        if (variant) {
          const h = hash(it.node.code);
          col.setRGB(0.94 + 0.06 * h, 0.94 + 0.06 * hash(it.node.code + 'g') * 0.9 + 0.06 * h * 0.1, 0.93 + 0.07 * hash(it.node.code + 'b') * 0.8);
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

  // ------------------------------------------------------------ transformaciones
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  /** local = T(explosión) · R(mecanismo) · M(base) */
  private composeLocal(n: PartNode) {
    const k = n.parent ? stageOf(n.depth, this.explode) : 0;
    let exk = k;
    // explosión de subsistema: un antecesor con localEx > 0 separa su rama
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
          .multiply(new THREE.Matrix4().makeTranslation(-mech.pivot.x, -mech.pivot.y, -mech.pivot.z));
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
  markVisDirty() { this.visDirty = true; }

  applyTransforms(force = false) {
    if (!this.dirty && !force) return false;
    for (const n of this.nodes.values()) this.composeLocal(n);
    this.rig.updateMatrixWorld(true);
    for (const b of this.batches) for (const it of b.insts) if (it) b.bm.setMatrixAt(it.id, it.mesh.matrixWorld);
    for (const s of this.standalone) s.mesh.matrix.copy(s.src.matrixWorld);
    for (const p of this.proxies.children as THREE.Mesh[]) p.matrix.copy((p.userData.src as THREE.Mesh).matrixWorld);
    this.dirty = false;
    return true;
  }

  setExplode(t: number) { this.explode = t; this.dirty = true; }

  /** Avanza los mecanismos hacia su objetivo. Devuelve actividad (0..1) para el audio. */
  stepMechs(dt: number) {
    let act = 0;
    for (const n of this.mechs.values()) {
      const m = n.mech!;
      const d = m.target - m.value;
      if (Math.abs(d) < 1e-4) { if (m.value !== m.target) { m.value = m.target; this.dirty = true; } continue; }
      const step = Math.sign(d) * Math.min(Math.abs(d), m.speed * dt);
      m.value += step;
      this.dirty = true;
      if (!n.code.includes('TGL') && !n.code.includes('.L') ) act = Math.max(act, 1);
      else act = Math.max(act, 0.25);
    }
    return act;
  }

  mech(id: string) { return this.mechs.get(id)?.mech ?? null; }
  setMech(id: string, target: number, instant = false) {
    const m = this.mech(id);
    if (!m) return;
    m.target = Math.min(m.max, Math.max(m.min, target));
    if (instant) { m.value = m.target; this.dirty = true; }
  }
  toggleMech(id: string) {
    const m = this.mech(id);
    if (!m) return false;
    const open = Math.abs(m.target - m.rest) < 1e-3 ? (Math.abs(m.min - m.rest) > Math.abs(m.max - m.rest) ? m.min : m.max) : m.rest;
    m.target = open;
    return open !== m.rest;
  }

  // ------------------------------------------------------------ visibilidad
  private skinPrefixes = ['HAB.MMOD', 'HAB.MLI', 'FWD.MMOD', 'SVC.SKN', 'PRP', 'SVC.PRP', 'SVC.STR'];
  private isSkin(n: PartNode) { return this.skinPrefixes.some((p) => n.code === p || n.code.startsWith(p + '.')); }

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
        if (this.hideExteriorSkin && this.isSkin(it.node)) v = false;
        if (selected && selected.has(it.mesh)) v = false; // se dibuja con su proxy
        b.bm.setVisibleAt(it.id, v);
      }
    }
    for (const s of this.standalone) s.mesh.visible = !hiddenBy(s.node) && (!keep || keep.has(s.src)) && (s.node.sector === 'ext' || this.showInterior);
    // proxies de la selección (dibujados con su material original y contorno)
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

  /** Color por instancia (emisión de luminarias/pantallas, variaciones). */
  setNodeColor(n: PartNode, c: THREE.Color) {
    for (const m of n.meshes) for (const it of this.instByMesh.get(m) ?? []) it.batch.bm.setColorAt(it.id, c);
  }

  // ------------------------------------------------------------ selección
  pick(raycaster: THREE.Raycaster): { node: PartNode; point: THREE.Vector3; dist: number } | null {
    const objs: THREE.Object3D[] = [...this.batches.filter((b) => b.bm.visible).map((b) => b.bm), ...this.standalone.filter((s) => s.mesh.visible).map((s) => s.mesh), ...this.proxies.children];
    const hits = raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      if (SECTION.on.value > 0.5 && this.clip && this.clip.distanceToPoint(h.point) < 0) continue;
      let node: PartNode | null = null;
      const bm = h.object as THREE.BatchedMesh;
      if ((bm as any).isBatchedMesh && h.batchId !== undefined) node = (bm.userData.batch as Batch).insts[h.batchId]?.node ?? null;
      else if (h.object.userData.node) node = h.object.userData.node;
      else if (h.object.userData.src) node = this.nodeOfMesh(h.object.userData.src);
      if (this.xray && this.selected && node && !this.selected.meshes.some((m) => node!.meshes.includes(m))) continue;
      if (node) return { node, point: h.point, dist: h.distance };
    }
    return null;
  }
  clip: THREE.Plane | null = null;

  /** Centro actual (con explosión) de un nodo en espacio de nave. */
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

  drawCallsEstimate() { return this.batches.filter((b) => b.bm.visible).length + this.standalone.length + this.proxies.children.length; }
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
