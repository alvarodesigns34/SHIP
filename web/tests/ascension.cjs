/**
 * ALCIÓN HX-4 · ASCENSION — suite ampliada de producto, estabilidad y robustez.
 *
 * Verifica sobre la aplicación compilada real (sin relajar umbrales):
 *  1. Sesión larga determinista de 10 minutos simulados (600 s) con memoria WebGL,
 *     draw calls y reloj maestro estables.
 *  2. Los 7 modos completos (CINEMATIC, FLIGHT, INTERIOR, EVA, ENGINEERING, MISSIONS, SANDBOX)
 *     con verificación de píxeles y retorno limpio a INTERIOR.
 *  3. Los 4 perfiles gráficos (baja, media, alta, ultra) y configuración del pipeline.
 *  4. Árbol de ingeniería interior (HAB.INT.IMM, 5 estancias, ≥ 100 piezas), selección,
 *     explosión interior sin residuo y etiquetas 3D sin solapamientos 2D.
 *  5. Móvil táctil vertical (390×844) y horizontal (844×390) sin desbordamiento ni errores.
 *  6. Recuperación completa tras pérdida de contexto WebGL (WEBGL_lose_context).
 *
 * Sale con código 0 si todas las pruebas pasan con 0 errores de consola/página/HTTP,
 * y con código 1 en caso contrario.
 *
 * Uso:
 *   ALCION_URL=http://127.0.0.1:4178/ node web/tests/ascension.cjs [resumen.json | dir_salida]
 */
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.ALCION_URL || 'http://127.0.0.1:4178/';
const OUT_ARG = process.argv[2] || '';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const CONTEXT_LOST_CONSOLE_RE = /WebGL:\s*CONTEXT_LOST_WEBGL|CONTEXT_LOST_WEBGL|WebGL context was lost/i;

const results = [];
const metrics = {};
const tSuiteStart = Date.now();

function ok(name, pass, info = '') {
  const passed = !!pass;
  const elapsed = ((Date.now() - tSuiteStart) / 1000).toFixed(1);
  results.push({ name, pass: passed, info, elapsedSec: +elapsed });
  console.log(`${passed ? 'PASS' : 'FAIL'} [${elapsed}s] · ${name}${info ? ' · ' + info : ''}`);
}

function attachListeners(page, state) {
  page.on('pageerror', (e) => {
    state.pageErrors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text().slice(0, 260);
    if (state.allowContextLostLog && CONTEXT_LOST_CONSOLE_RE.test(text)) {
      state.ignoredContextLostLogs.push(text);
      return;
    }
    state.consoleErrors.push(`console: ${text}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
      state.httpErrors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
}

async function openSession(browser, ctxOpts = {}, quality = 'baja') {
  const ctx = await browser.newContext({ viewport: { width: 576, height: 324 }, ...ctxOpts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const state = {
    pageErrors: [],
    consoleErrors: [],
    httpErrors: [],
    allowContextLostLog: false,
    ignoredContextLostLogs: [],
  };
  attachListeners(page, state);
  await page.addInitScript((q) => {
    localStorage.setItem('alcion-tut-off', '1');
    if (!sessionStorage.getItem('ascension-booted')) {
      localStorage.removeItem('alcion-bo-save');
      localStorage.setItem('alcion-bo-settings', JSON.stringify({ quality: q, dynamicRes: false }));
      sessionStorage.setItem('ascension-booted', '1');
    }
  }, quality);
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine && window.__engine.ready && window.__engine.interiorReady, null, { timeout: 180000 });
  const tBootMs = Date.now() - t0;
  return { ctx, page, state, tBootMs };
}

/**
 * Helper serializado dentro de page.evaluate para medir píxeles del lienzo WebGL
 * inmediatamente tras e.renderFrame() en la misma tarea (sin renders redundantes de rAF).
 */
const PIXEL_HELPER_SRC = `
  const measureCanvas = (e) => {
    const c = e.renderer.domElement;
    const w = 160, h = 90;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    e.renderFrame();
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0, black = 0, white = 0, mag = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      if (l < 4) black++;
      if (l > 250) white++;
      if (d[i] > 200 && d[i + 1] < 40 && d[i + 2] > 200) mag++;
    }
    const n = d.length / 4;
    return {
      mean: +(sum / n).toFixed(2),
      black: +(black / n).toFixed(4),
      white: +(white / n).toFixed(4),
      magenta: +(mag / n).toFixed(4),
    };
  };
`;

(async () => {
  let browser = null;

  try {
    browser = await chromium.launch({ args: ARGS });

    // =========================================================================
    // 1. SESIÓN LARGA DE 10 MINUTOS SIMULADOS (600 s) Y MEMORIA ESTABLE
    // =========================================================================
    const desk = await openSession(browser, { viewport: { width: 576, height: 324 } }, 'baja');
    const { page: p, state: deskState } = desk;
    metrics.desktopBootMs = desk.tBootMs;

    const longSession = await p.evaluate((helperSrc) => {
      const e = window.__engine;
      const measureCanvas = new Function('e', `${helperSrc}; return measureCanvas(e);`);

      // Encender sistemas principales de cabina y entrar en INTERIOR
      const swIds = ['BAT', 'BUSA', 'BUSB', 'AVX', 'LT_A', 'LT_B', 'LT_C', 'LT_D', 'LT_N', 'ECLSS', 'FANS', 'THERM', 'SOLAR', 'NAV', 'COMM', 'RCS', 'MAIN'];
      for (const id of swIds) {
        if (!e.systems.sw[id]) {
          e.systems.toggle(id);
          e.interior.setMech('sw:' + id, 0.45, true);
        }
      }
      e.enterInterior('cabina');
      e.setLocomotion('walk');

      // Vista interior cerrada de referencia (habitáculos mirando a popa).
      // Dos renders consecutivos estabilizan shadowMap.needsUpdate para comparar llamadas reales.
      const sampleRefView = () => {
        e.enterInterior('cq');
        e.player.yaw = Math.PI / 2;
        e.player.pitch = 0;
        e.tick(0.1);
        e.camFrame = 1;
        e.renderFrame();
        e.camFrame = 1;
        e.renderFrame();
        const mem = e.renderer.info.memory;
        return {
          geometries: mem.geometries,
          textures: mem.textures,
          programs: e.renderer.info.programs ? e.renderer.info.programs.length : 0,
          calls: e.pipeline.frameInfo.calls,
          tris: e.pipeline.frameInfo.triangles,
          heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2) : null,
          metSeconds: e.crew.metSeconds,
        };
      };

      const metStart = e.crew.metSeconds;
      // Primer minuto simulado (60 s)
      e.tick(60);
      const min1 = sampleRefView();

      const checkpoints = [];
      const waypoints = ['cabina', 'lab', 'cq', 'servicios', 'nodo'];

      // 9 minutos adicionales (540 s, total 600 s = 10 minutos simulados)
      for (let m = 2; m <= 10; m++) {
        if (m === 6) {
          // Tramo de vuelo orbital de 60 s
          e.setMode('FLIGHT');
          e.flight.input.throttle = 0;
          e.input.touch.fwd = 1;
          e.tick(10);
          e.input.touch.fwd = 0;
          e.tick(35);
          e.input.touch.brake = 1;
          e.tick(15);
          e.input.touch.brake = 0;
          e.renderFrame();
          e.enterInterior('cabina');
        } else {
          const wp = waypoints[(m - 2) % waypoints.length];
          e.enterInterior(wp);
          e.input.touch.fwd = 1;
          e.tick(4);
          e.input.touch.fwd = 0;
          if (m % 2 === 0) {
            e.systems.toggle('LT_B');
            e.tick(1);
            e.systems.toggle('LT_B');
          }
          if (m === 4) {
            e.crew.needs.hydration = 40;
            e.startActivity('drink');
            e.tick(6);
            e.tick(49);
          } else if (m === 8) {
            e.crew.needs.energy = 80;
            e.startActivity('exercise');
            e.tick(8);
            e.tick(47);
          } else {
            e.tick(m % 2 === 0 ? 55 : 56);
          }
        }
        const mem = e.renderer.info.memory;
        checkpoints.push({
          min: m,
          geo: mem.geometries,
          tex: mem.textures,
          progs: e.renderer.info.programs ? e.renderer.info.programs.length : 0,
        });
      }

      for (const id of ['LT_A', 'LT_B', 'LT_C', 'LT_D', 'LT_N']) {
        if (!e.systems.sw[id]) e.systems.toggle(id);
      }
      const min10 = sampleRefView();
      e.enterInterior('cabina');
      e.tick(0.1);
      const st10m = measureCanvas(e);
      return { metStart, min1, min10, st10m, checkpoints };
    }, PIXEL_HELPER_SRC);

    const { st10m } = longSession;
    const dGeo = Math.abs(longSession.min10.geometries - longSession.min1.geometries);
    const dTex = Math.abs(longSession.min10.textures - longSession.min1.textures);
    const dProgs = Math.abs(longSession.min10.programs - longSession.min1.programs);
    const dCalls = Math.abs(longSession.min10.calls - longSession.min1.calls);
    const dMet = longSession.min10.metSeconds - longSession.min1.metSeconds;

    const isMonotonicGrow = (arr) => {
      let ups = 0;
      for (let i = 1; i < arr.length; i++) if (arr[i] > arr[i - 1]) ups++;
      return ups >= 5 && arr[arr.length - 1] - arr[0] > 3;
    };
    const monoLeak =
      isMonotonicGrow(longSession.checkpoints.map((c) => c.geo)) ||
      isMonotonicGrow(longSession.checkpoints.map((c) => c.tex)) ||
      isMonotonicGrow(longSession.checkpoints.map((c) => c.progs));

    metrics.longSession = { min1: longSession.min1, min10: longSession.min10, st10m, dGeo, dTex, dProgs, dCalls, dMet };

    ok(
      '1a. Sesión 10 min (600 s): memoria WebGL estable (Δ ≤ 3, sin fugas)',
      dGeo <= 3 && dTex <= 3 && dProgs <= 3 && !monoLeak,
      `geo ${longSession.min1.geometries}→${longSession.min10.geometries}, tex ${longSession.min1.textures}→${longSession.min10.textures}, progs ${longSession.min1.programs}→${longSession.min10.programs}${longSession.min10.heapMB !== null ? `, heap ${longSession.min1.heapMB}→${longSession.min10.heapMB} MB` : ''}`,
    );
    ok(
      '1b. Sesión 10 min (600 s): draw calls estables en la misma vista',
      dCalls <= 4 && longSession.min10.calls > 0,
      `calls ${longSession.min1.calls}→${longSession.min10.calls} (Δ=${dCalls}), tris ${longSession.min1.tris}→${longSession.min10.tris}`,
    );
    ok(
      '1c. Sesión 10 min (600 s): reloj maestro avanzó coherentemente (≥ 500 s)',
      Number.isFinite(dMet) && dMet >= 500,
      `ΔmetSeconds=${Math.round(dMet)} s (total desde inicio: ${Math.round(longSession.min10.metSeconds - longSession.metStart)} s)`,
    );
    ok(
      '1d. Sesión 10 min (600 s): lienzo válido tras 10 minutos',
      st10m.magenta < 0.001 && st10m.mean > 15 && st10m.black < 0.85,
      JSON.stringify(st10m),
    );

    // =========================================================================
    // 2. LOS 7 MODOS COMPLETOS CON VERIFICACIÓN DE PÍXELES
    // =========================================================================
    const modesResult = await p.evaluate((helperSrc) => {
      const e = window.__engine;
      const measureCanvas = new Function('e', `${helperSrc}; return measureCanvas(e);`);
      const modes = ['CINEMATIC', 'FLIGHT', 'INTERIOR', 'EVA', 'ENGINEERING', 'MISSIONS', 'SANDBOX'];
      const out = {};

      for (const m of modes) {
        if (m === 'EVA') {
          e.enterInterior('nodo');
          const hin = e.interior.mech('hatch:alk_in');
          if (hin) { hin.target = hin.rest; hin.value = hin.rest; }
          e.airlock = 'pres';
          e.cycleAirlock();
          e.tick(7);
          e.player.pos.set(11.05, -3.16 + 1.66, 0);
          e.player.vel.set(0, 0, 0);
          e.tick(0.3);
          e.evaBody.pos.set(10.0, -4.4, 2.2);
          e.evaBody.vel.set(0, 0, 0);
          e.evaBody.yaw = -0.35;
          e.evaBody.pitch = 0.55;
          e.tick(0.2);
        } else {
          if (e.mode === 'EVA') {
            e.player.eva = false;
            e.airlock = 'pres';
          }
          if (m === 'INTERIOR') e.enterInterior('cabina');
          else e.setMode(m);
          e.tick(0.3);
        }
        out[m] = { mode: e.mode, ...measureCanvas(e) };
      }

      e.player.eva = false;
      e.airlock = 'pres';
      e.enterInterior('cabina');
      e.tick(0.2);
      const back = {
        mode: e.mode,
        xray: e.model.xray,
        section: e.section.on,
        explode: e.model.explode,
        intExplode: e.interior.explodeValue,
        clipped: e.interior.materials.some((mat) => (mat.clippingPlanes?.length ?? 0) > 0),
        profile: e.model.profile,
        st: measureCanvas(e),
      };
      return { out, back };
    }, PIXEL_HELPER_SRC);

    for (const m of ['CINEMATIC', 'FLIGHT', 'INTERIOR', 'EVA', 'ENGINEERING', 'MISSIONS', 'SANDBOX']) {
      const r = modesResult.out[m];
      ok(`2. Modo ${m}: activo y píxeles válidos`, r.mode === m && r.magenta < 0.001 && r.mean > 5, JSON.stringify(r));
    }
    const bi = modesResult.back;
    metrics.modes = modesResult.out;
    ok(
      '2h. Retorno a INTERIOR tras los 7 modos: limpio y píxeles válidos',
      bi.mode === 'INTERIOR' &&
        !bi.xray &&
        !bi.section &&
        bi.explode === 0 &&
        bi.intExplode === 0 &&
        !bi.clipped &&
        bi.profile === 'immersive' &&
        bi.st.magenta < 0.001 &&
        bi.st.mean > 15,
      `${JSON.stringify({ mode: bi.mode, xray: bi.xray, section: bi.section, explode: bi.explode, intExplode: bi.intExplode, clipped: bi.clipped, profile: bi.profile })} ${JSON.stringify(bi.st)}`,
    );

    // =========================================================================
    // 3. LOS 4 PERFILES GRÁFICOS (baja, media, alta, ultra)
    // 4. INGENIERÍA INTERIOR, EXPLOSIÓN SIN RESIDUO Y ETIQUETAS 3D SIN SOLAPE
    //    + INICIO DE 6 (WEBGL_lose_context) SIN RENDERS INTERMEDIOS DE rAF
    // =========================================================================
    const pageErrBeforeLoss = deskState.pageErrors.length;
    deskState.allowContextLostLog = true;

    const profEngLose = await p.evaluate((helperSrc) => {
      const e = window.__engine;
      const measureCanvas = new Function('e', `${helperSrc}; return measureCanvas(e);`);

      // --- Bloque 3: 4 perfiles gráficos en INTERIOR (cabina) ---
      e.enterInterior('cabina');
      const profRes = {};
      for (const q of ['baja', 'media', 'alta', 'ultra']) {
        const t0 = performance.now();
        if (typeof e.setQuality === 'function') e.setQuality(q);
        else e.applyQuality(q);
        e.tick(0.1);
        const st = measureCanvas(e);
        profRes[q] = {
          quality: e.quality,
          bloom: e.pipeline.opts.bloom,
          ao: e.pipeline.opts.ao,
          msaa: e.pipeline.opts.msaa,
          autoExposure: e.pipeline.opts.autoExposure,
          ms: Math.round(performance.now() - t0),
          ...st,
        };
      }
      // Volver a 'baja' para el resto de la suite
      if (typeof e.setQuality === 'function') e.setQuality('baja');
      else e.applyQuality('baja');
      e.tick(0.1);

      // --- Bloque 4: Ingeniería interior, explosión sin residuo y etiquetas 3D ---
      const tree = e.engineeringTree();
      const findNode = (node, code) => {
        if (!node) return null;
        if (node.code === code) return node;
        for (const ch of node.children || []) {
          const hit = findNode(ch, code);
          if (hit) return hit;
        }
        return null;
      };
      const imm = findNode(tree, 'HAB.INT.IMM');
      const roomCodes = imm ? imm.children.map((c) => c.code) : [];
      const totalParts = imm ? imm.children.reduce((acc, r) => acc + (r.children ? r.children.length : 0), 0) : 0;

      e.setMode('ENGINEERING');
      e.setExplode(0, false, 'all');
      e.tick(0.1);
      const V = e.camera.position.constructor;
      const box0 = e.interior.localBox('HAB.INT.B.GBX');
      const c0 = box0 ? box0.getCenter(new V()) : null;

      const selected = e.selectCode('HAB.INT.B.GBX');
      const selectedCode = selected ? selected.code : null;

      e.setExplode(1, false, 'interior');
      e.tick(0.1);
      const box1 = e.interior.localBox('HAB.INT.B.GBX');
      const c1 = box1 ? box1.getCenter(new V()) : null;
      const explodeDisp = c0 && c1 ? c1.distanceTo(c0) : 0;

      e.enterInterior('cabina');
      e.tick(0.1);
      const box2 = e.interior.localBox('HAB.INT.B.GBX');
      const c2 = box2 ? box2.getCenter(new V()) : null;
      const residualDisp = c0 && c2 ? c2.distanceTo(c0) : 999;

      const engCheck = {
        hasImm: !!imm,
        roomCodes,
        totalParts,
        selectedCode,
        explodeDisp: +explodeDisp.toFixed(3),
        modelExplodeAfter: e.model.explode,
        intExplodeAfter: e.interior.explodeValue,
        intExplodedModeAfter: e.interior.explodedMode,
        residualDisp: +residualDisp.toFixed(4),
      };

      // Etiquetas 3D en ENGINEERING (vista 01_ext_general)
      e.setMode('ENGINEERING');
      e.selectCode(null);
      e.setExplode(0, false, 'all');
      e.labels = true;
      e.hudHidden = false;
      const [bx, by, bz, tx, ty, tz, fov] = [22, 26, 9, 2.5, 0, 0, 34];
      e.camera.fov = fov;
      e.camera.updateProjectionMatrix();
      e.camera.position.copy(e.model.root.localToWorld(new V(bx, bz, -by)));
      e.controls.target.copy(e.model.root.localToWorld(new V(tx, tz, -ty)));
      e.camera.lookAt(e.controls.target);
      e.controls.update();
      e.tick(0.1);

      const els = [...document.querySelectorAll('.label3d')];
      const visible = [];
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        visible.push({ text: el.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      const overlaps = [];
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i];
          const b = visible[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            overlaps.push(`${a.text} ↔ ${b.text}`);
          }
        }
      }

      // --- Inicio Bloque 6: vista INTERIOR válida + WEBGL_lose_context ---
      e.enterInterior('cabina');
      e.tick(0.2);
      const stBefore = measureCanvas(e);
      const gl = e.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      let hasExt = false;
      if (ext) {
        hasExt = true;
        window.__alcionLoseCtxExt = ext;
        ext.loseContext();
      }

      return {
        profRes,
        engCheck,
        labelCheck: { total: els.length, visible: visible.length, overlaps },
        lossSetup: { hasExt, stBefore },
      };
    }, PIXEL_HELPER_SRC);

    const { profRes, engCheck, labelCheck, lossSetup } = profEngLose;

    for (const q of ['baja', 'media', 'alta', 'ultra']) {
      const r = profRes[q];
      ok(
        `3. Perfil gráfico «${q}»: render válido sin NaN/magenta`,
        r.quality === q && r.magenta < 0.001 && r.mean > 15,
        `bloom=${r.bloom} ao=${r.ao} msaa=${r.msaa} (${r.ms} ms) mean=${r.mean} black=${r.black} mag=${r.magenta}`,
      );
    }

    const pipelineDiffOk =
      !profRes.baja.bloom &&
      !profRes.baja.ao &&
      profRes.alta.bloom &&
      profRes.ultra.bloom &&
      profRes.alta.ao &&
      profRes.ultra.ao;
    ok(
      '3e. Perfiles gráficos: baja desactiva bloom y AO frente a alta/ultra',
      pipelineDiffOk,
      `baja(bloom=${profRes.baja.bloom},ao=${profRes.baja.ao}) vs alta(${profRes.alta.bloom},${profRes.alta.ao}) ultra(${profRes.ultra.bloom},${profRes.ultra.ao})`,
    );
    metrics.profiles = profRes;

    const expectedRooms = ['HAB.INT.IMM.A', 'HAB.INT.IMM.B', 'HAB.INT.IMM.C', 'HAB.INT.IMM.D', 'HAB.INT.IMM.N'];
    const hasAll5Rooms = expectedRooms.every((rc) => engCheck.roomCodes.includes(rc)) && engCheck.roomCodes.length === 5;

    ok(
      '4a. Ingeniería interior: HAB.INT.IMM con 5 estancias (A..N) y ≥ 100 piezas',
      engCheck.hasImm && hasAll5Rooms && engCheck.totalParts >= 100,
      `estancias=${engCheck.roomCodes.length} (${engCheck.roomCodes.join(',')}), piezas=${engCheck.totalParts}`,
    );
    ok(
      '4b. Ingeniería interior: selectCode(HAB.INT.B.GBX) + explosión interior > 0.5 m',
      engCheck.selectedCode === 'HAB.INT.B.GBX' && engCheck.explodeDisp > 0.5,
      `selected=${engCheck.selectedCode}, disp=${engCheck.explodeDisp} m`,
    );
    ok(
      '4c. Ingeniería interior: retorno a INTERIOR resetea explosión a 0 sin residuo',
      engCheck.modelExplodeAfter === 0 &&
        engCheck.intExplodeAfter === 0 &&
        !engCheck.intExplodedModeAfter &&
        engCheck.residualDisp < 0.01,
      `modelEx=${engCheck.modelExplodeAfter}, intEx=${engCheck.intExplodeAfter}, residuo=${engCheck.residualDisp} m`,
    );
    metrics.engineering = { engCheck, labelCheck };
    ok(
      '4d. Ingeniería (01_ext_general): etiquetas 3D visibles con 0 solapamientos 2D',
      labelCheck.visible >= 3 && labelCheck.overlaps.length === 0,
      `visibles=${labelCheck.visible}/${labelCheck.total}, solapes=${labelCheck.overlaps.length}${labelCheck.overlaps.length ? ' (' + labelCheck.overlaps.slice(0, 3).join('; ') + ')' : ''}`,
    );

    // =========================================================================
    // 6. RECUPERACIÓN DE CONTEXTO WEBGL (WEBGL_lose_context)
    // =========================================================================
    await p.waitForTimeout(450);

    const duringLoss = await p.evaluate(() => {
      const e = window.__engine;
      const gl = e.renderer.getContext();
      return {
        contextLost: e.contextLost,
        glLost: gl.isContextLost(),
      };
    });
    const pageErrDuringLoss = deskState.pageErrors.length - pageErrBeforeLoss;

    ok(
      '6a. WEBGL_lose_context: contexto perdido detectado y 0 pageerror',
      lossSetup.hasExt && duringLoss.contextLost === true && duringLoss.glLost === true && pageErrDuringLoss === 0,
      `hasExt=${lossSetup.hasExt}, contextLost=${duringLoss.contextLost}, glLost=${duringLoss.glLost}, pageErr=${pageErrDuringLoss}`,
    );

    // Restaurar y capturar inmediatamente al terminar Engine.onContextRestored()
    // sin dejar que rAF intercale renders redundantes sobre SwiftShader.
    const restoreResult = await p.evaluate((helperSrc) => {
      const e = window.__engine;
      const measureCanvas = new Function('e', `${helperSrc}; return measureCanvas(e);`);
      const canvas = e.renderer.domElement;
      const t0 = performance.now();
      return new Promise((resolve) => {
        let done = false;
        const finish = (restored) => {
          if (done) return;
          done = true;
          const restoreMs = Math.round(performance.now() - t0);
          const glLost = e.renderer.getContext().isContextLost();
          const contextLost = e.contextLost;
          let st = { mean: 0, black: 1, white: 0, magenta: 0 };
          if (restored && !glLost && !contextLost) {
            e.tick(0.15);
            st = measureCanvas(e);
          }
          e.dispose();
          resolve({ restored, restoreMs, contextLost, glLost, st });
        };
        const timer = setTimeout(() => finish(false), 60000);
        canvas.addEventListener(
          'webglcontextrestored',
          () => {
            clearTimeout(timer);
            finish(!e.renderer.getContext().isContextLost() && e.contextLost === false);
          },
          { once: true },
        );
        if (window.__alcionLoseCtxExt) window.__alcionLoseCtxExt.restoreContext();
        else {
          clearTimeout(timer);
          finish(false);
        }
      });
    }, PIXEL_HELPER_SRC);

    deskState.allowContextLostLog = false;
    const pageErrAfterRestore = deskState.pageErrors.length - pageErrBeforeLoss;

    metrics.contextLoss = {
      stBeforeLoss: lossSetup.stBefore,
      duringLoss,
      restoredOk: restoreResult.restored,
      restoreMs: restoreResult.restoreMs,
      afterRestore: {
        contextLost: restoreResult.contextLost,
        glLost: restoreResult.glLost,
        st: restoreResult.st,
      },
      ignoredContextLostLogs: deskState.ignoredContextLostLogs.length,
    };

    ok(
      '6b. WEBGL_lose_context: restauración completa y fotograma válido sin pageerror',
      restoreResult.restored &&
        restoreResult.contextLost === false &&
        !restoreResult.glLost &&
        restoreResult.st.mean > 15 &&
        restoreResult.st.magenta < 0.001 &&
        restoreResult.st.black < 0.85 &&
        pageErrAfterRestore === 0,
      `restored=${restoreResult.restored} (${restoreResult.restoreMs} ms), before=${JSON.stringify(lossSetup.stBefore)}, after=${JSON.stringify(restoreResult.st)}, pageErr=${pageErrAfterRestore}`,
    );

    ok(
      'Escritorio: 0 errores de página, consola y HTTP',
      deskState.pageErrors.length === 0 && deskState.consoleErrors.length === 0 && deskState.httpErrors.length === 0,
      `page=${deskState.pageErrors.length}, console=${deskState.consoleErrors.length}, http=${deskState.httpErrors.length}` +
        (deskState.pageErrors.length + deskState.consoleErrors.length + deskState.httpErrors.length > 0
          ? ' · ' + [...deskState.pageErrors, ...deskState.consoleErrors, ...deskState.httpErrors].slice(0, 3).join(' | ')
          : ''),
    );

    await p.close();

    // =========================================================================
    // 5. MÓVIL VERTICAL (390×844) Y HORIZONTAL (844×390)
    // =========================================================================
    const mob = await openSession(
      browser,
      { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
      'baja',
    );
    const { page: mp, state: mobState } = mob;
    metrics.mobileBootMs = mob.tBootMs;

    const mobVert = await mp.evaluate(async () => {
      const ovPortada = {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        mode: window.__engine.mode,
      };
      // Pulsar «Subir a bordo» en la UI real y forzar emisión de instantánea para evitar espera de rAF
      const btn = [...document.querySelectorAll('button')].find((b) => /Subir a bordo/.test(b.textContent || ''));
      if (btn) btn.click();
      window.__engine.emitSnap();
      let stickVis = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const el = document.querySelector('.touch-stick, .stick');
        if (window.__engine.mode === 'INTERIOR' && el) {
          const r = el.getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            stickVis = true;
            break;
          }
        }
      }
      const ovInt = {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        mode: window.__engine.mode,
        stickVis,
      };
      return { ovPortada, ovInt };
    });

    ok(
      '5a. Móvil vertical (390×844): 0 desbordamiento horizontal en portada',
      mobVert.ovPortada.scrollW <= mobVert.ovPortada.innerW + 1,
      `scrollW=${mobVert.ovPortada.scrollW} <= innerW=${mobVert.ovPortada.innerW} (${mobVert.ovPortada.mode})`,
    );
    ok(
      '5b. Móvil vertical (390×844): 0 desbordamiento y palanca táctil visible en interior',
      mobVert.ovInt.mode === 'INTERIOR' && mobVert.ovInt.scrollW <= mobVert.ovInt.innerW + 1 && mobVert.ovInt.stickVis,
      `mode=${mobVert.ovInt.mode}, scrollW=${mobVert.ovInt.scrollW}/${mobVert.ovInt.innerW}, stick=${mobVert.ovInt.stickVis}`,
    );

    await mp.setViewportSize({ width: 844, height: 390 });
    const mobHoriz = await mp.evaluate(async () => {
      const e = window.__engine;
      e.resize();
      const scrollWInt = document.documentElement.scrollWidth;
      const innerWInt = window.innerWidth;
      const elInt = document.querySelector('.touch-stick, .stick');
      const rectInt = elInt ? elInt.getBoundingClientRect() : null;
      const visInt = !!rectInt && rectInt.width > 10 && rectInt.height > 10;
      let moved = 0;
      let drift = 999;
      if (elInt && visInt) {
        const p0 = e.player.pos.toArray();
        const cx = rectInt.left + rectInt.width / 2;
        const cy = rectInt.top + rectInt.height / 2;
        const ev = (type, x, y) =>
          elInt.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
        ev('pointerdown', cx, cy);
        ev('pointermove', cx, cy - 36);
        e.tick(1.0);
        const p1 = e.player.pos.toArray();
        moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
        ev('pointerup', cx, cy - 36);
        e.tick(1.0);
        const p2 = e.player.pos.toArray();
        e.tick(0.8);
        const p3 = e.player.pos.toArray();
        drift = Math.hypot(p3[0] - p2[0], p3[2] - p2[2]);
      }

      // Cambiar a FLIGHT en horizontal (844×390) y probar palanca táctil
      e.setMode('FLIGHT');
      e.flight.input.throttle = 0;
      e.flight.state.vel.set(0, 0, 0);
      e.tick(0.2);
      e.emitSnap();
      await new Promise((r) => setTimeout(r, 80));

      const scrollWFly = document.documentElement.scrollWidth;
      const innerWFly = window.innerWidth;
      const elFly = document.querySelector('.touch-stick, .stick');
      const rectFly = elFly ? elFly.getBoundingClientRect() : null;
      const visFly = !!rectFly && rectFly.width > 10 && rectFly.height > 10;
      let speed = 0;
      if (elFly && visFly) {
        const cx = rectFly.left + rectFly.width / 2;
        const cy = rectFly.top + rectFly.height / 2;
        const ev = (type, x, y) =>
          elFly.dispatchEvent(new PointerEvent(type, { pointerId: 12, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
        ev('pointerdown', cx, cy);
        ev('pointermove', cx, cy - 38);
        e.tick(2.0);
        speed = e.flight.state.vel.length();
        ev('pointerup', cx, cy - 38);
      }
      const modeFly = e.mode;
      e.dispose();
      return {
        int: { scrollW: scrollWInt, innerW: innerWInt, vis: visInt, moved: +moved.toFixed(2), drift: +drift.toFixed(3) },
        fly: { mode: modeFly, scrollW: scrollWFly, innerW: innerWFly, vis: visFly, speed: +speed.toFixed(3) },
      };
    });

    ok(
      '5c. Móvil horizontal (844×390): interior sin desbordamiento y palanca usable',
      mobHoriz.int.scrollW <= mobHoriz.int.innerW + 1 && mobHoriz.int.vis && mobHoriz.int.moved > 0.3 && mobHoriz.int.drift < 0.05,
      `scrollW=${mobHoriz.int.scrollW}/${mobHoriz.int.innerW}, stick=${mobHoriz.int.vis}, moved=${mobHoriz.int.moved} m, drift=${mobHoriz.int.drift} m`,
    );
    ok(
      '5d. Móvil horizontal (844×390): vuelo sin desbordamiento y palanca usable',
      mobHoriz.fly.mode === 'FLIGHT' && mobHoriz.fly.scrollW <= mobHoriz.fly.innerW + 1 && mobHoriz.fly.vis && mobHoriz.fly.speed > 0.03,
      `mode=${mobHoriz.fly.mode}, scrollW=${mobHoriz.fly.scrollW}/${mobHoriz.fly.innerW}, stick=${mobHoriz.fly.vis}, speed=${mobHoriz.fly.speed} m/s`,
    );

    ok(
      'Móvil: 0 errores de página, consola y HTTP',
      mobState.pageErrors.length === 0 && mobState.consoleErrors.length === 0 && mobState.httpErrors.length === 0,
      `page=${mobState.pageErrors.length}, console=${mobState.consoleErrors.length}, http=${mobState.httpErrors.length}` +
        (mobState.pageErrors.length + mobState.consoleErrors.length + mobState.httpErrors.length > 0
          ? ' · ' + [...mobState.pageErrors, ...mobState.consoleErrors, ...mobState.httpErrors].slice(0, 3).join(' | ')
          : ''),
    );

    await mp.close();
    await browser.close();
    browser = null;

    const totalMs = Date.now() - tSuiteStart;
    const passCount = results.filter((r) => r.pass).length;
    const summary = {
      date: new Date().toISOString(),
      url: URL,
      durationSec: +(totalMs / 1000).toFixed(2),
      pass: passCount,
      total: results.length,
      metrics,
      results,
    };

    if (OUT_ARG) {
      const isJson = OUT_ARG.toLowerCase().endsWith('.json');
      const targetFile = isJson ? OUT_ARG : path.join(OUT_ARG, 'results.json');
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, JSON.stringify(summary, null, 2));
    }

    console.log(`\n${passCount}/${results.length} PASS · ${summary.durationSec} s`);
    process.exit(passCount === results.length ? 0 : 1);
  } catch (err) {
    console.error('FATAL:', err);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
})();
