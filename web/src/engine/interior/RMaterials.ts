/**
 * ALCIÓN HX-4 · REBIRTH — materiales del interior.
 *
 * Contrato con Blender (blender/alcion/habitat.py): el nombre `R_*` del material define
 * su respuesta. Cada estancia recibe un clon con su propio lightmap (irradiancia difusa
 * horneada en Cycles). Para no duplicar contribuciones:
 *  - con lightmap, la irradiancia difusa de la sonda de entorno se anula (sólo queda su especular);
 *  - el especular de la sonda se atenúa con la luminancia del lightmap (oclusión especular),
 *    lo que evita reflejos "brillantes" en rincones oscuros;
 *  - las luminarias de cada bahía modulan su lightmap con los interruptores LT_A…LT_N;
 *  - contrato H2 (`userData.boxProbe`): proyección por caja (AABB en espacio nave) para
 *    sondas de entorno cuando `boxProbe.enabled.value > 0.5`;
 *  - desgaste procedural sutil sin llamadas extra en pavimento (`R_Floor`) y metal (`R_Frame`/`R_Alu`).
 */
import * as THREE from 'three';

export const SHIP_INV = { value: new THREE.Matrix4() };
/** ganancia de luz de bahía [A, B, C, D, Nodo] */
export const BAY_GAIN = { value: [1, 1, 1, 1, 1] };
/** irradiancia equivalente = texel · π · escala (bake "lighting only" de Cycles) */
export const LM_SCALE = 4.0;

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(name: string, srgb: boolean, repeat: number, aniso = 8) {
  const key = `${name}|${repeat}`;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(`textures/pbr/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache.set(key, t);
  }
  return t;
}

type Def = {
  color: number | [number, number, number]; rough: number; metal: number;
  maps?: { c?: string; n?: string; r?: string; rep: number; ns?: number };
  emissive?: [number, number, number]; kind?: 'std' | 'glass' | 'emit' | 'backing' | 'screen' | 'decal'; doubleSide?: boolean; clearcoat?: number; sheen?: number;
};

const lin = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

/** Valores lineales sincronizados con Blender (RMAT) salvo ajustes de respuesta PBR. */
export const RDEF: Record<string, Def> = {
  R_Lining: { color: lin(0.56, 0.54, 0.50), rough: 0.5, metal: 0, maps: { n: 'polymer_n', r: 'polymer_r', rep: 1.3, ns: 0.04 } },
  R_LiningDark: { color: lin(0.085, 0.09, 0.10), rough: 0.55, metal: 0, maps: { n: 'polymer_n', rep: 4.0, ns: 0.08 } },
  R_Fabric: { color: lin(0.16, 0.155, 0.15), rough: 0.95, metal: 0, maps: { c: 'wool_c', n: 'wool_n', r: 'wool_r', rep: 3.2, ns: 0.9 }, sheen: 0.35 },
  R_FabricBlue: { color: lin(0.045, 0.085, 0.11), rough: 0.9, metal: 0, maps: { c: 'linen_c', n: 'linen_n', r: 'linen_r', rep: 4.0, ns: 0.7 }, sheen: 0.4 },
  R_Leather: { color: lin(0.055, 0.06, 0.068), rough: 0.5, metal: 0, maps: { n: 'leatherw_n', r: 'leatherw_r', rep: 2.6, ns: 0.6 }, sheen: 0.12 },
  R_Frame: { color: lin(0.05, 0.052, 0.058), rough: 0.36, metal: 0.85, maps: { n: 'brushed_n', r: 'brushed_r', rep: 3, ns: 0.15 } },
  R_Alu: { color: lin(0.78, 0.78, 0.77), rough: 0.28, metal: 1, maps: { n: 'brushed_n', r: 'brushed_r', rep: 4, ns: 0.2 } },
  R_Steel: { color: lin(0.62, 0.62, 0.62), rough: 0.24, metal: 1, maps: { n: 'brushed_n', rep: 6, ns: 0.2 } },
  R_Floor: { color: lin(0.085, 0.086, 0.09), rough: 0.74, metal: 0, maps: { n: 'rubtile_n', r: 'rubtile_r', rep: 2.0, ns: 0.6 } },
  R_Worktop: { color: lin(0.40, 0.33, 0.24), rough: 0.42, metal: 0, maps: { c: 'linen_warm_c', n: 'linen_n', r: 'linen_r', rep: 2.2, ns: 0.25 }, clearcoat: 0.35 },
  R_Rubber: { color: lin(0.02, 0.02, 0.022), rough: 0.8, metal: 0, maps: { n: 'rubber_n', rep: 6, ns: 0.4 } },
  R_Accent: { color: lin(0.62, 0.11, 0.03), rough: 0.4, metal: 0 },
  R_Black: { color: lin(0.012, 0.012, 0.014), rough: 0.32, metal: 0 },
  R_Backing: { color: lin(0.006, 0.006, 0.007), rough: 0.9, metal: 0, kind: 'backing', doubleSide: true },
  R_Glass: { color: lin(0.8, 0.88, 0.95), rough: 0.03, metal: 0, kind: 'glass' },
  R_Screen: { color: lin(0.01, 0.012, 0.016), rough: 0.1, metal: 0, kind: 'screen' },
  R_LED: { color: lin(1, 0.86, 0.70), rough: 0.5, metal: 0, kind: 'emit', emissive: [3.2, 2.7, 2.15] },
  R_LightPanel: { color: lin(1, 0.93, 0.84), rough: 0.5, metal: 0, kind: 'emit', emissive: [2.6, 2.45, 2.2] },
  R_Indicator: { color: lin(0.3, 1, 0.5), rough: 0.4, metal: 0, kind: 'emit', emissive: [0.6, 2.4, 1.0] },
  R_Warning: { color: lin(1.0, 0.65, 0.12), rough: 0.4, metal: 0, kind: 'emit', emissive: [2.3, 1.35, 0.18] },
  R_Alarm: { color: lin(1.0, 0.14, 0.08), rough: 0.4, metal: 0, kind: 'emit', emissive: [2.6, 0.24, 0.14] },
  R_Bag: { color: lin(0.48, 0.44, 0.37), rough: 0.9, metal: 0, maps: { c: 'linen_warm_c', n: 'linen_n', rep: 5, ns: 0.6 }, sheen: 0.3 },
  R_BagTech: { color: lin(0.18, 0.20, 0.21), rough: 0.88, metal: 0, maps: { c: 'linen_warm_c', n: 'linen_n', r: 'linen_r', rep: 5, ns: 0.55 }, sheen: 0.25 },
  R_Plant: { color: lin(0.06, 0.22, 0.045), rough: 0.5, metal: 0 },
  R_PlantDark: { color: lin(0.03, 0.11, 0.025), rough: 0.48, metal: 0 },
  R_Dial: { color: lin(0.78, 0.77, 0.73), rough: 0.35, metal: 0 },
  R_Label: { color: lin(0.5, 0.49, 0.46), rough: 0.5, metal: 0 },
  R_Decal: { color: lin(1, 1, 1), rough: 0.62, metal: 0, kind: 'decal' },
};

export interface BoxProbeUniforms {
  min: { value: THREE.Vector3 };
  max: { value: THREE.Vector3 };
  center: { value: THREE.Vector3 };
  enabled: { value: number };
}

function patch(m: THREE.MeshStandardMaterial, wearKind = 0) {
  const boxProbe: BoxProbeUniforms = {
    min: { value: new THREE.Vector3(-10, -10, -10) },
    max: { value: new THREE.Vector3(10, 10, 10) },
    center: { value: new THREE.Vector3() },
    enabled: { value: 0.0 },
  };
  m.userData.boxProbe = boxProbe;
  const wearUniform = { value: wearKind };

  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShipInv = SHIP_INV;
    sh.uniforms.uBayGain = BAY_GAIN;
    sh.uniforms.uBoxMin = boxProbe.min;
    sh.uniforms.uBoxMax = boxProbe.max;
    sh.uniforms.uBoxCenter = boxProbe.center;
    sh.uniforms.uBoxEnabled = boxProbe.enabled;
    sh.uniforms.uWearKind = wearUniform;

    sh.vertexShader = 'uniform mat4 uShipInv;\nvarying vec3 vShipPos;\nvarying float vShipX;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 alcW = modelMatrix * vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        alcW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      #endif
      vShipPos = (uShipInv * alcW).xyz;
      vShipX = vShipPos.x;`);

    const fragHeader = `
uniform mat4 uShipInv;
uniform float uBayGain[5];
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uBoxCenter;
uniform float uBoxEnabled;
uniform float uWearKind;
varying vec3 vShipPos;
varying float vShipX;
`;

    let frag = fragHeader + sh.fragmentShader;

    // Helpers de sonda de entorno en marco local de nave (contrato H2 boxProbe + IBL equilibrado para props dinámicos)
    frag = frag.replace(
      '#include <envmap_physical_pars_fragment>',
      `#include <envmap_physical_pars_fragment>
      #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
        vec3 alcGetIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
          if ( uBoxEnabled < 0.5 ) {
            return getIBLRadiance( viewDir, normal, roughness );
          }
          vec3 reflectVec = reflect( -viewDir, normal );
          reflectVec = normalize( mix( reflectVec, normal, roughness * roughness ) );
          reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
          mat3 shipInv3 = mat3( uShipInv );
          vec3 localR = normalize( shipInv3 * reflectVec );
          vec3 safeR = sign( localR ) * max( abs( localR ), vec3( 1e-5 ) );
          vec3 t0 = ( uBoxMax - vShipPos ) / safeR;
          vec3 t1 = ( uBoxMin - vShipPos ) / safeR;
          vec3 tFar = max( t0, t1 );
          float tHit = max( min( min( tFar.x, tFar.y ), tFar.z ), 0.0 );
          vec3 hitLocal = vShipPos + localR * tHit;
          vec3 corrLocal = normalize( hitLocal - uBoxCenter );
          // Las sondas de Interior.captureProbes() se capturan en el marco local de la nave
          vec4 envMapColor = textureCubeUV( envMap, corrLocal, roughness );
          return envMapColor.rgb * envMapIntensity;
        }
        vec3 alcGetIBLIrradiance( const in vec3 normal ) {
          if ( uBoxEnabled < 0.5 ) {
            return getIBLIrradiance( normal );
          }
          vec3 worldN = inverseTransformDirection( normal, viewMatrix );
          vec3 localN = normalize( mat3( uShipInv ) * worldN );
          // Muestreo hemisférico + rebote suave opuesto y compresión HDR para piezas dinámicas sin lightmap
          vec3 directEnv = textureCubeUV( envMap, localN, 1.0 ).rgb;
          vec3 bounceEnv = textureCubeUV( envMap, -localN, 1.0 ).rgb;
          vec3 irr = mix( directEnv, bounceEnv, 0.18 );
          irr = irr / ( 1.0 + irr * 0.30 );
          irr = max( irr, vec3( 0.035 ) );
          return PI * irr * envMapIntensity;
        }
      #endif
      `);

    // Desgaste procedural sutil sin draw calls extra (1 = pavimento pasillo central, 2 = bordes metálicos)
    frag = frag.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      if ( uWearKind > 0.5 && uWearKind < 1.5 ) {
        // R_Floor: ligera huella de tránsito en el pasillo central (vShipPos.z = lateral en espacio Three.js)
        float lane = exp( -pow( vShipPos.z / 0.34, 2.0 ) );
        float grain = 0.5 + 0.5 * sin( vShipPos.x * 5.7 + sin( vShipPos.z * 9.3 ) ) * cos( vShipPos.z * 11.4 + vShipPos.x * 2.1 );
        float wear = lane * ( 0.60 + 0.40 * grain );
        roughnessFactor = clamp( roughnessFactor - 0.085 * wear, 0.32, 1.0 );
        diffuseColor.rgb += vec3( 0.010, 0.010, 0.011 ) * wear;
      } else if ( uWearKind > 1.5 ) {
        // R_Frame / R_Alu: micro-variación sutil de rugosidad y ligero realce de aristas metálicas
        float pat = 0.5 + 0.5 * sin( vShipPos.x * 13.0 + vShipPos.y * 17.0 ) * cos( vShipPos.z * 15.0 - vShipPos.x * 7.0 );
        float edge = 0.0;
        #ifndef FLAT_SHADED
          edge = pow( 1.0 - clamp( abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 0.0, 1.0 ), 3.0 );
        #endif
        roughnessFactor = clamp( roughnessFactor + ( pat - 0.5 ) * 0.06 - 0.045 * edge, 0.10, 0.95 );
        diffuseColor.rgb *= ( 1.0 + 0.045 * edge );
      }
      `);

    frag = frag.replace(
      '#include <lights_fragment_maps>',
      `
      float alcSpecOcc = 1.0;
      float wD = 1.0 - smoothstep(2.45, 2.85, vShipX);
      float wC = smoothstep(2.45, 2.85, vShipX) * (1.0 - smoothstep(4.50, 4.90, vShipX));
      float wB = smoothstep(4.50, 4.90, vShipX) * (1.0 - smoothstep(6.55, 6.95, vShipX));
      float wA = smoothstep(6.55, 6.95, vShipX) * (1.0 - smoothstep(9.80, 10.05, vShipX));
      float wN = smoothstep(9.80, 10.05, vShipX);
      float alcBay = wD * uBayGain[3] + wC * uBayGain[2] + wB * uBayGain[1] + wA * uBayGain[0] + wN * uBayGain[4];
      #if defined( RE_IndirectDiffuse )
        #ifdef USE_LIGHTMAP
          vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
          vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * mix(0.06, 1.0, alcBay);
          irradiance += lightMapIrradiance;
          alcSpecOcc = clamp(dot(lightMapIrradiance, vec3(0.2126, 0.7152, 0.0722)) * 0.9, 0.08, 1.0);
        #elif defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
          iblIrradiance += alcGetIBLIrradiance( geometryNormal ) * mix(0.08, 1.0, alcBay);
          alcSpecOcc = mix(0.14, 0.85, alcBay);
        #endif
      #endif
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        #ifdef ENVMAP_TYPE_CUBE_UV
          radiance += alcGetIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * alcSpecOcc;
          #ifdef USE_CLEARCOAT
            clearcoatRadiance += alcGetIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * alcSpecOcc;
          #endif
        #else
          radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * alcSpecOcc;
          #ifdef USE_CLEARCOAT
            clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * alcSpecOcc;
          #endif
        #endif
      #endif
      `);

    sh.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `alc-rb3-${m.lightMap ? 'lm' : 'nolm'}-${wearKind}`;
}

/** El lightmap se guarda en WebP sRGB (lineal = L/escala) y se decodifica en hardware (SRGB8). */
export function makeMaterial(name: string, lightMap: THREE.Texture | null): THREE.Material {
  const d = RDEF[name] ?? { color: 0x808080, rough: 0.6, metal: 0 };
  const col = Array.isArray(d.color) ? new THREE.Color(d.color[0], d.color[1], d.color[2]) : new THREE.Color(d.color);
  if (d.kind === 'emit') {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...(d.emissive ?? [2, 2, 2])), toneMapped: false });
    m.name = name;
    return m;
  }
  if (d.kind === 'backing') {
    const m = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    m.name = name;
    return m;
  }
  if (d.kind === 'glass') {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.06, depthWrite: false, envMapIntensity: 0.38,
      specularIntensity: 1, ior: 1.46,
    });
    m.name = name;
    return m;
  }
  if (d.kind === 'decal') {
    const m = new THREE.MeshStandardMaterial({ roughness: d.rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = name;
    const t = loader.load('textures/labels_atlas.jpg');
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    m.map = t;
    if (lightMap) { m.lightMap = lightMap; m.lightMapIntensity = Math.PI * LM_SCALE; }
    patch(m, 0);
    return m;
  }
  const physical = !!(d.clearcoat || d.sheen);
  const m = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  m.name = name;
  m.color = col;
  m.roughness = d.rough;
  m.metalness = d.metal;
  if (d.maps) {
    const { c, n, r, rep, ns } = d.maps;
    if (c) m.map = tex(c, true, rep);
    if (n) { m.normalMap = tex(n, false, rep); m.normalScale.set(ns ?? 0.5, -(ns ?? 0.5)); }
    if (r) m.roughnessMap = tex(r, false, rep);
    if (c) {
      // el mapa de color sólo aporta variación: el tono lo fija `color` (mapa casi blanco ⇒ multiplicador)
      const avg = name === 'R_Fabric' ? 1.9
        : name === 'R_Floor' ? 3.0
          : name === 'R_Worktop' ? 1.45
            : name === 'R_FabricBlue' ? 2.4
              : name === 'R_Bag' ? 1.45
                : name === 'R_BagTech' ? 1.45
                  : 1.35;
      m.color.multiplyScalar(avg);
    }
  }
  if (physical) {
    const p = m as THREE.MeshPhysicalMaterial;
    if (d.clearcoat) { p.clearcoat = d.clearcoat; p.clearcoatRoughness = 0.3; }
    if (d.sheen) { p.sheen = d.sheen; p.sheenRoughness = 0.8; p.sheenColor = col.clone().lerp(new THREE.Color(1, 1, 1), 0.4); }
  }
  if (lightMap) { m.lightMap = lightMap; m.lightMapIntensity = Math.PI * LM_SCALE; }
  if (d.doubleSide) m.side = THREE.DoubleSide;
  const wearKind = name === 'R_Floor' ? 1 : (name === 'R_Frame' || name === 'R_Alu' ? 2 : 0);
  patch(m, wearKind);
  return m;
}
