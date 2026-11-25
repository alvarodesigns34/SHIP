/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Gestor de efectos espaciales y anotaciones técnicas:
 * - Plumas RCS, motores principales y plasma iónico azul de propulsores Hall
 * - Cordón de seguridad EVA (catenaria)
 * - Baliza visual de daño en paneles MMOD
 * - Etiquetas técnicas 3D con resolución automática de solapamiento en pantalla
 */
import * as THREE from 'three';
import { b2t } from './util';
import type { ShipModel, PartNode } from './ship/ShipModel';
import type { Flight } from './sim/Flight';
import type { Systems } from './ship/Systems';
import type { Mode } from './Engine';

export class EffectsManager {
  plumes = new THREE.Group();
  markers = new THREE.Group();
  tether: THREE.Line;
  private plumeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.96, 1.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private hallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.78, 3.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private engineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.55, 0.95), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private plumeMeshes: THREE.Mesh[] = [];
  private labelEls = new Map<string, HTMLDivElement>();
  private labelsLayer: HTMLDivElement;

  constructor(near: THREE.Scene, shipRoot: THREE.Group, labelsLayer: HTMLDivElement) {
    this.labelsLayer = labelsLayer;
    const tg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3()));
    this.tether = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xe8e0c8 }));
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    near.add(this.plumes, this.markers, this.tether);
    this.buildPlumes(shipRoot);
  }

  private buildPlumes(shipRoot: THREE.Group) {
    const cone = new THREE.ConeGeometry(0.12, 1.25, 16, 1, true);
    cone.translate(0, -0.62, 0);
    const quads: [number, number, number, number][] = [];
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
      quads.push([8.35, a, 2.26, 1]);
      quads.push([-4.05, a, 2.2, -1]);
    }
    for (const [x, a, r] of quads) {
      for (const dir of [1, -1]) {
        const m = new THREE.Mesh(cone, this.plumeMat);
        m.position.copy(b2t(x + dir * 0.2, r * Math.cos(a), r * Math.sin(a)));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(dir, 0, 0).normalize());
        m.userData.dir = dir;
        shipRoot.add(m);
        this.plumeMeshes.push(m);
      }
    }
    const big = new THREE.ConeGeometry(0.28, 3.4, 24, 1, true);
    big.translate(0, -1.7, 0);
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
      const m = new THREE.Mesh(big, this.engineMat);
      m.position.copy(b2t(-6.35, 0.95 * Math.cos(a), 0.95 * Math.sin(a)));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(-1, 0, 0).normalize());
      shipRoot.add(m);
    }
    const hall = new THREE.ConeGeometry(0.16, 2.6, 20, 1, true);
    hall.translate(0, -1.3, 0);
    for (const s of [1, -1]) {
      for (const z of [0.2, -0.2]) {
        const m = new THREE.Mesh(hall, this.hallMat);
        m.position.copy(b2t(-5.6, s * 2.62, z));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b2t(-1, 0, 0).normalize());
        shipRoot.add(m);
      }
    }
  }

  updatePlumes(mode: Mode, model: ShipModel, flight: Flight, systems: Systems) {
    const vis = mode !== 'ENGINEERING' && model.explode === 0;
    const fwd = flight.rcsFiring.x;
    this.plumeMat.opacity = vis ? Math.min(0.58, flight.rcsActivity * 0.58) : 0;
    for (const m of this.plumeMeshes) {
      m.visible = vis && flight.rcsActivity > 0.05 && (Math.abs(fwd) < 0.1 || Math.sign(-fwd) === m.userData.dir || flight.rotFiring.lengthSq() > 0.01);
    }
    this.engineMat.opacity = vis ? flight.throttle * 0.40 : 0;
    this.hallMat.opacity = vis && systems.on('SEP') && flight.throttle > 0 ? 0.36 : 0;
  }

  updateTether(eva: boolean, shipRoot: THREE.Group, playerPos: THREE.Vector3) {
    this.tether.visible = eva;
    if (!eva) return;
    const a = shipRoot.localToWorld(b2t(11.05 + 0.6, 0, -3.3));
    const b = shipRoot.localToWorld(playerPos.clone()).add(new THREE.Vector3(0, -0.4, 0));
    const pos = this.tether.geometry.attributes.position as THREE.BufferAttribute;
    const dist = a.distanceTo(b);
    for (let i = 0; i < pos.count; i++) {
      const t = i / (pos.count - 1);
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * Math.min(1.2, dist * 0.12);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }

  updateDamageMarker(mode: Mode, model: ShipModel, systems: Systems, damagedPanel: string, shipQ: THREE.Quaternion) {
    const show = systems.active('mmod_panel');
    if (show && this.markers.children.length === 0) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.25, 0.32, 32),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.2), toneMapped: false, side: THREE.DoubleSide })
      );
      this.markers.add(ring);
    }
    this.markers.visible = show && (mode === 'EVA' || mode === 'FLIGHT' || mode === 'CINEMATIC');
    if (show) {
      const n = model.nodes.get(damagedPanel);
      if (n) {
        const c = model.currentBox(n).getCenter(new THREE.Vector3());
        const out = c.clone().setX(0).normalize();
        const p = model.root.localToWorld(c.clone().addScaledVector(out, 0.03));
        const ring = this.markers.children[0];
        ring.position.copy(p);
        ring.quaternion.copy(shipQ).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out));
        ring.scale.setScalar(1 + 0.15 * Math.sin(performance.now() / 200));
      }
    }
  }

  /**
   * Proyecta etiquetas técnicas 3D y aplica separación vertical automática
   * para evitar solapamientos en vista explosionada / ingeniería.
   */
  updateLabels(mode: Mode, enabled: boolean, model: ShipModel, camera: THREE.Camera, width: number, height: number, onSelect: (n: PartNode) => void) {
    const want: PartNode[] = [];
    if (mode === 'ENGINEERING' && enabled && model.top) {
      const sel = model.selected;
      if (sel && sel.children.length && sel.depth >= 1) want.push(...sel.children);
      else if (!sel) {
        want.push(...model.top.children);
        if (model.explode > 0.4) want.push(...(model.nodes.get('HAB')?.children ?? []));
      }
    }
    const keep = new Set(want.map((n) => n.code));
    for (const [code, el] of this.labelEls) {
      if (!keep.has(code)) { el.remove(); this.labelEls.delete(code); }
    }
    if (!want.length) return;

    const projected: { n: PartNode; el: HTMLDivElement; x: number; y: number; visible: boolean }[] = [];
    for (const n of want.slice(0, 40)) {
      if (n.sector === 'int' && !model.interiorLoaded) continue;
      let el = this.labelEls.get(n.code);
      if (!el) {
        el = document.createElement('div');
        el.className = 'label3d';
        el.innerHTML = `<span class="dot"></span><span class="txt">${n.label}</span>`;
        el.onclick = (e) => { e.stopPropagation(); onSelect(n); };
        this.labelsLayer.appendChild(el);
        this.labelEls.set(n.code, el);
      }
      const v = model.currentBox(n).getCenter(new THREE.Vector3()).applyMatrix4(model.root.matrixWorld).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02;
      projected.push({ n, el, x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, visible });
    }

    // Repulsión ligera en espacio de pantalla para que dos etiquetas nunca se monten encima!
    const visList = projected.filter((p) => p.visible).sort((a, b) => a.y - b.y);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < visList.length; i++) {
        for (let j = i + 1; j < visList.length; j++) {
          const a = visList[i], b = visList[j];
          if (Math.abs(a.x - b.x) < 185 && Math.abs(a.y - b.y) < 28) {
            const push = (28 - Math.abs(a.y - b.y)) * 0.52;
            a.y -= push;
            b.y += push;
          }
        }
      }
    }

    for (const p of projected) {
      p.el.style.opacity = p.visible ? '1' : '0';
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    }
  }
}
