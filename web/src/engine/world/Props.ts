/**
 * Objetos del mundo cercano (metros): estación ficticia «Tesela», observatorio
 * ficticio «Halo-7», cápsula de muestras y dianas holográficas de entrenamiento.
 * Diseños originales de este proyecto.
 */
import * as THREE from 'three';

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

const M = (c: number, metal = 0, rough = 0.5, emissive = 0x000000, ei = 0) =>
  new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, emissive, emissiveIntensity: ei });

const mats = {
  white: M(0xd8d6d0, 0, 0.55), grey: M(0x8a8d92, 0.6, 0.4), dark: M(0x1d1f22, 0.4, 0.5), gold: M(0xd8a24a, 1, 0.28),
  silver: M(0xd0d3d8, 1, 0.22), solar: new THREE.MeshPhysicalMaterial({ color: 0x101a3a, metalness: 0.2, roughness: 0.25, clearcoat: 0.7 }),
  green: M(0x103010, 0, 0.4, 0x30ff60, 2.5), red: M(0x301010, 0, 0.4, 0xff3020, 2.5), white_led: M(0x222222, 0, 0.4, 0xffffff, 3),
  accent: M(0x2a6fb0, 0, 0.45), orange: M(0xc0581e, 0, 0.45),
};

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

/** Estación «Tesela»: eje +X local = eje del puerto de atraque. */
export function buildStation(): { obj: WorldObject; dockLocal: THREE.Vector3; dockAxis: THREE.Vector3 } {
  const g = new THREE.Group();
  // módulos presurizados en cruz
  const core = cyl(2.1, 9, mats.white, 48); core.rotation.z = Math.PI / 2; g.add(core);
  for (let i = 0; i < 9; i++) { const r = cyl(2.16, 0.12, mats.grey, 48); r.rotation.z = Math.PI / 2; r.position.x = -4.2 + i * 1.05; g.add(r); }
  const node = new THREE.Mesh(new THREE.SphereGeometry(2.4, 40, 24), mats.white); node.position.x = 5.2; node.castShadow = node.receiveShadow = true; g.add(node);
  for (const s of [-1, 1]) {
    const m = cyl(1.9, 7, mats.white, 40); m.position.set(5.2, 0, s * 5.5); m.rotation.x = Math.PI / 2; g.add(m);
    const mli = cyl(1.95, 2, mats.gold, 40); mli.position.set(5.2, 0, s * 8.2); mli.rotation.x = Math.PI / 2; g.add(mli);
  }
  // puerto de atraque (+X)
  const port = cyl(0.9, 1.0, mats.grey, 40); port.rotation.z = Math.PI / 2; port.position.x = 7.9; g.add(port);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 12, 48), mats.silver); ring.rotation.y = Math.PI / 2; ring.position.x = 8.45; g.add(ring);
  // diana de atraque y luces de alineación
  const tgt = box(0.05, 0.5, 0.5, mats.dark); tgt.position.set(8.4, 1.25, 0); g.add(tgt);
  const cross = box(0.06, 0.04, 0.4, mats.white_led); cross.position.set(8.44, 1.25, 0); g.add(cross);
  const cross2 = box(0.06, 0.4, 0.04, mats.white_led); cross2.position.set(8.44, 1.25, 0); g.add(cross2);
  for (const [y, z, m] of [[0.95, 0.95, mats.green], [0.95, -0.95, mats.red], [-0.95, 0.95, mats.green], [-0.95, -0.95, mats.red]] as const) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), m); l.position.set(8.0, y, z); g.add(l);
  }
  // celosía y paneles solares
  const truss = box(1.0, 0.8, 34, mats.grey); truss.position.set(-2, 0, 0); g.add(truss);
  for (let i = 0; i < 16; i++) { const d = box(1.02, 0.05, 0.05, mats.dark); d.position.set(-2, 0.38, -16 + i * 2.1); d.rotation.y = 0.6; g.add(d); }
  for (const s of [-1, 1]) {
    for (const off of [10, 21]) {
      const p = box(5.5, 0.06, 9.5, mats.solar); p.position.set(-2, 0, s * off); g.add(p);
      const fr = box(5.6, 0.08, 0.1, mats.silver); fr.position.set(-2, 0, s * (off + 4.75)); g.add(fr);
    }
  }
  const rad = box(0.08, 6, 3.5, mats.white); rad.position.set(-5, 4, 0); g.add(rad);
  const ant = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), mats.white); ant.position.set(0, 2.8, 0); ant.rotation.x = Math.PI; g.add(ant);
  // nombre
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d')!; c.fillStyle = '#d8d6d0'; c.fillRect(0, 0, 512, 128); c.fillStyle = '#1d1f22'; c.font = 'bold 84px Archivo, sans-serif'; c.textAlign = 'center'; c.fillText('TESELA', 256, 98);
  const lt = new THREE.CanvasTexture(cv); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.6 }));
  label.position.set(0, 2.11, 0); label.rotation.x = -Math.PI / 2; g.add(label);
  const obj: WorldObject = { id: 'tesela', label: 'Estación Tesela', group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), radius: 26 };
  return { obj, dockLocal: new THREE.Vector3(8.55, 0, 0), dockAxis: new THREE.Vector3(1, 0, 0) };
}

/** Observatorio «Halo-7» con 3 puntos de inspección. */
export function buildSatellite(): { obj: WorldObject; inspect: THREE.Vector3[] } {
  const g = new THREE.Group();
  const bus = box(1.6, 1.6, 1.6, mats.gold); g.add(bus);
  const tube = cyl(0.75, 3.2, mats.white, 40); tube.position.y = 2.4; g.add(tube);
  const ap = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.04, 8, 40), mats.dark); ap.rotation.x = Math.PI / 2; ap.position.y = 4.0; g.add(ap);
  const shade = box(4.5, 0.05, 3.8, mats.silver); shade.position.set(0, -1.1, 0); g.add(shade);
  for (const s of [-1, 1]) { const p = box(3.4, 0.05, 1.2, mats.solar); p.position.set(s * 2.6, 0, 0); g.add(p); }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), mats.white); dish.position.set(0.9, -0.2, 0.9); dish.rotation.z = 2.2; g.add(dish);
  const inspect = [new THREE.Vector3(0, 4.1, 0), new THREE.Vector3(2.6, 0, 0), new THREE.Vector3(0, -1.2, 1.9)];
  for (const p of inspect) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), mats.green); b.position.copy(p); b.userData.beacon = true; g.add(b);
  }
  return { obj: { id: 'halo7', label: 'Observatorio Halo-7', group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(0.0, 0.04, 0.01), radius: 5 }, inspect };
}

/** Cápsula de muestras con agarradera para el brazo robótico. */
export function buildCanister(): WorldObject {
  const g = new THREE.Group();
  const body = cyl(0.22, 0.6, mats.white, 24); g.add(body);
  const band = cyl(0.225, 0.08, mats.orange, 24); g.add(band);
  const pin = cyl(0.03, 0.25, mats.grey, 12); pin.position.y = 0.42; g.add(pin);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mats.dark); knob.position.y = 0.56; g.add(knob);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6), mats.green); led.position.set(0.2, 0.2, 0); g.add(led);
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
  for (let k = 0; k < 4; k++) { const t = box(0.5, 0.06, 0.06, mat as any); t.castShadow = false; t.position.set(Math.cos(k * Math.PI / 2) * 2.0, Math.sin(k * Math.PI / 2) * 2.0, 0); t.rotation.z = k * Math.PI / 2; g.add(t); }
  return { id: `target${i}`, label: `Diana ${i + 1}`, group: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(0, 0.4, 0), radius: 2.0 };
}
