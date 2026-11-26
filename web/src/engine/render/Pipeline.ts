/**
 * ALCIÓN HX-4 · REBIRTH — pipeline de renderizado mínimo y explícito.
 *
 *   [escena astronómica] → RT HDR (MSAA) ──┐   (color + profundidad limpiados)
 *   limpiar SÓLO profundidad               │
 *   [escena cercana]     → mismo RT ───────┤
 *                                          ├→ bloom por cadena de mips (opcional)
 *                                          └→ pasada final: exposición · AgX · dither → pantalla
 *
 * Sustituye a EffectComposer + N8AO + Outline + SMAA + Vignette: cada pasada está aquí,
 * es medible (`timings`) y puede aislarse con `debug` para diagnosticar artefactos.
 */
import * as THREE from 'three';

export type DebugView = 'none' | 'far' | 'near' | 'nopost' | 'bloom' | 'luma';

const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsMat(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; varying vec2 vUv;
void main(){
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - threshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(c * contrib, vec3(64.0)), 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 a = texture2D(tSrc, vUv + texel * vec2(-1.0,-1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + texel * vec2( 1.0,-1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + texel * vec2( 1.0, 1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4((a + b + c + d) * 0.125 + e * 0.5, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tPrev; uniform vec2 texel; uniform float radius; varying vec2 vUv;
void main(){
  vec2 t = texel * radius;
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
         + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
  s += 2.0 * (texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb
            + texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb);
  s += 4.0 * texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + s / 16.0, 1.0);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float exposure; uniform float bloomStrength; uniform int mode;
uniform vec2 resolution; varying vec2 vUv;
// AgX (Troy Sobotka) — aproximación polinómica de Benjamin Wrensch
vec3 agxContrast(vec3 x){ vec3 x2=x*x; vec3 x4=x2*x2; return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
vec3 agx(vec3 c){
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = inM * c;
  c = clamp(log2(max(c, vec3(1e-10))), -12.47393, 4.026069);
  c = (c + 12.47393) / 16.500999;
  c = agxContrast(c);
  // ligero "punch" para que los materiales no queden lavados
  c = pow(max(c, 0.0), vec3(1.08));
  c = outM * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 hdr = texture2D(tScene, vUv).rgb;
  if (mode == 3) { gl_FragColor = vec4(toSRGB(clamp(hdr, 0.0, 1.0)), 1.0); return; }
  vec3 bl = texture2D(tBloom, vUv).rgb;
  if (mode == 4) { gl_FragColor = vec4(toSRGB(clamp(bl * 4.0, 0.0, 1.0)), 1.0); return; }
  vec3 c = hdr * exposure + bl * bloomStrength * exposure;
  if (mode == 5) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(vec3(l > 1.0 ? 1.0 : 0.0, l < 0.02 ? 1.0 : 0.0, clamp(l, 0.0, 1.0)), 1.0); return; }
  c = agx(c);
  // la salida de AgX ya está en un espacio perceptual cercano a sRGB
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface PipelineOptions { msaa: number; bloom: boolean; scale: number }

export class Pipeline {
  renderer: THREE.WebGLRenderer;
  rt: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private mPre = fsMat(PREFILTER, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.2 }, knee: { value: 0.5 } });
  private mDown = fsMat(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private mUp = fsMat(UP, { tSrc: { value: null }, tPrev: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1.0 } });
  private mFinal = fsMat(FINAL, {
    tScene: { value: null }, tBloom: { value: null }, exposure: { value: 1 }, bloomStrength: { value: 0.06 }, mode: { value: 0 }, resolution: { value: new THREE.Vector2() },
  });
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  opts: PipelineOptions = { msaa: 4, bloom: true, scale: 1 };
  exposure = 1;
  bloomStrength = 0.06;
  debug: DebugView = 'none';
  /** coste medido de cada pasada en ms de CPU (el trabajo GPU es asíncrono; ver GpuTimer) */
  timings = { far: 0, near: 0, bloom: 0, final: 0 };
  /** estadísticas del frame COMPLETO (todas las pasadas, incluidas cámaras secundarias) */
  frameInfo = { calls: 0, triangles: 0 };
  w = 1; h = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mFinal);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
    this.black.needsUpdate = true;
    this.rt = this.makeRT(1, 1, this.opts.msaa);
  }

  private makeRT(w: number, h: number, samples: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace,
    });
    rt.texture.generateMipmaps = false;
    return rt;
  }

  configure(o: Partial<PipelineOptions>) {
    const prevMsaa = this.opts.msaa;
    Object.assign(this.opts, o);
    if (o.msaa !== undefined && o.msaa !== prevMsaa) { this.rt.dispose(); this.rt = this.makeRT(this.w, this.h, this.opts.msaa); }
  }

  setSize(w: number, h: number) {
    this.w = Math.max(1, Math.floor(w)); this.h = Math.max(1, Math.floor(h));
    this.rt.setSize(this.w, this.h);
    for (const r of [...this.mips, ...this.ups]) r.dispose();
    this.mips = []; this.ups = [];
    let mw = this.w >> 1, mh = this.h >> 1;
    for (let i = 0; i < 5 && mw > 8 && mh > 8; i++) {
      const a = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const b = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      a.texture.generateMipmaps = b.texture.generateMipmaps = false;
      this.mips.push(a); this.ups.push(b);
      mw >>= 1; mh >>= 1;
    }
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  /** Acumula las estadísticas del renderer en `frameInfo` (llamar tras cada render auxiliar). */
  accumulate() {
    const i = this.renderer.info.render;
    this.frameInfo.calls += i.calls; this.frameInfo.triangles += i.triangles;
    this.renderer.info.reset();
  }

  beginFrame() { this.frameInfo.calls = 0; this.frameInfo.triangles = 0; this.renderer.info.reset(); }

  render(far: { scene: THREE.Scene; camera: THREE.Camera } | null, near: { scene: THREE.Scene; camera: THREE.Camera }) {
    const r = this.renderer;
    const T = performance.now();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    if (far && this.debug !== 'near') r.render(far.scene, far.camera);
    const T1 = performance.now();
    if (this.debug !== 'far') { r.clearDepth(); r.render(near.scene, near.camera); }
    const T2 = performance.now();
    this.accumulate();
    let bloomTex: THREE.Texture = this.black;
    const wantBloom = this.opts.bloom && this.mips.length > 0 && this.debug !== 'nopost';
    if (wantBloom) {
      this.mPre.uniforms.tSrc.value = this.rt.texture;
      this.mPre.uniforms.texel.value.set(1 / this.w, 1 / this.h);
      this.blit(this.mPre, this.mips[0]);
      for (let i = 1; i < this.mips.length; i++) {
        this.mDown.uniforms.tSrc.value = this.mips[i - 1].texture;
        this.mDown.uniforms.texel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.blit(this.mDown, this.mips[i]);
      }
      let prev: THREE.Texture = this.black;
      for (let i = this.mips.length - 1; i >= 0; i--) {
        this.mUp.uniforms.tSrc.value = this.mips[i].texture;
        this.mUp.uniforms.tPrev.value = i === this.mips.length - 1 ? this.black : prev;
        this.mUp.uniforms.texel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this.blit(this.mUp, this.ups[i]);
        prev = this.ups[i].texture;
      }
      bloomTex = this.ups[0].texture;
    }
    const T3 = performance.now();
    const f = this.mFinal.uniforms;
    f.tScene.value = this.rt.texture;
    f.tBloom.value = bloomTex;
    f.exposure.value = this.exposure;
    f.bloomStrength.value = this.bloomStrength;
    f.mode.value = ({ none: 0, far: 0, near: 0, nopost: 3, bloom: 4, luma: 5 } as Record<DebugView, number>)[this.debug];
    this.blit(this.mFinal, null);
    this.accumulate();
    const T4 = performance.now();
    const k = 0.1;
    this.timings.far += (T1 - T - this.timings.far) * k;
    this.timings.near += (T2 - T1 - this.timings.near) * k;
    this.timings.bloom += (T3 - T2 - this.timings.bloom) * k;
    this.timings.final += (T4 - T3 - this.timings.final) * k;
  }

  dispose() {
    this.rt.dispose();
    for (const r of [...this.mips, ...this.ups]) r.dispose();
    for (const m of [this.mPre, this.mDown, this.mUp, this.mFinal]) m.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
  }
}

/** Temporizador de GPU real (EXT_disjoint_timer_query_webgl2) cuando el navegador lo expone. */
export class GpuTimer {
  private gl: WebGL2RenderingContext;
  private ext: any;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  ms = -1;
  constructor(renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get available() { return !!this.ext; }
  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) this.ms = this.ms < 0 ? ns / 1e6 : this.ms * 0.9 + (ns / 1e6) * 0.1;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}
