/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Biblioteca PBR web unificada con blender/alcion/materials.py + Cycles interior lightmaps.
 *
 * - MeshPhysicalMaterial con sheen textil real (sacos, cortinas, asientos, CTBs, Beta-cloth)
 * - Metalizado calibrado con normales y rugosidad fotográfica (ambientCG CC0)
 * - Preservación intacta de mapas embebidos en glTF (M_CrewAtlas, M_CrewAtlasEmit, M_Label, M_Screen_*)
 * - Asignación automática del lightmap horneado en Cycles (`lm_interior`, canal UV1) a materiales interiores
 */
import * as THREE from 'three';
import { roughNoise, solarColor, radiatorRough, grimeMap, paintNormal, photo, getInteriorLightmap } from './texturesLib';

const cache = new Map<string, THREE.Material>();
const lightmappedMats = new Set<THREE.MeshStandardMaterial>();
export let TEX_RES = 1;

function tile(t: THREE.Texture, meters: number, rot = 0) {
  const c = t.clone();
  c.repeat.set(1 / meters, 1 / meters);
  c.rotation = rot;
  c.needsUpdate = true;
  return c;
}

function toPhysical(m: THREE.MeshStandardMaterial) {
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p as any, m);
  p.name = m.name;
  p.userData = { ...m.userData };
  return p;
}

/** Materiales que NO deben recibir lightmap (vidrio transparente o emisores puros). */
function skipLightmap(name: string) {
  return /^(M_Glass|M_Lens|M_LED|M_NavLight|M_Screen|M_CrewAtlasEmit)/.test(name);
}

/**
 * Mejora un material glTF con mapas PBR reales y, si pertenece al sector interior
 * (o mamparo interno), le vincula el lightmap horneado en Cycles por canal UV1.
 */
export function enhanceMaterial(src: THREE.Material, useLightmap = false): THREE.Material {
  const key = src.uuid + (useLightmap ? ':lm' : ':ext');
  if (cache.has(key)) return cache.get(key)!;

  // Clonamos si vamos a crear variantes interior (con lightmap) vs exterior (sin lightmap)
  let m = (useLightmap ? src.clone() : src) as THREE.MeshStandardMaterial;
  const n = m.name || '';
  const has = (p: string) => n.startsWith(p);
  m.envMapIntensity = useLightmap ? 0.65 : 1.05;

  if (has('M_CrewAtlasEmit')) {
    m.emissiveIntensity = 1.55;
    m.roughness = 0.14;
    m.metalness = 0.0;
    m.envMapIntensity = 0.4;
  } else if (has('M_CrewAtlas') || has('M_Label')) {
    // Preservar mapa embebido de fotos/parches/etiquetas RFID sin sobrescribirlo
    m.roughness = has('M_CrewAtlas') ? 0.30 : 0.56;
    m.metalness = 0.0;
  } else if (has('M_MLI')) {
    m.normalMap = tile(photo('mli', 'n'), 0.95);
    m.normalScale = new THREE.Vector2(0.45, 0.45);
    m.roughnessMap = tile(roughNoise(3), 1.3);
    m.roughness = n.includes('Black') ? 0.52 : 0.36;
    m.metalness = n.includes('Black') ? 0.32 : 0.98;
    m.envMapIntensity = 1.35;
  } else if (has('M_Shield') || has('M_Accent') || has('M_Graphite') || has('M_Dish') || has('M_Decal')) {
    const p = toPhysical(m);
    p.normalMap = tile(paintNormal(), 0.65);
    p.normalScale = new THREE.Vector2(0.16, 0.16);
    p.roughnessMap = tile(grimeMap(), 3.2);
    p.clearcoat = 0.08;
    p.clearcoatRoughness = 0.52;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Interior')) {
    m.normalMap = tile(photo('polymer', 'n'), 0.48);
    m.normalScale = new THREE.Vector2(0.40, 0.40);
    m.roughnessMap = tile(grimeMap(), 1.8);
    m.roughness = Math.max(m.roughness, 0.52);
    if (m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.72) m.color.multiplyScalar(0.84);
  } else if (has('M_AlBare') || has('M_AlLi') || has('M_AlChromate') || has('M_Steel') || has('M_Titanium') || has('M_TankTi') || has('M_GoldPlate') || has('M_Copper')) {
    const p = toPhysical(m);
    p.normalMap = tile(photo('brushed', 'n'), 0.32);
    p.normalScale = new THREE.Vector2(0.28, 0.28);
    p.roughnessMap = tile(photo('brushed', 'r'), 0.32);
    p.roughness = Math.min(1, (m.roughness || 0.32) / 0.47);
    p.envMapIntensity = useLightmap ? 0.85 : 1.05;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_NozzleHot')) {
    const p = toPhysical(m);
    p.roughnessMap = tile(roughNoise(13), 0.35);
    p.normalMap = tile(photo('brushed', 'n'), 0.22);
    p.normalScale = new THREE.Vector2(0.22, 0.22);
    p.metalness = 0.88;
    p.roughness = 0.30;
    p.clearcoat = 0.25;
    p.clearcoatRoughness = 0.35;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Nozzle') || has('M_HallBody') || has('M_AlAnodBlack') || has('M_Bolt')) {
    m.roughnessMap = tile(roughNoise(11), 0.4);
    m.normalMap = tile(paintNormal(), 0.3);
    m.normalScale = new THREE.Vector2(0.12, 0.12);
    if (has('M_Nozzle')) { m.metalness = 0.86; m.roughness = 0.36; }
  } else if (has('M_SeatCushion')) {
    const p = toPhysical(m);
    p.normalMap = tile(photo('leather', 'n'), 0.32);
    p.normalScale = new THREE.Vector2(0.65, 0.65);
    p.roughnessMap = tile(photo('leather', 'r'), 0.32);
    p.roughness = 0.92;
    p.metalness = 0.0;
    p.sheen = 0.42;
    p.sheenRoughness = 0.72;
    p.sheenColor = new THREE.Color(0x5a6270);
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_BetaCloth') || has('M_Fabric') || has('M_Kevlar') || has('M_Nextel')) {
    const p = toPhysical(m);
    p.normalMap = tile(photo('fabric', 'n'), 0.14);
    p.normalScale = new THREE.Vector2(0.75, 0.75);
    p.roughnessMap = tile(photo('fabric', 'r'), 0.14);
    p.roughness = 0.95;
    p.metalness = 0.0;
    p.sheen = 0.55;
    p.sheenRoughness = 0.78;
    p.sheenColor = has('M_FabricBlue') ? new THREE.Color(0x7c9ec2) : new THREE.Color(0xded9cf);
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_CFRP') || has('M_COPV')) {
    const p = toPhysical(m);
    p.map = tile(photo('carbon', 'c'), 0.12);
    p.color.set(0xffffff);
    p.normalMap = tile(photo('carbon', 'n'), 0.12);
    p.normalScale = new THREE.Vector2(0.45, 0.45);
    p.roughness = 0.38;
    p.clearcoat = 0.75;
    p.clearcoatRoughness = 0.18;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_SolarCell')) {
    const p = toPhysical(m);
    p.map = tile(solarColor(), 0.64);
    p.color.set(0xffffff);
    p.roughness = 0.28;
    p.metalness = 0.18;
    p.clearcoat = 0.90;
    p.clearcoatRoughness = 0.06;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Radiator')) {
    m.roughnessMap = tile(radiatorRough(), 1.6);
    m.roughness = 0.42;
    m.metalness = 0.08;
  } else if (has('M_Glass') || has('M_Lens')) {
    const p = toPhysical(m);
    p.color.set(0x000000);
    p.transparent = true;
    p.opacity = has('M_GlassInner') ? 0.11 : 0.20;
    p.roughness = 0.02;
    p.metalness = 0;
    p.envMapIntensity = has('M_GlassInner') ? 0.45 : 1.75;
    p.depthWrite = false;
    p.ior = 1.46;
    p.reflectivity = 0.52;
    p.userData.glass = true;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Screen')) {
    m.emissiveIntensity = 1.45;
  } else if (has('M_LED') || has('M_NavLight')) {
    m.emissiveIntensity = 2.4;
  } else if (has('M_Rubber') || has('M_Handrail')) {
    m.normalMap = tile(photo('rubber', 'n'), 0.25);
    m.normalScale = new THREE.Vector2(0.45, 0.45);
    m.roughnessMap = tile(photo('rubber', 'r'), 0.25);
    m.roughness = has('M_Handrail') ? 0.75 : 1.1;
  } else if (has('M_Water')) {
    m.roughness = 0.25;
  } else if (has('M_Leaf')) {
    const p = toPhysical(m);
    p.roughness = 0.52;
    p.sheen = 0.30;
    p.sheenColor = new THREE.Color(0x6bb056);
    p.side = THREE.DoubleSide;
    m = p as unknown as THREE.MeshStandardMaterial;
  }

  // Vincular el lightmap horneado en Cycles (canal UV1) a todos los materiales interiores no emisores
  if (useLightmap && !skipLightmap(n)) {
    const lm = getInteriorLightmap((upgraded) => {
      for (const mat of lightmappedMats) {
        mat.lightMap = upgraded;
        mat.needsUpdate = true;
      }
    });
    m.lightMap = lm;
    m.lightMapIntensity = 1.85;
    m.userData.hasBakedLM = true;
    lightmappedMats.add(m);
  }

  if (m.normalMap) m.normalMap.colorSpace = THREE.NoColorSpace;
  m.needsUpdate = true;
  cache.set(key, m);
  return m;
}
