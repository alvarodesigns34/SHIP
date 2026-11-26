/**
 * Comparativa reproducible Singularity ↔ Rebirth: mismas posiciones de cámara (coordenadas de nave
 * Blender), mismo campo de visión y misma resolución (1280×760) que tests/compare_shots.cjs.
 * Captura el renderizado REAL de la aplicación (no renders de Cycles).
 *   ALCION_URL=http://127.0.0.1:4173/ node tests/compare_rebirth.cjs <out_dir> [lista]
 */
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'rebirth', 'after');
const only = (process.argv[3] || '').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const SHOTS = {
  '01_ext_general': { eng: [22, 26, 9, 2.5, 0, 0, 34] },
  '02_ext_closeup': { eng: [14.5, 4.2, 4.0, 10.6, 0, 0.9, 36] },
  '03_ext_engines': { eng: [-11.0, 3.6, -2.0, -5.2, 0, 0, 38] },
  '04_cockpit_seated': { seat: true },
  '05_cockpit_overview': { int: [6.35, 0.0, 0.35, 8.9, 0.0, -0.15, 72] },
  '06_lab': { int: [4.25, 0.35, 0.38, 6.4, -0.65, -0.35, 72] },
  '07_crew_quarters': { int: [3.65, -0.45, 0.25, 3.65, 1.35, -0.15, 72] },
  '08_galley_services': { int: [2.55, -0.25, 0.25, 0.9, 0.7, -0.15, 72] },
  '09_corridor_aft': { int: [8.1, -0.1, 0.25, 0.6, 0.0, -0.1, 72] },
  '10_cupola': { int: [11.05, 0.0, 0.85, 11.4, 0.2, 2.2, 74] },
  '13_earth_orbit': { flight: true },
  '14_earth_window': { int: [5.72, 0.0, -0.6, 5.72, 0.0, -2.5, 68] },
  '15_exploded': { explode: true },
};
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  await p.addInitScript(() => { localStorage.setItem('alcion-tut-off', '1'); localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'alta', dynamicRes: false })); localStorage.removeItem('alcion-bo-save'); });
  await p.goto(process.env.ALCION_URL || 'http://127.0.0.1:4173/');
  await p.waitForFunction(() => window.__engine && window.__engine.interiorReady, null, { timeout: 300000 });
  const stats = {};
  for (const [name, d] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    await p.evaluate(([d]) => {
      const e = window.__engine;
      e.hudHidden = true;
      // cabina encendida para que las pantallas muestren contenido (igual que en Singularity)
      for (const id of ['BAT', 'BUSA', 'BUSB', 'AVX', 'LT_A', 'LT_B', 'LT_C', 'LT_D', 'LT_N', 'ECLSS', 'FANS']) if (!e.systems.sw[id]) { e.systems.toggle(id); e.interior.setMech('sw:' + id, 0.45, true); }
      e.systems.booted = true;
      const V = e.camera.position.constructor;
      if (d.eng) {
        const [bx, by, bz, tx, ty, tz, fov] = d.eng;
        e.setMode('ENGINEERING'); e.setExplode(0); e.camera.fov = fov; e.camera.updateProjectionMatrix();
        e.camera.position.copy(e.model.root.localToWorld(new V(bx, bz, -by))); e.controls.target.copy(e.model.root.localToWorld(new V(tx, tz, -ty)));
        e.camera.lookAt(e.controls.target); e.controls.update(); e.tick(0.1);
      } else if (d.int) {
        const [bx, by, bz, lx, ly, lz, fov] = d.int;
        e.enterInterior('cabina'); e.player.pos.set(bx, bz, -by); e.player.vel.set(0, 0, 0);
        const dx = lx - bx, dy = lz - bz, dz = -(ly - by), l = Math.hypot(dx, dy, dz);
        e.player.yaw = Math.atan2(-dx / l, -dz / l); e.player.pitch = Math.asin(dy / l);
        e.camera.fov = fov; e.camera.updateProjectionMatrix();
        e.player.locomotion = 'float'; e.tick(0.05);
      } else if (d.seat) { e.enterInterior('cabina'); e.sit(1); e.player.pitch = -0.22; e.tick(0.2); }
      else if (d.flight) { e.setMode('FLIGHT'); e.flightCam = 'chase'; e.tick(0.3); }
      else if (d.explode) {
        e.setMode('ENGINEERING'); e.setExplode(1); e.camera.fov = 34; e.camera.updateProjectionMatrix();
        e.camera.position.copy(e.model.root.localToWorld(new V(30, 18, -36))); e.controls.target.copy(e.model.root.localToWorld(new V(1, -2, 0)));
        e.camera.lookAt(e.controls.target); e.controls.update(); e.tick(0.2);
      }
    }, [d]);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 90, timeout: 300000 });
    stats[name] = await p.evaluate(() => { const s = window.__engine.frameStats(); return { calls: s.calls, tris: s.tris }; });
    console.log(name, JSON.stringify(stats[name]));
  }
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 1));
  await b.close();
})();
