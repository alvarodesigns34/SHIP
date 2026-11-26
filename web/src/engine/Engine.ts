/**
 * ALCIÓN HX-4 · REBIRTH — motor.
 *
 * Arquitectura (ver docs/REBIRTH_STATE.md):
 * - Pipeline propio (render/Pipeline.ts): escena astronómica + escena cercana sobre un único
 *   RT HDR con MSAA, bloom por mips y AgX. Sin EffectComposer/N8AO/Outline/SMAA.
 * - Dos activos derivados del mismo modelo maestro: exterior/ingeniería (ShipModel, BatchedMesh)
 *   e interior inmersivo cerrado (Interior, lightmaps por estancia). Perfiles de visibilidad
 *   explícitos por modo: el modo interior nunca hereda estados de ingeniería.
 * - Simulación de paso fijo (60 Hz, hasta 15 subpasos): la velocidad de la experiencia no
 *   depende de los FPS.
 * - Instrumentación de fotograma completo: llamadas y triángulos de TODAS las pasadas
 *   (sombras, cámaras de instrumentos, bloom), CPU por fase, GPU si el navegador lo permite.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Astro, ScenarioId } from './world/Astro';
import { buildStation, buildSatellite, buildCanister, WorldObject } from './world/Props';
import { ShipModel, PartNode, SECTION, type ExplodePreset } from './ship/ShipModel';
import { initKTX2 } from './ship/texturesLib';
import { Mechanisms } from './ship/Mechanisms';
import { Systems, SwitchId, SWITCH_LABEL } from './ship/Systems';
import { Cockpit, Telemetry } from './ship/Cockpit';
import { Flight } from './sim/Flight';
import { Player } from './player/Player';
import { Controller } from './player/Controller';
import { Hands } from './player/Hands';
import { Input } from './Input';
import { Audio, type AcousticZone } from './Audio';
import { Crew, ACTIVITIES, type ActivityId } from './sim/Crew';
import { MissionRunner } from './Missions';
import { Sandbox } from './Sandbox';
import { SceneLighting } from './SceneLighting';
import { EffectsManager } from './EffectsManager';
import { Interior, IPart, ROOMS } from './interior/Interior';
import { SHIP_INV } from './interior/RMaterials';
import { Pipeline, GpuTimer, type DebugView } from './render/Pipeline';
import { writeSave, readSave, clearSave, readSettings, writeSettings } from './Persistence';
import { b2t, clamp, easeInOut, easeOut, t2b, damp } from './util';

export type Mode = 'CINEMATIC' | 'FLIGHT' | 'INTERIOR' | 'EVA' | 'ENGINEERING' | 'SANDBOX' | 'MISSIONS';
export type FlightCam = 'chase' | 'orbit' | 'cockpit' | 'free';
export type Quality = 'ultra' | 'alta' | 'media' | 'baja';

/** Puntos de aparición (Blender: posición de los OJOS y punto al que se mira). */
export const WAYPOINTS: Record<string, { label: string; pos: [number, number, number]; look: [number, number, number] }> = {
  cabina: { label: 'Cabina de vuelo', pos: [6.35, -0.25, 0.48], look: [9.4, 0.15, -0.15] },
  lab: { label: 'Laboratorio', pos: [4.6, 0.25, 0.48], look: [6.6, -0.4, -0.1] },
  cq: { label: 'Habitáculos', pos: [3.0, 0.0, 0.48], look: [4.6, 0.6, 0.2] },
  servicios: { label: 'Servicios', pos: [2.6, 0.2, 0.48], look: [0.8, -0.4, 0.0] },
  nodo: { label: 'Nodo', pos: [10.6, 0.0, 0.95], look: [12.1, 0.0, 0.6] },
};

export interface FrameStats {
  fps: number; ms: number; p50: number; p95: number; p99: number; cpu: number; gpu: number;
  calls: number; tris: number; dpr: number; batches: number; instances: number; matrixWrites: number;
  passes: { far: number; near: number; bloom: number; final: number; shadow: number; cams: number; sim: number; ui: number };
  mem: { geo: number; tex: number; progs: number };
}

export interface Snapshot {
  mode: Mode; flightCam: FlightCam; ready: boolean; interiorReady: boolean; progress: { stage: string; p: number };
  speed: number; vel: [number, number, number]; w: number; throttle: number; assist: boolean; thrustScale: number; docked: string | null;
  altKm: number; body: string; eclipse: number;
  orbit: { vOrbKmS: number; periodMin: number; apogeeKm: number; perigeeKm: number; inclinationDeg: number };
  seated: boolean; eva: boolean; airlock: string; jetFuel: number;
  prompt: string | null; promptKind: string | null; holdProgress: number;
  crew: { needs: Crew['needs']; clock: string; samples: number; stored: number; log: string[]; freeExplore: boolean };
  activity: { label: string; p: number } | null; fade: number;
  locomotion: 'walk' | 'float'; crouch: boolean; climbing: boolean; room: string;
  systems: ReturnType<Systems['snapshot']>; alerts: { level: string; text: string }[];
  mission: ReturnType<MissionRunner['current']>; missionsDone: string[];
  sandbox: { score: number; streak: number; shots: number } | null;
  stats: FrameStats;
  dock: Telemetry['dock']; targets: Telemetry['targets'];
  explode: number; explodePreset: ExplodePreset; xray: boolean; section: boolean; hudHidden: boolean; toast: string | null;
  scenario: ScenarioId; inspect: { label: string; desc: string } | null; arm: number[]; armGrabbed: string | null;
  quality: Quality; debug: DebugView;
}

const SIM_DT = 1 / 60;

export class Engine {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  pipeline: Pipeline;
  gpu: GpuTimer;
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 3000);
  near = new THREE.Scene();
  controls: OrbitControls;
  input: Input;
  audio = new Audio();
  lighting: SceneLighting;
  fx: EffectsManager;
  astro = new Astro();
  model = new ShipModel();
  interior = new Interior();
  mech = new Mechanisms(this.model);
  systems = new Systems(false);
  cockpit = new Cockpit(this.model);
  flight = new Flight();
  /** tripulante en el interior (controlador por vóxeles) */
  player = new Controller() as Controller & { eva: boolean; jetFuel: number };
  /** cuerpo EVA (colisión con el exterior) */
  evaBody = new Player(this.model);
  hands = new Hands();
  missions = new MissionRunner();
  sandbox = new Sandbox();
  objects: WorldObject[] = [];
  station = buildStation();
  satellite = buildSatellite();
  canister = buildCanister();
  scenario: ScenarioId = 'leo';
  shipKm0 = new THREE.Vector3();
  mode: Mode = 'CINEMATIC';
  flightCam: FlightCam = 'chase';
  seated = false;
  seatSide = 0.78;
  airlock: 'pres' | 'depress' | 'vac' | 'repress' = 'pres';
  private airlockT = 0;
  hudHidden = false;
  quality: Quality = 'alta';
  dynamicRes = true;
  reducedMotion = false;
  fovPref = 74;
  photoTargets: number[] = [];
  scienceShot = false;
  viewedPage: string | null = null;
  inspect: { label: string; desc: string } | null = null;
  private toastMsg: { t: string; until: number } | null = null;
  interp = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3() };
  private dpr = 1;
  private dprScale = 1;
  private last = performance.now();
  private acc = 0;
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
  hoverCtl: { part: IPart | null; node: PartNode | null; ctl: string; label: string } | null = null;
  crew = new Crew();
  private ac = new AbortController();
  activity: { id: ActivityId; t: number } | null = null;
  fade = 0;
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
  debug: DebugView = 'none';
  /** historial de duraciones de fotograma (ms) para percentiles */
  private frameHist = new Float32Array(240);
  private frameHistN = 0;
  private statsCache: FrameStats = {
    fps: 0, ms: 0, p50: 0, p95: 0, p99: 0, cpu: 0, gpu: -1, calls: 0, tris: 0, dpr: 1, batches: 0, instances: 0, matrixWrites: 0,
    passes: { far: 0, near: 0, bloom: 0, final: 0, shadow: 0, cams: 0, sim: 0, ui: 0 }, mem: { geo: 0, tex: 0, progs: 0 },
  };
  private fpsAcc = { n: 0, t: performance.now() };
  private cpuMs = 0;
  private simMs = 0;
  private camsMs = 0;
  private shadowKey = '';
  private evaReturnArmed = false;
  /** tras volver de la EVA hay que subir por la escalerilla antes de poder salir de nuevo */
  private evaExitArmed = true;
  private extVisible = true;
  /** ventanas (espacio nave three) para decidir si el exterior puede verse desde dentro */
  private windows: THREE.Sphere[] = [
    new THREE.Sphere(b2t(9.36, 0, 1.0), 1.75),     // banda panorámica de cabina
    new THREE.Sphere(b2t(11.05, 0, 1.75), 0.85),   // cúpula
    new THREE.Sphere(b2t(5.72, 0, -1.7), 0.9),     // ventanas de nadir del laboratorio
  ];
  /** distancia máxima desde la que cada ventana deja ver el exterior de la nave */
  private windowReach = [7, 4, 2.6];
  private frustum = new THREE.Frustum();
  private projM = new THREE.Matrix4();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false, alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // la pasada final escribe ya en espacio de pantalla
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.localClippingEnabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.autoClear = false;
    initKTX2(this.renderer);
    this.pipeline = new Pipeline(this.renderer);
    this.gpu = new GpuTimer(this.renderer);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.toast('Contexto gráfico perdido: recuperando…'); }, { signal: this.ac.signal });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.renderer.shadowMap.needsUpdate = true; this.toast('Contexto gráfico recuperado'); }, { signal: this.ac.signal });

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.className = 'labels-layer';
    container.appendChild(this.labelsLayer);

    const settings = this.loadSettings();
    this.input = new Input(this.renderer.domElement, settings?.bindings);
    if (typeof settings?.invertY === 'boolean') this.input.invertY = settings.invertY;
    if (typeof settings?.sens === 'number') this.input.sensitivity = settings.sens;
    if (typeof settings?.fov === 'number') this.fovPref = clamp(settings.fov, 60, 95);
    if (typeof settings?.reduced === 'boolean') this.reducedMotion = settings.reduced;
    if (typeof settings?.dynamicRes === 'boolean') this.dynamicRes = settings.dynamicRes;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 400;
    this.controls.enabled = false;

    this.near.add(this.model.root, this.sandbox.group);
    this.model.root.add(this.interior.root);
    this.model.root.add(this.cockpit.lights);
    this.lighting = new SceneLighting(this.near);
    this.fx = new EffectsManager(this.near, this.model.root, this.labelsLayer);
    for (const o of [this.station.obj, this.satellite.obj, this.canister]) { this.objects.push(o); this.near.add(o.group); }
    this.near.add(this.hands.group);

    this.player.eva = false;
    this.player.jetFuel = 1;
    this.evaBody.eva = true;
    if (settings?.locomotion === 'walk' || settings?.locomotion === 'float') this.player.locomotion = settings.locomotion;
    if (typeof settings?.freeExplore === 'boolean') this.crew.freeExplore = settings.freeExplore;
    this.player.onStep = (k) => this.audio.footstep(k);
    this.applyQuality(settings?.quality ?? (matchMedia('(max-width: 860px), (pointer: coarse)').matches ? 'media' : 'alta'));
    window.addEventListener('resize', this.resize, { signal: this.ac.signal });
    this.bindPointer();
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ calidad
  applyQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = q === 'ultra' ? Math.min(dpr, 2) : q === 'alta' ? Math.min(dpr, 1.5) : q === 'media' ? Math.min(dpr, 1.25) : Math.min(dpr, 1);
    this.pipeline.configure({ msaa: q === 'ultra' ? 4 : q === 'alta' ? 4 : q === 'media' ? 2 : 0, bloom: q !== 'baja' });
    this.renderer.shadowMap.enabled = q !== 'baja';
    const ms = q === 'ultra' ? 4096 : q === 'alta' ? 2048 : 1536;
    const sh = this.lighting.sunLight.shadow;
    if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); sh.map?.dispose(); (sh as any).map = null; }
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize = () => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = this.dpr * this.dprScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.pipeline.setSize(w * pr, h * pr);
  };

  // ------------------------------------------------------------------ carga
  async load() {
    const base = (import.meta as any).env?.BASE_URL ?? './';
    const pExt = this.model.load('models/', (stage, p) => { this.prog = { stage, p: p * 0.6 }; });
    const pInt = this.interior.load('', (p) => { if (!this.ready) this.prog = { stage: 'Interior', p: 0.6 + p * 0.3 }; });
    await pExt;
    this.prog = { stage: 'Preparando la nave', p: 0.9 };
    this.setScenario('leo', true);
    this.model.setMech('dock:ring', 0, true);
    this.setSection(false);
    this.ready = true;
    this.setMode('CINEMATIC');
    this.emitSnap();
    void base;
    try {
      await pInt;
      this.cockpit.setup(this.interior, this.model.root);
      this.player.grid = this.interior.voxels;
      this.evaBody.buildColliders();
      this.model.root.updateMatrixWorld(true);
      this.interior.captureProbes(this.renderer, this.near, this.model.root);
      this.interiorReady = true;
      this.restore();
    } catch (e) {
      console.error('Interior', e);
      this.toast('No se pudo cargar el interior: el exterior sigue disponible');
    }
    this.restored = true;
    this.emitSnap();
  }

  // ------------------------------------------------------------------ escenario
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
    this.station.obj.pos.copy(P(2600, 150, -700));
    this.station.obj.group.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.satellite.obj.pos.copy(P(-1400, 400, 1900));
    this.canister.pos.copy(P(40, 22, 18));
    this.canister.group.visible = true;
    this.near.environment = this.lighting.rebuildExteriorEnv(this.renderer, this.earthDirWorld(), this.earthAngularRadius(), this.astro.sunDir, id === 'lunar');
    this.renderer.shadowMap.needsUpdate = true;
    if (!initial) this.toast(`Escenario: ${sc.label}`);
  }

  earthDirWorld() { return this.shipKm0.clone().negate().normalize(); }
  earthAngularRadius() { return Math.asin(Math.min(1, 6371 / this.shipKm0.length())); }
  shipKm() { return this.shipKm0.clone().add(this.flight.state.pos.clone().divideScalar(1000)); }
  /** Posición del observador en espacio nave (three). */
  viewerLocal(): THREE.Vector3 {
    if (this.mode === 'INTERIOR') return this.player.pos.clone();
    if (this.mode === 'EVA') return this.evaBody.pos.clone();
    return this.model.root.worldToLocal(this.camera.position.clone());
  }

  private currentAcousticZone(): AcousticZone {
    if (this.mode === 'EVA') return 'eva';
    if (this.mode !== 'INTERIOR' && !this.seated) return 'space';
    const p = this.seated ? b2t(7.6, this.seatSide, 0) : this.player.pos;
    const [x, , z] = t2b(p);
    if (z < -1.35 && x > 9.8) return 'airlock';
    const r = this.interior.roomAt(p);
    return r === 'N' ? 'node' : r === 'A' ? 'cockpit' : r === 'B' ? 'lab' : r === 'C' ? 'quarters' : 'services';
  }

  // ------------------------------------------------------------------ utilidades de escena
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

  toast(t: string) { this.toastMsg = { t, until: performance.now() + 4200 }; this.emitSnap(); }

  setFreeExplore(on: boolean) {
    this.crew.freeExplore = on;
    this.saveSettings();
    this.toast(on ? 'Exploración libre: necesidades en pausa' : 'Simulación de tripulante activa');
  }

  // ------------------------------------------------------------------ modos
  setMode(m: Mode) {
    const prev = this.mode;
    if (m === 'INTERIOR' && !this.interiorReady) { this.toast('El interior todavía se está cargando'); return; }
    if (m === 'EVA' && !this.player.eva) { this.toast('Para salir al exterior usa la esclusa'); return; }
    this.mode = m;
    this.input.unlock();
    this.controls.enabled = false;
    this.inspect = null;
    this.activity = null;
    // ningún estado de ingeniería sobrevive fuera de ingeniería
    if (m !== 'ENGINEERING') {
      if (this.model.explode > 0) this.model.setExplode(0);
      this.explodeAnim = null;
      if (this.model.xray) this.model.setXray(false);
      this.model.select(null); this.model.setIsolate(null); this.setSection(false);
      this.interiorExplode(0);
    }
    if (m !== 'SANDBOX' && this.sandbox.active) this.sandbox.stop();
    if (m !== 'FLIGHT') this.seated = false;
    if (m === 'ENGINEERING' || m === 'CINEMATIC') {
      this.controls.enabled = m === 'ENGINEERING';
      this.camera.fov = 32;
      if (prev !== m) this.flyOrbit(new THREE.Vector3(26, 9, 30), new THREE.Vector3(2.5, -0.5, 0), this.ready && prev !== 'CINEMATIC' ? 1200 : 1);
    } else if (m === 'FLIGHT' || m === 'SANDBOX' || m === 'MISSIONS') {
      this.camera.fov = this.seated ? this.fovPref : 55;
      if (!this.seated && this.flightCam === 'cockpit') this.flightCam = 'chase';
      this.chaseQ.copy(this.flight.state.q);
      if (m === 'SANDBOX') {
        const s = this.flight.state;
        this.sandbox.start(s.pos.clone(), new THREE.Vector3(1, 0, 0).applyQuaternion(s.q));
        this.flight.thrustScale = Math.max(this.flight.thrustScale, 12);
      }
    } else if (m === 'INTERIOR') {
      this.camera.fov = this.fovPref;
      if (!this.insideInterior(this.player.pos)) this.enterInterior('cabina', true);
      this.player.eva = false;
    } else if (m === 'EVA') {
      this.camera.fov = 70;
    }
    this.camera.updateProjectionMatrix();
    this.model.setProfile(m === 'ENGINEERING' ? 'engineering' : 'immersive');
    this.renderer.shadowMap.needsUpdate = true;
    this.audio.start();
    this.save();
    this.emitSnap();
  }

  insideInterior(p: THREE.Vector3) {
    const [x, y, z] = t2b(p);
    if (x < 0.6 || x > 12.2) return false;
    const r = Math.hypot(y, z);
    return x < 9.95 ? r < 1.9 : r < 1.25 || (z > 1 && Math.hypot(x - 11.05, y) < 0.65) || (z < -1 && Math.hypot(x - 11.05, y) < 0.7);
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
    this.activity = null;
    if (this.mode !== 'INTERIOR' && !silent) this.setMode('INTERIOR');
    else if (this.mode !== 'INTERIOR') { this.mode = 'INTERIOR'; this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix(); this.model.setProfile('immersive'); }
  }

  flyOrbit(posLocal: THREE.Vector3, tgtLocal: THREE.Vector3, dur = 1200) {
    const p1 = this.model.root.localToWorld(posLocal.clone());
    const t1 = this.model.root.localToWorld(tgtLocal.clone());
    if (this.reducedMotion || dur <= 1) { this.camera.position.copy(p1); this.controls.target.copy(t1); this.camera.lookAt(t1); this.camAnim = null; return; }
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

  // ------------------------------------------------------------------ vista explosionada
  setExplode(t: number, animate = false) {
    if (animate) this.explodeAnim = { a: this.model.explode, b: t, t0: performance.now(), dur: this.reducedMotion ? 1 : 1500 };
    else { this.explodeAnim = null; this.model.setExplode(t); this.interiorExplode(t); this.emitSnap(); }
  }
  setExplodePreset(preset: ExplodePreset) {
    this.model.setExplodePreset(preset);
    if (this.model.explode < 0.05 && preset !== 'all') this.setExplode(0.65, true);
    this.emitSnap();
  }
  assemble() { this.model.setExplode(1); this.interiorExplode(1); this.explodeAnim = { a: 1, b: 0, t0: performance.now() + 300, dur: this.reducedMotion ? 1 : 4200 }; }

  /** El interior se separa por estancias (cada una conserva su identidad), siguiendo al módulo habitable. */
  private interiorExplode(t: number) {
    const pre = this.model.explodePreset;
    const k = (pre === 'all' || pre === 'interior') ? t : 0;
    for (const [code, p] of this.interior.parts) {
      if (!/^HAB\.INT\.[A-D]$|^FWD\.INT$/.test(code)) continue;
      const room = code.endsWith('A') ? 'A' : code.endsWith('B') ? 'B' : code.endsWith('C') ? 'C' : code.endsWith('D') ? 'D' : 'N';
      const off = { A: [1.2, 1.6, 0], B: [0.4, 2.6, 0], C: [-0.4, 3.4, 0], D: [-1.2, 4.2, 0], N: [2.6, 1.0, 0] }[room]!;
      const T = new THREE.Matrix4().makeTranslation(off[0] * k * 2.2, off[1] * k * 1.6, off[2]);
      p.obj.matrix.copy(p.base).premultiply(T);
      p.obj.matrixWorldNeedsUpdate = true;
      const mg = this.interior.roomMerged.get(room);
      if (mg) { mg.matrix.copy(T); mg.matrixWorldNeedsUpdate = true; }
    }
  }

  // ------------------------------------------------------------------ corte
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
    for (const m of this.interior.materials) mats.add(m);
    for (const m of mats) {
      const want = on ? [this.clipPlane] : null;
      if ((m.clippingPlanes?.length ?? 0) !== (want?.length ?? 0)) { m.clippingPlanes = want; m.needsUpdate = true; }
      if (m.userData.side0 === undefined) m.userData.side0 = m.side;
      const side = on ? THREE.DoubleSide : m.userData.side0;
      if (m.side !== side) { m.side = side; m.needsUpdate = true; }
    }
    this.model.clip = on ? this.clipPlane : null;
    this.renderer.shadowMap.needsUpdate = true;
  }

  select(n: PartNode | null, focus = false) {
    this.model.select(n);
    this.onSelect(n);
    if (n && focus) this.focus(n);
  }

  // ------------------------------------------------------------------ puntero
  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    const sig = { signal: this.ac.signal };
    el.addEventListener('pointerdown', (e) => {
      this.audio.start();
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      if (this.camAnim && this.mode === 'ENGINEERING') this.camAnim = null;
      const fp = this.mode === 'INTERIOR' || this.mode === 'EVA' || this.seated || (this.mode !== 'ENGINEERING' && this.mode !== 'CINEMATIC' && this.flightCam === 'free');
      if (fp && e.pointerType === 'mouse' && e.button === 0 && !this.input.locked) this.input.lock();
    }, sig);
    el.addEventListener('pointercancel', () => { down = null; }, sig);
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 6 || !quick) return;
      if (this.mode === 'ENGINEERING') {
        const hit = this.pickAt(e.clientX, e.clientY);
        // el interior Rebirth también es inspeccionable (pieza con identidad propia)
        if (this.interior.root.visible) {
          this.ray.setFromCamera(this.ndc(e.clientX, e.clientY), this.camera); this.ray.far = 1000;
          this.ray.layers.enableAll();
          const ih = this.ray.intersectObject(this.interior.root, true).find((h) => !h.object.userData.mergedRoom && !((h.object as THREE.Mesh).material as THREE.Material).transparent);
          if (ih && (!hit || ih.distance < hit.dist - 0.01)) {
            const part = this.interior.partOf(ih.object);
            if (part) { this.select(null); this.inspect = { label: part.label, desc: `${part.desc} · ${part.code}` }; this.emitSnap(); return; }
          }
        }
        this.inspect = null;
        const n = hit?.node ?? null;
        if (n && this.model.selected === n && n.parent && n.parent.depth > 0) this.select(n.parent);
        else this.select(n);
      } else if (this.mode === 'INTERIOR' || this.seated) {
        if (this.input.locked && e.pointerType === 'mouse') this.tryInteract();
        else this.tryInteract(e.clientX, e.clientY);
      }
    }, sig);
    el.addEventListener('mousemove', (e) => {
      if (this.mode !== 'ENGINEERING' || e.buttons) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      el.style.cursor = hit ? 'pointer' : 'grab';
      this.hoverNode = hit?.node ?? null;
      this.hoverXY = [e.clientX, e.clientY];
    }, sig);
  }

  private ndc(cx?: number, cy?: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return cx === undefined ? new THREE.Vector2(0, 0) : new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -(((cy ?? 0) - rect.top) / rect.height) * 2 + 1);
  }

  pickAt(cx?: number, cy?: number) {
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    this.ray.far = this.mode === 'ENGINEERING' ? 1000 : 2.6;
    return this.model.pick(this.ray);
  }

  /** Control interactivo bajo el punto de mira (interior Rebirth). */
  private ctlAt(cx?: number, cy?: number): Engine['hoverCtl'] {
    if (!this.interiorReady) return null;
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    this.ray.far = 2.3;
    this.ray.layers.enableAll();
    const hits = this.ray.intersectObject(this.interior.root, true).filter((h) => !h.object.userData.mergedRoom && !h.object.parent?.userData.mergedRoomGroup);
    // tolerancia de puntería para controles pequeños (palancas, botones): esfera de selección de 4 cm
    const firstD = hits.find((h) => !((Array.isArray((h.object as THREE.Mesh).material) ? (h.object as THREE.Mesh).material : [(h.object as THREE.Mesh).material]) as THREE.Material[]).every((m) => m.transparent))?.distance ?? 2.3;
    let best: IPart | null = null, bestD = 0.045;
    const sph = new THREE.Sphere(), tmp = new THREE.Vector3();
    for (const p of this.interior.controls) {
      if (!p.ctl || !p.obj.visible || p.meshes.length === 0) continue;
      p.box.getBoundingSphere(sph);
      if (sph.radius > 0.2) continue;
      sph.applyMatrix4(this.interior.root.matrixWorld);
      const along = tmp.copy(sph.center).sub(this.ray.ray.origin).dot(this.ray.ray.direction);
      if (along < 0 || along > firstD + 0.06) continue;
      const d = this.ray.ray.distanceToPoint(sph.center) - sph.radius;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) return { part: best, node: null, ctl: best.ctl!, label: this.ctlLabel(best.ctl!, best.label) };
    for (const h of hits) {
      const mats = (Array.isArray((h.object as THREE.Mesh).material) ? (h.object as THREE.Mesh).material : [(h.object as THREE.Mesh).material]) as THREE.Material[];
      if (mats.every((m) => m.transparent)) continue;
      let p = this.interior.partOf(h.object);
      while (p && !p.ctl) { const par: THREE.Object3D | null = p.obj.parent; p = par ? this.interior.partOf(par) : null; }
      if (!p) return null;
      return { part: p, node: null, ctl: p.ctl!, label: this.ctlLabel(p.ctl!, p.label) };
    }
    return null;
  }

  ctlLabel(ctl: string, label = '') {
    const [k, v] = ctl.split(':');
    if (k === 'sw') return `${SWITCH_LABEL[v as SwitchId]} · ${this.systems.sw[v as SwitchId] ? 'apagar' : 'encender'}`;
    if (k === 'hatch') { const m = this.interior.mech(ctl); return `Escotilla · ${m && Math.abs(m.target - m.rest) > 0.01 ? 'cerrar' : 'abrir'}`; }
    if (k === 'shutters') return 'Contraventanas de la cúpula · abrir/cerrar';
    if (k === 'locker') return 'Compartimento · abrir/cerrar';
    if (k === 'seat') return v === '1' || v === '2' ? 'Sentarse a los mandos' : 'Sentarse';
    if (k === 'scr') return 'Pantalla · cambiar página';
    if (k === 'airlock') return `Esclusa · ${this.airlock === 'pres' ? 'despresurizar' : this.airlock === 'vac' ? 'represurizar' : 'ciclo en curso…'}`;
    if (k === 'act') return ACTIVITIES[v as ActivityId]?.prompt ?? label;
    return label;
  }

  tryInteract(cx?: number, cy?: number) {
    const c = cx === undefined ? this.hoverCtl : this.ctlAt(cx, cy);
    if (!c) return;
    const [k, v] = c.ctl.split(':');
    this.audio.start();
    // la mano viaja al punto real del objeto (no una animación genérica)
    if (k !== 'act' && k !== 'seat') {
      this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
      this.ray.far = 2.3;
      this.ray.layers.enableAll();
      const hit = this.ray.intersectObject(c.part?.obj ?? this.interior.root, true).filter((h) => !h.object.userData.mergedRoom)[0];
      if (hit) this.hands.reach(this.camera.worldToLocal(hit.point.clone()), 0.55);
    }
    switch (k) {
      case 'sw': {
        const on = this.systems.toggle(v as SwitchId);
        this.interior.setMech(c.ctl, on ? 0.45 : -0.45);
        this.audio.click(on);
        break;
      }
      case 'hatch': {
        const m = this.interior.mech(c.ctl);
        if (m) { const open = Math.abs(m.target - m.rest) < 1e-3; m.target = open ? (Math.abs(m.min - m.rest) > Math.abs(m.max - m.rest) ? m.min : m.max) : m.rest; this.audio.hatch(open); }
        break;
      }
      case 'locker': {
        const p = c.part;
        if (p?.mech) { const m = p.mech; m.target = Math.abs(m.target - m.rest) < 1e-3 ? (Math.abs(m.min - m.rest) > Math.abs(m.max - m.rest) ? m.min : m.max) : m.rest; this.audio.click(true); }
        break;
      }
      case 'seat': this.sit(Number(v)); break;
      case 'scr': { const pg = this.cockpit.cyclePage(c.ctl); if (pg) this.viewedPage = pg; this.audio.click(true); break; }
      case 'airlock': this.cycleAirlock(); break;
      case 'act': this.startActivity(v as ActivityId); break;
    }
    this.emitSnap();
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
      const nearWindow = this.windows.some((w) => w.distanceToPoint(this.player.pos) < 0.6);
      looking = nearWindow && view.dot(this.mech.earthLocal) > 0.5;
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
      }
    }
  }

  setLocomotion(l: 'walk' | 'float') {
    this.player.locomotion = l;
    this.player.vel.set(0, 0, 0);
    if (l === 'walk') this.player.settle();
    this.saveSettings();
    this.toast(l === 'walk' ? 'Caminar · gravedad de entrenamiento (licencia de juego)' : 'Flotar · microgravedad');
  }

  sit(k: number) {
    if (k > 2) { this.toast('Los asientos traseros son de pasajero'); return; }
    this.seated = true;
    this.flightCam = 'cockpit';
    this.seatSide = k === 1 ? 0.78 : -0.78;
    this.mode = 'FLIGHT';
    this.model.setProfile('immersive');
    this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix();
    this.player.yaw = -Math.PI / 2; this.player.pitch = -0.12;
    this.audio.thud(0.3);
    this.save();
    this.emitSnap();
  }
  standUp() {
    this.seated = false;
    // levantarse junto al asiento, sin teletransporte a otra estancia
    this.player.pos.copy(b2t(7.15, this.seatSide * 0.4, 0.5));
    this.player.settle();
    this.mode = 'INTERIOR';
    this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix();
    this.emitSnap();
  }

  cycleAirlock() {
    if (this.airlock === 'pres') {
      const ih = this.interior.mech('hatch:alk_in');
      if (ih && Math.abs(ih.value) > 0.05) { this.toast('Cierra la escotilla interior antes de despresurizar'); this.audio.beep('warn'); return; }
      this.airlock = 'depress'; this.airlockT = 0; this.audio.beep('warn'); this.toast('Despresurizando la esclusa…');
    } else if (this.airlock === 'vac') {
      if (this.mode === 'EVA') { this.toast('No se puede represurizar con un tripulante fuera'); this.audio.beep('warn'); return; }
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
    const atWindow = this.mode === 'INTERIOR' && this.windows.some((w) => w.distanceToPoint(this.player.pos) < 0.8);
    if (atWindow) {
      const toEarth = this.earthDirWorld();
      if (camW.angleTo(toEarth) < this.earthAngularRadius() + 0.55) { this.scienceShot = true; this.toast('Fotografía científica registrada'); }
    }
  }

  // ------------------------------------------------------------------ bucle
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    if (!this.ready) return;
    // historial para percentiles
    this.frameHist[this.frameHistN++ % this.frameHist.length] = rawDt * 1000;
    const dt = Math.min(0.25, rawDt);
    const t0 = performance.now();
    this.input.pollGamepad();
    this.handleFrameInput(dt);
    // simulación de paso fijo: idéntica velocidad a 20 o a 144 FPS
    this.acc += dt;
    let n = 0;
    while (this.acc >= SIM_DT && n < 15) { this.simStep(SIM_DT); this.acc -= SIM_DT; n++; }
    if (n === 15) this.acc = 0;
    const alpha = this.flight.advance(0); // reutiliza la interpolación del vuelo
    this.flight.interp(alpha, this.interp);
    const t1 = performance.now();
    this.simMs = damp(this.simMs, t1 - t0, 5, dt);
    this.updateScene(dt);
    this.gpu.begin();
    this.renderFrame();
    this.gpu.end();
    if (this.pendingPhoto) { this.pendingPhoto = false; this.capturePhoto(); }
    this.input.endFrame();
    this.cpuMs = damp(this.cpuMs, performance.now() - t0, 5, dt);
    this.fpsAcc.n++;
    if (now - this.fpsAcc.t > 1000) {
      this.statsCache.fps = Math.round((this.fpsAcc.n * 1000) / (now - this.fpsAcc.t));
      this.fpsAcc.n = 0; this.fpsAcc.t = now;
      this.adaptResolution();
    }
    this.snapT += dt;
    if (this.snapT > 0.125) { this.snapT = 0; this.emitSnap(); }
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.save(); }
  };

  /** Paso fijo de simulación (física de vuelo, tripulante, sistemas, mecanismos, misiones). */
  private simStep(h: number) {
    this.flight.advance(h);
    this.flight.interp(1, this.interp);
    this.stepPlayer(h);
    this.stepWorld(h);
    this.missions.update(this, h);
  }

  /** Avance determinista para pruebas: `seconds` de simulación sin renderizar. */
  tick(seconds: number, h = SIM_DT) {
    for (let t = 0; t < seconds; t += h) { this.handleFrameInput(h); this.simStep(h); this.input.endFrame(); }
    this.flight.interp(1, this.interp);
    this.updateScene(h);
  }

  private adaptResolution() {
    if (!this.dynamicRes) { if (this.dprScale !== 1) { this.dprScale = 1; this.resize(); } return; }
    const fps = this.statsCache.fps;
    let s = this.dprScale;
    // escalado conservador: nunca por debajo del 70 % (una imagen borrosa no es una solución)
    if (fps < 50 && s > 0.7) s = Math.max(0.7, s - 0.1);
    else if (fps > 58 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.dprScale) { this.dprScale = s; this.resize(); }
  }

  /** Entrada que se procesa una vez por fotograma (flancos, vista). */
  private handleFrameInput(dt: number) {
    const I = this.input;
    if (I.hit('hud')) { this.hudHidden = !this.hudHidden; this.emitSnap(); }
    if (I.hit('photo')) this.photo();
    if (this.mode === 'INTERIOR' || this.seated) {
      const sens = 0.0021 * I.sensitivity;
      const lx = I.locked ? I.mouseDX * sens : I.touchLook.x;
      const ly = I.locked ? I.mouseDY * sens * (I.invertY ? -1 : 1) : I.touchLook.y;
      const pl = I.padLook();
      this.player.look(lx + pl.x * dt * 2.4, ly + pl.y * dt * 2.4);
      if (this.seated) { this.player.yaw = clamp(this.player.yaw, -Math.PI / 2 - 1.9, -Math.PI / 2 + 1.9); }
      I.touchLook.x = 0; I.touchLook.y = 0;
      if (I.hit('interact') && !this.activity) this.tryInteract();
      if (this.seated && I.hit('exit')) this.standUp();
      if (this.mode === 'INTERIOR' && I.hit('grab')) this.player.crouchToggle = !this.player.crouchToggle;
    }
    if (this.mode === 'EVA') {
      const pl = I.padLook();
      const lx = I.locked ? I.mouseDX * 0.0021 : I.touchLook.x;
      const ly = I.locked ? I.mouseDY * 0.0021 : I.touchLook.y;
      this.evaBody.look(lx + pl.x * dt * 2.2, ly + pl.y * dt * 2.2);
      I.touchLook.x = 0; I.touchLook.y = 0;
    }
    const flying = this.mode === 'FLIGHT' || this.mode === 'SANDBOX' || this.mode === 'MISSIONS' || this.seated;
    if (flying) {
      if (I.hit('assist')) { this.flight.assist = !this.flight.assist; this.toast(this.flight.assist ? 'Modo asistido' : 'Modo manual (newtoniano)'); this.audio.click(true); }
      if (I.hit('camera') && !this.seated) {
        const order: FlightCam[] = ['chase', 'orbit', 'free'];
        this.flightCam = order[(order.indexOf(this.flightCam) + 1) % order.length];
        if (this.flightCam === 'free') this.freeCam.pos.copy(this.camera.position);
        this.toast(`Cámara: ${{ chase: 'persecución', orbit: 'órbita', free: 'libre', cockpit: 'cabina' }[this.flightCam]}`);
      }
      if (this.flightCam === 'free' && !this.seated && I.locked) { this.freeCam.yaw -= I.mouseDX * 0.002; this.freeCam.pitch = clamp(this.freeCam.pitch - I.mouseDY * 0.002, -1.5, 1.5); }
    }
  }

  private stepPlayer(h: number) {
    const I = this.input;
    if (this.interiorReady) this.player.mask = this.interior.solidMask();
    if (this.mode === 'INTERIOR') {
      const move = new THREE.Vector3(I.axis('left', 'right'), 0, -I.axis('back', 'fwd'));
      if (this.activity) {
        if (move.lengthSq() > 0.01 && this.activity.id !== 'sleep') { this.toast('Actividad interrumpida'); this.activity = null; }
        else move.set(0, 0, 0);
      }
      this.player.step(h, move, { run: I.held('boost'), crouch: I.held('down'), up: I.held('up') && this.player.locomotion === 'float' || (I.held('up') && !!this.player.ladder()), jump: false });
      const rep = this.hoverCtl?.ctl.startsWith('repair:') ? this.hoverCtl.ctl.split(':')[1] : null;
      if (rep && I.held('interact')) { this.holdT = this.systems.repair(rep as any, h); if (this.holdT >= 1) this.audio.beep('ok'); }
      else this.holdT = 0;
    } else if (this.mode === 'EVA') {
      // regreso por la escotilla exterior (antes de la colisión exterior, que podría desplazar al astronauta)
      const dHatch = this.evaBody.pos.distanceTo(b2t(11.05, 0, -3.6));
      if (dHatch > 1.1) this.evaReturnArmed = true;
      if (this.evaReturnArmed && dHatch < 0.85 && this.airlock === 'vac') {
        this.player.eva = false; this.mode = 'INTERIOR'; this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix();
        this.player.pos.copy(b2t(11.05, 0, -3.16 + 1.66)); this.player.vel.set(0, 0, 0); this.player.settle();
        this.audio.comms('Bienvenido a bordo. Represuriza la esclusa desde su panel.'); this.emitSnap();
        this.evaExitArmed = false;
        return;
      }
      const move = new THREE.Vector3(I.axis('left', 'right'), I.axis('down', 'up'), -I.axis('back', 'fwd'));
      this.evaBody.step(h, move, I.held('boost'), null);
      this.player.jetFuel = this.evaBody.jetFuel;
    }
    const flying = this.mode === 'FLIGHT' || this.mode === 'SANDBOX' || this.mode === 'MISSIONS' || this.seated;
    const fi = this.flight.input;
    fi.t.set(0, 0, 0); fi.r.set(0, 0, 0); fi.brake = false;
    if (flying && !(this.flightCam === 'free' && !this.seated)) {
      fi.t.set(I.axis('back', 'fwd'), I.axis('down', 'up'), I.axis('left', 'right'));
      fi.r.set(I.axis('rollLeft', 'rollRight') * -1, I.axis('yawRight', 'yawLeft'), I.axis('pitchDown', 'pitchUp') * -1);
      if (I.held('throttleUp')) fi.throttle = Math.min(1, fi.throttle + h * 0.6);
      if (I.held('throttleDown')) fi.throttle = Math.max(0, fi.throttle - h * 0.9);
      fi.brake = I.held('brake');
      if (this.mode === 'SANDBOX' && (I.held('fire') || (this.touchFire && performance.now() - this.touchFire < 150))) {
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        if (this.sandbox.fire(this.camera.position.clone().add(this.interp.pos), dir, this.flight.state.vel)) this.audio.pulse();
      }
      this.flight.rcsArmed = this.systems.on('RCS');
      this.flight.mainArmed = this.systems.on('MAIN');
    } else fi.throttle = Math.max(0, fi.throttle - h);
    if (this.flightCam === 'free' && flying && !this.seated) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.freeCam.pitch, this.freeCam.yaw, 0, 'YXZ'));
      const mv = new THREE.Vector3(I.axis('left', 'right'), I.axis('down', 'up'), -I.axis('back', 'fwd')).applyQuaternion(q);
      this.freeCam.pos.addScaledVector(mv, h * (I.held('boost') ? 40 : 10));
    }
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
    const mechAct = Math.max(this.model.stepMechs(dt), this.interior.loaded ? this.interior.stepMechs(dt) : 0);
    this.model.setMech('dock:ring', this.systems.on('DOCK') && !this.flight.docked ? 0 : -0.26);
    if (this.airlock === 'depress' || this.airlock === 'repress') {
      this.airlockT += dt;
      if (this.airlockT > 6) {
        if (this.airlock === 'depress') { this.airlock = 'vac'; this.model.setMech('hatch:alk_out', -1.75); this.audio.hatch(true); this.toast('Esclusa en vacío: escotilla exterior abierta'); }
        else { this.airlock = 'pres'; this.model.setMech('hatch:alk_out', 0); this.audio.beep('ok'); this.toast('Esclusa presurizada'); }
      }
    }
    // transiciones EVA a través de la esclusa (fondo del pozo ↔ exterior bajo la escotilla)
    if (this.mode === 'INTERIOR' && this.player.pos.y - this.player.eyeH > -2.3) this.evaExitArmed = true;
    if (this.mode === 'INTERIOR' && this.airlock === 'vac' && this.evaExitArmed) {
      const [px, py, pz] = t2b(this.player.pos);
      if (pz - this.player.eyeH < -2.95 + 0.2 && Math.hypot(px - 11.05, py) < 0.6) {
        this.player.eva = true;
        this.evaBody.pos.copy(b2t(11.05, 0, -4.0)); this.evaBody.vel.set(0, 0, -0.3).applyQuaternion(new THREE.Quaternion()); this.evaBody.jetFuel = 1;
        this.evaReturnArmed = false;
        this.evaBody.yaw = this.player.yaw; this.evaBody.pitch = -0.6;
        this.mode = 'EVA'; this.camera.fov = 70; this.camera.updateProjectionMatrix();
        this.audio.comms('Alción, EVA iniciada. Línea de seguridad conectada.'); this.emitSnap();
      }
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
        const nn = rel.normalize();
        const vn = this.flight.state.vel.dot(nn);
        if (vn < 0) { this.flight.state.vel.addScaledVector(nn, -vn * 1.5); this.audio.thud(0.8); this.systems.alert('collision', 'alarm', 'Contacto con ' + o.label); }
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
    if (this.pendingGrab && this.mech.armBusy === 0) {
      this.pendingGrab = false;
      const tipW = this.mech.tip().applyQuaternion(this.interp.q).add(this.interp.pos);
      if (tipW.distanceTo(this.canister.pos) < 0.9) { this.mech.grabbed = 'canister'; this.audio.thud(0.6); this.toast('Cápsula capturada'); }
    }
    if (this.sandbox.active) { const hh = this.sandbox.update(dt, this.interp.pos); if (hh) this.audio.burst(); }
    if (this.explodeAnim) {
      const a = this.explodeAnim;
      const k = clamp((performance.now() - a.t0) / a.dur, 0, 1);
      const v = a.a + (a.b - a.a) * easeInOut(k);
      this.model.setExplode(v); this.interiorExplode(v);
      if (k >= 1) this.explodeAnim = null;
    }
    const inside = this.mode === 'INTERIOR' || this.seated;
    this.audio.update({
      fans: this.systems.on('FANS') ? 1 : 0, power: this.systems.sw.BAT ? 1 : 0,
      thrust: Math.max(this.flight.throttle, this.flight.rcsActivity * 0.4), mech: Math.max(armAct, mechAct),
      inside, suit: this.mode === 'EVA', zone: this.currentAcousticZone(),
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

  // ------------------------------------------------------------------ escena por fotograma
  private updateScene(dt: number) {
    const root = this.model.root;
    root.position.set(0, 0, 0);
    root.quaternion.copy(this.interp.q);
    root.updateMatrixWorld(true);
    SHIP_INV.value.copy(root.matrixWorld).invert();
    this.model.applyTransforms();
    for (const o of this.objects) o.group.position.copy(o.pos).sub(this.interp.pos);
    this.updateCamera(dt);
    this.camera.updateMatrixWorld();
    this.updateVisibility();
    if (this.mode === 'INTERIOR' || this.seated) this.hoverCtl = this.ctlAt(); else this.hoverCtl = null;
    this.updateHands(dt);
    // iluminación
    const indoor = this.mode === 'INTERIOR' || this.seated;
    this.lighting.update({
      dt, near: this.near, renderer: this.renderer, sunDir: this.astro.sunDir, earthDir: this.earthDirWorld(), earthAngRad: this.earthAngularRadius(),
      eclipse: this.astro.eclipse, isLunar: this.scenario === 'lunar', indoor, reducedMotion: this.reducedMotion,
    });
    this.fitShadow(indoor);
    this.pipeline.exposure = this.lighting.exposure;
    this.cockpit.updateLights(this.systems);
    const viewer = this.viewerLocal();
    if (this.interiorReady && (this.interior.root.visible)) this.cockpit.draw(performance.now() / 1000, this.systems, this.telemetry(), viewer);
    this.fx.updatePlumes(this.mode as any, this.model, this.flight, this.systems);
    this.fx.updateTether(this.mode === 'EVA', root, this.evaBody.pos);
    this.fx.updateDamageMarker(this.mode as any, this.model, this.systems, this.damagedPanel, this.interp.q);
    const camKm = this.shipKm().add(this.camera.position.clone().divideScalar(1000));
    this.astro.update(dt, camKm, this.camera.getWorldQuaternion(new THREE.Quaternion()), this.camera.fov, this.camera.aspect, 1, this.renderer.getPixelRatio());
    this.fx.updateLabels(this.mode as any, this.labels, this.model, this.camera, this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight, (n) => this.select(n, true));
  }

  /** Manos: ancladas a los controladores físicos al pilotar; alcance real al interactuar; ocultas el resto del tiempo. */
  private updateHands(dt: number) {
    const fp = this.mode === 'INTERIOR' || this.seated || this.mode === 'EVA';
    this.hands.group.visible = fp;
    if (!fp) return;
    this.hands.setEVA(this.mode === 'EVA');
    this.hands.hideAll();
    if (this.seated) {
      const s = Math.sign(this.seatSide);
      const root = this.model.root;
      const L = root.localToWorld(b2t(7.80, s * 0.78 + 0.30, -0.24));
      const R = root.localToWorld(b2t(7.80, s * 0.78 - 0.30, -0.24));
      this.hands.anchor(0, this.camera.worldToLocal(L.clone()), 0.82);
      this.hands.anchor(1, this.camera.worldToLocal(R.clone()), 0.9);
    }
    this.hands.update(dt, this.camera, this.reducedMotion);
  }

  /** Perfil de visibilidad explícito por modo (sin herencias entre modos). */
  private updateVisibility() {
    const firstPerson = this.mode === 'INTERIOR' || this.seated;
    const eng = this.mode === 'ENGINEERING';
    const camLocal = this.viewerLocal();
    // interior: siempre en primera persona; desde fuera sólo si la cámara está cerca (se ve por las ventanas)
    this.projM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);
    const sph = new THREE.Sphere();
    const winInView = (reachScale: number) => this.windows.some((w, i) => {
      sph.copy(w).applyMatrix4(this.model.root.matrixWorld);
      return w.center.distanceTo(camLocal) < this.windowReach[i] * reachScale && this.frustum.intersectsSphere(sph);
    });
    // interior: siempre en primera persona y en ingeniería; desde fuera sólo si se ve por una ventana cercana
    const intOn = this.interiorReady && (firstPerson || eng || this.mode === 'EVA' || (camLocal.length() < 30 && winInView(4)));
    this.interior.root.visible = intOn;
    if (intOn) this.interior.cullSmall(camLocal, firstPerson ? 4.0 : eng ? 1e9 : 12);
    // exterior desde dentro: sólo si alguna ventana cercana está dentro del campo de visión
    const extOn = firstPerson ? winInView(1) : true;
    if (extOn !== this.extVisible) { this.extVisible = extOn; this.model.setShown(extOn); this.renderer.shadowMap.needsUpdate = true; }
    this.model.setInteriorVisibility(false, true);
    this.model.updateVisibility();
    if (!extOn) this.model.setShown(false);
    for (const o of this.objects) o.group.visible = o.group.visible && (!firstPerson || extOn || o.id === 'canister');
  }

  /**
   * Sombra solar: encuadre ajustado a la estancia en primera persona (texel ≈ 4 mm) o a la nave
   * en exterior. Se regenera sólo cuando cambian sol, actitud, mecanismos o encuadre.
   */
  private fitShadow(indoor: boolean) {
    const L = this.lighting.sunLight;
    const sc = L.shadow.camera as THREE.OrthographicCamera;
    const center = indoor ? this.model.root.localToWorld(this.player.pos.clone()) : new THREE.Vector3();
    const half = indoor ? 3.2 : 22;
    const sunW = this.astro.sunDir;
    L.position.copy(center).addScaledVector(sunW, indoor ? 20 : 80);
    L.target.position.copy(center);
    L.target.updateMatrixWorld();
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.5; sc.far = indoor ? 40 : 160; sc.updateProjectionMatrix(); }
    L.shadow.bias = indoor ? -0.0004 : -0.00015;
    L.shadow.normalBias = indoor ? 0.012 : 0.03;
    const q = this.interp.q;
    const cx = indoor ? Math.round(center.x * 4) / 4 : 0, cz = indoor ? Math.round(center.z * 4) / 4 : 0, cy = indoor ? Math.round(center.y * 4) / 4 : 0;
    const key = `${indoor}|${sunW.x.toFixed(3)},${sunW.y.toFixed(3)},${sunW.z.toFixed(3)}|${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}|${cx},${cy},${cz}|${this.model.lastMatrixWrites > 0}|${this.extVisible}`;
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      if (indoor) { L.position.set(cx, cy, cz).addScaledVector(sunW, 20); L.target.position.set(cx, cy, cz); L.target.updateMatrixWorld(); }
      this.renderer.shadowMap.needsUpdate = true;
    }
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
    if (this.mode === 'ENGINEERING') { this.camera.near = 0.05; this.camera.updateProjectionMatrix(); this.controls.update(); return; }
    if (this.mode === 'CINEMATIC') { this.cinematic(dt); return; }
    if (this.mode === 'INTERIOR') {
      if (this.camera.near !== 0.03) { this.camera.near = 0.03; this.camera.updateProjectionMatrix(); }
      const bob = this.reducedMotion ? new THREE.Vector3() : this.player.bob.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
      this.camera.position.copy(root.localToWorld(this.player.pos.clone().add(bob)));
      this.camera.quaternion.copy(this.interp.q).multiply(this.player.viewQuat());
      return;
    }
    if (this.mode === 'EVA') {
      this.camera.position.copy(root.localToWorld(this.evaBody.pos.clone()));
      this.camera.quaternion.copy(this.interp.q).multiply(this.evaBody.viewQuat());
      return;
    }
    if (this.seated) {
      const head = b2t(7.66, this.seatSide, 0.16);
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
      [b2t(22, -9, 4.5), b2t(17, -6, 5.5), b2t(10, 0, 0.8), b2t(10, 0, 0.6)],
      [b2t(-12, -16, -7), b2t(-20, -6, -9), b2t(-3, 0, -1), b2t(-1, 0, -1)],
      [b2t(6, 34, 12), b2t(-6, 36, 8), b2t(3, 0, 0), b2t(2, 0, 0)],
      [b2t(15, 6, 6.5), b2t(11, 8, 5), b2t(9.5, 0, 1.0), b2t(8, 0, 1.5)],
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

  private renderFrame() {
    if (this.section.on) this.clipPlane.copy(this.clipPlaneLocal).applyMatrix4(this.model.root.matrixWorld);
    else { this.clipPlane.normal.set(0, 1, 0); this.clipPlane.constant = 1e9; }
    this.pipeline.debug = this.debug;
    this.pipeline.beginFrame();
    const r = this.renderer;
    // las sombras se regeneran dentro de la pasada cercana sólo si shadowMap.needsUpdate (ver fitShadow)
    const shadowMs = r.shadowMap.needsUpdate ? 1 : 0;
    // cámaras de instrumentos (cada 3 fotogramas) — sin bucle de realimentación: las pantallas se ocultan
    const tc = performance.now();
    // cámaras de instrumentos alternadas (nariz en un fotograma, brazo en otro; cada una a ~10 Hz)
    this.camFrame = (this.camFrame + 1) % 6;
    if ((this.camFrame === 0 || this.camFrame === 3) && (this.cockpit.wantsCam || this.cockpit.wantsArmCam) && this.liveScreenInView()) this.renderScreenCams(this.camFrame === 0 ? 'nose' : 'arm');
    this.pipeline.accumulate();
    const camsMs = performance.now() - tc;
    this.pipeline.render({ scene: this.astro.scene, camera: this.astro.camera }, { scene: this.near, camera: this.camera });
    const p = this.statsCache.passes;
    p.shadow = damp(p.shadow, shadowMs, 5, 0.1); p.cams = damp(p.cams, camsMs, 5, 0.1);
    this.camsMs = camsMs;
  }

  /** ¿Hay alguna pantalla con imagen de cámara cerca y dentro del campo de visión? */
  private liveScreenInView() {
    if (!this.interior.root.visible) return false;
    const sph = new THREE.Sphere();
    const camW = this.camera.position;
    return this.cockpit.screens.some((sc) => {
      const pg = sc.pages[sc.page];
      if (pg !== 'CAM' && pg !== 'ARMCAM') return false;
      if (!sc.mesh.geometry.boundingSphere) sc.mesh.geometry.computeBoundingSphere();
      sph.copy(sc.mesh.geometry.boundingSphere!).applyMatrix4(sc.mesh.matrixWorld);
      return sph.center.distanceTo(camW) < 4.5 && this.frustum.intersectsSphere(sph);
    });
  }

  private renderScreenCams(which: 'nose' | 'arm') {
    const r = this.renderer;
    const armTip = this.mech.tip().clone().add(b2t(0.25, 0, 0.18));
    this.cockpit.placeCams(this.model.root, armTip);
    const hidden: THREE.Object3D[] = [];
    for (const s of this.cockpit.screens) if (s.mesh.visible) { s.mesh.visible = false; hidden.push(s.mesh); }
    const intVis = this.interior.root.visible;
    this.interior.root.visible = false;
    const extShown = this.extVisible;
    if (!extShown) this.model.setShown(true);
    for (const [cam, rt, want, id] of [[this.cockpit.noseCam, this.cockpit.camRT, this.cockpit.wantsCam, 'nose'], [this.cockpit.armCam, this.cockpit.armRT, this.cockpit.wantsArmCam, 'arm']] as const) {
      if (!want || id !== which) continue;
      const camKm = this.shipKm().add(cam.position.clone().divideScalar(1000));
      this.astro.update(0, camKm, cam.quaternion, cam.fov, cam.aspect, 1, 1);
      r.setRenderTarget(rt);
      r.clear(true, true, true);
      r.render(this.astro.scene, this.astro.camera);
      r.clearDepth();
      r.render(this.near, cam);
    }
    r.setRenderTarget(null);
    for (const o of hidden) o.visible = true;
    this.interior.root.visible = intVis;
    if (!extShown) this.model.setShown(false);
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

  // ------------------------------------------------------------------ instantánea para la interfaz
  subscribe(fn: (s: Snapshot) => void) { this.listeners.add(fn); fn(this.snapshot()); return () => { this.listeners.delete(fn); }; }
  emitSnap() { if (!this.listeners.size) return; const t = performance.now(); const s = this.snapshot(); this.listeners.forEach((f) => f(s)); this.statsCache.passes.ui = damp(this.statsCache.passes.ui, performance.now() - t, 5, 0.1); }

  frameStats(): FrameStats {
    const st = this.statsCache;
    const n = Math.min(this.frameHistN, this.frameHist.length);
    if (n > 10) {
      const arr = Array.from(this.frameHist.subarray(0, n)).sort((a, b) => a - b);
      const q = (p: number) => arr[Math.min(n - 1, Math.floor(p * (n - 1)))];
      st.p50 = q(0.5); st.p95 = q(0.95); st.p99 = q(0.99);
    }
    st.ms = st.p50;
    st.cpu = this.cpuMs;
    st.gpu = this.gpu.ms;
    st.calls = this.pipeline.frameInfo.calls;
    st.tris = this.pipeline.frameInfo.triangles;
    st.dpr = this.renderer.getPixelRatio();
    st.batches = this.model.stats.batches;
    st.instances = this.model.stats.instances;
    st.matrixWrites = this.model.lastMatrixWrites;
    const t = this.pipeline.timings;
    st.passes.far = t.far; st.passes.near = t.near; st.passes.bloom = t.bloom; st.passes.final = t.final; st.passes.sim = this.simMs;
    const mem = this.renderer.info.memory;
    st.mem.geo = mem.geometries; st.mem.tex = mem.textures; st.mem.progs = this.renderer.info.programs?.length ?? 0;
    return st;
  }

  snapshot(): Snapshot {
    const s = this.flight.state;
    const tel = this.ready ? this.telemetry() : null;
    const alt = this.astro.altitude(this.shipKm());
    const orbit = tel?.orbit ?? this.flight.computeOrbit(alt.body, alt.km);
    if (this.toastMsg && performance.now() > this.toastMsg.until) this.toastMsg = null;
    const hc = this.hoverCtl;
    return {
      mode: this.mode, flightCam: this.flightCam, ready: this.ready, interiorReady: this.interiorReady, progress: this.prog,
      speed: s.vel.length(), vel: tel ? [tel.vel.x, tel.vel.y, tel.vel.z] : [0, 0, 0], w: s.w.length(), throttle: this.flight.throttle, assist: this.flight.assist,
      thrustScale: this.flight.thrustScale, docked: this.flight.docked, altKm: alt.km, body: alt.body, eclipse: this.astro.eclipse, orbit,
      seated: this.seated, eva: this.player.eva, airlock: this.airlock, jetFuel: this.player.jetFuel,
      prompt: this.activity ? ACTIVITIES[this.activity.id].doing : hc ? hc.label : null,
      promptKind: hc ? hc.ctl.split(':')[0] : null,
      holdProgress: this.activity ? this.activity.t / ACTIVITIES[this.activity.id].dur : this.holdT,
      crew: { needs: { ...this.crew.needs }, clock: this.crew.clockText(), samples: this.crew.samples, stored: this.crew.stored, log: [...this.crew.log], freeExplore: this.crew.freeExplore },
      activity: this.activity ? { label: ACTIVITIES[this.activity.id].doing, p: this.activity.t / ACTIVITIES[this.activity.id].dur } : null,
      fade: this.fade, locomotion: this.player.locomotion, crouch: this.player.crouch, climbing: this.player.climbing,
      room: this.mode === 'INTERIOR' ? ROOMS[this.interior.roomAt(this.player.pos)]?.label ?? '' : this.seated ? ROOMS.A.label : '',
      systems: this.systems.snapshot(), alerts: this.systems.alerts.slice(0, 4).map((a) => ({ level: a.level, text: a.text })),
      mission: this.missions.current(), missionsDone: [...this.missions.done],
      sandbox: this.sandbox.active ? { score: this.sandbox.score, streak: this.sandbox.streak, shots: this.sandbox.shots } : null,
      stats: this.frameStats(),
      dock: tel?.dock ?? null, targets: tel?.targets ?? [],
      explode: this.model.explode, explodePreset: this.model.explodePreset, xray: this.model.xray, section: this.section.on, hudHidden: this.hudHidden,
      toast: this.toastMsg?.t ?? null, scenario: this.scenario, inspect: this.inspect, arm: this.mech.joints.map((j) => j.angle), armGrabbed: this.mech.grabbed,
      quality: this.quality, debug: this.debug,
    };
  }

  // ------------------------------------------------------------------ persistencia
  save() {
    if (!this.ready || !this.restored) return;
    writeSave({
      v: 4 as any, scenario: this.scenario, mode: this.mode === 'MISSIONS' ? 'FLIGHT' : this.mode, flightCam: this.flightCam,
      seated: this.seated, seatSide: this.seatSide, airlock: this.airlock === 'vac' ? 'vac' : 'pres',
      flight: this.flight.serialize(), systems: this.systems.snapshot(), player: this.player.serialize() as any, crew: this.crew.serialize(),
      missionsDone: [...this.missions.done], arm: this.mech.joints.map((j) => j.angle), armGrabbed: this.mech.grabbed,
      mechs: Object.fromEntries([...this.interior.mechs.entries()].filter(([id]) => /^(hatch|locker)/.test(id)).map(([id, n]) => [id, n.mech!.target])),
    });
  }

  restore() {
    const o = readSave();
    if (!o) return false;
    try {
      this.setScenario(o.scenario ?? 'leo', true);
      if (o.flight) this.flight.deserialize(o.flight);
      if (o.systems) this.systems.load(o.systems as any);
      if (o.player && (o as any).v >= 4) this.player.deserialize(o.player);
      if (o.crew) this.crew.deserialize(o.crew);
      (o.missionsDone ?? []).forEach((d: string) => this.missions.done.add(d));
      this.airlock = o.airlock === 'vac' || o.airlock === 'pres' ? o.airlock : 'pres';
      for (const [id, v] of Object.entries(o.mechs ?? {})) this.interior.setMech(id, v as number, true);
      for (const [id, on] of Object.entries(this.systems.sw)) this.interior.setMech('sw:' + id, on ? 0.45 : -0.45, true);
      if (Array.isArray(o.arm) && o.arm.length === this.mech.joints.length) this.mech.joints.forEach((j, i) => { j.angle = j.target = o.arm![i]; });
      if (o.armGrabbed !== undefined) this.mech.grabbed = o.armGrabbed;
      if (typeof o.seatSide === 'number') this.seatSide = Math.sign(o.seatSide) * 0.78 || 0.78;
      if (o.flightCam) this.flightCam = o.flightCam;
      if (o.seated) this.sit(this.seatSide > 0 ? 1 : 2);
      else if (o.mode === 'INTERIOR' && (o as any).v >= 4 && this.insideInterior(this.player.pos) && this.player.free(this.player.pos)) { this.mode = 'INTERIOR'; this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix(); this.player.settle(); }
      else if (o.mode === 'FLIGHT' || o.mode === 'ENGINEERING' || o.mode === 'SANDBOX') this.setMode(o.mode);
      this.toast('Estado restaurado');
      return true;
    } catch { return false; }
  }

  resetState() {
    clearSave();
    this.systems = new Systems(false);
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.setScenario(this.scenario);
    for (const [id, on] of Object.entries(this.systems.sw)) this.interior.setMech('sw:' + id, on ? 0.45 : -0.45, true);
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
      locomotion: this.player.locomotion, freeExplore: this.crew.freeExplore, fov: this.fovPref, ...extra,
    });
  }

  setFov(f: number) { this.fovPref = clamp(f, 60, 95); if (this.mode === 'INTERIOR' || this.seated) { this.camera.fov = this.fovPref; this.camera.updateProjectionMatrix(); } this.saveSettings(); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.input.dispose();
    this.hands.dispose();
    this.lighting.dispose();
    this.interior.dispose();
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
    this.pipeline.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelsLayer.remove();
  }
}
