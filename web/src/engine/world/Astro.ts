/**
 * ALCIÓN HX-4 — PROJECT ASCENSION
 * Entorno astronómico cinematográfico en escena lejana (unidades: km).
 *
 * - Tierra 4K NASA Blue Marble Next Generation + Black Marble 2016 + relieve topográfico
 *   + micro-detalle procedural 3D triplanar multiescala (sin costuras polares, acelerado por LUT RGBA)
 * - Océano físico con micro-oleaje 3D y especular GGX microfacet + Fresnel del agua (F0 = 0,02)
 * - Capa nubosa 3D con domain-warping, auto-sombreado volumétrico, silver-lining Mie
 *   y proyección de sombras nítidas por paralaje solar sobre continentes y océanos
 * - Atmósfera física por raymarching óptico (Rayleigh + Mie Henyey-Greenstein + terminador
 *   ámbar/carmesí + airglow verdoso sutil a ~92 km en el limbo nocturno)
 * - Luna LROC + LOLA con normales topográficas en shader, modelo de regolito
 *   Lommel-Seeliger / Oren-Nayar (sin brillo plástico) y earthshine azulado en fase nocturna
 * - Campo estelar fotométrico (22 000 estrellas con ley de potencias en magnitud e índice B-V)
 *   y Vía Láctea calibrada con adaptación de exposición orbital
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

/**
 * Construye una textura tileable 256x256 RGBA de ruido multiescala:
 *   R = ruido base suave (macro)
 *   G = FBM 4 octavas (relieve / nubes)
 *   B = ridge noise 3 octavas (cordilleras / cúmulos)
 *   A = micro-detalle de alta frecuencia (oleaje / grano)
 */
function buildNoiseLut(size = 256): THREE.DataTexture {
  const r = rng(107);
  const grid = (cells: number) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy) % cells;
      const y1 = (y0 + 1) % cells;
      const ty = fy - Math.floor(fy);
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx) % cells;
        const x1 = (x0 + 1) % cells;
        const tx = fx - Math.floor(fx);
        const sx = tx * tx * (3 - 2 * tx);
        const a = g[y0 * cells + x0], b = g[y0 * cells + x1];
        const c = g[y1 * cells + x0], d = g[y1 * cells + x1];
        out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
      }
    }
    return out;
  };
  const o1 = grid(6);
  const o2 = grid(12);
  const o3 = grid(24);
  const o4 = grid(48);
  const o5 = grid(96);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const fbm = (o1[i] * 0.50 + o2[i] * 0.25 + o3[i] * 0.15 + o4[i] * 0.10);
    const r1 = 1 - Math.abs(o2[i] * 2 - 1);
    const r2 = 1 - Math.abs(o3[i] * 2 - 1);
    const r3 = 1 - Math.abs(o4[i] * 2 - 1);
    const ridge = r1 * r1 * 0.55 + r2 * r2 * 0.30 + r3 * r3 * 0.15;
    const fine = o4[i] * 0.55 + o5[i] * 0.45;
    data[i * 4 + 0] = Math.round(Math.max(0, Math.min(1, o1[i])) * 255);
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, fbm)) * 255);
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, ridge)) * 255);
    data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, fine)) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Muestreo 3D triplanar sobre la LUT multiescala: 0 costuras polares, ~15x más rápido que FBM en ALU. */
const TRIPLANAR_GLSL = /* glsl */ `
vec3 rotY(vec3 p, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec4 triNoise(sampler2D lut, vec3 dir3, float freq) {
  vec3 p = dir3 * freq;
  vec3 w = abs(dir3);
  w = w * w * w;
  w /= max(w.x + w.y + w.z, 1e-4);
  vec4 tx = texture2D(lut, p.yz);
  vec4 ty = texture2D(lut, p.xz + vec2(0.37, 0.71));
  vec4 tz = texture2D(lut, p.xy + vec2(0.19, 0.53));
  return tx * w.x + ty * w.y + tz * w.z;
}

/** Densidad nubosa multiescala con domain warping 3D (compartida entre cloudFrag y sombras en earthFrag). */
float evalCloudLut(sampler2D cmap, sampler2D lut, vec2 uv, vec3 dir3, float shift, float nearAmt) {
  vec2 cuv = vec2(fract(uv.x + shift), clamp(uv.y, 0.002, 0.998));
  float baseC = texture2D(cmap, cuv).r;
  if (baseC < 0.012) return 0.0;
  if (nearAmt < 0.02) return baseC;

  vec3 p = rotY(dir3, -shift * 6.2831853);
  vec4 w = triNoise(lut, p, 11.0);
  vec3 warped = normalize(p + (vec3(w.r, w.g, w.b) - 0.5) * 0.010);
  vec4 d1 = triNoise(lut, warped, 38.0);
  vec4 d2 = triNoise(lut, warped, 112.0);
  float detail = d1.g * 0.56 + d2.b * 0.26 + d2.a * 0.18;

  float sculpted = smoothstep(0.09, 0.85, baseC * (0.64 + 0.78 * detail) + (detail - 0.48) * 0.18 * smoothstep(0.05, 0.34, baseC));
  sculpted = max(sculpted, smoothstep(0.66, 0.96, baseC) * 0.95);
  return mix(baseC, sculpted, nearAmt * 0.88);
}
`;

const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
varying vec3 vDir;
void main() {
  vUv = uv;
  vDir = normalize(position);
  mat3 m3 = mat3(modelMatrix);
  vN = normalize(m3 * normal);
  vec3 upAxis = abs(vN.y) > 0.995 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(upAxis, vN));
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
uniform sampler2D noiseLut;
uniform vec3 sunDir;
uniform float cloudShift;
uniform float exposure;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
varying vec3 vDir;

${TRIPLANAR_GLSL}

void main() {
  vec3 Ngeom = normalize(vN);
  vec3 T = normalize(vT);
  vec3 B = normalize(vB);
  vec3 V = normalize(-vW);
  vec3 L = normalize(sunDir);
  vec3 dir3 = normalize(vDir);

  float distKm = length(vW);
  float nearDetail = smoothstep(4200.0, 420.0, distKm);
  float ultraNear = smoothstep(1850.0, 420.0, distKm);

  float oceanRaw = texture2D(oceanMap, vUv).r;
  float ocean = smoothstep(0.28, 0.72, oceanRaw);
  float landMask = 1.0 - ocean;
  float coastBand = smoothstep(0.04, 0.45, oceanRaw) * smoothstep(0.96, 0.55, oceanRaw);

  vec3 dayTex = pow(max(texture2D(dayMap, vUv).rgb, vec3(0.0)), vec3(2.2));
  vec3 Tobj = normalize(abs(dir3.y) > 0.995 ? cross(vec3(1.0, 0.0, 0.0), dir3) : cross(vec3(0.0, 1.0, 0.0), dir3));
  vec3 Bobj = cross(dir3, Tobj);

  // Micro-detalle continental triplanar sin costuras polares (cordilleras, valles, costas)
  vec3 landAlbedo = dayTex;
  vec3 Nland = Ngeom;
  if (landMask > 0.01) {
    vec3 nTex = texture2D(normalMap, vUv).rgb * 2.0 - 1.0;
    vec2 procSlope = vec2(0.0);
    if (nearDetail > 0.01) {
      vec4 tMacro = triNoise(noiseLut, dir3, 34.0);
      vec4 tFine  = triNoise(noiseLut, dir3, 118.0);
      float greenness = clamp((dayTex.g - max(dayTex.r, dayTex.b) * 0.85) * 4.0, 0.0, 1.0);
      float aridity = clamp(1.0 - greenness * 0.72, 0.28, 1.0);
      float elev = mix(tMacro.g * 0.65 + tFine.g * 0.35, tMacro.b * 0.60 + tFine.b * 0.40, 0.60 * aridity);

      float albedoMod = 1.0 + ((elev - 0.48) * 0.28 + (tFine.a - 0.5) * 0.12) * nearDetail;
      landAlbedo = dayTex * clamp(albedoMod, 0.76, 1.26);
      landAlbedo = mix(landAlbedo, landAlbedo * vec3(1.06, 1.02, 0.95), coastBand * nearDetail * 0.38);

      float eps = 0.00055;
      float eT = triNoise(noiseLut, normalize(dir3 + Tobj * eps), 34.0).b * 0.6 + triNoise(noiseLut, normalize(dir3 + Tobj * eps), 118.0).b * 0.4;
      float eB = triNoise(noiseLut, normalize(dir3 + Bobj * eps), 34.0).b * 0.6 + triNoise(noiseLut, normalize(dir3 + Bobj * eps), 118.0).b * 0.4;
      float e0 = tMacro.b * 0.6 + tFine.b * 0.4;
      procSlope = vec2(e0 - eT, e0 - eB) * (2.4 * aridity * nearDetail);
    }
    Nland = normalize(Ngeom + T * (nTex.x * 0.55 + procSlope.x) + B * (nTex.y * 0.55 + procSlope.y));
  }

  // Océano profundo calibrado + micro-oleaje anisotrópico 3D sin aliasing lejano
  vec3 oceanAlbedo = dayTex;
  vec3 Nocean = Ngeom;
  float waveCrest = 0.5;
  float windPatch = 0.45;
  if (ocean > 0.01) {
    float shallowWater = clamp((dayTex.g + dayTex.b) * 1.4 - dayTex.r * 1.6, 0.0, 1.0);
    oceanAlbedo = mix(dayTex * vec3(0.80, 0.92, 1.11), dayTex * vec3(0.88, 1.03, 1.12), shallowWater * 0.65);
    vec4 wMacro = triNoise(noiseLut, dir3, 16.0);
    windPatch = wMacro.g;
    oceanAlbedo *= 1.0 + (windPatch - 0.5) * 0.05 * nearDetail;
    if (nearDetail > 0.01) {
      vec3 dShift = rotY(dir3, cloudShift * 0.8);
      vec3 dShift2 = rotY(dir3, -cloudShift * 1.3);
      vec4 w0 = triNoise(noiseLut, dShift, 340.0);
      vec4 w1 = triNoise(noiseLut, dShift2, 780.0);
      waveCrest = w0.a * 0.52 + w1.a * 0.48;
      float epsW = 0.00018;
      float h0 = w0.g * 0.55 + w1.a * 0.45;
      float hT = triNoise(noiseLut, normalize(dShift + Tobj * epsW), 340.0).g * 0.55 + triNoise(noiseLut, normalize(dShift2 + Tobj * epsW), 780.0).a * 0.45;
      float hB = triNoise(noiseLut, normalize(dShift + Bobj * epsW), 340.0).g * 0.55 + triNoise(noiseLut, normalize(dShift2 + Bobj * epsW), 780.0).a * 0.45;
      float waveAmp = (0.30 * nearDetail + 0.18 * ultraNear);
      Nocean = normalize(Ngeom + (T * (h0 - hT) * 1.25 + B * (h0 - hB) * 0.85) * waveAmp);
    }
  }

  vec3 albedo = mix(landAlbedo, oceanAlbedo, ocean);
  vec3 N = normalize(mix(Nland, Nocean, ocean));

  float ndlGeom = dot(Ngeom, L);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(Ngeom, V), 0.001);

  // Cobertura nubosa local y sombra proyectada con paralaje solar realista (~15 km de altitud)
  vec2 cuv = vec2(fract(vUv.x + cloudShift), clamp(vUv.y, 0.002, 0.998));
  float cloudHere = texture2D(cloudMap, cuv).r;
  float cloudShadow = 0.0;
  if (ndlGeom > -0.05) {
    float sunElev = max(ndlGeom, 0.22);
    float parallaxScale = clamp(15.0 / (6371.0 * sunElev), 0.0016, 0.0085);
    vec3 L_tan = L - Ngeom * ndlGeom;
    float cosLat = max(sqrt(max(1.0 - dir3.y * dir3.y, 0.04)), 0.2);
    vec2 sunUvShift = vec2(dot(L_tan, T) / (cosLat * 6.2831853), -dot(L_tan, B) * 0.31830988) * parallaxScale;
    vec3 L_obj_tan = normalize(Tobj * dot(L_tan, T) + Bobj * dot(L_tan, B) + vec3(1e-6));
    vec3 shadowDir3 = normalize(dir3 + L_obj_tan * parallaxScale);
    vec2 shadowUv = vec2(fract(vUv.x + sunUvShift.x), clamp(vUv.y + sunUvShift.y, 0.002, 0.998));
    cloudShadow = evalCloudLut(cloudMap, noiseLut, shadowUv, shadowDir3, cloudShift, nearDetail);
  }
  float shadowStrength = clamp(cloudShadow * 0.78 * smoothstep(-0.04, 0.14, ndlGeom), 0.0, 0.78);

  // Iluminación difusa con enrojecimiento atmosférico en el terminador y luz celeste Rayleigh en sombras
  float wrapTerm = smoothstep(-0.14, 0.20, ndlGeom);
  vec3 sunTint = mix(vec3(1.22, 0.44, 0.16), vec3(1.02, 0.99, 0.96), smoothstep(-0.03, 0.26, ndlGeom));
  vec3 skyFill = vec3(0.055, 0.115, 0.22) * smoothstep(-0.06, 0.28, ndlGeom);
  vec3 directDiff = albedo * sunTint * ndl * 1.18 * (1.0 - shadowStrength);
  vec3 ambientDiff = albedo * (skyFill * (0.45 + 0.55 * (1.0 - cloudShadow)) + vec3(0.012, 0.018, 0.028) * wrapTerm);
  vec3 lit = directDiff + ambientDiff;

  // Especular oceánico físico GGX microfacet + Fresnel Schlick del agua (F0 = 0.02)
  vec3 glint = vec3(0.0);
  if (ocean > 0.01 && ndlGeom > -0.02) {
    vec3 H = normalize(L + V);
    float ndh = max(dot(Nocean, H), 0.0);
    float ndlO = max(dot(Nocean, L), 0.0);
    float ndvO = max(dot(Nocean, V), 0.001);
    float vdh = max(dot(V, H), 0.0);

    // Rugosidad Cox-Munk modulada por parches de viento/oleaje (0.14 - 0.22)
    float rough = mix(0.14, 0.22, windPatch) + (1.0 - ndv) * 0.035;
    float a = rough * rough;
    float a2 = a * a;
    float denom = ndh * ndh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159265 * max(denom * denom, 1e-5));
    float k = (rough + 1.0) * (rough + 1.0) * 0.125;
    float Gv = ndvO / (ndvO * (1.0 - k) + k);
    float Gl = ndlO / (ndlO * (1.0 - k) + k);
    float F = 0.02 + 0.98 * pow(clamp(1.0 - vdh, 0.0, 1.0), 5.0);
    float ggx = (D * Gv * Gl * F) / max(4.0 * ndvO * ndlO, 0.004);
    float sparkle = 0.72 + 0.58 * smoothstep(0.42, 0.84, waveCrest) * nearDetail;
    float glintMask = ocean * (1.0 - smoothstep(0.04, 0.80, max(cloudHere, cloudShadow * 0.88)) * 0.96) * smoothstep(-0.02, 0.14, ndlGeom);
    vec3 glintTint = mix(vec3(1.15, 0.56, 0.22), vec3(1.05, 0.98, 0.90), smoothstep(0.0, 0.28, ndlGeom));
    glint = glintTint * min(ggx * ndlO * sparkle * 3.4, 2.8) * glintMask;
  }

  vec3 col = lit + glint;

  // NASA Black Marble: luces urbanas nocturnas con temperatura cálida realista y halo bajo nubes
  if (ndlGeom < 0.08) {
    vec3 nightTex = texture2D(nightMap, vUv).rgb;
    float cityLum = dot(nightTex, vec3(0.299, 0.587, 0.114));
    float cityPow = pow(max(cityLum, 0.0), 1.65);
    vec3 cityCol = mix(vec3(1.0, 0.52, 0.18), vec3(1.0, 0.86, 0.62), smoothstep(0.18, 0.85, cityLum)) * cityPow;
    float nightMask = smoothstep(0.06, -0.14, ndlGeom);
    float cloudAtten = 1.0 - 0.82 * smoothstep(0.08, 0.85, cloudHere);
    float cityGlow = smoothstep(0.05, 0.65, cityLum) * cloudHere * 0.22;
    col += (cityCol * cloudAtten * 2.15 + vec3(0.95, 0.52, 0.22) * cityGlow) * nightMask;
  }

  // Perspectiva aérea Rayleigh hacia el limbo terrestre
  float opticalRim = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.1);
  float limbEdge = pow(clamp(1.0 - ndv, 0.0, 1.0), 6.2);
  float sunsetBand = exp(-pow((ndlGeom + 0.015) / 0.12, 2.0));
  vec3 rayleighCol = mix(vec3(0.16, 0.50, 0.98), vec3(1.0, 0.44, 0.14), sunsetBand * 0.78);
  float atmoVis = smoothstep(-0.18, 0.24, ndlGeom);
  col = mix(col, rayleighCol * 1.05, clamp(opticalRim * 0.42 * atmoVis, 0.0, 0.68));
  col += mix(vec3(0.32, 0.72, 1.0), vec3(1.0, 0.52, 0.20), sunsetBand * 0.65) * limbEdge * 0.68 * smoothstep(-0.08, 0.28, ndlGeom);

  gl_FragColor = vec4(max(col, vec3(0.0)) * exposure, 1.0);
}`;

const cloudFrag = /* glsl */ `
uniform sampler2D cloudMap;
uniform sampler2D noiseLut;
uniform vec3 sunDir;
uniform float cloudShift;
uniform float exposure;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
varying vec3 vDir;

${TRIPLANAR_GLSL}

void main() {
  vec3 N = normalize(vN);
  vec3 T = normalize(vT);
  vec3 B = normalize(vB);
  vec3 V = normalize(-vW);
  vec3 L = normalize(sunDir);
  vec3 dir3 = normalize(vDir);

  float distKm = length(vW);
  float nearDetail = smoothstep(3800.0, 420.0, distKm);

  float c = evalCloudLut(cloudMap, noiseLut, vUv, dir3, cloudShift, nearDetail);
  if (c < 0.015) discard;

  // Auto-sombreado volumétrico en dos escalas hacia el Sol
  vec3 L_tan = L - N * dot(N, L);
  float cosLat = max(sqrt(max(1.0 - dir3.y * dir3.y, 0.04)), 0.2);
  vec2 uvStep = vec2(dot(L_tan, T) / (cosLat * 6.2831853), -dot(L_tan, B) * 0.31830988);
  vec3 Tobj = normalize(abs(dir3.y) > 0.995 ? cross(vec3(1.0, 0.0, 0.0), dir3) : cross(vec3(0.0, 1.0, 0.0), dir3));
  vec3 Bobj = cross(dir3, Tobj);
  vec3 L_obj = normalize(Tobj * dot(L_tan, T) + Bobj * dot(L_tan, B) + vec3(1e-6));

  float cSun = evalCloudLut(cloudMap, noiseLut, vUv + uvStep * 0.0016, normalize(dir3 + L_obj * 0.0016), cloudShift, nearDetail);
  float slopeShadow = clamp((cSun - c) * 1.45, -0.28, 0.72);
  float selfLit = clamp(1.0 - slopeShadow * 0.62, 0.52, 1.22);

  // Dispersión frontal Henyey-Greenstein (silver-lining en bordes finos mirando hacia el Sol)
  float cosTheta = dot(-V, L);
  float g = 0.62;
  float hg = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.05), 1.5));
  float thinEdge = (1.0 - smoothstep(0.25, 0.85, c)) * smoothstep(0.02, 0.25, c);
  float silverLining = clamp(hg * 0.35, 0.0, 1.2) * (0.25 + 0.75 * thinEdge);

  float ndl = dot(N, L);
  float ndv = max(dot(N, V), 0.0);
  float lit = max(ndl, 0.0);
  float wrap = smoothstep(-0.14, 0.16, ndl);

  vec3 dayTint = vec3(1.0, 0.995, 0.985);
  vec3 sunsetTint = vec3(1.22, 0.50, 0.22);
  vec3 cloudShadowTint = vec3(0.46, 0.58, 0.78);
  vec3 nightAmbient = vec3(0.010, 0.018, 0.036);

  vec3 sunCol = mix(sunsetTint, dayTint, smoothstep(-0.02, 0.20, ndl));
  vec3 directCloud = mix(cloudShadowTint * sunCol * 0.58, sunCol * 1.12, smoothstep(0.42, 1.08, selfLit)) * lit;
  vec3 cloudCol = directCloud + sunCol * (silverLining * 0.42 * smoothstep(-0.08, 0.18, ndl) + 0.04 * wrap) + nightAmbient * (1.0 - wrap);

  float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.3);
  cloudCol = mix(cloudCol, vec3(0.24, 0.58, 1.0) * (0.42 + 0.62 * lit), rim * 0.36 * wrap);

  float alpha = clamp(c * 0.95, 0.0, 0.95);
  gl_FragColor = vec4(max(cloudCol, vec3(0.0)) * exposure, alpha);
}`;

const atmoFrag = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 earthCenter;
uniform float exposure;
varying vec3 vN;
varying vec3 vW;

const float R_E = 6371.0;
const float R_ATMO = 6525.0; // +154 km
const float H_R = 8.5;       // altura de escala Rayleigh (km)
const float H_M = 1.6;       // altura de escala Mie (km)
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331);
const float BETA_M = 0.0032;

vec2 raySphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec2 sunOpticalDepth(vec3 p, vec3 L) {
  float r = length(p);
  float alt = max(r - R_E, 0.0);
  float mu = dot(p / r, L);
  float perp = length(p - L * dot(p, L));
  float earthShadow = (dot(p, L) < 0.0) ? smoothstep(R_E - 18.0, R_E + 22.0, perp) : 1.0;
  float chapR = 1.0 / (max(mu, 0.0) + 0.14 * pow(max(1.0 - mu, 0.0), 3.0) + 0.035);
  float chapM = 1.0 / (max(mu, 0.0) + 0.09 * pow(max(1.0 - mu, 0.0), 3.0) + 0.028);
  float minAlt = (mu < 0.0) ? max(perp - R_E, 0.0) : alt;
  float odR = H_R * exp(-minAlt / H_R) * min(chapR, 34.0);
  float odM = H_M * exp(-minAlt / H_M) * min(chapM, 42.0);
  float block = mix(180.0, 0.0, earthShadow);
  return vec2(odR + block, odM + block);
}

void main() {
  vec3 rd = normalize(vW);
  float tClosest = max(dot(earthCenter, rd), 0.0);
  float b = length(rd * tClosest - earthCenter);
  if (b < R_E - 8.0) discard;

  vec3 ro = -earthCenter;
  vec2 hitAtmo = raySphere(ro, rd, R_ATMO);
  if (hitAtmo.y < 0.0) discard;

  float t0 = max(hitAtmo.x, 0.0);
  float t1 = hitAtmo.y;
  float limbSoft = smoothstep(-8.0, 5.0, b - R_E);
  if (b < R_E) t1 = min(t1, tClosest);
  if (t1 <= t0) discard;

  vec3 L = normalize(sunDir);
  float cosTheta = dot(rd, L);

  float phaseR = 0.0596831 * (1.0 + cosTheta * cosTheta);
  float g = 0.78;
  float g2 = g * g;
  float phaseM = 0.0795775 * ((1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.02), 1.5));

  const int STEPS = 6;
  float segLen = (t1 - t0) / float(STEPS);
  float viewOdR = 0.0;
  float viewOdM = 0.0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);

  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + 0.5) * segLen;
    vec3 p = ro + rd * t;
    float alt = max(length(p) - R_E, 0.0);
    float dR = exp(-alt / H_R) * segLen;
    float dM = exp(-alt / H_M) * segLen;
    viewOdR += dR;
    viewOdM += dM;

    vec2 sOd = sunOpticalDepth(p, L);
    // Suavizamos la auto-extinción tangencial en el canal azul del lado diurno para modelar
    // dispersión múltiple de orden superior (evita banda ocre falsa en el limbo soleado)
    float dayHere = smoothstep(-0.04, 0.20, dot(normalize(p), L));
    vec3 effViewTau = BETA_R * viewOdR * mix(1.0, 0.32, dayHere);
    vec3 tau = effViewTau + BETA_R * sOd.x + vec3(BETA_M * 1.1) * (viewOdM * mix(1.0, 0.45, dayHere) + sOd.y);
    vec3 atten = exp(-clamp(tau, vec3(0.0), vec3(40.0)));
    sumR += dR * atten;
    sumM += dM * atten;
  }

  vec3 closestPt = rd * tClosest - earthCenter;
  float altMin = max(b - R_E, 0.0);
  float ndlLimb = dot(normalize(closestPt), L);

  vec3 scatter = (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM) * 13.5;

  // Dispersión múltiple Rayleigh en troposfera/estratosfera diurna: cian-blanco en alt=0 -> zafiro eléctrico -> cobalto
  float dayLimb = smoothstep(-0.10, 0.24, ndlLimb);
  vec3 lowCyan = vec3(0.56, 0.86, 1.0);
  vec3 midSapphire = vec3(0.14, 0.48, 1.0);
  vec3 highCobalt = vec3(0.03, 0.14, 0.62);
  vec3 multiCol = mix(lowCyan, midSapphire, smoothstep(0.0, 26.0, altMin));
  multiCol = mix(multiCol, highCobalt, smoothstep(22.0, 78.0, altMin));
  vec3 multiScatter = multiCol * (exp(-altMin / 20.0) * 0.92 + exp(-altMin / 54.0) * 0.22) * dayLimb;

  // Terminador ámbar-carmesí restringido estrictamente a la franja solar crepuscular (ndlLimb ~ 0)
  float termBand = exp(-pow((ndlLimb + 0.02) / 0.11, 2.0));
  vec3 termGlow = vec3(1.0, 0.42, 0.14) * exp(-altMin / 16.0) * termBand * 0.65;

  // Airglow de oxígeno atómico (557,7 nm) muy sutil a ~92 km en el limbo nocturno/crepuscular
  float nightSide = smoothstep(0.08, -0.22, ndlLimb);
  float airglowBand = exp(-pow((altMin - 92.0) / 14.0, 2.0));
  vec3 airglow = vec3(0.14, 0.52, 0.28) * airglowBand * nightSide * 0.16;

  float outerFade = smoothstep(148.0, 68.0, altMin);
  vec3 col = (scatter * mix(1.0, 0.55, dayLimb) + multiScatter + termGlow + airglow) * limbSoft * outerFade;
  float lum = max(col.r, max(col.g, col.b));
  float alpha = clamp(lum * 1.15, 0.0, 1.0);

  gl_FragColor = vec4(max(col, vec3(0.0)) * exposure, alpha);
}`;

const moonVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
varying vec3 vDir;
void main() {
  vUv = uv;
  vDir = normalize(position);
  mat3 m3 = mat3(modelMatrix);
  vN = normalize(m3 * normal);
  vec3 upAxis = abs(vN.y) > 0.995 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(upAxis, vN));
  vT = t;
  vB = cross(vN, t);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const moonFrag = /* glsl */ `
uniform sampler2D moonMap;
uniform sampler2D heightMap;
uniform sampler2D noiseLut;
uniform vec3 sunDir;
uniform vec3 earthDir;
uniform float exposure;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying vec3 vT;
varying vec3 vB;
varying vec3 vDir;

${TRIPLANAR_GLSL}

void main() {
  vec3 Ngeom = normalize(vN);
  vec3 T = normalize(vT);
  vec3 B = normalize(vB);
  vec3 V = normalize(-vW);
  vec3 L = normalize(sunDir);
  vec3 dir3 = normalize(vDir);

  float distKm = length(vW);
  float nearLunar = smoothstep(2600.0, 180.0, distKm);

  // Muestreo en cruz de moon_height.jpg (LOLA) para normales de cráteres y cordilleras nítidas
  vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
  float hL = texture2D(heightMap, vec2(fract(vUv.x - texel.x), vUv.y)).r;
  float hR = texture2D(heightMap, vec2(fract(vUv.x + texel.x), vUv.y)).r;
  float hD = texture2D(heightMap, vec2(vUv.x, clamp(vUv.y - texel.y, 0.001, 0.999))).r;
  float hU = texture2D(heightMap, vec2(vUv.x, clamp(vUv.y + texel.y, 0.001, 0.999))).r;

  float microH = 0.5;
  float microDx = 0.0;
  float microDy = 0.0;
  if (nearLunar > 0.01) {
    vec3 Tobj = normalize(abs(dir3.y) > 0.995 ? cross(vec3(1.0, 0.0, 0.0), dir3) : cross(vec3(0.0, 1.0, 0.0), dir3));
    vec3 Bobj = cross(dir3, Tobj);
    float eps = 0.0006;
    vec4 m0 = triNoise(noiseLut, dir3, 72.0);
    float mT = triNoise(noiseLut, normalize(dir3 + Tobj * eps), 72.0).g;
    float mB = triNoise(noiseLut, normalize(dir3 + Bobj * eps), 72.0).g;
    microH = m0.g * 0.6 + m0.a * 0.4;
    microDx = (m0.g - mT) * 1.8 * nearLunar;
    microDy = (m0.g - mB) * 1.8 * nearLunar;
  }

  float bumpStrength = 3.6;
  vec3 N = normalize(Ngeom + T * ((hL - hR) * bumpStrength + microDx) + B * ((hU - hD) * bumpStrength + microDy));

  vec3 albedo = pow(max(texture2D(moonMap, vUv).rgb, vec3(0.0)), vec3(2.2));
  if (nearLunar > 0.01) {
    albedo *= 1.0 + (microH - 0.5) * 0.16 * nearLunar;
  }

  // Sombreado de regolito lunar: mezcla Lommel-Seeliger + Oren-Nayar (cero brillo plástico)
  float ndlGeom = dot(Ngeom, L);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 0.001);

  float sigma2 = 0.85;
  float A = 1.0 - 0.5 * (sigma2 / (sigma2 + 0.33));
  float B_on = 0.45 * (sigma2 / (sigma2 + 0.09));
  float thetaI = acos(clamp(ndl, 0.0, 1.0));
  float thetaR = acos(clamp(ndv, 0.0, 1.0));
  float alpha = max(thetaI, thetaR);
  float beta = min(thetaI, thetaR);
  vec3 Lperp = normalize(L - N * ndl + vec3(1e-5));
  vec3 Vperp = normalize(V - N * ndv + vec3(1e-5));
  float cosPhi = max(dot(Lperp, Vperp), 0.0);
  float orenNayar = ndl * (A + B_on * cosPhi * sin(alpha) * tan(beta));

  float lommel = ndl / max(ndl + ndv, 0.08);
  float phaseBoost = 1.0 + 0.22 * pow(max(dot(L, V), 0.0), 8.0);
  float regolith = mix(orenNayar, lommel * 1.45, 0.48) * phaseBoost;

  float horizonMask = smoothstep(-0.025, 0.035, ndlGeom);
  vec3 direct = albedo * vec3(1.04, 1.01, 0.96) * regolith * horizonMask * 1.45;

  // Luz cenicienta terrestre (earthshine) azulada sutil en la cara nocturna
  float ndE = max(dot(N, normalize(earthDir)), 0.0);
  vec3 earthshine = albedo * vec3(0.24, 0.44, 0.78) * (ndE * 0.024 + 0.0025);

  vec3 col = direct + earthshine;
  gl_FragColor = vec4(max(col, vec3(0.0)) * exposure, 1.0);
}`;

const starVert = /* glsl */ `
attribute float mag;
attribute vec3 tint;
uniform float gain;
uniform float pr;
varying vec3 vC;
varying float vFlux;
varying float vBright;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flux = pow(2.5118864, -(mag - 1.2));
  vFlux = flux * gain;
  vBright = smoothstep(1.9, -0.5, mag);
  vC = tint;
  float sz = mix(1.15 + clamp(flux * 0.42, 0.0, 1.1), 2.6 + vBright * 2.1, vBright);
  gl_PointSize = clamp(sz, 1.05, 4.8) * pr;
}`;

const starFrag = /* glsl */ `
varying vec3 vC;
varying float vFlux;
varying float vBright;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float core = exp(-r2 * mix(28.0, 46.0, vBright));
  float halo = exp(-r2 * 8.5) * vBright * 0.30;
  float intensity = (core + halo) * vFlux;
  if (intensity < 0.0025) discard;
  vec3 col = mix(vC, vec3(1.0), clamp(core * vBright * 0.55, 0.0, 0.65));
  gl_FragColor = vec4(col * min(intensity, 3.8), clamp(intensity, 0.0, 1.0));
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
  vec3 raw = texture2D(mwMap, vUv).rgb;
  vec3 lin = pow(max(raw - vec3(0.028), vec3(0.0)), vec3(2.25));
  gl_FragColor = vec4(lin * gain, 1.0);
}`;

/** Convierte índice de color fotométrico B-V (-0.35..+1.8) a tinte RGB lineal aproximado (planckiano). */
function bvToRgb(bv: number): [number, number, number] {
  const t = Math.max(-0.35, Math.min(1.8, bv));
  let r = 1, g = 1, b = 1;
  if (t < 0.0) {
    const k = (t + 0.35) / 0.35;
    r = 0.62 + 0.28 * k;
    g = 0.76 + 0.19 * k;
    b = 1.0;
  } else if (t < 0.4) {
    const k = t / 0.4;
    r = 0.90 + 0.10 * k;
    g = 0.95 + 0.04 * k;
    b = 1.0 - 0.05 * k;
  } else if (t < 0.8) {
    const k = (t - 0.4) / 0.4;
    r = 1.0;
    g = 0.99 - 0.09 * k;
    b = 0.95 - 0.24 * k;
  } else if (t < 1.3) {
    const k = (t - 0.8) / 0.5;
    r = 1.0;
    g = 0.90 - 0.16 * k;
    b = 0.71 - 0.26 * k;
  } else {
    const k = (t - 1.3) / 0.5;
    r = 1.0;
    g = 0.74 - 0.16 * k;
    b = 0.45 - 0.16 * k;
  }
  return [r, g, b];
}

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
  private moonMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private milkyMat: THREE.ShaderMaterial;
  private tmpFwd = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

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
    const noiseLut = buildNoiseLut(256);

    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: tex('earth_day.jpg') },
        nightMap: { value: tex('earth_night.jpg') },
        cloudMap: { value: cloudTex },
        oceanMap: { value: tex('earth_ocean.jpg') },
        normalMap: { value: tex('earth_normal.jpg') },
        noiseLut: { value: noiseLut },
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

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        cloudMap: { value: cloudTex },
        noiseLut: { value: noiseLut },
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
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.0024, 160, 80), this.cloudMat);

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
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH + 154, 128, 64), this.atmoMat);

    this.moonMat = new THREE.ShaderMaterial({
      uniforms: {
        moonMap: { value: tex('moon.jpg') },
        heightMap: { value: tex('moon_height.jpg') },
        noiseLut: { value: noiseLut },
        sunDir: { value: this.sunDir.clone() },
        earthDir: { value: new THREE.Vector3(1, 0, 0) },
        exposure: { value: 1 },
      },
      vertexShader: moonVert,
      fragmentShader: moonFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 160, 80), this.moonMat);

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

    // 22 000 estrellas con distribución fotométrica por ley de potencias en magnitud e índice B-V físico
    const N = 22000;
    const r = rng(19);
    const pos = new Float32Array(N * 3);
    const mag = new Float32Array(N);
    const tint = new Float32Array(N * 3);

    const gp = new THREE.Vector3(0, 1, 0).applyEuler(this.milkyWay.rotation).normalize();
    const uGal = new THREE.Vector3(1, 0, 0).cross(gp).normalize();
    const wGal = gp.clone().cross(uGal).normalize();

    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3();
      if (i < N * 0.44) {
        const a = r() * Math.PI * 2;
        const lat = ((r() + r() + r()) / 3 - 0.5) * 0.46;
        const cl = Math.cos(lat);
        v.copy(uGal).multiplyScalar(Math.cos(a) * cl).addScaledVector(wGal, Math.sin(a) * cl).addScaledVector(gp, Math.sin(lat)).normalize();
      } else {
        const z = r() * 2 - 1;
        const t = r() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - z * z));
        v.set(s * Math.cos(t), z, s * Math.sin(t));
      }
      v.multiplyScalar(2.5e6);
      pos.set([v.x, v.y, v.z], i * 3);

      let m: number;
      if (i < 38) {
        m = -0.9 + Math.pow(r(), 0.72) * 2.35;
      } else {
        const u = Math.max(1e-4, r());
        m = Math.max(1.25, Math.min(6.9, 6.9 + Math.log10(u) / 0.44));
      }
      mag[i] = m;

      const sp = r();
      let bv: number;
      if (sp < 0.08) bv = -0.30 + r() * 0.28;
      else if (sp < 0.28) bv = -0.02 + r() * 0.34;
      else if (sp < 0.54) bv = 0.32 + r() * 0.28;
      else if (sp < 0.76) bv = 0.60 + r() * 0.25;
      else if (sp < 0.93) bv = 0.85 + r() * 0.45;
      else bv = 1.30 + r() * 0.45;
      tint.set(bvToRgb(bv), i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    sg.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { gain: { value: 0.42 }, pr: { value: 1 } },
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

    this.scene.add(
      this.milkyWay, this.stars, this.sun, this.moon,
      this.earth, this.clouds, this.atmo
    );
    this.moonPos.set(-0.55, 0.12, -0.83).normalize().multiplyScalar(D_MOON);
  }

  scenarios(): Scenario[] {
    const s = this.sunDir;
    const up = new THREE.Vector3(0, 1, 0);
    const side = s.clone().cross(up).normalize();
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

    const mu = this.moonMat.uniforms;
    mu.sunDir.value.copy(this.sunDir);
    mu.earthDir.value.copy(this.earth.position).sub(this.moon.position).normalize();
    mu.exposure.value = exposure;

    const occE = this.occlusion(camKm, new THREE.Vector3(0, 0, 0), R_EARTH * 1.01);
    const occM = this.occlusion(camKm, this.moonPos, R_MOON);
    this.eclipse = Math.max(occE, occM);
    this.sun.material.opacity = 1 - this.eclipse;

    this.tmpFwd.set(0, 0, -1).applyQuaternion(quat).normalize();
    const sunGlare = Math.pow(Math.max(0, this.tmpFwd.dot(this.sunDir)), 3.0) * (1 - this.eclipse);
    const dEarth = this.earth.position.length();
    this.tmpDir.copy(this.earth.position).divideScalar(Math.max(dEarth, 1));
    const earthSunlit = Math.max(0, camKm.clone().normalize().dot(this.sunDir) * 0.5 + 0.5);
    const earthProximity = Math.min(1, R_EARTH / Math.max(dEarth - R_EARTH * 0.4, 1));
    const earthGlare = Math.max(0, this.tmpFwd.dot(this.tmpDir)) * earthSunlit * earthProximity * (1 - this.eclipse * 0.85);
    const glare = Math.min(1, sunGlare * 0.85 + earthGlare * 0.72);
    const darkAdapt = Math.max(this.eclipse, exposure > 1.45 ? 0.65 : 0.0);

    this.starMat.uniforms.gain.value = (0.54 - glare * 0.24) + darkAdapt * 0.90;
    this.starMat.uniforms.pr.value = pixelRatio;
    this.milkyMat.uniforms.gain.value = Math.max(0.025, (0.105 - glare * 0.072) + darkAdapt * 0.36);

    const bodies: [THREE.Object3D, number][] = [
      [this.sun, 1e7],
      [this.moon, this.moon.position.length()],
      [this.earth, this.earth.position.length()],
    ];
    bodies.sort((a, b) => b[1] - a[1]);
    bodies.forEach(([o], i) => (o.renderOrder = i * 4));
    this.clouds.renderOrder = this.earth.renderOrder + 1;
    this.atmo.renderOrder = this.earth.renderOrder + 2;

    this.camera.near = Math.max(0.05, Math.min(this.earth.position.length() - (R_EARTH + 160), this.moon.position.length() - R_MOON) * 0.5);
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
