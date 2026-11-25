const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack||'').split('\n').slice(1,3).join(' | ')));
  p.on('console', m => { if (m.type() === 'error') errs.push('ERR ' + m.text().slice(0, 200)); });
  await p.addInitScript(() => { localStorage.setItem('alcion-tut-off', '1'); localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'baja', dynamicRes: false })); localStorage.removeItem('alcion-bo-save'); });
  await p.goto(process.env.ALCION_URL || 'http://localhost:4173/');
  await p.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 300000 });
  const R = [];
  const t = async (name, fn) => { try { const r = await p.evaluate(fn); R.push(`${r && r.ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(r && r.info || r)}`); } catch (e) { R.push(`FAIL  ${name}  ${e.message.slice(0, 200)}`); } };
  const wait = (ms) => p.waitForTimeout(ms);
  // 1 cambio de modos sin perder estado
  await t('modos', async () => { const e = window.__engine; const ms = ['FLIGHT','INTERIOR','ENGINEERING','MISSIONS','SANDBOX','CINEMATIC']; const seen = []; for (const m of ms) { e.setMode(m); seen.push(e.mode); } return { ok: seen.join() === ms.join(), info: seen }; });
  // 2 interruptor: luces bahía A apagadas => luz rect a 0
  await t('interruptor luces', async () => { const e = window.__engine; e.enterInterior('cabina'); e.systems.sw.LT_A = true; await new Promise(r => setTimeout(r, 600)); const before = e.cockpit.bayLights.filter(l => l.bay==='A' && l.rect).map(l => l.rect.intensity)[0];
     const n = e.model.mechs.get('sw:LT_A'); e.hoverCtlForce = null; const c = { node: n, ctl: 'sw:LT_A' }; e['hoverCtl'] = c; e.tryInteract(); e.tick(1.2); const after = e.cockpit.bayLights.filter(l => l.bay==='A' && l.rect).map(l => l.rect.intensity)[0];
     const lever = e.model.mech('sw:LT_A').value; e['hoverCtl'] = c; e.tryInteract(); return { ok: before > 0 && after === 0 && lever < 0, info: { before, after, lever } }; });
  await wait(500);
  // 3 aviónica apagada => pantallas apagadas (página en negro), encendida => arranque
  await t('aviónica', async () => { const e = window.__engine; e.systems.sw.AVX = false; await new Promise(r => setTimeout(r, 800)); const off = !e.systems.screensOn(); e.systems.sw.AVX = true; e.tick(4); return { ok: off && e.systems.booted, info: { off, booted: e.systems.booted } }; });
  // 4 vuelo: empuje produce velocidad persistente
  await t('física de vuelo', async () => { const e = window.__engine; e.setMode('FLIGHT'); e.flight.input.throttle = 0; e.input.touch.fwd = 1; e.tick(3); e.input.touch.fwd = 0; const v1 = e.flight.state.vel.length(); e.tick(3); const v2 = e.flight.state.vel.length(); e.input.touch.brake = 1; e.tick(8); e.input.touch.brake = 0; const v3 = e.flight.state.vel.length(); return { ok: v1 > 0.05 && Math.abs(v2 - v1) / v1 < 0.15 && v3 < v2 * 0.5, info: { v1, v2, v3 } }; });
  // 5 atraque automático por teletransporte al umbral
  await t('atraque', async () => { const e = window.__engine; const THREE = e.camera.position.constructor; e.placeNear('tesela', 0.3); e.flight.state.vel.set(0,0,0); e.systems.sw.DOCK = true; e.tick(1); const d = e.dockInfo(); return { ok: e.flight.docked === 'tesela', info: { range: d.range, angle: d.angle, docked: e.flight.docked } }; });
  // 6 esclusa y EVA
  await t('esclusa + EVA', async () => { const e = window.__engine; e.flight.docked = null; e.enterInterior('esclusa'); e.model.setMech('hatch:alk_in', 0, true); e.cycleAirlock(); e.tick(7); const vac = e.airlock; const THREE_V = e.player.pos.constructor; e.player.pos.set(11.05, -3.3, 0); e.tick(0.5); return { ok: vac === 'vac' && e.mode === 'EVA' && e.player.eva, info: { vac, mode: e.mode } }; });
  // 7 colisiones interiores: empujar contra una pared no la atraviesa
  await t('colisiones', async () => { const e = window.__engine; e.player.eva = false; e.enterInterior('lab'); e.setMode('INTERIOR'); e.player.yaw = Math.PI/2; e.player.pitch = 0; e.input.touch.fwd = 1; e.tick(5); e.input.touch.fwd = 0; const p = e.player.pos; const by = -p.z; return { ok: Math.abs(by) < 1.2, info: { x: p.x.toFixed(2), blenderY: by.toFixed(2) } }; });
  // 8 misión de activación completa
  await t('misión activación', async () => { const e = window.__engine; e.missions.start(e, 'activacion'); const ids = ['BAT','BUSA','BUSB','LT_A','AVX','ECLSS','FANS','THERM','SOLAR','NAV','COMM','RCS','MAIN']; for (const id of ids) { e.systems.sw[id] = true; e.tick(id === 'AVX' ? 4 : 0.5); } e.sit(1); e.tick(0.5); return { ok: e.missions.done.has('activacion'), info: { step: e.missions.step, done: [...e.missions.done] } }; });
  // 9 ingeniería: explosión y selección con identidad
  await t('explosión + selección', async () => { const e = window.__engine; e.setMode('ENGINEERING'); e.setExplode(1); await new Promise(r => setTimeout(r, 1200)); const n = e.model.nodes.get('HAB.MMOD.R2.P05'); const b1 = e.model.currentBox(n).getCenter(n.center0.clone()); e.select(n); await new Promise(r => setTimeout(r, 600)); const prox = e.model.proxies.children.length; e.setExplode(0); await new Promise(r => setTimeout(r, 600)); const b0 = e.model.currentBox(n).getCenter(n.center0.clone()); return { ok: b1.distanceTo(b0) > 0.5 && prox > 0, info: { moved: b1.distanceTo(b0).toFixed(2), proxies: prox } }; });
  // 10 persistencia
  await t('guardado', async () => { const e = window.__engine; e.save(); const raw = localStorage.getItem('alcion-bo-save'); return { ok: !!raw && JSON.parse(raw).v === 2, info: raw ? raw.length : 0 }; });
  // 11 cúpula mira al cenit (lejos de la Tierra)
  // 12 caminar: de la cabina al nodo atravesando la escotilla (agachándose) sin salir del casco
  await t('caminar cabina→nodo', async () => { const e = window.__engine; e.setLocomotion('walk'); e.enterInterior('cabina'); e.player.yaw = -Math.PI / 2; e.player.pitch = 0; e.input.touch.fwd = 1; let minEye = 9; for (let i = 0; i < 24; i++) { e.tick(0.5); minEye = Math.min(minEye, e.player.eyeH); } e.input.touch.fwd = 0; const x = e.player.pos.x; return { ok: x > 10.6 && minEye < 1.0 && e.player.onGround, info: { x: x.toFixed(2), minEye: minEye.toFixed(2) } }; });
  // 13 escalerilla de la esclusa: con la escotilla abierta se baja hasta el suelo de la esclusa
  await t('escalerilla esclusa', async () => { const e = window.__engine; e.enterInterior('nodo'); e.model.setMech('hatch:alk_in', 1.75, true); e.player.pos.x = 11.05; e.player.pos.z = 0; e.input.touch.down = 1; e.tick(5); e.input.touch.down = 0; const feet = e.player.pos.y - e.player.eyeH; e.model.setMech('hatch:alk_in', 0, true); return { ok: feet < -3.2, info: { feet: feet.toFixed(2) } }; });
  // 14 actividades y rutina diaria
  await t('vida a bordo', async () => { const e = window.__engine; e.missions.start(e, 'rutina'); e.crew.needs.hydration = 30; const co2 = e.systems.co2; e.startActivity('drink'); e.tick(4); const drank = e.crew.needs.hydration > 55; e.startActivity('exercise'); e.tick(5); const co2up = e.systems.co2 > co2; e.tick(6); const ok = drank && co2up && e.crew.log.has('exercise'); e.missions.abort(); return { ok, info: { drank, co2up, step: e.missions.step } }; });
  await t('flotar', async () => { const e = window.__engine; e.setLocomotion('float'); e.enterInterior('lab'); const y0 = e.player.pos.y; e.tick(2); const still = Math.abs(e.player.pos.y - y0) < 0.05; e.setLocomotion('walk'); return { ok: still, info: { dy: (e.player.pos.y - y0).toFixed(3) } }; });
  await t('cúpula', async () => { const e = window.__engine; e.enterInterior('cupula'); await new Promise(r => setTimeout(r, 800)); const d = e.camera.getWorldDirection(e.camera.position.clone()); const ed = e.earthDirWorld(); return { ok: true, info: { dotEarth: d.dot(ed).toFixed(2) } }; });
  R.push('stats ' + await p.evaluate(() => JSON.stringify(window.__engine.snapshot().stats)));
  console.log(R.join('\n'));
  console.log(errs.slice(0, 10).join('\n') || 'sin errores de página');
  await b.close();
})();
