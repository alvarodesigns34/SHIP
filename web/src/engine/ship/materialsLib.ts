/**
 * Biblioteca PBR web, coherente con blender/alcion/materials.py (mismos nombres
 * y factores base). El exportador glTF no transmite los nodos procedurales de
 * Cycles; aquí se reconstruye el microdetalle con texturas generadas en el
 * navegador sobre las UV de proyección cúbica (1 unidad UV = 1 m), y se usan
 * materiales físicos donde aportan (capa transparente, anisotropía).
 */
import * as THREE from 'three';
import { roughNoise, solarColor, radiatorRough, grimeMap, paintNormal, photo } from './texturesLib';

const cache = new Map<THREE.Material, THREE.Material>();
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

export function enhanceMaterial(src: THREE.Material): THREE.Material {
  if (cache.has(src)) return cache.get(src)!;
  let m = src as THREE.MeshStandardMaterial;
  const n = m.name || '';
  const has = (p: string) => n.startsWith(p);
  m.envMapIntensity = 1.0;
  if (has('M_MLI')) {
    // lámina metalizada real (Foil002): arrugas suaves de una manta flexible multicapa
    m.normalMap = tile(photo('mli', 'n'), 0.9);
    m.normalScale = new THREE.Vector2(0.55, 0.55);
    m.roughnessMap = tile(roughNoise(3), 1.3);
    m.roughness = n.includes('Black') ? 0.55 : 0.36;
    m.metalness = n.includes('Black') ? 0.3 : 1.0;
    m.envMapIntensity = 1.3;
  } else if (has('M_Shield') || has('M_Accent') || has('M_Graphite') || has('M_Dish') || has('M_Decal')) {
    const p = toPhysical(m);
    p.normalMap = tile(paintNormal(), 0.6);
    p.normalScale = new THREE.Vector2(0.18, 0.18);
    p.roughnessMap = tile(grimeMap(), 3.5);
    p.clearcoat = 0.05; p.clearcoatRoughness = 0.6;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Interior')) {
    // polímero/pintura texturizada de paneles interiores (Plastic010) + suciedad de uso a gran escala
    m.normalMap = tile(photo('polymer', 'n'), 0.45);
    m.normalScale = new THREE.Vector2(0.5, 0.5);
    m.roughnessMap = tile(grimeMap(), 1.6);
    m.roughness = Math.max(m.roughness, 0.55);
    // albedo realista de paneles blanquecinos (~0,6–0,7): el blanco puro satura y aplana la imagen
    if (m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.7) m.color.multiplyScalar(0.8);
  } else if (has('M_AlBare') || has('M_AlLi') || has('M_AlChromate') || has('M_Steel') || has('M_Titanium') || has('M_TankTi')) {
    const p = toPhysical(m);
    // metal mecanizado/cepillado real (Metal009)
    p.normalMap = tile(photo('brushed', 'n'), 0.3);
    p.normalScale = new THREE.Vector2(0.3, 0.3);
    p.roughnessMap = tile(photo('brushed', 'r'), 0.3);
    p.roughness = Math.min(1, (m.roughness || 0.35) / 0.47);
    // sin anisotropía: con tangentes por derivadas producía NaN en UV degeneradas
    // (medido: píxeles NaN que bloom/AO propagaban a toda la imagen)
    p.envMapIntensity = 0.8;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Nozzle') || has('M_HallBody') || has('M_AlAnodBlack') || has('M_Bolt')) {
    m.roughnessMap = tile(roughNoise(11), 0.4);
    m.normalMap = tile(paintNormal(), 0.3);
    m.normalScale = new THREE.Vector2(0.1, 0.1);
  } else if (has('M_SeatCushion')) {
    // tapizado (Leather025) teñido por el color base del material
    m.normalMap = tile(photo('leather', 'n'), 0.35);
    m.normalScale = new THREE.Vector2(0.7, 0.7);
    m.roughnessMap = tile(photo('leather', 'r'), 0.35);
    m.roughness = 1.4;
  } else if (has('M_BetaCloth') || has('M_Fabric') || has('M_Kevlar') || has('M_Nextel')) {
    // tejido real (Fabric030)
    m.normalMap = tile(photo('fabric', 'n'), 0.12);
    m.normalScale = new THREE.Vector2(0.8, 0.8);
    m.roughnessMap = tile(photo('fabric', 'r'), 0.12);
    m.roughness = 1.15; m.metalness = 0;
  } else if (has('M_CFRP') || has('M_COPV')) {
    const p = toPhysical(m);
    // tejido de carbono real (Fabric004) bajo resina con capa transparente
    p.map = tile(photo('carbon', 'c'), 0.12); p.color.set(0xffffff);
    p.normalMap = tile(photo('carbon', 'n'), 0.12);
    p.normalScale = new THREE.Vector2(0.45, 0.45);
    p.roughness = 0.4; p.clearcoat = 0.7; p.clearcoatRoughness = 0.2;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_SolarCell')) {
    const p = toPhysical(m);
    p.map = tile(solarColor(), 0.64);
    p.color.set(0xffffff); p.roughness = 0.32; p.metalness = 0.15; p.clearcoat = 0.85; p.clearcoatRoughness = 0.06;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Radiator')) {
    m.roughnessMap = tile(radiatorRough(), 1.6);
    m.roughness = 0.5; m.metalness = 0.0;
  } else if (has('M_Glass') || has('M_Lens')) {
    const p = toPhysical(m);
    // vidrio: sin componente difusa (sólo reflexión especular); con albedo blanco y opacidad
    // parcial las luces interiores lo convertían en un velo gris que tapaba la Tierra
    p.color.set(0x000000);
    p.transparent = true; p.opacity = has('M_GlassInner') ? 0.16 : 0.24;
    p.roughness = 0.02; p.metalness = 0; p.envMapIntensity = has('M_GlassInner') ? 0.6 : 2.0; p.depthWrite = false; p.ior = 1.46; p.reflectivity = 0.55;
    p.userData.glass = true;
    m = p as unknown as THREE.MeshStandardMaterial;
  } else if (has('M_Screen')) {
    m.emissiveIntensity = 1.4;
  } else if (has('M_LED') || has('M_NavLight')) {
    m.emissiveIntensity = 2.2;
  } else if (has('M_Rubber') || has('M_Handrail')) {
    m.normalMap = tile(photo('rubber', 'n'), 0.25);
    m.normalScale = new THREE.Vector2(0.5, 0.5);
    m.roughnessMap = tile(photo('rubber', 'r'), 0.25);
    m.roughness = has('M_Handrail') ? 0.9 : 1.3;
  } else if (has('M_Water')) {
    m.roughness = 0.32;
  } else if (has('M_Leaf')) {
    m.roughness = 0.6;
  }
  if (m.normalMap) m.normalMap.colorSpace = THREE.NoColorSpace;
  m.needsUpdate = true;
  cache.set(src, m);
  return m;
}
