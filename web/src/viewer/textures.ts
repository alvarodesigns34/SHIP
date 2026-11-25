/**
 * Texturas procedurales generadas en el navegador (canvas) para recuperar el
 * microdetalle que el exportador glTF no transmite desde los materiales
 * procedurales de Blender. Las UV del modelo están en metros (proyección
 * cúbica), así que `repeat` = 1 / tamaño de tesela en metros.
 */
import * as THREE from 'three';

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
  // repetible: la última fila/columna copia la primera
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

/** Arrugado del aislamiento multicapa: pliegues lineales + ruido fino. */
export const mliNormal = () => cached('mliN', () => {
  const S = 512;
  const h = fbm(S, [3, 6, 12], 3);
  for (let k = 0; k < h.length; k++) h[k] *= 0.6;
  const r = rng(11);
  for (let k = 0; k < 70; k++) {
    const x0 = r() * S, y0 = r() * S, ang = r() * Math.PI, len = 60 + r() * 200, w = 3 + r() * 6, amp = (r() - 0.45) * 0.5;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let t = -len; t < len; t += 0.5) {
      for (let o = -w * 2; o <= w * 2; o++) {
        const x = Math.round(x0 + dx * t - dy * o), y = Math.round(y0 + dy * t + dx * o);
        const xi = ((x % S) + S) % S, yi = ((y % S) + S) % S;
        h[yi * S + xi] += amp * Math.exp(-(o * o) / (w * w)) * (1 - Math.abs(t) / len);
      }
    }
  }
  return heightToNormal(h, S, 3.2);
});

export const roughNoise = (seed = 1) => cached('rough' + seed, () => {
  const S = 256;
  const h = fbm(S, [4, 8, 16, 32, 64], seed);
  return toTexture(S, (x, y) => { const v = 150 + (h[y * S + x] - 0.5) * 140; return [v, v, v]; });
});

/** Microrrelieve de pintura/aluminio. */
export const paintNormal = () => cached('paintN', () => {
  const S = 256;
  return heightToNormal(fbm(S, [16, 32, 64, 128], 7), S, 1.2);
});

/** Tejido (beta cloth, Nomex, Kevlar). */
export const weaveNormal = () => cached('weaveN', () => {
  const S = 256, P = 8;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = Math.floor(x / P), cy = Math.floor(y / P);
    const over = (cx + cy) % 2 === 0;
    const u = (x % P) / P, v = (y % P) / P;
    h[y * S + x] = over ? Math.sin(Math.PI * v) : Math.sin(Math.PI * u);
  }
  return heightToNormal(h, S, 2.5);
});

/** Retícula de células solares: color + rugosidad. */
export const solarColor = () => cached('solarC', () => {
  const S = 512; // 1 tesela = 8 × 16 células
  const r = rng(5);
  const tint = Array.from({ length: 128 }, () => 0.85 + r() * 0.3);
  return toTexture(S, (x, y) => {
    const cw = S / 8, ch = S / 16;
    const cx = Math.floor(x / cw), cy = Math.floor(y / ch);
    const lx = x % cw, ly = y % ch;
    if (lx < 2 || ly < 2) return [70, 72, 78];
    const busbar = (ly % Math.floor(ch / 3)) === 0;
    if (busbar) return [120, 120, 130];
    const k = tint[(cy * 8 + cx) % 128];
    const corner = (lx < 6 && ly < 6) || (lx > cw - 6 && ly < 6);
    if (corner) return [40, 40, 46];
    return [8 * k, 16 * k, 44 * k];
  }, true);
});

/** Cinta OSR del radiador: tiras de 5 cm. */
export const radiatorRough = () => cached('radR', () => {
  const S = 256;
  return toTexture(S, (x, y) => { const v = (x % 32) < 1 ? 160 : 30 + ((x * 7 + y) % 9); return [v, v, v]; });
});

/** Trenzado de carbono. */
export const cfrpNormal = () => cached('cfrpN', () => {
  const S = 256, P = 16;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = Math.floor(x / P), cy = Math.floor(y / P);
    const tw = (cx + Math.floor(cy / 2)) % 2 === 0;
    const u = (x % P) / P, v = (y % P) / P;
    h[y * S + x] = tw ? 0.5 + 0.5 * Math.sin(Math.PI * v) : 0.5 + 0.5 * Math.sin(Math.PI * u);
  }
  return heightToNormal(h, S, 1.5);
});

export function makeStarfield(count = 6000, radius = 900) {
  const r = rng(42);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([radius * s * Math.cos(t), radius * u, radius * s * Math.sin(t)], i * 3);
    const m = Math.pow(r(), 6) * 0.9 + 0.1;
    const warm = r();
    col.set([m * (0.85 + 0.15 * warm), m * 0.9, m * (1.0 - 0.15 * warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -10;
  return p;
}
