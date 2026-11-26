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
import type { Systems, SwitchId, SystemStatus } from './Systems';
import { SWITCH_ORDER, SWITCH_LABEL } from './Systems';
import { MASTER_CLOCK } from '../sim/Crew';
import { ACTIVE_MISSION_STATE } from '../Missions';
import { ARM_STATUS } from './Mechanisms';

export type Page = 'PFD' | 'NAV' | 'DOCK' | 'SYS' | 'ECLSS' | 'CAM' | 'CHECK' | 'MISSION' | 'ARM' | 'ARMCAM';
export const PAGE_LABEL: Record<Page, string> = {
  PFD: 'Actitud', NAV: 'Navegación', DOCK: 'Atraque', SYS: 'Energía', ECLSS: 'Soporte vital',
  CAM: 'Cámara de proa', CHECK: 'Lista de arranque', MISSION: 'Misión', ARM: 'Brazo robótico', ARMCAM: 'Cámara del brazo',
};

const PAGES: Record<string, Page[]> = {
  'scr:C1D1': ['PFD', 'NAV', 'DOCK'], 'scr:C1D2': ['SYS', 'ECLSS', 'CHECK'], 'scr:C1D3': ['NAV', 'CAM', 'DOCK'],
  'scr:C2D1': ['PFD', 'CAM'], 'scr:C2D2': ['CHECK', 'SYS', 'ECLSS'], 'scr:C2D3': ['MISSION', 'NAV', 'PFD'],
  'scr:AUXP': ['ECLSS', 'SYS'], 'scr:AUXS': ['NAV', 'MISSION'], 'scr:RWS1': ['ARMCAM', 'CAM'], 'scr:RWS2': ['ARM', 'MISSION'],
};

export interface Telemetry {
  vel: THREE.Vector3; w: THREE.Vector3; q: THREE.Quaternion; throttle: number; assist: boolean; rcsArmed: boolean; mainArmed: boolean;
  altKm: number; body: string; eclipse: number;
  orbit?: { vOrbKmS: number; periodMin: number; apogeeKm: number; perigeeKm: number; inclinationDeg: number };
  targets: { label: string; range: number; rate: number; bearing: THREE.Vector3 }[];
  dock: { range: number; closing: number; lat: number; vert: number; angle: number; capture: boolean } | null;
  mission: { title: string; step: string; progress: string; hint?: string; stepIndex?: number; totalSteps?: number; steps?: string[] } | null;
  arm: number[];
  checklist: { label: string; done: boolean }[];
  airlock?: string;
  clock?: { met: string; utc: string; metSeconds: number };
  armGrabbed?: string | null;
}

interface Screen {
  id: string; mesh: THREE.Mesh; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; pages: Page[]; page: number; w: number; h: number; lastDraw: number;
  center: THREE.Vector3;
  uOverlayOn: { value: number };
}

const C = {
  bg: '#04080e', panel: '#0a1522', grid: '#142638', cy: '#5ed0ff', am: '#ffb248',
  gr: '#58eb8c', wh: '#e4ecf4', rd: '#ff5644', dim: '#4b6880',
};

const POSE_LABEL: Record<string, string> = {
  estiba: 'ESTIBA', observacion: 'OBSERVACIÓN', captura: 'CAPTURA',
  servicio: 'SERVICIO', ik: 'AUTO IK', manual: 'MANUAL',
};

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
  private lastPowerState = '';
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
      const bb = mesh.geometry.boundingBox!;
      const sz = bb.getSize(new THREE.Vector3());
      const center = bb.getCenter(new THREE.Vector3());
      const dims = [sz.x, sz.y, sz.z].sort((a, b) => b - a);
      const aspect = dims[0] / Math.max(1e-3, dims[1]);
      const baseRes = 768;
      const canvas = document.createElement('canvas');
      canvas.width = baseRes;
      canvas.height = Math.round(baseRes / aspect);
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.flipY = false;
      const uOverlayOn = { value: 0 };
      // DoubleSide garantiza visibilidad en quads cuya normal haya quedado invertida al exportar glTF;
      // además soporta overlay transparente de retícula sobre CAM y ARMCAM sin draw calls extra.
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uOverlayTex = { value: tex };
        sh.uniforms.uOverlayOn = uOverlayOn;
        sh.fragmentShader = 'uniform sampler2D uOverlayTex;\nuniform float uOverlayOn;\n' + sh.fragmentShader;
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           #ifdef USE_MAP
             if (uOverlayOn > 0.5) {
               vec4 ov = texture2D(uOverlayTex, vMapUv);
               diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a);
             }
           #endif`
        );
      };
      mat.customProgramCacheKey = () => 'mfd-live-overlay';
      mesh.material = mat;
      mesh.castShadow = false;
      this.screens.push({ id: key, mesh, canvas, ctx, tex, mat, pages: PAGES[key], page: 0, w: canvas.width, h: canvas.height, lastDraw: -1, center, uOverlayOn });
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

  private clockStrings(tel: Telemetry) {
    return {
      met: tel.clock?.met ?? MASTER_CLOCK.metText(),
      utc: tel.clock?.utc ?? MASTER_CLOCK.utcText(false),
    };
  }

  draw(now: number, sys: Systems, tel: Telemetry, viewerLocal: THREE.Vector3 | null) {
    const on = sys.screensOn();
    const booting = sys.on('AVX') && !sys.booted;
    const powerState = `${sys.sw.BAT ? 1 : 0}:${on ? 1 : 0}:${booting ? 1 : 0}`;
    if (powerState !== this.lastPowerState) {
      this.lastPowerState = powerState;
      for (const s of this.screens) s.lastDraw = -1;
    }
    const dockClosing = tel.dock && !tel.dock.capture && tel.dock.range < 60 ? tel.dock.closing : undefined;
    const st = sys.status({ airlock: tel.airlock, dockClosing });
    const clk = this.clockStrings(tel);
    this.wantsCam = false; this.wantsArmCam = false;

    for (let idx = 0; idx < this.screens.length; idx++) {
      const s = this.screens[idx];
      const pg = s.pages[s.page];
      const posLocal = this.tmpP.copy(s.center).applyMatrix4(s.mesh.matrix);
      const d = viewerLocal ? viewerLocal.distanceTo(posLocal) : 99;
      const live = on && (pg === 'CAM' || pg === 'ARMCAM');
      if (live) {
        if (d < 12) { if (pg === 'CAM') this.wantsCam = true; else this.wantsArmCam = true; }
        const rt = pg === 'CAM' ? this.camRT : this.armRT;
        if (s.mat.map !== rt.texture) { s.mat.map = rt.texture; s.mat.needsUpdate = true; }
        s.uOverlayOn.value = 1;
        s.mat.color.setScalar(1.15);
        const period = d < 4 ? 0.16 : 0.6;
        if (s.lastDraw < 0 || now - s.lastDraw >= period) {
          s.lastDraw = now;
          const g = s.ctx;
          const sc = s.w / 512;
          const vW = 512, vH = s.h / sc;
          g.save();
          g.clearRect(0, 0, s.w, s.h);
          g.scale(sc, sc);
          if (pg === 'CAM') this.drawCamOverlay(g, vW, vH, tel, st, clk);
          else this.drawArmCamOverlay(g, vW, vH, tel, sys);
          g.restore();
          s.tex.needsUpdate = true;
        }
        continue;
      }
      s.uOverlayOn.value = 0;
      if (s.mat.map !== s.tex) { s.mat.map = s.tex; s.mat.needsUpdate = true; }
      const firstDraw = s.lastDraw < 0;
      const period = d < 4 ? 0.12 : d < 12 ? 0.5 : 2.0;
      if (!firstDraw && now - s.lastDraw < period) continue;
      // Tras el primer pintado inmediato, escalonamos ligeramente la fase para repartir carga entre fotogramas
      s.lastDraw = firstDraw ? now - (idx % 4) * 0.025 : now;
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
      this.statusBar(g, vW, st, clk);
      switch (pg) {
        case 'PFD': this.drawPFD(g, vW, vH, tel); break;
        case 'NAV': this.drawNAV(g, vW, vH, tel, clk); break;
        case 'DOCK': this.drawDOCK(g, vW, vH, tel); break;
        case 'SYS': this.drawSYS(g, vW, vH, sys, clk); break;
        case 'ECLSS': this.drawECLSS(g, vW, vH, sys, clk); break;
        case 'CHECK': this.drawCHECK(g, vW, vH, tel); break;
        case 'MISSION': this.drawMISSION(g, vW, vH, tel, sys, clk); break;
        case 'ARM': this.drawARM(g, vW, vH, tel, sys); break;
      }
      // Sutil marco de borde de cristal MFD
      g.strokeStyle = st.severity === 'crit' ? '#8c231a' : st.severity === 'warn' ? '#7a5116' : '#1b3550';
      g.lineWidth = 2; g.strokeRect(1, 1, vW - 2, vH - 2);
      g.restore();
      s.tex.needsUpdate = true;
    }
  }

  private header(g: CanvasRenderingContext2D, W: number, title: string, i: number, n: number) {
    g.fillStyle = C.panel; g.fillRect(0, 0, W, 34);
    g.fillStyle = '#e2572b'; g.fillRect(0, 0, 5, 34);
    g.fillStyle = C.cy; g.font = '600 16px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    g.fillText(`VLA · ${title.toUpperCase()}`, 14, 18);
    g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(`PG ${i + 1}/${n} ▸`, W - 12, 18); g.textAlign = 'left';
    g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 34); g.lineTo(W, 34); g.stroke();
  }

  /** Barra superior coherente de estado/alarma (Master Warning / Caution / Nominal + reloj maestro). */
  private statusBar(g: CanvasRenderingContext2D, W: number, st: SystemStatus, clk: { met: string; utc: string }) {
    const y0 = 34, bh = 22;
    const isCrit = st.severity === 'crit';
    const isWarn = st.severity === 'warn';
    g.fillStyle = isCrit ? '#3c0d0a' : isWarn ? '#332108' : '#071420';
    g.fillRect(0, y0, W, bh);
    const badgeColor = isCrit ? C.rd : isWarn ? C.am : C.gr;
    g.fillStyle = badgeColor;
    g.fillRect(8, y0 + 4, 58, 14);
    g.fillStyle = '#04080e';
    g.font = '700 10px "IBM Plex Mono", monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(isCrit ? 'WARN' : isWarn ? 'CAUT' : 'NOMINAL', 37, y0 + 11.5);
    g.textAlign = 'left';
    g.fillStyle = isCrit ? '#ffd0cb' : isWarn ? '#ffe0b2' : C.wh;
    g.font = '600 11px "IBM Plex Mono", monospace';
    const msg = st.active.length > 1 ? `${st.label} (+${st.active.length - 1})` : st.label;
    g.fillText(msg.slice(0, 34), 74, y0 + 11.5);
    g.fillStyle = C.cy;
    g.textAlign = 'right';
    g.font = '500 11px "IBM Plex Mono", monospace';
    g.fillText(`${clk.met} · ${clk.utc}`, W - 10, y0 + 11.5);
    g.textAlign = 'left';
    g.strokeStyle = isCrit ? C.rd : isWarn ? C.am : C.grid;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y0 + bh); g.lineTo(W, y0 + bh); g.stroke();
  }

  private txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, c = C.wh, size = 16, w = 500) {
    g.fillStyle = c; g.font = `${w} ${size}px "IBM Plex Mono", monospace`; g.textBaseline = 'alphabetic'; g.fillText(s, x, y);
  }
  private bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, c: string) {
    g.fillStyle = '#08111b'; g.fillRect(x, y, w, h);
    g.strokeStyle = C.dim; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    g.fillStyle = c; g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, Math.max(0, v))), h - 2);
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
    const topY = 58;
    const e = new THREE.Euler().setFromQuaternion(t.q, 'YXZ');
    const cx = W / 2, cy = topY + (H - topY) * 0.42, R = Math.min(W, H - topY) * 0.30;
    // Cintas laterales compactas de velocidad relativa y altitud orbital
    g.fillStyle = '#07111c';
    g.fillRect(12, cy - R, 74, R * 2);
    g.fillRect(W - 86, cy - R, 74, R * 2);
    g.strokeStyle = C.grid; g.lineWidth = 1;
    g.strokeRect(12, cy - R, 74, R * 2);
    g.strokeRect(W - 86, cy - R, 74, R * 2);
    this.txt(g, 'VREL', 20, cy - R + 16, C.dim, 11, 600);
    this.txt(g, `${t.vel.length().toFixed(1)}`, 18, cy + 5, C.gr, 18, 600);
    this.txt(g, 'm/s', 20, cy + 22, C.dim, 11);
    this.txt(g, 'ALT', W - 78, cy - R + 16, C.dim, 11, 600);
    this.txt(g, `${t.altKm.toFixed(0)}`, W - 80, cy + 5, C.cy, 18, 600);
    this.txt(g, 'km', W - 78, cy + 22, C.dim, 11);

    // Horizonte artificial con degradado atmosférico y escala de cabeceo numerada
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.translate(cx, cy); g.rotate(-e.z);
    const off = (e.x / (Math.PI / 2)) * R;
    const sky = g.createLinearGradient(0, -R, 0, off);
    sky.addColorStop(0, '#07182e'); sky.addColorStop(1, '#1d538c');
    g.fillStyle = sky; g.fillRect(-R * 2, -R * 2 + off, R * 4, R * 2);
    const grd = g.createLinearGradient(0, off, 0, R);
    grd.addColorStop(0, '#5c3b1e'); grd.addColorStop(1, '#221409');
    g.fillStyle = grd; g.fillRect(-R * 2, off, R * 4, R * 2);
    g.strokeStyle = C.wh; g.lineWidth = 2; g.beginPath(); g.moveTo(-R * 2, off); g.lineTo(R * 2, off); g.stroke();
    g.lineWidth = 1.4;
    g.font = '600 10px "IBM Plex Mono", monospace';
    g.fillStyle = C.wh;
    for (let deg = -30; deg <= 30; deg += 10) {
      if (deg === 0) continue;
      const y = off - (deg / 90) * R;
      const hw = deg % 20 === 0 ? R * 0.34 : R * 0.18;
      g.beginPath(); g.moveTo(-hw, y); g.lineTo(hw, y); g.stroke();
      if (deg % 20 === 0) {
        g.textAlign = 'right'; g.fillText(`${Math.abs(deg)}`, -hw - 4, y + 3);
        g.textAlign = 'left'; g.fillText(`${Math.abs(deg)}`, hw + 4, y + 3);
      }
    }
    g.fillStyle = C.cy; g.beginPath(); g.moveTo(0, -R + 3); g.lineTo(-5, -R + 12); g.lineTo(5, -R + 12); g.closePath(); g.fill();
    g.restore();

    g.strokeStyle = C.cy; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    for (const a of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
      const rad = ((a - 90) * Math.PI) / 180;
      const r0 = R + 2, r1 = R + (a % 30 === 0 ? 10 : 6);
      g.beginPath(); g.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0); g.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1); g.stroke();
    }
    g.strokeStyle = C.am; g.lineWidth = 3.5; g.beginPath();
    g.moveTo(cx - R * 0.45, cy); g.lineTo(cx - R * 0.14, cy); g.lineTo(cx - R * 0.14, cy + 8);
    g.moveTo(cx + R * 0.45, cy); g.lineTo(cx + R * 0.14, cy); g.lineTo(cx + R * 0.14, cy + 8);
    g.stroke();
    g.fillStyle = C.am; g.fillRect(cx - 2.5, cy - 2.5, 5, 5);

    const yb = Math.min(H - 52, cy + R + 24);
    const v = t.vel.length();
    this.txt(g, `Vrel ${v.toFixed(2)} m/s`, 16, yb, C.gr, 15, 600);
    if (t.orbit) this.txt(g, `Vorb ${t.orbit.vOrbKmS.toFixed(2)} km/s`, 16, yb + 20, C.cy, 13);
    else this.txt(g, `ω ${(t.w.length() * 57.3).toFixed(2)} °/s`, 16, yb + 20, C.wh, 13);
    this.txt(g, `EMP ${(t.throttle * 100).toFixed(0)} %`, W / 2 + 12, yb, t.throttle > 0 ? C.am : C.dim, 15, 600);
    this.txt(g, t.assist ? 'GNC ASISTIDO' : 'GNC MANUAL', W / 2 + 12, yb + 20, t.assist ? C.cy : C.am, 13);
    this.txt(g, `RCS ${t.rcsArmed ? 'ARM' : 'SAFE'} · MOT ${t.mainArmed ? 'ARM' : 'SAFE'} · ω ${(t.w.length() * 57.3).toFixed(1)}°/s`, 16, yb + 40, t.rcsArmed ? C.gr : C.rd, 12);
  }

  private drawNAV(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, clk: { met: string; utc: string }) {
    const topY = 58;
    const cx = W / 2, cy = topY + (H - topY - 56) * 0.48, R = Math.min(W * 0.34, (H - topY - 82) * 0.44);
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.fillStyle = C.dim; g.font = '600 10px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillText('000°', cx, cy - R - 5);
    g.fillText('180°', cx, cy + R + 12);
    g.textAlign = 'left'; g.fillText('090°', cx + R + 5, cy + 3);
    g.textAlign = 'right'; g.fillText('270°', cx - R - 5, cy + 3);
    g.textAlign = 'left';
    g.fillStyle = C.am; g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx - 7, cy + 8); g.lineTo(cx + 7, cy + 8); g.closePath(); g.fill();
    const maxR = Math.max(200, ...t.targets.map((x) => x.range)) * 1.1;
    this.txt(g, `RNG ${maxR < 1000 ? maxR.toFixed(0) + 'm' : (maxR / 1000).toFixed(1) + 'km'}`, 14, topY + 16, C.dim, 12);
    this.txt(g, t.eclipse > 0.5 ? 'ECLIPSE' : 'SOLAR', W - 78, topY + 16, t.eclipse > 0.5 ? C.am : C.gr, 12, 600);
    for (const tg of t.targets) {
      const b = tg.bearing;
      const k = Math.min(1, tg.range / maxR) * R;
      const x = cx + b.z * k, y = cy - b.x * k;
      g.strokeStyle = C.gr; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = C.gr; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
      this.txt(g, `${tg.label} ${tg.range < 1000 ? tg.range.toFixed(0) + 'm' : (tg.range / 1000).toFixed(2) + 'km'}`, x + 9, y + 4, C.wh, 11);
    }
    const o = t.orbit;
    g.fillStyle = '#07111c'; g.fillRect(10, H - 56, W - 20, 48);
    g.strokeStyle = C.grid; g.strokeRect(10, H - 56, W - 20, 48);
    this.txt(g, `${t.body.toUpperCase()} · ALT ${t.altKm.toFixed(0)} km${o ? ` · INC ${o.inclinationDeg.toFixed(1)}°` : ''}`, 18, H - 36, C.cy, 13, 600);
    this.txt(g, `${clk.met}`, W - 134, H - 36, C.wh, 12, 600);
    if (o) this.txt(g, `APO ${o.apogeeKm.toFixed(0)} km · PER ${o.perigeeKm.toFixed(0)} km · T ${o.periodMin.toFixed(1)} min`, 18, H - 17, C.wh, 12);
    else this.txt(g, t.eclipse > 0.5 ? 'EN SOMBRA ORBITAL' : 'ILUMINADO POR SOL', 18, H - 17, t.eclipse > 0.5 ? C.am : C.dim, 12);
  }

  private drawDOCK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    const topY = 58;
    const d = t.dock;
    if (!d) {
      this.txt(g, 'IDSS STANDBY · Sin objetivo en rango (< 400 m)', 18, topY + 34, C.dim, 14);
      this.txt(g, 'Activa DOCK (estribor) y acércate a Estación Tesela.', 18, topY + 58, C.dim, 12);
      return;
    }
    const R = Math.min(W * 0.25, (H - topY - 88) * 0.44);
    const cx = W * 0.41, cy = topY + R + 16;

    // Marco del visor de atraque COAS/IDSS
    g.fillStyle = '#060e18'; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.strokeStyle = C.grid; g.lineWidth = 1.2; g.strokeRect(cx - R, cy - R, R * 2, R * 2);
    // Zonas de tolerancia concéntricas (±0,6 m cian, ±0,15 m verde)
    const rOuter = R * 0.50;
    const rInner = R * 0.18;
    g.strokeStyle = '#1d4d6b'; g.lineWidth = 1; g.strokeRect(cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
    g.strokeStyle = C.gr; g.lineWidth = 1.4; g.strokeRect(cx - rInner, cy - rInner, rInner * 2, rInner * 2);
    // Retícula fija con graduaciones
    g.strokeStyle = C.dim; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    for (const f of [-0.5, 0.5]) {
      g.beginPath();
      g.moveTo(cx + R * f, cy - 5); g.lineTo(cx + R * f, cy + 5);
      g.moveTo(cx - 5, cy + R * f); g.lineTo(cx + 5, cy + R * f);
      g.stroke();
    }

    // Posición relativa (lat, vert) y vector de corrección
    const sc = R / 1.5;
    const dx = Math.max(-R + 6, Math.min(R - 6, d.lat * sc));
    const dy = Math.max(-R + 6, Math.min(R - 6, -d.vert * sc));
    const px = cx + dx, py = cy + dy;
    const angOk = d.angle < 6;
    const velOk = d.closing >= -0.05 && d.closing < 0.25;
    const posOk = Math.abs(d.lat) < 0.35 && Math.abs(d.vert) < 0.35;
    const distOk = d.range < 8;
    const readyCapture = !d.capture && distOk && angOk && velOk && posOk;
    const velCrit = d.closing > 0.40;
    const velWarn = d.closing > 0.25 && !velCrit;

    // Vector guía hacia el centro
    g.strokeStyle = posOk ? C.gr : C.am; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(px, py); g.stroke();
    g.setLineDash([]);
    // Cruz móvil de la nave
    const markerCol = posOk && angOk ? C.gr : velCrit ? C.rd : C.am;
    g.strokeStyle = markerCol; g.lineWidth = 2.6;
    g.beginPath(); g.arc(px, py, 11, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(px - 16, py); g.lineTo(px + 16, py); g.moveTo(px, py - 16); g.lineTo(px, py + 16); g.stroke();
    this.txt(g, `LAT ${d.lat >= 0 ? '+' : ''}${d.lat.toFixed(2)}m`, cx - R, cy + R + 14, Math.abs(d.lat) < 0.35 ? C.gr : C.am, 11);
    this.txt(g, `VRT ${d.vert >= 0 ? '+' : ''}${d.vert.toFixed(2)}m`, cx + 4, cy + R + 14, Math.abs(d.vert) < 0.35 ? C.gr : C.am, 11);

    // Corredor vertical de velocidad de cierre (derecha del visor)
    const gx = cx + R + 22, gy = cy - R, gw = 26, gh = R * 2;
    const maxV = 0.60; // m/s escala superior
    const y025 = gy + gh * (1 - 0.25 / maxV);
    const y040 = gy + gh * (1 - 0.40 / maxV);
    g.fillStyle = '#0e351e'; g.fillRect(gx, y025, gw, gy + gh - y025); // < 0.25 verde
    g.fillStyle = '#3d2a0b'; g.fillRect(gx, y040, gw, y025 - y040);      // 0.25..0.40 ámbar
    g.fillStyle = '#42120d'; g.fillRect(gx, gy, gw, y040 - gy);          // > 0.40 rojo
    g.strokeStyle = C.grid; g.lineWidth = 1; g.strokeRect(gx, gy, gw, gh);
    // Líneas de umbral
    g.strokeStyle = C.gr; g.beginPath(); g.moveTo(gx - 3, y025); g.lineTo(gx + gw + 3, y025); g.stroke();
    g.strokeStyle = C.rd; g.beginPath(); g.moveTo(gx - 3, y040); g.lineTo(gx + gw + 3, y040); g.stroke();
    // Puntero actual de velocidad de cierre
    const clampedV = Math.max(0, Math.min(maxV, d.closing));
    const vy = gy + gh * (1 - clampedV / maxV);
    const velCol = velCrit ? C.rd : velWarn ? C.am : C.gr;
    g.fillStyle = velCol;
    g.beginPath(); g.moveTo(gx - 2, vy); g.lineTo(gx - 10, vy - 5); g.lineTo(gx - 10, vy + 5); g.closePath(); g.fill();
    g.fillRect(gx, vy - 1.5, gw, 3);
    this.txt(g, 'CIERRE', gx - 4, gy - 4, C.dim, 10, 600);
    this.txt(g, '0.40', gx + gw + 5, y040 + 4, C.rd, 10);
    this.txt(g, '0.25', gx + gw + 5, y025 + 4, C.gr, 10);
    this.txt(g, `${d.closing.toFixed(2)}`, gx + gw + 5, vy + 4, velCol, 12, 600);

    // Panel derecho de estado de las 3 condiciones IDSS
    const rx = gx + gw + 46;
    if (rx + 90 < W) {
      this.txt(g, 'COND. IDSS', rx, gy + 14, C.cy, 11, 600);
      const conds: [string, boolean, string][] = [
        ['DIST', d.range < 0.6, `${d.range.toFixed(2)}m`],
        ['VEL ', velOk, `${d.closing.toFixed(2)}m/s`],
        ['ÁNG ', angOk, `${d.angle.toFixed(1)}°`],
      ];
      conds.forEach(([k, ok, val], i) => {
        const yy = gy + 36 + i * 28;
        g.fillStyle = ok ? C.gr : C.am;
        g.fillRect(rx, yy - 9, 8, 8);
        this.txt(g, k, rx + 12, yy - 1, C.dim, 10, 600);
        this.txt(g, val, rx + 12, yy + 11, ok ? C.gr : C.wh, 12, 600);
      });
    }

    // Lectura inferior y banner de estado CAPTURA LISTA / CAPTURA DURA / FRENAR
    const yb = Math.min(H - 42, cy + R + 34);
    this.txt(g, `DIST ${d.range.toFixed(2)} m`, 16, yb, C.wh, 15, 600);
    this.txt(g, `ÁNG ${d.angle.toFixed(1)}°`, 168, yb, angOk ? C.gr : d.angle > 12 ? C.rd : C.am, 15, 600);
    this.txt(g, `VEL ${d.closing.toFixed(3)} m/s`, 292, yb, velCol, 15, 600);

    const bannerY = Math.min(H - 26, yb + 8);
    const bBg = d.capture ? '#103b22' : readyCapture ? '#0e3f28' : velCrit ? '#4a120d' : '#122234';
    const bBd = d.capture ? C.gr : readyCapture ? C.gr : velCrit ? C.rd : C.cy;
    const bTxt = d.capture
      ? 'CAPTURA DURA · ATRACADO EN TESELA'
      : velCrit
        ? '⚠ FRENAR · VELOCIDAD DE CIERRE EXCESIVA (> 0,40 m/s)'
        : readyCapture
          ? '✓ CAPTURA LISTA · CORREDOR IDSS VALIDADO'
          : 'ALINEANDO CON DIANA COAS 3D (OBJ: < 6° · < 0,25 m/s)';
    g.fillStyle = bBg; g.fillRect(14, bannerY, W - 28, 22);
    g.strokeStyle = bBd; g.lineWidth = 1.4; g.strokeRect(14, bannerY, W - 28, 22);
    g.fillStyle = bBd; g.font = '700 12px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(bTxt, W / 2, bannerY + 11.5);
    g.textAlign = 'left';
  }

  private drawSYS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems, clk: { met: string; utc: string }) {
    const netKW = s.solarKW - s.loadKW;
    const busV = s.sw.BAT ? (118.2 + s.soc * 3.4) : 0;
    // Resumen superior de barra 120 V y balance neto
    g.fillStyle = '#07111c'; g.fillRect(16, 62, W - 32, 24);
    g.strokeStyle = C.grid; g.strokeRect(16, 62, W - 32, 24);
    this.txt(g, `BUS ${busV.toFixed(1)} V CC`, 24, 79, C.cy, 12, 600);
    this.txt(g, `NETO ${netKW >= 0 ? '+' : ''}${netKW.toFixed(1)} kW`, 178, 79, netKW >= 0 ? C.gr : C.am, 12, 600);
    this.txt(g, clk.utc, W - 92, 79, C.dim, 11, 600);

    let y = 104;
    this.txt(g, 'GENERACIÓN SOLAR', 16, y, C.dim, 12, 600);
    this.txt(g, `${s.solarKW.toFixed(1)} kW`, W - 96, y, C.gr, 15, 600);
    this.bar(g, 16, y + 6, W - 32, 10, s.solarKW / 48, C.gr); y += 36;

    this.txt(g, 'CARGA DE BUS 120 V', 16, y, C.dim, 12, 600);
    this.txt(g, `${s.loadKW.toFixed(1)} kW`, W - 96, y, C.am, 15, 600);
    this.bar(g, 16, y + 6, W - 32, 10, s.loadKW / 30, C.am); y += 36;

    this.txt(g, 'BATERÍA Li-Ion (24 kWh)', 16, y, C.dim, 12, 600);
    this.txt(g, `${(s.soc * 100).toFixed(0)} %`, W - 74, y, s.soc > 0.20 ? C.wh : s.soc > 0.12 ? C.am : C.rd, 15, 600);
    this.bar(g, 16, y + 6, W - 32, 10, s.soc, s.soc > 0.20 ? C.cy : s.soc > 0.12 ? C.am : C.rd); y += 34;

    const buses: [string, boolean][] = [['BUS A', s.bus('A')], ['BUS B', s.bus('B')], ['NODO', s.bus('F')]];
    buses.forEach(([l, v], i) => {
      const bx = 16 + i * ((W - 32) / 3), bw = (W - 32) / 3 - 8;
      g.fillStyle = v ? '#103b22' : '#421410'; g.fillRect(bx, y, bw, 26);
      g.strokeStyle = v ? C.gr : C.rd; g.lineWidth = 1.5; g.strokeRect(bx, y, bw, 26);
      g.fillStyle = v ? C.gr : C.rd; g.beginPath(); g.arc(bx + 12, y + 13, 4, 0, Math.PI * 2); g.fill();
      this.txt(g, `${l} ${v ? 'ON' : 'OFF'}`, bx + 22, y + 18, v ? C.gr : C.rd, 12, 600);
    });
    y += 42;
    const halfW = (W - 44) / 2;
    this.txt(g, `MMH/MON ${s.biprop.toFixed(0)} kg`, 16, Math.min(H - 20, y), C.wh, 12);
    this.bar(g, 16, Math.min(H - 13, y + 5), halfW, 7, s.biprop / 2400, C.am);
    this.txt(g, `XENÓN ${s.xenon.toFixed(0)} kg`, 28 + halfW, Math.min(H - 20, y), C.wh, 12);
    this.bar(g, 28 + halfW, Math.min(H - 13, y + 5), halfW, 7, s.xenon / 2600, C.cy);
  }

  private drawECLSS(g: CanvasRenderingContext2D, W: number, H: number, s: Systems, clk: { met: string; utc: string }) {
    const rows: [string, string, number, string][] = [
      ['O₂ PARCIAL', `${s.o2.toFixed(1)} kPa`, (s.o2 - 18) / 5, s.o2 > 19.5 ? C.gr : C.rd],
      ['CO₂ CABINA', `${s.co2.toFixed(2)} kPa`, s.co2 / 0.7, s.co2 < 0.45 ? C.gr : s.co2 < 0.53 ? C.am : C.rd],
      ['T. CABINA', `${s.temp.toFixed(1)} °C`, (s.temp - 10) / 20, s.temp > 17 && s.temp < 27 ? C.gr : C.am],
      ['T. AVIÓNICA', `${s.avionicsTemp.toFixed(0)} °C`, (s.avionicsTemp - 15) / 40, s.avionicsTemp < 45 ? C.gr : C.am],
    ];
    rows.forEach(([k, v, f, c], i) => {
      const y = 76 + i * 44;
      this.txt(g, k, 16, y, C.dim, 13);
      this.txt(g, v, W - 144, y, c, 16, 600);
      this.bar(g, 16, y + 8, W - 32, 9, f, c);
    });
    const y = 76 + rows.length * 44 + 8;
    const an = s.anomalies.filter((a) => !a.fixed);
    if (an.length) {
      this.txt(g, '⚠ ' + an[0].label, 16, Math.min(H - 30, y), C.rd, 12, 600);
      this.txt(g, an[0].where.slice(0, 56), 16, Math.min(H - 12, y + 16), C.am, 11);
    } else {
      this.txt(g, `ECLSS NOMINAL · 101,3 kPa · ${clk.met}`, 16, Math.min(H - 14, y + 4), C.gr, 13, 600);
    }
  }

  private drawCHECK(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry) {
    this.txt(g, 'SECUENCIA DE ACTIVACIÓN (CONSOLAS LATERALES)', 16, 76, C.cy, 13, 600);
    t.checklist.forEach((c, i) => {
      const y = 102 + i * 24;
      if (y > H - 10) return;
      g.fillStyle = c.done ? C.gr : C.dim; g.fillRect(16, y - 11, 13, 13);
      this.txt(g, c.label, 38, y, c.done ? C.wh : C.dim, 13);
    });
  }

  private drawMISSION(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, s: Systems, clk: { met: string; utc: string }) {
    const shared = ACTIVE_MISSION_STATE;
    const m = t.mission;
    if (m) {
      const stepIdx = m.stepIndex ?? shared?.stepIndex ?? 0;
      const total = m.totalSteps ?? shared?.totalSteps ?? 1;
      const hint = m.hint ?? shared?.hint ?? '';
      const steps = m.steps ?? shared?.steps ?? [];

      this.txt(g, m.title.toUpperCase(), 16, 76, C.cy, 15, 600);
      this.txt(g, m.progress, W - 128, 76, C.am, 12, 600);
      // Barra de progreso de la misión
      this.bar(g, 16, 84, W - 32, 9, (stepIdx + 1) / Math.max(1, total), C.gr);

      // Paso actual
      let y = 112;
      this.txt(g, 'OBJETIVO ACTUAL:', 16, y, C.dim, 11, 600); y += 16;
      y = this.wrap(g, m.step, 16, y, W - 32, 16, C.wh, 13);

      // Caja destacada con pista (hint)
      if (hint) {
        const boxY = y + 4;
        g.fillStyle = '#081828'; g.fillRect(14, boxY, W - 28, 46);
        g.strokeStyle = '#245275'; g.lineWidth = 1; g.strokeRect(14, boxY, W - 28, 46);
        this.txt(g, 'GUÍA:', 22, boxY + 14, C.cy, 10, 700);
        this.wrap(g, hint.slice(0, 120), 62, boxY + 14, W - 82, 14, '#b8d4ea', 11);
        y = boxY + 54;
      }

      // Lista compacta de objetivos/pasos (reservando espacio para alertas inferiores)
      const alertCount = Math.min(2, s.alerts.length);
      const bottomReserve = alertCount > 0 ? 12 + alertCount * 15 : 10;
      const maxRows = Math.max(0, Math.floor((H - y - bottomReserve) / 16));
      const start = Math.max(0, Math.min(stepIdx, Math.max(0, steps.length - maxRows)));
      for (let i = start; i < Math.min(steps.length, start + maxRows); i++) {
        const done = i < stepIdx;
        const cur = i === stepIdx;
        const mark = done ? '✓' : cur ? '▸' : '·';
        const col = done ? C.gr : cur ? C.am : C.dim;
        this.txt(g, `${mark} ${steps[i].slice(0, 50)}`, 18, y + 12, col, 11, cur ? 600 : 500);
        y += 16;
      }
    } else {
      this.txt(g, 'SIN MISIÓN ACTIVA', 16, 80, C.dim, 15, 600);
      this.txt(g, `RELOJ DE A BORDO · ${clk.met} · ${clk.utc}`, 16, 104, C.cy, 12);
      this.txt(g, 'Abre el modo Misiones (Alt+6) para seleccionar una operación.', 16, 128, C.dim, 12);
    }
    const al = s.alerts.slice(0, 2);
    al.forEach((a, i) => {
      const ay = H - 8 - (al.length - 1 - i) * 15;
      if (ay > 140) this.txt(g, a.text.slice(0, 52), 16, ay, a.level === 'alarm' ? C.rd : a.level === 'warn' ? C.am : C.dim, 11);
    });
  }

  private drawARM(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, s: Systems) {
    const grabbed = t.armGrabbed ?? ARM_STATUS.grabbed;
    const pose = POSE_LABEL[ARM_STATUS.pose] ?? 'MANUAL';
    const powered = s.on('RBT');
    const canister = t.targets.find((tg) => /cápsula|canister/i.test(tg.label));

    // Panel superior izquierdo: diagrama esquemático lateral 2D del brazo en tiempo real
    const dx = 14, dy = 64, dw = 230, dh = Math.min(136, H - 150);
    g.fillStyle = '#07111c'; g.fillRect(dx, dy, dw, dh);
    g.strokeStyle = C.grid; g.strokeRect(dx, dy, dw, dh);
    this.txt(g, 'ESQUEMA LATERAL (B1/B2/EE)', dx + 8, dy + 14, C.dim, 10, 600);

    // Casco dorsal curvo
    const bx = dx + 68, by = dy + dh - 18;
    g.strokeStyle = '#2d4b66'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(dx + 10, by + 6); g.lineTo(dx + dw - 10, by + 6); g.stroke();
    g.fillStyle = '#14293d'; g.fillRect(dx + 12, by + 6, dw - 24, 10);

    // Cinemática planar aproximada a partir de J2 (hombro), J4 (codo) y J5 (muñeca)
    const j2 = t.arm[1] ?? 0;
    const j4 = t.arm[2] ?? 0;
    const j5 = t.arm[3] ?? 0;
    const L1 = Math.min(68, dh * 0.52);
    const L2 = L1 * 0.85;
    const L3 = 22;
    const a1 = -j2; // 0 = horizontal proa, negativo levanta hacia arriba
    const a2 = a1 - j4;
    const a3 = a2 - j5;
    const x1 = bx + Math.cos(a1) * L1, y1 = by - Math.sin(a1) * L1;
    const x2 = x1 + Math.cos(a2) * L2, y2 = y1 - Math.sin(a2) * L2;
    const x3 = x2 + Math.cos(a3) * L3, y3 = y2 - Math.sin(a3) * L3;

    // Eslabones
    g.strokeStyle = powered ? C.cy : C.dim; g.lineWidth = 4;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = grabbed ? C.gr : C.am; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x2, y2); g.lineTo(x3, y3); g.stroke();
    // Articulaciones
    for (const [jx, jy] of [[bx, by], [x1, y1], [x2, y2]]) {
      g.fillStyle = C.wh; g.beginPath(); g.arc(jx, jy, 3.5, 0, Math.PI * 2); g.fill();
    }
    // Efector terminal
    g.strokeStyle = grabbed ? C.gr : C.cy; g.lineWidth = 2;
    g.beginPath(); g.arc(x3, y3, 5.5, 0, Math.PI * 2); g.stroke();
    this.txt(g, 'BASE', bx - 12, by + 14, C.dim, 9);

    // Panel superior derecho: estado operativo del efector y objetivo
    const sx = dx + dw + 12, sw = W - sx - 14;
    g.fillStyle = '#07111c'; g.fillRect(sx, dy, sw, dh);
    g.strokeStyle = C.grid; g.strokeRect(sx, dy, sw, dh);
    this.txt(g, 'ESTADO DEL BRAZO', sx + 10, dy + 16, C.cy, 11, 600);
    this.txt(g, `BUS RBT: ${powered ? 'ACTIVO' : 'APAGADO'}`, sx + 10, dy + 34, powered ? C.gr : C.rd, 12, 600);
    this.txt(g, `POSTURA: ${pose}`, sx + 10, dy + 52, C.wh, 12);
    this.txt(g, `EFECTOR: ${grabbed ? 'CAPTURADO' : 'LIBRE'}`, sx + 10, dy + 72, grabbed ? C.gr : C.cy, 13, 700);
    if (canister) {
      const inRange = canister.range < 9;
      this.txt(g, `OBJETIVO: ${canister.range.toFixed(1)} m`, sx + 10, dy + 94, inRange ? C.gr : C.am, 12, 600);
      this.txt(g, inRange ? 'EN ALCANCE (< 9 m)' : 'ACERCAR (< 9 m)', sx + 10, dy + 110, inRange ? C.gr : C.dim, 10);
    } else {
      this.txt(g, 'OBJETIVO: NINGUNO', sx + 10, dy + 94, C.dim, 12);
    }
    if (ARM_STATUS.busy) this.txt(g, 'MOVIENDO ARTICULACIONES…', sx + 10, dy + dh - 8, C.am, 10, 600);

    // Tabla compacta de las 6 articulaciones en dos columnas
    const names = ['J1 Hombro rod.', 'J2 Hombro cab.', 'J4 Codo', 'J5 Muñeca cab.', 'J6 Muñeca guiñ.', 'J7 Muñeca rod.'];
    const baseY = dy + dh + 18;
    const colW = (W - 40) / 2;
    t.arm.forEach((a, i) => {
      const col = i < 3 ? 0 : 1;
      const row = i % 3;
      const xx = 16 + col * (colW + 8);
      const yy = baseY + row * 24;
      if (yy > H - 8) return;
      this.txt(g, names[i], xx, yy, C.dim, 11);
      this.txt(g, `${(a * 57.3).toFixed(1)}°`, xx + colW - 52, yy, C.cy, 12, 600);
      this.bar(g, xx, yy + 4, colW, 6, (a + Math.PI) / (2 * Math.PI), powered ? C.cy : C.dim);
    });
  }

  /** Overlay HUD sobre la cámara en vivo de proa (`CAM`) con retícula de atraque COAS/IDSS. */
  private drawCamOverlay(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, st: SystemStatus, clk: { met: string; utc: string }) {
    const cx = W / 2, cy = H / 2;
    // Esquinas de encuadre
    g.strokeStyle = 'rgba(94, 208, 255, 0.78)'; g.lineWidth = 2;
    const m = 14, cl = 18;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      g.beginPath(); g.moveTo(x, y + sy * cl); g.lineTo(x, y); g.lineTo(x + sx * cl, y); g.stroke();
    }
    // Etiqueta superior y estado
    g.fillStyle = 'rgba(4, 10, 18, 0.65)'; g.fillRect(16, 12, 168, 20); g.fillRect(W - 178, 12, 162, 20);
    this.txt(g, 'CAM PROA · IDSS LIVE', 22, 26, C.cy, 11, 600);
    this.txt(g, `${clk.met}`, W - 170, 26, C.wh, 11, 600);

    // Retícula central COAS
    g.strokeStyle = 'rgba(228, 236, 244, 0.75)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    g.moveTo(cx - 56, cy); g.lineTo(cx - 12, cy); g.moveTo(cx + 12, cy); g.lineTo(cx + 56, cy);
    g.moveTo(cx, cy - 56); g.lineTo(cx, cy - 12); g.moveTo(cx, cy + 12); g.lineTo(cx, cy + 56);
    g.stroke();

    const d = t.dock;
    if (d) {
      const ok = !d.capture && d.range < 8 && d.angle < 6 && d.closing >= -0.05 && d.closing < 0.25;
      const velCol = d.closing > 0.40 ? C.rd : d.closing > 0.25 ? C.am : C.gr;
      const ox = cx + Math.max(-60, Math.min(60, d.lat * 32));
      const oy = cy + Math.max(-45, Math.min(45, -d.vert * 32));
      g.strokeStyle = ok || d.capture ? C.gr : C.am; g.lineWidth = 2;
      g.beginPath(); g.arc(ox, oy, 9, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(4, 10, 18, 0.74)'; g.fillRect(14, H - 36, W - 28, 24);
      this.txt(g, `DIST ${d.range.toFixed(2)}m`, 22, H - 20, C.wh, 12, 600);
      this.txt(g, `CIERRE ${d.closing.toFixed(2)}m/s`, 144, H - 20, velCol, 12, 600);
      this.txt(g, `ÁNG ${d.angle.toFixed(1)}°`, 284, H - 20, d.angle < 6 ? C.gr : C.am, 12, 600);
      const tag = d.capture ? 'ATRACADO' : ok ? 'CAPTURA LISTA' : st.severity === 'crit' ? 'WARN' : 'ALINEANDO';
      this.txt(g, tag, W - 124, H - 20, d.capture || ok ? C.gr : st.severity === 'crit' ? C.rd : C.am, 11, 700);
    }
  }

  /** Overlay HUD sobre la cámara en vivo del efector del brazo (`ARMCAM`). */
  private drawArmCamOverlay(g: CanvasRenderingContext2D, W: number, H: number, t: Telemetry, s: Systems) {
    const cx = W / 2, cy = H / 2;
    const grabbed = t.armGrabbed ?? ARM_STATUS.grabbed;
    const canister = t.targets.find((tg) => /cápsula|canister/i.test(tg.label));

    // Retícula de pinza / captura de efector
    g.strokeStyle = grabbed ? 'rgba(88, 235, 140, 0.88)' : 'rgba(94, 208, 255, 0.82)';
    g.lineWidth = 1.8;
    g.beginPath(); g.arc(cx, cy, 44, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
      g.lineTo(cx + Math.cos(a) * 58, cy + Math.sin(a) * 58);
      g.stroke();
    }
    // Cabecera y estado inferior semitransparentes
    g.fillStyle = 'rgba(4, 10, 18, 0.70)'; g.fillRect(14, 12, W - 28, 22);
    this.txt(g, `EE-CAM · ${s.on('RBT') ? 'ACTIVA' : 'SIN POTENCIA'}`, 22, 27, s.on('RBT') ? C.cy : C.rd, 11, 600);
    this.txt(g, `EFECTOR: ${grabbed ? 'CAPTURADO' : 'LIBRE'}`, W - 166, 27, grabbed ? C.gr : C.wh, 11, 700);

    g.fillStyle = 'rgba(4, 10, 18, 0.72)'; g.fillRect(14, H - 34, W - 28, 22);
    const pose = POSE_LABEL[ARM_STATUS.pose] ?? 'MANUAL';
    this.txt(g, `POSTURA ${pose}`, 22, H - 19, C.wh, 11, 600);
    if (canister) {
      const inRange = canister.range < 9;
      this.txt(g, `CÁPSULA ${canister.range.toFixed(2)} m · ${inRange ? 'EN RANGO' : 'FUERA RANGO'}`, W - 240, H - 19, inRange ? C.gr : C.am, 11, 600);
    } else {
      this.txt(g, 'SIN OBJETIVO CERCANO', W - 168, H - 19, C.dim, 11);
    }
  }

  private wrap(g: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, lh: number, c: string, size = 15) {
    g.font = `500 ${size}px "IBM Plex Mono", monospace`; g.fillStyle = c; g.textBaseline = 'alphabetic';
    let line = '';
    for (const w of s.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = test;
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }

  placeCams(shipRoot: THREE.Object3D, armTip: THREE.Vector3) {
    this.noseCam.position.copy(b2t(13.3, 0, 0.4)).applyMatrix4(shipRoot.matrixWorld);
    this.noseCam.quaternion.copy(shipRoot.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)));
    this.armCam.position.copy(armTip).applyMatrix4(shipRoot.matrixWorld);
    this.armCam.quaternion.copy(this.noseCam.quaternion);
  }
}

export { SWITCH_LABEL };
