/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Entorno astronómico cinematográfico en escena lejana (unidades: km).
 *
 * - Tierra 4K NASA Blue Marble Next Generation + Black Marble 2016 + relieve topográfico
 * - Capa nubosa 3D elevada (4096×2048) con paralaje, sombras sobre superficie y enrojecimiento de terminador
 * - Dispersión atmosférica Rayleigh + Mie multicapa (limbo zafiro diurno + terminador ámbar/carmesí)
 * - Reflejo especular Fresnel solar en océanos (enmascarado por costas 4K y nubes)
 * - Luna LROC con sombreado realista y luz cenicienta terrestre (earthshine)
 * - Esfera galáctica NASA Deep Star Map (Vía Láctea) + 16 000 estrellas con índice de color realista
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
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
void main() {
  vUv = uv;
  mat3 m3 = mat3(modelMatrix);
  vN = normalize(m3 * normal);
  // Tangent along increasing longitude for equirectangular normal mapping
  vec3 upAxis = vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(upAxis, vN) + vec3(1e-5, 0.0, 0.0));
  vT = t;
  vB = cross(vN, t);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const earthFrag = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D cloudMap;
uniform sampler2D oceanMap;
uniform sampler2D normalMap;
uniform vec3 sunDir;
uniform float cloudShift;
uniform float exposure;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;

void main() {
  vec3 Ngeom = normalize(vN);
  vec3 V = normalize(-vW);
  vec3 L = normalize(sunDir);

  float ocean = texture2D(oceanMap, vUv).r;
  // Perturb normal subtly over continental mountain chains (Himalayas, Andes, Rockies)
  vec3 nTex = texture2D(normalMap, vUv).rgb * 2.0 - 1.0;
  vec3 Nland = normalize(Ngeom + (vT * nTex.x + vB * nTex.y) * (0.42 * (1.0 - ocean)));
  vec3 N = mix(Nland, Ngeom, ocean);

  float ndlGeom = dot(Ngeom, L);
  float ndl = dot(N, L);
  float ndv = max(dot(Ngeom, V), 0.0);
  float day = smoothstep(-0.08, 0.14, ndlGeom);

  vec3 albedo = pow(texture2D(dayMap, vUv).rgb, vec3(2.2));
  // Richer deep-ocean sapphire scatter & crisp continental contrast
  albedo = mix(albedo, albedo * vec3(0.86, 0.96, 1.18), ocean * 0.45);

  // Soft parallax cloud shadow projected onto terrain/ocean along solar tangent vector
  vec2 cuv = vec2(fract(vUv.x + cloudShift), vUv.y);
  vec2 sunShift = vec2(dot(L, vT), dot(L, vB)) * 0.0022;
  float cloud = texture2D(cloudMap, cuv).r;
  float cshadow = texture2D(cloudMap, vec2(fract(cuv.x + sunShift.x), clamp(cuv.y + sunShift.y, 0.002, 0.998))).r;

  // Diffuse land/ocean illumination with wrap near terminator & cloud shadowing
  float diff = max(ndl, 0.0);
  float wrapTerm = smoothstep(-0.18, 0.22, ndlGeom);
  vec3 sunTint = mix(vec3(1.18, 0.52, 0.24), vec3(1.0, 0.99, 0.97), smoothstep(-0.02, 0.28, ndlGeom));
  vec3 lit = albedo * sunTint * (diff * 1.12 + 0.025 * wrapTerm) * (1.0 - 0.52 * cshadow);

  // Physically-inspired Fresnel + dual-lobe Blinn-Phong ocean sun glint (sharp core + broad sheen)
  vec3 H = normalize(L + V);
  float ndh = max(dot(Ngeom, H), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
  float specTight = pow(ndh, 190.0) * 2.4;
  float specBroad = pow(ndh, 24.0) * 0.28;
  vec3 glint = mix(vec3(1.0, 0.65, 0.35), vec3(1.0, 0.96, 0.90), smoothstep(0.0, 0.30, ndlGeom))
             * (specTight + specBroad * fresnel) * ocean * (1.0 - cloud * 0.92) * smoothstep(-0.04, 0.16, ndlGeom);

  vec3 col = lit + glint;

  // NASA Black Marble city lights on dark side (softly blurred/attenuated by thick clouds)
  vec3 nightRaw = pow(texture2D(nightMap, vUv).rgb, vec3(1.85));
  float nightMask = smoothstep(0.08, -0.14, ndlGeom);
  col += nightRaw * nightMask * (1.0 - 0.72 * cloud) * 1.55;

  // Aerial perspective: electric ISS cyan-blue Rayleigh veil thickening toward the curved Earth limb
  float rim = pow(1.0 - ndv, 2.9);
  float rimTight = pow(1.0 - ndv, 5.8);
  float sunsetBand = exp(-pow((ndlGeom + 0.01) / 0.13, 2.0));
  vec3 rayleighCol = mix(vec3(0.20, 0.56, 1.0), vec3(1.0, 0.48, 0.18), sunsetBand * 0.72);
  float atmoVis = smoothstep(-0.20, 0.25, ndlGeom);
  col = mix(col, rayleighCol * 1.18, clamp(rim * 0.44 * atmoVis, 0.0, 0.72));
  col += vec3(0.36, 0.74, 1.0) * rimTight * 0.72 * smoothstep(-0.08, 0.30, ndlGeom);

  gl_FragColor = vec4(col * exposure, 1.0);
}`;

const cloudFrag = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudShift;
uniform float exposure;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vW);
  vec3 L = normalize(sunDir);
  vec2 cuv = vec2(fract(vUv.x + cloudShift), vUv.y);
  float c = texture2D(cloudMap, cuv).r;
  if (c < 0.015) discard;

  // Micro self-shadowing across cloud tops toward the Sun for 3D volumetric puffiness!
  vec2 sOff = vec2(dot(L, vT), dot(L, vB)) * 0.0014;
  float cSun = texture2D(cloudMap, vec2(fract(cuv.x + sOff.x), clamp(cuv.y + sOff.y, 0.002, 0.998))).r;
  float selfRelief = clamp(1.0 - (cSun - c) * 1.45, 0.60, 1.22);

  float ndl = dot(N, L);
  float ndv = max(dot(N, V), 0.0);
  float lit = max(ndl, 0.0);
  float wrap = smoothstep(-0.14, 0.18, ndl);

  // Warm rose-amber sunset cloud tops strictly along the narrow terminator, crisp snow-white in daylight
  vec3 dayTint = vec3(1.0, 0.995, 0.985);
  vec3 sunsetTint = vec3(1.18, 0.56, 0.30);
  vec3 nightAmbient = vec3(0.012, 0.020, 0.042);
  vec3 tint = mix(sunsetTint, dayTint, smoothstep(-0.02, 0.18, ndl));
  vec3 cloudCol = tint * (lit * 1.12 * selfRelief + 0.035 * wrap) + nightAmbient * (1.0 - wrap);

  // Subtle Rayleigh veil near the horizon
  float rim = pow(1.0 - ndv, 3.2);
  cloudCol = mix(cloudCol, vec3(0.28, 0.62, 1.0) * (0.45 + 0.65 * lit), rim * 0.38 * wrap);

  float alpha = clamp(c * 0.96, 0.0, 0.96);
  gl_FragColor = vec4(cloudCol * exposure, alpha);
}`;

const atmoFrag = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 earthCenter;
uniform float exposure;
varying vec3 vN;
varying vec3 vW;

void main() {
  // Exact ray-to-planet-center closest approach altitude (km) — eliminates hard sphere edge!
  vec3 rd = normalize(vW);
  float tClosest = max(dot(earthCenter, rd), 0.0);
  vec3 closestPt = rd * tClosest;
  float b = length(closestPt - earthCenter);
  float R_E = 6371.0;

  // Rays striking the solid Earth disc are already shaded by earthFrag + cloudFrag
  if (b < R_E - 6.0) discard;

  float alt = max(b - R_E, 0.0);
  // Smooth fade into surface at alt=0 so there's no harsh seam, then true exponential scale-height decay!
  float surfaceSoft = smoothstep(-6.0, 4.0, b - R_E);
  float rayleigh = exp(-alt / 22.0);
  float upperGlow = exp(-alt / 58.0) * 0.28;
  // Guarantee smooth zero before outer sphere boundary (R_E * 1.032 = +204 km)
  float outerFade = smoothstep(185.0, 80.0, alt);
  float density = (rayleigh + upperGlow) * surfaceSoft * outerFade;

  vec3 Nlimb = normalize(closestPt - earthCenter);
  vec3 L = normalize(sunDir);
  float ndl = dot(Nlimb, L);

  // Sunlit ISS horizon: dazzling cyan-white at alt=0 fading into deep cobalt-blue aloft!
  vec3 lowHorizon = vec3(0.58, 0.84, 1.0);
  vec3 midBlue    = vec3(0.16, 0.50, 1.0);
  vec3 deepSpace  = vec3(0.04, 0.16, 0.68);
  vec3 dayCol = mix(lowHorizon, midBlue, smoothstep(0.0, 28.0, alt));
  dayCol = mix(dayCol, deepSpace, smoothstep(24.0, 85.0, alt));

  // Delicate coral-orange sunset ONLY along the narrow solar terminator (ndl ~ 0)
  float sunsetMask = exp(-pow((ndl + 0.03) / 0.11, 2.0));
  vec3 sunsetCol = vec3(1.0, 0.44, 0.14) * exp(-alt / 16.0);

  // Mie forward scattering when looking almost straight into an orbital sunrise/sunset
  float cosSun = max(dot(rd, L), 0.0);
  float mie = pow(cosSun, 12.0) * 0.95 * smoothstep(-0.30, 0.18, ndl);

  float lit = smoothstep(-0.28, 0.16, ndl);
  vec3 col = dayCol * density * 1.35 * lit
           + sunsetCol * sunsetMask * surfaceSoft * outerFade * 1.10
           + vec3(1.0, 0.78, 0.50) * mie * density;

  float alpha = clamp(density * (0.95 * lit + 0.45 * sunsetMask) + mie * density * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col * exposure, alpha);
}`;

const starVert = /* glsl */ `
attribute float mag;
attribute vec3 tint;
uniform float gain;
uniform float pr;
varying vec3 vC;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float b = pow(2.512, -mag) * 44.0;
  vA = clamp(b * gain, 0.0, 1.0);
  vC = tint;
  gl_PointSize = clamp(1.15 + b * 0.65, 1.0, 3.4) * pr;
}`;

const starFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  float a = exp(-r * 15.0) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC * a, a);
}`;

const milkyVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const milkyFrag = /* glsl */ `
uniform sampler2D mwMap;
uniform float gain;
varying vec2 vUv;
void main() {
  vec3 c = pow(texture2D(mwMap, vUv).rgb, vec3(2.1));
  gl_FragColor = vec4(c * gain, 1.0);
}`;

export class Astro {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sunDir = new THREE.Vector3(0.82, 0.18, 0.54).normalize();
  earth: THREE.Mesh;
  clouds: THREE.Mesh;
  atmo: THREE.Mesh;
  moon: THREE.Mesh;
  sun: THREE.Sprite;
  milkyWay: THREE.Mesh;
  stars: THREE.Points;
  moonPos = new THREE.Vector3();
  earthRot = 2.30;
  cloudShift = 0;
  /** 0 = pleno Sol, 1 = umbra total */
  eclipse = 0;
  timeScale = 1;
  private earthMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private atmoMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private milkyMat: THREE.ShaderMaterial;
  private moonLight = new THREE.DirectionalLight(0xffffff, 3.1);
  private earthshine = new THREE.DirectionalLight(0x6f92cc, 0.035);

  constructor(base = 'textures/', anisotropy = 8) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3e6);
    const tl = new THREE.TextureLoader();
    const tex = (f: string, srgb = false, wrap = true) => {
      const t = tl.load(base + f);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      if (wrap) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
      return t;
    };

    const cloudTex = tex('earth_clouds.jpg');
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: tex('earth_day.jpg') },
        nightMap: { value: tex('earth_night.jpg') },
        cloudMap: { value: cloudTex },
        oceanMap: { value: tex('earth_ocean.jpg') },
        normalMap: { value: tex('earth_normal.jpg') },
        sunDir: { value: this.sunDir.clone() },
        cloudShift: { value: 0 },
        exposure: { value: 1 },
      },
      vertexShader: earthVert,
      fragmentShader: earthFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 192, 96), this.earthMat);

    // Elevated 3D cloud deck shell (altitude ~24 km scaled subtly for orbital depth & parallax!)
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        cloudMap: { value: cloudTex },
        sunDir: { value: this.sunDir.clone() },
        cloudShift: { value: 0 },
        exposure: { value: 1 },
      },
      vertexShader: earthVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.0038, 160, 80), this.cloudMat);

    // Multi-scattering Rayleigh/Mie outer atmospheric limb shell
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDir: { value: this.sunDir.clone() },
        earthCenter: { value: new THREE.Vector3() },
        exposure: { value: 1 },
      },
      vertexShader: earthVert,
      fragmentShader: atmoFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.032, 128, 64), this.atmoMat);

    // Moon (NASA LROC color + LOLA elevation bump)
    const moonMat = new THREE.MeshStandardMaterial({
      map: tex('moon.jpg', true),
      bumpMap: tex('moon_height.jpg'),
      bumpScale: 10,
      roughness: 0.96,
      metalness: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 160, 80), moonMat);

    // Sun disc (0.53° angular diameter + clean photographic corona glow)
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const g = sc.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.11, 'rgba(255,253,245,1)');
    grd.addColorStop(0.16, 'rgba(255,242,220,0.60)');
    grd.addColorStop(0.38, 'rgba(255,220,185,0.12)');
    grd.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const st = new THREE.CanvasTexture(sc);
    st.colorSpace = THREE.SRGBColorSpace;
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: st, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, color: new THREE.Color(3.2, 3.05, 2.85),
    }));

    // NASA SVS Deep Star Map Milky Way backdrop sphere (subtly visible when dark-adapted / eclipse!)
    this.milkyMat = new THREE.ShaderMaterial({
      uniforms: { mwMap: { value: tex('milkyway.jpg') }, gain: { value: 0.14 } },
      vertexShader: milkyVert,
      fragmentShader: milkyFrag,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(2.7e6, 48, 24), this.milkyMat);
    this.milkyWay.rotation.set(0.55, 0.8, 0.35);
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = -120;

    // 16,000 pinpoint stars with realistic magnitude distribution & spectral O/B/A/F/G/K/M tints
    const N = 16000, r = rng(7);
    const pos = new Float32Array(N * 3), mag = new Float32Array(N), tint = new Float32Array(N * 3);
    const gp = new THREE.Vector3(0.2, 0.9, -0.38).normalize();
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3();
      if (i < N * 0.38) {
        const a = r() * Math.PI * 2;
        const off = (r() - 0.5) * 0.24;
        const u = new THREE.Vector3(1, 0, 0).cross(gp).normalize();
        const w = gp.clone().cross(u);
        v.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).addScaledVector(gp, off).normalize();
      } else {
        const z = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        v.set(s * Math.cos(t), z, s * Math.sin(t));
      }
      v.multiplyScalar(2.5e6);
      pos.set([v.x, v.y, v.z], i * 3);
      mag[i] = 1.4 + Math.pow(r(), 0.35) * 6.2;
      const k = r();
      const c = k < 0.12 ? [0.74, 0.83, 1.0] : k < 0.72 ? [1, 0.98, 0.96] : k < 0.90 ? [1, 0.90, 0.74] : [1, 0.76, 0.56];
      tint.set(c, i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    sg.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { gain: { value: 0.35 }, pr: { value: 1 } },
      vertexShader: starVert,
      fragmentShader: starFrag,
      transparent: false,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -100;

    this.moonLight.position.copy(this.sunDir);
    this.scene.add(
      this.milkyWay, this.stars, this.sun, this.moon,
      this.earth, this.clouds, this.atmo,
      this.moonLight, this.moonLight.target, this.earthshine
    );
    this.scene.add(new THREE.AmbientLight(0x101620, 0.025));
    this.moonPos.set(-0.55, 0.12, -0.83).normalize().multiplyScalar(D_MOON);
  }

  scenarios(): Scenario[] {
    const s = this.sunDir;
    const up = new THREE.Vector3(0, 1, 0);
    const side = s.clone().cross(up).normalize();
    // LEO: dramatic sunlit ocean + continental coast + terminator sunset limb!
    const leoDir = s.clone().multiplyScalar(0.32).add(side.clone().multiplyScalar(0.91)).add(up.clone().multiplyScalar(0.24)).normalize();
    const lunarDir = this.sunDir.clone().multiplyScalar(-0.2).add(side.clone().multiplyScalar(-0.95)).normalize();
    const eclDir = s.clone().negate().add(side.clone().multiplyScalar(0.12)).normalize();
    return [
      { id: 'leo', label: 'Órbita terrestre baja', desc: '420 km sobre la Tierra, junto al terminador.', shipKm: leoDir.multiplyScalar(R_EARTH + 420) },
      { id: 'lunar', label: 'Órbita lunar', desc: '160 km sobre la Luna; la Tierra en el horizonte.', shipKm: this.moonPos.clone().add(lunarDir.multiplyScalar(R_MOON + 160)) },
      { id: 'eclipse', label: 'Sombra terrestre', desc: 'Lado nocturno de la Tierra: eclipse solar desde la nave.', shipKm: eclDir.multiplyScalar(R_EARTH + 900) },
    ];
  }

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

  update(dt: number, camKm: THREE.Vector3, quat: THREE.Quaternion, fov: number, aspect: number, exposure: number, pixelRatio: number) {
    this.earthRot += dt * this.timeScale * (2 * Math.PI / 86164) * 38;
    this.cloudShift = (this.cloudShift + dt * this.timeScale * 0.00055) % 1;
    this.camera.quaternion.copy(quat);
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.earth.position.copy(camKm).negate();
    this.earth.rotation.y = this.earthRot;
    this.clouds.position.copy(this.earth.position);
    this.clouds.rotation.y = this.earthRot;
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

    const cu = this.cloudMat.uniforms;
    cu.sunDir.value.copy(this.sunDir);
    cu.cloudShift.value = this.cloudShift;
    cu.exposure.value = exposure;

    this.atmoMat.uniforms.sunDir.value.copy(this.sunDir);
    this.atmoMat.uniforms.earthCenter.value.copy(this.earth.position);
    this.atmoMat.uniforms.exposure.value = exposure;

    const occE = this.occlusion(camKm, new THREE.Vector3(0, 0, 0), R_EARTH * 1.01);
    const occM = this.occlusion(camKm, this.moonPos, R_MOON);
    this.eclipse = Math.max(occE, occM);
    this.sun.material.opacity = 1 - this.eclipse;

    // Stars & subtle Milky Way adapt naturally with camera exposure and orbital eclipse
    const darkAdapt = Math.max(this.eclipse, exposure > 1.45 ? 0.65 : 0.0);
    this.starMat.uniforms.gain.value = 0.25 + darkAdapt * 0.95;
    this.starMat.uniforms.pr.value = pixelRatio;
    this.milkyMat.uniforms.gain.value = 0.055 + darkAdapt * 0.28;

    this.earthshine.position.copy(this.moonPos).negate().normalize();

    // Depth-free painter order: furthest first, with Clouds right on top of Earth and Atmosphere outer halo last!
    const bodies: [THREE.Object3D, number][] = [
      [this.sun, 1e7],
      [this.moon, this.moon.position.length()],
      [this.earth, this.earth.position.length()],
    ];
    bodies.sort((a, b) => b[1] - a[1]);
    bodies.forEach(([o], i) => (o.renderOrder = i * 4));
    this.clouds.renderOrder = this.earth.renderOrder + 1;
    this.atmo.renderOrder = this.earth.renderOrder + 2;

    this.camera.near = Math.max(0.05, Math.min(this.earth.position.length() - R_EARTH * 1.03, this.moon.position.length() - R_MOON) * 0.5);
    this.camera.updateProjectionMatrix();
  }

  altitude(posKm: THREE.Vector3): { body: 'Tierra' | 'Luna'; km: number; altKm: number; gravity: number } {
    const dE = posKm.length() - R_EARTH;
    const dM = posKm.distanceTo(this.moonPos) - R_MOON;
    if (dM < dE) {
      const km = Math.max(0, dM);
      return { body: 'Luna', km, altKm: km, gravity: 1.62 * Math.pow(R_MOON / (R_MOON + km), 2) };
    }
    const km = Math.max(0, dE);
    return { body: 'Tierra', km, altKm: km, gravity: 9.81 * Math.pow(R_EARTH / (R_EARTH + km), 2) };
  }

  earthDir(posKm: THREE.Vector3) { return posKm.clone().negate().normalize(); }
}
