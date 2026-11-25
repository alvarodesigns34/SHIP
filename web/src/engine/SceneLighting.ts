/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Gestión de iluminación de escena, sondas de reflexión PMREM diferenciadas
 * (orbital exterior vs cabina presurizada interior) y exposición fotográfica adaptativa.
 */
import * as THREE from 'three';
import { clamp, damp } from './util';

export class SceneLighting {
  sunLight = new THREE.DirectionalLight(0xfff7ec, 3.3);
  earthLight = new THREE.HemisphereLight(0x88b4ff, 0x04060a, 0.22);
  private extEnv: THREE.Texture | null = null;
  private intEnv: THREE.Texture | null = null;
  private usingInteriorEnv = false;
  exposure = 1.0;

  constructor(near: THREE.Scene) {
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(3072, 3072);
    const sc = this.sunLight.shadow.camera as THREE.OrthographicCamera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.02;
    near.add(this.sunLight, this.sunLight.target, this.earthLight);
  }

  /** Sonda de reflexión PMREM exterior: vacío espacial, Sol intenso y limbo planetario Rayleigh. */
  rebuildExteriorEnv(renderer: THREE.WebGLRenderer, earthDir: THREE.Vector3, earthAngRad: number, sunDir: THREE.Vector3, isLunar: boolean) {
    this.extEnv?.dispose();
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const planetCol = isLunar ? new THREE.Vector3(0.24, 0.24, 0.25) : new THREE.Vector3(0.18, 0.34, 0.62);
    const limbCol = isLunar ? new THREE.Vector3(0.32, 0.32, 0.33) : new THREE.Vector3(0.32, 0.65, 1.0);
    const sph = new THREE.Mesh(
      new THREE.SphereGeometry(50, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          ed: { value: earthDir.clone() },
          ea: { value: earthAngRad },
          pCol: { value: planetCol },
          lCol: { value: limbCol },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: /* glsl */ `
          varying vec3 vP; uniform vec3 ed; uniform float ea; uniform vec3 pCol; uniform vec3 lCol;
          void main(){
            float c = dot(normalize(vP), normalize(ed));
            float body = smoothstep(cos(ea * 1.04), cos(ea * 0.88), c);
            float limb = smoothstep(cos(ea * 1.18), cos(ea * 0.98), c) * (1.0 - smoothstep(cos(ea * 0.96), cos(ea * 0.78), c));
            vec3 space = vec3(0.005, 0.007, 0.012);
            vec3 col = mix(space, pCol, body) + lCol * limb * 0.55;
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    s.add(sph);
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(42) })
    );
    sun.position.copy(sunDir).multiplyScalar(45);
    sun.lookAt(0, 0, 0);
    s.add(sun);
    this.extEnv = pm.fromScene(s, 0).texture;
    pm.dispose();
    return this.extEnv;
  }

  /**
   * Sonda de reflexión PMREM interior de cabina presurizada:
   * franjas luminosas cenitales cálidas/neutras, paredes composite claras, cubierta oscura,
   * reflejo cian de pantallas MFD y tenue luz azulada terrestre por cúpula/nadir.
   */
  buildInteriorEnv(renderer: THREE.WebGLRenderer) {
    if (this.intEnv) return this.intEnv;
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(10, 4.6, 4.6),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vec3 n = normalize(vPos);
            // Paredes neutras claras, suelo más oscuro, techo con dos líneas de luminarias LED
            vec3 base = mix(vec3(0.08, 0.09, 0.11), vec3(0.32, 0.33, 0.35), smoothstep(-0.6, 0.6, n.y));
            // Dos tiras LED cenitales en las aristas del techo (+Y, ±Z)
            float strip = smoothstep(0.62, 0.85, n.y) * smoothstep(0.22, 0.55, abs(n.z)) * smoothstep(0.82, 0.45, abs(n.z));
            vec3 ledCol = mix(vec3(1.0, 0.88, 0.74), vec3(0.92, 0.97, 1.0), smoothstep(-0.5, 0.5, n.x));
            base += ledCol * strip * 2.6;
            // Reflejo azul-cian de las pantallas de proa (+X)
            float fwdGlow = smoothstep(0.65, 0.95, n.x) * (1.0 - abs(n.y) * 1.1);
            base += vec3(0.18, 0.45, 0.72) * max(0.0, fwdGlow) * 0.55;
            // Ventana cenital de cúpula con luz terrestre suave
            float zenith = smoothstep(0.86, 0.98, n.y) * (1.0 - smoothstep(0.0, 0.35, length(n.xz)));
            base += vec3(0.28, 0.55, 0.95) * zenith * 0.9;
            gl_FragColor = vec4(base, 1.0);
          }`,
      })
    );
    s.add(room);
    this.intEnv = pm.fromScene(s, 0.04).texture;
    pm.dispose();
    return this.intEnv;
  }

  /** Actualiza luces solares, earthshine, sonda PMREM activa y exposición adaptativa. */
  update(opts: {
    dt: number;
    near: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    sunDir: THREE.Vector3;
    earthDir: THREE.Vector3;
    earthAngRad: number;
    eclipse: number;
    isLunar: boolean;
    indoor: boolean;
    reducedMotion: boolean;
  }) {
    const { dt, near, renderer, sunDir, earthDir, earthAngRad, eclipse, isLunar, indoor, reducedMotion } = opts;
    this.sunLight.intensity = 3.4 * (1 - eclipse);
    this.sunLight.position.copy(sunDir).multiplyScalar(80);
    this.sunLight.target.position.set(0, 0, 0);

    const earthPhase = clamp(0.5 + 0.5 * sunDir.dot(earthDir.clone().negate()), 0, 1);
    const altK = earthAngRad / (Math.PI / 2);
    this.earthLight.position.copy(earthDir);
    this.earthLight.intensity = indoor ? 0.04 : (0.06 + 0.95 * altK * earthPhase * (isLunar ? 0.25 : 1));

    // Cambiar limpiamente entre sonda de reflexión interior y exterior
    if (indoor && !this.usingInteriorEnv) {
      near.environment = this.buildInteriorEnv(renderer);
      this.usingInteriorEnv = true;
    } else if (!indoor && this.usingInteriorEnv && this.extEnv) {
      near.environment = this.extEnv;
      this.usingInteriorEnv = false;
    } else if (!near.environment && this.extEnv) {
      near.environment = this.extEnv;
    }

    const targetEnvInt = indoor ? 0.48 : 0.88;
    (near as any).environmentIntensity = damp((near as any).environmentIntensity ?? 0.8, targetEnvInt, 4, dt);

    // Exposición fotográfica adaptativa (calibrada con el lightmap horneado en Cycles!)
    const targetExp = indoor ? 1.18 : eclipse > 0.5 ? 2.4 : 1.02;
    this.exposure = damp(this.exposure, targetExp, reducedMotion ? 20 : 1.8, dt);
    return this.exposure;
  }

  dispose() {
    this.extEnv?.dispose();
    this.intEnv?.dispose();
  }
}
