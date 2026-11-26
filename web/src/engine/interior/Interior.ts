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
import { b2tv, clamp } from '../util';
import type { PartNode, ExplodePreset } from '../ship/ShipModel';

export interface IMech { type: 'hinge' | 'slide'; pivot: THREE.Vector3; axis: THREE.Vector3; min: number; max: number; rest: number; id: string; speed: number; value: number; target: number; }
export interface IPart {
  code: string; label: string; desc: string; room: string; obj: THREE.Object3D; ctl: string | null; mech: IMech | null;
  propId: string | null; interactPose: number[] | null;
  base: THREE.Matrix4; box: THREE.Box3; meshes: THREE.Mesh[];
}

const ROOM_ORDER = ['A', 'B', 'C', 'D', 'N'] as const;
const ROOM_TREE_META: Record<string, { label: string; desc: string; off: [number, number, number] }> = {
  A: { label: 'Cabina de vuelo (Estancia A)', desc: 'Puesto de pilotaje, consola central, paneles de instrumentos y ventanas panorámicas.', off: [1.5, 1.4, 0] },
  B: { label: 'Laboratorio (Estancia B)', desc: 'Bastidores científicos, guantera estanca, microscopio, congelador −80 °C y pozos de nadir.', off: [0.4, 2.2, 0] },
  C: { label: 'Habitáculos (Estancia C)', desc: 'Cuatro cabinas privadas con sacos de dormir, iluminación de lectura y refugio antiradiación.', off: [-0.6, 3.0, 0] },
  D: { label: 'Servicios (Estancia D)', desc: 'Cocina orbital, higiene, cicloergómetro, mesa de comidas y soporte vital regenerativo.', off: [-1.6, 3.8, 0] },
  N: { label: 'Nodo y Esclusa (Estancia N)', desc: 'Nodo de proa, estación robótica, escotilla IDSS, cúpula y esclusa EVA.', off: [3.0, 0.9, 0] },
};
const INT_MAT_DESC: Record<string, string> = {
  R_PanelLight: 'Panel compuesto interior claro',
  R_PanelDark: 'Panel estructural interior grafito',
  R_Floor: 'Cubierta antideslizante interior',
  R_Metal: 'Aluminio anodizado interior',
  R_MetalDark: 'Aleación anodizada oscura',
  R_Fabric: 'Tejido técnico ignífugo',
  R_Wood: 'Laminado cálido de mobiliario',
  R_Glass: 'Vidrio óptico laminado',
  R_Screen: 'Pantalla MFD activa',
  R_LED: 'Luminaria LED integrada',
  R_LightPanel: 'Difusor lumínico cenital',
  R_Backing: 'Trasdós de cerramiento',
  R_Rubber: 'Elastómero técnico / sujeción',
  R_Accent: 'Detalle anodizado naranja',
};
const smoothstep = (e0: number, e1: number, x: number) => {
  const u = clamp((x - e0) / Math.max(1e-6, e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
};

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

export interface RoomProbeBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
}

/**
 * Volúmenes de proyección de caja (espacio local de nave en coordenadas Three.js)
 * derivados de ROOMS[r] y los límites físicos de cabina/nodo (A ajustada al cono de proa).
 */
export const ROOM_PROBE_BOUNDS: Record<string, RoomProbeBounds> = {
  D: {
    min: new THREE.Vector3(ROOMS.D.x0 + 0.45, -1.18, -1.92),
    max: new THREE.Vector3(ROOMS.D.x1, 1.92, 1.92),
    center: new THREE.Vector3(1.6, 0.35, 0),
  },
  C: {
    min: new THREE.Vector3(ROOMS.C.x0, -1.18, -1.92),
    max: new THREE.Vector3(ROOMS.C.x1, 1.92, 1.92),
    center: new THREE.Vector3(3.68, 0.35, 0),
  },
  B: {
    min: new THREE.Vector3(ROOMS.B.x0, -1.18, -1.92),
    max: new THREE.Vector3(ROOMS.B.x1, 1.92, 1.92),
    center: new THREE.Vector3(5.72, 0.35, 0),
  },
  A: {
    min: new THREE.Vector3(ROOMS.A.x0, -1.18, -1.85),
    max: new THREE.Vector3(ROOMS.A.x1, 1.80, 1.85),
    center: new THREE.Vector3(7.95, 0.35, 0),
  },
  N: {
    min: new THREE.Vector3(ROOMS.N.x0, -0.65, -1.25),
    max: new THREE.Vector3(ROOMS.N.x1 - 0.05, 1.25, 1.25),
    center: new THREE.Vector3(11.05, 0.25, 0),
  },
};

export class Interior {
  root = new THREE.Group();
  parts = new Map<string, IPart>();
  mechs = new Map<string, IPart>();
  controls: IPart[] = [];
  propsById = new Map<string, IPart>();
  screens = new Map<string, THREE.Mesh>();
  roomGroups = new Map<string, THREE.Object3D[]>();
  private roomGroupSet = new Set<THREE.Object3D>();
  roomBoxes = new Map<string, THREE.Box3>();
  private roomVis = new Map<string, boolean>();
  materials: THREE.Material[] = [];
  lightmaps = new Map<string, THREE.Texture>();
  voxels = new VoxelGrid();
  loaded = false;
  stats: { meshes: number; tris: number; voxelMs: number; merged?: number } = { meshes: 0, tris: 0, voxelMs: 0 };
  /** Árbol jerárquico de ingeniería del interior (raíz HAB.INT.IMM → estancias A..N → piezas IPart). */
  tree: PartNode | null = null;
  treeNodes = new Map<string, PartNode>();
  explodeValue = 0;
  explodePreset: ExplodePreset = 'all';
  private explodedMode = false;
  private staticMeshes: THREE.Mesh[] = [];
  private isolatedNode: PartNode | null = null;
  private lastLocalExKey = '';
  private highlightedCode: string | null = null;
  private highlightGroup = new THREE.Group();
  private highlightMat = new THREE.MeshBasicMaterial({
    color: 0xe2572b,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  private probes = new Map<string, THREE.Texture>();
  probeRes = 0;
  private probeMats: THREE.MeshStandardMaterial[] = [];
  private tmpEuler = new THREE.Euler();
  private tmpShipQ = new THREE.Quaternion();

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
    // piezas con identidad y nodos raíz por estancia
    gltf.scene.traverse((o) => {
      const ud = o.userData as any;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      const ownRoom = ud?.room;
      if (ownRoom && roomOf(o.parent) !== ownRoom) {
        let list = this.roomGroups.get(ownRoom);
        if (!list) { list = []; this.roomGroups.set(ownRoom, list); }
        list.push(o);
        this.roomGroupSet.add(o);
      }
      if (!ud?.code) return;
      const ms: THREE.Mesh[] = [];
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) ms.push(c as THREE.Mesh); });
      const p: IPart = {
        code: ud.code, label: ud.label ?? ud.code, desc: ud.desc ?? '', room: roomOf(o) ?? '',
        obj: o, ctl: ud.ctl ?? null, mech: null,
        propId: ud.prop_id ?? null,
        interactPose: Array.isArray(ud.interact_pose) ? ud.interact_pose : null,
        base: o.matrix.clone(), box: new THREE.Box3().setFromObject(o), meshes: ms,
      };
      if (ud.mech) {
        const m = ud.mech;
        p.mech = { type: m.type, pivot: b2tv(m.pivot), axis: b2tv(m.axis).normalize(), min: m.min, max: m.max, rest: m.rest, id: m.id, speed: m.speed ?? 1, value: m.rest, target: m.rest };
        this.mechs.set(m.id, p);
      }
      if (p.ctl) {
        this.controls.push(p);
        if (p.ctl.startsWith('scr:') && ms[0]) this.screens.set(p.ctl, ms[0]);
      }
      if (p.propId) this.propsById.set(p.propId, p);
      this.parts.set(p.code, p);
      if (p.room) {
        if (!this.roomBoxes.has(p.room)) this.roomBoxes.set(p.room, new THREE.Box3());
        this.roomBoxes.get(p.room)!.union(p.box);
      }
    });
    this.root.add(gltf.scene);
    this.highlightGroup.visible = false;
    this.highlightGroup.name = '__interior_highlight';
    this.root.add(this.highlightGroup);
    for (const m of this.mechs.values()) this.applyMech(m);
    const t0 = performance.now();
    this.buildVoxels(meshes);
    // escotilla interior de la esclusa cerrada = tapa transitable a ras del suelo del nodo (licencia de juego al caminar)
    const hb = this.hatchBits.get('hatch:alk_in');
    if (hb) {
      const s = this.voxels.s;
      for (let x = -0.62; x <= 0.62; x += s * 0.5) for (let z = -0.62; z <= 0.62; z += s * 0.5) if (x * x + z * z < 0.62 * 0.62) this.voxels.markPoint(11.05 + x, -0.64, z, hb);
    }
    this.stats.voxelMs = performance.now() - t0;
    this.mergeStatic(meshes, roomOf);
    this.buildTree();
    this.loaded = true;
  }

  private small: IPart[] | null = null;
  /** Oculta piezas móviles pequeñas (palancas, indicadores) más allá de `dist` metros. */
  cullSmall(viewer: THREE.Vector3, dist: number) {
    if (this.explodedMode) return;
    if (!this.small) {
      const sz = new THREE.Vector3();
      this.small = [...this.parts.values()].filter((p) => (p.ctl || p.mech) && !p.propId && p.meshes.length && p.box.getSize(sz).length() < 0.25 && p.obj.layers.test(new THREE.Layers()));
    }
    const d2 = dist * dist;
    for (const p of this.small) {
      if (this.roomVis.get(p.room) === false) { p.obj.visible = false; continue; }
      const c = p.box.getCenter(this.tmpV);
      p.obj.visible = c.distanceToSquared(viewer) < d2;
    }
  }
  private tmpV = new THREE.Vector3();

  /** Activa u oculta toda la geometría (fusionada y dinámica) de una estancia. */
  setRoomVisible(room: string, visible: boolean) {
    if (this.roomVis.get(room) === visible) return;
    this.roomVis.set(room, visible);
    const mg = this.roomMerged.get(room);
    if (mg) mg.visible = visible && !this.explodedMode;
    const gs = this.roomGroups.get(room);
    if (gs && !this.explodedMode) for (const o of gs) o.visible = visible;
  }

  setAllRoomsVisible(visible = true) {
    for (const r of Object.keys(ROOMS)) this.setRoomVisible(r, visible);
  }

  /** Busca un objeto físico interactuable por propId o, en su defecto, por ctl si es compacto (≤ 0,45 m). */
  findHoldableProp(propId: string, fallbackCtl?: string): IPart | null {
    const byId = this.propsById.get(propId);
    if (byId) return byId;
    if (fallbackCtl) {
      const sz = new THREE.Vector3();
      for (const p of this.controls) {
        if (p.ctl === fallbackCtl && p.meshes.length && p.box.getSize(sz).length() <= 0.45) return p;
      }
    }
    return null;
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
    const dynamic = (o: THREE.Object3D | null) => { for (; o; o = o.parent) { const u = o.userData as any; if (u?.ctl || u?.mech || u?.prop_id) return true; } return false; };
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
      this.staticMeshes.push(mesh);
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

  /** Calcula un vector de separación limpio para una pieza interior dentro de su estancia. */
  private computePartExplode(p: IPart, roomCenter: THREE.Vector3): THREE.Vector3 {
    const c = p.box.getCenter(new THREE.Vector3());
    const rel = c.clone().sub(roomCenter);
    const code = p.code;
    // Suelos, subsuelos y pozos de nadir bajan
    if (/\.(FLR|FLF|SHL\.LOW|NAD|NADG|STP)$/.test(code)) {
      return new THREE.Vector3(rel.x * 0.15, -0.78, rel.z * 0.18);
    }
    // Luminarias, techos y nervios suben
    if (/\.(SHL\.LED|LGT|SHL\.FRM|UPR)$/.test(code)) {
      return new THREE.Vector3(rel.x * 0.12, 0.85, rel.z * 0.22);
    }
    // Revestimientos exteriores de estancia, trasdós y mamparos se abren radial/axialmente
    if (/\.(SHL\.WALL|BCK|LIN|CON|PAN|WEL|BHD|AFT)$/.test(code)) {
      const radial = new THREE.Vector3(rel.x * 0.45, rel.y * 0.45, rel.z * 0.65);
      if (radial.lengthSq() < 0.04) radial.set(0, 0.5, 0.6);
      return radial.normalize().multiplyScalar(0.82);
    }
    // Consolas, pantallas, palancas, mobiliario y props se despliegan en abanico radial legible
    const out = new THREE.Vector3(rel.x * 0.22, rel.y * 0.35 + 0.12, rel.z * 0.72);
    if (out.lengthSq() < 0.02) out.set(0.15, 0.35, 0.4);
    const mag = (p.propId || /\.(SCR|TGL|MON|MIC|TAB)/.test(code)) ? 0.58 : 0.48;
    return out.normalize().multiplyScalar(mag);
  }

  /** Construye el árbol de ingeniería compatible con `PartNode` agrupado por estancias A..N. */
  private buildTree() {
    this.treeNodes.clear();
    const rootBox = new THREE.Box3();
    const rootMats = new Map<string, string>();
    const rootNode: PartNode = {
      code: 'HAB.INT.IMM',
      label: 'Interior Habitable Inmersivo',
      desc: 'Estancias presurizadas completas con mobiliario, instrumentación, controles interactivos e iluminación horneada.',
      func: 'Hábitat tripulado de 4 bahías (A–D) y nodo de proa con cúpula y esclusa EVA (N)',
      kind: 'group',
      depth: 2,
      obj: this.root,
      parent: null,
      children: [],
      ex: new THREE.Vector3(0, 1.8, 0),
      base: new THREE.Matrix4(),
      center0: new THREE.Vector3(),
      box0: rootBox,
      box: rootBox,
      meshes: [],
      materials: [],
      tris: 0,
      parts: 0,
      count: 0,
      sector: 'int',
      hidden: false,
      mech: null,
      ctl: null,
      inspect: true,
      localEx: 0,
      external: true,
    };
    this.treeNodes.set(rootNode.code, rootNode);

    const hasChildPart = (p: IPart) => {
      for (const ch of p.obj.children) {
        const c = (ch.userData as any)?.code;
        if (c && this.parts.has(c)) return true;
      }
      return false;
    };

    for (const r of ROOM_ORDER) {
      const meta = ROOM_TREE_META[r];
      const rBox = (this.roomBoxes.get(r) ?? new THREE.Box3()).clone();
      const rCenter = rBox.isEmpty() ? new THREE.Vector3() : rBox.getCenter(new THREE.Vector3());
      const rMats = new Map<string, string>();
      const rNode: PartNode = {
        code: `HAB.INT.IMM.${r}`,
        label: meta.label,
        desc: meta.desc,
        func: `Estancia presurizada ${r} (${ROOMS[r]?.label ?? r})`,
        kind: 'group',
        depth: 3,
        obj: this.roomMerged.get(r) ?? this.root,
        parent: rootNode,
        children: [],
        ex: new THREE.Vector3(...meta.off),
        base: new THREE.Matrix4(),
        center0: rCenter.clone(),
        box0: new THREE.Box3(),
        meshes: [],
        materials: [],
        tris: 0,
        parts: 0,
        count: 0,
        sector: 'int',
        hidden: false,
        mech: null,
        ctl: null,
        inspect: true,
        localEx: 0,
        external: true,
      };
      rNode.box = rNode.box0;

      const roomParts = [...this.parts.values()]
        .filter((p) => p.room === r && p.meshes.length > 0 && ((p.obj as THREE.Mesh).isMesh || !hasChildPart(p)))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));

      for (const p of roomParts) {
        let tris = 0;
        const pMats = new Map<string, string>();
        for (const m of p.meshes) {
          const idx = m.geometry.index;
          tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
          const mlist = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
          for (const mm of mlist) {
            if (!mm?.name) continue;
            const d = INT_MAT_DESC[mm.name] ?? (mm as any).userData?.desc ?? mm.name;
            pMats.set(mm.name, d);
            rMats.set(mm.name, d);
            rootMats.set(mm.name, d);
          }
        }
        const pBox = p.box.clone();
        const pNode: PartNode = {
          code: p.code,
          label: p.label,
          desc: p.desc || `Componente interior de ${ROOMS[r]?.label ?? r}`,
          func: p.ctl ? `Control interactivo (${p.ctl})` : p.propId ? `Objeto manipulable (${p.propId})` : `Equipamiento de ${ROOMS[r]?.label ?? r}`,
          kind: 'part',
          depth: 4,
          obj: p.obj,
          parent: rNode,
          children: [],
          ex: this.computePartExplode(p, rCenter),
          base: p.base.clone(),
          center0: pBox.isEmpty() ? new THREE.Vector3() : pBox.getCenter(new THREE.Vector3()),
          box0: pBox,
          box: pBox,
          meshes: p.meshes,
          materials: [...pMats.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name)),
          tris,
          parts: 1,
          count: 1,
          sector: 'int',
          hidden: false,
          mech: p.mech,
          ctl: p.ctl,
          inspect: true,
          localEx: 0,
          external: true,
        };
        rNode.children.push(pNode);
        rNode.meshes.push(...p.meshes);
        rNode.tris += tris;
        rNode.parts += 1;
        if (!pBox.isEmpty()) rNode.box0.union(pBox);
        this.treeNodes.set(pNode.code, pNode);
      }

      if (!rNode.box0.isEmpty()) rNode.box0.getCenter(rNode.center0);
      rNode.count = rNode.parts;
      rNode.materials = [...rMats.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name));
      rootNode.children.push(rNode);
      rootNode.meshes.push(...rNode.meshes);
      rootNode.tris += rNode.tris;
      rootNode.parts += rNode.parts;
      if (!rNode.box0.isEmpty()) rootNode.box0.union(rNode.box0);
      this.treeNodes.set(rNode.code, rNode);
    }

    if (!rootNode.box0.isEmpty()) rootNode.box0.getCenter(rootNode.center0);
    rootNode.count = rootNode.parts;
    rootNode.materials = [...rootMats.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name));
    this.tree = rootNode;
  }

  /** Comprueba si algún subnodo del árbol interior tiene explosión local activa. */
  hasLocalExplode(): boolean {
    if (!this.tree) return false;
    if (this.tree.localEx > 0.001) return true;
    return this.tree.children.some((c) => c.localEx > 0.001);
  }

  /** Reinicia todas las explosiones locales del subárbol interior. */
  resetLocalExplode() {
    if (!this.tree) return;
    this.tree.localEx = 0;
    for (const c of this.tree.children) c.localEx = 0;
    this.lastLocalExKey = '';
  }

  /** Detecta cambios en los deslizadores de explosión local del árbol interior. */
  checkLocalExplodeDirty(): boolean {
    if (!this.tree) return false;
    const key = [this.tree.localEx.toFixed(3), ...this.tree.children.map((c) => c.localEx.toFixed(3))].join('|');
    if (key === this.lastLocalExKey) return false;
    this.lastLocalExKey = key;
    return true;
  }

  private hasCustomVisibility(): boolean {
    if (this.isolatedNode) return true;
    for (const n of this.treeNodes.values()) if (n.hidden) return true;
    return false;
  }

  private isNodeHidden(n: PartNode | null): boolean {
    let p = n;
    while (p) { if (p.hidden) return true; p = p.parent; }
    return false;
  }

  private isUnderNode(n: PartNode | null, ancestor: PartNode): boolean {
    let p = n;
    while (p) { if (p === ancestor) return true; p = p.parent; }
    return false;
  }

  /** Sincroniza visibilidad de piezas interiores ocultas o aisladas desde el árbol de ingeniería. */
  syncEngineeringVisibility(isolateNode: PartNode | null) {
    this.isolatedNode = isolateNode;
    this.setExplode(this.explodeValue, this.explodePreset);
  }

  /**
   * Separa limpiamente las estancias (A, B, C, D, N) y sus piezas individuales según `t ∈ [0, 1]`.
   * Al restaurar `t = 0` (al salir de ingeniería o volver al interior), devuelve exactamente
   * `matrix = p.base` (o el estado del mecanismo), `roomMerged = identidad` y `PICK_LAYER` original.
   */
  setExplode(t: number, preset: ExplodePreset = this.explodePreset) {
    if (!this.loaded) return;
    this.explodeValue = clamp(t, 0, 1);
    this.explodePreset = preset;

    const kGlobal = (preset === 'all' || preset === 'interior') ? this.explodeValue : 0;
    const treeLocal = this.tree?.localEx ?? 0;
    const roomK: Record<string, number> = {};
    let maxK = Math.max(kGlobal, treeLocal);
    for (const r of ROOM_ORDER) {
      const rNode = this.treeNodes.get(`HAB.INT.IMM.${r}`);
      const kr = Math.max(kGlobal, treeLocal, rNode?.localEx ?? 0);
      roomK[r] = kr;
      if (kr > maxK) maxK = kr;
    }

    const customVis = this.hasCustomVisibility();
    const wantIndividual = maxK > 0.001 || customVis;

    if (!wantIndividual) {
      this.explodedMode = false;
      for (const m of this.staticMeshes) m.layers.set(Interior.PICK_LAYER);
      for (const [r, mg] of this.roomMerged) {
        mg.matrix.identity();
        mg.matrixWorldNeedsUpdate = true;
        mg.visible = this.roomVis.get(r) !== false;
      }
      for (const p of this.parts.values()) {
        if (p.mech) this.applyMech(p);
        else { p.obj.matrix.copy(p.base); p.obj.matrixWorldNeedsUpdate = true; }
        p.obj.visible = this.roomGroupSet.has(p.obj) ? (this.roomVis.get(p.room) !== false) : true;
      }
      this.root.updateMatrixWorld(true);
      this.syncHighlight();
      return;
    }

    this.explodedMode = true;
    for (const m of this.staticMeshes) m.layers.set(0);
    for (const mg of this.roomMerged.values()) {
      mg.matrix.identity();
      mg.matrixWorldNeedsUpdate = true;
      mg.visible = false;
    }

    const iso = this.isolatedNode;
    const isoIsExternal = !!iso && !!iso.external;
    const T = new THREE.Matrix4();

    for (const p of this.parts.values()) {
      if (p.mech) this.applyMech(p);
      else p.obj.matrix.copy(p.base);

      const kr = roomK[p.room] ?? kGlobal;
      const kRoom = smoothstep(0.0, 0.48, kr);
      const kPart = smoothstep(0.22, 1.0, kr);
      let ox = 0, oy = 0, oz = 0;

      if (this.roomGroupSet.has(p.obj) && kRoom > 1e-5) {
        const off = ROOM_TREE_META[p.room]?.off;
        if (off) { ox += off[0] * kRoom; oy += off[1] * kRoom; oz += off[2] * kRoom; }
      }
      const tn = this.treeNodes.get(p.code);
      if (tn && tn.kind === 'part' && kPart > 1e-5) {
        ox += tn.ex.x * kPart;
        oy += tn.ex.y * kPart;
        oz += tn.ex.z * kPart;
      }
      if (Math.abs(ox) > 1e-6 || Math.abs(oy) > 1e-6 || Math.abs(oz) > 1e-6) {
        T.makeTranslation(ox, oy, oz);
        p.obj.matrix.premultiply(T);
      }
      p.obj.matrixWorldNeedsUpdate = true;

      if (tn) {
        let vis = !this.isNodeHidden(tn);
        if (iso) vis = vis && isoIsExternal && this.isUnderNode(tn, iso);
        // Ocultar trasdós opacos de cerramiento durante explosión salvo que se seleccionen/aíslen explícitamente
        if (maxK > 0.05 && !iso && /\.BCK$/.test(p.code) && this.highlightedCode !== p.code) vis = false;
        p.obj.visible = vis;
      } else if (this.roomGroupSet.has(p.obj)) {
        const rNode = this.treeNodes.get(`HAB.INT.IMM.${p.room}`) ?? null;
        let vis = !this.isNodeHidden(rNode);
        if (iso && !isoIsExternal) vis = false;
        p.obj.visible = vis;
      }
    }

    this.root.updateMatrixWorld(true);
    this.syncHighlight();
  }

  /** Caja envolvente actual de un nodo o pieza interior en espacio local de la nave (`this.root`). */
  localBox(code: string): THREE.Box3 | null {
    const tn = this.treeNodes.get(code);
    const meshes = tn ? tn.meshes : this.parts.get(code)?.meshes;
    if (!meshes || !meshes.length) return null;
    this.root.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const mat = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const m of meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      mat.multiplyMatrices(invRoot, m.matrixWorld);
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(mat));
    }
    return box.isEmpty() ? null : box;
  }

  /** Caja envolvente actual de un nodo o pieza interior en coordenadas mundo. */
  worldBox(code: string): THREE.Box3 | null {
    const lb = this.localBox(code);
    if (!lb) return null;
    return lb.applyMatrix4(this.root.matrixWorld);
  }

  /** Resalta una pieza o estancia interior seleccionada en modo Ingeniería (o limpia con `null`). */
  highlightPart(code: string | null) {
    this.highlightedCode = code;
    this.syncHighlight();
  }

  /** Actualiza las mallas de resaltado y el marco envolvente del elemento interior seleccionado. */
  syncHighlight() {
    for (const ch of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(ch);
      if ((ch as any).isBox3Helper) {
        (ch as THREE.Box3Helper).geometry.dispose();
        ((ch as THREE.Box3Helper).material as THREE.Material).dispose();
      }
    }
    if (!this.highlightedCode) {
      this.highlightGroup.visible = false;
      return;
    }
    const tn = this.treeNodes.get(this.highlightedCode);
    const meshes = tn ? tn.meshes : this.parts.get(this.highlightedCode)?.meshes;
    if (!meshes || !meshes.length) {
      this.highlightGroup.visible = false;
      return;
    }
    this.root.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const localM = new THREE.Matrix4();
    const box = new THREE.Box3();
    const limit = tn && tn.kind === 'group' ? 40 : meshes.length;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      localM.multiplyMatrices(invRoot, m.matrixWorld);
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(localM));
      if (i < limit) {
        const hl = new THREE.Mesh(m.geometry, this.highlightMat);
        hl.matrixAutoUpdate = false;
        hl.matrix.copy(localM);
        hl.renderOrder = 10;
        hl.castShadow = false;
        hl.receiveShadow = false;
        hl.raycast = () => {};
        this.highlightGroup.add(hl);
      }
    }
    if (!box.isEmpty()) {
      const helper = new THREE.Box3Helper(box, new THREE.Color(0xe2572b));
      helper.renderOrder = 11;
      helper.raycast = () => {};
      this.highlightGroup.add(helper);
    }
    this.highlightGroup.visible = true;
    this.highlightGroup.updateMatrixWorld(true);
  }

  private buildVoxels(meshes: THREE.Mesh[]) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const mesh of meshes) {
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
      // el trasdós queda fuera del revestimiento: no participa en la colisión
      if (mats.every((m) => m.name === 'R_LED' || m.name === 'R_LightPanel' || m.name === 'R_Backing')) continue;
      const code = this.codeOf(mesh);
      // los mecanismos móviles (interruptores) no bloquean el paso
      if (code && /\.TGL\./.test(code)) continue;
      // escotillas: bit propio, sólo sólidas mientras están cerradas (ver solidMask)
      const part = this.partOf(mesh);
      // los objetos sueltos tomables (prop_id) no bloquean el paso
      if (part?.propId) continue;
      let bit = 1;
      if (part?.mech && part.mech.id.startsWith('hatch:')) {
        if (!this.hatchBits.has(part.mech.id)) this.hatchBits.set(part.mech.id, 2 << this.hatchBits.size);
        bit = this.hatchBits.get(part.mech.id)!;
      }
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const idx = mesh.geometry.index;
      const M = mesh.matrixWorld;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(M); b.fromBufferAttribute(pos, i1).applyMatrix4(M); c.fromBufferAttribute(pos, i2).applyMatrix4(M);
        this.voxels.tri(a, b, c, bit);
      }
    }
  }

  hatchBits = new Map<string, number>();
  /** Máscara de ocupación vigente: estructura + escotillas cerradas. */
  solidMask() {
    let m = 1;
    for (const [id, bit] of this.hatchBits) { const me = this.mech(id); if (!me || Math.abs(me.value - me.rest) < 0.15) m |= bit; }
    return m;
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

  /**
   * Sondas de reflexión por estancia capturadas del propio interior iluminado en el marco
   * local de la nave (para que los reflejos y la proyección de caja permanezcan alineados
   * cuando la nave gira en órbita).
   */
  captureProbes(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shipRoot: THREE.Object3D, resolution = 128) {
    const res = Math.max(32, Math.min(512, resolution | 0));
    const pm = new THREE.PMREMGenerator(renderer);
    pm.compileCubemapShader();
    const cubeRT = new THREE.WebGLCubeRenderTarget(res, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 30, cubeRT);

    // Guardar estado de escena/renderer para no contaminar el render principal ni provocar realimentación
    const prevEnv = scene.environment;
    const prevAutoClear = renderer.autoClear;
    const prevRootVis = this.root.visible;
    const prevShadowUpdate = renderer.shadowMap.needsUpdate;
    const prevMatsEnv = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
    for (const m of this.materials) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial && std.envMap) {
        prevMatsEnv.set(std, std.envMap);
        std.envMap = null;
      }
    }

    scene.environment = null;
    this.root.visible = true;
    renderer.autoClear = true;
    renderer.shadowMap.needsUpdate = false;
    renderer.setClearColor(0x000000, 1);

    shipRoot.updateMatrixWorld(true);
    shipRoot.getWorldQuaternion(this.tmpShipQ);

    for (const [room, bounds] of Object.entries(ROOM_PROBE_BOUNDS)) {
      if (!this.lightmaps.has(room) && room !== 'N') continue;
      // Posicionar y orientar la CubeCamera en el sistema de referencia local de la nave
      cam.position.copy(bounds.center).applyMatrix4(shipRoot.matrixWorld);
      cam.quaternion.copy(this.tmpShipQ);
      cam.updateMatrixWorld(true);
      cam.update(renderer, scene);
      const env = pm.fromCubemap(cubeRT.texture).texture;
      this.probes.get(room)?.dispose();
      this.probes.set(room, env);
    }

    // Restaurar estado previo
    for (const [std, prev] of prevMatsEnv) std.envMap = prev;
    scene.environment = prevEnv;
    this.root.visible = prevRootVis;
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.needsUpdate = prevShadowUpdate;
    renderer.setRenderTarget(null);
    cubeRT.dispose();
    pm.dispose();

    this.probeRes = res;
    const seen = new Set<THREE.MeshStandardMaterial>();
    this.probeMats.length = 0;

    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let r: string | null = null;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) { const rr = (p.userData as any)?.room; if (rr) { r = rr; break; } }
      const room = r ?? 'A';
      const env = this.probes.get(room);
      const bounds = ROOM_PROBE_BOUNDS[room] ?? ROOM_PROBE_BOUNDS.A;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as any[]) {
        if (!m?.isMeshStandardMaterial || !env) continue;
        m.envMap = env;
        m.envMapIntensity = m.name === 'R_Glass' ? 0.35 : (m.lightMap ? 1.0 : 0.8);
        // Contrato acordado con H1 (RMaterials.ts): rellenar boxProbe si el shader lo expone,
        // o almacenar boxProbeBounds de forma segura si aún no está presente.
        if (m.userData?.boxProbe) {
          m.userData.boxProbe.min.value.copy(bounds.min);
          m.userData.boxProbe.max.value.copy(bounds.max);
          m.userData.boxProbe.center.value.copy(bounds.center);
          m.userData.boxProbe.enabled.value = 1.0;
        } else {
          m.userData.boxProbeBounds = {
            min: bounds.min.clone(),
            max: bounds.max.clone(),
            center: bounds.center.clone(),
          };
        }
        m.needsUpdate = true;
        if (!seen.has(m)) { seen.add(m); this.probeMats.push(m); }
      }
    });
    this.syncProbeRotation(this.tmpShipQ);
  }

  /**
   * Mantiene la orientación del mapa de entorno alineada con la nave para materiales que
   * muestrean el cubemap vía envMapRotation estándar de Three.js (p.ej. R_Glass o antes de
   * activar boxProbe en RMaterials).
   */
  syncProbeRotation(shipQuat: THREE.Quaternion) {
    if (this.probeMats.length === 0) return;
    // Three.js niega (x,y,z) de envMapRotation al construir la matriz: Euler ZYX → XYZ produce R(q^-1) exacto.
    this.tmpEuler.setFromQuaternion(shipQuat, 'ZYX');
    const ex = this.tmpEuler.x, ey = this.tmpEuler.y, ez = this.tmpEuler.z;
    for (let i = 0; i < this.probeMats.length; i++) {
      const m = this.probeMats[i];
      if ((m.userData as any)?.boxProbe?.enabled?.value > 0.5) continue;
      m.envMapRotation.set(ex, ey, ez, 'XYZ');
    }
  }

  roomAt(p: THREE.Vector3): string {
    for (const [k, r] of Object.entries(ROOMS)) if (p.x >= r.x0 && p.x < r.x1) return k;
    return p.x < 0 ? 'D' : 'N';
  }

  dispose() {
    this.highlightPart(null);
    this.highlightMat.dispose();
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    for (const t of this.lightmaps.values()) t.dispose();
    for (const t of this.probes.values()) t.dispose();
  }
}

export { LM_SCALE };
