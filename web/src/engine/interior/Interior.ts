/**
 * ALCIÓN HX-4 · REBIRTH — interior inmersivo de tiempo real.
 *
 * Activo propio (`alcion_interior_rt.glb`) derivado del modelo maestro: piezas con
 * identidad (código, estancia, control), canal UV1 con lightmaps horneados por estancia,
 * mecanismos (interruptores, puertas) y pantallas. El volumen es cerrado: no hay que
 * ocultar la piel exterior para "ver dentro" (causa raíz de las dos realidades superpuestas).
 *
 * Colisiones: rejilla de ocupación (vóxeles de 4 cm) rasterizada desde la geometría real
 * al cargar; el controlador del jugador colisiona con ella (cámara nunca atraviesa superficies).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeMaterial, LM_SCALE } from './RMaterials';
import { b2tv } from '../util';

export interface IMech { type: 'hinge' | 'slide'; pivot: THREE.Vector3; axis: THREE.Vector3; min: number; max: number; rest: number; id: string; speed: number; value: number; target: number; }
export interface IPart {
  code: string; label: string; desc: string; room: string; obj: THREE.Object3D; ctl: string | null; mech: IMech | null;
  base: THREE.Matrix4; box: THREE.Box3; meshes: THREE.Mesh[];
}

export const ROOMS: Record<string, { label: string; x0: number; x1: number }> = {
  D: { label: 'Servicios', x0: 0.0, x1: 2.65 },
  C: { label: 'Habitáculos', x0: 2.65, x1: 4.70 },
  B: { label: 'Laboratorio', x0: 4.70, x1: 6.75 },
  A: { label: 'Cabina de vuelo', x0: 6.75, x1: 9.95 },
  N: { label: 'Nodo', x0: 9.95, x1: 12.3 },
};

export class VoxelGrid {
  readonly s = 0.04;
  readonly min = new THREE.Vector3(0.4, -3.7, -2.1);
  readonly nx: number; readonly ny: number; readonly nz: number;
  data: Uint8Array;
  constructor() {
    this.nx = Math.ceil((12.5 - this.min.x) / this.s);
    this.ny = Math.ceil((2.4 - this.min.y) / this.s);
    this.nz = Math.ceil((2.1 - this.min.z) / this.s);
    this.data = new Uint8Array(this.nx * this.ny * this.nz);
  }
  idx(i: number, j: number, k: number) { return i + this.nx * (j + this.ny * k); }
  cell(p: THREE.Vector3, out: [number, number, number]) {
    out[0] = Math.floor((p.x - this.min.x) / this.s); out[1] = Math.floor((p.y - this.min.y) / this.s); out[2] = Math.floor((p.z - this.min.z) / this.s);
    return out;
  }
  get(i: number, j: number, k: number) {
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return 1; // fuera de la rejilla = sólido
    return this.data[this.idx(i, j, k)];
  }
  markPoint(x: number, y: number, z: number, v = 1) {
    const i = Math.floor((x - this.min.x) / this.s), j = Math.floor((y - this.min.y) / this.s), k = Math.floor((z - this.min.z) / this.s);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return;
    this.data[this.idx(i, j, k)] |= v;
  }
  /** Rasteriza un triángulo (muestreo baricéntrico a ≤ s/2). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, v = 1) {
    const lab = a.distanceTo(b), lac = a.distanceTo(c), lbc = b.distanceTo(c);
    const n = Math.max(1, Math.ceil(Math.max(lab, lac, lbc) / (this.s * 0.5)));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, w = j / n, t = 1 - u - w;
        this.markPoint(a.x * t + b.x * u + c.x * w, a.y * t + b.y * u + c.y * w, a.z * t + b.z * u + c.z * w, v);
      }
    }
  }
  /** Punto ocupado más cercano dentro de radio r (distancia a la caja del vóxel). */
  nearest(p: THREE.Vector3, r: number, out: THREE.Vector3, mask = 0xff): number {
    const s = this.s;
    const i0 = Math.floor((p.x - r - this.min.x) / s), i1 = Math.floor((p.x + r - this.min.x) / s);
    const j0 = Math.floor((p.y - r - this.min.y) / s), j1 = Math.floor((p.y + r - this.min.y) / s);
    const k0 = Math.floor((p.z - r - this.min.z) / s), k1 = Math.floor((p.z + r - this.min.z) / s);
    let best = r * r, found = false;
    let bx = 0, by = 0, bz = 0;
    for (let k = k0; k <= k1; k++) {
      const z0 = this.min.z + k * s;
      const cz = p.z < z0 ? z0 : p.z > z0 + s ? z0 + s : p.z;
      const dz = p.z - cz;
      if (dz * dz > best) continue;
      for (let j = j0; j <= j1; j++) {
        const y0 = this.min.y + j * s;
        const cy = p.y < y0 ? y0 : p.y > y0 + s ? y0 + s : p.y;
        const dy = p.y - cy;
        if (dy * dy + dz * dz > best) continue;
        for (let i = i0; i <= i1; i++) {
          if (!(this.get(i, j, k) & mask)) continue;
          const x0 = this.min.x + i * s;
          const cx = p.x < x0 ? x0 : p.x > x0 + s ? x0 + s : p.x;
          const dx = p.x - cx;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bx = cx; by = cy; bz = cz; found = true; }
        }
      }
    }
    if (!found) return Infinity;
    out.set(bx, by, bz);
    return Math.sqrt(best);
  }
}

export class Interior {
  root = new THREE.Group();
  parts = new Map<string, IPart>();
  mechs = new Map<string, IPart>();
  controls: IPart[] = [];
  screens = new Map<string, THREE.Mesh>();
  roomGroups = new Map<string, THREE.Object3D[]>();
  roomBoxes = new Map<string, THREE.Box3>();
  materials: THREE.Material[] = [];
  lightmaps = new Map<string, THREE.Texture>();
  voxels = new VoxelGrid();
  loaded = false;
  stats: { meshes: number; tris: number; voxelMs: number; merged?: number } = { meshes: 0, tris: 0, voxelMs: 0 };
  private probes = new Map<string, THREE.Texture>();

  async load(base: string, onProgress?: (p: number) => void) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(base + 'models/alcion_interior_rt.glb', (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
    const rooms = new Set<string>();
    gltf.scene.traverse((o) => { const r = (o.userData as any)?.room; if (r) rooms.add(r); });
    const tl = new THREE.TextureLoader();
    await Promise.all([...rooms].map((r) => new Promise<void>((res) => {
      tl.load(`${base}textures/lm/lm_${r}.webp`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;
        t.channel = 1;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        this.lightmaps.set(r, t); res();
      }, undefined, () => res());
    })));
    const matCache = new Map<string, THREE.Material>();
    const roomOf = (o: THREE.Object3D | null): string | null => { while (o) { const r = (o.userData as any)?.room; if (r) return r; o = o.parent; } return null; };
    gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const mesh of meshes) {
      const room = roomOf(mesh) ?? 'A';
      const hasLM = !!mesh.geometry.attributes.uv1;
      const srcMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = srcMats.map((sm) => {
        const key = `${room}|${sm.name}|${hasLM}`;
        let m = matCache.get(key);
        if (!m) { m = makeMaterial(sm.name, hasLM ? this.lightmaps.get(room) ?? null : null); matCache.set(key, m); this.materials.push(m); }
        sm.dispose();
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
      const opaque = !out.some((m) => (m as THREE.Material).transparent);
      const backing = out.some((m) => m.name === 'R_Backing');
      mesh.castShadow = opaque && !out.some((m) => (m as any).isMeshBasicMaterial) || backing;
      mesh.receiveShadow = opaque && !backing;
      if (!opaque) mesh.renderOrder = 3;
      mesh.matrixAutoUpdate = false;
      this.stats.meshes++;
      this.stats.tris += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
    }
    // piezas con identidad
    gltf.scene.traverse((o) => {
      const ud = o.userData as any;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      if (!ud?.code) return;
      const ms: THREE.Mesh[] = [];
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) ms.push(c as THREE.Mesh); });
      const p: IPart = { code: ud.code, label: ud.label ?? ud.code, desc: ud.desc ?? '', room: roomOf(o) ?? '', obj: o, ctl: ud.ctl ?? null, mech: null, base: o.matrix.clone(), box: new THREE.Box3().setFromObject(o), meshes: ms };
      if (ud.mech) {
        const m = ud.mech;
        p.mech = { type: m.type, pivot: b2tv(m.pivot), axis: b2tv(m.axis).normalize(), min: m.min, max: m.max, rest: m.rest, id: m.id, speed: m.speed ?? 1, value: m.rest, target: m.rest };
        this.mechs.set(m.id, p);
      }
      if (p.ctl) {
        this.controls.push(p);
        if (p.ctl.startsWith('scr:') && ms[0]) this.screens.set(p.ctl, ms[0]);
      }
      this.parts.set(p.code, p);
      if (p.room) {
        if (!this.roomBoxes.has(p.room)) this.roomBoxes.set(p.room, new THREE.Box3());
        this.roomBoxes.get(p.room)!.union(p.box);
      }
    });
    this.root.add(gltf.scene);
    for (const m of this.mechs.values()) this.applyMech(m);
    const t0 = performance.now();
    this.buildVoxels(meshes);
    this.stats.voxelMs = performance.now() - t0;
    this.mergeStatic(meshes, roomOf);
    this.loaded = true;
  }

  /** Grupos de geometría fusionada por estancia (se desplazan juntos en la vista explosionada). */
  roomMerged = new Map<string, THREE.Group>();
  /** Capa de las piezas originales: no se dibujan, pero conservan identidad para selección. */
  static PICK_LAYER = 1;

  /**
   * Fusión estática: todas las piezas sin control ni mecanismo se agrupan por (estancia, material)
   * en una sola malla. Reduce las llamadas de dibujo (y las de la pasada de sombras) ~4×.
   */
  private mergeStatic(meshes: THREE.Mesh[], roomOf: (o: THREE.Object3D | null) => string | null) {
    const groups = new Map<string, { room: string; mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean; order: number }>();
    const dynamic = (o: THREE.Object3D | null) => { for (; o; o = o.parent) { const u = o.userData as any; if (u?.ctl || u?.mech) return true; } return false; };
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    for (const mesh of meshes) {
      if (dynamic(mesh)) continue;
      const room = roomOf(mesh) ?? 'A';
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
      const M = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const src = mesh.geometry;
      const geoGroups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.attributes.position.count, materialIndex: 0 }];
      for (const gg of geoGroups) {
        const mat = mats[gg.materialIndex ?? 0];
        const key = `${room}|${mat.uuid}`;
        let g = groups.get(key);
        if (!g) { g = { room, mat, geos: [], cast: mesh.castShadow, recv: mesh.receiveShadow, order: mesh.renderOrder }; groups.set(key, g); }
        const part = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv', 'uv1']) if (src.attributes[name]) part.setAttribute(name, src.attributes[name]);
        if (src.index) part.setIndex(src.index);
        let sub = src.index ? part : part;
        if (geoGroups.length > 1 || src.groups.length) {
          // extraer sólo el rango del grupo
          const idx = src.index!;
          const arr = (idx.array as ArrayLike<number>);
          const slice = new Uint32Array(gg.count);
          for (let i = 0; i < gg.count; i++) slice[i] = arr[gg.start + i];
          sub = part.clone(); sub.setIndex(new THREE.BufferAttribute(slice, 1));
        }
        const ni = sub.index ? sub.toNonIndexed() : sub.clone();
        // atributos homogéneos (uv1 opcional): rellenar si falta
        if (!ni.attributes.uv1 && mat && (mat as any).lightMap) continue;
        for (const name of Object.keys(ni.attributes)) {
          const a = ni.attributes[name] as THREE.BufferAttribute;
          if ((a as any).normalized || !(a.array instanceof Float32Array)) {
            const f = new Float32Array(a.count * a.itemSize);
            for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
            ni.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
          }
        }
        ni.applyMatrix4(M);
        g.geos.push(ni);
        g.cast = g.cast || mesh.castShadow;
      }
      mesh.layers.set(Interior.PICK_LAYER);
    }
    for (const g of groups.values()) {
      const want = ['position', 'normal', 'uv', ...((g.mat as any).lightMap ? ['uv1'] : [])];
      const geos = g.geos.map((x) => { for (const n of Object.keys(x.attributes)) if (!want.includes(n)) x.deleteAttribute(n); if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); return x; });
      const merged = mergeGeometries(geos, false);
      for (const x of geos) x.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const m = new THREE.Mesh(merged, g.mat);
      m.castShadow = g.cast; m.receiveShadow = g.recv; m.renderOrder = g.order;
      m.matrixAutoUpdate = false;
      m.userData.mergedRoom = g.room;
      let grp = this.roomMerged.get(g.room);
      if (!grp) { grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.userData.room = g.room; this.roomMerged.set(g.room, grp); this.root.add(grp); }
      grp.add(m);
      this.stats.merged = (this.stats.merged ?? 0) + 1;
    }
  }

  private buildVoxels(meshes: THREE.Mesh[]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const mesh of meshes) {
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
      if (mats.every((m) => m.name === 'R_LED' || m.name === 'R_LightPanel')) continue;
      const code = this.codeOf(mesh);
      // los mecanismos móviles (interruptores) no bloquean el paso; las escotillas se tratan aparte
      if (code && /\.TGL\./.test(code)) continue;
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const idx = mesh.geometry.index;
      const M = mesh.matrixWorld;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(M); b.fromBufferAttribute(pos, i1).applyMatrix4(M); c.fromBufferAttribute(pos, i2).applyMatrix4(M);
        this.voxels.tri(a, b, c);
      }
    }
  }

  codeOf(o: THREE.Object3D | null): string | null { while (o) { const c = (o.userData as any)?.code; if (c) return c; o = o.parent; } return null; }
  partOf(o: THREE.Object3D | null): IPart | null { while (o) { const c = (o.userData as any)?.code; if (c && this.parts.has(c)) return this.parts.get(c)!; o = o.parent; } return null; }

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  applyMech(p: IPart) {
    const m = p.mech!;
    const o = p.obj;
    o.matrix.copy(p.base);
    if (Math.abs(m.value) > 1e-6) {
      if (m.type === 'hinge') {
        this.tmpQ.setFromAxisAngle(m.axis, m.value);
        const T = new THREE.Matrix4().makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z)
          .multiply(this.tmpM.makeRotationFromQuaternion(this.tmpQ))
          .multiply(new THREE.Matrix4().makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z));
        o.matrix.premultiply(T);
      } else o.matrix.premultiply(this.tmpM.makeTranslation(m.axis.x * m.value, m.axis.y * m.value, m.axis.z * m.value));
    }
    o.matrixWorldNeedsUpdate = true;
  }

  /** Avanza mecanismos; sólo toca matrices de las piezas que se mueven. Devuelve actividad 0..1. */
  stepMechs(dt: number) {
    let act = 0;
    for (const p of this.mechs.values()) {
      const m = p.mech!;
      const d = m.target - m.value;
      if (Math.abs(d) < 1e-4) { if (m.value !== m.target) { m.value = m.target; this.applyMech(p); } continue; }
      m.value += Math.sign(d) * Math.min(Math.abs(d), m.speed * dt);
      this.applyMech(p);
      act = Math.max(act, p.code.includes('TGL') ? 0.25 : 1);
    }
    return act;
  }

  mech(id: string) { return this.mechs.get(id)?.mech ?? null; }
  setMech(id: string, target: number, instant = false) {
    const p = this.mechs.get(id);
    if (!p) return;
    const m = p.mech!;
    m.target = Math.min(m.max, Math.max(m.min, target));
    if (instant) { m.value = m.target; this.applyMech(p); }
  }

  /** Sondas de reflexión por estancia capturadas del propio interior iluminado. */
  captureProbes(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shipRoot: THREE.Object3D) {
    const pm = new THREE.PMREMGenerator(renderer);
    const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 30, cubeRT);
    const centers: Record<string, [number, number, number]> = { A: [7.8, 0.35, 0], B: [5.7, 0.35, 0], C: [3.7, 0.35, 0], D: [1.6, 0.35, 0], N: [11.0, 0.2, 0] };
    const prevEnv = scene.environment;
    scene.environment = null;
    for (const [room, c] of Object.entries(centers)) {
      if (!this.lightmaps.has(room) && room !== 'N') continue;
      cam.position.set(...c).applyMatrix4(shipRoot.matrixWorld);
      cam.update(renderer, scene);
      const env = pm.fromCubemap(cubeRT.texture).texture;
      this.probes.get(room)?.dispose();
      this.probes.set(room, env);
    }
    scene.environment = prevEnv;
    cubeRT.dispose();
    pm.dispose();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let r: string | null = null;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) { const rr = (p.userData as any)?.room; if (rr) { r = rr; break; } }
      const env = this.probes.get(r ?? 'A');
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as any[]) {
        if (m.isMeshStandardMaterial && env) { m.envMap = env; m.envMapIntensity = m.lightMap ? 1.0 : 0.8; m.needsUpdate = true; }
      }
    });
  }

  roomAt(p: THREE.Vector3): string {
    for (const [k, r] of Object.entries(ROOMS)) if (p.x >= r.x0 && p.x < r.x1) return k;
    return p.x < 0 ? 'D' : 'N';
  }

  dispose() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    for (const t of this.lightmaps.values()) t.dispose();
    for (const t of this.probes.values()) t.dispose();
  }
}

export { LM_SCALE };
