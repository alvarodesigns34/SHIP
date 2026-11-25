/**
 * Motor de visualización del ALCIÓN HX-4 (three.js imperativo).
 *
 * - Carga progresiva: exterior inmediato, interior diferido (injertado en sus
 *   nodos padre HAB / FWD).
 * - Vista explosionada jerárquica: cada nodo lleva en `extras.ex` su vector de
 *   separación respecto a su padre (ejes Blender) y en `extras.depth` su nivel.
 *   El desplazamiento de un nodo se activa en una ventana del deslizador según
 *   su nivel, de modo que la nave se descompone por capas:
 *   módulos → sistemas → conjuntos → piezas.
 * - Renderizado bajo demanda: solo se dibuja cuando algo cambia.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode,
  OutlineEffect, BlendFunction, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { enhanceMaterial } from './materials';
import { makeStarfield } from './textures';

export type LightingPreset = 'lunar' | 'sun' | 'studio' | 'technical';
export type Quality = 'alta' | 'media' | 'baja';
export type Axis = 'x' | 'y' | 'z';

export interface PartNode {
  code: string;
  label: string;
  desc: string;
  func: string;
  kind: 'group' | 'part';
  depth: number;
  obj: THREE.Object3D;
  parent: PartNode | null;
  children: PartNode[];
  ex: THREE.Vector3;
  base: THREE.Vector3;
  center0: THREE.Vector3;
  box0: THREE.Box3;
  meshes: THREE.Mesh[];
  materials: { name: string; desc: string }[];
  tris: number;
  parts: number;
  interior: boolean;
  hidden: boolean;
}

export interface ViewerEvents {
  onProgress?: (stage: string, p: number) => void;
  onReady?: () => void;
  onInteriorReady?: () => void;
  onSelect?: (n: PartNode | null) => void;
  onHover?: (n: PartNode | null, x: number, y: number) => void;
  onStats?: (s: { fps: number; calls: number; tris: number }) => void;
  onWalkChange?: (on: boolean) => void;
}

/** Blender (Z arriba) → three (Y arriba). */
export const b2t = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

const STAGES: Record<number, [number, number]> = { 1: [0, 0.25], 2: [0.2, 0.5], 3: [0.45, 0.75], 4: [0.7, 0.92] };
export function stageOf(depth: number, t: number) {
  const w = STAGES[depth] ?? [0.82, 1.0];
  let k = (t - w[0]) / (w[1] - w[0]);
  k = Math.min(1, Math.max(0, k));
  return k * k * (3 - 2 * k);
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const INTERIOR_ROOTS = new Set(['HAB.INT', 'HAB.UTL', 'FWD.INT']);

export const WAYPOINTS: { id: string; label: string; pos: THREE.Vector3; look: THREE.Vector3 }[] = [
  { id: 'cabina', label: 'Cabina de vuelo', pos: b2t(6.35, 0, 0.45), look: b2t(8.8, 0, -0.25) },
  { id: 'lab', label: 'Laboratorio', pos: b2t(4.3, 0.35, 0.5), look: b2t(6.6, -0.9, -0.55) },
  { id: 'cq', label: 'Habitáculos', pos: b2t(3.65, -0.45, 0.45), look: b2t(3.65, 1.4, -0.25) },
  { id: 'servicios', label: 'Servicios y soporte vital', pos: b2t(2.75, 0.45, 0.5), look: b2t(0.9, -0.7, -0.35) },
  { id: 'nodo', label: 'Nodo de proa', pos: b2t(10.2, 0, -0.35), look: b2t(12.2, 0, 0.1) },
  { id: 'cupula', label: 'Cúpula', pos: b2t(11.0, 0, 0.55), look: b2t(11.15, 0, 2.3) },
];

export class Viewer {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer!: EffectComposer;
  n8ao!: any;
  outline!: OutlineEffect;
  bloom!: BloomEffect;
  smaaPass!: EffectPass;
  model = new THREE.Group();
  nodes = new Map<string, PartNode>();
  root: PartNode | null = null;
  events: ViewerEvents;
  labelsLayer: HTMLDivElement;

  explode = 0;
  selected: PartNode | null = null;
  xray = false;
  isolate: PartNode | null = null;
  labels = true;
  guides = true;
  section = { on: false, axis: 'y' as Axis, pos: 0, flip: false };
  quality: Quality = 'alta';
  lighting: LightingPreset = 'lunar';
  walk = false;
  interiorLoaded = false;

  private dirty = true;
  private raf = 0;
  private tween: null | { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3; curve?: THREE.CatmullRomCurve3; tcurve?: THREE.CatmullRomCurve3; ease: (t: number) => number; done?: () => void; fov0?: number; fov1?: number } = null;
  private explodeTween: null | { t0: number; dur: number; a: number; b: number } = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pickables: THREE.Mesh[] = [];
  private smallMeshes: { m: THREE.Mesh; r: number; c: THREE.Vector3 }[] = [];
  private sun = new THREE.DirectionalLight(0xfff4e8, 3.2);
  private hemi = new THREE.HemisphereLight(0x9aa4b4, 0x6b6b70, 0.25);
  private fill = new THREE.DirectionalLight(0x9db4ff, 0.25);
  private stars = makeStarfield();
  private moon: THREE.Mesh | null = null;
  private envMaps: Partial<Record<LightingPreset, THREE.Texture>> = {};
  private pmrem: THREE.PMREMGenerator;
  private xrayMat: THREE.ShaderMaterial;
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private guideLines: THREE.LineSegments;
  private labelEls = new Map<string, HTMLDivElement>();
  private lastFrame = performance.now();
  private frames = 0;
  private fpsT = performance.now();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private walkVel = new THREE.Vector3();
  private story: null | { p: number } = null;
  private autoOrbit = false;

  constructor(container: HTMLElement, events: ViewerEvents = {}) {
    this.container = container;
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.info.autoReset = false;
    RectAreaLightUniformsLib.init();
    this.buildInteriorLights();

    this.camera = new THREE.PerspectiveCamera(32, container.clientWidth / container.clientHeight, 0.05, 6000);
    this.camera.position.set(34, 14, 40);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 220;
    this.controls.target.set(2.5, 0, 0);
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.add(this.model);
    this.scene.add(this.stars);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.fill);

    this.xrayMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x9fb6d4) }, power: { value: 2.2 }, base: { value: 0.025 } },
      vertexShader: `
        #include <common>
        #include <clipping_planes_pars_vertex>
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `
        #include <clipping_planes_pars_fragment>
        uniform vec3 color; uniform float power; uniform float base;
        varying vec3 vN; varying vec3 vV;
        void main(){
          #include <clipping_planes_fragment>
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power);
          gl_FragColor = vec4(color * (f + base), (f * 0.55 + base));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, clipping: true,
    });

    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 400), 3));
    this.guideLines = new THREE.LineSegments(gg, new THREE.LineDashedMaterial({ color: 0xe2572b, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.55, depthWrite: false }));
    this.guideLines.frustumCulled = false;
    this.guideLines.visible = false;
    this.scene.add(this.guideLines);

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.className = 'labels-layer';
    container.appendChild(this.labelsLayer);

    this.setupComposer();
    this.setLighting('lunar');
    this.bindInput();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  // ---------------------------------------------------------------- composer
  private setupComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.n8ao = new N8AOPostPass(this.scene, this.camera, this.container.clientWidth, this.container.clientHeight);
    this.n8ao.configuration.aoRadius = 0.9;
    this.n8ao.configuration.distanceFalloff = 0.6;
    this.n8ao.configuration.intensity = 2.2;
    this.n8ao.configuration.halfRes = false;
    this.n8ao.configuration.gammaCorrection = false;
    this.composer.addPass(this.n8ao);
    this.outline = new OutlineEffect(this.scene, this.camera, {
      blendFunction: BlendFunction.SCREEN, edgeStrength: 3.2, pulseSpeed: 0, visibleEdgeColor: 0xe2572b, hiddenEdgeColor: 0x7a2a12,
      xRay: true, blur: true, resolutionScale: 0.75,
    } as any);
    this.bloom = new BloomEffect({ intensity: 0.65, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vig = new VignetteEffect({ offset: 0.3, darkness: 0.45 });
    this.composer.addPass(new EffectPass(this.camera, this.outline, this.bloom, tone, vig));
    this.smaaPass = new EffectPass(this.camera, new SMAAEffect());
    this.composer.addPass(this.smaaPass);
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio;
    this.renderer.setPixelRatio(q === 'alta' ? Math.min(dpr, 2) : q === 'media' ? Math.min(dpr, 1.5) : 1);
    this.n8ao.enabled = q !== 'baja';
    this.n8ao.configuration.halfRes = q === 'media';
    this.renderer.shadowMap.enabled = q !== 'baja';
    this.sun.shadow.mapSize.set(q === 'alta' ? 4096 : 2048, q === 'alta' ? 4096 : 2048);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.scene.traverse((o: any) => { if (o.material) [].concat(o.material).forEach((m: any) => (m.needsUpdate = true)); });
    this.onResize();
  }

  // ---------------------------------------------------------------- luces interiores (solo modo interior)
  private interiorLights = new THREE.Group();
  private buildInteriorLights() {
    // luminarias del techo: 2 por bahía, en las aristas superiores del pasillo (coordenadas Blender)
    const xs = [0.6, 2.65, 4.7, 6.75, 8.8];
    for (let i = 0; i < 4; i++) {
      const xc = (xs[i] + xs[i + 1]) / 2;
      for (const sy of [1, -1]) {
        const l = new THREE.RectAreaLight(0xfff1e0, 9, 1.5, 0.1);
        l.position.copy(b2t(xc, sy * 1.03, 1.03));
        l.lookAt(b2t(xc, sy * 0.2, 0.2));
        this.interiorLights.add(l);
      }
    }
    for (const x of [10.6, 11.6]) {
      const p = new THREE.PointLight(0xfff1e0, 2.5, 4, 2);
      p.position.copy(b2t(x, 0, 0.7));
      this.interiorLights.add(p);
    }
    this.interiorLights.visible = false;
    this.scene.add(this.interiorLights);
  }

  // ---------------------------------------------------------------- lighting
  private buildEnv(kind: LightingPreset) {
    if (this.envMaps[kind]) return this.envMaps[kind]!;
    let tex: THREE.Texture;
    if (kind === 'studio' || kind === 'technical') {
      tex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } else {
      // entorno espacial: hemisferio inferior con albedo lunar tenue, Sol como panel brillante
      const s = new THREE.Scene();
      const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { lunar: { value: kind === 'lunar' ? 1 : 0.15 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec3 vP; uniform float lunar;
          void main(){ float d = smoothstep(0.05, -0.6, vP.y); vec3 c = mix(vec3(0.004,0.005,0.008), vec3(0.24,0.235,0.23)*lunar, d);
          float h = smoothstep(0.02, 0.0, abs(vP.y+0.02))*0.04*lunar; gl_FragColor = vec4(c + vec3(h), 1.0);} `,
      }));
      s.add(sph);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(14) }));
      const d = this.sunDir().multiplyScalar(40);
      panel.position.copy(d);
      panel.lookAt(0, 0, 0);
      s.add(panel);
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(26, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.55, 0.65).multiplyScalar(0.25) }));
        p.position.set(-30 + i * 30, 25, 30 - i * 20);
        p.lookAt(0, 0, 0);
        s.add(p);
      }
      tex = this.pmrem.fromScene(s, 0).texture;
    }
    this.envMaps[kind] = tex;
    return tex;
  }

  private sunDir() {
    return new THREE.Vector3(0.55, 0.62, 0.56).normalize();
  }

  setLighting(kind: LightingPreset) {
    this.lighting = kind;
    const env = this.buildEnv(kind);
    this.scene.environment = env;
    const sd = this.sunDir();
    this.sun.position.copy(sd.clone().multiplyScalar(70)).add(new THREE.Vector3(2.5, 0, 0));
    this.sun.target.position.set(2.5, 0, 0);
    this.stars.visible = kind === 'lunar' || kind === 'sun';
    if (kind === 'lunar') {
      this.scene.background = new THREE.Color(0x000000);
      this.sun.intensity = 3.4; this.sun.color.set(0xfff3e6);
      this.hemi.intensity = 0.32; this.hemi.color.set(0x2a2d33); this.hemi.groundColor.set(0x8a8a8c);
      this.fill.intensity = 0.15;
      (this.scene as any).environmentIntensity = 0.9;
      this.ensureMoon(true);
    } else if (kind === 'sun') {
      this.scene.background = new THREE.Color(0x000000);
      this.sun.intensity = 4.2; this.sun.color.set(0xffffff);
      this.hemi.intensity = 0.04; this.fill.intensity = 0.0;
      (this.scene as any).environmentIntensity = 0.55;
      this.ensureMoon(false);
    } else if (kind === 'studio') {
      this.scene.background = new THREE.Color(0x1a1c20);
      this.sun.intensity = 2.2; this.sun.color.set(0xffffff);
      this.hemi.intensity = 0.6; this.hemi.color.set(0xdfe6f0); this.hemi.groundColor.set(0x30333a);
      this.fill.intensity = 0.6;
      (this.scene as any).environmentIntensity = 1.0;
      this.ensureMoon(false);
    } else {
      this.scene.background = new THREE.Color(0x0e2238);
      this.sun.intensity = 1.6; this.sun.color.set(0xffffff);
      this.hemi.intensity = 1.1; this.hemi.color.set(0xe8f0ff); this.hemi.groundColor.set(0x667088);
      this.fill.intensity = 0.8;
      (this.scene as any).environmentIntensity = 0.7;
      this.ensureMoon(false);
    }
    this.fill.position.set(-30, -20, -25);
    this.bloom && (this.bloom.intensity = kind === 'technical' ? 0.2 : 0.65);
    this.dirty = true;
  }

  private ensureMoon(on: boolean) {
    if (on && !this.moon) {
      const tex = new THREE.TextureLoader().load('textures/moon.jpg', () => (this.dirty = true));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1737, 128, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, envMapIntensity: 0 }));
      m.position.set(-900, -2600, -3200);
      m.rotation.set(0.4, 2.2, 0.1);
      m.receiveShadow = false;
      m.castShadow = false;
      m.userData.noPick = true;
      this.moon = m;
      this.scene.add(m);
    }
    if (this.moon) this.moon.visible = on;
  }

  // ---------------------------------------------------------------- loading
  async load(base = 'models/') {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const ext = await loader.loadAsync(base + 'alcion_hx4_exterior.glb', (e) => {
      this.events.onProgress?.('Estructura exterior', e.total ? e.loaded / e.total : 0);
    });
    this.ingest(ext.scene, false);
    this.events.onProgress?.('Preparando materiales', 1);
    this.compileScene();
    this.events.onReady?.();
    this.dirty = true;
    // carga diferida del interior
    loader.loadAsync(base + 'alcion_hx4_interior.glb').then((int) => {
      this.ingest(int.scene, true);
      this.interiorLoaded = true;
      this.applyExplode();
      this.applyXray();
      this.applySection();
      this.applyIsolate();
      this.events.onInteriorReady?.();
      this.dirty = true;
    });
  }

  private compileScene() {
    try { this.renderer.compile(this.scene, this.camera); } catch { /* opcional */ }
  }

  private ingest(gscene: THREE.Group, interior: boolean) {
    const rootObj = gscene.getObjectByName('ALCION') ?? gscene.children[0];
    if (!interior) {
      this.model.add(rootObj);
    } else {
      // injertar subárboles interiores en los grupos existentes
      for (const parentName of ['HAB', 'FWD']) {
        const src = gscene.getObjectByName(parentName);
        const dst = this.nodes.get(parentName)?.obj;
        if (!src || !dst) continue;
        for (const ch of [...src.children]) dst.add(ch);
      }
    }
    this.model.updateMatrixWorld(true);
    const targetRoot = interior ? null : rootObj;
    // registrar nodos
    const register = (o: THREE.Object3D, parent: PartNode | null, inInterior: boolean) => {
      const ud: any = o.userData ?? {};
      let node: PartNode | null = parent;
      if (ud.code && !this.nodes.has(ud.code)) {
        const exb = ud.ex ?? [0, 0, 0];
        node = {
          code: ud.code, label: ud.label ?? ud.code, desc: ud.desc ?? '', func: ud.func ?? '',
          kind: ud.kind === 'part' ? 'part' : 'group', depth: ud.depth ?? 0, obj: o, parent, children: [],
          ex: b2t(exb[0], exb[1], exb[2]), base: o.position.clone(), center0: new THREE.Vector3(), box0: new THREE.Box3(),
          meshes: [], materials: [], tris: 0, parts: 0, interior: inInterior || INTERIOR_ROOTS.has(ud.code), hidden: false,
        };
        this.nodes.set(ud.code, node);
        if (parent) parent.children.push(node);
        if (!parent) this.root = node;
      } else if (ud.code && this.nodes.has(ud.code)) {
        node = this.nodes.get(ud.code)!;
      }
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        enhanceMaterial(m);
        m.castShadow = true;
        m.receiveShadow = true;
        this.pickables.push(m);
        m.geometry.computeBoundingSphere();
        const r = m.geometry.boundingSphere!.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
        if (r < 0.22) {
          m.castShadow = r > 0.08;
          this.smallMeshes.push({ m, r, c: new THREE.Vector3() });
        }
      }
      for (const ch of o.children) register(ch, node, inInterior || (node ? node.interior : false));
    };
    if (targetRoot) register(targetRoot, null, false);
    else for (const pn of ['HAB', 'FWD']) {
      const p = this.nodes.get(pn)!;
      for (const ch of p.obj.children) if (!this.isRegistered(ch)) register(ch, p, true);
    }
    this.computeBoxes();
  }

  private isRegistered(o: THREE.Object3D) {
    const c = (o.userData as any)?.code;
    return c ? this.nodes.get(c)?.obj === o : false;
  }

  private computeBoxes() {
    // estado ensamblado
    const saved = this.explode;
    this.setExplodeRaw(0);
    this.model.updateMatrixWorld(true);
    const visit = (n: PartNode) => {
      n.box0.makeEmpty();
      n.meshes = [];
      n.materials = [];
      n.tris = 0;
      n.parts = n.kind === 'part' ? 1 : 0;
      const mats = new Map<string, string>();
      n.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // la malla pertenece a este nodo si su nodo propietario más cercano es n o un descendiente
        n.meshes.push(m);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
        n.box0.union(b);
        const idx = m.geometry.index;
        n.tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
        const mm = m.userData.origMat ?? m.material;
        const name = (mm as THREE.Material).name;
        if (name && !mats.has(name)) mats.set(name, (mm as any).userData?.desc ?? '');
      });
      n.materials = [...mats.entries()].map(([name, desc]) => ({ name, desc })).sort((a, b) => a.name.localeCompare(b.name));
      n.box0.getCenter(n.center0);
      for (const c of n.children) { visit(c); n.parts += c.parts; }
    };
    if (this.root) visit(this.root);
    this.setExplodeRaw(saved);
  }

  // ---------------------------------------------------------------- explode
  private setExplodeRaw(t: number) {
    this.explode = t;
    for (const n of this.nodes.values()) {
      const k = n.parent ? stageOf(n.depth, t) : 0;
      n.obj.position.copy(n.base).addScaledVector(n.ex, k);
    }
  }

  applyExplode() {
    this.setExplodeRaw(this.explode);
    this.model.updateMatrixWorld(true);
    this.updateGuides();
    this.dirty = true;
  }

  setExplode(t: number, animate = false, dur = 1400) {
    if (animate) {
      this.explodeTween = { t0: performance.now(), dur, a: this.explode, b: t };
    } else {
      this.explodeTween = null;
      this.explode = t;
      this.applyExplode();
    }
  }

  /** Centro actual (con explosión aplicada) de un nodo, sin recorrer mallas. */
  currentCenter(n: PartNode, out = new THREE.Vector3()) {
    out.copy(n.center0);
    let p: PartNode | null = n;
    while (p && p.parent) {
      out.addScaledVector(p.ex, stageOf(p.depth, this.explode));
      p = p.parent;
    }
    return out;
  }

  private updateGuides() {
    const show = this.guides && this.explode > 0.01 && !this.walk;
    this.guideLines.visible = show;
    if (!show) return;
    const pos = this.guideLines.geometry.attributes.position as THREE.BufferAttribute;
    let k = 0;
    const v = new THREE.Vector3();
    for (const n of this.nodes.values()) {
      if (n.depth < 1 || n.depth > 2 || n.ex.lengthSq() < 1e-4 || k >= 400) continue;
      if (n.interior && !this.interiorLoaded) continue;
      if (!this.isNodeVisible(n)) continue;
      const a = n.parent ? this.currentCenter(n.parent, new THREE.Vector3()).add(n.center0).sub(n.parent.center0) : n.center0;
      this.currentCenter(n, v);
      pos.setXYZ(k * 2, a.x, a.y, a.z);
      pos.setXYZ(k * 2 + 1, v.x, v.y, v.z);
      k++;
    }
    for (let i = k * 2; i < pos.count; i++) pos.setXYZ(i, 0, 0, 0);
    pos.needsUpdate = true;
    this.guideLines.geometry.setDrawRange(0, k * 2);
    this.guideLines.computeLineDistances();
  }

  // ---------------------------------------------------------------- selección
  select(n: PartNode | null, focus = false) {
    this.selected = n;
    this.outline.selection.clear();
    if (n) for (const m of n.meshes) if (m.visible) this.outline.selection.add(m);
    this.applyXray();
    this.events.onSelect?.(n);
    if (n && focus) this.focus(n);
    this.dirty = true;
  }

  selectByCode(code: string, focus = false) {
    this.select(this.nodes.get(code) ?? null, focus);
  }

  private nodeOfObject(o: THREE.Object3D | null): PartNode | null {
    while (o) {
      const c = (o.userData as any)?.code;
      if (c && this.nodes.has(c)) return this.nodes.get(c)!;
      o = o.parent;
    }
    return null;
  }

  pick(clientX: number, clientY: number): PartNode | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const list = this.pickables.filter((m) => this.isMeshShown(m));
    const hits = this.raycaster.intersectObjects(list, false);
    for (const h of hits) {
      if (this.section.on && this.clipPlane.distanceToPoint(h.point) < 0) continue;
      if (this.xray && this.selected && !this.selected.meshes.includes(h.object as THREE.Mesh)) continue;
      return this.nodeOfObject(h.object);
    }
    return null;
  }

  private isMeshShown(m: THREE.Object3D) {
    let o: THREE.Object3D | null = m;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }

  isNodeVisible(n: PartNode) {
    return this.isMeshShown(n.obj);
  }

  // ---------------------------------------------------------------- rayos X / aislar / ocultar
  setXray(on: boolean) { this.xray = on; this.applyXray(); }

  private applyXray() {
    const keep = new Set<THREE.Mesh>(this.selected ? this.selected.meshes : []);
    for (const m of this.pickables) {
      if (!m.userData.origMat) m.userData.origMat = m.material;
      const ghost = this.xray && !keep.has(m);
      m.material = ghost ? this.xrayMat : m.userData.origMat;
      m.castShadow = ghost ? false : (m.geometry.boundingSphere!.radius > 0.08);
      m.renderOrder = ghost ? 2 : 0;
    }
    this.dirty = true;
  }

  setIsolate(n: PartNode | null) { this.isolate = n; this.applyIsolate(); }

  private applyIsolate() {
    const keep = this.isolate ? new Set(this.isolate.meshes) : null;
    for (const m of this.pickables) {
      const nn = this.nodeOfObject(m);
      let hidden = false;
      let p: PartNode | null = nn;
      while (p) { if (p.hidden) { hidden = true; break; } p = p.parent; }
      m.visible = !hidden && (!keep || keep.has(m));
    }
    this.updateGuides();
    this.dirty = true;
  }

  setHidden(n: PartNode, hidden: boolean) { n.hidden = hidden; this.applyIsolate(); }

  showAll() {
    for (const n of this.nodes.values()) n.hidden = false;
    this.isolate = null;
    this.applyIsolate();
  }

  // ---------------------------------------------------------------- sección
  setSection(on: boolean, axis: Axis = this.section.axis, pos = this.section.pos, flip = this.section.flip) {
    this.section = { on, axis, pos, flip };
    this.applySection();
  }

  private applySection() {
    const { on, axis, pos, flip } = this.section;
    const nrm = axis === 'x' ? new THREE.Vector3(-1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
    // eje 'y' de la interfaz = babor/estribor (Blender Y → three -Z); 'z' = cenit/nadir (three Y)
    if (flip) nrm.negate();
    this.clipPlane.normal.copy(nrm);
    const p = axis === 'x' ? new THREE.Vector3(pos, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 0, -pos) : new THREE.Vector3(0, pos, 0);
    this.clipPlane.constant = -nrm.dot(p);
    this.renderer.clippingPlanes = on ? [this.clipPlane] : [];
    const side = on ? THREE.DoubleSide : THREE.FrontSide;
    const seen = new Set<THREE.Material>();
    for (const m of this.pickables) {
      const mat = (m.userData.origMat ?? m.material) as THREE.Material;
      if (seen.has(mat)) continue;
      seen.add(mat);
      if (!(mat as any).userData.glass) { mat.side = side; mat.needsUpdate = true; }
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- cámara
  currentBox(n: PartNode) {
    const b = new THREE.Box3();
    for (const m of n.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    }
    return b;
  }

  focus(n: PartNode, dur = 1100) {
    if (this.walk) this.setWalk(false);
    this.model.updateMatrixWorld(true);
    const b = this.currentBox(n);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.max(0.25, b.getSize(new THREE.Vector3()).length() / 2);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = Math.min(150, (r / Math.sin(fov / 2)) * 1.05);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0.6, 0.35, 0.7).normalize();
    this.flyTo(c.clone().addScaledVector(dir, dist), c, dur);
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1200, done?: () => void, ease = easeOut, fov?: number) {
    this.tween = { t0: performance.now(), dur, p0: this.camera.position.clone(), p1: pos.clone(), q0: this.controls.target.clone(), q1: target.clone(), ease, done, fov0: this.camera.fov, fov1: fov ?? this.camera.fov };
    this.dirty = true;
  }

  flyPath(points: THREE.Vector3[], targets: THREE.Vector3[], dur: number, done?: () => void) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const tcurve = new THREE.CatmullRomCurve3(targets, false, 'centripetal');
    this.tween = { t0: performance.now(), dur, p0: points[0], p1: points[points.length - 1], q0: targets[0], q1: targets[targets.length - 1], curve, tcurve, ease: easeInOut, done };
    this.dirty = true;
  }

  stopTween() { this.tween = null; }

  viewPreset(v: 'iso' | 'front' | 'rear' | 'side' | 'top' | 'bottom', ortho = false) {
    const c = b2t(2.0, 0, 0);
    const fov = ortho ? 4 : 32;
    const base = ortho ? 620 : 52;
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(0.7, 0.42, 0.62), front: new THREE.Vector3(1, 0, 0), rear: new THREE.Vector3(-1, 0, 0),
      side: new THREE.Vector3(0, 0, 1), top: new THREE.Vector3(0, 1, 0.0001), bottom: new THREE.Vector3(0, -1, 0.0001),
    };
    const d = dirs[v].clone().normalize();
    const dist = base * (v === 'front' || v === 'rear' ? 0.75 : 1);
    if (this.walk) this.setWalk(false);
    this.controls.maxDistance = ortho ? 1500 : 220;
    this.flyTo(c.clone().addScaledVector(d, dist), c, 1200, undefined, easeOut, fov);
  }

  // ---------------------------------------------------------------- interior
  setWalk(on: boolean, wp = WAYPOINTS[0]) {
    this.walk = on;
    this.controls.enabled = !on;
    this.camera.near = on ? 0.02 : 0.05;
    this.camera.updateProjectionMatrix();
    if (on) {
      if (this.explode > 0) this.setExplode(0, false);
      if (this.xray) this.setXray(false);
      this.goWaypoint(wp);
    } else {
      this.camera.fov = 32;
      this.camera.updateProjectionMatrix();
      this.flyTo(b2t(28, 30, 12), b2t(2.5, 0, 0), 1400);
    }
    this.interiorLights.visible = on;
    this.sun.intensity = on ? this.sun.intensity * 0.35 : (this.lighting === 'sun' ? 4.2 : this.lighting === 'lunar' ? 3.4 : this.lighting === 'studio' ? 2.2 : 1.6);
    (this.scene as any).environmentIntensity = on ? 0.25 : 0.9;
    this.moon && (this.moon.visible = !on && this.lighting === 'lunar');
    this.updateGuides();
    this.events.onWalkChange?.(on);
    this.dirty = true;
  }

  goWaypoint(wp: typeof WAYPOINTS[number]) {
    const d = wp.look.clone().sub(wp.pos).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    this.tween = { t0: performance.now(), dur: 900, p0: this.camera.position.clone(), p1: wp.pos.clone(), q0: this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3())), q1: wp.look.clone(), ease: easeOut };
    this.dirty = true;
  }

  walkInput(k: string, down: boolean) {
    if (down) this.keys.add(k); else this.keys.delete(k);
    this.dirty = true;
  }

  private clampInterior(p: THREE.Vector3) {
    // coordenadas Blender para el test
    const bx = p.x, by = -p.z, bz = p.y;
    let x = THREE.MathUtils.clamp(bx, 0.35, 12.1);
    let y = by, z = bz;
    if (x < 8.8) {
      y = THREE.MathUtils.clamp(y, -0.98, 0.98);
      z = THREE.MathUtils.clamp(z, -0.98, 0.98);
    } else {
      const inCup = Math.abs(x - 11.05) < 0.45 && Math.abs(y) < 0.45;
      const rmax = x < 9.9 ? 1.0 : 1.12;
      const r = Math.hypot(y, z);
      if (inCup && z > 0) {
        z = Math.min(z, 2.0);
      } else if (r > rmax) { y *= rmax / r; z *= rmax / r; }
    }
    p.set(x, z, -y);
  }

  private walkStep(dt: number) {
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const acc = new THREE.Vector3();
    if (this.keys.has('w') || this.keys.has('arrowup')) acc.add(f);
    if (this.keys.has('s') || this.keys.has('arrowdown')) acc.sub(f);
    if (this.keys.has('d') || this.keys.has('arrowright')) acc.add(r);
    if (this.keys.has('a') || this.keys.has('arrowleft')) acc.sub(r);
    if (this.keys.has('e')) acc.y += 1;
    if (this.keys.has('q')) acc.y -= 1;
    const speed = 1.4;
    this.walkVel.lerp(acc.normalize().multiplyScalar(speed), 1 - Math.exp(-dt * 8));
    if (this.walkVel.lengthSq() > 1e-5) {
      this.camera.position.addScaledVector(this.walkVel, dt);
      this.clampInterior(this.camera.position);
      this.dirty = true;
    }
    const look = this.camera.position.clone().add(f);
    this.camera.lookAt(look);
    return this.walkVel.lengthSq() > 1e-5;
  }

  // ---------------------------------------------------------------- historia (scroll)
  setAutoOrbit(on: boolean) { this.autoOrbit = on; this.dirty = true; }

  // ---------------------------------------------------------------- etiquetas
  private updateLabels() {
    const want: PartNode[] = [];
    if (this.labels && !this.walk && this.root) {
      if (this.selected && this.selected.children.length && this.selected.depth >= 1) {
        for (const c of this.selected.children) if (c.children.length || c.kind === 'part') want.push(c);
      } else if (!this.selected || this.selected.depth === 0) {
        for (const c of this.root.children) want.push(c);
        if (this.explode > 0.4) {
          const hab = this.nodes.get('HAB');
          if (hab) for (const c of hab.children) want.push(c);
        }
      }
    }
    const keepSet = new Set(want.map((n) => n.code));
    for (const [code, el] of this.labelEls) if (!keepSet.has(code)) { el.remove(); this.labelEls.delete(code); }
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const n of want.slice(0, 40)) {
      if (!this.isNodeVisible(n) || (n.interior && !this.interiorLoaded)) continue;
      let el = this.labelEls.get(n.code);
      if (!el) {
        el = document.createElement('div');
        el.className = 'label3d';
        el.innerHTML = `<span class="dot"></span><span class="txt">${n.label}</span>`;
        el.onclick = (e) => { e.stopPropagation(); this.select(n, true); };
        this.labelsLayer.appendChild(el);
        this.labelEls.set(n.code, el);
      }
      this.currentCenter(n, v).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.opacity = vis ? '1' : '0';
      el.style.transform = `translate3d(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px, 0)`;
    }
  }

  // ---------------------------------------------------------------- culling de detalle
  private detailCulling() {
    if (this.walk || this.selected) {
      for (const s of this.smallMeshes) s.m.userData.culled = false;
      return;
    }
    const h = this.renderer.domElement.clientHeight;
    const k = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const cp = this.camera.position;
    for (const s of this.smallMeshes) {
      s.m.getWorldPosition(s.c);
      const px = (s.r / Math.max(0.01, s.c.distanceTo(cp))) * k;
      const cull = px < 1.0;
      if (cull !== !!s.m.userData.culled) {
        s.m.userData.culled = cull;
      }
      // las mallas ocultas por aislamiento mantienen su estado
      if (s.m.userData.culled) s.m.layers.disable(0); else s.m.layers.enable(0);
    }
  }

  // ---------------------------------------------------------------- bucle
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    let active = false;
    if (this.tween) {
      const tw = this.tween;
      const t = Math.min(1, (now - tw.t0) / tw.dur);
      const e = tw.ease(t);
      if (tw.curve && tw.tcurve) {
        this.camera.position.copy(tw.curve.getPoint(e));
        this.controls.target.copy(tw.tcurve.getPoint(e));
      } else {
        this.camera.position.lerpVectors(tw.p0, tw.p1, e);
        this.controls.target.lerpVectors(tw.q0, tw.q1, e);
      }
      if (tw.fov0 !== undefined && tw.fov1 !== undefined && tw.fov0 !== tw.fov1) {
        this.camera.fov = tw.fov0 + (tw.fov1 - tw.fov0) * e;
        this.camera.updateProjectionMatrix();
      }
      if (this.walk) this.camera.lookAt(this.controls.target);
      else this.camera.lookAt(this.controls.target);
      active = true;
      if (t >= 1) {
        this.tween = null;
        if (this.walk) {
          const d = this.controls.target.clone().sub(this.camera.position).normalize();
          this.yaw = Math.atan2(-d.x, -d.z);
          this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
        }
        tw.done?.();
      }
    }
    if (this.explodeTween) {
      const et = this.explodeTween;
      const t = Math.min(1, (now - et.t0) / et.dur);
      this.explode = et.a + (et.b - et.a) * easeInOut(t);
      this.applyExplode();
      if (t >= 1) this.explodeTween = null;
      active = true;
    }
    if (this.walk && !this.tween) active = this.walkStep(dt) || active;
    if (this.autoOrbit && !this.tween && !this.walk) {
      const off = this.camera.position.clone().sub(this.controls.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.06);
      this.camera.position.copy(this.controls.target).add(off);
      active = true;
    }
    if (!this.walk) { if (this.controls.update()) active = true; }
    if (active) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.detailCulling();
    this.renderer.info.reset();
    this.composer.render(dt);
    this.updateLabels();
    this.frames++;
    if (now - this.fpsT > 1000) {
      this.events.onStats?.({ fps: Math.round((this.frames * 1000) / (now - this.fpsT)), calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles });
      this.frames = 0;
      this.fpsT = now;
    }
  };

  requestRender() { this.dirty = true; }

  // ---------------------------------------------------------------- entrada
  private bindInput() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      if (this.tween && !this.walk) this.tween = null;
      if (this.walk) el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.walk && down && e.pointerId === down.id) {
        this.yaw -= e.movementX * 0.0032;
        this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0032, -1.45, 1.45);
        this.dirty = true;
        return;
      }
      if (!down && !this.walk && e.pointerType === 'mouse') {
        const n = this.pick(e.clientX, e.clientY);
        el.style.cursor = n ? 'pointer' : 'grab';
        this.events.onHover?.(n, e.clientX, e.clientY);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (this.walk || moved > 6 || !quick) return;
      const n = this.pick(e.clientX, e.clientY);
      const now = performance.now();
      if (n && this.selected === n && now - lastTap < 350) { this.focus(n); }
      else if (n && this.selected && this.selected === n) {
        // un segundo clic sobre la misma pieza sube un nivel en la jerarquía
        if (n.parent && n.parent.depth > 0) this.select(n.parent);
      } else this.select(n);
      lastTap = now;
    });
    el.addEventListener('pointerleave', () => this.events.onHover?.(null, 0, 0));
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (this.walk) this.walkInput(e.key.toLowerCase(), true);
    });
    window.addEventListener('keyup', (e) => this.walkInput(e.key.toLowerCase(), false));
  }

  onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.n8ao?.setSize?.(w, h);
    this.dirty = true;
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
