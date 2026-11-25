/**
 * ALCIÓN · BEYOND ORBIT — motor de simulación.
 *
 * Dos escenas con origen flotante:
 *  - escena lejana (km): Tierra, Luna, Sol y estrellas (Astro), cámara en el origen;
 *  - escena cercana (m): nave y objetos, con el origen en la posición de la nave.
 * Las posiciones absolutas se guardan en doble precisión (JS) y solo se envían a la
 * GPU coordenadas relativas pequeñas.
 * La simulación (vuelo, sistemas, tripulante) avanza con paso fijo y el
 * renderizado interpola.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, OutlineEffect, BlendFunction, Effect, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Astro, ScenarioId } from './world/Astro';
import { buildStation, buildSatellite, buildCanister, WorldObject } from './world/Props';
import { ShipModel, PartNode, SECTION } from './ship/ShipModel';
import { Mechanisms } from './ship/Mechanisms';
import { Systems, SwitchId, SWITCH_LABEL } from './ship/Systems';
import { Cockpit, Telemetry } from './ship/Cockpit';
import { Flight } from './sim/Flight';
import { Player } from './player/Player';
import { Input } from './Input';
import { Audio } from './Audio';
import { Crew, ACTIVITIES, type ActivityId } from './sim/Crew';
import { Hands } from './player/Hands';
import { MissionRunner } from './Missions';
import { Sandbox } from './Sandbox';
import { b2t, clamp, damp, easeInOut, easeOut, stageOf, t2b } from './util';

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
  cabina: { label: 'Cabina de vuelo', pos: [6.35, 0, 0.35], look: [8.8, 0, -0.2] },
  lab: { label: 'Laboratorio', pos: [4.3, 0.3, 0.45], look: [6.6, -0.9, -0.5] },
  cq: { label: 'Habitáculos', pos: [3.65, -0.4, 0.4], look: [3.65, 1.4, -0.2] },
  servicios: { label: 'Servicios', pos: [2.7, 0.3, 0.45], look: [0.9, -0.6, -0.3] },
  nodo: { label: 'Nodo de proa', pos: [10.25, 0, 0.1], look: [12.2, 0, 0.0] },
  cupula: { label: 'Cúpula', pos: [11.0, 0, 0.75], look: [11.15, 0.1, 2.4] },
  esclusa: { label: 'Esclusa', pos: [11.05, 0, -0.4], look: [11.05, 0, -2.6] },
};

export interface Snapshot {
  mode: Mode; flightCam: FlightCam; ready: boolean; interiorReady: boolean; progress: { stage: string; p: number };
  speed: number; vel: [number, number, number]; w: number; throttle: number; assist: boolean; thrustScale: number; docked: string | null;
  altKm: number; body: string; eclipse: number; seated: boolean; eva: boolean; airlock: string; jetFuel: number;
  prompt: string | null; holdProgress: number;
  crew: { needs: Crew['needs']; clock: string; samples: number; stored: number; log: string[] }; activity: { label: string; p: number } | null; fade: number;
  locomotion: 'walk' | 'float'; crouch: boolean; climbing: boolean; systems: ReturnType<Systems['snapshot']>; alerts: { level: string; text: string }[];
  mission: ReturnType<MissionRunner['current']>; missionsDone: string[]; sandbox: { score: number; streak: number; shots: number } | null;
  stats: { fps: number; ms: number; calls: number; tris: number; dpr: number; batches: number; instances: number };
  dock: Telemetry['dock']; targets: Telemetry['targets']; explode: number; xray: boolean; section: boolean; hudHidden: boolean; toast: string | null;
  scenario: ScenarioId; inspect: { label: string; desc: string } | null; arm: number[]; armGrabbed: string | null;
}

export class Engine {
  // núcleo
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
  /** posición absoluta (m) del origen del mundo «cercano» respecto al centro de la Tierra */
  shipKm0 = new THREE.Vector3();
  // estado
  mode: Mode = 'CINEMATIC';
  flightCam: FlightCam = 'chase';
  seated = false;
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
  private sunLight = new THREE.DirectionalLight(0xfff6ea, 3.2);
  private earthLight = new THREE.HemisphereLight(0x8fb4ff, 0x000000, 0.2);
  private exposure = 1;
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
  private freeCam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private chaseQ = new THREE.Quaternion();
  private cine = { shot: 0, t: 0 };
  private holdT = 0;
  private hoverCtl: { node: PartNode; ctl: string } | null = null;
  crew = new Crew();
  /** manos y antebrazos en primera persona */
  hands = new Hands();
  /** actividad en curso (bloquea el movimiento mientras dura) */
  activity: { id: ActivityId; t: number } | null = null;
  /** fundido a negro (dormir) 0..1 */
  fade = 0;
  private nadirBox: THREE.Box3 | null = null;
  private plumes = new THREE.Group();
  private tether: THREE.Line;
  private labelsLayer: HTMLDivElement;
  private labelEls = new Map<string, HTMLDivElement>();
  labels = true;
  private clipPlaneLocal = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private clipPlane = new THREE.Plane();
  section = { on: false, axis: 'y' as 'x' | 'y' | 'z', pos: 0, flip: false };
  private explodeAnim: null | { a: number; b: number; t0: number; dur: number } = null;
  private camAnim: null | { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; s: number; dur: number } = null;
  private damagedPanel = 'HAB.MMOD.R2.P14';
  private markers = new THREE.Group();
  onSelect: (n: PartNode | null) => void = () => {};

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
    this.near.add(this.model.root, this.sandbox.group, this.plumes, this.markers);
    this.model.root.add(this.cockpit.lights);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    const sc = this.sunLight.shadow.camera as THREE.OrthographicCamera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
    this.sunLight.shadow.bias = -0.00015; this.sunLight.shadow.normalBias = 0.02;
    this.near.add(this.sunLight, this.sunLight.target, this.earthLight);
    for (const o of [this.station.obj, this.satellite.obj, this.canister]) { this.objects.push(o); this.near.add(o.group); }
    const tg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3()));
    this.tether = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xe8e0c8 }));
    this.tether.frustumCulled = false; this.tether.visible = false;
    this.near.add(this.tether);
    this.near.add(this.hands.group);
    this.buildPlumes();
    this.setupComposer();
    this.applyQuality(this.loadSettings()?.quality ?? (matchMedia('(max-width: 860px)').matches ? 'baja' : 'alta'));
    const loco = this.loadSettings()?.locomotion; if (loco === 'walk' || loco === 'float') this.player.locomotion = loco;
    this.player.onStep = (k) => this.audio.footstep(k);
    window.addEventListener('resize', this.resize);
    this.bindPointer();
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- composición
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
    this.n8ao.configuration.aoRadius = 0.6;
    this.n8ao.configuration.distanceFalloff = 0.5;
    this.n8ao.configuration.intensity = 2.0;
    this.n8ao.configuration.gammaCorrection = false;
    this.composer.addPass(this.n8ao);
    this.outline = new OutlineEffect(this.near, this.camera, {
      blendFunction: BlendFunction.SCREEN, edgeStrength: 3, pulseSpeed: 0, visibleEdgeColor: 0xe2572b, hiddenEdgeColor: 0x6a2410, xRay: true, blur: true, resolutionScale: 0.75,
    } as any);
    this.bloom = new BloomEffect({ intensity: 0.35, luminanceThreshold: 1.3, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vig = new VignetteEffect({ offset: 0.32, darkness: 0.38 });
    this.composer.addPass(new EffectPass(this.camera, this.outline, this.exposureFx, this.bloom, tone, vig));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    this.near.environment = this.buildEnv();
    (this.near as any).environmentIntensity = 0.8;
  }

  /** Mapa de entorno para reflejos: negro espacial, Sol y resplandor terrestre. */
  private buildEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const earthDir = this.earthDirWorld();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: { ed: { value: earthDir }, ea: { value: this.earthAngularRadius() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vP; uniform vec3 ed; uniform float ea; void main(){ float c = dot(normalize(vP), normalize(ed)); float e = smoothstep(cos(ea*1.05), cos(ea*0.9), c);
        vec3 col = mix(vec3(0.004,0.005,0.008), vec3(0.20,0.30,0.48), e); gl_FragColor = vec4(col, 1.0);} `,
    }));
    s.add(sph);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(40) }));
    sun.position.copy(this.astro.sunDir).multiplyScalar(45); sun.lookAt(0, 0, 0); s.add(sun);
    const tex = pm.fromScene(s, 0).texture;
    pm.dispose();
    return tex;
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
    this.sunLight.shadow.mapSize.set(ms, ms);
    this.sunLight.shadow.map?.dispose(); (this.sunLight.shadow as any).map = null;
    this.bloom.intensity = q === 'baja' ? 0.25 : 0.45;
    this.resize();
  }

  resize = () => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.n8ao?.setSize?.(w, h);
  };

  // ---------------------------------------------------------------- carga
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
      this.setSection(false); // asigna el plano de corte (inactivo) a los materiales interiores
      this.player.buildColliders();
      this.restore();
      this.emitSnap();
    });
  }

  setScenario(id: ScenarioId, initial = false) {
    this.scenario = id;
    const sc = this.astro.scenarios().find((s) => s.id === id)!;
    this.shipKm0.copy(sc.shipKm);
    // orientación inicial: proa hacia la órbita, cenit alejándose del cuerpo central
    const upAway = id === 'lunar' ? sc.shipKm.clone().sub(this.astro.moonPos).normalize() : sc.shipKm.clone().normalize();
    const fwd = new THREE.Vector3(0, 1, 0).cross(upAway).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0);
    const right = fwd.clone().cross(upAway).normalize();
    const m = new THREE.Matrix4().makeBasis(fwd, upAway, right);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.flight.teleport(new THREE.Vector3(0, 0, 0), q);
    this.flight.docked = null;
    // objetos del mundo cerca de la nave
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);
    this.station.obj.pos.copy(P(260, 15, -60));
    this.station.obj.group.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.satellite.obj.pos.copy(P(-120, 40, 160));
    this.canister.pos.copy(P(40, 22, 18));
    this.canister.group.visible = true;
    this.near.environment = this.buildEnv();
    if (!initial) this.toast(`Escenario: ${sc.label}`);
  }

  // ---------------------------------------------------------------- utilidades geométricas
  earthDirWorld() { return this.shipKm0.clone().negate().normalize(); }
  earthAngularRadius() { return Math.asin(Math.min(1, 6371 / this.shipKm0.length())); }
  shipKm() { return this.shipKm0.clone().add(this.flight.state.pos.clone().divideScalar(1000)); }
  /** Posición del observador en espacio de nave (three). */
  viewerLocal(): THREE.Vector3 {
    if (this.mode === 'INTERIOR' || this.mode === 'EVA') return this.player.pos.clone();
    return this.model.root.worldToLocal(this.camera.position.clone());
  }

  placeNear(id: string, dist: number) {
    const o = this.objects.find((x) => x.id === id);
    if (!o) return;
    const s = this.flight.state;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(s.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.q);
    if (id === 'tesela') {
      // el puerto de la estación mira hacia la nave
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

  // ---------------------------------------------------------------- modos
  setMode(m: Mode) {
    const prev = this.mode;
    this.mode = m;
    this.input.unlock();
    this.controls.enabled = false;
    this.inspect = null;
    this.model.hideExteriorSkin = false;
    if (m !== 'ENGINEERING') {
      if (this.model.explode > 0) this.model.setExplode(0);
      if (this.model.xray) this.model.setXray(false);
      this.model.select(null); this.model.setIsolate(null); this.setSection(false);
    }
    if (m !== 'SANDBOX' && this.sandbox.active) this.sandbox.stop();
    if (m === 'ENGINEERING' || m === 'CINEMATIC') {
      this.controls.enabled = m === 'ENGINEERING';
      this.camera.fov = 32;
      if (prev === 'INTERIOR' || prev === 'EVA' || !this.ready || prev === 'FLIGHT' || prev === 'SANDBOX') this.flyOrbit(new THREE.Vector3(26, 9, 30), new THREE.Vector3(2.5, -0.5, 0), 1200);
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

  /** Cámara orbital animada (espacio de nave → mundo). */
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
    const dirs: Record<string, THREE.Vector3> = { iso: new THREE.Vector3(0.7, 0.42, 0.62), front: new THREE.Vector3(1, 0, 0), rear: new THREE.Vector3(-1, 0, 0), side: new THREE.Vector3(0, 0.0001, 1), top: new THREE.Vector3(0.0001, 1, 0), bottom: new THREE.Vector3(0.0001, -1, 0) };
    const c = b2t(2, 0, 0);
    this.flyOrbit(c.clone().addScaledVector(dirs[v].normalize(), 48), c, 1100);
  }

  // ---------------------------------------------------------------- ingeniería
  setExplode(t: number, animate = false) {
    if (animate) this.explodeAnim = { a: this.model.explode, b: t, t0: performance.now(), dur: this.reducedMotion ? 1 : 1600 };
    else { this.explodeAnim = null; this.model.setExplode(t); }
  }
  /** Animación de ensamblaje: de piezas sueltas a nave completa. */
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
    // El plano de corte permanece siempre asignado (inactivo = desplazado al infinito):
    // así activar la sección no cambia la clave de programa y no hay recompilación
    // de sombreadores (antes ~3,5 s de parón con SwiftShader). Sólo los materiales
    // de una cara cambian de variante al pasar a doble cara para dibujar las tapas.
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

  // ---------------------------------------------------------------- interacción
  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      this.audio.start();
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.camAnim && this.mode === 'ENGINEERING') this.camAnim = null;
      if ((this.mode === 'INTERIOR' || this.mode === 'EVA' || (this.mode !== 'ENGINEERING' && this.mode !== 'CINEMATIC' && (this.flightCam === 'free' || this.flightCam === 'cockpit'))) && e.pointerType === 'mouse') this.input.lock();
    });
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
    });
    el.addEventListener('mousemove', (e) => {
      if (this.mode !== 'ENGINEERING' || e.buttons) return;
      const hit = this.pickAt(e.clientX, e.clientY);
      el.style.cursor = hit ? 'pointer' : 'grab';
      this.hoverNode = hit?.node ?? null;
      this.hoverXY = [e.clientX, e.clientY];
    });
  }
  hoverNode: PartNode | null = null;
  hoverXY: [number, number] = [0, 0];

  private ray = new THREE.Raycaster();
  pickAt(cx?: number, cy?: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = cx === undefined ? new THREE.Vector2(0, 0) : new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -(((cy ?? 0) - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    this.ray.far = this.mode === 'ENGINEERING' ? 1000 : 2.6;
    return this.model.pick(this.ray);
  }

  /** Control interactivo bajo la retícula (o el puntero). */
  private ctlAt(cx?: number, cy?: number): { node: PartNode; ctl: string } | null {
    const hit = this.pickAt(cx, cy);
    if (!hit) return null;
    let n: PartNode | null = hit.node;
    for (let m: PartNode | null = n; m; m = m.parent) if (m.ctl) return { node: m, ctl: m.ctl };
    const act = this.activityFor(hit.node.code);
    if (act) return { node: hit.node, ctl: 'act:' + act };
    while (n) { if (n.inspect) return { node: n, ctl: 'inspect' }; n = n.parent; }
    // tareas de mantenimiento
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
    // la mano alcanza el punto tocado (excepto las actividades, que tienen su propia pose)
    if ((this.mode === 'INTERIOR' || this.mode === 'EVA') && !c.ctl.startsWith('act:')) {
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

  // ---------------------------------------------------------------- vida a bordo
  /** Actividad asociada a la pieza bajo la retícula. */
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
    // observación de la Tierra: por la cúpula o por las ventanas de nadir del laboratorio
    let looking = false;
    if (this.mode === 'INTERIOR' && !this.activity) {
      const view = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.viewQuat());
      const [x, y, z] = t2b(this.player.pos);
      if (!this.nadirBox) { const n = this.model.nodes.get('HAB.INT.B.NAD'); this.nadirBox = n ? this.model.currentBox(n).clone().expandByScalar(0.9) : new THREE.Box3(); }
      const nb = this.nadirBox, pp = this.player.pos;
      const overNadir = !nb.isEmpty() && pp.x > nb.min.x && pp.x < nb.max.x && pp.z > nb.min.z && pp.z < nb.max.z;   // en planta, a cualquier altura
      const nearWindow = (Math.hypot(x - 11.05, y) < 0.9 && z > -0.2) || overNadir;
      looking = nearWindow && view.dot(this.mech.earthLocal) > 0.7;
    }
    if (live) this.crew.step(dt, { inCupolaLookingAtEarth: looking }, (m) => { this.toast(m); this.audio.beep('info'); });
    // actividad en curso
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
    this.emitSnap();
  }
  private seatSide = 0.62;
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

  // ---------------------------------------------------------------- fotografía
  private pendingPhoto = false;
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
    // comprobaciones de misión
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
    const inCupola = this.mode === 'INTERIOR' && t2b(this.player.pos)[2] > 1.0 && Math.abs(t2b(this.player.pos)[0] - 11.05) < 0.7;
    if (inCupola) {
      const toEarth = this.earthDirWorld();
      const toMoon = this.astro.moonPos.clone().sub(this.shipKm()).normalize();
      if (camW.angleTo(toEarth) < this.earthAngularRadius() + 0.5 || camW.angleTo(toMoon) < 0.4) { this.scienceShot = true; this.toast('Fotografía científica registrada'); }
    }
  }

  // ---------------------------------------------------------------- bucle
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
    // telemetría
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsAcc.n++;
    if (now - this.fpsAcc.t > 1000) { this.fpsAcc.fps = Math.round((this.fpsAcc.n * 1000) / (now - this.fpsAcc.t)); this.fpsAcc.n = 0; this.fpsAcc.t = now; this.adaptResolution(); }
    this.snapT += dt;
    if (this.snapT > 0.1) { this.snapT = 0; this.emitSnap(); }
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.save(); }
  };

  /** Un paso de simulación + actualización de escena (sin dibujar). */
  private simStep(dt: number) {
    this.handleInput(dt);
    const alpha = this.flight.advance(dt);
    this.flight.interp(alpha, this.interp);
    this.stepWorld(dt);
    this.missions.update(this, dt);
    this.updateScene(dt);
  }

  /**
   * Avance determinista de la simulación sin renderizar (pruebas automatizadas
   * y validación): `seconds` de tiempo simulado en pasos de `h`.
   */
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
      if (I.locked && this.flightCam === 'cockpit') { /* el ratón mira dentro de la cabina */ }
      else if (I.locked) { fi.r.y += clamp(-I.mouseDX * 0.02 * I.sensitivity, -1, 1); fi.r.z += clamp(-I.mouseDY * 0.02 * I.sensitivity * (I.invertY ? -1 : 1), -1, 1); }
      if (I.held('throttleUp')) fi.throttle = Math.min(1, fi.throttle + dt * 0.6);
      if (I.held('throttleDown')) fi.throttle = Math.max(0, fi.throttle - dt * 0.9);
      fi.brake = I.held('brake');
      if (I.hit('assist')) { this.flight.assist = !this.flight.assist; this.toast(this.flight.assist ? 'Modo asistido' : 'Modo manual (newtoniano)'); this.audio.click(true); }
      if (I.hit('camera') && !this.seated) { const order: FlightCam[] = ['chase', 'orbit', 'free']; this.flightCam = order[(order.indexOf(this.flightCam) + 1) % order.length]; if (this.flightCam === 'free') { this.freeCam.pos.copy(this.camera.position); } this.toast(`Cámara: ${{ chase: 'persecución', orbit: 'exterior orbital', free: 'libre', cockpit: 'cabina' }[this.flightCam]}`); }
      if (this.mode === 'SANDBOX' && (I.held('fire') || (this.touchFire && performance.now() - this.touchFire < 150))) {
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        if (this.sandbox.fire(this.camera.position.clone().add(this.interp.pos), dir, this.flight.state.vel)) this.audio.pulse();
      }
      if (this.seated && I.hit('exit')) this.standUp();
      if (this.seated && I.hit('interact')) this.tryInteract();
      // la orientación del armado/sistemas condiciona el control
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
        // durante una actividad el tripulante permanece en su sitio (moverse la cancela)
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
  touchFire = 0;

  private stepWorld(dt: number) {
    // sistemas
    const ecl = this.astro.eclipse;
    const metab = this.activity ? (ACTIVITIES[this.activity.id].metabolic ?? 1) - 1 : 0;
    this.systems.step(dt, { sunFactor: 1 - ecl, wingsDeployed: 1, thrust: this.flight.throttle, sep: 0, rcsUse: this.flight.rcsActivity, hgaError: this.mech.hgaError(), crew: 4 + metab });
    this.stepCrew(dt);
    // mecanismos especiales (dirección Sol/Tierra en espacio de nave)
    const qInv = this.interp.q.clone().invert();
    this.mech.sunLocal.copy(this.astro.sunDir).applyQuaternion(qInv);
    this.mech.earthLocal.copy(this.earthDirWorld()).applyQuaternion(qInv);
    this.mech.armPowered = this.systems.on('RBT');
    this.mech.hgaTracking = this.systems.on('COMM');
    this.mech.sunTracking = this.systems.on('SOLAR');
    const armAct = this.mech.update(dt);
    const mechAct = this.model.stepMechs(dt);
    this.model.setMech('dock:ring', this.systems.on('DOCK') && !this.flight.docked ? 0 : -0.26);
    // esclusa
    if (this.airlock === 'depress' || this.airlock === 'repress') {
      this.airlockT += dt;
      if (this.airlockT > 6) {
        if (this.airlock === 'depress') { this.airlock = 'vac'; this.model.setMech('hatch:alk_out', -1.75); this.audio.hatch(true); this.toast('Esclusa en vacío: escotilla exterior abierta'); }
        else { this.airlock = 'pres'; this.audio.beep('ok'); this.toast('Esclusa presurizada'); }
      }
    }
    // transición interior ↔ EVA por la escotilla exterior
    const [px, py, pz0] = t2b(this.player.pos);
    // en modo caminar se usan los pies (los ojos quedan 1,6 m por encima)
    const pz = this.mode === 'INTERIOR' && this.player.locomotion === 'walk' ? pz0 - this.player.eyeH + 0.05 : pz0;
    if (this.mode === 'INTERIOR' && this.airlock === 'vac' && pz < -3.25 && Math.hypot(px - 11.05, py) < 0.6) {
      this.player.eva = true; this.mode = 'EVA'; this.camera.fov = 70; this.camera.updateProjectionMatrix();
      this.player.pos.copy(b2t(11.05, 0, -3.9)); this.player.jetFuel = 1; this.audio.comms('Alción, EVA iniciada. Línea de seguridad conectada.'); this.emitSnap();
    } else if (this.mode === 'EVA' && pz > -3.6 && pz < -2.2 && Math.hypot(px - 11.05, py) < 0.55) {
      this.player.eva = false; this.mode = 'INTERIOR'; this.player.pos.copy(b2t(11.05, 0, -2.8)); this.player.vel.set(0, 0, 0); this.audio.comms('Bienvenido a bordo.'); this.emitSnap();
    }
    // atraque
    if (!this.flight.docked && this.systems.on('DOCK')) {
      const d = this.dockInfo();
      if (d.range < 0.6 && d.angle < 6 && d.closing < 0.25) {
        this.flight.docked = 'tesela';
        this.audio.thud(1); this.audio.comms('Captura confirmada. Alción atracada en Tesela.'); this.toast('Captura: atracado en la estación Tesela');
      }
    }
    // colisiones simples con objetos (esferas)
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
    // objetos del mundo
    for (const o of this.objects) {
      o.pos.addScaledVector(o.vel, dt);
      o.group.rotation.x += o.spin.x * dt; o.group.rotation.y += o.spin.y * dt; o.group.rotation.z += o.spin.z * dt;
    }
    // cápsula capturada: viaja con el efector
    if (this.mech.grabbed === 'canister') {
      this.canister.pos.copy(this.mech.tip()).applyQuaternion(this.interp.q).add(this.interp.pos);
      this.canister.vel.set(0, 0, 0); this.canister.spin.set(0, 0, 0);
    }
    if (this.sandbox.active) { const h = this.sandbox.update(dt, this.interp.pos); if (h) this.audio.burst(); }
    // audio
    const inside = this.mode === 'INTERIOR' || this.seated;
    this.audio.update({ fans: this.systems.on('FANS') ? 1 : 0, power: this.systems.sw.BAT ? 1 : 0, thrust: Math.max(this.flight.throttle, this.flight.rcsActivity * 0.4), mech: Math.max(armAct, mechAct), inside, suit: this.mode === 'EVA' });
    if (this.flight.rcsActivity > 0.3 && Math.random() < dt * 6) this.audio.rcs();
  }

  /** Orden de captura del brazo: IK hacia la cápsula si está al alcance. */
  armCapture() {
    if (!this.systems.on('RBT')) { this.toast('Brazo sin alimentación (RBT)'); return; }
    const local = this.canister.pos.clone().sub(this.interp.pos).applyQuaternion(this.interp.q.clone().invert());
    const err = this.mech.solveIK(local);
    if (err < 0.5) { this.toast('Brazo en ruta de captura'); this.pendingGrab = true; }
    else { this.toast(`Fuera de alcance (${err.toFixed(1)} m)`); this.audio.beep('warn'); }
  }
  private pendingGrab = false;

  private updateScene(dt: number) {
    // nave en el origen del renderizado
    this.model.root.position.set(0, 0, 0);
    this.model.root.quaternion.copy(this.interp.q);
    this.model.root.updateMatrixWorld(true);
    if (this.pendingGrab && this.mech.armBusy === 0) {
      this.pendingGrab = false;
      const tipW = this.mech.tip().applyQuaternion(this.interp.q).add(this.interp.pos);
      if (tipW.distanceTo(this.canister.pos) < 0.9) { this.mech.grabbed = 'canister'; this.audio.thud(0.6); this.toast('Cápsula capturada'); }
    }
    // explosión animada
    if (this.explodeAnim) {
      const a = this.explodeAnim;
      const k = clamp((performance.now() - a.t0) / a.dur, 0, 1);
      this.model.setExplode(a.a + (a.b - a.a) * easeInOut(k));
      if (k >= 1) this.explodeAnim = null;
    }
    this.model.hideExteriorSkin = (this.mode === 'INTERIOR' || (this.seated && this.flightCam === 'cockpit'));
    const camLocal = this.model.root.worldToLocal(this.camera.position.clone());
    this.model.showInterior = this.mode === 'ENGINEERING' || this.mode === 'INTERIOR' || this.seated || camLocal.length() < 30 || this.model.explode > 0;
    this.model.markVisDirty();
    this.model.applyTransforms();
    this.model.updateVisibility();
    // objetos (origen flotante)
    for (const o of this.objects) o.group.position.copy(o.pos).sub(this.interp.pos);
    // cámara
    this.updateCamera(dt);
    // manos en primera persona (después de colocar la cámara)
    const fp = this.mode === 'INTERIOR' || this.mode === 'EVA';
    this.hands.group.visible = fp;
    if (fp) {
      this.hands.setEVA(this.mode === 'EVA');
      const a = this.activity;
      this.hands.setActivity(a ? a.id : null, a ? a.t / ACTIVITIES[a.id].dur : 0, !!this.player.grabbing, this.mode === 'EVA');
      this.hands.update(dt, this.camera, this.reducedMotion);
    }
    // luces
    const ecl = this.astro.eclipse;
    this.sunLight.intensity = 3.4 * (1 - ecl);
    this.sunLight.position.copy(this.astro.sunDir).multiplyScalar(80);
    this.sunLight.target.position.set(0, 0, 0);
    const ed = this.earthDirWorld();
    const earthPhase = clamp(0.5 + 0.5 * this.astro.sunDir.dot(ed.clone().negate()), 0, 1);
    const altK = this.earthAngularRadius() / (Math.PI / 2);
    this.earthLight.position.copy(ed);
    this.earthLight.intensity = 0.05 + 0.9 * altK * earthPhase * (this.scenario === 'lunar' ? 0.25 : 1);
    const interiorActive = this.mode === 'INTERIOR' || this.seated || (this.mode === 'ENGINEERING' && this.model.explode === 0) || this.mode === 'EVA';
    this.cockpit.updateLights(this.systems, interiorActive ? this.viewerLocal() : null, interiorActive || camLocal.length() < 25, this.airlock);
    // pantallas
    this.cockpit.draw(performance.now() / 1000, this.systems, this.telemetry(), this.viewerLocal());
    // plumas RCS y motores
    this.updatePlumes();
    // cordón de seguridad en EVA
    this.tether.visible = this.mode === 'EVA';
    if (this.tether.visible) {
      const a = this.model.root.localToWorld(b2t(11.05 + 0.6, 0, -3.3));
      const b = this.model.root.localToWorld(this.player.pos.clone()).add(new THREE.Vector3(0, -0.4, 0));
      const pos = this.tether.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const t = i / (pos.count - 1); const p = a.clone().lerp(b, t); const sag = Math.sin(Math.PI * t) * Math.min(1.2, a.distanceTo(b) * 0.12); p.y -= sag; pos.setXYZ(i, p.x, p.y, p.z); }
      pos.needsUpdate = true;
    }
    // marcador del panel dañado (EVA)
    this.updateMarkers();
    // exposición adaptativa (no instantánea)
    const indoor = this.mode === 'INTERIOR' || (this.seated && this.flightCam === 'cockpit');
    const target = indoor ? 1.4 : ecl > 0.5 ? 2.6 : 1.0;
    this.exposure = damp(this.exposure, target, this.reducedMotion ? 20 : 1.6, dt);
    this.exposureFx.value = this.exposure;
    (this.near as any).environmentIntensity = damp((this.near as any).environmentIntensity ?? 0.8, indoor ? 0.14 : 0.8, 3, dt);
    // AO de contacto más marcado en interiores (espacios estrechos, juntas y huecos de bastidor)
    this.n8ao.configuration.aoRadius = indoor ? 0.9 : 0.6;
    this.n8ao.configuration.intensity = indoor ? 3.2 : 2.0;
    // escena lejana
    const camKm = this.shipKm().add(this.camera.position.clone().divideScalar(1000));
    this.astro.update(dt, camKm, this.camera.getWorldQuaternion(new THREE.Quaternion()), this.camera.fov, this.camera.aspect, 1, this.renderer.getPixelRatio());
    // etiquetas de ingeniería
    this.updateLabels();
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
    // vuelo / sandbox
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
    // libre: la cámara se queda en el espacio (no sigue a la nave)
    this.freeCam.pos.sub(this.interp.vel.clone().multiplyScalar(dt));
    this.camera.position.copy(this.freeCam.pos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.freeCam.pitch, this.freeCam.yaw, 0, 'YXZ'));
  }

  /** Director de fotografía: planos lentos alrededor de la nave. */
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
    // sombras del Sol: caja centrada en la cámara si está cerca, en la nave si no
    this.sunLight.shadow.camera.updateProjectionMatrix();
    // cámaras de las pantallas (render-to-texture, a ritmo reducido)
    this.camFrame = (this.camFrame + 1) % 4;
    if (this.camFrame === 0 && (this.cockpit.wantsCam || this.cockpit.wantsArmCam)) this.renderScreenCams();
    this.outline.selection.set(this.model.proxies.children as THREE.Object3D[]);
    this.renderer.info.reset();
    this.composer.render(dt);
  }
  private camFrame = 0;

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

  // ---------------------------------------------------------------- efectos
  private plumeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private hallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.7, 3.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private engineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private buildPlumes() {
    const cone = new THREE.ConeGeometry(0.12, 1.2, 16, 1, true); cone.translate(0, -0.6, 0);
    const quads: [number, number, number, number][] = [];
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) { quads.push([8.35, a, 2.26, 1]); quads.push([-4.05, a, 2.2, -1]); }
    for (const [x, a, r] of quads) {
      for (const dir of [1, -1]) {
        const m = new THREE.Mesh(cone, this.plumeMat);
        const p = b2t(x + dir * 0.2, r * Math.cos(a), r * Math.sin(a));
        m.position.copy(p);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(dir, 0, 0).normalize());
        m.userData.dir = dir;
        this.model.root.add(m);
        this.plumeMeshes.push(m);
      }
    }
    const big = new THREE.ConeGeometry(0.28, 3.2, 24, 1, true); big.translate(0, -1.6, 0);
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
      const m = new THREE.Mesh(big, this.engineMat);
      m.position.copy(b2t(-6.35, 0.95 * Math.cos(a), 0.95 * Math.sin(a)));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(-1, 0, 0).normalize());
      this.model.root.add(m);
    }
    const hall = new THREE.ConeGeometry(0.16, 2.4, 20, 1, true); hall.translate(0, -1.2, 0);
    for (const s of [1, -1]) for (const z of [0.2, -0.2]) {
      const m = new THREE.Mesh(hall, this.hallMat);
      m.position.copy(b2t(-5.6, s * 2.62, z));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(-1, 0, 0).normalize());
      this.model.root.add(m);
    }
  }
  private plumeMeshes: THREE.Mesh[] = [];
  private updatePlumes() {
    const f = this.flight;
    const vis = this.mode !== 'ENGINEERING' && this.model.explode === 0;
    const fwd = f.rcsFiring.x;
    this.plumeMat.opacity = vis ? Math.min(0.55, f.rcsActivity * 0.55) : 0;
    for (const m of this.plumeMeshes) m.visible = vis && f.rcsActivity > 0.05 && (Math.abs(fwd) < 0.1 || Math.sign(-fwd) === m.userData.dir || f.rotFiring.lengthSq() > 0.01);
    this.engineMat.opacity = vis ? f.throttle * 0.35 : 0;
    this.hallMat.opacity = vis && this.systems.on('SEP') && f.throttle > 0 ? 0.3 : 0;
  }

  private updateMarkers() {
    const show = this.systems.active('mmod_panel');
    if (show && this.markers.children.length === 0) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.2), toneMapped: false, side: THREE.DoubleSide }));
      this.markers.add(ring);
    }
    this.markers.visible = show && (this.mode === 'EVA' || this.mode === 'FLIGHT' || this.mode === 'CINEMATIC');
    if (show) {
      const n = this.model.nodes.get(this.damagedPanel);
      if (n) {
        const c = this.model.currentBox(n).getCenter(new THREE.Vector3());
        const out = c.clone().setX(0).normalize();
        const p = this.model.root.localToWorld(c.clone().addScaledVector(out, 0.03));
        const ring = this.markers.children[0];
        ring.position.copy(p);
        ring.quaternion.copy(this.interp.q).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out));
        ring.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 200));
      }
    }
  }

  private updateLabels() {
    const want: PartNode[] = [];
    const m = this.model;
    if (this.mode === 'ENGINEERING' && this.labels && m.top) {
      const sel = m.selected;
      if (sel && sel.children.length && sel.depth >= 1) want.push(...sel.children);
      else if (!sel) { want.push(...m.top.children); if (m.explode > 0.4) want.push(...(m.nodes.get('HAB')?.children ?? [])); }
    }
    const keep = new Set(want.map((n) => n.code));
    for (const [code, el] of this.labelEls) if (!keep.has(code)) { el.remove(); this.labelEls.delete(code); }
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    for (const n of want.slice(0, 40)) {
      if (n.sector === 'int' && !m.interiorLoaded) continue;
      let el = this.labelEls.get(n.code);
      if (!el) {
        el = document.createElement('div');
        el.className = 'label3d';
        el.innerHTML = `<span class="dot"></span><span class="txt">${n.label}</span>`;
        el.onclick = (e) => { e.stopPropagation(); this.select(n, true); };
        this.labelsLayer.appendChild(el);
        this.labelEls.set(n.code, el);
      }
      const v = m.currentBox(n).getCenter(new THREE.Vector3()).applyMatrix4(m.root.matrixWorld).project(this.camera);
      el.style.opacity = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 ? '1' : '0';
      el.style.transform = `translate3d(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px, 0)`;
    }
  }

  // ---------------------------------------------------------------- telemetría
  telemetry(): Telemetry {
    const s = this.flight.state;
    const qInv = s.q.clone().invert();
    const targets = this.objects.filter((o) => o.group.visible).map((o) => {
      const rel = o.pos.clone().sub(s.pos);
      const range = Math.max(0, rel.length() - o.radius);
      return { label: o.label, range, rate: -s.vel.dot(rel.normalize()), bearing: rel.clone().applyQuaternion(qInv).normalize() };
    });
    const alt = this.astro.altitude(this.shipKm());
    const dock = this.rangeTo('tesela') < 400 ? this.dockInfo() : null;
    const mc = this.missions.current();
    return {
      vel: s.vel.clone().applyQuaternion(qInv), w: s.w, q: s.q, throttle: this.flight.throttle, assist: this.flight.assist, rcsArmed: this.flight.rcsArmed,
      mainArmed: this.flight.mainArmed, altKm: alt.km, body: alt.body, eclipse: this.astro.eclipse, targets, dock,
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
    const info = this.renderer.info.render;
    if (this.toastMsg && performance.now() > this.toastMsg.until) this.toastMsg = null;
    return {
      mode: this.mode, flightCam: this.flightCam, ready: this.ready, interiorReady: this.interiorReady, progress: this.prog,
      speed: s.vel.length(), vel: tel ? [tel.vel.x, tel.vel.y, tel.vel.z] : [0, 0, 0], w: s.w.length(), throttle: this.flight.throttle, assist: this.flight.assist,
      thrustScale: this.flight.thrustScale, docked: this.flight.docked, altKm: alt.km, body: alt.body, eclipse: this.astro.eclipse, seated: this.seated, eva: this.player.eva,
      airlock: this.airlock, jetFuel: this.player.jetFuel, prompt: this.activity ? ACTIVITIES[this.activity.id].doing : this.hoverCtl ? this.ctlLabel(this.hoverCtl) : null, holdProgress: this.activity ? this.activity.t / ACTIVITIES[this.activity.id].dur : this.holdT,
      crew: { needs: { ...this.crew.needs }, clock: this.crew.clockText(), samples: this.crew.samples, stored: this.crew.stored, log: [...this.crew.log] }, activity: this.activity ? { label: ACTIVITIES[this.activity.id].doing, p: this.activity.t / ACTIVITIES[this.activity.id].dur } : null, fade: this.fade,
      locomotion: this.player.locomotion, crouch: this.player.crouch, climbing: this.player.climbing,
      systems: this.systems.snapshot(), alerts: this.systems.alerts.slice(0, 4).map((a) => ({ level: a.level, text: a.text })),
      mission: this.missions.current(), missionsDone: [...this.missions.done],
      sandbox: this.sandbox.active ? { score: this.sandbox.score, streak: this.sandbox.streak, shots: this.sandbox.shots } : null,
      stats: { fps: this.fpsAcc.fps, ms: this.frameMs, calls: info.calls, tris: info.triangles, dpr: this.renderer.getPixelRatio(), batches: this.model.stats.batches, instances: this.model.stats.instances },
      dock: tel?.dock ?? null, targets: tel?.targets ?? [], explode: this.model.explode, xray: this.model.xray, section: this.section.on, hudHidden: this.hudHidden,
      toast: this.toastMsg?.t ?? null, scenario: this.scenario, inspect: this.inspect, arm: this.mech.joints.map((j) => j.angle), armGrabbed: this.mech.grabbed,
    };
  }

  // ---------------------------------------------------------------- persistencia
  save() {
    if (!this.ready) return;
    try {
      localStorage.setItem('alcion-bo-save', JSON.stringify({
        v: 2, scenario: this.scenario, flight: this.flight.serialize(), systems: this.systems.snapshot(), player: this.player.serialize(), crew: this.crew.serialize(),
        missionsDone: [...this.missions.done], airlock: this.airlock, seated: this.seated, mode: this.mode === 'MISSIONS' ? 'FLIGHT' : this.mode,
        mechs: Object.fromEntries([...this.model.mechs.entries()].filter(([id]) => /^(hatch|shutter)/.test(id)).map(([id, n]) => [id, n.mech!.target])),
      }));
    } catch { /* almacenamiento no disponible */ }
  }
  restore() {
    try {
      const raw = localStorage.getItem('alcion-bo-save');
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (o.v !== 2) return false;
      this.setScenario(o.scenario ?? 'leo', true);
      this.flight.deserialize(o.flight);
      this.systems.load(o.systems);
      this.player.deserialize(o.player);
      this.crew.deserialize(o.crew);
      (o.missionsDone ?? []).forEach((d: string) => this.missions.done.add(d));
      this.airlock = o.airlock === 'vac' || o.airlock === 'pres' ? o.airlock : 'pres';
      for (const [id, v] of Object.entries(o.mechs ?? {})) this.model.setMech(id, v as number, true);
      for (const [id, on] of Object.entries(this.systems.sw)) this.model.setMech('sw:' + id, on ? 0.45 : -0.45, true);
      this.toast('Estado restaurado');
      return true;
    } catch { return false; }
  }
  resetState() {
    try { localStorage.removeItem('alcion-bo-save'); } catch { /* */ }
    this.systems = new Systems(false);
    this.systems.listeners.push((a) => { this.audio.beep(a.level === 'alarm' ? 'alarm' : a.level === 'warn' ? 'warn' : 'info'); });
    this.setScenario(this.scenario);
    for (const [id, on] of Object.entries(this.systems.sw)) this.model.setMech('sw:' + id, on ? 0.45 : -0.45, true);
    this.mech.grabbed = null; this.mech.setPose('stow');
    this.airlock = 'pres';
    this.setMode('CINEMATIC');
  }
  loadSettings(): any { try { return JSON.parse(localStorage.getItem('alcion-bo-settings') ?? 'null'); } catch { return null; } }
  saveSettings(extra: Record<string, unknown> = {}) {
    try { localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: this.quality, bindings: this.input.bindings, invertY: this.input.invertY, sens: this.input.sensitivity, volume: this.audio.volume, sound: this.audio.mode, reduced: this.reducedMotion, dynamicRes: this.dynamicRes, locomotion: this.player.locomotion, ...extra })); } catch { /* */ }
  }

  dispose() { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize); this.renderer.dispose(); }
}

export { stageOf };
