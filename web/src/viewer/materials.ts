/**
 * Reconstrucción del microdetalle de materiales en la web a partir del
 * nombre del material (contrato compartido con blender/alcion/materials.py).
 */
import * as THREE from 'three';
import { mliNormal, roughNoise, paintNormal, weaveNormal, solarColor, radiatorRough, cfrpNormal } from './textures';

const done = new WeakSet<THREE.Material>();

function tile(t: THREE.Texture, meters: number) {
  const c = t.clone();
  c.repeat.set(1 / meters, 1 / meters);
  c.needsUpdate = true;
  return c;
}

export function enhanceMaterial(mesh: THREE.Mesh) {
  const m = mesh.material as THREE.MeshStandardMaterial;
  if (!m || done.has(m)) return;
  done.add(m);
  const n = m.name || '';
  m.envMapIntensity = 1.0;
  const has = (p: string) => n.startsWith(p);
  if (has('M_MLI')) {
    m.normalMap = tile(mliNormal(), 1.1);
    m.normalScale = new THREE.Vector2(0.32, 0.32);
    m.roughnessMap = tile(roughNoise(3), 1.3);
    m.roughness = 0.4;
    m.metalness = n.includes('Black') ? 0.3 : 1.0;
    m.envMapIntensity = 1.4;
  } else if (has('M_Shield') || has('M_Interior') || has('M_Accent') || has('M_Graphite') || has('M_Dish') || has('M_Decal')) {
    m.normalMap = tile(paintNormal(), 0.6);
    m.normalScale = new THREE.Vector2(0.25, 0.25);
    m.roughnessMap = tile(roughNoise(1), 1.4);
  } else if (has('M_Al') || has('M_Titanium') || has('M_Steel') || has('M_TankTi') || has('M_Nozzle') || has('M_HallBody')) {
    m.roughnessMap = tile(roughNoise(7), 0.5);
    m.normalMap = tile(paintNormal(), 0.3);
    m.normalScale = new THREE.Vector2(0.12, 0.12);
  } else if (has('M_BetaCloth') || has('M_Fabric') || has('M_Kevlar') || has('M_Nextel') || has('M_SeatCushion')) {
    m.normalMap = tile(weaveNormal(), 0.05);
    m.normalScale = new THREE.Vector2(0.35, 0.35);
    m.roughnessMap = tile(roughNoise(9), 0.8);
  } else if (has('M_CFRP') || has('M_COPV')) {
    m.normalMap = tile(cfrpNormal(), 0.06);
    m.normalScale = new THREE.Vector2(0.3, 0.3);
    m.roughness = 0.35;
  } else if (has('M_SolarCell')) {
    m.map = tile(solarColor(), 0.64);
    m.color.set(0xffffff);
    m.roughness = 0.28;
    m.metalness = 0.1;
    const pm = m as unknown as THREE.MeshPhysicalMaterial;
    (pm as any).clearcoat = 0.6;
  } else if (has('M_Radiator')) {
    m.roughnessMap = tile(radiatorRough(), 1.6);
    m.roughness = 0.6;
    m.metalness = 0.0;
  } else if (has('M_Glass') || has('M_Lens')) {
    m.transparent = true;
    m.opacity = has('M_GlassInner') ? 0.18 : 0.28;
    m.roughness = 0.03;
    m.metalness = 0.0;
    m.envMapIntensity = 2.2;
    m.depthWrite = false;
    m.userData.glass = true;
    mesh.renderOrder = 1;
    mesh.castShadow = false;
  } else if (has('M_Screen')) {
    m.emissiveIntensity = 1.6;
    m.toneMapped = true;
  } else if (has('M_LED') || has('M_NavLight')) {
    m.emissiveIntensity = 2.5;
  } else if (has('M_Water')) {
    m.roughness = 0.3;
  }
  if (m.normalMap) m.normalMap.colorSpace = THREE.NoColorSpace;
  m.needsUpdate = true;
}
