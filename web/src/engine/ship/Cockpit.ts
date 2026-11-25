/**
 * Instrumentación e iluminación de a bordo sincronizadas con la simulación.
 * - Pantallas: canvas dibujados en tiempo real (o vídeo en vivo de cámaras
 *   exteriores mediante render-to-texture) con páginas táctiles.
 * - LEDs de los 24 interruptores.
 * - Luminarias por bahía (luz de área + foco con sombra con presupuesto).
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { b2t } from '../util';
import type { ShipModel, PartNode } from './ShipModel';
import type { Systems, SwitchId } from './Systems';
import { SWITCH_ORDER, SWITCH_LABEL } from './Systems';

export type Page = 'PFD' | 'NAV' | 'DOCK' | 'SYS' | 'ECLSS' | 'CAM' | 'CHECK' | 'MISSION' | 'ARM' | 'ARMCAM';
export const PAGE_LABEL: Record<Page, string> = { PFD: 'Actitud', NAV: 'Navegación', DOCK: 'Atraque', SYS: 'Energía', ECLSS: 'Soporte vital', CAM: 'Cámara de proa', CHECK: 'Lista de arranque', MISSION: 'Misión', ARM: 'Brazo robótico', ARMCAM: 'Cámara del brazo' };

const PAGES: Record<string, Page[]> = {
  'scr:C1D1': ['PFD', 'NAV', 'DOCK'], 'scr:C1D2': ['SYS', 'ECLSS', 'CHECK'], 'scr:C1D3': ['CAM', 'NAV', 'DOCK'],
  'scr:C2D1': ['CAM', 'PFD'], 'scr:C2D2': ['CHECK', 'SYS', 'ECLSS'], 'scr:C2D3': ['MISSION', 'NAV', 'PFD'],
  'scr:AUXP': ['ECLSS', 'SYS'], 'scr:AUXS': ['NAV', 'MISSION'], 'scr:RWS1': ['ARMCAM', 'CAM'], 'scr:RWS2': ['ARM', 'MISSION'],
};

export interface Telemetry {
  vel: THREE.Vector3; w: THREE.Vector3; q: THREE.Quaternion; throttle: number; assist: boolean; rcsArmed: boolean; mainArmed: boolean;
  altKm: number; body: string; eclipse: number; targets: { label: string; range: number; rate: number; bearing: THREE.Vector3 }[];
  dock: { range: number; closing: number; lat: number; vert: number; angle: number; capture: boolean } | null;
  mission: { title: string; step: string; progress: string } | null; arm: number[]; checklist: { label: string; done: boolean }[];
}

interface Screen { id: string; node: PartNode; mesh: THREE.Mesh; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; pages: Page[]; page: number; w: number; h: number; lastDraw: number; }

const C = { bg: '#05090e', grid: '#11202e', cy: '#5ec8ff', am: '#ffae44', gr: '#5ee68c', wh: '#dde6ee', rd: '#ff5a46', dim: '#3a556c' };

export class Cockpit {
  screens: Screen[] = [];
  camRT = new THREE.WebGLRenderTarget(640, 360, { colorSpace: THREE.SRGBColorSpace });
  armRT = new THREE.WebGLRenderTarget(512, 320, { colorSpace: THREE.SRGBColorSpace });
  noseCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 2e5);
  armCam = new THREE.PerspectiveCamera(55, 16 / 10, 0.05, 2e5);
  leds!: THREE.InstancedMesh;
  private ledNodes: { id: SwitchId; node: PartNode }[] = [];
  lights = new THREE.Group();
  bayLights: { bay: 'A' | 'B' | 'C' | 'D' | 'N' | 'L'; rect?: THREE.RectAreaLight; spot?: THREE.SpotLight; point?: THREE.PointLight; base: number; pos: THREE.Vector3 }[] = [];
  floods: THREE.SpotLight[] = [];
  airlockLight = new THREE.PointLight(0xffffff, 0, 3, 2);
  wantsCam = false;
  wantsArmCam = false;
  model: ShipModel;

  constructor(model: ShipModel) {
    this.model = model;
    RectAreaLightUniformsLib.init();
    this.buildLights();
  }

  /** Llamar cuando el interior y las pantallas estén cargados. */
  setup() {
    for (const s of this.model.standalone) {
      const id = s.node.ctl;
      if (!id || !PAGES[id]) continue;
      if (this.screens.some((x) => x.id === id)) continue;
      s.mesh.geometry.computeBoundingBox();
      const sz = s.mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      const dims = [sz.x, sz.y, sz.z].sort((a, b) => b - a);
      const aspect = dims[0] / Math.max(1e-3, dims[1]);
      const portrait = sz.y > sz.x * 1.05;
      const w = 512, h = Math.round(portrait ? 512 * aspect : 512 / aspect);
      const canvas = document.createElement('canvas');
      canvas.width = portrait ? Math.round(512 / aspect) : w; canvas.height = portrait ? 512 : h;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      this.fixHandedness(s.mesh);
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, color: new THREE.Color(1.6, 1.6, 1.6) });
      s.mesh.material = mat;
      this.screens.push({ id, node: s.node, mesh: s.mesh, canvas, ctx, tex, mat, pages: PAGES[id], page: 0, w: canvas.width, h: canvas.height, lastDraw: -1 });
    }
    // LEDs de los interruptores
    const nodes: { id: SwitchId; node: PartNode }[] = [];
    for (const id of SWITCH_ORDER) { const n = this.model.mechs.get('sw:' + id); if (n) nodes.push({ id, node: n }); }
    this.ledNodes = nodes;
    if (!this.leds && nodes.length) {
      const g = new THREE.SphereGeometry(0.0065, 10, 6);
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      this.leds = new THREE.InstancedMesh(g, m, nodes.length);
      this.leds.frustumCulled = false;
      const M = new THREE.Matrix4();
      nodes.forEach(({ node }, i) => {
        const mech = node.mech!;
        const n = new THREE.Vector3(0, -1, 0);
        const ly = n.clone().cross(mech.axis).normalize();
        const p = mech.pivot.clone().addScaledVector(ly, 0.045).addScaledVector(n, -0.006);
        M.makeTranslation(p.x, p.y, p.z);
        this.leds.setMatrixAt(i, M);
        this.leds.setColorAt(i, new THREE.Color(0, 0, 0));
      });
      this.model.root.add(this.leds);
    }
  }

  /** Si las UV de la pantalla quedan en espejo vistas desde su cara frontal, invierte u. */
  private fixHandedness(mesh: THREE.Mesh) {
    const g = mesh.geometry;
    const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    if (!uv || pos.count < 3) return;
    const P = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const U = (i: number) => new THREE.Vector2(uv.getX(i), uv.getY(i));
    const [a, b, c] = [0, 1, 2];
    const e1 = P(b).sub(P(a)), e2 = P(c).sub(P(a));
    const d1 = U(b).sub(U(a)), d2 = U(c).sub(U(a));
    const r = 1 / (d1.x * d2.y - d2.x * d1.y || 1);
    const T = e1.clone().multiplyScalar(d2.y).sub(e2.clone().multiplyScalar(d1.y)).multiplyScalar(r);
    const B = e2.clone().multiplyScalar(d1.x).sub(e1.clone().multiplyScalar(d2.x)).multiplyScalar(r);
    const N = new THREE.Vector3(nor.getX(0), nor.getY(0), nor.getZ(0));
    if (T.cross(B).dot(N) < 0) {
      const g2 = g.clone();
      const u2 = g2.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < u2.count; i++) u2.setX(i, 1 - u2.getX(i));
      mesh.geometry = g2;
    }
  }

  private buildLights() {
    const xs = [0.6, 2.65, 4.7, 6.75, 8.8];
    const bays: ('D' | 'C' | 'B' | 'A')[] = ['D', 'C', 'B', 'A'];
    for (let i = 0; i < 4; i++) {
      const xc = (xs[i] + xs[i + 1]) / 2;
      for (const sy of [1, -1]) {
        const r = new THREE.RectAreaLight(0xfff1e0, 0, 1.5, 0.1);
        r.position.copy(b2t(xc, sy * 1.03, 1.03));
        r.lookAt(b2t(xc, sy * 0.2, 0.2));
        this.lights.add(r);
        this.bayLights.push({ bay: bays[i], rect: r, base: 8, pos: r.position.clone() });
      }
      const sp = new THREE.SpotLight(0xfff1e0, 0, 6, 1.25, 0.65, 1.6);
      sp.position.copy(b2t(xc, 0, 1.08));
      sp.target.position.copy(b2t(xc, 0, -1.1));
      sp.shadow.mapSize.set(512, 512); sp.shadow.bias = -0.0008; sp.shadow.normalBias = 0.02; sp.shadow.camera.near = 0.05; sp.shadow.camera.far = 6;
      this.lights.add(sp, sp.target);
      this.bayLights.push({ bay: bays[i], spot: sp, base: 9, pos: sp.position.clone() });
    }
    for (const x of [10.5, 11.6]) {
      const p = new THREE.PointLight(0xfff1e0, 0, 4, 2);
      p.position.copy(b2t(x, 0, 0.75));
      this.lights.add(p);
      this.bayLights.push({ bay: 'N', point: p, base: 2.5, pos: p.position.clone() });
    }
    this.airlockLight.position.copy(b2t(11.05, 0, -2.2));
    this.lights.add(this.airlockLight);
    // focos exteriores
    for (const [p, t] of [[b2t(8.6, 2.0, 1.0), b2t(12, 0, 0)], [b2t(8.6, -2.0, 1.0), b2t(12, 0, 0)], [b2t(11.5, 0, -3.3), b2t(11.0, 0, -5)], [b2t(0.8, 1.6, 1.7), b2t(4, 0, 4)]]) {
      const s = new THREE.SpotLight(0xf2f4ff, 0, 40, 0.5, 0.5, 1.5);
      s.position.copy(p); s.target.position.copy(t);
      this.lights.add(s, s.target);
      this.floods.push(s);
    }
  }

  /** Presupuesto de sombras: solo los focos interiores más cercanos al observador proyectan sombra. */
  updateLights(sys: Systems, viewerLocal: THREE.Vector3 | null, interiorActive: boolean, airlockState: 'pres' | 'depress' | 'vac' | 'repress') {
    const lvl = (b: string) => (b === 'L' ? 1 : sys.lightLevel(b as any));
    const shadowCandidates: { l: THREE.SpotLight; d: number }[] = [];
    for (const bl of this.bayLights) {
      const k = interiorActive ? lvl(bl.bay) : 0;
      if (bl.rect) bl.rect.intensity = bl.base * k;
      if (bl.point) bl.point.intensity = bl.base * k;
      if (bl.spot) {
        bl.spot.intensity = bl.base * k;
        bl.spot.visible = k > 0;
        shadowCandidates.push({ l: bl.spot, d: viewerLocal ? viewerLocal.distanceTo(bl.pos) : 99 });
      }
    }
    shadowCandidates.sort((a, b) => a.d - b.d);
    shadowCandidates.forEach((c, i) => (c.l.castShadow = interiorActive && i < 2 && c.l.intensity > 0));
    const ext = sys.on('LT_EXT') ? 1 : 0;
    for (const f of this.floods) f.intensity = 220 * ext;
    this.airlockLight.intensity = interiorActive ? (sys.lightLevel('N') ? 2.2 : 0.2) : 0;
    this.airlockLight.color.set(airlockState === 'pres' ? 0xfff1e0 : airlockState === 'vac' ? 0xff4a30 : 0xffb030);
    if (airlockState !== 'pres') this.airlockLight.intensity = Math.max(this.airlockLight.intensity, 1.5);
    // emisión de luminarias (color por instancia)
    const xs = [0.6, 2.65, 4.7, 6.75, 8.8];
    for (let k = 1; k <= 8; k++) {
      const n = this.model.nodes.get(`HAB.INT.LGT.L${k}`);
      if (!n) continue;
      const bay = (['D', 'C', 'B', 'A'] as const)[Math.floor((k - 1) / 2)];
      const v = lvl(bay);
      this.model.setNodeColor(n, new THREE.Color(v, v, v));
    }
    const nl = this.model.nodes.get('FWD.INT.LGT');
    if (nl) { const v = lvl('N'); this.model.setNodeColor(nl, new THREE.Color(v, v, v)); }
    // LEDs
    if (this.leds) {
      const col = new THREE.Color();
      this.ledNodes.forEach(({ id }, i) => {
        const powered = sys.sw.BAT;
        if (!powered) col.setRGB(0.02, 0.02, 0.02);
        else if (sys.on(id) || (sys.sw[id] && ['BAT', 'BUSA', 'BUSB', 'FWD', 'SOLAR'].includes(id))) col.setRGB(0.25, 1.8, 0.5);
        else if (sys.sw[id]) col.setRGB(1.8, 1.0, 0.1);
        else col.setRGB(1.2, 0.12, 0.05);
        this.leds.setColorAt(i, col);
      });
      this.leds.instanceColor!.needsUpdate = true;
    }
  }

  cyclePage(id: string) {
    const s = this.screens.find((x) => x.id === id);
    if (!s) return null;
    s.page = (s.page + 1) % s.pages.length;
    s.lastDraw = -1;
    return s.pages[s.page];
  }

  /** Dibuja las pantallas. viewerLocal: posición del observador en espacio de nave (para priorizar). */
  draw(now: number, sys: Systems, tel: Telemetry, viewerLocal: THREE.Vector3 | null) {
    const on = sys.screensOn();
    const booting = sys.on('AVX') && !sys.booted;
    this.wantsCam = false; this.wantsArmCam = false;
    for (const s of this.screens) {
      const pg = s.pages[s.page];
      const d = viewerLocal ? viewerLocal.distanceTo(s.mesh.getWorldPosition(new THREE.Vector3())) : 99;
      const live = on && (pg === 'CAM' || pg === 'ARMCAM');
      if (live) {
        if (d < 12) { if (pg === 'CAM') this.wantsCam = true; else this.wantsArmCam = true; }
        const rt = pg === 'CAM' ? this.camRT : this.armRT;
        if (s.mat.map !== rt.texture) { s.mat.map = rt.texture; s.mat.needsUpdate = true; }
        s.mat.color.setScalar(1.15);
        continue;
      }
      if (s.mat.map !== s.tex) { s.mat.map = s.tex; s.mat.needsUpdate = true; }
      const period = d < 4 ? 0.12 : d < 12 ? 0.5 : 2.0;
      if (now - s.lastDraw < period) continue;
      s.lastDraw = now;
      const g = s.ctx;
      const W = s.w, H = s.h;
      if (!sys.sw.BAT || (!on && !booting)) { g.fillStyle = '#020304'; g.fillRect(0, 0, W, H); s.tex.needsUpdate = true; s.mat.color.setScalar(0.6); continue; }
      s.mat.color.setScalar(1.6);
      if (booting) { this.drawBoot(g, W, H, sys.bootT / 3.2); s.tex.needsUpdate = true; continue; }
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      this.header(g, W, PAGE_LABEL[pg], s.page, s.pages.length);
      switch (pg) {
        case 'PFD': this.drawPFD(g, W, H, tel); break;
        case 'NAV': this.drawNAV(g, W, H, tel); break;
        case 'DOCK': this.drawDOCK(g, W, H, tel); break;
        case 'SYS': this.drawSYS(g, W, H, sys); break;
        case 'ECLSS': this.drawECLSS(g, W, H, sys); break;
        case 'CHECK': this.drawCHECK(g, W, H, tel); break;
        case 'MISSION': this.drawMISSION(g, W, H, tel, sys); break;
        case 'ARM': this.drawARM(g, W, H, tel); break;
      }
      s.tex.needsUpdate = true;
    }
  }

  private header(g: CanvasRenderingContext2D, W: number, title: string, i: number, n: number) {
    g.fillStyle = '#0b1622'; g.fillRect(0, 0, W, 34);
    g.fillStyle = C.cy; g.font = '600 17px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    g.fillText(title.toUpperCase(), 12, 18);
    g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(`${i + 1}/${n} ▸`, W - 10, 18); g.textAlign = 'left';
  }
  private txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, c = C.wh, size = 16, w = 500) {
    g.fillStyle = c; g.font = `${w} ${size}px "IBM Plex Mono", monospace`; g.textBaseline = 'alphabetic'; g.fillText(s, x, y);
  }
  private bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, c: string) {
    g.strokeStyle = C.dim; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    g.fillStyle = c; g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, v)), h - 2);
  }

  private drawBoot(g: CanvasRenderingContext2D, W: number, H: number, k: number) {
    g.fillStyle = '#03060a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e2572b'; g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2 - 40, H / 2 - 10); g.lineTo(W / 2, H / 2 - 50); g.lineTo(W / 2 + 40, H / 2 - 10); g.stroke();
    this.txt(g, 'ALCIÓN · VLA-OS 4.2', W / 2 - 100, H / 2 + 30, C.wh, 18);
    this.bar(g, W / 2 - 110, H / 2 + 50, 220, 10, k, C.cy);
    const lines = ['BIT memoria .... OK', 'Bus 1553B ....... OK', 'Reloj ........... OK', 'Navegación ...... ' + (k > 0.7 ? 'OK' : '...')];
    lines.slice(0, Math.ceil(k * 4)).forEach((l, i) => this.txt(g, l, 20, H - 90 + i * 20, C.dim, 14));
  }

  private drawPFD(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const e = new THREE.Euler().setFromQuaternion(t.q, 'YXZ');
    const cx = W / 2, cy = 34 + (H - 34) * 0.45, R = Math.min(W, H) * 0.3;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.translate(cx, cy); g.rotate(-e.z);
    const off = (e.x / (Math.PI / 2)) * R;
    g.fillStyle = '#1b3a5e'; g.fillRect(-R * 2, -R * 2 + off, R * 4, R * 2);
    g.fillStyle = '#4b3420'; g.fillRect(-R * 2, off, R * 4, R * 2);
    g.strokeStyle = C.wh; g.lineWidth = 2; g.beginPath(); g.moveTo(-R * 2, off); g.lineTo(R * 2, off); g.stroke();
    for (let k = -3; k <= 3; k++) { if (!k) continue; const y = off - k * R / 3; g.beginPath(); g.moveTo(-R * 0.25, y); g.lineTo(R * 0.25, y); g.stroke(); }
    g.restore();
    g.strokeStyle = C.am; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - R * 0.5, cy); g.lineTo(cx - R * 0.15, cy); g.moveTo(cx + R * 0.15, cy); g.lineTo(cx + R * 0.5, cy); g.stroke();
    g.strokeStyle = C.cy; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    const yb = cy + R + 34;
    const v = t.vel.length();
    this.txt(g, `V  ${v.toFixed(2)} m/s`, 16, yb, C.gr, 18);
    this.txt(g, `ω  ${(t.w.length() * 57.3).toFixed(2)} °/s`, 16, yb + 24, C.wh, 16);
    this.txt(g, `EMP ${(t.throttle * 100).toFixed(0)} %`, W / 2 + 10, yb, t.throttle > 0 ? C.am : C.dim, 18);
    this.txt(g, t.assist ? 'ASISTIDO' : 'MANUAL', W / 2 + 10, yb + 24, t.assist ? C.cy : C.am, 16);
    this.txt(g, `RCS ${t.rcsArmed ? 'ARM' : 'SAFE'}  MOT ${t.mainArmed ? 'ARM' : 'SAFE'}`, 16, yb + 48, t.rcsArmed ? C.gr : C.rd, 14);
  }

  private drawNAV(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const cx = W / 2, cy = 34 + (H - 34) * 0.48, R = Math.min(W, H - 34) * 0.42;
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.fillStyle = C.am; g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx - 7, cy + 8); g.lineTo(cx + 7, cy + 8); g.fill();
    const maxR = Math.max(200, ...t.targets.map((x) => x.range)) * 1.1;
    for (const tg of t.targets) {
      const b = tg.bearing;
      const k = Math.min(1, tg.range / maxR) * R;
      const x = cx + b.z * k, y = cy - b.x * k;
      g.fillStyle = C.gr; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      this.txt(g, `${tg.label} ${tg.range < 1000 ? tg.range.toFixed(0) + ' m' : (tg.range / 1000).toFixed(2) + ' km'}`, x + 8, y + 4, C.wh, 13);
    }
    this.txt(g, `${t.body.toUpperCase()}  ALT ${t.altKm.toFixed(0)} km`, 12, H - 34, C.cy, 15);
    this.txt(g, t.eclipse > 0.5 ? 'EN SOMBRA' : 'ILUMINADO', 12, H - 12, t.eclipse > 0.5 ? C.am : C.dim, 14);
  }

  private drawDOCK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const d = t.dock;
    if (!d) { this.txt(g, 'Sin objetivo de atraque', 20, 80, C.dim); return; }
    const cx = W / 2, cy = 34 + (H - 34) * 0.42, R = Math.min(W, H) * 0.28;
    g.strokeStyle = C.dim; g.strokeRect(cx - R, cy - R, R * 2, R * 2);
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    const sc = R / 2;
    const x = cx + Math.max(-R, Math.min(R, d.lat * sc)), y = cy - Math.max(-R, Math.min(R, d.vert * sc));
    const ok = Math.abs(d.lat) < 0.15 && Math.abs(d.vert) < 0.15 && d.angle < 4;
    g.strokeStyle = ok ? C.gr : C.am; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.stroke();
    const yb = cy + R + 30;
    this.txt(g, `DIST ${d.range.toFixed(2)} m`, 14, yb, C.wh, 17);
    this.txt(g, `VEL ${d.closing.toFixed(3)} m/s`, W / 2, yb, d.closing > 0.3 ? C.rd : C.gr, 17);
    this.txt(g, `ÁNG ${d.angle.toFixed(1)}°`, 14, yb + 24, d.angle < 4 ? C.gr : C.am, 15);
    this.txt(g, d.capture ? 'CAPTURA' : ok ? 'ALINEADO' : 'ALINEANDO', W / 2, yb + 24, d.capture ? C.gr : ok ? C.cy : C.am, 15);
  }

  private drawSYS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems) {
    let y = 60;
    this.txt(g, `GENERACIÓN ${s.solarKW.toFixed(1)} kW`, 14, y, C.gr, 16); this.bar(g, 14, y + 8, W - 28, 10, s.solarKW / 48, C.gr); y += 44;
    this.txt(g, `CONSUMO   ${s.loadKW.toFixed(1)} kW`, 14, y, C.am, 16); this.bar(g, 14, y + 8, W - 28, 10, s.loadKW / 30, C.am); y += 44;
    this.txt(g, `BATERÍA   ${(s.soc * 100).toFixed(0)} %`, 14, y, s.soc > 0.25 ? C.wh : C.rd, 16); this.bar(g, 14, y + 8, W - 28, 10, s.soc, s.soc > 0.25 ? C.cy : C.rd); y += 44;
    const buses: [string, boolean][] = [['BUS A', s.bus('A')], ['BUS B', s.bus('B')], ['NODO', s.bus('F')]];
    buses.forEach(([l, v], i) => { g.fillStyle = v ? C.gr : C.rd; g.fillRect(14 + i * ((W - 28) / 3), y, (W - 28) / 3 - 8, 26); this.txt(g, l, 22 + i * ((W - 28) / 3), y + 18, '#031008', 14, 600); });
    y += 50;
    this.txt(g, `BIPROP ${s.biprop.toFixed(0)} kg   Xe ${s.xenon.toFixed(0)} kg`, 14, Math.min(H - 14, y), C.dim, 14);
  }

  private drawECLSS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems) {
    const rows: [string, string, number, string][] = [
      ['O₂', `${s.o2.toFixed(1)} kPa`, (s.o2 - 18) / 5, s.o2 > 19.5 ? C.gr : C.rd],
      ['CO₂', `${s.co2.toFixed(2)} kPa`, s.co2 / 0.7, s.co2 < 0.45 ? C.gr : s.co2 < 0.53 ? C.am : C.rd],
      ['CABINA', `${s.temp.toFixed(1)} °C`, (s.temp - 10) / 20, s.temp > 17 && s.temp < 27 ? C.gr : C.am],
      ['AVIÓNICA', `${s.avionicsTemp.toFixed(0)} °C`, (s.avionicsTemp - 15) / 40, s.avionicsTemp < 45 ? C.gr : C.am],
    ];
    rows.forEach(([k, v, f, c], i) => { const y = 66 + i * 50; this.txt(g, k, 14, y, C.dim, 15); this.txt(g, v, W - 150, y, c, 17); this.bar(g, 14, y + 10, W - 28, 10, f, c); });
    const y = 66 + rows.length * 50 + 10;
    const an = s.anomalies.filter((a) => !a.fixed);
    if (an.length) { this.txt(g, '⚠ ' + an[0].label, 14, Math.min(H - 30, y), C.rd, 13); this.txt(g, an[0].where, 14, Math.min(H - 12, y + 18), C.am, 12); }
    else this.txt(g, 'Sin anomalías', 14, Math.min(H - 14, y), C.gr, 14);
  }

  private drawCHECK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    this.txt(g, 'SECUENCIA DE ACTIVACIÓN', 14, 60, C.cy, 15, 600);
    t.checklist.forEach((c, i) => {
      const y = 92 + i * 26;
      if (y > H - 10) return;
      g.fillStyle = c.done ? C.gr : C.dim; g.fillRect(14, y - 12, 14, 14);
      this.txt(g, c.label, 36, y, c.done ? C.wh : C.dim, 14);
    });
  }

  private drawMISSION(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, s: Systems) {
    if (t.mission) {
      this.txt(g, t.mission.title, 14, 62, C.cy, 16, 600);
      this.wrap(g, t.mission.step, 14, 92, W - 28, 20, C.wh);
      this.txt(g, t.mission.progress, 14, H - 16, C.am, 14);
    } else this.txt(g, 'Sin misión activa', 14, 62, C.dim, 16);
    s.alerts.slice(0, 3).forEach((a, i) => this.txt(g, a.text.slice(0, 40), 14, H - 70 + i * 18, a.level === 'alarm' ? C.rd : a.level === 'warn' ? C.am : C.dim, 12));
  }

  private drawARM(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const names = ['Hombro rodillo', 'Hombro cabeceo', 'Codo', 'Muñeca cabeceo', 'Muñeca guiñada', 'Muñeca rodillo'];
    t.arm.forEach((a, i) => { const y = 64 + i * 40; this.txt(g, names[i], 14, y, C.dim, 14); this.txt(g, `${(a * 57.3).toFixed(1)}°`, W - 110, y, C.cy, 16); this.bar(g, 14, y + 8, W - 28, 8, (a + Math.PI) / (2 * Math.PI), C.cy); });
  }

  private wrap(g: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, lh: number, c: string) {
    g.font = '500 15px "IBM Plex Mono", monospace'; g.fillStyle = c;
    let line = '';
    for (const w of s.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW) { g.fillText(line, x, y); y += lh; line = w; } else line = test;
    }
    if (line) g.fillText(line, x, y);
  }

  /** Cámaras exteriores (en espacio de nave): proa (atraque) y extremo del brazo. */
  placeCams(shipRoot: THREE.Object3D, armTip: THREE.Vector3) {
    this.noseCam.position.copy(b2t(13.3, 0, 0.4)).applyMatrix4(shipRoot.matrixWorld);
    this.noseCam.quaternion.copy(shipRoot.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)));
    this.armCam.position.copy(armTip).applyMatrix4(shipRoot.matrixWorld);
    this.armCam.quaternion.copy(this.noseCam.quaternion);
  }
}

export { SWITCH_LABEL };
