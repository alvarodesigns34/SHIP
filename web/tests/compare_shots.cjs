/**
 * ALCIÓN HX-4 — Reproducible fixed-camera visual comparison suite.
 * Captures identical camera positions, orientations, FOV, resolution (1280x760),
 * and graphics quality ('alta') for strict before/after inspection.
 *
 * Usage:
 *   ALCION_URL=http://localhost:4173/ node tests/compare_shots.cjs <out_dir> [comma_list_or_all]
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const out = process.argv[2] || '../docs/singularity_baseline';
const only = process.argv[3] || 'all';
fs.mkdirSync(out, { recursive: true });

function findChrome() {
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

(async () => {
  const execPath = findChrome();
  const browser = await chromium.launch({
    executablePath: execPath,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const logs = [];
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('CONSOLE_ERR ' + m.text().slice(0, 300)); });

  await page.addInitScript(() => {
    localStorage.setItem('alcion-tut-off', '1');
    localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'alta', dynamicRes: false }));
    localStorage.removeItem('alcion-bo-save');
  });

  await page.goto(process.env.ALCION_URL || 'http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const shot = async (name, fn, wait = 1800) => {
    if (only !== 'all' && !only.split(',').includes(name)) return;
    try {
      await page.evaluate(fn);
    } catch (e) {
      logs.push('EVAL_ERR ' + name + ': ' + e.message);
    }
    await page.waitForTimeout(wait);
    const dest = path.join(out, `${name}.jpg`);
    await page.screenshot({ path: dest, type: 'jpeg', quality: 92, timeout: 180000 });
    console.log('[shot]', dest);
  };

  // Helper injected into page for deterministic camera placement in ship Blender coords
  await page.evaluate(() => {
    window.__setIntCam = (bx, by, bz, lx, ly, lz, fov = 70) => {
      const e = window.__engine;
      e.seated = false;
      e.player.eva = false;
      e.activity = null;
      if (e.mode !== 'INTERIOR') e.setMode('INTERIOR');
      e.player.locomotion = 'float';
      e.camera.fov = fov;
      e.camera.updateProjectionMatrix();
      // b2t: (x, y, z) -> (x, z, -y)
      e.player.pos.set(bx, bz, -by);
      e.player.vel.set(0, 0, 0);
      const dx = lx - bx, dy = lz - bz, dz = -(ly - by);
      const len = Math.hypot(dx, dy, dz) || 1;
      e.player.yaw = Math.atan2(-dx / len, -dz / len);
      e.player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      e.tick(0.15);
    };
    window.__setEngCam = (bx, by, bz, tx, ty, tz, fov = 34) => {
      const e = window.__engine;
      e.setMode('ENGINEERING');
      e.setExplode(0);
      e.setSection(false);
      e.camera.fov = fov;
      e.camera.updateProjectionMatrix();
      const V = e.camera.position.constructor;
      const pL = new V(bx, bz, -by);
      const tL = new V(tx, tz, -ty);
      e.camera.position.copy(e.model.root.localToWorld(pL));
      e.controls.target.copy(e.model.root.localToWorld(tL));
      e.camera.lookAt(e.controls.target);
      e.controls.update();
      e.tick(0.1);
    };
  });

  // 1. Exterior general (hero 3/4 view with Earth)
  await shot('01_ext_general', () => {
    const e = window.__engine;
    e.setScenario('leo', true);
    e.hudHidden = true;
    window.__setEngCam(22, 26, 9, 2.5, 0, 0, 34);
  });

  // 2. Exterior close-up (Cupola + Node + Forward Hull)
  await shot('02_ext_closeup', () => {
    window.__setEngCam(14.5, 4.2, 4.0, 10.6, 0, 0.9, 36);
  });

  // 3. Exterior engines close-up
  await shot('03_ext_engines', () => {
    window.__setEngCam(-11.0, 3.6, -2.0, -5.2, 0, 0, 38);
  });

  // 4. Cockpit seated view
  await shot('04_cockpit_seated', () => {
    const e = window.__engine;
    e.hudHidden = false;
    e.sit(1);
    e.player.yaw = -Math.PI / 2;
    e.player.pitch = -0.22;
    e.tick(0.2);
  });

  // 5. Cockpit overview (standing behind pilot seats looking forward)
  await shot('05_cockpit_overview', () => {
    window.__setIntCam(6.35, 0.0, 0.35, 8.9, 0.0, -0.15, 72);
  });

  // 6. Laboratory (glovebox, racks, nadir window)
  await shot('06_lab', () => {
    window.__setIntCam(4.25, 0.35, 0.38, 6.4, -0.65, -0.35, 72);
  });

  // 7. Crew quarters (sleeping bags, laptops, curtains)
  await shot('07_crew_quarters', () => {
    window.__setIntCam(3.65, -0.45, 0.25, 3.65, 1.35, -0.15, 72);
  });

  // 8. Galley & Services (Bay D port/aft)
  await shot('08_galley_services', () => {
    window.__setIntCam(2.55, -0.25, 0.25, 0.9, 0.7, -0.15, 72);
  });

  // 9. Full corridor looking aft (depth, bags, lighting, hydroponics)
  await shot('09_corridor_aft', () => {
    window.__setIntCam(8.1, -0.1, 0.25, 0.6, 0.0, -0.1, 72);
  });

  // 10. Cupola interior looking out
  await shot('10_cupola', () => {
    window.__setIntCam(11.05, 0.0, 0.85, 11.4, 0.2, 2.2, 74);
  });

  // 11. Airlock interior (suits, hatch, control panel)
  await shot('11_airlock', () => {
    window.__setIntCam(11.05, -0.15, -1.65, 11.15, 0.2, -2.95, 74);
  });

  // 12. Hands + Drink activity
  await shot('12_hands_drink', () => {
    const e = window.__engine;
    window.__setIntCam(2.3, -0.1, 0.2, 1.6, 1.0, 0.0, 70);
    e.crew.needs.hydration = 20;
    e.startActivity('drink');
    e.tick(1.3);
  });

  // 13. Earth in LEO (Flight chase view)
  await shot('13_earth_orbit', () => {
    const e = window.__engine;
    e.activity = null;
    e.seated = false;
    e.setMode('FLIGHT');
    e.flightCam = 'chase';
    e.tick(0.2);
  });

  // 14. Nadir window Earth view
  await shot('14_earth_window', () => {
    window.__setIntCam(5.72, 0.0, 0.05, 5.72, 0.0, -2.5, 68);
  });

  // 15. Exploded view (100%)
  await shot('15_exploded', () => {
    const e = window.__engine;
    e.hudHidden = false;
    e.setMode('ENGINEERING');
    e.setExplode(1.0);
    e.camera.fov = 34;
    e.camera.updateProjectionMatrix();
    const V = e.camera.position.constructor;
    e.camera.position.copy(e.model.root.localToWorld(new V(30, 18, -36)));
    e.controls.target.copy(e.model.root.localToWorld(new V(1, -2, 0)));
    e.camera.lookAt(e.controls.target);
    e.controls.update();
    e.tick(0.2);
  }, 2500);

  const stats = await page.evaluate(() => window.__engine.snapshot().stats);
  console.log('STATS', JSON.stringify(stats));
  if (logs.length) console.log('LOGS\n' + logs.join('\n'));
  await browser.close();
})();
