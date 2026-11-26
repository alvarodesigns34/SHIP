/**
 * ALCIÓN HX-4 · REBIRTH — pruebas de producto.
 *
 * Usa las rutas de entrada reales (eventos de teclado, clics en la interfaz, punteros táctiles)
 * y avanza el tiempo de simulación de forma determinista con engine.tick() porque el
 * rasterizador software (SwiftShader) de CI no alcanza tasas de fotogramas representativas.
 * Las comprobaciones gráficas analizan píxeles de capturas reales.
 *
 *   ALCION_URL=http://127.0.0.1:4173/ node tests/rebirth.cjs [out_dir]
 */
const { chromium, devices } = require(process.env.PW || 'playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.ALCION_URL || 'http://127.0.0.1:4173/';
const OUT = process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'rebirth', 'tests');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'} · ${name}${info ? ' · ' + info : ''}`); };
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function boot(ctxOpts = {}, clean = true) {
  const b = await chromium.launch({ args: ARGS });
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, ...ctxOpts });
  const p = await ctx.newPage();
  p.setDefaultTimeout(240000);
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await p.addInitScript((c) => {
    localStorage.setItem('alcion-tut-off', '1');
    if (c && !sessionStorage.getItem('booted')) { localStorage.removeItem('alcion-bo-save'); localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: 'media', dynamicRes: false })); sessionStorage.setItem('booted', '1'); }
  }, clean);
  const t0 = Date.now();
  await p.goto(URL);
  await p.waitForFunction(() => window.__engine && window.__engine.ready, null, { timeout: 300000 });
  const tReady = Date.now() - t0;
  await p.waitForFunction(() => window.__engine.interiorReady, null, { timeout: 300000 });
  const tInt = Date.now() - t0;
  return { b, ctx, p, errors, tReady, tInt };
}

const lum = async (p, file) => {
  const buf = await p.screenshot({ path: file, type: 'jpeg', quality: 85, timeout: 240000 });
  return buf.length;
};

/** Estadística de píxeles del lienzo (media, fracción negra, fracción saturada, NaN-magenta). */
const canvasStats = (p) => p.evaluate(() => {
  const e = window.__engine;
  const c = e.renderer.domElement;
  const w = 160, h = 90;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  e.renderFrame(); // asegura un fotograma completo en el búfer actual
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let sum = 0, black = 0, white = 0, mag = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l; if (l < 4) black++; if (l > 250) white++;
    if (d[i] > 200 && d[i + 1] < 40 && d[i + 2] > 200) mag++;
  }
  const n = d.length / 4;
  return { mean: sum / n, black: black / n, white: white / n, magenta: mag / n };
});

(async () => {
  // ------------------------------------------------------------------ 1. arranque y flujo principal
  let { b, p, errors, tReady, tInt } = await boot({}, true);
  // preserveDrawingBuffer está desactivado: leemos el lienzo justo tras renderFrame() en la misma tarea
  ok('Arranque: exterior listo < 20 s (SwiftShader)', tReady < 20000, `${tReady} ms`);
  ok('Arranque: interior listo < 60 s (SwiftShader)', tInt < 60000, `${tInt} ms`);
  await p.getByRole('button', { name: /Subir a bordo/ }).click();
  await p.waitForTimeout(800);
  ok('Interfaz: «Subir a bordo» lleva al modo interior', await p.evaluate(() => window.__engine.mode === 'INTERIOR'));
  await p.evaluate(() => { const e = window.__engine; e.tick(0.5); });
  const st0 = await canvasStats(p);
  ok('Gráficos: interior sin NaN (magenta) ni negro total', st0.magenta < 0.001 && st0.black < 0.6 && st0.mean > 18, JSON.stringify(st0));
  await lum(p, path.join(OUT, 'interior_inicio.jpg'));

  // ------------------------------------------------------------------ 2. teclado real: caminar hacia delante
  const pos = () => p.evaluate(() => window.__engine.player.pos.toArray());
  const p0 = await pos();
  await p.keyboard.down('KeyW');
  await p.evaluate(() => window.__engine.tick(1.0));
  await p.keyboard.up('KeyW');
  await p.evaluate(() => window.__engine.tick(0.5));
  const p1 = await pos();
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  ok('Teclado: W desplaza al tripulante (aceleración suave)', moved > 0.6 && moved < 2.2, `${moved.toFixed(2)} m en 1 s`);
  // pérdida de foco con tecla pulsada
  await p.keyboard.down('KeyS');
  await p.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  const pb0 = await pos();
  await p.evaluate(() => window.__engine.tick(1.0));
  const pb1 = await pos();
  await p.keyboard.up('KeyS');
  ok('Pérdida de foco: las teclas mantenidas se liberan', Math.hypot(pb1[0] - pb0[0], pb1[2] - pb0[2]) < 0.35, `${Math.hypot(pb1[0] - pb0[0], pb1[2] - pb0[2]).toFixed(2)} m`);

  // ------------------------------------------------------------------ 3. colisiones y penetración de cámara (recorrido aleatorio)
  const pen = await p.evaluate(() => {
    const e = window.__engine; const P = e.player;
    let worst = Infinity, outside = 0, steps = 0;
    const keys = ['fwd', 'back', 'left', 'right'];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const wp of ['cabina', 'lab', 'cq', 'servicios', 'nodo']) {
      e.enterInterior(wp);
      for (let k = 0; k < 160; k++) {
        if (k % 20 === 0) { P.yaw = rnd() * Math.PI * 2; for (const a of keys) e.input.touch[a] = 0; e.input.touch[keys[Math.floor(rnd() * 4)]] = 1; e.input.touch.boost = rnd() > 0.5 ? 1 : 0; }
        e.tick(1 / 20);
        steps++;
        const d = e.interior.voxels.nearest(P.pos, 0.5, new P.pos.constructor());
        worst = Math.min(worst, d);
        if (!e.insideInterior(P.pos)) outside++;
      }
      for (const a of keys) e.input.touch[a] = 0;
    }
    return { worst, outside, steps };
  });
  ok('Colisiones: la cámara nunca queda a < 12 cm de una superficie', pen.worst >= 0.12, `mínimo ${pen.worst.toFixed(3)} m en ${pen.steps} pasos`);
  ok('Colisiones: el tripulante nunca sale del volumen presurizado', pen.outside === 0, `${pen.outside} fuera`);
  // flotar en microgravedad también colisiona
  const fl = await p.evaluate(() => {
    const e = window.__engine; e.enterInterior('lab'); e.setLocomotion('float');
    e.player.pitch = 1.2; e.input.touch.fwd = 1; e.tick(4); e.input.touch.fwd = 0;
    const d = e.interior.voxels.nearest(e.player.pos, 0.5, new e.player.pos.constructor());
    e.setLocomotion('walk');
    return d;
  });
  ok('Microgravedad: empujarse hacia el techo no atraviesa el revestimiento', fl >= 0.12, `${fl.toFixed(3)} m`);

  // ------------------------------------------------------------------ 4. interacción real con el punto de mira
  const sw = await p.evaluate(() => {
    const e = window.__engine; e.enterInterior('cabina');
    const part = e.interior.parts.get('HAB.INT.A.TGL.BAT');
    const c = part.box.getCenter(new part.box.min.constructor());
    // colocarse junto a la consola y mirar al interruptor
    // de pie en el pasillo junto a la consola lateral, inclinado sobre ella (microgravedad: sin hundirse)
    const P = e.player; e.setLocomotion('float'); P.pos.set(c.x - 0.25, c.y + 0.62, c.z * 0.62);
    const d = c.clone().sub(P.pos).normalize();
    P.yaw = Math.atan2(-d.x, -d.z); P.pitch = Math.asin(d.y);
    e.tick(0.1);
    e.ray.setFromCamera(e.ndc(), e.camera); e.ray.far = 2.3; e.ray.layers.enableAll();
    const first = e.ray.intersectObject(e.interior.root, true).filter((h) => !h.object.userData.mergedRoom)[0];
    return { before: e.systems.sw.BAT, hover: e.hoverCtl?.ctl ?? null, first: first ? e.interior.codeOf(first.object) : null };
  });
  await p.keyboard.press('KeyG');
  await p.evaluate(() => { window.__engine.tick(0.6); window.__engine.setLocomotion('walk'); });
  const after = await p.evaluate(() => ({ bat: window.__engine.systems.sw.BAT, mech: window.__engine.interior.mech('sw:BAT').value }));
  ok('Interacción: el punto de mira detecta el interruptor BAT', sw.hover === 'sw:BAT', `${sw.hover} (primer impacto ${sw.first})`);
  ok('Interacción: G conmuta el interruptor y la palanca se mueve', after.bat !== sw.before && Math.abs(after.mech) > 0.4, JSON.stringify(after));
  // sentarse y levantarse
  const seat = await p.evaluate(() => {
    const e = window.__engine; e.enterInterior('cabina');
    const st = e.interior.parts.get('HAB.INT.A.ST1');
    const c = st.box.getCenter(new st.box.min.constructor());
    const P = e.player; P.pos.set(c.x - 0.75, c.y + 0.9, c.z); P.settle();
    const d = c.clone().sub(P.pos).normalize(); P.yaw = Math.atan2(-d.x, -d.z); P.pitch = Math.asin(d.y); e.tick(0.1);
    return e.hoverCtl?.ctl ?? null;
  });
  await p.keyboard.press('KeyG');
  await p.evaluate(() => window.__engine.tick(0.1));
  const seated = await p.evaluate(() => window.__engine.seated);
  await p.evaluate(() => window.__engine.tick(0.3));
  await lum(p, path.join(OUT, 'sentado.jpg'));
  await p.keyboard.press('KeyY');
  await p.evaluate(() => window.__engine.tick(0.3));
  const stood = await p.evaluate(() => ({ seated: window.__engine.seated, mode: window.__engine.mode, room: window.__engine.interior.roomAt(window.__engine.player.pos) }));
  ok('Asiento: apuntar al asiento y G sienta al tripulante', seat === 'seat:1' && seated, `${seat} → ${seated}`);
  ok('Asiento: Y levanta junto al asiento (sin teletransporte a otra estancia)', !stood.seated && stood.mode === 'INTERIOR' && stood.room === 'A', JSON.stringify(stood));

  // ------------------------------------------------------------------ 5. contaminación entre modos (rayos X, corte, explosión)
  const cont = await p.evaluate(() => {
    const e = window.__engine;
    const out = [];
    for (let k = 0; k < 4; k++) {
      e.setMode('ENGINEERING'); e.model.setXray(true); e.setSection(true, 'y', 0.2); e.setExplode(1);
      e.tick(0.1);
      e.enterInterior('lab'); e.tick(0.1);
      const clipped = e.interior.materials.some((m) => (m.clippingPlanes?.length ?? 0) > 0);
      const inner = e.model.profile;
      out.push({ x: e.model.xray, s: e.section.on, ex: e.model.explode, clipped, inner, sideDouble: e.interior.materials.filter((m) => m.name === 'R_Lining' && m.side === 2).length });
      e.setMode('CINEMATIC'); e.tick(0.1);
    }
    return out;
  });
  ok('Modos: el interior nunca hereda rayos X, corte ni explosión de ingeniería', cont.every((c) => !c.x && !c.s && c.ex === 0 && !c.clipped && c.inner === 'immersive' && c.sideDouble === 0), JSON.stringify(cont[3]));
  const st1 = await canvasStats(p);
  ok('Gráficos: tras 4 ciclos ingeniería↔interior la imagen sigue siendo válida', st1.magenta < 0.001 && st1.mean > 8, JSON.stringify(st1));

  // ------------------------------------------------------------------ 6. rendimiento estructural
  const perf = await p.evaluate(() => {
    const e = window.__engine; e.enterInterior('cq'); e.player.yaw = Math.PI / 2; e.player.pitch = 0; e.tick(0.5);
    const frames = []; for (let i = 0; i < 3; i++) { e.renderFrame(); frames.push({ calls: e.pipeline.frameInfo.calls, tris: e.pipeline.frameInfo.triangles }); }
    e.tick(0.2);
    const mwStatic = e.model.lastMatrixWrites;
    e.setMode('CINEMATIC'); e.tick(0.3); e.renderFrame();
    const ext = { calls: e.pipeline.frameInfo.calls, tris: e.pipeline.frameInfo.triangles };
    return { int: frames[2], mwStatic, ext };
  });
  ok('Rendimiento: habitáculos mirando a popa (sin ventanas en vista) ≤ 120 llamadas', perf.int.calls <= 120, JSON.stringify(perf.int));
  ok('Rendimiento: sin mecanismos en movimiento no se reescriben matrices de toda la nave', perf.mwStatic < 200, `${perf.mwStatic} escrituras`);
  ok('Rendimiento: exterior completo ≤ 260 llamadas incluidas sombras', perf.ext.calls <= 260, JSON.stringify(perf.ext));

  // ------------------------------------------------------------------ 6b. EVA por la esclusa
  const eva = await p.evaluate(() => {
    const e = window.__engine; const r = {};
    e.enterInterior('nodo');
    const hin = e.interior.mech('hatch:alk_in'); if (hin) { hin.target = hin.rest; hin.value = hin.rest; }
    e.cycleAirlock(); e.tick(7);
    r.vac = e.airlock;
    e.player.pos.set(11.05, -3.16 + 1.66, 0); e.player.vel.set(0, 0, 0); e.tick(0.2);
    r.modeOut = e.mode; r.eva = e.player.eva;
    e.evaBody.pos.set(11.05, -5.0, 0); e.tick(0.1); e.evaBody.pos.set(11.05, -3.55, 0); e.evaBody.vel.set(0, 0, 0); e.tick(0.1);
    r.modeIn = e.mode;
    e.cycleAirlock(); e.tick(7); r.pres = e.airlock;
    return r;
  });
  ok('EVA: ciclo de esclusa → salida al exterior → regreso → represurización', eva.vac === 'vac' && eva.modeOut === 'EVA' && eva.modeIn === 'INTERIOR' && eva.pres === 'pres', JSON.stringify(eva));

  // ------------------------------------------------------------------ 7. persistencia
  await p.evaluate(() => { const e = window.__engine; e.enterInterior('lab'); e.systems.toggle('BAT'); e.save(); });
  const saved = await p.evaluate(() => ({ pos: window.__engine.player.pos.toArray().map((v) => +v.toFixed(2)), bat: window.__engine.systems.sw.BAT }));
  await p.reload();
  await p.waitForFunction(() => window.__engine && window.__engine.interiorReady && window.__engine.ready, null, { timeout: 300000 });
  await p.waitForTimeout(500);
  const rest = await p.evaluate(() => ({ mode: window.__engine.mode, pos: window.__engine.player.pos.toArray().map((v) => +v.toFixed(2)), bat: window.__engine.systems.sw.BAT }));
  ok('Persistencia: modo, posición y sistemas se restauran tras recargar', rest.mode === 'INTERIOR' && rest.bat === saved.bat && Math.hypot(rest.pos[0] - saved.pos[0], rest.pos[2] - saved.pos[2]) < 0.2, JSON.stringify({ saved, rest }));
  ok('Consola: sin errores durante la sesión de escritorio', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();

  // ------------------------------------------------------------------ 8. móvil táctil (vertical)
  ({ b, p, errors } = await boot({ ...devices['Pixel 7'] }, true));
  await p.getByRole('button', { name: /Subir a bordo/ }).tap();
  await p.waitForTimeout(600);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('Móvil: sin desbordamiento horizontal', !overflow);
  const stick = p.locator('.stick');
  ok('Móvil: palanca táctil visible en el interior', await stick.isVisible());
  const box = await stick.boundingBox();
  const m0 = await pos();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.evaluate(({ cx, cy }) => {
    const el = document.querySelector('.stick');
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ev('pointerdown', cx, cy); ev('pointermove', cx, cy - 40);
  }, { cx, cy });
  await p.evaluate(() => window.__engine.tick(1.0));
  const m1 = await pos();
  await p.evaluate(({ cx, cy }) => { document.querySelector('.stick').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9, pointerType: 'touch', clientX: cx, clientY: cy - 40, bubbles: true })); }, { cx, cy });
  await p.evaluate(() => window.__engine.tick(1.2));
  const m2 = await pos();
  await p.evaluate(() => window.__engine.tick(1.0));
  const m3 = await pos();
  ok('Móvil: la palanca desplaza al tripulante', Math.hypot(m1[0] - m0[0], m1[2] - m0[2]) > 0.4, `${Math.hypot(m1[0] - m0[0], m1[2] - m0[2]).toFixed(2)} m`);
  ok('Móvil: pointercancel libera el control (sin deriva)', Math.hypot(m3[0] - m2[0], m3[2] - m2[2]) < 0.02, `${Math.hypot(m3[0] - m2[0], m3[2] - m2[2]).toFixed(3)} m`);
  await lum(p, path.join(OUT, 'movil_interior.jpg'));
  await p.evaluate(() => window.__engine.setMode('CINEMATIC'));
  await p.waitForTimeout(800);
  await lum(p, path.join(OUT, 'movil_portada.jpg'));
  ok('Consola: sin errores en móvil', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();

  const pass = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), pass, total: results.length, results }, null, 1));
  console.log(`\n${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
