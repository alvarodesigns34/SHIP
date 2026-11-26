/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Biblioteca de texturas PBR, soporte KTX2/Basis Universal y carga del lightmap horneado en Cycles.
 */
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = new Float32Array((cells + 1) * (cells + 1)).map(() => r());
  for (let i = 0; i <= cells; i++) {
    g[i * (cells + 1) + cells] = g[i * (cells + 1)];
    g[cells * (cells + 1) + i] = g[i];
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[iy * (cells + 1) + ix], b = g[iy * (cells + 1) + ix + 1];
      const c = g[(iy + 1) * (cells + 1) + ix], d = g[(iy + 1) * (cells + 1) + ix + 1];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function fbm(size: number, octaves: number[], seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  octaves.forEach((c, i) => {
    const n = valueNoise(size, c, seed + i * 17);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * amp;
    tot += amp;
    amp *= 0.5;
  });
  for (let k = 0; k < out.length; k++) out[k] /= tot;
  return out;
}

function toTexture(size: number, fill: (x: number, y: number) => [number, number, number], srgb = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fill(x, y);
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function heightToNormal(h: Float32Array, size: number, strength: number) {
  return toTexture(size, (x, y) => {
    const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
    const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
    const nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    return [((nx / l) * 0.5 + 0.5) * 255, ((ny / l) * 0.5 + 0.5) * 255, ((nz / l) * 0.5 + 0.5) * 255];
  });
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, fn: () => THREE.Texture) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key)!;
}

export const roughNoise = (seed = 1) => cached('rough' + seed, () => {
  const S = 256;
  const h = fbm(S, [4, 8, 16, 32, 64], seed);
  return toTexture(S, (x, y) => { const v = 160 + (h[y * S + x] - 0.5) * 60; return [v, v, v]; });
});

export const paintNormal = () => cached('paintN', () => {
  const S = 256;
  return heightToNormal(fbm(S, [16, 32, 64, 128], 7), S, 1.15);
});

/** Normales de panel aeroespacial MMOD: micro-grano térmico, ligera ondulación de chapa, juntas de subpanel y remaches discretos. */
export const hullPanelNormal = () => cached('hullPanelN', () => {
  const S = 512;
  const grain = fbm(S, [16, 32, 64, 128], 21);
  const wave = fbm(S, [4, 8], 43);
  const h = new Float32Array(S * S);
  const half = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = grain[y * S + x] * 0.24 + wave[y * S + x] * 0.14;
      const lx = x % half, ly = y % half;
      const dx = Math.min(lx, half - 1 - lx);
      const dy = Math.min(ly, half - 1 - ly);
      const edge = Math.min(dx, dy);
      // Junta fina biselada entre subpaneles
      if (edge === 0) v -= 0.42;
      else if (edge === 1) v -= 0.22;
      else if (edge === 2) v -= 0.06;
      // Remaches avellanados muy discretos junto a las juntas (paso 32 px)
      if ((dx === 7 && (ly % 32) === 16) || (dy === 7 && (lx % 32) === 16)) {
        v -= 0.14;
      } else if ((Math.abs(dx - 7) <= 1 && Math.abs((ly % 32) - 16) <= 1) || (Math.abs(dy - 7) <= 1 && Math.abs((lx % 32) - 16) <= 1)) {
        v -= 0.05;
      }
      h[y * S + x] = v;
    }
  }
  return heightToNormal(h, S, 1.85);
});

/** Rugosidad diferenciada por subpanel MMOD con juntas ligeramente más mates y grano fino limpio. */
export const hullPanelRough = () => cached('hullPanelR', () => {
  const S = 512;
  const f = fbm(S, [4, 8, 24, 64], 59);
  const half = S / 2;
  const cellBias = [142, 162, 154, 134];
  return toTexture(S, (x, y) => {
    const cx = Math.floor(x / half), cy = Math.floor(y / half);
    const lx = x % half, ly = y % half;
    const edge = Math.min(Math.min(lx, half - 1 - lx), Math.min(ly, half - 1 - ly));
    let v = cellBias[(cy * 2 + cx) & 3] + (f[y * S + x] - 0.5) * 42;
    if (edge <= 2) v += (3 - edge) * 26;
    v = Math.max(96, Math.min(238, v));
    return [v, v, v];
  });
});

export const solarColor = () => cached('solarC', () => {
  const S = 512;
  const r = rng(5);
  const tint = Array.from({ length: 128 }, () => 0.85 + r() * 0.3);
  return toTexture(S, (x, y) => {
    const cw = S / 8, ch = S / 16;
    const cx = Math.floor(x / cw), cy = Math.floor(y / ch);
    const lx = x % cw, ly = y % ch;
    if (lx < 2 || ly < 2) return [70, 74, 82];
    const busbar = (ly % Math.floor(ch / 3)) === 0;
    if (busbar) return [124, 126, 136];
    const k = tint[(cy * 8 + cx) % 128];
    const corner = (lx < 6 && ly < 6) || (lx > cw - 6 && ly < 6);
    if (corner) return [38, 40, 48];
    return [9 * k, 18 * k, 48 * k];
  }, true);
});

/** Normales de la rejilla fotovoltaica (surcos entre células, busbars y esquinas recortadas). */
export const solarNormal = () => cached('solarN', () => {
  const S = 512;
  const h = new Float32Array(S * S);
  const cw = S / 8, ch = S / 16;
  const busStep = Math.floor(ch / 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lx = x % cw, ly = y % ch;
      let v = 0.5;
      if (lx < 2 || ly < 2) v = 0.08;
      else if ((ly % busStep) === 0) v = 0.62;
      else if ((lx < 6 && ly < 6) || (lx > cw - 6 && ly < 6)) v = 0.32;
      h[y * S + x] = v;
    }
  }
  return heightToNormal(h, S, 1.5);
});

export const radiatorRough = () => cached('radR', () => {
  const S = 256;
  return toTexture(S, (x, y) => { const v = (x % 32) < 1 ? 160 : 30 + ((x * 7 + y) % 9); return [v, v, v]; });
});

export const grimeMap = () => cached('grime', () => {
  const S = 512;
  const h = fbm(S, [3, 6, 12, 24, 96], 33);
  return toTexture(S, (x, y) => { const v = 168 + (h[y * S + x] - 0.5) * 34 + ((x * 13 + y * 7) % 29 === 0 ? 8 : 0); return [v, v, v]; });
});

// ---------------------------------------------------------------------------
// Soporte KTX2 / Basis Universal + Lightmap horneado en Cycles
// ---------------------------------------------------------------------------
let ktx2Loader: KTX2Loader | null = null;
const photoCache = new Map<string, THREE.Texture>();
const photoLoader = new THREE.TextureLoader();

/** Inicializa el transcodificador GPU KTX2/Basis Universal con soporte hardware detectado. */
export function initKTX2(renderer: THREE.WebGLRenderer) {
  if (ktx2Loader) return ktx2Loader;
  ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath('basis/');
  ktx2Loader.detectSupport(renderer);
  return ktx2Loader;
}

export function getKTX2Loader() { return ktx2Loader; }

/** Textura PBR fotográfica CC0 (ambientCG). */
export function photo(name: 'mli' | 'brushed' | 'fabric' | 'leather' | 'polymer' | 'carbon' | 'rubber', kind: 'n' | 'r' | 'c') {
  const key = name + '_' + kind;
  let t = photoCache.get(key);
  if (!t) {
    t = photoLoader.load(`textures/pbr/${key}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = kind === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    photoCache.set(key, t);
  }
  return t;
}

let lmTexture: THREE.Texture | null = null;
let lmKtx2State: 'idle' | 'loading' | 'ready' = 'idle';
const lmUpgrades: ((tex: THREE.Texture) => void)[] = [];

/**
 * Devuelve la textura de lightmap interior horneada en Cycles (canal UV1 / TEXCOORD_1).
 * Carga inmediatamente la versión PNG como fallback sin bloqueo y, si KTX2 está activo y
 * disponible (`textures/lm_interior.ktx2`), actualiza TODOS los materiales registrados con la
 * textura comprimida GPU UASTC.
 */
export function getInteriorLightmap(onUpgrade?: (tex: THREE.Texture) => void): THREE.Texture {
  if (!lmTexture) {
    lmTexture = photoLoader.load('textures/lm_interior.png');
    lmTexture.flipY = false; // glTF TEXCOORD_1 UV convention!
    lmTexture.channel = 1;
    lmTexture.colorSpace = THREE.SRGBColorSpace;
    lmTexture.wrapS = lmTexture.wrapT = THREE.ClampToEdgeWrapping;
    lmTexture.anisotropy = 8;
    lmTexture.generateMipmaps = true;
    lmTexture.minFilter = THREE.LinearMipmapLinearFilter;
    lmTexture.magFilter = THREE.LinearFilter;
  }
  if (onUpgrade) {
    if (lmKtx2State === 'ready') onUpgrade(lmTexture);
    else lmUpgrades.push(onUpgrade);
  }
  if (ktx2Loader && lmKtx2State === 'idle') {
    lmKtx2State = 'loading';
    ktx2Loader.load(
      'textures/lm_interior.ktx2',
      (kt) => {
        kt.flipY = false;
        kt.channel = 1;
        kt.colorSpace = THREE.SRGBColorSpace;
        kt.wrapS = kt.wrapT = THREE.ClampToEdgeWrapping;
        kt.anisotropy = 8;
        lmTexture = kt;
        lmKtx2State = 'ready';
        for (const fn of lmUpgrades) fn(kt);
        lmUpgrades.length = 0;
      },
      undefined,
      () => { lmKtx2State = 'ready'; lmUpgrades.length = 0; /* fallback PNG ya activo */ }
    );
  }
  return lmTexture;
}
