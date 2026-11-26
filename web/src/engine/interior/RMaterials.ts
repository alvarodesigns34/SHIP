/**
 * ALCIÓN HX-4 · REBIRTH — materiales del interior.
 *
 * Contrato con Blender (blender/alcion/habitat.py): el nombre `R_*` del material define
 * su respuesta. Cada estancia recibe un clon con su propio lightmap (irradiancia difusa
 * horneada en Cycles). Para no duplicar contribuciones:
 *  - con lightmap, la irradiancia difusa de la sonda de entorno se anula (sólo queda su especular);
 *  - el especular de la sonda se atenúa con la luminancia del lightmap (oclusión especular),
 *    lo que evita reflejos "brillantes" en rincones oscuros;
 *  - las luminarias de cada bahía modulan su lightmap con los interruptores LT_A…LT_N.
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
  emissive?: [number, number, number]; kind?: 'std' | 'glass' | 'emit' | 'backing' | 'screen'; doubleSide?: boolean; clearcoat?: number; sheen?: number;
};

const lin = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

/** Valores lineales iguales a los de Blender (RMAT) salvo ajustes de respuesta. */
export const RDEF: Record<string, Def> = {
  R_Lining: { color: lin(0.56, 0.54, 0.50), rough: 0.5, metal: 0, maps: { n: 'polymer_n', rep: 4.0, ns: 0.05 } },
  R_LiningDark: { color: lin(0.085, 0.09, 0.10), rough: 0.55, metal: 0, maps: { n: 'polymer_n', rep: 4.0, ns: 0.08 } },
  R_Fabric: { color: lin(0.16, 0.155, 0.15), rough: 0.95, metal: 0, maps: { c: 'wool_c', n: 'wool_n', r: 'wool_r', rep: 3.2, ns: 0.9 }, sheen: 0.35 },
  R_FabricBlue: { color: lin(0.045, 0.085, 0.11), rough: 0.9, metal: 0, maps: { c: 'linen_c', n: 'linen_n', r: 'linen_r', rep: 4.0, ns: 0.7 }, sheen: 0.4 },
  R_Leather: { color: lin(0.055, 0.06, 0.068), rough: 0.5, metal: 0, maps: { n: 'leatherw_n', r: 'leatherw_r', rep: 2.6, ns: 0.6 }, sheen: 0.12 },
  R_Frame: { color: lin(0.05, 0.052, 0.058), rough: 0.36, metal: 0.85, maps: { n: 'brushed_n', r: 'brushed_r', rep: 3, ns: 0.15 } },
  R_Alu: { color: lin(0.78, 0.78, 0.77), rough: 0.28, metal: 1, maps: { n: 'brushed_n', r: 'brushed_r', rep: 4, ns: 0.2 } },
  R_Steel: { color: lin(0.62, 0.62, 0.62), rough: 0.24, metal: 1, maps: { n: 'brushed_n', rep: 6, ns: 0.2 } },
  R_Floor: { color: lin(0.085, 0.086, 0.09), rough: 0.74, metal: 0, maps: { n: 'rubtile_n', r: 'rubtile_r', rep: 2.0, ns: 0.6 } },
  R_Worktop: { color: lin(0.40, 0.33, 0.24), rough: 0.42, metal: 0, maps: { c: 'linen_c', n: 'linen_n', r: 'linen_r', rep: 2.2, ns: 0.25 }, clearcoat: 0.35 },
  R_Rubber: { color: lin(0.02, 0.02, 0.022), rough: 0.8, metal: 0, maps: { n: 'rubber_n', rep: 6, ns: 0.4 } },
  R_Accent: { color: lin(0.62, 0.11, 0.03), rough: 0.4, metal: 0 },
  R_Black: { color: lin(0.012, 0.012, 0.014), rough: 0.32, metal: 0 },
  R_Backing: { color: lin(0.006, 0.006, 0.007), rough: 0.9, metal: 0, kind: 'backing', doubleSide: true },
  R_Glass: { color: lin(0.8, 0.88, 0.95), rough: 0.03, metal: 0, kind: 'glass' },
  R_Screen: { color: lin(0.01, 0.012, 0.016), rough: 0.1, metal: 0, kind: 'screen' },
  R_LED: { color: lin(1, 0.86, 0.70), rough: 0.5, metal: 0, kind: 'emit', emissive: [3.2, 2.7, 2.15] },
  R_LightPanel: { color: lin(1, 0.93, 0.84), rough: 0.5, metal: 0, kind: 'emit', emissive: [2.6, 2.45, 2.2] },
  R_Indicator: { color: lin(0.3, 1, 0.5), rough: 0.4, metal: 0, kind: 'emit', emissive: [0.6, 2.4, 1.0] },
  R_Bag: { color: lin(0.48, 0.44, 0.37), rough: 0.9, metal: 0, maps: { c: 'linen_c', n: 'linen_n', rep: 5, ns: 0.6 }, sheen: 0.3 },
  R_Plant: { color: lin(0.06, 0.2, 0.04), rough: 0.55, metal: 0 },
  R_Label: { color: lin(0.5, 0.49, 0.46), rough: 0.5, metal: 0 },
};

function patch(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShipInv = SHIP_INV;
    sh.uniforms.uBayGain = BAY_GAIN;
    sh.vertexShader = 'uniform mat4 uShipInv;\nvarying float vShipX;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 alcW = modelMatrix * vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        alcW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      #endif
      vShipX = (uShipInv * alcW).x;`);
    sh.fragmentShader = 'uniform float uBayGain[5];\nvarying float vShipX;\n' + sh.fragmentShader.replace(
      '#include <lights_fragment_maps>',
      `
      float alcSpecOcc = 1.0;
      #if defined( RE_IndirectDiffuse )
        #ifdef USE_LIGHTMAP
          vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
          float wD = 1.0 - smoothstep(2.45, 2.85, vShipX);
          float wC = smoothstep(2.45, 2.85, vShipX) * (1.0 - smoothstep(4.50, 4.90, vShipX));
          float wB = smoothstep(4.50, 4.90, vShipX) * (1.0 - smoothstep(6.55, 6.95, vShipX));
          float wA = smoothstep(6.55, 6.95, vShipX) * (1.0 - smoothstep(9.80, 10.05, vShipX));
          float wN = smoothstep(9.80, 10.05, vShipX);
          float bay = wD * uBayGain[3] + wC * uBayGain[2] + wB * uBayGain[1] + wA * uBayGain[0] + wN * uBayGain[4];
          vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * mix(0.06, 1.0, bay);
          irradiance += lightMapIrradiance;
          alcSpecOcc = clamp(dot(lightMapIrradiance, vec3(0.2126, 0.7152, 0.0722)) * 0.9, 0.08, 1.0);
        #elif defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
          iblIrradiance += getIBLIrradiance( geometryNormal );
        #endif
      #endif
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * alcSpecOcc;
        #ifdef USE_CLEARCOAT
          clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * alcSpecOcc;
        #endif
      #endif
      `);
  };
  m.customProgramCacheKey = () => 'alc-rb-' + (m.lightMap ? 'lm' : 'nolm');
}

/** El lightmap se guarda en PNG sRGB (lineal = L/escala) y se decodifica en hardware (SRGB8). */
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
      color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.08, depthWrite: false, envMapIntensity: 0.9,
      specularIntensity: 1, ior: 1.46,
    });
    m.name = name;
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
      const avg = name === 'R_Fabric' ? 1.9 : name === 'R_Floor' ? 3.0 : name === 'R_Worktop' ? 2.2 : name === 'R_FabricBlue' ? 2.4 : name === 'R_Bag' ? 2.2 : 1.35;
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
  patch(m);
  return m;
}
