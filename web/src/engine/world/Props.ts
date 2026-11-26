/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Objetos del mundo cercano (metros) con materiales PBR reales (MLI, metal cepillado,
 * células fotovoltaicas, pintura térmica y balizas):
 * Estación «Tesela», Observatorio «Halo-7», Cápsula de muestras y Dianas de entrenamiento.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { solarColor, paintNormal, photo, roughNoise } from '../ship/texturesLib';

export interface WorldObject {
  id: string;
  label: string;
  group: THREE.Group;
  /** posición absoluta (m, doble precisión) */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
}

/** Fusiona todas las mallas estáticas de un grupo por material para minimizar draw calls en vuelo. */
function mergeByMaterial(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>();
  const keep: THREE.Object3D[] = [];
  for (const ch of [...g.children]) {
    const m = ch as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.userData?.beacon) { keep.push(ch); continue; }
    let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(m.matrix);
    // Normalizar atributos comunes (position, normal, uv) para garantizar fusión limpia
    for (const k of Object.keys(geo.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    let b = buckets.get(m.material);
    if (!b) { b = { geos: [], cast: false, recv: false }; buckets.set(m.material, b); }
    b.geos.push(geo);
    b.cast = b.cast || m.castShadow;
    b.recv = b.recv || m.receiveShadow;
    m.geometry.dispose();
    g.remove(ch);
  }
  for (const [mat, { geos, cast, recv }] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = recv;
    g.add(mesh);
  }
  for (const k of keep) if (!k.parent) g.add(k);
  return g;
}

function tile(t: THREE.Texture, repX: number, repY = repX) {
  const c = t.clone();
  c.repeat.set(repX, repY);
  c.needsUpdate = true;
  return c;
}

let _mats: ReturnType<typeof createMats> | null = null;
function getMats() {
  if (_mats) return _mats;
  _mats = createMats();
  return _mats;
}

function createMats() {
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xd9d7d0, metalness: 0.04, roughness: 0.52,
    normalMap: tile(paintNormal(), 3), normalScale: new THREE.Vector2(0.18, 0.18),
    roughnessMap: tile(roughNoise(7), 2), clearcoat: 0.08, clearcoatRoughness: 0.5,
  });
  const grey = new THREE.MeshStandardMaterial({
    color: 0x8e9399, metalness: 0.72, roughness: 0.36,
    normalMap: tile(photo('brushed', 'n'), 3), normalScale: new THREE.Vector2(0.28, 0.28),
    roughnessMap: tile(photo('brushed', 'r'), 3),
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1d2026, metalness: 0.55, roughness: 0.44,
    normalMap: tile(paintNormal(), 2), normalScale: new THREE.Vector2(0.14, 0.14),
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xdca444, metalness: 1.0, roughness: 0.34,
    normalMap: tile(photo('mli', 'n'), 2.5), normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tile(roughNoise(3), 2), envMapIntensity: 1.35,
  });
  const silver = new THREE.MeshStandardMaterial({
    color: 0xd0d4dc, metalness: 0.92, roughness: 0.24,
    normalMap: tile(photo('brushed', 'n'), 4), normalScale: new THREE.Vector2(0.22, 0.22),
  });
  const solar = new THREE.MeshPhysicalMaterial({
    map: tile(solarColor(), 3, 5), color: 0xffffff,
    metalness: 0.18, roughness: 0.26, clearcoat: 0.85, clearcoatRoughness: 0.07,
  });
  const green = new THREE.MeshStandardMaterial({ color: 0x103010, roughness: 0.35, emissive: 0x35ff6a, emissiveIntensity: 2.8 });
  const red = new THREE.MeshStandardMaterial({ color: 0x301010, roughness: 0.35, emissive: 0xff3624, emissiveIntensity: 2.8 });
  const white_led = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 3.2 });
  const cyan_led = new THREE.MeshStandardMaterial({ color: 0x0a2230, roughness: 0.32, emissive: 0x3ad6ff, emissiveIntensity: 2.1 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xc84b20, roughness: 0.42, metalness: 0.05 });
  const optics = new THREE.MeshPhysicalMaterial({ color: 0x06101e, metalness: 0.1, roughness: 0.04, clearcoat: 1.0, reflectivity: 0.9 });

  // Placa trasera de alto contraste para la diana óptica COAS 3D (blanco/negro/bermellón)
  const coasCv = document.createElement('canvas');
  coasCv.width = 256; coasCv.height = 256;
  const cc = coasCv.getContext('2d')!;
  cc.fillStyle = '#0c0f14'; cc.fillRect(0, 0, 256, 256);
  cc.strokeStyle = '#f2f5f8'; cc.lineWidth = 10; cc.strokeRect(9, 9, 238, 238);
  // Retícula concéntrica de paralaje (2° y 5°)
  cc.strokeStyle = '#d8e0e8'; cc.lineWidth = 3;
  cc.beginPath(); cc.arc(128, 128, 92, 0, Math.PI * 2); cc.stroke();
  cc.strokeStyle = '#e2572b'; cc.lineWidth = 4;
  cc.beginPath(); cc.arc(128, 128, 46, 0, Math.PI * 2); cc.stroke();
  // Ejes cruzados de alto contraste con zona central bermellón
  cc.fillStyle = '#f2f5f8';
  cc.fillRect(124, 18, 8, 220);
  cc.fillRect(18, 124, 220, 8);
  cc.fillStyle = '#e2572b';
  cc.fillRect(116, 116, 24, 24);
  cc.fillStyle = '#0c0f14';
  cc.fillRect(123, 123, 10, 10);
  // Triángulo superior de referencia de vertical (+Y)
  cc.fillStyle = '#e2572b';
  cc.beginPath(); cc.moveTo(128, 14); cc.lineTo(114, 34); cc.lineTo(142, 34); cc.closePath(); cc.fill();
  const coasTex = new THREE.CanvasTexture(coasCv);
  coasTex.colorSpace = THREE.SRGBColorSpace;
  coasTex.anisotropy = 8;
  const coasPlate = new THREE.MeshStandardMaterial({
    map: coasTex, roughness: 0.48, metalness: 0.05,
    emissive: 0xffffff, emissiveMap: coasTex, emissiveIntensity: 0.35,
  });

  return { white, grey, dark, gold, silver, solar, green, red, white_led, cyan_led, orange, optics, coasPlate };
}

function cyl(r: number, l: number, mat: THREE.Material, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function box(x: number, y: number, z: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Estación «Tesela»: eje +X local = eje del puerto de atraque IDSS. */
export function buildStation(): { obj: WorldObject; dockLocal: THREE.Vector3; dockAxis: THREE.Vector3 } {
  const mats = getMats();
  const g = new THREE.Group();
  // Módulos presurizados principales con anillos estructurales y mantas MLI
  const core = cyl(2.1, 9.2, mats.white, 48); core.rotation.z = Math.PI / 2; g.add(core);
  for (let i = 0; i < 9; i++) {
    const r = cyl(2.18, 0.14, mats.grey, 48); r.rotation.z = Math.PI / 2; r.position.x = -4.2 + i * 1.05; g.add(r);
  }
  const aftMli = cyl(2.05, 1.4, mats.gold, 40); aftMli.rotation.z = Math.PI / 2; aftMli.position.x = -5.1; g.add(aftMli);
  const node = new THREE.Mesh(new THREE.SphereGeometry(2.42, 40, 24), mats.white);
  node.position.x = 5.2; node.castShadow = node.receiveShadow = true; g.add(node);
  const nodeCollar = new THREE.Mesh(new THREE.TorusGeometry(2.38, 0.08, 12, 48), mats.grey);
  nodeCollar.rotation.y = Math.PI / 2; nodeCollar.position.x = 5.2; g.add(nodeCollar);

  for (const s of [-1, 1]) {
    const m = cyl(1.92, 7.2, mats.white, 40); m.position.set(5.2, 0, s * 5.6); m.rotation.x = Math.PI / 2; g.add(m);
    for (let k = 0; k < 4; k++) {
      const rr = cyl(1.98, 0.10, mats.grey, 36); rr.position.set(5.2, 0, s * (3.2 + k * 1.6)); rr.rotation.x = Math.PI / 2; g.add(rr);
    }
    const mli = cyl(1.96, 2.1, mats.gold, 40); mli.position.set(5.2, 0, s * 8.4); mli.rotation.x = Math.PI / 2; g.add(mli);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.92, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.silver);
    cap.position.set(5.2, 0, s * 9.45); cap.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(cap);
  }

  // Puerto de atraque IDSS activo (+X) con pétalos guía, anillo luminoso, diana COAS 3D y 4 balizas LED direccionales
  const port = cyl(0.92, 1.05, mats.grey, 40); port.rotation.z = Math.PI / 2; port.position.x = 7.9; g.add(port);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.065, 14, 48), mats.silver); ring.rotation.y = Math.PI / 2; ring.position.x = 8.45; g.add(ring);
  // Anillo guía luminoso sutil + 4 marcas cardinales (fusionados en un único material cyan_led)
  const guideRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.018, 10, 48), mats.cyan_led);
  guideRing.rotation.y = Math.PI / 2; guideRing.position.x = 8.47; g.add(guideRing);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const tick = box(0.024, 0.11, 0.024, mats.cyan_led);
    tick.position.set(8.48, Math.cos(a) * 0.90, Math.sin(a) * 0.90);
    tick.rotation.x = a;
    g.add(tick);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + Math.PI / 2;
    const petal = box(0.24, 0.04, 0.36, mats.silver);
    petal.position.set(8.56, Math.cos(a) * 0.68, Math.sin(a) * 0.68);
    petal.rotation.x = a;
    g.add(petal);
  }

  // Diana óptica COAS 3D (Stand-Off Cross Target) montada sobre el puerto en +Y para juzgar paralaje de alineación
  const coasY = 1.32;
  const coasMount = box(0.18, 0.30, 0.08, mats.grey); coasMount.position.set(8.30, 1.02, 0); g.add(coasMount);
  const coasBack = box(0.04, 0.60, 0.60, mats.dark); coasBack.position.set(8.38, coasY, 0); g.add(coasBack);
  const coasFace = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), mats.coasPlate);
  coasFace.rotation.y = Math.PI / 2; coasFace.position.set(8.405, coasY, 0); g.add(coasFace);
  // Vástago separador central (stand-off 0,26 m en +X) y cruz 3D en relieve adelantada
  const standOff = cyl(0.014, 0.26, mats.dark, 10); standOff.rotation.z = Math.PI / 2; standOff.position.set(8.535, coasY, 0); g.add(standOff);
  const crossH = box(0.028, 0.032, 0.34, mats.white_led); crossH.position.set(8.675, coasY, 0); g.add(crossH);
  const crossV = box(0.028, 0.34, 0.032, mats.white_led); crossV.position.set(8.675, coasY, 0); g.add(crossV);
  const crossCore = box(0.036, 0.056, 0.056, mats.orange); crossCore.position.set(8.682, coasY, 0); g.add(crossCore);

  // 4 balizas LED de guiado direccional en las esquinas del puerto (verde = derecha/estribor al aproximarse, rojo = izquierda/babor)
  const corners: [number, number, THREE.Material][] = [
    [0.98, -0.98, mats.green],
    [-0.98, -0.98, mats.green],
    [0.98, 0.98, mats.red],
    [-0.98, 0.98, mats.red],
  ];
  for (const [y, z, m] of corners) {
    // Soporte + capuchón direccional orientado hacia el corredor +X
    const strut = box(0.22, 0.06, 0.06, mats.grey); strut.position.set(8.22, y * 0.88, z * 0.88); g.add(strut);
    const hood = cyl(0.095, 0.12, mats.dark, 14); hood.rotation.z = Math.PI / 2; hood.position.set(8.36, y, z); g.add(hood);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 8), m); led.position.set(8.42, y, z); g.add(led);
  }
  // Baliza blanca superior de referencia de vertical/alabeo sobre la diana COAS
  const rollRef = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), mats.white_led);
  rollRef.position.set(8.44, coasY + 0.36, 0); g.add(rollRef);

  // Celosía integrada con diagonales reales y 4 pares de alas solares PBR + radiadores
  const truss = box(0.95, 0.78, 36, mats.grey); truss.position.set(-2, 0, 0); g.add(truss);
  for (let i = 0; i < 18; i++) {
    const d = box(1.06, 0.055, 0.055, mats.dark);
    d.position.set(-2, 0.40, -17 + i * 2.0);
    d.rotation.y = i % 2 ? 0.62 : -0.62;
    g.add(d);
  }
  for (const s of [-1, 1]) {
    for (const off of [10.5, 22.0]) {
      const mast = cyl(0.14, 10.2, mats.silver, 16); mast.rotation.x = Math.PI / 2; mast.position.set(-2, 0, s * off); g.add(mast);
      const p = box(5.8, 0.06, 9.6, mats.solar); p.position.set(-2, 0, s * off); g.add(p);
      const fr = box(6.0, 0.09, 0.14, mats.silver); fr.position.set(-2, 0, s * (off + 4.8)); g.add(fr);
      const fr2 = box(6.0, 0.09, 0.14, mats.silver); fr2.position.set(-2, 0, s * (off - 4.8)); g.add(fr2);
    }
  }
  for (const sy of [-1, 1]) {
    const rad = box(0.07, 6.2, 3.6, mats.white); rad.position.set(-5, sy * 4.2, 0); g.add(rad);
    const radRim = box(0.09, 6.3, 0.08, mats.silver); radRim.position.set(-5, sy * 4.2, 1.8); g.add(radRim);
  }
  const ant = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), mats.white);
  ant.position.set(0, 2.85, 0); ant.rotation.x = Math.PI; g.add(ant);

  // Rótulo de estación «TESELA»
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#d9d7d0'; c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#c84b20'; c.fillRect(0, 108, 512, 12);
  c.fillStyle = '#1b1f26'; c.font = 'bold 80px Archivo, sans-serif'; c.textAlign = 'center';
  c.fillText('TESELA', 256, 88);
  const lt = new THREE.CanvasTexture(cv); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.55 }));
  label.position.set(0, 2.12, 0); label.rotation.x = -Math.PI / 2; g.add(label);

  mergeByMaterial(g);
  const obj: WorldObject = { id: 'tesela', label: 'Estación Tesela', group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), radius: 26 };
  return { obj, dockLocal: new THREE.Vector3(8.55, 0, 0), dockAxis: new THREE.Vector3(1, 0, 0) };
}

/** Observatorio «Halo-7» con espejo primario óptico, escudo térmico multicapa y 3 balizas de inspección. */
export function buildSatellite(): { obj: WorldObject; inspect: THREE.Vector3[] } {
  const mats = getMats();
  const g = new THREE.Group();
  const bus = box(1.65, 1.65, 1.65, mats.gold); g.add(bus);
  const collar = cyl(0.92, 0.25, mats.grey, 32); collar.position.y = 0.92; g.add(collar);
  const tube = cyl(0.78, 3.3, mats.white, 40); tube.position.y = 2.55; g.add(tube);
  const baffle = cyl(0.84, 0.22, mats.dark, 40); baffle.position.y = 4.15; g.add(baffle);
  const mirror = cyl(0.68, 0.04, mats.optics, 36); mirror.position.y = 4.18; g.add(mirror);
  const ap = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.05, 10, 40), mats.silver); ap.rotation.x = Math.PI / 2; ap.position.y = 4.24; g.add(ap);
  // Parasol criogénico de 3 capas
  for (let k = 0; k < 3; k++) {
    const shade = box(4.6 - k * 0.25, 0.03, 3.9 - k * 0.2, k === 0 ? mats.silver : mats.gold);
    shade.position.set(0, -1.05 - k * 0.14, 0);
    g.add(shade);
  }
  for (const s of [-1, 1]) {
    const p = box(3.6, 0.05, 1.25, mats.solar); p.position.set(s * 2.75, 0, 0); g.add(p);
    const arm = cyl(0.06, 1.0, mats.silver, 12); arm.rotation.z = Math.PI / 2; arm.position.set(s * 1.05, 0, 0); g.add(arm);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3), mats.white);
  dish.position.set(0.95, -0.2, 0.95); dish.rotation.z = 2.2; g.add(dish);
  const inspect = [new THREE.Vector3(0, 4.3, 0), new THREE.Vector3(2.75, 0, 0), new THREE.Vector3(0, -1.35, 1.95)];
  for (const p of inspect) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), mats.green);
    b.position.copy(p); b.userData.beacon = true; g.add(b);
  }
  mergeByMaterial(g);
  return { obj: { id: 'halo7', label: 'Observatorio Halo-7', group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(0.0, 0.04, 0.01), radius: 5 }, inspect };
}

/** Cápsula de muestras con cuerpo metálico cepillado, banda naranja y pin de agarre robótico. */
export function buildCanister(): WorldObject {
  const mats = getMats();
  const g = new THREE.Group();
  const body = cyl(0.22, 0.62, mats.white, 28); g.add(body);
  const capA = cyl(0.23, 0.07, mats.grey, 28); capA.position.y = 0.30; g.add(capA);
  const capB = cyl(0.23, 0.07, mats.gold, 28); capB.position.y = -0.30; g.add(capB);
  const band = cyl(0.228, 0.09, mats.orange, 28); g.add(band);
  const pin = cyl(0.032, 0.26, mats.silver, 14); pin.position.y = 0.44; g.add(pin);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10), mats.dark); knob.position.y = 0.58; g.add(knob);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 6), mats.green); led.position.set(0.22, 0.2, 0); g.add(led);
  mergeByMaterial(g);
  return { id: 'canister', label: 'Cápsula de muestras', group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(0.0, 0.0, 0.0), spin: new THREE.Vector3(0.05, 0.1, 0.02), radius: 0.5 };
}

/** Diana holográfica de entrenamiento (sandbox). */
export function buildTarget(i: number): WorldObject {
  const g = new THREE.Group();
  const col = new THREE.Color().setHSL(0.52 + 0.05 * (i % 3), 0.9, 0.55);
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.06, 8, 64), mat); g.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 8, 48), mat); g.add(r2);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), mat); g.add(core);
  for (let k = 0; k < 4; k++) {
    const t = box(0.5, 0.06, 0.06, mat as any);
    t.castShadow = false;
    t.position.set(Math.cos(k * Math.PI / 2) * 2.0, Math.sin(k * Math.PI / 2) * 2.0, 0);
    t.rotation.z = k * Math.PI / 2;
    g.add(t);
  }
  return { id: `target${i}`, label: `Diana ${i + 1}`, group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(0, 0.4, 0), radius: 2.0 };
}
