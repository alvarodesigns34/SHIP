/**
 * ALCIÓN HX-4 · ASCENSION — pipeline de renderizado explícito y medible.
 *
 *   [escena astronómica] → RT HDR (MSAA + DepthTexture opcional) ──┐
 *   limpiar SÓLO profundidad                                       │
 *   [escena cercana]     → mismo RT ───────────────────────────────┤
 *                                                                  ├→ AO de contacto (½ res, opcional)
 *                                                                  ├→ Auto-exposición 100 % GPU (64→16→4→1 + ping-pong 1×1, sin readPixels)
 *                                                                  ├→ Bloom por cadena de mips (opcional)
 *                                                                  ├→ Pasada final: AO · exposición · bloom · AgX
 *                                                                  └→ FXAA 3.11 post-AgX (opcional) → pantalla
 *
 * Cada pasada se mide de forma independiente (`timings`) y puede aislarse con `debug`.
 */
import * as THREE from 'three';
import { FS_VERT, PREFILTER, DOWN, UP, LUMA_INIT, LUMA_DOWN, ADAPT, AO_GEN, AO_BLUR, FINAL, FXAA } from './PostShaders';

export type DebugView = 'none' | 'far' | 'near' | 'nopost' | 'bloom' | 'luma' | 'ao';

function fsMat(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export interface PipelineOptions {
  msaa: number;
  bloom: boolean;
  scale: number;
  autoExposure: boolean;
  fxaa: boolean;
  ao: boolean;
}

export class Pipeline {
  renderer: THREE.WebGLRenderer;
  rt: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Bloom mips
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];

  // Auto-exposición 100 % GPU (64→16→4→1 + ping-pong 1×1)
  private lumaRTs: THREE.WebGLRenderTarget[] = [];
  private adaptRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private adaptIdx = 0;
  private exposureReset = true;

  // AO a ½ resolución (generación + blur bilateral)
  private aoRT: THREE.WebGLRenderTarget | null = null;
  private aoBlurRT: THREE.WebGLRenderTarget | null = null;

  // Buffer LDR intermedio cuando FXAA está activo
  private ldrRT: THREE.WebGLRenderTarget | null = null;

  // Materiales de postproceso
  private mPre = fsMat(PREFILTER, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.2 }, knee: { value: 0.5 } });
  private mDown = fsMat(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private mUp = fsMat(UP, { tSrc: { value: null }, tPrev: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1.0 } });

  private mLumaInit = fsMat(LUMA_INIT, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private mLumaDown = fsMat(LUMA_DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private mAdapt = fsMat(ADAPT, {
    tLuma: { value: null },
    tPrev: { value: null },
    dt: { value: 1 / 60 },
    reset: { value: 1 },
    keyValue: { value: 0.22 },
    minGain: { value: 0.72 },
    maxGain: { value: 1.50 },
  });

  private mAoGen = fsMat(AO_GEN, {
    tDepth: { value: null },
    depthTexel: { value: new THREE.Vector2() },
    aoTexel: { value: new THREE.Vector2() },
    camNear: { value: 0.05 },
    camFar: { value: 3000 },
    tanHalfFov: { value: 0.577 },
    aspect: { value: 1.77 },
    radius: { value: 0.45 },
    bias: { value: 0.18 },
    farFade: { value: 45.0 },
  });
  private mAoBlur = fsMat(AO_BLUR, { tAo: { value: null }, texel: { value: new THREE.Vector2() } });

  private mFinal = fsMat(FINAL, {
    tScene: { value: null },
    tBloom: { value: null },
    tAdapt: { value: null },
    tAo: { value: null },
    exposure: { value: 1 },
    useAutoExp: { value: 1 },
    bloomStrength: { value: 0.06 },
    aoStrength: { value: 0.0 },
    applyDither: { value: 1 },
    mode: { value: 0 },
    resolution: { value: new THREE.Vector2() },
  });

  private mFxaa = fsMat(FXAA, {
    tSrc: { value: null },
    texel: { value: new THREE.Vector2() },
    subpixQuality: { value: 0.45 },
    edgeThreshold: { value: 0.125 },
    edgeThresholdMin: { value: 0.0416 },
  });

  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

  opts: PipelineOptions = { msaa: 4, bloom: true, scale: 1, autoExposure: true, fxaa: true, ao: false };
  exposure = 1;
  bloomStrength = 0.06;
  aoStrength = 0.24;
  aoRadius = 0.45;
  aoFarFade = 45.0;
  fxaaSubpix = 0.45;
  autoExposureKey = 0.22;
  autoExposureRange: [number, number] = [0.72, 1.50];
  debug: DebugView = 'none';

  /** Coste medido de cada pasada en ms de CPU (el trabajo GPU es asíncrono; ver GpuTimer). */
  timings = { far: 0, near: 0, ao: 0, autoExp: 0, bloom: 0, final: 0, aa: 0 };
  /** Estadísticas del frame COMPLETO (todas las pasadas, incluidas cámaras secundarias). */
  frameInfo = { calls: 0, triangles: 0 };
  w = 1;
  h = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mFinal);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
    this.black.needsUpdate = true;
    this.white.needsUpdate = true;
    this.rt = this.makeRT(1, 1, this.opts.msaa, this.opts.ao);

    // Cadena fija de reducción de luminancia: 32→8→2 (ADAPT promedia el 2×2 por filtro bilineal en vec2(0.5))
    for (const s of [32, 8, 2]) {
      const rt = new THREE.WebGLRenderTarget(s, s, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      rt.texture.generateMipmaps = false;
      this.lumaRTs.push(rt);
    }
    const makeAdapt = () => {
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.adaptRT = [makeAdapt(), makeAdapt()];
  }

  private makeRT(w: number, h: number, samples: number, needDepthTex: boolean) {
    const depthTexture = needDepthTex ? new THREE.DepthTexture(w, h, THREE.FloatType) : null;
    if (depthTexture) {
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      depthTexture.generateMipmaps = false;
    }
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthTexture: depthTexture ?? undefined,
    });
    rt.resolveDepthBuffer = needDepthTex;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  private ensureAuxRTs() {
    if (this.opts.ao) {
      const aw = Math.max(1, this.w >> 1);
      const ah = Math.max(1, this.h >> 1);
      if (!this.aoRT || this.aoRT.width !== aw || this.aoRT.height !== ah) {
        this.aoRT?.dispose();
        this.aoBlurRT?.dispose();
        this.aoRT = new THREE.WebGLRenderTarget(aw, ah, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
        });
        this.aoRT.texture.generateMipmaps = false;
        this.aoBlurRT = new THREE.WebGLRenderTarget(aw, ah, {
          type: THREE.UnsignedByteType,
          format: THREE.RGBAFormat,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
        this.aoBlurRT.texture.generateMipmaps = false;
      }
    } else if (this.aoRT) {
      this.aoRT.dispose();
      this.aoBlurRT?.dispose();
      this.aoRT = null;
      this.aoBlurRT = null;
    }

    if (this.opts.fxaa) {
      if (!this.ldrRT || this.ldrRT.width !== this.w || this.ldrRT.height !== this.h) {
        this.ldrRT?.dispose();
        this.ldrRT = new THREE.WebGLRenderTarget(this.w, this.h, {
          type: THREE.UnsignedByteType,
          format: THREE.RGBAFormat,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
        this.ldrRT.texture.generateMipmaps = false;
      }
    } else if (this.ldrRT) {
      this.ldrRT.dispose();
      this.ldrRT = null;
    }
  }

  /** Reinicia la adaptación de auto-exposición para saltos instantáneos (cambios de modo / tests deterministas). */
  resetExposure() {
    this.exposureReset = true;
  }

  configure(o: Partial<PipelineOptions>) {
    const prevMsaa = this.opts.msaa;
    const prevAo = this.opts.ao;
    const prevAuto = this.opts.autoExposure;
    Object.assign(this.opts, o);
    if ((o.msaa !== undefined && o.msaa !== prevMsaa) || (o.ao !== undefined && o.ao !== prevAo)) {
      this.rt.depthTexture?.dispose();
      this.rt.dispose();
      this.rt = this.makeRT(this.w, this.h, this.opts.msaa, this.opts.ao);
    }
    if (o.autoExposure !== undefined && o.autoExposure !== prevAuto) {
      this.exposureReset = true;
    }
    this.ensureAuxRTs();
  }

  setSize(w: number, h: number) {
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    if (this.opts.ao) {
      // Recrear RT + DepthTexture con dimensiones exactas para evitar desajustes de tamaño en blitFramebuffer
      this.rt.depthTexture?.dispose();
      this.rt.dispose();
      this.rt = this.makeRT(this.w, this.h, this.opts.msaa, true);
    } else {
      this.rt.setSize(this.w, this.h);
    }
    for (const r of [...this.mips, ...this.ups]) r.dispose();
    this.mips = [];
    this.ups = [];
    let mw = this.w >> 1;
    let mh = this.h >> 1;
    for (let i = 0; i < 4 && mw > 8 && mh > 8; i++) {
      const a = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const b = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      a.texture.generateMipmaps = b.texture.generateMipmaps = false;
      this.mips.push(a);
      this.ups.push(b);
      mw >>= 1;
      mh >>= 1;
    }
    this.ensureAuxRTs();
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  /** Acumula las estadísticas del renderer en `frameInfo` (llamar tras cada render auxiliar). */
  accumulate() {
    const i = this.renderer.info.render;
    this.frameInfo.calls += i.calls;
    this.frameInfo.triangles += i.triangles;
    this.renderer.info.reset();
  }

  beginFrame() {
    this.frameInfo.calls = 0;
    this.frameInfo.triangles = 0;
    this.renderer.info.reset();
  }

  render(far: { scene: THREE.Scene; camera: THREE.Camera } | null, near: { scene: THREE.Scene; camera: THREE.Camera }, dt = 1 / 60) {
    const r = this.renderer;
    const T0 = performance.now();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    if (far && this.debug !== 'near') r.render(far.scene, far.camera);
    const T1 = performance.now();
    if (this.debug !== 'far') {
      r.clearDepth();
      r.render(near.scene, near.camera);
    }
    const T2 = performance.now();
    this.accumulate();

    // 1. AO de contacto a ½ resolución (WebGL2 depth-resolve automático, 0 draw calls extra de geometría)
    let aoTex: THREE.Texture = this.white;
    const wantAo = this.opts.ao && this.aoRT && this.aoBlurRT && this.rt.depthTexture && this.debug !== 'nopost' && this.debug !== 'far' && (this.aoStrength > 0.001 || this.debug === 'ao');
    if (wantAo) {
      const pCam = near.camera as THREE.PerspectiveCamera;
      const u = this.mAoGen.uniforms;
      u.tDepth.value = this.rt.depthTexture;
      u.depthTexel.value.set(1 / this.w, 1 / this.h);
      u.aoTexel.value.set(1 / this.aoRT!.width, 1 / this.aoRT!.height);
      u.camNear.value = pCam.near ?? 0.05;
      u.camFar.value = pCam.far ?? 3000;
      u.tanHalfFov.value = Math.tan(THREE.MathUtils.degToRad((pCam.fov ?? 50) * 0.5));
      u.aspect.value = pCam.aspect ?? this.w / this.h;
      u.radius.value = this.aoRadius;
      u.farFade.value = this.aoFarFade;
      this.blit(this.mAoGen, this.aoRT);
      this.mAoBlur.uniforms.tAo.value = this.aoRT!.texture;
      this.mAoBlur.uniforms.texel.value.set(1 / this.aoRT!.width, 1 / this.aoRT!.height);
      this.blit(this.mAoBlur, this.aoBlurRT);
      aoTex = this.aoBlurRT!.texture;
    }
    const T_ao = performance.now();

    // 2. Auto-exposición 100 % GPU (64→16→4→1 + ping-pong 1×1, CERO readPixels)
    let adaptTex: THREE.Texture = this.white;
    const wantAutoExp = this.opts.autoExposure && this.debug !== 'nopost';
    if (wantAutoExp) {
      this.mLumaInit.uniforms.tSrc.value = this.rt.texture;
      this.mLumaInit.uniforms.texel.value.set(1 / this.w, 1 / this.h);
      this.blit(this.mLumaInit, this.lumaRTs[0]);
      for (let i = 1; i < this.lumaRTs.length; i++) {
        this.mLumaDown.uniforms.tSrc.value = this.lumaRTs[i - 1].texture;
        this.mLumaDown.uniforms.texel.value.set(1 / this.lumaRTs[i - 1].width, 1 / this.lumaRTs[i - 1].height);
        this.blit(this.mLumaDown, this.lumaRTs[i]);
      }
      const prevIdx = this.adaptIdx;
      const nextIdx = 1 - this.adaptIdx;
      const ua = this.mAdapt.uniforms;
      ua.tLuma.value = this.lumaRTs[this.lumaRTs.length - 1].texture;
      ua.tPrev.value = this.adaptRT[prevIdx].texture;
      ua.dt.value = dt;
      ua.reset.value = this.exposureReset ? 1.0 : 0.0;
      ua.keyValue.value = this.autoExposureKey;
      ua.minGain.value = this.autoExposureRange[0];
      ua.maxGain.value = this.autoExposureRange[1];
      this.blit(this.mAdapt, this.adaptRT[nextIdx]);
      this.adaptIdx = nextIdx;
      this.exposureReset = false;
      adaptTex = this.adaptRT[nextIdx].texture;
    }
    const T_ae = performance.now();

    // 3. Bloom por cadena de mips
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
    const T_bl = performance.now();

    // 4. Pasada final (AgX) + FXAA 3.11 opcional
    const modeNum = ({ none: 0, far: 0, near: 0, nopost: 3, bloom: 4, luma: 5, ao: 6 } as Record<DebugView, number>)[this.debug];
    const wantFxaa = this.opts.fxaa && !!this.ldrRT && modeNum === 0;
    const f = this.mFinal.uniforms;
    f.tScene.value = this.rt.texture;
    f.tBloom.value = bloomTex;
    f.tAdapt.value = adaptTex;
    f.tAo.value = aoTex;
    f.exposure.value = this.exposure;
    f.useAutoExp.value = wantAutoExp ? 1.0 : 0.0;
    f.bloomStrength.value = this.bloomStrength;
    f.aoStrength.value = wantAo ? this.aoStrength : 0.0;
    f.applyDither.value = wantFxaa ? 0.0 : 1.0;
    f.mode.value = modeNum;
    f.resolution.value.set(this.w, this.h);
    this.blit(this.mFinal, wantFxaa ? this.ldrRT : null);
    const T_fin = performance.now();

    if (wantFxaa) {
      const fx = this.mFxaa.uniforms;
      fx.tSrc.value = this.ldrRT!.texture;
      fx.texel.value.set(1 / this.w, 1 / this.h);
      fx.subpixQuality.value = this.fxaaSubpix;
      this.blit(this.mFxaa, null);
    }
    this.accumulate();
    const T_aa = performance.now();

    const k = 0.1;
    this.timings.far += (T1 - T0 - this.timings.far) * k;
    this.timings.near += (T2 - T1 - this.timings.near) * k;
    this.timings.ao += (T_ao - T2 - this.timings.ao) * k;
    this.timings.autoExp += (T_ae - T_ao - this.timings.autoExp) * k;
    this.timings.bloom += (T_bl - T_ae - this.timings.bloom) * k;
    this.timings.final += (T_fin - T_bl - this.timings.final) * k;
    this.timings.aa += (T_aa - T_fin - this.timings.aa) * k;
  }

  dispose() {
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    for (const r of [...this.mips, ...this.ups, ...this.lumaRTs, ...this.adaptRT]) r.dispose();
    this.aoRT?.dispose();
    this.aoBlurRT?.dispose();
    this.ldrRT?.dispose();
    for (const m of [this.mPre, this.mDown, this.mUp, this.mLumaInit, this.mLumaDown, this.mAdapt, this.mAoGen, this.mAoBlur, this.mFinal, this.mFxaa]) m.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
    this.white.dispose();
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
