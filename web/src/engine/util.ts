import * as THREE from 'three';

/** Blender (Z arriba, metros) → three (Y arriba). */
export const b2t = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
export const b2tv = (v: ArrayLike<number>) => new THREE.Vector3(v[0], v[2], -v[1]);
export const t2b = (v: THREE.Vector3) => [v.x, -v.z, v.y] as const;

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const smooth = (k: number) => k * k * (3 - 2 * k);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Amortiguación independiente del paso: acerca a → b con constante de tiempo 1/lambda. */
export const damp = (a: number, b: number, lambda: number, dt: number) => b + (a - b) * Math.exp(-lambda * dt);

const STAGES: Record<number, [number, number]> = { 1: [0, 0.25], 2: [0.2, 0.5], 3: [0.45, 0.75], 4: [0.7, 0.92] };
/** Ventana del deslizador de explosión por nivel jerárquico (misma ley que blender/render.py). */
export function stageOf(depth: number, t: number) {
  const w = STAGES[depth] ?? [0.82, 1.0];
  return smooth(clamp((t - w[0]) / (w[1] - w[0]), 0, 1));
}

export function fmt(n: number, d = 1) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Emisor de eventos mínimo y tipado. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: any) => void>>();
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void) {
    if (!this.map.has(k)) this.map.set(k, new Set());
    this.map.get(k)!.add(fn);
    return () => this.map.get(k)!.delete(fn);
  }
  emit<K extends keyof E>(k: K, p: E[K]) {
    this.map.get(k)?.forEach((f) => f(p));
  }
}
