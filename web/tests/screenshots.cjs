const { chromium } = require('playwright');
const out = process.argv[2] || 'bo';
const only = process.argv[3] || 'all';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  const logs = [];
  p.on('pageerror', e => logs.push('PAGEERROR ' + e.message + ' ' + (e.stack||'').split('\n').slice(1,3).join(' | ')));
  p.on('console', m => { if (m.type() === 'error') logs.push('ERR ' + m.text().slice(0, 300)); });
  await p.addInitScript(() => { localStorage.setItem('alcion-tut-off', '1'); localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'alta', dynamicRes: false })); localStorage.removeItem('alcion-bo-save'); });
  await p.goto(process.env.ALCION_URL || 'http://localhost:4173/');
  await p.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 300000 });
  await p.waitForTimeout(3000);
  const shot = async (name, fn, wait = 2500) => {
    if (only !== 'all' && !only.split(',').includes(name)) return;
    try { await p.evaluate(fn); } catch (e) { logs.push('EVAL ' + name + ' ' + e.message); }
    await p.waitForTimeout(wait);
    await p.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  };
  await shot('flight_chase', () => { const e = window.__engine; e.setMode('FLIGHT'); });
  await shot('cockpit', () => { const e = window.__engine; e.sit(1); });
  await shot('interior_cabin', () => { const e = window.__engine; e.standUp(); e.enterInterior('cabina'); });
  await shot('interior_lab', () => { const e = window.__engine; e.enterInterior('lab'); });
  await shot('interior_cq', () => { const e = window.__engine; e.enterInterior('cq'); });
  await shot('cupola', () => { const e = window.__engine; e.enterInterior('cupula'); });
  await shot('airlock', () => { const e = window.__engine; e.enterInterior('esclusa'); });
  await shot('eng_explode', () => { const e = window.__engine; e.setMode('ENGINEERING'); e.setExplode(1); }, 4000);
  await shot('eng_section', () => { const e = window.__engine; e.setExplode(0); e.setSection(true, 'y', 0); e.flyOrbit(new (e.camera.position.constructor)(4, 2, 18), new (e.camera.position.constructor)(4, 0, 0), 10); }, 3500);
  await shot('eva', () => { const e = window.__engine; e.setSection(false); e.setMode('FLIGHT'); e.enterInterior('esclusa'); e.model.setMech('hatch:alk_in', 0, true); e.cycleAirlock(); e.tick(7); e.player.pos.set(11.05, -3.3, 0); e.tick(0.3); e.player.pos.set(9.0, -3.2, -1.2); e.player.yaw = -2.2; e.player.pitch = 0.35; e.tick(0.1); }, 3500);
  await shot('cinematic2', () => { const e = window.__engine; e.player.eva = false; e.airlock='pres'; e.setMode('CINEMATIC'); e.cine.shot = 1; e.cine.t = 5; }, 3500);
  await shot('missions', () => { const e = window.__engine; e.setSection(false); e.setMode('MISSIONS'); });
  logs.push('stats ' + await p.evaluate(() => JSON.stringify(window.__engine.snapshot().stats)));
  console.log(logs.slice(0, 30).join('\n'));
  await b.close();
})();
