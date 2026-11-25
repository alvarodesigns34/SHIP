/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Motor de simulación modular de doble escena con origen flotante (escena lejana en km +
 * escena cercana en metros), lightmaps horneados en Cycles, sondas PMREM diferenciadas,
 * manos anatómicas riggeadas de 25 articulaciones y persistencia v3 completa.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, OutlineEffect, BlendFunction, Effect, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Astro, ScenarioId } from './world/Astro';
import { buildStation, buildSatellite, buildCanister, WorldObject } from './world/Props';
import { ShipModel, PartNode, SECTION, type ExplodePreset } from './ship/ShipModel';
import { initKTX2 } from './ship/texturesLib';
import { Mechanisms } from './ship/Mechanisms';
import { Systems, SwitchId, SWITCH_LABEL } from './ship/Systems';
import { Cockpit, Telemetry } from './ship/Cockpit';
import { Flight } from './sim/Flight';
import { Player } from './player/Player';
import { Input } from './Input';
import { Audio, type AcousticZone } from './Audio';
import { Crew, ACTIVITIES, type ActivityId } from './sim/Crew';
import { Hands } from './player/Hands';
import { MissionRunner } from './Missions';
import { Sandbox } from './Sandbox';
import { SceneLighting } from './SceneLighting';
import { EffectsManager } from './EffectsManager';
import { writeSave, readSave, clearSave, readSettings, writeSettings } from './Persistence';
import { b2t, clamp, easeInOut, easeOut, t2b } from './util';

export type Mode = 'CINEMATIC' | 'FLIGHT' | 'INTERIOR' | 'EVA' | 'ENGINEERING' | 'SANDBOX' | 'MISSIONS';
export type FlightCam = 'chase' | 'orbit' | 'cockpit' | 'free';
export type Quality = 'ultra' | 'alta' | 'media' | 'baja';

class ExposureEffect extends Effect {
  constructor() {
    super('Exposure', 'uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }',
      { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }
  set value(v: number) { (this.uniforms.get('exposure') as THREE.Uniform).value = v; }
}

export const WAYPOINTS: Record<string, { label: string; pos: [number, number, number]; look: [number, number, number] }> = {
  cabina: { label: 'Cabina de vuelo', pos: [6.42, 0, 0.35], look: [8.85, 0, -0.18] },
  lab: { label: 'Laboratorio', pos: [4.35, 0.3, 0.45], look: [6.55, -0.85, -0.45] },
  cq: { label: 'Habitáculos', pos: [3.65, -0.45, 0.38], look: [3.65, 1.45, -0.15] },
  servicios: { label: 'Servicios', pos: [2.75, 0.3, 0.42], look: [0.85, -0.55, -0.25] },
  nodo: { label: 'Nodo de proa', pos: [10.25, 0, 0.10], look: [12.15, 0, 0.0] },
  // Posición real dentro de la cúpula hexagonal acristalada (entre z=1.36 y z=2.00) mirando hacia el horizonte y la ventana cenital W7!
  cupula: { label: 'Cúpula', pos: [10.95, 0, 1.56], look: [11.35, 0.18, 2.24] },
  esclusa: { label: 'Esclusa', pos: [10.95, -0.35, -1.60], look: [10.95, 0.25, -2.55] },
};

export interface Snapshot {
  mode: Mode; flightCam: FlightCam; ready: boolean; interiorReady: boolean; progress: { stage: string; p: number };
  speed: number; vel: [number, number, number]; w: number; throttle: number; assist: boolean; thrustScale: number; docked: string | null;
  altKm: number; body: string; eclipse: number;
  orbit: { vOrbKmS: number; periodMin: number; apogeeKm: number; perigeeKm: number; inclinationDeg: number };
  seated: boolean; eva: boolean; airlock: string; jetFuel: number;
  prompt: string | null; holdProgress: number;
  crew: { needs: Crew['needs']; clock: string; samples: number; stored: number; log: string[]; freeExplore: boolean };
  activity: { label: string; p: number } | null; fade: number;
  locomotion: 'walk' | 'float'; crouch: boolean; climbing: boolean;
  systems: ReturnType<Systems['snapshot']>; alerts: { level: string; text: string }[];
  mission: ReturnType<MissionRunner['current']>; missionsDone: string[];
  sandbox: { score: number; streak: number; shots: number } | null;
  stats: { fps: number; ms: number; calls: number; tris: number; dpr: number; batches: number; instances: number };
  dock: Telemetry['dock']; targets: Telemetry['targets'];
  explode: number; explodePreset: ExplodePreset; xray: boolean; section: boolean; hudHidden: boolean; toast: string | null;
  scenario: ScenarioId; inspect: { label: string; desc: string } | null; arm: number[]; armGrabbed: string | null;
}

export class Engine {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 3000);
  near = new THREE.Scene();
  composer!: EffectComposer;
  private n8ao: any;
  outline!: OutlineEffect;
  private bloom!: BloomEffect;
  private exposureFx = new ExposureEffect();
  private farPass!: RenderPass;
  controls: OrbitControls;
  input: Input;
  audio = new Audio();
  // subsistemas modulares
  lighting: SceneLighting;
  fx: EffectsManager;
  // mundo
  astro = new Astro();
  model = new ShipModel();
  mech = new Mechanisms(this.model);
  systems = new Systems(false);
  cockpit = new Cockpit(this.model);
  flight = new Flight();
  player = new Player(this.model);
  missions = new MissionRunner();
  sandbox = new Sandbox();
  objects: WorldObject[] = [];
  station = buildStation();
  satellite = buildSatellite();
  canister = buildCanister();
  scenario: ScenarioId = 'leo';
  shipKm0 = new THREE.Vector3();
  // estado
  mode: Mode = 'CINEMATIC';
  flightCam: FlightCam = 'chase';
  seated = false;
  private seatSide = 0.62;
  airlock: 'pres' | 'depress' | 'vac' | 'repress' = 'pres';
  private airlockT = 0;
  hudHidden = false;
  quality: Quality = 'alta';
  dynamicRes = true;
  reducedMotion = false;
  photoTargets: number[] = [];
  scienceShot = false;
  viewedPage: string | null = null;
  inspect: { label: string; desc: string } | null = null;
  private toastMsg: { t: string; until: number } | null = null;
  private interp = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3() };
  private dpr = 1;
  private dprScale = 1;
  private frameMs = 16;
  private last = performance.now();
  private fpsAcc = { n: 0, t: performance.now(), fps: 0 };
  private raf = 0;
  private listeners = new Set<(s: Snapshot) => void>();
  private snapT = 0;
  private saveT = 0;
  private prog = { stage: 'Iniciando', p: 0 };
  ready = false;
  interiorReady = false;
  private restored = false;
  private freeCam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private chaseQ = new THREE.Quaternion();
  private cine = { shot: 0, t: 0 };
  private holdT = 0;
  private hoverCtl: { node: PartNode; ctl: string } | null = null;
  crew = new Crew();
  private ac = new AbortController();
  hands = new Hands();
  activity: { id: ActivityId; t: number } | null = null;
  fade = 0;
  private nadirBox: THREE.Box3 | null = null;
  private labelsLayer: HTMLDivElement;
  labels = true;
  private clipPlaneLocal = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private clipPlane = new THREE.Plane();
  section = { on: false, axis: 'y' as 'x' | 'y' | 'z', pos: 0, flip: false };
  private explodeAnim: null | { a: number; b: number; t0: number; dur: number } = null;
  private camAnim: null | { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; s: number; dur: number } = null;
  private damagedPanel = 'HAB.MMOD.R2.P14';
  onSelect: (n: PartNode | null) => void = () => {};
  touchFire = 0;
  hoverNode: PartNode | null = null;
  hoverXY: [number, number] = [0, 0];
  private pendingGrab = false;
  private pendingPhoto = false;
  private camFrame = 0;
  private ray = new THREE.Raycaster();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.autoClear = false;
    initKTX2(this.renderer);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.className = 'labels-layer';
    container.appendChild(this.labelsLayer);

    this.input = new Input(this.renderer.domElement, this.loadSettings()?.bindings);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 400;

    this.near.add(this.model.root, this.sandbox.group);
    this.model.root.add(this.cockpit.lights);
    this.lighting = new SceneLighting(this.near);
    this.fx = new EffectsManager(this.near, this.model.root, this.labelsLayer);
    for (const o of [this.station.obj, this.satellite.obj, this.canister]) { this.objects.push(o); this.near.add(o.group); }
    this.near.add(this.hands.group);

    this.setupComposer();
    this.applyQuality(this.loadSettings()?.quality ?? (matchMedia('(max-width: 860px)').matches ? 'baja' : 'alta'));
    const settings = this.loadSettings();
    if (settings?.locomotion === 'walk' || settings?.locomotion === 'float') this.player.locomotion = settings.locomotion;
    if (typeof settings?.freeExplore === 'boolean') this.crew.freeExplore = settings.freeExplore;
    this.player.onStep = (k) => this.audio.footstep(k);
    window.addEventListener('resize', this.resize, { signal: this.ac.signal });
    this.bindPointer();
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.resize();
    this.loop();
  }

  private setupComposer() {
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.farPass = new RenderPass(this.astro.scene, this.astro.camera);
    this.composer.addPass(this.farPass);
    const nearPass = new RenderPass(this.near, this.camera);
    nearPass.clearPass.enabled = true;
    (nearPass.clearPass as any).color = false;
    (nearPass.clearPass as any).depth = true;
    this.composer.addPass(nearPass);
    this.n8ao = new N8AOPostPass(this.near, this.camera, this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.n8ao.configuration.aoRadius = 0.55;
    this.n8ao.configuration.distanceFalloff = 0.5;
    this.n8ao.configuration.intensity = 1.65;
    this.n8ao.configuration.gammaCorrection = false;
    this.composer.addPass(this.n8ao);
    this.outline = new OutlineEffect(this.near, this.camera, {
      blendFunction: BlendFunction.SCREEN, edgeStrength: 3, pulseSpeed: 0, visibleEdgeColor: 0xe2572b, hiddenEdgeColor: 0x6a2410, xRay: true, blur: true, resolutionScale: 0.75,
    } as any);
    this.bloom = new BloomEffect({ intensity: 0.36, luminanceThreshold: 1.25, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vig = new VignetteEffect({ offset: 0.34, darkness: 0.34 });
    this.composer.addPass(new EffectPass(this.camera, this.outline, this.exposureFx, this.bloom, tone, vig));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio;
    this.dpr = q === 'ultra' ? Math.min(dpr, 2) : q === 'alta' ? Math.min(dpr, 1.75) : q === 'media' ? Math.min(dpr, 1.25) : 1;
    this.renderer.setPixelRatio(this.dpr * this.dprScale);
    this.n8ao.enabled = q !== 'baja';
    this.n8ao.configuration.halfRes = q !== 'ultra';
    this.renderer.shadowMap.enabled = q !== 'baja';
    const ms = q === 'ultra' ? 4096 : q === 'alta' ? 3072 : 2048;
    this.lighting.sunLight.shadow.mapSize.set(ms, ms);
    this.lighting.sunLight.shadow.map?.dispose(); (this.lighting.sunLight.shadow as any).map = null;
    this.bloom.intensity = q === 'baja' ? 0.24 : 0.40;
    this.resize();
  }

  resize = () => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.n8ao?.setSize?.(w, h);
  };

  async load() {
    const base = 'models/';
    const loader = await this.model.load(base, (stage, p) => { this.prog = { stage, p }; });
    this.prog = { stage: 'Preparando mecanismos', p: 1 };
    this.setScenario('leo', true);
    this.model.setMech('dock:ring', 0, true);
    this.setSection(false);
    this.ready = true;
    this.setMode('CINEMATIC');
    this.emitSnap();
    this.model.loadInterior(loader, base).then(() => {
      this.interiorReady = true;
      this.cockpit.setup();
      this.setSection(false);
      this.player.buildColliders();
      this.restore();
      this.restored = true;
      this.emitSnap();
    });
  }

  setScenario(id: ScenarioId, initial = false) {
    this.scenario = id;
    const sc = this.astro.scenarios().find((s) => s.id === id)!;
    this.shipKm0.copy(sc.shipKm);
    const upAway = id === 'lunar' ? sc.shipKm.clone().sub(this.astro.moonPos).normalize() : sc.shipKm.clone().normalize();
    const fwd = new THREE.Vector3(0, 1, 0).cross(upAway).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0);
    const right = fwd.clone().cross(upAway).normalize();
    const m = new THREE.Matrix4().makeBasis(fwd, upAway, right);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.flight.teleport(new THREE.Vector3(0, 0, 0), q);
    this.flight.docked = null;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);
    this.station.obj.pos.copy(P(260, 15, -60));
    this.station.obj.group.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.satellite.obj.pos.copy(P(-120, 40, 160));
    this.canister.pos.copy(P(40, 22, 18));
    this.canister.group.visible = true;
    this.near.environment = this.lighting.rebuildExteriorEnv(
      this.renderer, this.earthDirWorld(), this.earthAngularRadius(), this.astro.sunDir, id === 'lunar'
    );
    if (!initial) this.toast(`Escenario: ${sc.label}`);
  }

  earthDirWorld() { return this.shipKm0.clone().negate().normalize(); }
  earthAngularRadius() { return Math.asin(Math.min(1, 6371 / this.shipKm0.length())); }
  shipKm() { return this.shipKm0.clone().add(this.flight.state.pos.clone().divideScalar(1000)); }
  viewerLocal(): THREE.Vector3 {
    if (this.mode === 'INTERIOR' || this.mode === 'EVA') return this.player.pos.clone();
    return this.model.root.worldToLocal(this.camera.position.clone());
  }

  private currentAcousticZone(): AcousticZone {
    if (this.mode === 'EVA') return 'eva';
    if (this.mode !== 'INTERIOR' && !this.seated) return 'space';
    const [x, , z] = t2b(this.seated ? b2t(7.5, this.seatSide, 0) : this.player.pos);
    if (z < -1.35 && x > 9.8) return 'airlock';
    if (x >= 9.5) return 'node';
    if (x >= 6.75) return 'cockpit';
    if (x >= 4.70) return 'lab';
    if (x >= 2.65) return 'quarters';
    return 'services';
  }

  placeNear(id: string, dist: number) {
    const o = this.objects.find((x) => x.id === id);
    if (!o) return;
    const s = this.flight.state;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(s.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.q);
    if (id === 'tesela') {
      o.group.quaternion.copy(s.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      const portWorld = this.station.dockLocal.clone().applyQuaternion(o.group.quaternion);
      o.pos.copy(s.pos).addScaledVector(fwd, dist + 13.23).sub(portWorld);
    } else if (id === 'canister') {
      o.pos.copy(s.pos).addScaledVector(fwd, 3).addScaledVector(up, dist * 0.4).add(new THREE.Vector3(0, 0, dist * 0.6).applyQuaternion(s.q));
      o.vel.set(0, 0, 0); o.group.visible = true;
    } else o.pos.copy(s.pos).addScaledVector(fwd, dist).addScaledVector(up, 10);
  }
  rangeTo(id: string) { const o = this.objects.find((x) => x.id === id); return o ? o.pos.distanceTo(this.flight.state.pos) - o.radius : 1e9; }
  canisterArmDist() { return this.canister.pos.distanceTo(this.model.root.localToWorld(this.mech.tip().clone()).add(this.interp.pos)); }

  dockInfo() {
    const s = this.flight.state;
    const st = this.station;
    const portW = st.dockLocal.clone().applyQuaternion(st.obj.group.quaternion).add(st.obj.pos);
    const axisW = st.dockAxis.clone().applyQuaternion(st.obj.group.quaternion);
    const shipPortW = b2t(13.23, 0, 0).applyQuaternion(s.q).add(s.pos);
    const shipAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(s.q);
    const rel = shipPortW.clone().sub(portW);
    const range = rel.length();
    const closing = -s.vel.dot(rel.clone().normalize());
    const angle = THREE.MathUtils.radToDeg(shipAxis.angleTo(axisW.clone().negate()));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(st.obj.group.quaternion);
    const right = axisW.clone().cross(up).normalize();
    return { range, closing, lat: rel.dot(right), vert: rel.dot(up), angle, capture: this.flight.docked === 'tesela' };
  }

  shuttersOpen() {
    let open = true;
    for (let i = 1; i <= 7; i++) { const m = this.model.mech(`shutter:${i}`); if (m && Math.abs(m.value) > 0.05) open = false; }
    return open;
  }

  toast(t: string) { this.toastMsg = { t, until: performance.now() + 4500 }; }

  setFreeExplore(on: boolean) {
    this.crew.freeExplore = on;
    this.saveSettings();
    this.toast(on ? 'Exploración libre: necesidades pausadas' : 'Simulación de tripulante activa');
    this.emitSnap();
  }

  setMode(m: Mode) {
    const prev = this.mode;
    this.mode = m;
    this.input.unlock();
    this.controls.enabled = false;
    this.inspect = null;
    if (m !== 'ENGINEERING') {
      if (this.model.explode > 0) this.model.setExplode(0);
      if (this.model.xray) this.model.setXray(false);
      this.model.select(null); this.model.setIsolate(null); this.setSection(false);
    }
    if (m !== 'SANDBOX' && this.sandbox.active) this.sandbox.stop();
    if (m === 'ENGINEERING' || m === 'CINEMATIC') {
      this.controls.enabled = m === 'ENGINEERING';
      this.camera.fov = 32;
      if (prev === 'INTERIOR' || prev === 'EVA' || !this.ready || prev === 'FLIGHT' || prev === 'SANDBOX') {
        this.flyOrbit(new THREE.Vector3(26, 9, 30), new THREE.Vector3(2.5, -0.5, 0), 1200);
      }
    } else if (m === 'FLIGHT' || m === 'SANDBOX') {
      this.camera.fov = 55;
      if (!this.seated) this.flightCam = this.flightCam === 'cockpit' ? 'chase' : this.flightCam;
      this.chaseQ.copy(this.flight.state.q);
      if (m === 'SANDBOX') {
        const s = this.flight.state;
        this.sandbox.start(s.pos.clone(), new THREE.Vector3(1, 0, 0).applyQuaternion(s.q));
        this.flight.thrustScale = Math.max(this.flight.thrustScale, 12);
      }
    } else if (m === 'INTERIOR') {
      this.camera.fov = 72;
      if (!this.interiorReady) { this.mode = prev; this.toast('El interior todavía se está cargando'); return; }
      if (!Player.insidePressurized(this.player.pos)) this.enterInterior('cabina', true);
      this.player.eva = false;
    } else if (m === 'EVA') {
      this.camera.fov = 70;
      if (!this.player.eva) { this.mode = prev; this.toast('Para salir al exterior usa la esclusa (modo Interior → Esclusa)'); return; }
    }
    this.camera.updateProjectionMatrix();
    this.audio.start();
    this.save();
    this.emitSnap();
  }

  enterInterior(wp: keyof typeof WAYPOINTS | string, silent = false) {
    const w = WAYPOINTS[wp] ?? WAYPOINTS.cabina;
    this.player.pos.copy(b2t(...w.pos));
    this.player.vel.set(0, 0, 0);
    const d = b2t(...w.look).sub(b2t(...w.pos)).normalize();
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.asin(clamp(d.y, -1, 1));
    this.player.eva = false;
    this.player.settle();
    this.seated = false;
    if (this.mode !== 'INTERIOR' && !silent) this.setMode('INTERIOR');
    else if (this.mode !== 'INTERIOR') this.mode = 'INTERIOR';
  }

  flyOrbit(posLocal: THREE.Vector3, tgtLocal: THREE.Vector3, dur = 1200) {
    const p1 = this.model.root.localToWorld(posLocal.clone());
    const t1 = this.model.root.localToWorld(tgtLocal.clone());
    if (this.reducedMotion) { this.camera.position.copy(p1); this.controls.target.copy(t1); return; }
    this.camAnim = { p0: this.camera.position.clone(), p1, t0: this.controls.target.clone(), t1, s: performance.now(), dur };
  }

  focus(n: PartNode) {
    const b = this.model.currentBox(n);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.max(0.25, b.getSize(new THREE.Vector3()).length() / 2);
    const dist = Math.min(160, (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.05);
    const dirW = this.camera.position.clone().sub(this.controls.target).normalize();
    const dirL = dirW.applyQuaternion(this.model.root.quaternion.clone().invert());
    this.flyOrbit(c.clone().addScaledVector(dirL, dist), c, 1000);
  }

  viewPreset(v: 'iso' | 'front' | 'rear' | 'side' | 'top' | 'bottom') {
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(0.7, 0.42, 0.62), front: new THREE.Vector3(1, 0, 0), rear: new THREE.Vector3(-1, 0, 0),
      side: new THREE.Vector3(0, 0.0001, 1), top: new THREE.Vector3(0.0001, 1, 0), bottom: new THREE.Vector3(0.0001, -1, 0),
    };
    const c = b2t(2, 0, 0);
    this.flyOrbit(c.clone().addScaledVector(dirs[v].normalize(), 48), c, 1100);
  }

  setExplode(t: number, animate = false) {
    if (animate) this.explodeAnim = { a: this.model.explode, b: t, t0: performance.now(), dur: this.reducedMotion ? 1 : 1600 };
    else { this.explodeAnim = null; this.model.setExplode(t); this.emitSnap(); }
  }
  setExplodePreset(preset: ExplodePreset) {
    this.model.setExplodePreset(preset);
    if (this.model.explode < 0.05 && preset !== 'all') this.setExplode(0.65, true);
    this.emitSnap();
  }
  assemble() { this.model.setExplode(1); this.explodeAnim = { a: 1, b: 0, t0: performance.now() + 300, dur: this.reducedMotion ? 1 : 5200 }; }

  setSection(on: boolean, axis = this.section.axis, pos = this.section.pos, flip = this.section.flip) {
    this.section = { on, axis, pos, flip };
    SECTION.on.value = on ? 1 : 0;
    const n = axis === 'x' ? new THREE.Vector3(-1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
    if (flip) n.negate();
    const p = axis === 'x' ? new THREE.Vector3(pos, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 0, -pos) : new THREE.Vector3(0, pos, 0);
    this.clipPlaneLocal.setFromNormalAndCoplanarPoint(n, p);
    const mats = new Set<THREE.Material>();
    for (const b of this.model.batches) { mats.add(b.material); mats.add(b.xray); }
    for (const s of this.model.standalone) mats.add(s.mesh.material as THREE.Material);
    for (const m of mats) {
      if (m.clippingPlanes?.[0] !== this.clipPlane) { m.clippingPlanes = [this.clipPlane]; m.needsUpdate = true; }
      if (m.userData.side0 === undefined) m.userData.side0 = m.side;
      const side = on ? THREE.DoubleSide : m.userData.side0;
      if (m.side !== side) { m.side = side; m.needsUpdate = true; }
    }
    this.model.clip = on ? this.clipPlane : null;
  }

  select(n: PartNode | null, focus = false) {
    this.model.select(n);
    this.onSelect(n);
    if (n && focus) this.focus(n);
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      this.audio.start();
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.camAnim && this.mode === 'ENGINEERING') this.camAnim = null;
      if ((this.mode === 'INTERIOR' || this.mode === 'EVA' || (this.mode !== 'ENGINEERING' && this.mode !== 'CINEMATIC' && (this.flightCam === 'free' || this.flightCam === 'cockpit'))) && e.pointerType === 'mouse') this.input.lock();
    }, { signal: this.ac.signal });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 6 || !quick) return;
      if (this.mode === 'ENGINEERING') {
        const hit = this.pickAt(e.clientX, e.clientY);
        const n = hit?.node ?? null;
        if (n && this.model.selected === n && n.parent && n.parent.depth > 0) this.select(n.parent);
        else this.select(n);
      } else if (this.mode === 'INTERIOR' || this.mode === 'EVA' || this.seated) {
        if (!this.input.locked || e.pointerType !== 'mouse') this.tryInteract(e.clientX, e.clientY);
        else this.tryInteract();
      }
    }, { signal: this.ac.signal });
    el.addEventListener('mousemove', (e) => {
      if (this.mode !== 'ENGINEERING' || e.buttons) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      el.style.cursor = hit ? 'pointer' : 'grab';
      this.hoverNode = hit?.node ?? null;
      this.hoverXY = [e.clientX, e.clientY];
    }, { signal: this.ac.signal });
  }

  pickAt(cx?: number, cy?: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = cx === undefined ? new THREE.Vector2(0, 0) : new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -(((cy ?? 0) - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    this.ray.far = this.mode === 'ENGINEERING' ? 1000 : 2.6;
    return this.model.pick(this.ray);
  }

  private ctlAt(cx?: number, cy?: number): { node: PartNode; ctl: string } | null {
    const hit = this.pickAt(cx, cy);
    if (!hit) return null;
    let n: PartNode | null = hit.node;
    for (let m: PartNode | null = n; m; m = m.parent) if (m.ctl) return { node: m, ctl: m.ctl };
    const act = this.activityFor(hit.node.code);
    if (act) return { node: hit.node, ctl: 'act:' + act };
    while (n) { if (n.inspect) return { node: n, ctl: 'inspect' }; n = n.parent; }
    const c = hit.node.code;
    if (c.startsWith('HAB.INT.D.CL1') && this.systems.active('cdra_fan')) return { node: hit.node, ctl: 'repair:cdra_fan' };
    if (c.startsWith(this.damagedPanel) && this.systems.active('mmod_panel')) return { node: hit.node, ctl: 'repair:mmod_panel' };
    return null;
  }

  ctlLabel(c: { node: PartNode; ctl: string }) {
    const [k, v] = c.ctl.split(':');
    if (k === 'sw') return `${SWITCH_LABEL[v as SwitchId]}: ${this.systems.sw[v as SwitchId] ? 'APAGAR' : 'ENCENDER'}`;
    if (k === 'hatch') { const m = this.model.mech(c.ctl); return `Escotilla: ${m && Math.abs(m.target - m.rest) > 0.01 ? (m.rest === 0 ? 'cerrar' : 'abrir') : m && m.rest !== 0 ? 'cerrar' : 'abrir'}`; }
    if (k === 'shutters') return 'Contraventanas de la cúpula: abrir/cerrar';
    if (k === 'locker') return 'Taquilla: abrir/cerrar';
    if (k === 'seat') return v === '1' || v === '2' ? 'Sentarse a pilotar' : 'Sentarse';
    if (k === 'scr') return 'Pantalla táctil: cambiar página';
    if (k === 'airlock') return `Esclusa: ${this.airlock === 'pres' ? 'despresurizar' : this.airlock === 'vac' ? 'represurizar' : 'ciclo en curso…'}`;
    if (k === 'repair') return 'Mantén pulsado para reparar';
    if (k === 'inspect') return `Inspeccionar: ${c.node.label}`;
    if (k === 'act') return ACTIVITIES[v as ActivityId].prompt;
    return c.node.label;
  }

  tryInteract(cx?: number, cy?: number) {
    const c = cx === undefined ? this.hoverCtl : this.ctlAt(cx, cy);
    if (!c) return;
    if ((this.mode === 'INTERIOR' || this.mode === 'EVA' || this.seated) && !c.ctl.startsWith('act:')) {
      const hit = this.pickAt(cx, cy);
      if (hit) this.hands.reach(this.camera.worldToLocal(hit.point.clone()));
    }
    const [k, v] = c.ctl.split(':');
    this.audio.start();
    switch (k) {
      case 'sw': {
        const on = this.systems.toggle(v as SwitchId);
        this.model.setMech(c.ctl, on ? 0.45 : -0.45);
        this.audio.click(on);
        break;
      }
      case 'hatch': {
        if ((v === 'alk_in' && this.airlock !== 'pres') || (v === 'alk_out' && this.airlock !== 'vac')) { this.audio.beep('warn'); this.toast('Escotilla bloqueada: diferencia de presión'); return; }
        const opened = this.model.toggleMech(c.ctl);
        this.audio.hatch(opened);
        break;
      }
      case 'shutters': {
        const m = this.model.mech('shutter:1');
        const close = !!m && Math.abs(m.target) < 0.05;
        for (let i = 1; i <= 7; i++) { const mm = this.model.mech(`shutter:${i}`); if (mm) mm.target = close ? (Math.abs(mm.min) > Math.abs(mm.max) ? mm.min : mm.max) : 0; }
        this.audio.thud(0.4);
        break;
      }
      case 'locker': {
        const id = [...this.model.mechs.entries()].find(([, n]) => n === c.node)?.[0];
        if (id) { this.model.toggleMech(id); this.audio.click(true); }
        break;
      }
      case 'seat': this.sit(Number(v)); break;
      case 'scr': { const pg = this.cockpit.cyclePage(c.ctl); if (pg) this.viewedPage = pg; this.audio.click(true); break; }
      case 'airlock': this.cycleAirlock(); break;
      case 'act': this.startActivity(v as ActivityId); break;
      case 'inspect': this.inspect = { label: c.node.label, desc: c.node.desc }; this.audio.click(true); break;
    }
    this.emitSnap();
  }

  private activityFor(code: string): ActivityId | null {
    if (/^HAB\.INT\.LIV\.D\.O1[348]/.test(code)) return 'drink';
    if (code.startsWith('HAB.INT.D.PG')) return this.crew.needs.hydration < this.crew.needs.nutrition ? 'drink' : 'eat';
    if (/^HAB\.INT\.C\.CQ\d/.test(code)) return 'sleep';
    if (code.startsWith('HAB.INT.D.DK2')) return 'exercise';
    if (code.startsWith('HAB.INT.D.SH')) return 'hygiene';
    if (code.startsWith('HAB.INT.LIV.B.O06')) return 'plants';
    if (code.startsWith('HAB.INT.B.PG')) return 'science';
    if (code.startsWith('HAB.INT.B.PF')) return 'sample';
    if (/^HAB\.INT\.LIV\.(D\.O17|A\.O0[12])/.test(code)) return 'read';
    return null;
  }

  startActivity(id: ActivityId) {
    const why = this.crew.can(id);
    if (why) { this.toast(why); this.audio.beep('info'); return; }
    const a = ACTIVITIES[id];
    this.activity = { id, t: 0 };
    if (a.sound) this.audio.activity(a.sound, a.dur);
    if (id === 'sleep') this.audio.comms('Buenas noches, Alción. Luces de habitáculo atenuadas.');
  }

  private stepCrew(dt: number) {
    const live = this.mode !== 'CINEMATIC' && this.mode !== 'ENGINEERING';
    let looking = false;
    if (this.mode === 'INTERIOR' && !this.activity) {
      const view = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.viewQuat());
      const [x, y, z] = t2b(this.player.pos);
      if (!this.nadirBox) { const n = this.model.nodes.get('HAB.INT.B.NAD'); this.nadirBox = n ? this.model.currentBox(n).clone().expandByScalar(0.9) : new THREE.Box3(); }
      const nb = this.nadirBox, pp = this.player.pos;
      const overNadir = !nb.isEmpty() && pp.x > nb.min.x && pp.x < nb.max.x && pp.z > nb.min.z && pp.z < nb.max.z;
      const nearWindow = (Math.hypot(x - 10.95, y) < 0.9 && z > 0.6) || overNadir;
      looking = nearWindow && view.dot(this.mech.earthLocal) > 0.65;
    }
    if (live) this.crew.step(dt, { inCupolaLookingAtEarth: looking }, (m) => { this.toast(m); this.audio.beep('info'); });
    const target = this.activity?.id === 'sleep' ? 1 : 0;
    this.fade += (target - this.fade) * Math.min(1, dt * 2.5);
    if (this.activity) {
      const a = ACTIVITIES[this.activity.id];
      this.activity.t += dt;
      if (this.activity.t >= a.dur) {
        this.crew.apply(a.id);
        this.activity = null;
        this.toast(a.result);
        this.audio.beep('ok');
        if (a.id === 'sleep') this.audio.comms('Buenos días, Alción. Comienza el día ' + this.crew.clockText().split(' · ')[0].replace('Día ', '') + '.');
      }
    }
  }

  setLocomotion(l: 'walk' | 'float') {
    this.player.locomotion = l;
    this.player.vel.set(0, 0, 0);
    if (l === 'walk') this.player.settle(); else { this.player.eyeH = 1.62; this.player.bob.set(0, 0, 0); }
    this.saveSettings();
    this.toast(l === 'walk' ? 'Caminar: gravedad de entrenamiento 1 g' : 'Flotar: microgravedad');
    this.emitSnap();
  }

  sit(k: number) {
    if (k > 2) { this.toast('Los asientos traseros son de pasajero: usa el del comandante o el del piloto para pilotar'); return; }
    this.seated = true;
    this.flightCam = 'cockpit';
    this.mode = 'FLIGHT';
    this.camera.fov = 70; this.camera.updateProjectionMatrix();
    this.player.yaw = -Math.PI / 2; this.player.pitch = -0.32;
    this.seatSide = k === 1 ? 0.62 : -0.62;
    this.audio.thud(0.3);
    this.save();
    this.emitSnap();
  }
  standUp() {
    this.seated = false;
    this.enterInterior('cabina');
  }

  cycleAirlock() {
    if (this.airlock === 'pres') {
      const ih = this.model.mech('hatch:alk_in');
      if (ih && Math.abs(ih.value) > 0.05) { this.toast('Cierra la escotilla interior antes de despresurizar'); this.audio.beep('warn'); return; }
      this.airlock = 'depress'; this.airlockT = 0; this.audio.beep('warn'); this.toast('Despresurizando la esclusa…');
    } else if (this.airlock === 'vac') {
      const oh = this.model.mech('hatch:alk_out');
      if (oh && Math.abs(oh.value) > 0.05) this.model.setMech('hatch:alk_out', 0);
      this.airlock = 'repress'; this.airlockT = 0; this.toast('Represurizando…');
    }
  }

  photo() { this.pendingPhoto = true; this.audio.shutter(); }
  private capturePhoto() {
    this.renderer.domElement.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `alcion_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    const camW = this.camera.getWorldDirection(new THREE.Vector3());
    if (this.photoTargets.length) {
      const sat = this.satellite;
      this.photoTargets = this.photoTargets.filter((i) => {
        const pW = sat.inspect[i].clone().applyQuaternion(sat.obj.group.quaternion).add(sat.obj.pos).sub(this.interp.pos);
        const toP = pW.clone().sub(this.camera.position);
        const ok = toP.length() < 25 && camW.angleTo(toP) < 0.18;
        if (ok) this.toast(`Punto de inspección ${i + 1} fotografiado`);
        return !ok;
      });
    }
    const [bx, , bz] = t2b(this.player.pos);
    const inCupola = this.mode === 'INTERIOR' && bz > 1.0 && Math.abs(bx - 10.95) < 0.75;
    if (inCupola) {
      const toEarth = this.earthDirWorld();
      const toMoon = this.astro.moonPos.clone().sub(this.shipKm()).normalize();
      if (camW.angleTo(toEarth) < this.earthAngularRadius() + 0.55 || camW.angleTo(toMoon) < 0.45) {
        this.scienceShot = true;
        this.toast('Fotografía científica registrada');
      }
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.ready) return;
    const t0 = performance.now();
    this.input.pollGamepad();
    this.simStep(dt);
    this.renderFrame(dt);
    if (this.pendingPhoto) { this.pendingPhoto = false; this.capturePhoto(); }
    this.input.endFrame();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsAcc.n++;
    if (now - this.fpsAcc.t > 1000) {
      this.fpsAcc.fps = Math.round((this.fpsAcc.n * 1000) / (now - this.fpsAcc.t));
      this.fpsAcc.n = 0; this.fpsAcc.t = now;
      this.adaptResolution();
    }
    this.snapT += dt;
    if (this.snapT > 0.1) { this.snapT = 0; this.emitSnap(); }
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.save(); }
  };

  private simStep(dt: number) {
    this.handleInput(dt);
    const alpha = this.flight.advance(dt);
    this.flight.interp(alpha, this.interp);
    this.stepWorld(dt);
    this.missions.update(this, dt);
    this.updateScene(dt);
  }

  tick(seconds: number, h = 1 / 30) {
    for (let t = 0; t < seconds; t += h) this.simStep(h);
    this.input.endFrame();
  }

  private adaptResolution() {
    if (!this.dynamicRes) { if (this.dprScale !== 1) { this.dprScale = 1; this.renderer.setPixelRatio(this.dpr); this.resize(); } return; }
    const fps = this.fpsAcc.fps;
    let s = this.dprScale;
    if (fps < 45 && s > 0.55) s = Math.max(0.55, s - 0.1);
    else if (fps > 58 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dprScale) { this.dprScale = s; this.renderer.setPixelRatio(this.dpr * s); this.resize(); }
  }

  private handleInput(dt: number) {
    const I = this.input;
    if (I.hit('hud')) this.hudHidden = !this.hudHidden;
    if (I.hit('photo')) this.photo();
    const flying = this.mode === 'FLIGHT' || this.mode === 'SANDBOX' || this.seated;
    const fi = this.flight.input;
    fi.t.set(0, 0, 0); fi.r.set(0, 0, 0); fi.brake = false;
    if (flying && !(this.flightCam === 'free' && !this.seated)) {
      fi.t.set(I.axis('back', 'fwd'), I.axis('down', 'up'), I.axis('left', 'right'));
      fi.r.set(I.axis('rollLeft', 'rollRight') * -1, I.axis('yawRight', 'yawLeft'), I.axis('pitchDown', 'pitchUp') * -1);
      if (I.locked && this.flightCam === 'cockpit') { /* mirar dentro de la cabina */ }
      else if (I.locked) { fi.r.y += clamp(-I.mouseDX * 0.02 * I.sensitivity, -1, 1); fi.r.z += clamp(-I.mouseDY * 0.02 * I.sensitivity * (I.invertY ? -1 : 1), -1, 1); }
      if (I.held('throttleUp')) fi.throttle = Math.min(1, fi.throttle + dt * 0.6);
      if (I.held('throttleDown')) fi.throttle = Math.max(0, fi.throttle - dt * 0.9);
      fi.brake = I.held('brake');
      if (I.hit('assist')) { this.flight.assist = !this.flight.assist; this.toast(this.flight.assist ? 'Modo asistido' : 'Modo manual (newtoniano)'); this.audio.click(true); }
      if (I.hit('camera') && !this.seated) {
        const order: FlightCam[] = ['chase', 'orbit', 'free'];
        this.flightCam = order[(order.indexOf(this.flightCam) + 1) % order.length];
        if (this.flightCam === 'free') this.freeCam.pos.copy(this.camera.position);
        this.toast(`Cámara: ${{ chase: 'persecución', orbit: 'exterior orbital', free: 'libre', cockpit: 'cabina' }[this.flightCam]}`);
      }
      if (this.mode === 'SANDBOX' && (I.held('fire') || (this.touchFire && performance.now() - this.touchFire < 150))) {
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        if (this.sandbox.fire(this.camera.position.clone().add(this.interp.pos), dir, this.flight.state.vel)) this.audio.pulse();
      }
      if (this.seated && I.hit('exit')) this.standUp();
      if (this.seated && I.hit('interact')) this.tryInteract();
      this.flight.rcsArmed = this.systems.on('RCS');
      this.flight.mainArmed = this.systems.on('MAIN');
      if ((fi.t.lengthSq() > 0.01 || fi.r.lengthSq() > 0.01) && !this.flight.rcsArmed && Math.random() < dt) this.toast('RCS desarmado: actívalo en el panel cenital (fila PROPULSIÓN)');
    } else fi.throttle = Math.max(0, fi.throttle - dt);

    if (this.flightCam === 'free' && flying && !this.seated) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.freeCam.pitch, this.freeCam.yaw, 0, 'YXZ'));
      const mv = new THREE.Vector3(I.axis('left', 'right'), I.axis('down', 'up'), -I.axis('back', 'fwd')).applyQuaternion(q);
      this.freeCam.pos.addScaledVector(mv, dt * (I.held('boost') ? 40 : 10));
      if (I.locked) { this.freeCam.yaw -= I.mouseDX * 0.002; this.freeCam.pitch = clamp(this.freeCam.pitch - I.mouseDY * 0.002, -1.5, 1.5); }
    }
    if (this.mode === 'INTERIOR' || this.mode === 'EVA') {
      const look = I.locked ? { x: I.mouseDX * 0.0022 * I.sensitivity, y: I.mouseDY * 0.0022 * I.sensitivity * (I.invertY ? -1 : 1) } : { x: I.touchLook.x, y: I.touchLook.y };
      const pl = I.padLook();
      this.player.look(look.x + pl.x * dt * 2.2, look.y + pl.y * dt * 2.2);
      I.touchLook.x = 0; I.touchLook.y = 0;
      const move = new THREE.Vector3(I.axis('left', 'right'), I.axis('down', 'up'), -I.axis('back', 'fwd'));
      if (this.activity) {
        if (move.lengthSq() > 0.01 && this.activity.id !== 'sleep') { this.toast('Actividad interrumpida'); this.activity = null; }
        else move.set(0, 0, 0);
      }
      if (I.hit('grab')) {
        const hr = this.player.nearestHandrail();
        if (hr) { this.player.grabbing = hr; this.audio.thud(0.15); this.toast('Agarrado al asidero'); } else this.toast('No hay ningún asidero al alcance');
      }
      if (this.activity) this.player.step(dt, move, false, null);
      else this.player.step(dt, move, I.held('boost'), null, I.held('down'), I.held('up'), I.hit('up'));
      this.hoverCtl = this.ctlAt();
      if (I.hit('interact') && !this.activity) this.tryInteract();
      const rep = this.hoverCtl?.ctl.startsWith('repair:') ? this.hoverCtl.ctl.split(':')[1] : null;
      if (rep && I.held('interact')) { this.holdT = this.systems.repair(rep as any, dt); if (this.holdT >= 1) this.audio.beep('ok'); }
      else this.holdT = 0;
    } else if (this.seated) {
      this.hoverCtl = this.ctlAt();
      if (I.locked) this.player.look(I.mouseDX * 0.0022, I.mouseDY * 0.0022);
    } else this.hoverCtl = null;
  }

  private stepWorld(dt: number) {
    const ecl = this.astro.eclipse;
    const metab = this.activity ? (ACTIVITIES[this.activity.id].metabolic ?? 1) - 1 : 0;
    this.systems.step(dt, { sunFactor: 1 - ecl, wingsDeployed: 1, thrust: this.flight.throttle, sep: 0, rcsUse: this.flight.rcsActivity, hgaError: this.mech.hgaError(), crew: 4 + metab });
    this.stepCrew(dt);

    const qInv = this.interp.q.clone().invert();
    this.mech.sunLocal.copy(this.astro.sunDir).applyQuaternion(qInv);
    this.mech.earthLocal.copy(this.earthDirWorld()).applyQuaternion(qInv);
    this.mech.armPowered = this.systems.on('RBT');
    this.mech.hgaTracking = this.systems.on('COMM');
    this.mech.sunTracking = this.systems.on('SOLAR');
    const armAct = this.mech.update(dt);
    const mechAct = this.model.stepMechs(dt);
    this.model.setMech('dock:ring', this.systems.on('DOCK') && !this.flight.docked ? 0 : -0.26);

    if (this.airlock === 'depress' || this.airlock === 'repress') {
      this.airlockT += dt;
      if (this.airlockT > 6) {
        if (this.airlock === 'depress') { this.airlock = 'vac'; this.model.setMech('hatch:alk_out', -1.75); this.audio.hatch(true); this.toast('Esclusa en vacío: escotilla exterior abierta'); }
        else { this.airlock = 'pres'; this.audio.beep('ok'); this.toast('Esclusa presurizada'); }
      }
    }

    const [px, py, pz0] = t2b(this.player.pos);
    const pz = this.mode === 'INTERIOR' && this.player.locomotion === 'walk' ? pz0 - this.player.eyeH + 0.05 : pz0;
    if (this.mode === 'INTERIOR' && this.airlock === 'vac' && pz < -3.25 && Math.hypot(px - 11.05, py) < 0.6) {
      this.player.eva = true; this.mode = 'EVA'; this.camera.fov = 70; this.camera.updateProjectionMatrix();
      this.player.pos.copy(b2t(11.05, 0, -3.9)); this.player.jetFuel = 1; this.audio.comms('Alción, EVA iniciada. Línea de seguridad conectada.'); this.emitSnap();
    } else if (this.mode === 'EVA' && pz > -3.6 && pz < -2.2 && Math.hypot(px - 11.05, py) < 0.55) {
      this.player.eva = false; this.mode = 'INTERIOR'; this.player.pos.copy(b2t(11.05, 0, -2.8)); this.player.vel.set(0, 0, 0); this.audio.comms('Bienvenido a bordo.'); this.emitSnap();
    }

    if (!this.flight.docked && this.systems.on('DOCK')) {
      const d = this.dockInfo();
      if (d.range < 0.6 && d.angle < 6 && d.closing < 0.25) {
        this.flight.docked = 'tesela';
        this.audio.thud(1); this.audio.comms('Captura confirmada. Alción atracada en Tesela.'); this.toast('Captura: atracado en la estación Tesela');
      }
    }

    for (const o of this.objects) {
      if (o.id === 'tesela' && (this.flight.docked || this.dockInfo().range < 3)) continue;
      if (o.id === 'canister' && (this.mech.grabbed === 'canister' || !o.group.visible)) continue;
      const rel = this.flight.state.pos.clone().sub(o.pos);
      const minD = o.radius + 9;
      if (rel.length() < minD) {
        const n = rel.normalize();
        const vn = this.flight.state.vel.dot(n);
        if (vn < 0) { this.flight.state.vel.addScaledVector(n, -vn * 1.5); this.audio.thud(0.8); this.systems.alert('collision', 'alarm', 'Contacto con ' + o.label); }
      }
    }
    for (const o of this.objects) {
      o.pos.addScaledVector(o.vel, dt);
      o.group.rotation.x += o.spin.x * dt; o.group.rotation.y += o.spin.y * dt; o.group.rotation.z += o.spin.z * dt;
    }
    if (this.mech.grabbed === 'canister') {
      this.canister.pos.copy(this.mech.tip()).applyQuaternion(this.interp.q).add(this.interp.pos);
      this.canister.vel.set(0, 0, 0); this.canister.spin.set(0, 0, 0);
    }
    if (this.sandbox.active) { const h = this.sandbox.update(dt, this.interp.pos); if (h) this.audio.burst(); }

    const inside = this.mode === 'INTERIOR' || this.seated;
    this.audio.update({
      fans: this.systems.on('FANS') ? 1 : 0,
      power: this.systems.sw.BAT ? 1 : 0,
      thrust: Math.max(this.flight.throttle, this.flight.rcsActivity * 0.4),
      mech: Math.max(armAct, mechAct),
      inside,
      suit: this.mode === 'EVA',
      zone: this.currentAcousticZone(),
      airlockCycling: this.airlock === 'depress' || this.airlock === 'repress',
    });
    if (this.flight.rcsActivity > 0.3 && Math.random() < dt * 6) this.audio.rcs();
  }

  armCapture() {
    if (!this.systems.on('RBT')) { this.toast('Brazo sin alimentación (RBT)'); return; }
    const local = this.canister.pos.clone().sub(this.interp.pos).applyQuaternion(this.interp.q.clone().invert());
    const err = this.mech.solveIK(local);
    if (err < 0.5) { this.toast('Brazo en ruta de captura'); this.pendingGrab = true; }
    else { this.toast(`Fuera de alcance (${err.toFixed(1)} m)`); this.audio.beep('warn'); }
  }

  private updateScene(dt: number) {
    this.model.root.position.set(0, 0, 0);
    this.model.root.quaternion.copy(this.interp.q);
    this.model.root.updateMatrixWorld(true);
    if (this.pendingGrab && this.mech.armBusy === 0) {
      this.pendingGrab = false;
      const tipW = this.mech.tip().applyQuaternion(this.interp.q).add(this.interp.pos);
      if (tipW.distanceTo(this.canister.pos) < 0.9) { this.mech.grabbed = 'canister'; this.audio.thud(0.6); this.toast('Cápsula capturada'); }
    }
    if (this.explodeAnim) {
      const a = this.explodeAnim;
      const k = clamp((performance.now() - a.t0) / a.dur, 0, 1);
      this.model.setExplode(a.a + (a.b - a.a) * easeInOut(k));
      if (k >= 1) this.explodeAnim = null;
    }

    // Desde la Cúpula / Nodo (X > 9.3 m) mantenemos VISIBLE el exterior del vehículo (casco, alas, brazo)
    // para que al mirar por las ventanas se vea la nave enmarcada sobre la Tierra!
    // Y sólo marcamos visDirty cuando realmente cambia el estado (elimina el bucle por fotograma!).
    const [pbx] = t2b(this.player.pos);
    const inNodeOrCupola = this.mode === 'INTERIOR' && pbx > 9.3;
    const hideSkin = (this.mode === 'INTERIOR' && !inNodeOrCupola) || (this.seated && this.flightCam === 'cockpit');
    const camLocal = this.model.root.worldToLocal(this.camera.position.clone());
    const showInt = this.mode === 'ENGINEERING' || this.mode === 'INTERIOR' || this.seated || camLocal.length() < 30 || this.model.explode > 0;
    this.model.setInteriorVisibility(hideSkin, showInt);
    this.model.applyTransforms();
    this.model.updateVisibility();

    for (const o of this.objects) o.group.position.copy(o.pos).sub(this.interp.pos);

    this.updateCamera(dt);

    const fp = this.mode === 'INTERIOR' || this.mode === 'EVA' || (this.seated && this.flightCam === 'cockpit');
    this.hands.group.visible = fp;
    if (fp) {
      this.hands.setEVA(this.mode === 'EVA');
      const a = this.activity;
      this.hands.setActivity(a ? a.id : null, a ? a.t / ACTIVITIES[a.id].dur : 0, !!this.player.grabbing, this.mode === 'EVA', this.seated && this.flightCam === 'cockpit');
      this.hands.update(dt, this.camera, this.reducedMotion);
    }

    const indoor = this.mode === 'INTERIOR' || (this.seated && this.flightCam === 'cockpit');
    const exposure = this.lighting.update({
      dt, near: this.near, renderer: this.renderer,
      sunDir: this.astro.sunDir, earthDir: this.earthDirWorld(), earthAngRad: this.earthAngularRadius(),
      eclipse: this.astro.eclipse, isLunar: this.scenario === 'lunar',
      indoor, reducedMotion: this.reducedMotion,
    });
    this.exposureFx.value = exposure;

    // N8AO complementa suavemente el Contact AO ya horneado en el lightmap de Cycles
    this.n8ao.configuration.aoRadius = indoor ? 0.65 : 0.55;
    this.n8ao.configuration.intensity = indoor ? 1.85 : 1.75;

    const interiorActive = this.mode === 'INTERIOR' || this.seated || (this.mode === 'ENGINEERING' && this.model.explode === 0) || this.mode === 'EVA';
    this.cockpit.updateLights(this.systems, interiorActive ? this.viewerLocal() : null, interiorActive || camLocal.length() < 25, this.airlock);
    this.cockpit.draw(performance.now() / 1000, this.systems, this.telemetry(), this.viewerLocal());

    this.fx.updatePlumes(this.mode, this.model, this.flight, this.systems);
    this.fx.updateTether(this.mode === 'EVA', this.model.root, this.player.pos);
    this.fx.updateDamageMarker(this.mode, this.model, this.systems, this.damagedPanel, this.interp.q);

    const camKm = this.shipKm().add(this.camera.position.clone().divideScalar(1000));
    this.astro.update(dt, camKm, this.camera.getWorldQuaternion(new THREE.Quaternion()), this.camera.fov, this.camera.aspect, 1, this.renderer.getPixelRatio());

    this.fx.updateLabels(
      this.mode, this.labels, this.model, this.camera,
      this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight,
      (n) => this.select(n, true)
    );
  }

  private updateCamera(dt: number) {
    const root = this.model.root;
    const anim = this.camAnim;
    if (anim) {
      const k = clamp((performance.now() - anim.s) / anim.dur, 0, 1), e = easeOut(k);
      this.camera.position.lerpVectors(anim.p0, anim.p1, e);
      this.controls.target.lerpVectors(anim.t0, anim.t1, e);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) this.camAnim = null;
      if (this.mode === 'ENGINEERING' || this.mode === 'CINEMATIC') return;
    }
    if (this.mode === 'ENGINEERING') { this.controls.update(); return; }
    if (this.mode === 'CINEMATIC') { this.cinematic(dt); return; }
    if (this.mode === 'INTERIOR' || this.mode === 'EVA') {
      const bob = this.reducedMotion ? new THREE.Vector3() : this.player.bob.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
      this.camera.position.copy(root.localToWorld(this.player.pos.clone().add(bob)));
      this.camera.quaternion.copy(this.interp.q).multiply(this.player.viewQuat());
      return;
    }
    if (this.seated || this.flightCam === 'cockpit') {
      const head = b2t(7.48, this.seatSide, 0.02);
      this.camera.position.copy(root.localToWorld(head));
      this.camera.quaternion.copy(this.interp.q).multiply(this.player.viewQuat());
      return;
    }
    if (this.flightCam === 'chase') {
      const k = 1 - Math.exp(-dt * 3.5);
      this.chaseQ.slerp(this.interp.q, k);
      const off = new THREE.Vector3(-34, 9, 0).applyQuaternion(this.chaseQ);
      const vlag = this.interp.vel.clone().multiplyScalar(-0.25).clampLength(0, 6);
      this.camera.position.copy(off).add(vlag);
      const look = new THREE.Vector3(14, 2, 0).applyQuaternion(this.chaseQ);
      this.camera.up.set(0, 1, 0).applyQuaternion(this.chaseQ);
      this.camera.lookAt(look);
      return;
    }
    if (this.flightCam === 'orbit') {
      this.controls.enabled = true;
      this.controls.target.set(0, 0, 0);
      if (this.camera.position.length() < 5) this.camera.position.set(30, 12, 34);
      this.camera.up.set(0, 1, 0);
      this.controls.update();
      return;
    }
    this.freeCam.pos.sub(this.interp.vel.clone().multiplyScalar(dt));
    this.camera.position.copy(this.freeCam.pos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.freeCam.pitch, this.freeCam.yaw, 0, 'YXZ'));
  }

  private cinematic(dt: number) {
    const shots: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [b2t(-34, 22, 6), b2t(-18, 30, 10), b2t(2, 0, 0), b2t(3, 0, 0)],
      [b2t(22, -9, 2.5), b2t(18, -5, 3.5), b2t(11, 0, 0.5), b2t(11, 0, 0.2)],
      [b2t(-12, -16, -7), b2t(-20, -6, -9), b2t(-3, 0, -1), b2t(-1, 0, -1)],
      [b2t(6, 34, 12), b2t(-6, 36, 8), b2t(3, 0, 0), b2t(2, 0, 0)],
      [b2t(14, 6, 6.5), b2t(9, 8, 5), b2t(10.8, 0, 1.4), b2t(8, 0, 2)],
    ];
    this.cine.t += dt;
    const D = 11;
    if (this.cine.t > D) { this.cine.t = 0; this.cine.shot = (this.cine.shot + 1) % shots.length; }
    const [p0, p1, t0, t1] = shots[this.cine.shot];
    const k = easeInOut(this.cine.t / D);
    const root = this.model.root;
    this.camera.position.copy(root.localToWorld(p0.clone().lerp(p1, k)));
    this.camera.up.set(0, 1, 0).applyQuaternion(this.interp.q);
    this.camera.lookAt(root.localToWorld(t0.clone().lerp(t1, k)));
  }

  private renderFrame(dt: number) {
    if (this.section.on) this.clipPlane.copy(this.clipPlaneLocal).applyMatrix4(this.model.root.matrixWorld);
    else { this.clipPlane.normal.set(0, 1, 0); this.clipPlane.constant = 1e9; }
    this.lighting.sunLight.shadow.camera.updateProjectionMatrix();
    this.camFrame = (this.camFrame + 1) % 4;
    if (this.camFrame === 0 && (this.cockpit.wantsCam || this.cockpit.wantsArmCam)) this.renderScreenCams();
    this.outline.selection.set(this.model.proxies.children as THREE.Object3D[]);
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  private renderScreenCams() {
    const r = this.renderer;
    const armTip = this.mech.tip().clone().add(b2t(0.25, 0, 0.18));
    this.cockpit.placeCams(this.model.root, armTip);
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (const [cam, rt, want] of [[this.cockpit.noseCam, this.cockpit.camRT, this.cockpit.wantsCam], [this.cockpit.armCam, this.cockpit.armRT, this.cockpit.wantsArmCam]] as const) {
      if (!want) continue;
      const camKm = this.shipKm().add(cam.position.clone().divideScalar(1000));
      this.astro.update(0, camKm, cam.quaternion, cam.fov, cam.aspect, 1, 1);
      r.setRenderTarget(rt);
      r.clear(true, true, true);
      r.render(this.astro.scene, this.astro.camera);
      r.clearDepth();
      r.render(this.near, cam);
    }
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = prevShadow;
    const camKm = this.shipKm().add(this.camera.position.clone().divideScalar(1000));
    this.astro.update(0, camKm, this.camera.getWorldQuaternion(new THREE.Quaternion()), this.camera.fov, this.camera.aspect, 1, this.renderer.getPixelRatio());
  }

  telemetry(): Telemetry {
    const s = this.flight.state;
    const qInv = s.q.clone().invert();
    const targets = this.objects.filter((o) => o.group.visible).map((o) => {
      const rel = o.pos.clone().sub(s.pos);
      const range = Math.max(0, rel.length() - o.radius);
      return { label: o.label, range, rate: -s.vel.dot(rel.normalize()), bearing: rel.clone().applyQuaternion(qInv).normalize() };
    });
    const alt = this.astro.altitude(this.shipKm());
    const orbit = this.flight.computeOrbit(alt.body, alt.km);
    const dock = this.rangeTo('tesela') < 400 ? this.dockInfo() : null;
    const mc = this.missions.current();
    return {
      vel: s.vel.clone().applyQuaternion(qInv), w: s.w, q: s.q, throttle: this.flight.throttle, assist: this.flight.assist, rcsArmed: this.flight.rcsArmed,
      mainArmed: this.flight.mainArmed, altKm: alt.km, body: alt.body, eclipse: this.astro.eclipse, orbit, targets, dock,
      mission: mc ? { title: mc.title, step: mc.step, progress: mc.progress } : null, arm: this.mech.joints.map((j) => j.angle),
      checklist: [
        { label: 'Batería maestra', done: this.systems.sw.BAT }, { label: 'Buses A y B', done: this.systems.sw.BUSA && this.systems.sw.BUSB },
        { label: 'Aviónica en línea', done: this.systems.booted }, { label: 'Soporte vital y ventilación', done: this.systems.on('ECLSS') && this.systems.on('FANS') },
        { label: 'Bombeo térmico', done: this.systems.on('THERM') }, { label: 'Alas solares', done: this.systems.on('SOLAR') },
        { label: 'Navegación y comunicaciones', done: this.systems.on('NAV') && this.systems.on('COMM') }, { label: 'RCS y motores armados', done: this.systems.on('RCS') && this.systems.on('MAIN') },
      ],
    };
  }

  subscribe(fn: (s: Snapshot) => void) { this.listeners.add(fn); fn(this.snapshot()); return () => { this.listeners.delete(fn); }; }
  emitSnap() { const s = this.snapshot(); this.listeners.forEach((f) => f(s)); }

  snapshot(): Snapshot {
    const s = this.flight.state;
    const tel = this.ready ? this.telemetry() : null;
    const alt = this.astro.altitude(this.shipKm());
    const orbit = tel?.orbit ?? this.flight.computeOrbit(alt.body, alt.km);
    const info = this.renderer.info.render;
    if (this.toastMsg && performance.now() > this.toastMsg.until) this.toastMsg = null;
    return {
      mode: this.mode, flightCam: this.flightCam, ready: this.ready, interiorReady: this.interiorReady, progress: this.prog,
      speed: s.vel.length(), vel: tel ? [tel.vel.x, tel.vel.y, tel.vel.z] : [0, 0, 0], w: s.w.length(), throttle: this.flight.throttle, assist: this.flight.assist,
      thrustScale: this.flight.thrustScale, docked: this.flight.docked, altKm: alt.km, body: alt.body, eclipse: this.astro.eclipse, orbit,
      seated: this.seated, eva: this.player.eva, airlock: this.airlock, jetFuel: this.player.jetFuel,
      prompt: this.activity ? ACTIVITIES[this.activity.id].doing : this.hoverCtl ? this.ctlLabel(this.hoverCtl) : null,
      holdProgress: this.activity ? this.activity.t / ACTIVITIES[this.activity.id].dur : this.holdT,
      crew: { needs: { ...this.crew.needs }, clock: this.crew.clockText(), samples: this.crew.samples, stored: this.crew.stored, log: [...this.crew.log], freeExplore: this.crew.freeExplore },
      activity: this.activity ? { label: ACTIVITIES[this.activity.id].doing, p: this.activity.t / ACTIVITIES[this.activity.id].dur } : null,
      fade: this.fade, locomotion: this.player.locomotion, crouch: this.player.crouch, climbing: this.player.climbing,
      systems: this.systems.snapshot(), alerts: this.systems.alerts.slice(0, 4).map((a) => ({ level: a.level, text: a.text })),
      mission: this.missions.current(), missionsDone: [...this.missions.done],
      sandbox: this.sandbox.active ? { score: this.sandbox.score, streak: this.sandbox.streak, shots: this.sandbox.shots } : null,
      stats: { fps: this.fpsAcc.fps, ms: this.frameMs, calls: info.calls, tris: info.triangles, dpr: this.renderer.getPixelRatio(), batches: this.model.stats.batches, instances: this.model.stats.instances },
      dock: tel?.dock ?? null, targets: tel?.targets ?? [],
      explode: this.model.explode, explodePreset: this.model.explodePreset, xray: this.model.xray, section: this.section.on, hudHidden: this.hudHidden,
      toast: this.toastMsg?.t ?? null, scenario: this.scenario, inspect: this.inspect, arm: this.mech.joints.map((j) => j.angle), armGrabbed: this.mech.grabbed,
    };
  }

  // ---------------------------------------------------------------- persistencia v3 completa
  save() {
    if (!this.ready || !this.restored) return;
    writeSave({
      v: 3,
      scenario: this.scenario,
      mode: this.mode === 'MISSIONS' ? 'FLIGHT' : this.mode,
      flightCam: this.flightCam,
      seated: this.seated,
      seatSide: this.seatSide,
      airlock: this.airlock === 'vac' ? 'vac' : 'pres',
      flight: this.flight.serialize(),
      systems: this.systems.snapshot(),
      player: this.player.serialize(),
      crew: this.crew.serialize(),
      missionsDone: [...this.missions.done],
      arm: this.mech.joints.map((j) => j.angle),
      armGrabbed: this.mech.grabbed,
      mechs: Object.fromEntries([...this.model.mechs.entries()].filter(([id]) => /^(hatch|shutter)/.test(id)).map(([id, n]) => [id, n.mech!.target])),
    });
  }

  restore() {
    const o = readSave();
    if (!o) return false;
    try {
      this.setScenario(o.scenario ?? 'leo', true);
      if (o.flight) this.flight.deserialize(o.flight);
      if (o.systems) this.systems.load(o.systems as any);
      if (o.player) this.player.deserialize(o.player);
      if (o.crew) this.crew.deserialize(o.crew);
      (o.missionsDone ?? []).forEach((d: string) => this.missions.done.add(d));
      this.airlock = o.airlock === 'vac' || o.airlock === 'pres' ? o.airlock : 'pres';
      for (const [id, v] of Object.entries(o.mechs ?? {})) this.model.setMech(id, v as number, true);
      for (const [id, on] of Object.entries(this.systems.sw)) this.model.setMech('sw:' + id, on ? 0.45 : -0.45, true);
      // Restauración completa de brazo robótico, cámara, asiento y modo (v3!)
      if (Array.isArray(o.arm) && o.arm.length === this.mech.joints.length) {
        this.mech.joints.forEach((j, i) => { j.angle = j.target = o.arm![i]; });
      }
      if (o.armGrabbed !== undefined) this.mech.grabbed = o.armGrabbed;
      if (typeof o.seatSide === 'number') this.seatSide = o.seatSide;
      if (o.flightCam) this.flightCam = o.flightCam;
      if (o.seated) {
        this.seated = true;
        this.flightCam = 'cockpit';
        this.mode = 'FLIGHT';
        this.camera.fov = 70; this.camera.updateProjectionMatrix();
      } else if (o.mode && o.mode !== 'CINEMATIC') {
        if (o.mode === 'EVA' && this.player.eva) { this.mode = 'EVA'; this.camera.fov = 70; this.camera.updateProjectionMatrix(); }
        else if (o.mode === 'INTERIOR' && Player.insidePressurized(this.player.pos)) { this.mode = 'INTERIOR'; this.camera.fov = 72; this.camera.updateProjectionMatrix(); }
        else if (o.mode === 'FLIGHT' || o.mode === 'ENGINEERING' || o.mode === 'SANDBOX') this.setMode(o.mode);
      }
      this.toast('Estado restaurado');
      return true;
    } catch { return false; }
  }

  resetState() {
    clearSave();
    this.systems = new Systems(false);
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.setScenario(this.scenario);
    for (const [id, on] of Object.entries(this.systems.sw)) this.model.setMech('sw:' + id, on ? 0.45 : -0.45, true);
    this.mech.grabbed = null; this.mech.setPose('stow');
    this.airlock = 'pres';
    this.seated = false;
    this.setMode('CINEMATIC');
  }

  loadSettings(): any { return readSettings(); }
  saveSettings(extra: Record<string, unknown> = {}) {
    writeSettings({
      quality: this.quality, bindings: this.input.bindings, invertY: this.input.invertY, sens: this.input.sensitivity,
      volume: this.audio.volume, sound: this.audio.mode, reduced: this.reducedMotion, dynamicRes: this.dynamicRes,
      locomotion: this.player.locomotion, freeExplore: this.crew.freeExplore, ...extra,
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.input.dispose();
    this.hands.dispose();
    this.lighting.dispose();
    this.listeners.clear();
    try { (this.audio as any).ctx?.close?.(); } catch { /* */ }
    const seen = new Set<unknown>();
    const free = (o: any) => { if (!o || seen.has(o)) return; seen.add(o); o.dispose?.(); };
    for (const sc of [this.near, this.astro.scene]) sc?.traverse((o: any) => {
      free(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const v of Object.values(m)) if ((v as any)?.isTexture) free(v);
        free(m);
      }
    });
    free(this.near.environment);
    free(this.cockpit.camRT); free(this.cockpit.armRT);
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelsLayer.remove();
  }
}
