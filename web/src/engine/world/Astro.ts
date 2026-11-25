/**
 * Entorno astronómico en una escena lejana (unidades: km).
 * La cámara lejana está siempre en el origen; los cuerpos se colocan restando
 * la posición absoluta de la cámara (doble precisión en JS), así nunca hay
 * coordenadas grandes en la GPU. Los cuerpos se ordenan por distancia y se
 * dibujan sin prueba de profundidad (no se solapan salvo en tránsitos).
 */
import * as THREE from 'three';
import { rng } from '../util';

export const R_EARTH = 6371;
export const R_MOON = 1737.4;
export const D_MOON = 384400;
export const AU = 149.6e6;
export const R_SUN = 696000;

export type ScenarioId = 'leo' | 'lunar' | 'eclipse';

export interface Scenario { id: ScenarioId; label: string; desc: string; shipKm: THREE.Vector3; }

const earthVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
 gl_Position = projectionMatrix * viewMatrix * w; }`;

const earthFrag = /* glsl */ `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform sampler2D oceanMap;
uniform vec3 sunDir; uniform float cloudShift; uniform float exposure;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(-vW); vec3 L = normalize(sunDir);
  float ndl = dot(N, L);
  float day = smoothstep(-0.08, 0.12, ndl);
  vec3 albedo = pow(texture2D(dayMap, vUv).rgb, vec3(2.2));
  vec2 cuv = vec2(vUv.x + cloudShift, vUv.y);
  float cloud = texture2D(cloudMap, cuv).r;
  // sombra de nubes: muestreo desplazado hacia el Sol
  float cshadow = texture2D(cloudMap, cuv + vec2(0.0012, 0.0006)).r;
  float ocean = texture2D(oceanMap, vUv).r;
  vec3 lit = albedo * max(ndl, 0.0) * (1.0 - 0.45 * cshadow);
  // reflejo especular del Sol en el océano (desaparece bajo nubes)
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 120.0) * ocean * (1.0 - cloud) * 1.6 * day;
  vec3 cloudCol = vec3(1.0) * cloud * (max(ndl, 0.0) * 0.95 + 0.03);
  vec3 col = mix(lit, cloudCol, cloud) + vec3(1.0, 0.96, 0.9) * spec;
  // luces nocturnas (atenuadas por nubes) en el lado oscuro
  vec3 night = pow(texture2D(nightMap, vUv).rgb, vec3(2.0)) * (1.0 - day) * (1.0 - 0.7 * cloud) * 1.4;
  col += night;
  // tinte de terminador (luz rojiza que atraviesa más atmósfera)
  float term = smoothstep(0.25, 0.0, abs(ndl)) * day;
  col *= mix(vec3(1.0), vec3(1.15, 0.82, 0.6), term * 0.6);
  // dispersión atmosférica hacia el limbo
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.25, 0.45, 1.0) * rim * 0.55 * smoothstep(-0.2, 0.4, ndl);
  gl_FragColor = vec4(col * exposure, 1.0);
}`;

const atmoFrag = /* glsl */ `
uniform vec3 sunDir; uniform float exposure;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(-vW); vec3 L = normalize(sunDir);
  float edge = 1.0 - abs(dot(N, V));
  float glow = pow(edge, 4.5);
  float ndl = dot(N, L);
  vec3 blue = vec3(0.30, 0.55, 1.0);
  vec3 sunset = vec3(1.0, 0.55, 0.25);
  float lit = smoothstep(-0.35, 0.25, ndl);
  vec3 c = mix(sunset, blue, smoothstep(-0.05, 0.35, ndl)) * lit;
  gl_FragColor = vec4(c * glow * 1.4 * exposure, glow * lit);
}`;

const starVert = /* glsl */ `
attribute float mag; attribute vec3 tint; uniform float gain; uniform float pr; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float b = pow(2.512, -mag) * 40.0; vA = clamp(b * gain, 0.0, 1.0); vC = tint;
  gl_PointSize = clamp(1.2 + b * 0.6, 1.0, 3.2) * pr; }`;
const starFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); float a = exp(-r * 14.0) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * a, a); }`;

export class Astro {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sunDir = new THREE.Vector3(0.82, 0.18, 0.54).normalize();
  earth: THREE.Mesh;
  atmo: THREE.Mesh;
  moon: THREE.Mesh;
  sun: THREE.Sprite;
  stars: THREE.Points;
  moonPos = new THREE.Vector3();
  earthRot = 0;
  cloudShift = 0;
  /** 0 = pleno Sol, 1 = umbra total */
  eclipse = 0;
  timeScale = 1;
  private earthMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private moonLight = new THREE.DirectionalLight(0xffffff, 3.0);
  private earthshine = new THREE.DirectionalLight(0x6f86b8, 0.02);

  constructor(base = 'textures/', anisotropy = 8) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3e6);
    const tl = new THREE.TextureLoader();
    const tex = (f: string, srgb = false) => {
      const t = tl.load(base + f);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      return t;
    };
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: tex('earth_day.jpg') }, nightMap: { value: tex('earth_night.jpg') }, cloudMap: { value: tex('earth_clouds.jpg') },
        oceanMap: { value: tex('earth_ocean.jpg') }, sunDir: { value: this.sunDir.clone() }, cloudShift: { value: 0 }, exposure: { value: 1 },
      },
      vertexShader: earthVert, fragmentShader: earthFrag, depthTest: false, depthWrite: false,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 192, 96), this.earthMat);
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: this.sunDir.clone() }, exposure: { value: 1 } },
      vertexShader: earthVert, fragmentShader: atmoFrag, transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.BackSide, depthTest: false, depthWrite: false,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.025, 128, 64), this.atmoMat);
    const moonMat = new THREE.MeshStandardMaterial({ map: tex('moon.jpg', true), bumpMap: tex('moon_height.jpg'), bumpScale: 6, roughness: 1, metalness: 0, depthTest: false, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 160, 80), moonMat);
    // Sol: disco de 0,53° con halo contenido (sin destellos de lente)
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const g = sc.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.12, 'rgba(255,253,245,1)'); grd.addColorStop(0.16, 'rgba(255,240,215,0.55)');
    grd.addColorStop(0.35, 'rgba(255,220,180,0.10)'); grd.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, color: new THREE.Color(3, 2.9, 2.7) }));
    // estrellas: distribución de magnitudes realista con banda galáctica tenue
    const N = 14000, r = rng(7);
    const pos = new Float32Array(N * 3), mag = new Float32Array(N), tint = new Float32Array(N * 3);
    const gp = new THREE.Vector3(0.2, 0.9, -0.38).normalize();
    for (let i = 0; i < N; i++) {
      let v = new THREE.Vector3();
      if (i < N * 0.35) {
        // concentración en el plano galáctico
        const a = r() * Math.PI * 2; const off = (r() - 0.5) * 0.25;
        const u = new THREE.Vector3(1, 0, 0).cross(gp).normalize(); const w = gp.clone().cross(u);
        v.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).addScaledVector(gp, off).normalize();
      } else {
        const z = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        v.set(s * Math.cos(t), z, s * Math.sin(t));
      }
      v.multiplyScalar(2.5e6);
      pos.set([v.x, v.y, v.z], i * 3);
      mag[i] = 1.5 + Math.pow(r(), 0.35) * 6.0;
      const k = r();
      const c = k < 0.12 ? [0.75, 0.82, 1.0] : k < 0.75 ? [1, 0.98, 0.95] : k < 0.92 ? [1, 0.9, 0.75] : [1, 0.78, 0.6];
      tint.set(c, i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    sg.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.starMat = new THREE.ShaderMaterial({ uniforms: { gain: { value: 0.35 }, pr: { value: 1 } }, vertexShader: starVert, fragmentShader: starFrag,
      // opaco (aditivo) para que entre en la lista opaca y se dibuje ANTES que Tierra y Luna:
      // como transparente se pintaba encima del disco terrestre
      transparent: false, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -100;
    this.moonLight.position.copy(this.sunDir);
    this.scene.add(this.stars, this.sun, this.moon, this.earth, this.atmo, this.moonLight, this.moonLight.target, this.earthshine);
    this.scene.add(new THREE.AmbientLight(0x101418, 0.02));
    this.moonPos.set(-0.55, 0.12, -0.83).normalize().multiplyScalar(D_MOON);
  }

  scenarios(): Scenario[] {
    const s = this.sunDir;
    // órbita baja: sobre el lado diurno cerca del terminador (vista con océano, nubes y luces nocturnas)
    const up = new THREE.Vector3(0, 1, 0);
    const side = s.clone().cross(up).normalize();
    const leoDir = s.clone().multiplyScalar(0.35).add(side.clone().multiplyScalar(0.9)).add(up.clone().multiplyScalar(0.25)).normalize();
    const lunarDir = this.sunDir.clone().multiplyScalar(-0.2).add(side.clone().multiplyScalar(-0.95)).normalize();
    const eclDir = s.clone().negate().add(side.clone().multiplyScalar(0.12)).normalize();
    return [
      { id: 'leo', label: 'Órbita terrestre baja', desc: '420 km sobre la Tierra, junto al terminador.', shipKm: leoDir.multiplyScalar(R_EARTH + 420) },
      { id: 'lunar', label: 'Órbita lunar', desc: '160 km sobre la Luna; la Tierra en el horizonte.', shipKm: this.moonPos.clone().add(lunarDir.multiplyScalar(R_MOON + 160)) },
      { id: 'eclipse', label: 'Sombra terrestre', desc: 'Lado nocturno de la Tierra: eclipse solar desde la nave.', shipKm: eclDir.multiplyScalar(R_EARTH + 900) },
    ];
  }

  /** Fracción del disco solar oculta por un cuerpo (aproximación de discos). */
  private occlusion(obsKm: THREE.Vector3, center: THREE.Vector3, radius: number) {
    const toB = center.clone().sub(obsKm);
    const db = toB.length();
    if (db < radius) return 1;
    const sunAng = Math.atan(R_SUN / AU);
    const bodyAng = Math.asin(Math.min(1, radius / db));
    const sep = toB.normalize().angleTo(this.sunDir);
    if (toB.dot(this.sunDir) < 0) return 0;
    if (sep >= sunAng + bodyAng) return 0;
    if (sep <= bodyAng - sunAng) return 1;
    const t = (sunAng + bodyAng - sep) / (2 * sunAng);
    return Math.min(1, Math.max(0, t));
  }

  /**
   * camKm: posición absoluta de la cámara (km). quat: orientación de la cámara.
   * exposure: exposición fotográfica actual (1 = exterior a pleno Sol).
   */
  update(dt: number, camKm: THREE.Vector3, quat: THREE.Quaternion, fov: number, aspect: number, exposure: number, pixelRatio: number) {
    this.earthRot += dt * this.timeScale * (2 * Math.PI / 86164) * 40; // rotación acelerada ×40 (estética)
    this.cloudShift = (this.cloudShift + dt * this.timeScale * 0.0006) % 1;
    this.camera.quaternion.copy(quat);
    this.camera.fov = fov; this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.earth.position.copy(camKm).negate();
    this.earth.rotation.y = this.earthRot;
    this.atmo.position.copy(this.earth.position);
    this.moon.position.copy(this.moonPos).sub(camKm);
    this.sun.position.copy(this.sunDir).multiplyScalar(1.0e6);
    const sunR = 1.0e6 * Math.tan(0.00465) * 2.2;
    this.sun.scale.setScalar(sunR * 2);
    this.moonLight.position.copy(this.sunDir).multiplyScalar(10);
    this.moonLight.target.position.set(0, 0, 0);
    const u = this.earthMat.uniforms;
    u.sunDir.value.copy(this.sunDir);
    u.cloudShift.value = this.cloudShift;
    u.exposure.value = exposure;
    this.atmoMat.uniforms.sunDir.value.copy(this.sunDir);
    this.atmoMat.uniforms.exposure.value = exposure;
    // eclipses
    const occE = this.occlusion(camKm, new THREE.Vector3(0, 0, 0), R_EARTH * 1.01);
    const occM = this.occlusion(camKm, this.moonPos, R_MOON);
    this.eclipse = Math.max(occE, occM);
    this.sun.material.opacity = 1 - this.eclipse;
    // estrellas: visibles según exposición (con la cámara expuesta para el Sol, casi no se ven)
    this.starMat.uniforms.gain.value = 0.22 + this.eclipse * 0.9 + (exposure > 1.5 ? 0.6 : 0);
    this.starMat.uniforms.pr.value = pixelRatio;
    // luz terrestre reflejada sobre la Luna
    this.earthshine.position.copy(this.moonPos).negate().normalize();
    // orden de dibujado por distancia (más lejano primero)
    const bodies: [THREE.Object3D, number][] = [[this.sun, 1e7], [this.moon, this.moon.position.length()], [this.earth, this.earth.position.length()]];
    bodies.sort((a, b) => b[1] - a[1]);
    bodies.forEach(([o], i) => (o.renderOrder = i * 2));
    this.atmo.renderOrder = this.earth.renderOrder + 1;
    this.camera.near = Math.max(0.05, Math.min(this.earth.position.length() - R_EARTH * 1.03, this.moon.position.length() - R_MOON) * 0.5);
    this.camera.updateProjectionMatrix();
  }

  /** Altitud sobre la Tierra o la Luna (km) y cuerpo más cercano. */
  altitude(shipKm: THREE.Vector3) {
    const he = shipKm.length() - R_EARTH;
    const hm = shipKm.distanceTo(this.moonPos) - R_MOON;
    return he < hm ? { body: 'Tierra', km: he } : { body: 'Luna', km: hm };
  }

  /** Dirección y radio angular aparente de la Tierra (para cámaras exteriores en pantallas). */
  earthDir(shipKm: THREE.Vector3) { return shipKm.clone().negate().normalize(); }
}
