import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Mode, Snapshot, WAYPOINTS, Quality } from './engine/Engine';
import type { PartNode } from './engine/ship/ShipModel';
import { MISSIONS } from './engine/Missions';
import { NEED_LABEL, type NeedId } from './engine/sim/Crew';
import { ACTION_LABELS, Action, DEFAULT_BINDINGS } from './engine/Input';
import { SWITCH_LABEL, SWITCH_ORDER } from './engine/ship/Systems';
import { IDENTITY, SPEC, PROFILE, PHILOSOPHY, SOURCES } from './data/spec';
import * as THREE from 'three';

const MODES: { id: Mode; label: string; key: string }[] = [
  { id: 'CINEMATIC', label: 'Cinemático', key: '1' }, { id: 'FLIGHT', label: 'Vuelo', key: '2' }, { id: 'INTERIOR', label: 'Interior', key: '3' },
  { id: 'EVA', label: 'EVA', key: '4' }, { id: 'ENGINEERING', label: 'Ingeniería', key: '5' }, { id: 'MISSIONS', label: 'Misiones', key: '6' }, { id: 'SANDBOX', label: 'Sandbox', key: '7' },
];
const fmt = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const touchDevice = () => matchMedia('(pointer: coarse)').matches;

const TUTORIAL: Partial<Record<Mode, string[]>> = {
  FLIGHT: ['W/S avanzar/retroceder · A/D lateral · R/F subir/bajar (RCS)', 'Flechas o I/J/K/L: cabeceo y guiñada · Q/E: alabeo', 'X/Z: empuje principal · T: asistido/manual · B: frenado asistido', 'C: cambiar cámara · clic: capturar ratón · P: foto · H: ocultar interfaz'],
  INTERIOR: ['Haz clic para mirar con el ratón · WASD para flotar · Espacio/Ctrl para subir/bajar', 'Apunta a interruptores, escotillas, taquillas, pantallas y asientos y pulsa G (o haz clic)', 'V: agarrarse al asidero más cercano · Mayús: impulso'],
  EVA: ['WASD + Espacio/Ctrl: propulsores del equipo de maniobra · Mayús: impulso', 'G: interactuar (reparaciones: mantener) · V: agarrarse a un pasamanos', 'Vuelve a la escotilla de la esclusa para entrar'],
  ENGINEERING: ['Clic: seleccionar pieza (segundo clic: subir de nivel) · doble clic en el árbol: enfocar', 'F enfocar · I aislar · H ocultar · X rayos X · E explosionar'],
  SANDBOX: ['Pulsos de luz ficticios contra dianas holográficas · N o clic derecho: disparar pulso', 'Pilota como en el modo Vuelo; las rachas multiplican la puntuación'],
};

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const [eng, setEng] = useState<Engine | null>(null);
  const [s, setS] = useState<Snapshot | null>(null);
  const [sel, setSel] = useState<PartNode | null>(null);
  const [settings, setSettings] = useState(false);
  const [sub, setSub] = useState<'inspector' | 'plans' | 'spec'>('inspector');
  const [tutorialOff, setTutorialOff] = useState(() => localStorage.getItem('alcion-tut-off') === '1');
  const [tutSeen, setTutSeen] = useState<Record<string, boolean>>({});
  const [armOpen, setArmOpen] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    const e = new Engine(host.current);
    (window as any).__engine = e;
    e.onSelect = (n) => setSel(n);
    e.missions.onChange = () => force((x) => x + 1);
    const st = e.loadSettings();
    if (st) {
      e.input.invertY = !!st.invertY; e.input.sensitivity = st.sens ?? 1; e.audio.setVolume(st.volume ?? 0.7); e.audio.mode = st.sound ?? 'realista';
      e.reducedMotion = !!st.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches; e.dynamicRes = st.dynamicRes ?? true;
    } else e.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const unsub = e.subscribe(setS);
    setEng(e);
    e.load();
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'SELECT' || e.input.listening) return;
      const m = MODES.find((x) => x.key === ev.key);
      if (m && (ev.altKey || e.mode === 'ENGINEERING' || e.mode === 'CINEMATIC' || e.mode === 'MISSIONS')) { e.setMode(m.id); ev.preventDefault(); }
      if (ev.key === 'Escape') { if (e.mode === 'ENGINEERING') { e.select(null); e.model.setIsolate(null); } }
    };
    window.addEventListener('keydown', onKey);
    return () => { unsub(); window.removeEventListener('keydown', onKey); e.dispose(); };
  }, []);

  if (!eng) return <div className="app"><div className="viewport" ref={host} /></div>;
  const mode = s?.mode ?? 'CINEMATIC';
  const hud = !s?.hudHidden;
  const tut = !tutorialOff && TUTORIAL[mode] && !tutSeen[mode] && s?.ready;

  return (
    <div className={`app mode-${mode.toLowerCase()} ${hud ? '' : 'hud-hidden'}`}>
      <div className="viewport" ref={host} />
      {(!s || !s.ready) && <Loader stage={s?.progress.stage ?? 'Iniciando'} p={s?.progress.p ?? 0} />}
      {s?.ready && (
        <>
          {hud && <TopBar s={s} eng={eng} onSettings={() => setSettings(true)} />}
          {mode === 'CINEMATIC' && <Cinematic s={s} eng={eng} />}
          {(mode === 'FLIGHT' || mode === 'SANDBOX') && hud && <FlightHUD s={s} eng={eng} onArm={() => setArmOpen((v) => !v)} />}
          {(mode === 'INTERIOR') && hud && <InteriorHUD s={s} eng={eng} />}
          {mode === 'EVA' && hud && <EvaHUD s={s} />}
          {mode === 'ENGINEERING' && hud && (
            <>
              <div className="subtabs">
                {([['inspector', 'Inspector'], ['plans', 'Planos'], ['spec', 'Ficha técnica']] as const).map(([id, l]) => (
                  <button key={id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{l}</button>
                ))}
              </div>
              {sub === 'inspector' && <Engineering eng={eng} s={s} sel={sel} />}
              {sub === 'plans' && <Plans />}
              {sub === 'spec' && <SpecSheet />}
            </>
          )}
          {mode === 'MISSIONS' && <MissionsPanel eng={eng} s={s} />}
          {armOpen && (mode === 'FLIGHT' || mode === 'SANDBOX') && <ArmPanel eng={eng} s={s} onClose={() => setArmOpen(false)} />}
          {s.mission && mode !== 'MISSIONS' && hud && <MissionCard s={s} eng={eng} />}
          {s.inspect && <InspectCard s={s} eng={eng} />}
          {touchDevice() && (mode === 'FLIGHT' || mode === 'SANDBOX' || mode === 'INTERIOR' || mode === 'EVA') && <TouchControls eng={eng} mode={mode} />}
          <Alerts s={s} />
          {s.toast && <div className="toast">{s.toast}</div>}
          {tut && (
            <div className="tutorial" role="dialog" aria-label="Tutorial">
              <p className="eyebrow">Tutorial · {MODES.find((m) => m.id === mode)?.label}</p>
              <ul>{TUTORIAL[mode]!.map((t) => <li key={t}>{t}</li>)}</ul>
              <div className="row-btns">
                <button className="btn" onClick={() => setTutSeen({ ...tutSeen, [mode]: true })}>Entendido</button>
                <button className="btn ghost" onClick={() => { setTutorialOff(true); localStorage.setItem('alcion-tut-off', '1'); }}>No volver a mostrar</button>
              </div>
            </div>
          )}
          {settings && <Settings eng={eng} s={s} onClose={() => setSettings(false)} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- comunes
function Loader({ stage, p }: { stage: string; p: number }) {
  return (
    <div className="loader">
      <div className="loader-inner">
        <p className="eyebrow">Varro-Lindqvist Astronautics · Beyond Orbit</p>
        <h1 className="display sm">ALCIÓN <span className="desig">HX-4</span></h1>
        <div className="bar"><div style={{ transform: `scaleX(${Math.max(0.02, p)})` }} /></div>
        <p className="mono small">{stage} · {Math.round(p * 100)} %</p>
      </div>
    </div>
  );
}

function TopBar({ s, eng, onSettings }: { s: Snapshot; eng: Engine; onSettings: () => void }) {
  const full = async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch { /* */ } };
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden><path d="M5 21 L16 8 L27 21" stroke="var(--accent)" strokeWidth="2.6" fill="none" /><path d="M10 25 H22" stroke="var(--ink)" strokeWidth="2" /></svg>
        <span className="brand-name">ALCIÓN</span><span className="brand-desig">HX-4</span>
      </div>
      <nav className="tabs" role="tablist" aria-label="Modos">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={s.mode === m.id} className={s.mode === m.id ? 'on' : ''} title={`Alt+${m.key}`} onClick={() => eng.setMode(m.id)}>{m.label}</button>
        ))}
      </nav>
      <div className="top-right">
        <span className="mono small stat">{s.stats.fps} fps · {s.stats.calls} llamadas</span>
        <button className="icon-btn" title="Fotografía (P)" aria-label="Fotografía" onClick={() => eng.photo()}>
          <svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" fill="none" /><circle cx="12" cy="13.5" r="3.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M8 7l1.5-2h5L16 7" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
        </button>
        <button className="icon-btn" title="Pantalla completa" aria-label="Pantalla completa" onClick={full}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
        </button>
        <button className="icon-btn" title="Ajustes" aria-label="Ajustes" onClick={onSettings}>
          <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
      </div>
    </header>
  );
}

function Alerts({ s }: { s: Snapshot }) {
  const a = s.alerts.filter((x) => x.level !== 'info').slice(0, 2);
  if (!a.length) return null;
  return <div className="alerts">{a.map((x, i) => <div key={i} className={`alert ${x.level}`}>{x.level === 'alarm' ? '▲' : '●'} {x.text}</div>)}</div>;
}

// ---------------------------------------------------------------- cinemático
function Cinematic({ s, eng }: { s: Snapshot; eng: Engine }) {
  return (
    <div className="cinematic">
      <div className="letterbox top" /><div className="letterbox bottom" />
      <div className="cine-card">
        <p className="eyebrow">{IDENTITY.maker} · Vehículo tripulado cislunar</p>
        <h1 className="display">ALCIÓN <span className="desig">HX-4</span></h1>
        <p className="lede">Mira la nave desde fuera, entra, siéntate a los mandos, enciéndela y pilótala. Después sal en EVA o vuelve al modo ingeniería para desmontarla pieza a pieza.</p>
        <div className="row-btns">
          <button className="btn primary" onClick={() => eng.setMode('FLIGHT')}>Pilotar</button>
          <button className="btn" onClick={() => eng.enterInterior('cabina')}>Entrar en la nave</button>
          <button className="btn" onClick={() => eng.setMode('MISSIONS')}>Misiones</button>
          <button className="btn ghost" onClick={() => eng.setMode('ENGINEERING')}>Modo ingeniería</button>
        </div>
        <p className="mono small muted">{s.body} · {fmt(s.altKm, 0)} km · {s.eclipse > 0.5 ? 'en sombra' : 'iluminado'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- vuelo
function FlightHUD({ s, eng, onArm }: { s: Snapshot; eng: Engine; onArm: () => void }) {
  const [vx, vy, vz] = s.vel;
  return (
    <div className="hud flight-hud">
      <div className="reticle" aria-hidden><i /><i /><i /><i /></div>
      <div className="hud-left">
        <div className="hud-block">
          <p className="eyebrow">Velocidad relativa</p>
          <p className="big mono">{fmt(s.speed, 2)}<small> m/s</small></p>
          <p className="mono small">X {fmt(vx, 2)} · Y {fmt(vy, 2)} · Z {fmt(vz, 2)}</p>
          <p className="mono small">ω {fmt(s.w * 57.3, 2)} °/s</p>
        </div>
        <div className="hud-block">
          <p className="eyebrow">Empuje principal</p>
          <div className="vbar"><div style={{ height: `${s.throttle * 100}%` }} /></div>
          <p className="mono small">{Math.round(s.throttle * 100)} % · escala ×{s.thrustScale}</p>
        </div>
      </div>
      <div className="hud-right">
        <div className="hud-block">
          <p className="eyebrow">{s.body} · {fmt(s.altKm, 0)} km</p>
          {s.targets.map((t) => <p key={t.label} className="mono small">{t.label}: {t.range < 1000 ? `${fmt(t.range, 0)} m` : `${fmt(t.range / 1000, 2)} km`} <span className="muted">{t.rate >= 0 ? '↘' : '↗'} {fmt(Math.abs(t.rate), 2)}</span></p>)}
        </div>
        {s.dock && s.dock.range < 60 && (
          <div className={`hud-block dock ${s.dock.capture ? 'ok' : ''}`}>
            <p className="eyebrow">Atraque · Tesela</p>
            <p className="mono">Dist {fmt(s.dock.range, 2)} m · Cierre {fmt(s.dock.closing, 3)} m/s</p>
            <p className="mono small">Lat {fmt(s.dock.lat, 2)} · Vert {fmt(s.dock.vert, 2)} · Áng {fmt(s.dock.angle, 1)}°</p>
            <p className="mono small">{s.dock.capture ? 'CAPTURA' : s.dock.angle < 6 && s.dock.closing < 0.25 ? 'DENTRO DE TOLERANCIA' : 'FUERA DE TOLERANCIA'}</p>
          </div>
        )}
        {s.sandbox && <div className="hud-block"><p className="eyebrow">Entrenamiento</p><p className="big mono">{s.sandbox.score}</p><p className="mono small">Racha ×{s.sandbox.streak} · Pulsos {s.sandbox.shots}</p></div>}
      </div>
      <div className="hud-bottom">
        <span className={`pill ${s.assist ? 'on' : 'warn'}`}>{s.assist ? 'ASISTIDO' : 'MANUAL'}</span>
        <span className={`pill ${s.systems.sw.RCS && s.systems.sw.BAT ? 'on' : 'off'}`}>RCS</span>
        <span className={`pill ${s.systems.sw.MAIN && s.systems.sw.BAT ? 'on' : 'off'}`}>MOTORES</span>
        <span className="pill">{s.seated ? 'CABINA' : { chase: 'PERSECUCIÓN', orbit: 'ORBITAL', free: 'LIBRE', cockpit: 'CABINA' }[s.flightCam]}</span>
        {s.docked && <span className="pill on">ATRACADO</span>}
        <span className="pill">BAT {Math.round(s.systems.soc * 100)} %</span>
        <span className="pill">BIPROP {fmt(s.systems.biprop, 0)} kg</span>
        <button className="btn sm" onClick={onArm}>Brazo</button>
        {s.docked && <button className="btn sm" onClick={() => { eng.flight.docked = null; eng.flight.state.vel.set(-0.2, 0, 0).applyQuaternion(eng.flight.state.q); }}>Desatracar</button>}
        {s.seated && <button className="btn sm" onClick={() => eng.standUp()}>Levantarse (Y)</button>}
      </div>
      {s.seated && s.prompt && <div className="prompt"><kbd>G</kbd> {s.prompt}</div>}
    </div>
  );
}

function ArmPanel({ eng, s, onClose }: { eng: Engine; s: Snapshot; onClose: () => void }) {
  const names = ['Hombro rodillo', 'Hombro cabeceo', 'Codo', 'Muñeca cabeceo', 'Muñeca guiñada', 'Muñeca rodillo'];
  return (
    <aside className="panel arm-panel open">
      <div className="panel-head"><span className="eyebrow">Brazo robótico · 7 GDL</span><button className="icon-btn sm" onClick={onClose} aria-label="Cerrar">×</button></div>
      {!s.systems.sw.RBT && <p className="small warn-text">Sin alimentación: activa RBT en el panel cenital.</p>}
      <div className="row-btns">
        <button className="btn" onClick={() => eng.mech.setPose('stow')}>Estiba</button>
        <button className="btn" onClick={() => eng.mech.setPose('deploy')}>Desplegar</button>
        <button className="btn" onClick={() => eng.mech.setPose('inspect')}>Inspección</button>
        <button className="btn primary" onClick={() => eng.armCapture()}>Capturar cápsula</button>
        {s.armGrabbed && <button className="btn" onClick={() => { eng.mech.grabbed = null; eng.canister.vel.set(0, 0.05, 0); }}>Soltar</button>}
      </div>
      {names.map((n, i) => (
        <div key={n} className="joint">
          <span className="small">{n}</span>
          <span className="mono small">{fmt(s.arm[i] * 57.3, 1)}°</span>
          <button className="btn sm" onClick={() => eng.mech.jogJoint(i, -0.1)}>−</button>
          <button className="btn sm" onClick={() => eng.mech.jogJoint(i, 0.1)}>+</button>
        </div>
      ))}
      <p className="small muted">Las pantallas de la estación robótica del nodo muestran la cámara del extremo del brazo.</p>
    </aside>
  );
}

// ---------------------------------------------------------------- interior y EVA
function InteriorHUD({ s, eng }: { s: Snapshot; eng: Engine }) {
  const needs = Object.entries(s.crew.needs) as [NeedId, number][];
  const walk = s.locomotion === 'walk';
  return (
    <div className="hud interior-hud">
      <div className="crosshair" aria-hidden />
      {s.fade > 0.01 && <div className="sleep-fade" style={{ opacity: s.fade }}><span className="mono">{s.crew.clock}</span></div>}
      {s.prompt && <div className="prompt">{!s.activity && <kbd>G</kbd>} {s.prompt}{s.holdProgress > 0 && s.holdProgress < 1 && <span className="hold"><i style={{ width: `${s.holdProgress * 100}%` }} /></span>}</div>}
      <div className="hud-left">
        <div className="hud-block crew-block">
          <p className="eyebrow">Tripulante · {s.crew.clock}</p>
          {needs.map(([k, v]) => (
            <div key={k} className={'need' + (v < 25 ? ' low' : '')}>
              <span className="small">{NEED_LABEL[k]}</span>
              <div className="hbar"><div style={{ width: `${v}%` }} /></div>
              <span className="mono small">{Math.round(v)}</span>
            </div>
          ))}
          {(s.crew.samples > 0 || s.crew.stored > 0) && <p className="mono small muted">Muestras: {s.crew.samples} pendiente(s) · {s.crew.stored} congelada(s)</p>}
        </div>
        <div className="hud-block">
          <p className="eyebrow">Cabina</p>
          <p className="mono small">O₂ {fmt(s.systems.o2, 1)} kPa · CO₂ {fmt(s.systems.co2, 2)} kPa</p>
          <p className="mono small">{fmt(s.systems.temp, 1)} °C · Batería {Math.round(s.systems.soc * 100)} %</p>
          <p className="mono small">Esclusa: {({ pres: 'presurizada', depress: 'despresurizando', vac: 'vacío', repress: 'represurizando' } as Record<string, string>)[s.airlock]}</p>
        </div>
      </div>
      <div className="loco">
        <div className="seg">
          <button className={walk ? 'on' : ''} onClick={() => eng.setLocomotion('walk')} title="Gravedad de entrenamiento 1 g: caminar sobre la cubierta">Caminar</button>
          <button className={!walk ? 'on' : ''} onClick={() => eng.setLocomotion('float')} title="Microgravedad: flotar y agarrarse a los asideros">Flotar</button>
        </div>
        <p className="mono small muted">{walk ? (s.climbing ? 'Escalerilla · Espacio sube · Ctrl baja' : `WASD andar · Mayús correr · Ctrl agacharse${s.crouch ? ' (agachado)' : ''} · Espacio saltar`) : 'WASD · R/F subir/bajar · V agarrarse'}</p>
      </div>
      <div className="waypoints">
        {Object.entries(WAYPOINTS).map(([id, w]) => <button key={id} className="btn sm" onClick={() => eng.enterInterior(id)}>{w.label}</button>)}
      </div>
    </div>
  );
}

function EvaHUD({ s }: { s: Snapshot }) {
  return (
    <div className="hud eva-hud">
      <div className="visor" aria-hidden />
      <div className="crosshair" aria-hidden />
      {s.prompt && <div className="prompt"><kbd>G</kbd> {s.prompt}{s.holdProgress > 0 && s.holdProgress < 1 && <span className="hold"><i style={{ width: `${s.holdProgress * 100}%` }} /></span>}</div>}
      <div className="hud-left">
        <div className="hud-block">
          <p className="eyebrow">Traje EVA</p>
          <p className="mono small">Propulsante de maniobra {Math.round(s.jetFuel * 100)} %</p>
          <div className="hbar"><div style={{ width: `${s.jetFuel * 100}%` }} /></div>
          <p className="mono small">Línea de seguridad conectada</p>
        </div>
      </div>
    </div>
  );
}

function MissionCard({ s, eng }: { s: Snapshot; eng: Engine }) {
  const m = s.mission!;
  return (
    <div className="mission-card">
      <p className="eyebrow">{m.progress}</p>
      <p className="h3">{m.title}</p>
      <p className="small">{m.step}</p>
      {m.hint && <p className="small muted">{m.hint}</p>}
      <button className="btn sm ghost" onClick={() => eng.missions.abort()}>Abandonar</button>
    </div>
  );
}

function InspectCard({ s, eng }: { s: Snapshot; eng: Engine }) {
  return (
    <div className="inspect-card">
      <p className="eyebrow">Inspección</p>
      <p className="h3">{s.inspect!.label}</p>
      <p className="small">{s.inspect!.desc}</p>
      <button className="btn sm" onClick={() => { eng.inspect = null; eng.emitSnap(); }}>Cerrar</button>
    </div>
  );
}

function MissionsPanel({ eng, s }: { eng: Engine; s: Snapshot }) {
  return (
    <div className="sheet missions">
      <div className="spec-inner">
        <p className="eyebrow">Misiones interactivas</p>
        <h1 className="h1">Elige una misión</h1>
        <p className="lede">Cada paso se comprueba sobre el estado real del simulador: interruptores, posiciones, alineaciones, el brazo robótico o las reparaciones.</p>
        <div className="mission-grid">
          {MISSIONS.map((m, i) => (
            <div key={m.id} className={`mission ${i === 0 ? 'wide' : ''}`}>
              <p className="eyebrow">{m.mode} · {m.steps.length} pasos {s.missionsDone.includes(m.id) && '· ✓ completada'}</p>
              <h3 className="h3">{m.title}</h3>
              <p className="small">{m.brief}</p>
              <button className="btn primary" onClick={() => eng.missions.start(eng, m.id)}>Iniciar</button>
            </div>
          ))}
        </div>
        <h3 className="h2 mt">Escenario orbital</h3>
        <div className="row-btns">
          {eng.astro.scenarios().map((sc) => <button key={sc.id} className={`btn ${s.scenario === sc.id ? 'active' : ''}`} onClick={() => eng.setScenario(sc.id)} title={sc.desc}>{sc.label}</button>)}
        </div>
        <h3 className="h2 mt">Vuelo libre y recorridos</h3>
        <div className="row-btns">
          <button className="btn" onClick={() => eng.setMode('FLIGHT')}>Vuelo libre</button>
          <button className="btn" onClick={() => eng.setMode('CINEMATIC')}>Recorrido cinematográfico</button>
          <button className="btn" onClick={() => eng.setMode('SANDBOX')}>Sandbox</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- táctil
function TouchControls({ eng, mode }: { eng: Engine; mode: Mode }) {
  const stick = (onMove: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); (e.target as any)._o = [e.clientX, e.clientY]; },
    onPointerMove: (e: React.PointerEvent) => { const o = (e.target as any)._o; if (!o) return; onMove(Math.max(-1, Math.min(1, (e.clientX - o[0]) / 50)), Math.max(-1, Math.min(1, (e.clientY - o[1]) / 50))); },
    onPointerUp: (e: React.PointerEvent) => { (e.target as any)._o = null; onMove(0, 0); },
  });
  const T = eng.input.touch;
  const fly = mode === 'FLIGHT' || mode === 'SANDBOX';
  return (
    <div className="touch">
      <div className="stick left" {...stick((x, y) => { T.right = Math.max(0, x); T.left = Math.max(0, -x); T.fwd = Math.max(0, -y); T.back = Math.max(0, y); })}><span>Mover</span></div>
      <div className="stick right" {...stick((x, y) => {
        if (fly) { T.yawRight = Math.max(0, x); T.yawLeft = Math.max(0, -x); T.pitchUp = Math.max(0, y); T.pitchDown = Math.max(0, -y); }
        else { eng.input.touchLook.x = x * 0.05; eng.input.touchLook.y = y * 0.05; }
      })}><span>{fly ? 'Rotar' : 'Mirar'}</span></div>
      <div className="touch-btns">
        <button onPointerDown={() => (T.up = 1)} onPointerUp={() => (T.up = 0)}>▲</button>
        <button onPointerDown={() => (T.down = 1)} onPointerUp={() => (T.down = 0)}>▼</button>
        {fly && <button onPointerDown={() => (T.brake = 1)} onPointerUp={() => (T.brake = 0)}>Freno</button>}
        {mode === 'SANDBOX' && <button onPointerDown={() => (eng.touchFire = performance.now())}>Pulso</button>}
        {!fly && <button onClick={() => (eng as any).tryInteract?.call(eng)}>Usar</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ajustes
function Settings({ eng, s, onClose }: { eng: Engine; s: Snapshot; onClose: () => void }) {
  const [, f] = useState(0);
  const re = () => { eng.saveSettings(); f((x) => x + 1); };
  const [listen, setListen] = useState<Action | null>(null);
  return (
    <div className="modal" role="dialog" aria-label="Ajustes">
      <div className="modal-inner">
        <div className="panel-head"><span className="eyebrow">Ajustes</span><button className="icon-btn sm" onClick={onClose} aria-label="Cerrar">×</button></div>
        <div className="settings-grid">
          <section>
            <h3 className="h3">Gráficos</h3>
            <label>Calidad <select value={eng.quality} onChange={(e) => { eng.applyQuality(e.target.value as Quality); re(); }}>
              <option value="ultra">Ultra</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
            <label className="chk"><input type="checkbox" checked={eng.dynamicRes} onChange={(e) => { eng.dynamicRes = e.target.checked; re(); }} /> Resolución dinámica (objetivo 60 fps)</label>
            <label className="chk"><input type="checkbox" checked={eng.reducedMotion} onChange={(e) => { eng.reducedMotion = e.target.checked; re(); }} /> Movimiento reducido</label>
            <p className="mono small muted">{s.stats.fps} fps · {fmt(s.stats.ms, 1)} ms CPU · {s.stats.calls} llamadas · {Math.round(s.stats.tris / 1000)} k tri · DPR {fmt(s.stats.dpr, 2)} · {s.stats.batches} lotes / {s.stats.instances} instancias</p>
          </section>
          <section>
            <h3 className="h3">Sonido</h3>
            <label>Volumen <input type="range" min={0} max={1} step={0.05} value={eng.audio.volume} onChange={(e) => { eng.audio.start(); eng.audio.setVolume(parseFloat(e.target.value)); re(); }} /></label>
            <label>Modo <select value={eng.audio.mode} onChange={(e) => { eng.audio.mode = e.target.value as any; re(); }}>
              <option value="realista">Realista (sin sonido en el vacío)</option><option value="cinematico">Cinematográfico</option></select></label>
          </section>
          <section>
            <h3 className="h3">Vuelo</h3>
            <label>Escala de empuje <select value={eng.flight.thrustScale} onChange={(e) => { eng.flight.thrustScale = Number(e.target.value); re(); }}>
              <option value={1}>×1 (valores físicos aproximados)</option><option value={5}>×5</option><option value={10}>×10 (recomendado)</option><option value={25}>×25 (arcade)</option></select></label>
            <label className="chk"><input type="checkbox" checked={eng.input.invertY} onChange={(e) => { eng.input.invertY = e.target.checked; re(); }} /> Invertir eje vertical</label>
            <label>Sensibilidad <input type="range" min={0.3} max={2.5} step={0.1} value={eng.input.sensitivity} onChange={(e) => { eng.input.sensitivity = parseFloat(e.target.value); re(); }} /></label>
          </section>
          <section className="wide">
            <h3 className="h3">Controles (haz clic y pulsa una tecla)</h3>
            <div className="bindings">
              {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                <button key={a} className={`binding ${listen === a ? 'listening' : ''}`} onClick={() => { setListen(a); eng.input.listening = (code) => { eng.input.rebind(a, code); setListen(null); re(); }; }}>
                  <span>{ACTION_LABELS[a]}</span><kbd>{listen === a ? '…' : eng.input.bindings[a].join(' / ').replace(/Key|Digit/g, '')}</kbd>
                </button>
              ))}
            </div>
            <div className="row-btns">
              <button className="btn ghost" onClick={() => { eng.input.bindings = { ...DEFAULT_BINDINGS }; re(); }}>Restaurar controles</button>
              <button className="btn ghost" onClick={() => { localStorage.removeItem('alcion-tut-off'); re(); }}>Reactivar tutorial</button>
              <button className="btn ghost" onClick={() => eng.save()}>Guardar estado</button>
              <button className="btn ghost" onClick={() => eng.resetState()}>Reiniciar simulación</button>
            </div>
            <p className="small muted">El mando (Gamepad API) se detecta automáticamente: sticks para traslación y rotación, gatillos para subir/bajar y botones para interactuar, frenar y cambiar de cámara.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ingeniería
function Engineering({ eng, s, sel }: { eng: Engine; s: Snapshot; sel: PartNode | null }) {
  const [, f] = useState(0);
  const re = () => f((x) => x + 1);
  const [tool, setTool] = useState<'explode' | 'section' | 'views' | 'compare' | 'mech'>('explode');
  const [snapA, setSnapA] = useState<number | null>(null);
  const [snapB, setSnapB] = useState<number | null>(null);
  const m = eng.model;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'f' && sel) eng.focus(sel);
      else if (k === 'i' && sel) { m.setIsolate(m.isolate === sel ? null : sel); re(); }
      else if (k === 'h' && sel) { m.setHidden(sel, true); eng.select(null); re(); }
      else if (k === 'x') { m.setXray(!m.xray); re(); }
      else if (k === 'e') eng.setExplode(m.explode < 0.5 ? 1 : 0, true);
      else if (k === 'u' && sel?.parent) eng.select(sel.parent);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);
  const range = eng.section.axis === 'x' ? [-6.5, 13.3] : eng.section.axis === 'y' ? [-2.4, 2.4] : [-3.6, 2.6];
  const stages = [[0, 'Ensamblada'], [0.25, 'Módulos'], [0.5, 'Sistemas'], [0.75, 'Conjuntos'], [1, 'Piezas']] as const;
  const stage = stages.reduce((a, x) => (s.explode >= x[0] - 0.001 ? x : a), stages[0]);
  return (
    <>
      <aside className="panel tree-panel open">
        <div className="panel-head"><span className="eyebrow">Árbol de sistemas</span></div>
        {m.top && <Tree eng={eng} root={m.top} sel={sel} onChange={re} interiorReady={s.interiorReady} />}
      </aside>
      {sel && <Info eng={eng} n={sel} onChange={re} />}
      <div className="instrument">
        <div className="tool-tabs">
          {([['explode', 'Explosión'], ['section', 'Sección'], ['views', 'Vistas'], ['compare', 'Comparar'], ['mech', 'Mecanismos']] as const).map(([id, l]) => (
            <button key={id} className={tool === id ? 'on' : ''} onClick={() => setTool(id)}>{l}</button>
          ))}
          <span className="spacer" />
          <label className="chk"><input type="checkbox" checked={s.xray} onChange={(e) => { m.setXray(e.target.checked); re(); }} /> Rayos X</label>
          <label className="chk"><input type="checkbox" checked={eng.labels} onChange={(e) => { eng.labels = e.target.checked; re(); }} /> Etiquetas</label>
        </div>
        {tool === 'explode' && (
          <div className="tool explode-tool">
            <div className="readout"><span className="big mono">{String(Math.round(s.explode * 100)).padStart(3, ' ')}<small>%</small></span><span className="stage">{stage[1]}</span></div>
            <div className="slider-wrap">
              <input type="range" min={0} max={1} step={0.001} value={s.explode} aria-label="Vista explosionada" onChange={(e) => eng.setExplode(parseFloat(e.target.value))} style={{ ['--p' as any]: s.explode }} />
              <div className="ticks">{stages.map(([at, t]) => <button key={at} style={{ left: `${at * 100}%` }} className={s.explode >= at - 0.001 ? 'past' : ''} onClick={() => eng.setExplode(at, true)}><i /><span>{Math.round(at * 100)}<em> · {t}</em></span></button>)}</div>
            </div>
            <div className="btns">
              <button className="btn" onClick={() => eng.setExplode(s.explode < 0.5 ? 1 : 0, true)}>{s.explode < 0.5 ? 'Explosionar' : 'Ensamblar'}</button>
              <button className="btn" onClick={() => eng.assemble()}>Animar ensamblaje</button>
              <button className="btn ghost" onClick={() => { eng.setExplode(0, true); m.showAll(); eng.select(null); m.setXray(false); eng.setSection(false); eng.viewPreset('iso'); re(); }}>Restablecer</button>
            </div>
          </div>
        )}
        {tool === 'section' && (
          <div className="tool section-tool">
            <label className="chk"><input type="checkbox" checked={eng.section.on} onChange={(e) => { eng.setSection(e.target.checked); re(); }} /> Corte con tapas</label>
            <div className="seg">{(['x', 'y', 'z'] as const).map((a) => <button key={a} className={eng.section.axis === a ? 'on' : ''} onClick={() => { eng.setSection(true, a, a === 'x' ? 4.7 : 0); re(); }}>{a === 'x' ? 'Transversal' : a === 'y' ? 'Longitudinal' : 'Horizontal'}</button>)}</div>
            <input type="range" min={range[0]} max={range[1]} step={0.01} value={eng.section.pos} aria-label="Plano de corte" onChange={(e) => { eng.setSection(true, eng.section.axis, parseFloat(e.target.value)); re(); }} style={{ ['--p' as any]: (eng.section.pos - range[0]) / (range[1] - range[0]) }} />
            <span className="mono readout-sm">{eng.section.axis.toUpperCase()} = {fmt(eng.section.pos, 2)} m</span>
            <button className="btn ghost" onClick={() => { eng.setSection(true, eng.section.axis, eng.section.pos, !eng.section.flip); re(); }}>Invertir</button>
          </div>
        )}
        {tool === 'views' && (
          <div className="tool views-tool">
            {([['iso', 'Isométrica'], ['front', 'Frontal'], ['side', 'Lateral'], ['top', 'Superior'], ['bottom', 'Inferior'], ['rear', 'Posterior']] as const).map(([id, l]) => <button key={id} className="btn" onClick={() => eng.viewPreset(id)}>{l}</button>)}
          </div>
        )}
        {tool === 'mech' && <MechTool eng={eng} onChange={re} />}
        {tool === 'compare' && (
          <div className="tool views-tool">
            <span className="small muted">Instantáneas de explosión: guarda dos estados y alterna entre ellos con transición.</span>
            <button className="btn" onClick={() => setSnapA(s.explode)}>Guardar A {snapA !== null && `(${Math.round(snapA * 100)} %)`}</button>
            <button className="btn" onClick={() => setSnapB(s.explode)}>Guardar B {snapB !== null && `(${Math.round(snapB * 100)} %)`}</button>
            <button className="btn" disabled={snapA === null} onClick={() => eng.setExplode(snapA!, true)}>Ver A</button>
            <button className="btn" disabled={snapB === null} onClick={() => eng.setExplode(snapB!, true)}>Ver B</button>
          </div>
        )}
      </div>
      {eng.hoverNode && <div className="hover-tip" style={{ transform: `translate(${eng.hoverXY[0] + 14}px, ${eng.hoverXY[1] + 14}px)` }}><span className="mono">{eng.hoverNode.code}</span> {eng.hoverNode.label}</div>}
    </>
  );
}

/** Control directo de los mecanismos animados. Respeta los interlocks del simulador:
 *  el brazo y el seguimiento solar dependen de sus interruptores de potencia y la
 *  escotilla exterior de la esclusa sólo se abre mediante el ciclo de presión. */
function MechTool({ eng, onChange }: { eng: Engine; onChange: () => void }) {
  const m = eng.model;
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((x) => x + 1), 250); return () => window.clearInterval(id); }, []);
  const ids = [...m.mechs.keys()];
  const hatches = ids.filter((id) => id.startsWith('hatch:') && id !== 'hatch:alk_out').sort();
  const shutters = ids.filter((id) => id.startsWith('shutter:'));
  const lockers = ids.filter((id) => id.startsWith('locker:'));
  const isOpen = (id: string) => { const x = m.mech(id); return !!x && Math.abs(x.target - x.rest) > 1e-3; };
  const setAll = (list: string[], open: boolean) => { for (const id of list) if (isOpen(id) !== open) m.toggleMech(id); eng.audio.click(true); onChange(); };
  const label: Record<string, string> = { 'hatch:idss': 'Escotilla IDSS (proa)', 'hatch:aft': 'Escotilla nodo → hábitat', 'hatch:alk_in': 'Escotilla interior esclusa' };
  const rad = eng.mech.radiatorTarget > 0.5;
  const armOn = eng.systems.on('RBT');
  return (
    <div className="tool views-tool mech-tool">
      <div className="mech-group">
        <span className="eyebrow">Radiadores</span>
        <button className="btn" onClick={() => { eng.mech.radiatorTarget = rad ? 0 : 1; onChange(); }}>{rad ? 'Plegar' : 'Desplegar'}</button>
        <span className="mono small">{Math.round(eng.mech.radiatorDeploy * 100)} %</span>
      </div>
      <div className="mech-group">
        <span className="eyebrow">Brazo{!armOn && ' · sin potencia (RBT)'}</span>
        {([['stow', 'Estiba'], ['deploy', 'Despliegue'], ['inspect', 'Inspección']] as const).map(([p, l]) => <button key={p} className="btn" disabled={!armOn} onClick={() => eng.mech.setPose(p)}>{l}</button>)}
      </div>
      <div className="mech-group">
        <span className="eyebrow">Escotillas</span>
        {hatches.map((id) => <button key={id} className={'btn' + (isOpen(id) ? ' on' : '')} onClick={() => { m.toggleMech(id); eng.audio.hatch(isOpen(id)); onChange(); }}>{label[id] ?? id}</button>)}
      </div>
      <div className="mech-group">
        <span className="eyebrow">Cúpula · taquillas</span>
        <button className="btn" onClick={() => setAll(shutters, !shutters.some(isOpen))}>{shutters.some(isOpen) ? 'Cerrar' : 'Abrir'} contraventanas</button>
        <button className="btn" onClick={() => setAll(lockers, !lockers.some(isOpen))}>{lockers.some(isOpen) ? 'Cerrar' : 'Abrir'} taquillas ({lockers.length})</button>
      </div>
    </div>
  );
}

function Tree({ eng, root, sel, onChange, interiorReady }: { eng: Engine; root: PartNode; sel: PartNode | null; onChange: () => void; interiorReady: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['ALCION']));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sel) return;
    const s2 = new Set(open);
    let p = sel.parent;
    while (p) { s2.add(p.code); p = p.parent; }
    setOpen(s2);
    requestAnimationFrame(() => listRef.current?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' }));
  }, [sel]);
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const results = useMemo(() => {
    if (q.trim().length < 2) return null;
    const qq = norm(q);
    const out: PartNode[] = [];
    for (const n of eng.model.nodes.values()) { if (norm(n.label).includes(qq) || norm(n.code).includes(qq) || norm(n.desc).includes(qq)) out.push(n); if (out.length > 120) break; }
    return out;
  }, [q, eng.model.nodes.size, interiorReady]);
  const toggle = (c: string) => { const s2 = new Set(open); s2.has(c) ? s2.delete(c) : s2.add(c); setOpen(s2); };
  const rows: JSX.Element[] = [];
  const walk = (n: PartNode, lvl: number) => {
    const kids = n.children.length > 0, isOpen = open.has(n.code);
    rows.push(
      <div key={n.code} className={`row ${sel === n ? 'sel' : ''} ${n.hidden ? 'dim' : ''}`} style={{ paddingLeft: 8 + lvl * 14 }} onClick={() => eng.select(n)} onDoubleClick={() => eng.select(n, true)}>
        <button className="caret" aria-label={isOpen ? 'Contraer' : 'Expandir'} style={{ visibility: kids ? 'visible' : 'hidden' }} onClick={(e) => { e.stopPropagation(); toggle(n.code); }}>{isOpen ? '▾' : '▸'}</button>
        <span className="row-label">{n.label}</span>
        <span className="row-count mono">{n.parts > 1 ? n.parts : ''}</span>
        {n.depth > 0 && <button className="eye" aria-label={n.hidden ? 'Mostrar' : 'Ocultar'} onClick={(e) => { e.stopPropagation(); eng.model.setHidden(n, !n.hidden); onChange(); }}>{n.hidden ? '○' : '●'}</button>}
      </div>,
    );
    if (kids && isOpen) for (const c of n.children) walk(c, lvl + 1);
  };
  if (!results) walk(root, 0);
  return (
    <div className="tree">
      <div className="search"><input placeholder="Buscar componente, código o función…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar componentes" /></div>
      <div className="tree-list" ref={listRef}>
        {results ? (results.length ? results.map((n) => <div key={n.code} className={`row result ${sel === n ? 'sel' : ''}`} onClick={() => eng.select(n, true)}><span className="row-label">{n.label}</span><span className="row-code mono">{n.code}</span></div>) : <p className="empty">Sin coincidencias.</p>) : rows}
      </div>
      <div className="tree-foot mono">{eng.model.nodes.size} nodos · {root.parts} piezas · {eng.model.stats.batches} lotes{!interiorReady ? ' · interior cargando' : ''}</div>
    </div>
  );
}

function Info({ eng, n, onChange }: { eng: Engine; n: PartNode; onChange: () => void }) {
  const crumbs: PartNode[] = [];
  let p: PartNode | null = n;
  while (p) { crumbs.unshift(p); p = p.parent; }
  const size = n.box0.getSize(new THREE.Vector3());
  const [subEx, setSubEx] = useState(n.localEx);
  useEffect(() => setSubEx(n.localEx), [n]);
  return (
    <aside className="panel info-panel open">
      <div className="panel-head"><span className="eyebrow">{n.kind === 'part' ? 'Pieza' : n.depth === 1 ? 'Módulo' : n.depth === 2 ? 'Sistema' : 'Conjunto'} · nivel {n.depth}</span><button className="icon-btn sm" onClick={() => eng.select(null)} aria-label="Cerrar">×</button></div>
      <nav className="crumbs">{crumbs.map((c, i) => <span key={c.code}><button onClick={() => eng.select(c)} className={c === n ? 'cur' : ''}>{i === 0 ? 'Nave' : c.label}</button>{i < crumbs.length - 1 && <span className="sep">/</span>}</span>)}</nav>
      <h2 className="h2">{n.label}</h2>
      <p className="code mono">{n.code}</p>
      {n.desc && <p className="desc">{n.desc}</p>}
      {n.func && (<><p className="eyebrow mt">Función</p><p className="desc">{n.func}</p></>)}
      <dl className="kv mono">
        <dt>Envolvente (X·Y·Z)</dt><dd>{fmt(size.x, 2)} × {fmt(size.z, 2)} × {fmt(size.y, 2)} m</dd>
        <dt>Piezas contenidas</dt><dd>{n.parts}</dd>
        <dt>Triángulos</dt><dd>{Math.round(n.tris).toLocaleString('es-ES')}</dd>
        {n.mech && <><dt>Mecanismo</dt><dd>{n.mech.type === 'hinge' ? 'bisagra' : 'deslizadera'} · {n.mech.id}</dd></>}
      </dl>
      {n.children.length > 0 && (
        <div className="sub-explode">
          <p className="eyebrow mt">Explosión de este subsistema</p>
          <input type="range" min={0} max={1} step={0.01} value={subEx} onChange={(e) => { const v = parseFloat(e.target.value); setSubEx(v); n.localEx = v; eng.model.markDirty(); }} style={{ ['--p' as any]: subEx }} aria-label="Explosión del subsistema" />
        </div>
      )}
      {n.materials.length > 0 && (<><p className="eyebrow mt">Materiales representados</p><ul className="mats">{n.materials.slice(0, 10).map((mm) => <li key={mm.name}><span className={`sw ${mm.name}`} /> <span>{mm.desc || mm.name}</span></li>)}</ul></>)}
      <div className="actions">
        <button className="btn" onClick={() => eng.focus(n)}>Enfocar</button>
        <button className={`btn ${eng.model.isolate === n ? 'active' : ''}`} onClick={() => { eng.model.setIsolate(eng.model.isolate === n ? null : n); onChange(); }}>{eng.model.isolate === n ? 'Salir de aislamiento' : 'Aislar'}</button>
        <button className="btn" onClick={() => { eng.model.setHidden(n, true); eng.select(null); onChange(); }}>Ocultar</button>
        {n.mech && <button className="btn" onClick={() => { eng.model.toggleMech(n.mech!.id); onChange(); }}>Accionar mecanismo</button>}
        {n.parent && <button className="btn" onClick={() => eng.select(n.parent)}>Subir nivel</button>}
      </div>
      {n.children.length > 0 && (<><p className="eyebrow mt">Contiene</p><ul className="kids">{n.children.slice(0, 40).map((c) => <li key={c.code}><button onClick={() => eng.select(c, true)}>{c.label}</button><span className="mono muted">{c.parts > 1 ? c.parts : ''}</span></li>)}</ul></>)}
    </aside>
  );
}

const BLUEPRINTS = [['front', 'Vista frontal'], ['side', 'Vista lateral'], ['top', 'Vista superior'], ['bottom', 'Vista inferior'], ['rear', 'Vista posterior'], ['section_long', 'Sección longitudinal'], ['section_cross', 'Secciones transversales'], ['layout', 'Distribución interior'], ['systems', 'Arquitectura de sistemas'], ['assembly', 'Ensamblaje conceptual']];
function Plans() {
  const [cur, setCur] = useState('front');
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setZ({ s: 1, x: 0, y: 0 }), [cur]);
  return (
    <div className="sheet plans">
      <aside className="plans-nav">
        <p className="eyebrow">Planos conceptuales</p>
        {BLUEPRINTS.map(([id, l], i) => <button key={id} className={cur === id ? 'on' : ''} onClick={() => setCur(id)}><span className="mono">{String(i + 1).padStart(2, '0')}</span> {l}</button>)}
        <a className="btn ghost" href={`blueprints/${cur}.png`} download>Descargar PNG</a>
      </aside>
      <div className="plan-stage" onWheel={(e) => setZ((p) => ({ ...p, s: Math.min(6, Math.max(1, p.s * (e.deltaY < 0 ? 1.12 : 0.89))) }))}
        onPointerDown={(e) => { drag.current = { x: e.clientX - z.x, y: e.clientY - z.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setZ((p) => ({ ...p, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y })); }}
        onPointerUp={() => (drag.current = null)} onDoubleClick={() => setZ({ s: 1, x: 0, y: 0 })}>
        <img src={`blueprints/${cur}.png`} alt={cur} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
      </div>
    </div>
  );
}

function SpecSheet() {
  return (
    <div className="sheet spec">
      <div className="spec-inner">
        <header className="spec-head">
          <p className="eyebrow">{IDENTITY.maker} · Documento de concepto</p>
          <h1 className="display">{IDENTITY.name} <span className="desig">{IDENTITY.designation}</span></h1>
          <p className="lede">{IDENTITY.role}. {IDENTITY.etymology}</p>
          <p className="small muted">{IDENTITY.makerNote} Diseño conceptual: no es un vehículo certificado. Las cifras marcadas como hipótesis son estimaciones de orden de magnitud.</p>
        </header>
        <section className="spec-grid">{SPEC.map((b) => <div key={b.title} className="spec-block"><h3 className="h3">{b.title}</h3><dl>{b.rows.map((r) => <div key={r.k} className="spec-row"><dt>{r.k}</dt><dd className="mono">{r.v}</dd>{r.note && <span className={`tag ${r.note}`}>{r.note}</span>}</div>)}</dl></div>)}</section>
        <section className="profile"><h3 className="h2">Perfil de misión</h3><ol>{PROFILE.map((p) => <li key={p.h}><span className="mono t">{p.t}</span><div><strong>{p.h}</strong><p>{p.d}</p></div></li>)}</ol></section>
        <section className="philosophy"><h3 className="h2">Filosofía de diseño</h3><div className="phil-grid">{PHILOSOPHY.map((p, i) => <div key={p.h} className={i === 0 ? 'wide' : ''}><h4>{p.h}</h4><p>{p.d}</p></div>)}</div></section>
        <section className="sources"><h3 className="h2">Fuentes consultadas</h3><ul>{SOURCES.map((x) => <li key={x.u}><a href={x.u} target="_blank" rel="noreferrer">{x.t}</a></li>)}</ul></section>
      </div>
    </div>
  );
}

export { SWITCH_LABEL, SWITCH_ORDER };
