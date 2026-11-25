/**
 * Modo sandbox (entretenimiento): pulsos de luz completamente ficticios contra
 * dianas holográficas de entrenamiento. Los pulsos salen de la retícula de la
 * cámara (no de ningún sistema montado en la nave), sin modelos de armamento
 * ni balística: es un juego de luz y reflejos.
 */
import * as THREE from 'three';
import { buildTarget, WorldObject } from './world/Props';

interface Pulse { pos: THREE.Vector3; vel: THREE.Vector3; life: number; mesh: THREE.Mesh; }
interface Burst { pts: THREE.Points; vel: Float32Array; life: number; }

export class Sandbox {
  active = false;
  group = new THREE.Group();
  targets: (WorldObject & { alive: boolean; respawn: number })[] = [];
  pulses: Pulse[] = [];
  bursts: Burst[] = [];
  score = 0;
  streak = 0;
  shots = 0;
  private pulseGeo = new THREE.CapsuleGeometry(0.06, 1.4, 4, 8);
  private pulseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.0), toneMapped: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  cooldown = 0;

  start(center: THREE.Vector3, forward: THREE.Vector3) {
    this.active = true;
    this.score = 0; this.streak = 0; this.shots = 0;
    for (const t of this.targets) this.group.remove(t.group);
    this.targets = [];
    const up = new THREE.Vector3(0, 1, 0);
    const right = forward.clone().cross(up).normalize();
    for (let i = 0; i < 8; i++) {
      const t = buildTarget(i) as WorldObject & { alive: boolean; respawn: number };
      const a = (i / 8) * Math.PI * 2;
      t.pos.copy(center).addScaledVector(forward, 70 + (i % 3) * 25).addScaledVector(right, Math.cos(a) * 40).addScaledVector(up, Math.sin(a) * 22);
      t.vel.set(Math.sin(i * 1.7) * 0.6, Math.cos(i * 2.3) * 0.4, Math.sin(i) * 0.5);
      t.alive = true; t.respawn = 0;
      this.targets.push(t);
      this.group.add(t.group);
    }
  }

  stop() {
    this.active = false;
    for (const t of this.targets) this.group.remove(t.group);
    this.targets = [];
    for (const p of this.pulses) this.group.remove(p.mesh);
    this.pulses = [];
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, inheritVel: THREE.Vector3) {
    if (this.cooldown > 0) return false;
    this.cooldown = 0.18;
    this.shots++;
    const m = new THREE.Mesh(this.pulseGeo, this.pulseMat);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const p: Pulse = { pos: origin.clone().addScaledVector(dir, 2), vel: dir.clone().multiplyScalar(160).add(inheritVel), life: 2.2, mesh: m };
    this.pulses.push(p);
    this.group.add(m);
    return true;
  }

  private burst(at: THREE.Vector3, color: THREE.Color) {
    const n = 220;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 14);
      vel.set([v.x, v.y, v.z], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size: 0.35, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pts = new THREE.Points(g, m);
    pts.userData.origin = at.clone();
    pts.frustumCulled = false;
    this.group.add(pts);
    this.bursts.push({ pts, vel, life: 1.4 });
  }

  /** origin: origen flotante del renderizado (m). Devuelve impactos de este paso. */
  update(dt: number, origin: THREE.Vector3) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let hits = 0;
    for (const t of this.targets) {
      if (!t.alive) { t.respawn -= dt; if (t.respawn <= 0) { t.alive = true; t.group.visible = true; t.group.scale.setScalar(0.01); } continue; }
      t.pos.addScaledVector(t.vel, dt);
      t.group.rotation.y += dt * 0.6; t.group.rotation.x += dt * 0.25;
      t.group.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-4 * dt));
      t.group.position.copy(t.pos).sub(origin);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      p.mesh.position.copy(p.pos).sub(origin);
      let hit = false;
      for (const t of this.targets) {
        if (!t.alive) continue;
        const seg = new THREE.Line3(prev, p.pos);
        const cp = seg.closestPointToPoint(t.pos, true, new THREE.Vector3());
        if (cp.distanceTo(t.pos) < t.radius) {
          hit = true; hits++; t.alive = false; t.group.visible = false; t.respawn = 3.5;
          this.streak++; this.score += 100 + 25 * Math.min(10, this.streak);
          this.burst(t.pos, new THREE.Color(0.5, 2.2, 3));
          break;
        }
      }
      if (hit || p.life <= 0) { this.group.remove(p.mesh); this.pulses.splice(i, 1); if (!hit && p.life <= 0) this.streak = 0; }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      const pos = b.pts.geometry.attributes.position as THREE.BufferAttribute;
      const o = (b.pts.userData.origin as THREE.Vector3).clone().sub(origin);
      const age = 1.4 - b.life;
      for (let k = 0; k < pos.count; k++) pos.setXYZ(k, o.x + b.vel[k * 3] * age, o.y + b.vel[k * 3 + 1] * age, o.z + b.vel[k * 3 + 2] * age);
      pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / 1.4);
      if (b.life <= 0) { this.group.remove(b.pts); b.pts.geometry.dispose(); this.bursts.splice(i, 1); }
    }
    return hits;
  }
}
