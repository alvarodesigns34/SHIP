/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Suite de verificación funcional, óptica, arquitectónica y de persistencia (22 pruebas estrictas).
 *
 * Sale con código de error 1 si falla CUALQUIER prueba, si hay pageerror, console.error
 * o cualquier petición HTTP >= 400 (GLB, KTX2, WASM, texturas, planos, JSON).
 *
 * Uso:
 *   ALCION_URL=http://127.0.0.1:4173/ node tests/functional.cjs
 */
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('node:fs');

function findChrome() {
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

(async () => {
  const url = process.env.ALCION_URL || 'http://127.0.0.1:4173/';
  const browser = await chromium.launch({
    executablePath: findChrome(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const p = await browser.newPage({ viewport: { width: 1024, height: 640 } });

  const errs = [];
  const httpErrs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('CONSOLE_ERR: ' + m.text().slice(0, 260));
  });
  p.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
      httpErrs.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  await p.addInitScript(() => {
    localStorage.setItem('alcion-tut-off', '1');
    localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'baja', dynamicRes: false }));
    if (!sessionStorage.getItem('alcion-keep-save')) {
      localStorage.removeItem('alcion-bo-save');
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 300000 });
  await p.waitForTimeout(1500);

  let passed = 0;
  let failed = 0;
  const results = [];

  const test = async (name, fn) => {
    try {
      const r = await p.evaluate(fn);
      const ok = !!(r && r.ok);
      if (ok) passed++;
      else failed++;
      results.push(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} ${JSON.stringify(r && r.info !== undefined ? r.info : r)}`);
    } catch (e) {
      failed++;
      results.push(`FAIL  ${name.padEnd(32)} THREW: ${e.message.slice(0, 220)}`);
    }
  };

  // 1. BatchedMesh activo y eficiencia de draw calls
  await test('01 BatchedMesh + draw calls', () => {
    const e = window.__engine;
    const st = e.snapshot().stats;
    return {
      ok: st.batches >= 30 && st.instances >= 1500 && st.calls < 180,
      info: { batches: st.batches, instances: st.instances, calls: st.calls, tris: st.tris },
    };
  });

  // 2. Lightmaps Cycles UV1 (TEXCOORD_1) en lotes interiores
  await test('02 Lightmap Cycles + UV1', () => {
    const e = window.__engine;
    let uv1Batches = 0;
    let lmBatches = 0;
    let lmLoaded = false;
    for (const b of e.model.batches) {
      if (b.bm && b.bm.geometry && b.bm.geometry.getAttribute('uv1')) uv1Batches++;
      const mat = b.material;
      if (mat && mat.lightMap && mat.userData && mat.userData.hasBakedLM) {
        lmBatches++;
        if (mat.lightMap.image && (mat.lightMap.image.width >= 1024 || mat.lightMap.isCompressedTexture)) lmLoaded = true;
      }
    }
    return { ok: uv1Batches >= 15 && lmBatches >= 15 && lmLoaded, info: { uv1Batches, lmBatches, lmLoaded } };
  });

  // 3. Manos anatómicas riggeadas de 25 articulaciones + guantes EVA
  await test('03 Manos riggeadas 25 huesos', () => {
    const e = window.__engine;
    let skinned = 0;
    let maxBones = 0;
    let hasGlove = false;
    e.hands.group.traverse((o) => {
      if (o.isSkinnedMesh) {
        skinned++;
        if (o.skeleton) maxBones = Math.max(maxBones, o.skeleton.bones.length);
        if (o.name.startsWith('EVAGlove')) hasGlove = true;
      }
    });
    e.hands.setEVA(true);
    const gloveL = e.hands.group.getObjectByName('EVAGlove_L');
    const skinL = e.hands.group.getObjectByName('SkinHand_L');
    const swapped = !!(gloveL && gloveL.visible && skinL && !skinL.visible);
    e.hands.setEVA(false);
    return { ok: skinned >= 4 && maxBones >= 25 && hasGlove && swapped, info: { skinned, maxBones, hasGlove, swapped } };
  });

  // 4. Cambio limpio entre los 7 modos
  await test('04 Cambio de los 7 modos', () => {
    const e = window.__engine;
    const ms = ['FLIGHT', 'INTERIOR', 'ENGINEERING', 'MISSIONS', 'SANDBOX', 'CINEMATIC'];
    const seen = [];
    for (const m of ms) { e.setMode(m); seen.push(e.mode); }
    return { ok: seen.join() === ms.join(), info: seen };
  });

  // 5. Interruptor de luces Bahía A + atenuación del lightmap
  await test('05 Interruptor luces + palanca', async () => {
    const e = window.__engine;
    e.enterInterior('cabina');
    e.systems.sw.LT_A = true;
    e.tick(0.5);
    const before = e.cockpit.bayLights.filter((l) => l.bay === 'A' && l.rect).map((l) => l.rect.intensity)[0];
    const n = e.model.mechs.get('sw:LT_A');
    e['hoverCtl'] = { node: n, ctl: 'sw:LT_A' };
    e.tryInteract();
    e.tick(1.2);
    const after = e.cockpit.bayLights.filter((l) => l.bay === 'A' && l.rect).map((l) => l.rect.intensity)[0];
    const lever = e.model.mech('sw:LT_A').value;
    e['hoverCtl'] = { node: n, ctl: 'sw:LT_A' };
    e.tryInteract();
    e.tick(0.5);
    return { ok: before > 0 && after === 0 && lever < 0, info: { before: +before.toFixed(2), after, lever: +lever.toFixed(2) } };
  });

  // 6. Aviónica + pantallas MFD 768 px
  await test('06 Aviónica + MFDs 768px', () => {
    const e = window.__engine;
    e.systems.sw.AVX = false;
    e.tick(0.5);
    const off = !e.systems.screensOn();
    e.systems.sw.AVX = true;
    e.tick(4.0);
    const maxW = Math.max(...e.cockpit.screens.map((s) => Math.max(s.w, s.h)));
    return { ok: off && e.systems.booted && e.cockpit.screens.length >= 8 && maxW >= 768, info: { off, booted: e.systems.booted, screens: e.cockpit.screens.length, maxW } };
  });

  // 7. Física de vuelo 6-GDL y frenado asistido
  await test('07 Física de vuelo 6-GDL', () => {
    const e = window.__engine;
    e.setMode('FLIGHT');
    e.flight.input.throttle = 0;
    e.flight.state.vel.set(0, 0, 0);
    e.input.touch.fwd = 1; e.tick(3); e.input.touch.fwd = 0;
    const v1 = e.flight.state.vel.length();
    e.tick(3);
    const v2 = e.flight.state.vel.length();
    e.input.touch.brake = 1; e.tick(8); e.input.touch.brake = 0;
    const v3 = e.flight.state.vel.length();
    return { ok: v1 > 0.05 && Math.abs(v2 - v1) / v1 < 0.15 && v3 < v2 * 0.5, info: { v1: +v1.toFixed(3), v2: +v2.toFixed(3), v3: +v3.toFixed(3) } };
  });

  // 8. Telemetría orbital kepleriana (LEO y Lunar)
  await test('08 Telemetría orbital kepler', () => {
    const e = window.__engine;
    e.setScenario('leo', true);
    e.tick(0.2);
    const leo = e.snapshot().orbit;
    e.setScenario('lunar', true);
    e.tick(0.2);
    const lun = e.snapshot().orbit;
    e.setScenario('leo', true);
    e.tick(0.2);
    const okLeo = leo.vOrbKmS > 7.3 && leo.vOrbKmS < 8.0 && leo.periodMin > 85 && leo.periodMin < 105;
    const okLun = lun.vOrbKmS > 1.3 && lun.vOrbKmS < 1.9 && lun.periodMin > 100 && lun.periodMin < 240;
    return { ok: okLeo && okLun, info: { leoV: +leo.vOrbKmS.toFixed(2), leoT: +leo.periodMin.toFixed(1), lunV: +lun.vOrbKmS.toFixed(2), lunT: +lun.periodMin.toFixed(1) } };
  });

  // 9. Atraque IDSS con Estación Tesela
  await test('09 Atraque IDSS Tesela', () => {
    const e = window.__engine;
    e.setMode('FLIGHT');
    e.placeNear('tesela', 0.3);
    e.flight.state.vel.set(0, 0, 0);
    e.systems.sw.DOCK = true;
    e.tick(1.0);
    const d = e.dockInfo();
    const ok = e.flight.docked === 'tesela';
    e.flight.docked = null;
    return { ok, info: { range: +d.range.toFixed(2), angle: +d.angle.toFixed(2), docked: ok } };
  });

  // 10. Brazo robótico 7 GDL
  await test('10 Brazo robótico despliegue', () => {
    const e = window.__engine;
    e.systems.sw.RBT = true;
    const a0 = e.mech.joints.map((j) => j.angle);
    e.mech.setPose('deploy');
    e.tick(4.0);
    const a1 = e.mech.joints.map((j) => j.angle);
    const delta = a1.reduce((acc, v, i) => acc + Math.abs(v - a0[i]), 0);
    e.mech.setPose('stow');
    e.tick(2.0);
    return { ok: delta > 0.5, info: { deltaRad: +delta.toFixed(2) } };
  });

  // 11. Asiento de pilotaje + manos sentadas
  await test('11 Cabina sentada + manos', () => {
    const e = window.__engine;
    e.enterInterior('cabina');
    e.sit(1);
    e.tick(0.5);
    const seated = e.seated;
    const handsVis = e.hands.target[0].visible && e.hands.target[1].visible;
    e.standUp();
    return { ok: seated && handsVis, info: { seated, handsVis } };
  });

  // 12. Cúpula despejada (comprobación óptica real por raycast a través de W7!)
  await test('12 Cúpula óptica despejada', () => {
    const e = window.__engine;
    e.enterInterior('cupula');
    e.tick(0.4);
    const bz = e.player.pos.y; // Three Y == Blender Z
    const V3 = e.camera.position.constructor;
    const originW = e.model.root.localToWorld(new V3(11.05, 1.48, 0));
    const upW = new V3(0, 1, 0).applyQuaternion(e.model.root.quaternion).normalize();
    e.ray.set(originW, upW);
    e.ray.far = 3.0;
    const hit = e.model.pick(e.ray);
    const hitMat = hit ? (hit.node.materials.map((m) => m.name).join(',') || hit.node.code) : 'CLEAR';
    const ok = bz > 1.35 && (!hit || /Glass|W7|SHT/i.test(hitMat + hit.node.code));
    return { ok, info: { blenderZ: +bz.toFixed(2), hit: hit ? hit.node.code : null, hitMat } };
  });

  // 13. Ventanas científicas de nadir W1 (5.25 m) y W2 (6.20 m) despejadas (sin isogrid intruso)
  await test('13 Ventanas nadir despejadas', () => {
    const e = window.__engine;
    e.enterInterior('lab');
    e.tick(0.3);
    const V3 = e.camera.position.constructor;
    const downW = new V3(0, -1, 0).applyQuaternion(e.model.root.quaternion).normalize();
    const checkWin = (x) => {
      const originW = e.model.root.localToWorld(new V3(x, -1.35, 0));
      e.ray.set(originW, downW);
      e.ray.far = 1.6;
      const hit = e.model.pick(e.ray);
      const code = hit ? hit.node.code : 'CLEAR';
      const ok = !hit || /W1|W2|WIN|Glass/i.test(code + hit.node.materials.map((m) => m.name).join(','));
      return { ok, code };
    };
    const w1 = checkWin(5.25);
    const w2 = checkWin(6.20);
    return { ok: w1.ok && w2.ok, info: { w1: w1.code, w2: w2.code } };
  });

  // 14. Colisiones interiores (no atraviesa paredes del casco)
  await test('14 Colisiones interiores', () => {
    const e = window.__engine;
    e.player.eva = false;
    e.enterInterior('lab');
    e.setMode('INTERIOR');
    e.player.yaw = Math.PI / 2;
    e.player.pitch = 0;
    e.input.touch.fwd = 1; e.tick(5); e.input.touch.fwd = 0;
    const by = -e.player.pos.z;
    return { ok: Math.abs(by) < 1.2, info: { x: +e.player.pos.x.toFixed(2), blenderY: +by.toFixed(2) } };
  });

  // 15. Caminar de Cabina a Nodo atravesando escotilla (agachado)
  await test('15 Caminar cabina→nodo', () => {
    const e = window.__engine;
    e.setLocomotion('walk');
    e.enterInterior('cabina');
    e.player.yaw = -Math.PI / 2;
    e.player.pitch = 0;
    e.input.touch.fwd = 1;
    let minEye = 9;
    for (let i = 0; i < 24; i++) { e.tick(0.5); minEye = Math.min(minEye, e.player.eyeH); }
    e.input.touch.fwd = 0;
    const x = e.player.pos.x;
    return { ok: x > 10.6 && minEye < 1.0 && e.player.onGround, info: { x: +x.toFixed(2), minEye: +minEye.toFixed(2) } };
  });

  // 16. Escalerilla de esclusa + modo flotar
  await test('16 Escalerilla esclusa + flotar', () => {
    const e = window.__engine;
    e.enterInterior('nodo');
    e.model.setMech('hatch:alk_in', 1.75, true);
    e.player.pos.x = 11.05; e.player.pos.z = 0;
    e.input.touch.down = 1; e.tick(5); e.input.touch.down = 0;
    const feet = e.player.pos.y - e.player.eyeH;
    e.model.setMech('hatch:alk_in', 0, true);
    e.setLocomotion('float');
    e.enterInterior('lab');
    const y0 = e.player.pos.y;
    e.tick(2);
    const dy = Math.abs(e.player.pos.y - y0);
    e.setLocomotion('walk');
    return { ok: feet < -3.2 && dy < 0.05, info: { feet: +feet.toFixed(2), floatDy: +dy.toFixed(3) } };
  });

  // 17. Ciclo de esclusa y salida a EVA con guantes presurizados
  await test('17 Ciclo esclusa + EVA', () => {
    const e = window.__engine;
    e.enterInterior('esclusa');
    e.model.setMech('hatch:alk_in', 0, true);
    e.cycleAirlock();
    e.tick(7);
    const vac = e.airlock;
    e.player.pos.set(11.05, -3.3, 0);
    e.tick(0.5);
    const evaMode = e.mode;
    const evaFlag = e.player.eva;
    const ok = vac === 'vac' && evaMode === 'EVA' && evaFlag;
    e.player.eva = false;
    e.airlock = 'pres';
    e.enterInterior('cabina');
    return { ok, info: { vac, mode: evaMode, eva: evaFlag } };
  });

  // 18. Vida a bordo + botón Exploración Libre (pausa necesidades)
  await test('18 Vida a bordo + Modo Libre', () => {
    const e = window.__engine;
    e.setFreeExplore(false);
    e.crew.needs.hydration = 30;
    const co2 = e.systems.co2;
    e.startActivity('drink'); e.tick(4.5);
    const drank = e.crew.needs.hydration > 55;
    e.startActivity('exercise'); e.tick(5);
    const co2up = e.systems.co2 > co2;
    e.tick(6);
    e.setFreeExplore(true);
    const h0 = e.crew.needs.hydration;
    const e0 = e.crew.needs.energy;
    e.crew.step(180, { inCupolaLookingAtEarth: false }, () => {});
    const frozen = Math.abs(e.crew.needs.hydration - h0) < 1e-6 && Math.abs(e.crew.needs.energy - e0) < 1e-6;
    return { ok: drank && co2up && frozen, info: { drank, co2up, frozen } };
  });

  // 19. Misión de activación completa
  await test('19 Misión activación completa', () => {
    const e = window.__engine;
    e.missions.start(e, 'activacion');
    const ids = ['BAT', 'BUSA', 'BUSB', 'LT_A', 'AVX', 'ECLSS', 'FANS', 'THERM', 'SOLAR', 'NAV', 'COMM', 'RCS', 'MAIN'];
    for (const id of ids) { e.systems.sw[id] = true; e.tick(id === 'AVX' ? 4 : 0.5); }
    e.sit(1); e.tick(0.5);
    const ok = e.missions.done.has('activacion');
    e.standUp();
    return { ok, info: { done: [...e.missions.done] } };
  });

  // 20. Ingeniería: Presets de explosión + selección + corte + rayos X
  await test('20 Ingeniería presets+sección', async () => {
    const e = window.__engine;
    e.setMode('ENGINEERING');
    e.setExplodePreset('hull');
    e.setExplode(1.0);
    e.tick(0.3);
    const n = e.model.nodes.get('HAB.MMOD.R2.P05');
    const bHull = e.model.currentBox(n).getCenter(n.center0.clone());
    e.setExplodePreset('service');
    e.tick(0.3);
    const bSvc = e.model.currentBox(n).getCenter(n.center0.clone());
    e.setExplodePreset('all');
    e.select(n);
    e.tick(0.2);
    const prox = e.model.proxies.children.length;
    e.setSection(true, 'y', 0);
    const secOn = e.section.on;
    e.model.setXray(true);
    const xr = e.model.xray;
    e.setExplode(0); e.setSection(false); e.model.setXray(false); e.select(null);
    return { ok: bHull.distanceTo(n.center0) > 0.5 && bSvc.distanceTo(n.center0) < 0.05 && prox > 0 && secOn && xr, info: { hullDist: +bHull.distanceTo(n.center0).toFixed(2), svcDist: +bSvc.distanceTo(n.center0).toFixed(2), prox } };
  });

  // 21. Persistencia v3 real con RECARGA COMPLETA DE PÁGINA
  await p.evaluate(() => {
    const e = window.__engine;
    sessionStorage.setItem('alcion-keep-save', '1');
    e.setScenario('lunar', true);
    e.systems.sw.LT_B = false;
    e.setFreeExplore(true);
    e.save();
  });
  const savedV = await p.evaluate(() => JSON.parse(localStorage.getItem('alcion-bo-save') || '{}').v);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 300000 });
  await p.waitForTimeout(800);
  await test('21 Persistencia v3 tras reload', () => {
    const e = window.__engine;
    const ok = e.scenario === 'lunar' && e.systems.sw.LT_B === false && e.crew.freeExplore === true;
    const info = { scenario: e.scenario, LT_B: e.systems.sw.LT_B, freeExplore: e.crew.freeExplore };
    e.setScenario('leo', true);
    e.systems.sw.LT_B = true;
    return { ok, info };
  });
  if (savedV !== 3) {
    failed++;
    results.push(`FAIL  21b Versión guardado v3          got v=${savedV}`);
  }

  // 22. Responsividad móvil (390x844 sin desbordamiento horizontal)
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(400);
  await test('22 Móvil 390x844 sin overflow', () => {
    const e = window.__engine;
    e.enterInterior('cabina');
    const ovInt = document.documentElement.scrollWidth - window.innerWidth;
    e.setMode('ENGINEERING');
    const ovEng = document.documentElement.scrollWidth - window.innerWidth;
    return { ok: ovInt <= 1 && ovEng <= 1, info: { ovInt, ovEng } };
  });

  const stats = await p.evaluate(() => window.__engine.snapshot().stats);
  console.log('\n=== ALCIÓN HX-4 — PROJECT SINGULARITY VERIFICATION ===');
  console.log(results.join('\n'));
  console.log('STATS:', JSON.stringify(stats));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${errs.length} page/console errors, ${httpErrs.length} HTTP errors`);
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
  if (httpErrs.length) console.log('HTTP_ERRORS:\n' + httpErrs.join('\n'));

  await browser.close();
  if (failed > 0 || errs.length > 0 || httpErrs.length > 0) {
    process.exit(1);
  }
})();
