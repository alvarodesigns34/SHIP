/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Instrumentación MFD de alta densidad e iluminación interior sincronizada con el
 * lightmap horneado en Cycles (`BAY_LIGHTS`).
 */
import * as THREE from 'three';
import { b2t } from '../util';
import type { ShipModel } from './ShipModel';
import { BAY_GAIN } from '../interior/RMaterials';
import type { Interior, IPart } from '../interior/Interior';
import type { Systems, SwitchId } from './Systems';
import { SWITCH_ORDER, SWITCH_LABEL } from './Systems';

export type Page = 'PFD' | 'NAV' | 'DOCK' | 'SYS' | 'ECLSS' | 'CAM' | 'CHECK' | 'MISSION' | 'ARM' | 'ARMCAM';
export const PAGE_LABEL: Record<Page, string> = {
  PFD: 'Actitud', NAV: 'Navegación', DOCK: 'Atraque', SYS: 'Energía', ECLSS: 'Soporte vital',
  CAM: 'Cámara de proa', CHECK: 'Lista de arranque', MISSION: 'Misión', ARM: 'Brazo robótico', ARMCAM: 'Cámara del brazo',
};

const PAGES: Record<string, Page[]> = {
  'scr:C1D1': ['PFD', 'NAV', 'DOCK'], 'scr:C1D2': ['SYS', 'ECLSS', 'CHECK'], 'scr:C1D3': ['CAM', 'NAV', 'DOCK'],
  'scr:C2D1': ['CAM', 'PFD'], 'scr:C2D2': ['CHECK', 'SYS', 'ECLSS'], 'scr:C2D3': ['MISSION', 'NAV', 'PFD'],
  'scr:AUXP': ['ECLSS', 'SYS'], 'scr:AUXS': ['NAV', 'MISSION'], 'scr:RWS1': ['ARMCAM', 'CAM'], 'scr:RWS2': ['ARM', 'MISSION'],
};

export interface Telemetry {
  vel: THREE.Vector3; w: THREE.Vector3; q: THREE.Quaternion; throttle: number; assist: boolean; rcsArmed: boolean; mainArmed: boolean;
  altKm: number; body: string; eclipse: number;
  orbit?: { vOrbKmS: number; periodMin: number; apogeeKm: number; perigeeKm: number; inclinationDeg: number };
  targets: { label: string; range: number; rate: number; bearing: THREE.Vector3 }[];
  dock: { range: number; closing: number; lat: number; vert: number; angle: number; capture: boolean } | null;
  mission: { title: string; step: string; progress: string } | null; arm: number[]; checklist: { label: string; done: boolean }[];
}

interface Screen {
  id: string; mesh: THREE.Mesh; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; pages: Page[]; page: number; w: number; h: number; lastDraw: number;
}

const C = { bg: '#04080e', panel: '#0a1522', grid: '#142638', cy: '#5ed0ff', am: '#ffb248', gr: '#58eb8c', wh: '#e4ecf4', rd: '#ff5644', dim: '#4b6880' };

export class Cockpit {
  screens: Screen[] = [];
  camRT = new THREE.WebGLRenderTarget(768, 432, { colorSpace: THREE.SRGBColorSpace });
  armRT = new THREE.WebGLRenderTarget(640, 400, { colorSpace: THREE.SRGBColorSpace });
  noseCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 2e5);
  armCam = new THREE.PerspectiveCamera(55, 16 / 10, 0.05, 2e5);
  leds!: THREE.InstancedMesh;
  private ledNodes: { id: SwitchId; node: IPart }[] = [];
  lights = new THREE.Group();
  floods: THREE.SpotLight[] = [];
  private tmpP = new THREE.Vector3();
  wantsCam = false;
  wantsArmCam = false;
  model: ShipModel;

  constructor(model: ShipModel) {
    this.model = model;
    this.buildLights();
  }

  /** Enlaza las pantallas y los interruptores del interior Rebirth. */
  setup(interior: Interior, parent: THREE.Object3D) {
    for (const [id, mesh] of interior.screens) {
      const key = id;
      if (!PAGES[key] || this.screens.some((x) => x.id === key)) continue;
      mesh.geometry.computeBoundingBox();
      const sz = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      const dims = [sz.x, sz.y, sz.z].sort((a, b) => b - a);
      const aspect = dims[0] / Math.max(1e-3, dims[1]);
      const baseRes = 640;
      const canvas = document.createElement('canvas');
      canvas.width = baseRes;
      canvas.height = Math.round(baseRes / aspect);
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.flipY = false;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, color: new THREE.Color(1.3, 1.3, 1.3) });
      mesh.material = mat;
      mesh.castShadow = false;
      this.screens.push({ id: key, mesh, canvas, ctx, tex, mat, pages: PAGES[key], page: 0, w: canvas.width, h: canvas.height, lastDraw: -1 });
    }
    const nodes: { id: SwitchId; node: IPart }[] = [];
    for (const id of SWITCH_ORDER) { const n = interior.mechs.get('sw:' + id); if (n) nodes.push({ id, node: n }); }
    this.ledNodes = nodes;
    if (!this.leds && nodes.length) {
      const g = new THREE.SphereGeometry(0.005, 10, 6);
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      this.leds = new THREE.InstancedMesh(g, m, nodes.length);
      this.leds.frustumCulled = false;
      const M = new THREE.Matrix4();
      nodes.forEach(({ node }, i) => {
        const mech = node.mech!;
        const up = new THREE.Vector3(0, 1, 0);
        const side = up.clone().cross(mech.axis).normalize();
        const p = mech.pivot.clone().addScaledVector(side, 0.04).addScaledVector(up, 0.004);
        M.makeTranslation(p.x, p.y, p.z);
        this.leds.setMatrixAt(i, M);
        this.leds.setColorAt(i, new THREE.Color(0, 0, 0));
      });
      parent.add(this.leds);
    }
  }

  private buildLights() {
    // focos exteriores (LT_EXT): iluminan el casco y la zona de atraque
    for (const [p, t] of [[b2t(8.6, 2.0, 1.0), b2t(12, 0, 0)], [b2t(8.6, -2.0, 1.0), b2t(12, 0, 0)], [b2t(11.5, 0, -3.3), b2t(11.0, 0, -5)], [b2t(0.8, 1.6, 1.7), b2t(4, 0, 4)]]) {
      const s = new THREE.SpotLight(0xf2f4ff, 0, 40, 0.5, 0.5, 1.5);
      s.position.copy(p); s.target.position.copy(t);
      this.lights.add(s, s.target);
      this.floods.push(s);
    }
  }

  /** Luces de bahía (modulan los lightmaps), focos exteriores y LED de estado de los interruptores. */
  updateLights(sys: Systems) {
    const lvl = (b: 'A' | 'B' | 'C' | 'D' | 'N') => sys.lightLevel(b as any);
    BAY_GAIN.value[0] = lvl('A'); BAY_GAIN.value[1] = lvl('B'); BAY_GAIN.value[2] = lvl('C'); BAY_GAIN.value[3] = lvl('D'); BAY_GAIN.value[4] = lvl('N');
    const ext = sys.on('LT_EXT') ? 1 : 0;
    for (const f of this.floods) { f.intensity = 220 * ext; f.visible = ext > 0; }
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

  draw(now: number, sys: Systems, tel: Telemetry, viewerLocal: THREE.Vector3 | null) {
    const on = sys.screensOn();
    const booting = sys.on('AVX') && !sys.booted;
    this.wantsCam = false; this.wantsArmCam = false;
    for (const s of this.screens) {
      const pg = s.pages[s.page];
      const d = viewerLocal ? viewerLocal.distanceTo(this.tmpP.setFromMatrixPosition(s.mesh.matrixWorld)) : 99;
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
      const sc = W / 512;
      g.save();
      g.scale(sc, sc);
      const vW = 512, vH = H / sc;
      if (!sys.sw.BAT || (!on && !booting)) {
        g.fillStyle = '#020406'; g.fillRect(0, 0, vW, vH);
        g.restore(); s.tex.needsUpdate = true; s.mat.color.setScalar(0.5); continue;
      }
      s.mat.color.setScalar(1.48);
      if (booting) { this.drawBoot(g, vW, vH, sys.bootT / 3.2); g.restore(); s.tex.needsUpdate = true; continue; }
      g.fillStyle = C.bg; g.fillRect(0, 0, vW, vH);
      this.header(g, vW, PAGE_LABEL[pg], s.page, s.pages.length);
      switch (pg) {
        case 'PFD': this.drawPFD(g, vW, vH, tel); break;
        case 'NAV': this.drawNAV(g, vW, vH, tel); break;
        case 'DOCK': this.drawDOCK(g, vW, vH, tel); break;
        case 'SYS': this.drawSYS(g, vW, vH, sys); break;
        case 'ECLSS': this.drawECLSS(g, vW, vH, sys); break;
        case 'CHECK': this.drawCHECK(g, vW, vH, tel); break;
        case 'MISSION': this.drawMISSION(g, vW, vH, tel, sys); break;
        case 'ARM': this.drawARM(g, vW, vH, tel); break;
      }
      // Sutil marco de borde de cristal MFD
      g.strokeStyle = '#162b40'; g.lineWidth = 2; g.strokeRect(1, 1, vW - 2, vH - 2);
      g.restore();
      s.tex.needsUpdate = true;
    }
  }

  private header(g: CanvasRenderingContext2D, W: number, title: string, i: number, n: number) {
    g.fillStyle = C.panel; g.fillRect(0, 0, W, 38);
    g.fillStyle = '#e2572b'; g.fillRect(0, 0, 5, 38);
    g.fillStyle = C.cy; g.font = '600 17px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    g.fillText(`VLA · ${title.toUpperCase()}`, 14, 20);
    g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(`PG ${i + 1}/${n} ▸`, W - 12, 20); g.textAlign = 'left';
    g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 38); g.lineTo(W, 38); g.stroke();
  }
  private txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, c = C.wh, size = 16, w = 500) {
    g.fillStyle = c; g.font = `${w} ${size}px "IBM Plex Mono", monospace`; g.textBaseline = 'alphabetic'; g.fillText(s, x, y);
  }
  private bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, c: string) {
    g.fillStyle = '#08111b'; g.fillRect(x, y, w, h);
    g.strokeStyle = C.dim; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    g.fillStyle = c; g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, v)), h - 2);
  }

  private drawBoot(g: CanvasRenderingContext2D, W: number, H: number, k: number) {
    g.fillStyle = '#03060b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e2572b'; g.lineWidth = 4; g.beginPath();
    g.moveTo(W / 2 - 42, H / 2 - 12); g.lineTo(W / 2, H / 2 - 54); g.lineTo(W / 2 + 42, H / 2 - 12); g.stroke();
    this.txt(g, 'ALCIÓN HX-4 · VLA-OS 5.0', W / 2 - 125, H / 2 + 28, C.wh, 18, 600);
    this.bar(g, W / 2 - 120, H / 2 + 48, 240, 12, k, C.cy);
    const lines = ['BIT memoria ECC ....... OK', 'Bus TTEthernet ........ OK', 'IMU / Rastreadores .... OK', 'GNC Orbital ........... ' + (k > 0.7 ? 'NOMINAL' : 'INIT...')];
    lines.slice(0, Math.ceil(k * 4)).forEach((l, i) => this.txt(g, l, 24, H - 96 + i * 20, C.dim, 13));
  }

  private drawPFD(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const e = new THREE.Euler().setFromQuaternion(t.q, 'YXZ');
    const cx = W / 2, cy = 40 + (H - 40) * 0.43, R = Math.min(W, H) * 0.30;
    // Horizonte artificial con degradado atmosférico y escala de cabeceo numerada
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.translate(cx, cy); g.rotate(-e.z);
    const off = (e.x / (Math.PI / 2)) * R;
    const sky = g.createLinearGradient(0, -R, 0, off);
    sky.addColorStop(0, '#0a1f3a'); sky.addColorStop(1, '#1d4d82');
    g.fillStyle = sky; g.fillRect(-R * 2, -R * 2 + off, R * 4, R * 2);
    const grd = g.createLinearGradient(0, off, 0, R);
    grd.addColorStop(0, '#5a3a1e'); grd.addColorStop(1, '#26170b');
    g.fillStyle = grd; g.fillRect(-R * 2, off, R * 4, R * 2);
    g.strokeStyle = C.wh; g.lineWidth = 2; g.beginPath(); g.moveTo(-R * 2, off); g.lineTo(R * 2, off); g.stroke();
    g.lineWidth = 1.5;
    for (let deg = -30; deg <= 30; deg += 10) {
      if (deg === 0) continue;
      const y = off - (deg / 90) * R;
      const hw = deg % 20 === 0 ? R * 0.32 : R * 0.18;
      g.beginPath(); g.moveTo(-hw, y); g.lineTo(hw, y); g.stroke();
    }
    g.restore();
    // Arco graduado de alabeo (bank angle scale)
    g.strokeStyle = C.cy; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    for (const a of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const rad = ((a - 90) * Math.PI) / 180;
      const r0 = R + 2, r1 = R + (a % 30 === 0 ? 10 : 6);
      g.beginPath(); g.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0); g.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1); g.stroke();
    }
    // Símbolo central de actitud (retícula ámbar)
    g.strokeStyle = C.am; g.lineWidth = 3.5; g.beginPath();
    g.moveTo(cx - R * 0.45, cy); g.lineTo(cx - R * 0.14, cy); g.lineTo(cx - R * 0.14, cy + 8);
    g.moveTo(cx + R * 0.45, cy); g.lineTo(cx + R * 0.14, cy); g.lineTo(cx + R * 0.14, cy + 8);
    g.stroke();
    g.fillStyle = C.am; g.fillRect(cx - 2.5, cy - 2.5, 5, 5);

    const yb = cy + R + 32;
    const v = t.vel.length();
    this.txt(g, `Vrel ${v.toFixed(2)} m/s`, 16, yb, C.gr, 17, 600);
    if (t.orbit) this.txt(g, `Vorb ${t.orbit.vOrbKmS.toFixed(2)} km/s`, 16, yb + 24, C.cy, 15);
    else this.txt(g, `ω  ${(t.w.length() * 57.3).toFixed(2)} °/s`, 16, yb + 24, C.wh, 15);
    this.txt(g, `EMP ${(t.throttle * 100).toFixed(0)} %`, W / 2 + 12, yb, t.throttle > 0 ? C.am : C.dim, 17, 600);
    this.txt(g, t.assist ? 'GNC ASISTIDO' : 'GNC MANUAL', W / 2 + 12, yb + 24, t.assist ? C.cy : C.am, 15);
    this.txt(g, `RCS ${t.rcsArmed ? 'ARM' : 'SAFE'} · MOT ${t.mainArmed ? 'ARM' : 'SAFE'} · ω ${(t.w.length() * 57.3).toFixed(1)}°/s`, 16, yb + 48, t.rcsArmed ? C.gr : C.rd, 13);
  }

  private drawNAV(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const cx = W / 2, cy = 40 + (H - 40) * 0.44, R = Math.min(W, H - 40) * 0.38;
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
      this.txt(g, `${tg.label} ${tg.range < 1000 ? tg.range.toFixed(0) + 'm' : (tg.range / 1000).toFixed(2) + 'km'}`, x + 8, y + 4, C.wh, 12);
    }
    const o = t.orbit;
    this.txt(g, `${t.body.toUpperCase()} · ALT ${t.altKm.toFixed(0)} km${o ? ` · INC ${o.inclinationDeg.toFixed(1)}°` : ''}`, 14, H - 38, C.cy, 14, 600);
    if (o) this.txt(g, `APO ${o.apogeeKm.toFixed(0)} km · PER ${o.perigeeKm.toFixed(0)} km · T ${o.periodMin.toFixed(1)} min`, 14, H - 16, C.wh, 13);
    else this.txt(g, t.eclipse > 0.5 ? 'EN SOMBRA ORBITAL' : 'ILUMINADO POR SOL', 14, H - 16, t.eclipse > 0.5 ? C.am : C.dim, 13);
  }

  private drawDOCK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const d = t.dock;
    if (!d) { this.txt(g, 'IDSS STANDBY · Sin objetivo en rango (<400 m)', 18, 86, C.dim, 15); return; }
    const cx = W / 2, cy = 40 + (H - 40) * 0.42, R = Math.min(W, H) * 0.28;
    g.strokeStyle = C.grid; g.strokeRect(cx - R, cy - R, R * 2, R * 2);
    g.strokeStyle = C.cy; g.lineWidth = 1; g.strokeRect(cx - R * 0.2, cy - R * 0.2, R * 0.4, R * 0.4);
    g.strokeStyle = C.dim;
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    const sc = R / 2;
    const x = cx + Math.max(-R, Math.min(R, d.lat * sc)), y = cy - Math.max(-R, Math.min(R, d.vert * sc));
    const ok = Math.abs(d.lat) < 0.15 && Math.abs(d.vert) < 0.15 && d.angle < 4;
    g.strokeStyle = ok ? C.gr : C.am; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.stroke();
    const yb = cy + R + 32;
    this.txt(g, `DIST ${d.range.toFixed(2)} m`, 16, yb, C.wh, 17, 600);
    this.txt(g, `CLOS ${d.closing.toFixed(3)} m/s`, W / 2, yb, d.closing > 0.3 ? C.rd : C.gr, 17, 600);
    this.txt(g, `ÁNG  ${d.angle.toFixed(1)}°`, 16, yb + 24, d.angle < 4 ? C.gr : C.am, 15);
    this.txt(g, d.capture ? 'CAPTURA DURA' : ok ? 'CORREDOR OK' : 'ALINEANDO', W / 2, yb + 24, d.capture ? C.gr : ok ? C.cy : C.am, 15, 600);
  }

  private drawSYS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems) {
    let y = 66;
    this.txt(g, `GENERACIÓN SOLAR   ${s.solarKW.toFixed(1)} kW`, 16, y, C.gr, 15, 600); this.bar(g, 16, y + 8, W - 32, 11, s.solarKW / 48, C.gr); y += 46;
    this.txt(g, `CARGA DE BUS 120V  ${s.loadKW.toFixed(1)} kW`, 16, y, C.am, 15, 600); this.bar(g, 16, y + 8, W - 32, 11, s.loadKW / 30, C.am); y += 46;
    this.txt(g, `BATERÍA Li-Ion     ${(s.soc * 100).toFixed(0)} %`, 16, y, s.soc > 0.25 ? C.wh : C.rd, 15, 600); this.bar(g, 16, y + 8, W - 32, 11, s.soc, s.soc > 0.25 ? C.cy : C.rd); y += 46;
    const buses: [string, boolean][] = [['BUS A', s.bus('A')], ['BUS B', s.bus('B')], ['NODO', s.bus('F')]];
    buses.forEach(([l, v], i) => {
      const bx = 16 + i * ((W - 32) / 3), bw = (W - 32) / 3 - 8;
      g.fillStyle = v ? '#164d2b' : '#4a1510'; g.fillRect(bx, y, bw, 28);
      g.strokeStyle = v ? C.gr : C.rd; g.lineWidth = 1.5; g.strokeRect(bx, y, bw, 28);
      this.txt(g, `${l} ${v ? 'ON' : 'OFF'}`, bx + 10, y + 19, v ? C.gr : C.rd, 14, 600);
    });
    y += 54;
    this.txt(g, `MMH/MON-3 ${s.biprop.toFixed(0)} kg   Xe ${s.xenon.toFixed(0)} kg`, 16, Math.min(H - 16, y), C.dim, 14);
  }

  private drawECLSS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems) {
    const rows: [string, string, number, string][] = [
      ['O₂ PARCIAL', `${s.o2.toFixed(1)} kPa`, (s.o2 - 18) / 5, s.o2 > 19.5 ? C.gr : C.rd],
      ['CO₂ CABINA', `${s.co2.toFixed(2)} kPa`, s.co2 / 0.7, s.co2 < 0.45 ? C.gr : s.co2 < 0.53 ? C.am : C.rd],
      ['T. CABINA', `${s.temp.toFixed(1)} °C`, (s.temp - 10) / 20, s.temp > 17 && s.temp < 27 ? C.gr : C.am],
      ['T. AVIÓNICA', `${s.avionicsTemp.toFixed(0)} °C`, (s.avionicsTemp - 15) / 40, s.avionicsTemp < 45 ? C.gr : C.am],
    ];
    rows.forEach(([k, v, f, c], i) => { const y = 68 + i * 50; this.txt(g, k, 16, y, C.dim, 14); this.txt(g, v, W - 148, y, c, 17, 600); this.bar(g, 16, y + 10, W - 32, 10, f, c); });
    const y = 68 + rows.length * 50 + 12;
    const an = s.anomalies.filter((a) => !a.fixed);
    if (an.length) { this.txt(g, '⚠ ' + an[0].label, 16, Math.min(H - 32, y), C.rd, 13, 600); this.txt(g, an[0].where, 16, Math.min(H - 12, y + 18), C.am, 12); }
    else this.txt(g, 'ECLSS NOMINAL · 101,3 kPa', 16, Math.min(H - 16, y), C.gr, 14, 600);
  }

  private drawCHECK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    this.txt(g, 'SECUENCIA DE ACTIVACIÓN', 16, 62, C.cy, 15, 600);
    t.checklist.forEach((c, i) => {
      const y = 94 + i * 26;
      if (y > H - 10) return;
      g.fillStyle = c.done ? C.gr : C.dim; g.fillRect(16, y - 12, 14, 14);
      this.txt(g, c.label, 38, y, c.done ? C.wh : C.dim, 14);
    });
  }

  private drawMISSION(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, s: Systems) {
    if (t.mission) {
      this.txt(g, t.mission.title, 16, 64, C.cy, 16, 600);
      this.wrap(g, t.mission.step, 16, 94, W - 32, 20, C.wh);
      this.txt(g, t.mission.progress, 16, H - 16, C.am, 14, 600);
    } else this.txt(g, 'Sin misión activa', 16, 64, C.dim, 16);
    s.alerts.slice(0, 3).forEach((a, i) => this.txt(g, a.text.slice(0, 42), 16, H - 72 + i * 18, a.level === 'alarm' ? C.rd : a.level === 'warn' ? C.am : C.dim, 12));
  }

  private drawARM(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const names = ['Hombro rodillo', 'Hombro cabeceo', 'Codo', 'Muñeca cabeceo', 'Muñeca guiñada', 'Muñeca rodillo'];
    t.arm.forEach((a, i) => { const y = 66 + i * 40; this.txt(g, names[i], 16, y, C.dim, 14); this.txt(g, `${(a * 57.3).toFixed(1)}°`, W - 110, y, C.cy, 16, 600); this.bar(g, 16, y + 8, W - 32, 8, (a + Math.PI) / (2 * Math.PI), C.cy); });
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

  placeCams(shipRoot: THREE.Object3D, armTip: THREE.Vector3) {
    this.noseCam.position.copy(b2t(13.3, 0, 0.4)).applyMatrix4(shipRoot.matrixWorld);
    this.noseCam.quaternion.copy(shipRoot.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)));
    this.armCam.position.copy(armTip).applyMatrix4(shipRoot.matrixWorld);
    this.armCam.quaternion.copy(this.noseCam.quaternion);
  }
}

export { SWITCH_LABEL };
