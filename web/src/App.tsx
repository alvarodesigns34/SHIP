import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Mode, Snapshot, WAYPOINTS, Quality, FlightCam } from './engine/Engine';
import type { DebugView } from './engine/render/Pipeline';
import type { PartNode, ExplodePreset } from './engine/ship/ShipModel';
import type { ArmPoseName } from './engine/ship/Mechanisms';
import { ROOMS } from './engine/interior/Interior';
import { MISSIONS } from './engine/Missions';
import { NEED_LABEL, type NeedId } from './engine/sim/Crew';
import { ACTION_LABELS, Action, DEFAULT_BINDINGS } from './engine/Input';
import { SWITCH_LABEL, SWITCH_ORDER } from './engine/ship/Systems';
import { IDENTITY, SPEC, PROFILE, PHILOSOPHY, SOURCES } from './data/spec';
import * as THREE from 'three';

type TreeNode = PartNode & { room?: string; isInterior?: boolean; source?: 'ext' | 'int' };
type TreeScope = 'all' | 'ext' | 'int';
type PhotoGrid = 'none' | 'thirds' | 'cross';

const MODES: { id: Mode; label: string; key: string }[] = [
  { id: 'CINEMATIC', label: 'Cinemático', key: '1' },
  { id: 'FLIGHT', label: 'Vuelo', key: '2' },
  { id: 'INTERIOR', label: 'Interior', key: '3' },
  { id: 'EVA', label: 'EVA', key: '4' },
  { id: 'ENGINEERING', label: 'Ingeniería', key: '5' },
  { id: 'MISSIONS', label: 'Misiones', key: '6' },
  { id: 'SANDBOX', label: 'Sandbox', key: '7' },
];

const ARM_PRESETS: [ArmPoseName, string][] = [
  ['estiba', 'Estiba'],
  ['observacion', 'Observación'],
  ['captura', 'Captura'],
  ['servicio', 'Servicio'],
];

const fmt = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const touchDevice = () => matchMedia('(pointer: coarse)').matches;

const ROOM_NAME_BY_CODE: Record<string, string> = {
  A: 'Bahía A · Cabina de vuelo',
  B: 'Bahía B · Laboratorio',
  C: 'Bahía C · Habitáculos',
  D: 'Bahía D · Servicios',
  N: 'Nodo · Cúpula y Esclusa',
};

function isInteriorNode(n: TreeNode): boolean {
  return n.sector === 'int' || n.isInterior === true || n.source === 'int' || n.code.startsWith('HAB.INT') || n.code.startsWith('FWD.INT');
}

function roomLabelOf(n: TreeNode): string | null {
  if (n.room) {
    if (ROOM_NAME_BY_CODE[n.room]) return ROOM_NAME_BY_CODE[n.room];
    if (ROOMS[n.room]?.label) return ROOMS[n.room].label;
    return n.room;
  }
  const m = n.code.match(/^HAB\.INT\.([ABCDN])\b/);
  if (m && ROOM_NAME_BY_CODE[m[1]]) return ROOM_NAME_BY_CODE[m[1]];
  if (n.code.startsWith('FWD.INT') || n.code.startsWith('FWD.ALK')) return ROOM_NAME_BY_CODE.N;
  return null;
}

function scenarioContext(s: Snapshot): string {
  if (s.scenario === 'lunar') return `Órbita lunar · ${fmt(s.altKm, 0)} km`;
  if (s.scenario === 'eclipse') return `Eclipse · ${s.body} ${fmt(s.altKm, 0)} km`;
  const sun = s.eclipse > 0.5 ? ' · Sombra' : '';
  return `Órbita terrestre · ${fmt(s.altKm, 0)} km${sun}`;
}

function collectNodes(root: TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  if (!root) return out;
  const seen = new Set<string>();
  const walk = (n: TreeNode) => {
    if (seen.has(n.code)) return;
    seen.add(n.code);
    out.push(n);
    if (Array.isArray(n.children)) {
      for (const c of n.children as TreeNode[]) walk(c);
    }
  };
  walk(root);
  return out;
}

const TUTORIAL_TOUCH: Partial<Record<Mode, string[]>> = {
  INTERIOR: ['Palanca izquierda para moverte · arrastra en la mitad derecha para mirar', 'Apunta con el centro de la pantalla: si un objeto es interactivo aparece su acción · «Usar»', '☰ abre destinos, desplazamiento y ajustes'],
  FLIGHT: ['Palanca izquierda: traslación · arrastra a la derecha para girar', '▲▼ subir y bajar · «Freno» detiene la nave'],
  ENGINEERING: ['Toca una pieza para seleccionarla · pellizca para acercar', 'El deslizador inferior separa la nave por niveles'],
};
const TUTORIAL: Partial<Record<Mode, string[]>> = {
  INTERIOR: ['Haz clic para mirar con el ratón · WASD para moverte · Mayús para correr · Ctrl para agacharte', 'Apunta a un objeto: si es interactivo aparece su acción bajo el punto de mira · G o clic para usarla', 'Siéntate en un asiento de la cabina para pilotar · Esc abre el menú (destinos, desplazamiento, ajustes)'],
  FLIGHT: ['W/S avanzar/retroceder · A/D lateral · R/F subir/bajar (RCS)', 'Flechas o I/J/K/L: cabeceo y guiñada · Q/E: alabeo', 'X/Z: empuje principal · T: asistido/manual · B: frenado asistido', 'C: cambiar cámara · clic: capturar ratón · Mayús+P: modo foto · P: foto rápida · H: ocultar HUD'],
  EVA: ['WASD + Espacio/Ctrl: propulsores del equipo de maniobra · Mayús: impulso', 'G: interactuar (reparaciones: mantener) · V: agarrarse a un pasamanos', 'Vuelve a la escotilla de la esclusa para entrar'],
  ENGINEERING: ['Clic: seleccionar pieza (segundo clic: subir de nivel) · doble clic en el árbol: enfocar', 'F enfocar · I aislar · H ocultar · X rayos X · E explosionar'],
  SANDBOX: ['Pulsos de luz ficticios contra dianas holográficas · N o clic derecho: disparar pulso', 'Pilota como en el modo Vuelo; las rachas multiplican la puntuación'],
};

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const [eng, setEng] = useState<Engine | null>(null);
  const [s, setS] = useState<Snapshot | null>(null);
  const [sel, setSel] = useState<TreeNode | null>(null);
  const [settings, setSettings] = useState(false);
  const [paused, setPaused] = useState(false);
  const [perf, setPerf] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [sub, setSub] = useState<'inspector' | 'plans' | 'spec'>('inspector');
  const [tutorialOff, setTutorialOff] = useState(() => localStorage.getItem('alcion-tut-off') === '1');
  const [tutSeen, setTutSeen] = useState<Record<string, boolean>>({});
  const [armOpen, setArmOpen] = useState(false);
  const [, force] = useState(0);

  const photoModeRef = useRef(false);
  const settingsRef = useRef(false);
  const pausedRef = useRef(false);
  const armOpenRef = useRef(false);
  photoModeRef.current = photoMode;
  settingsRef.current = settings;
  pausedRef.current = paused;
  armOpenRef.current = armOpen;

  const prevFovRef = useRef<number>(50);
  const prevFlightCamRef = useRef<FlightCam | null>(null);
  const prevControlsRef = useRef<boolean | null>(null);
  const prevTimeScaleRef = useRef<number>(60);

  const enterPhotoMode = useCallback((e: Engine) => {
    prevFovRef.current = e.camera.fov;
    prevFlightCamRef.current = e.flightCam;
    prevControlsRef.current = e.controls.enabled;
    prevTimeScaleRef.current = e.crew.timeScale;
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* */ }
    }
    setSettings(false);
    setPaused(false);
    setPhotoMode(true);
  }, []);

  const exitPhotoMode = useCallback((e: Engine) => {
    const restoreFov = e.mode === 'INTERIOR' || e.seated ? e.fovPref : prevFovRef.current;
    e.camera.fov = restoreFov;
    e.camera.updateProjectionMatrix();
    if (prevFlightCamRef.current && (e.mode === 'FLIGHT' || e.mode === 'SANDBOX') && !e.seated) {
      e.flightCam = prevFlightCamRef.current;
    }
    if (prevControlsRef.current !== null && e.mode === 'CINEMATIC') {
      e.controls.enabled = prevControlsRef.current;
    }
    e.crew.timeScale = prevTimeScaleRef.current || 60;
    (e as any).setPhotoPaused?.(false);
    (e as any).setPhotoFreeCam?.(false);
    setPhotoMode(false);
    e.emitSnap();
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const e = new Engine(host.current);
    (window as any).__engine = e;
    e.onSelect = (n) => setSel(n as TreeNode | null);
    e.missions.onChange = () => force((x) => x + 1);
    const st = e.loadSettings();
    if (st) { e.audio.setVolume(st.volume ?? 0.7); e.audio.mode = st.sound ?? 'realista'; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) e.reducedMotion = true;
    let last = '';
    const unsub = e.subscribe((snap) => {
      const metKey = e.crew.metText();
      const sevKey = e.systems.status({ airlock: snap.airlock, dockClosing: snap.dock && snap.dock.range < 150 ? snap.dock.closing : undefined }).code;
      const swKey = Object.values(snap.systems.sw).map((v) => (v ? '1' : '0')).join('');
      const key = JSON.stringify([
        snap.mode, snap.flightCam, snap.prompt, snap.toast, snap.room, snap.seated, snap.hudHidden, snap.ready, snap.interiorReady,
        snap.activity?.p.toFixed(2), snap.explode.toFixed(3), snap.explodePreset, snap.mission?.step, snap.alerts.length,
        metKey, sevKey, swKey, snap.locomotion, snap.crouch, snap.stats.fps, Math.round(snap.speed * 20), Math.round(snap.throttle * 50),
        snap.dock?.range.toFixed(1), snap.dock?.closing.toFixed(2), snap.docked, snap.xray, snap.section,
        snap.progress.p.toFixed(2), snap.fade.toFixed(2), snap.airlock, snap.systems.booted, snap.scenario, snap.debug,
        snap.assist, snap.armGrabbed, e.mech.activePose,
      ]);
      if (key !== last || (window as any).__perfOpen) { last = key; setS(snap); }
    });
    setEng(e);
    e.load();

    // Fase de captura para interceptar Shift+P (Modo Foto) sin disparar KeyP (foto rápida / misiones)
    const onKeyCapture = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.input.listening) return;

      if (ev.shiftKey && ev.code === 'KeyP') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (photoModeRef.current) exitPhotoMode(e);
        else enterPhotoMode(e);
        return;
      }

      if (ev.key === 'Escape') {
        if (photoModeRef.current) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          exitPhotoMode(e);
          return;
        }
        if (settingsRef.current) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          setSettings(false);
          return;
        }
        if (e.inspect) {
          ev.preventDefault();
          e.inspect = null;
          e.emitSnap();
          return;
        }
        if (armOpenRef.current) {
          ev.preventDefault();
          setArmOpen(false);
          return;
        }
        if (pausedRef.current) {
          ev.preventDefault();
          setPaused(false);
          return;
        }
        if (e.mode === 'ENGINEERING') {
          e.select(null);
          e.model.setIsolate(null);
          setSel(null);
        }
        return;
      }

      if (photoModeRef.current) return;

      const m = MODES.find((x) => x.key === ev.key);
      if (m && (ev.altKey || e.mode === 'ENGINEERING' || e.mode === 'CINEMATIC' || e.mode === 'MISSIONS')) {
        e.setMode(m.id);
        ev.preventDefault();
      }
      if (ev.code === 'Backquote') {
        setPerf((v) => { (window as any).__perfOpen = !v; return !v; });
      }
    };

    const onBlur = () => { for (const k of Object.keys(e.input.touch)) (e.input.touch as any)[k] = 0; };
    const onLock = () => {
      const fp = e.mode === 'INTERIOR' || e.seated || e.mode === 'EVA';
      if (!document.pointerLockElement && fp && !matchMedia('(pointer: coarse)').matches && !photoModeRef.current) setPaused(true);
      if (document.pointerLockElement) setPaused(false);
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      document.removeEventListener('pointerlockchange', onLock);
      e.dispose();
    };
  }, [enterPhotoMode, exitPhotoMode]);

  if (!eng) return <div className="app"><div className="viewport" ref={host} /></div>;
  const mode = s?.mode ?? 'CINEMATIC';
  const hud = !s?.hudHidden && !photoMode;
  const fp = mode === 'INTERIOR' || !!s?.seated || mode === 'EVA';
  const tut = !tutorialOff && TUTORIAL[mode] && !tutSeen[mode] && s?.ready && !paused && !photoMode && hud;
  const resume = () => { setPaused(false); eng.input.lock(); };

  const selectNode = (n: TreeNode | null, focus = false) => {
    if (!n) { eng.select(null); setSel(null); return; }
    if (typeof (eng as any).selectCode === 'function') {
      (eng as any).selectCode(n.code, focus);
      setSel(n);
    } else if (eng.model.nodes.has(n.code)) {
      eng.select(n, focus);
    } else {
      setSel(n);
    }
  };

  return (
    <div className={`app mode-${mode.toLowerCase()} ${hud ? '' : 'hud-hidden'} ${fp ? 'fp' : ''} ${photoMode ? 'photo-mode-active' : ''} ${eng.reducedMotion ? 'reduced-motion' : ''}`}>
      <div className="viewport" ref={host} />
      {(!s || !s.ready) && <Loader stage={s?.progress.stage ?? 'Iniciando'} p={s?.progress.p ?? 0} />}
      {s?.ready && (
        <>
          {hud && (
            <Dock
              s={s}
              eng={eng}
              onSettings={() => setSettings(true)}
              onPhotoMode={() => enterPhotoMode(eng)}
              compact={fp}
            />
          )}
          {mode === 'CINEMATIC' && hud && <Home s={s} eng={eng} />}
          {(mode === 'FLIGHT' || mode === 'SANDBOX') && hud && (
            <FlightHUD s={s} eng={eng} armOpen={armOpen} onArm={() => setArmOpen((v) => !v)} />
          )}
          {mode === 'INTERIOR' && hud && <InteriorHUD s={s} eng={eng} />}
          {mode === 'EVA' && hud && <EvaHUD s={s} />}
          {mode === 'ENGINEERING' && hud && (
            <>
              <div className="subtabs" role="tablist" aria-label="Vistas de ingeniería">
                {([['inspector', 'Inspector'], ['plans', 'Planos'], ['spec', 'Ficha']] as const).map(([id, l]) => (
                  <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{l}</button>
                ))}
              </div>
              {sub === 'inspector' && <Engineering eng={eng} s={s} sel={sel} onSelectNode={selectNode} />}
              {sub === 'plans' && <Plans />}
              {sub === 'spec' && <SpecSheet />}
            </>
          )}
          {mode === 'MISSIONS' && hud && <MissionsPanel eng={eng} s={s} />}
          {armOpen && (mode === 'FLIGHT' || mode === 'SANDBOX') && hud && <ArmPanel eng={eng} s={s} onClose={() => setArmOpen(false)} />}
          {s.mission && mode !== 'MISSIONS' && hud && <MissionCard s={s} eng={eng} />}
          {s.inspect && hud && <InspectCard s={s} eng={eng} />}
          {touchDevice() && (mode === 'FLIGHT' || mode === 'SANDBOX' || mode === 'INTERIOR' || mode === 'EVA') && hud && (
            <TouchControls eng={eng} mode={mode} onMenu={() => setPaused(true)} />
          )}
          {hud && <Alerts s={s} />}
          {s.toast && hud && <div className="toast" role="status" aria-live="polite">{s.toast}</div>}
          {perf && !photoMode && <PerfOverlay s={s} eng={eng} />}
          {photoMode && (
            <PhotoMode
              eng={eng}
              s={s}
              initialFov={prevFovRef.current}
              onExit={() => exitPhotoMode(eng)}
            />
          )}
          {tut && (
            <div className="tutorial" role="dialog" aria-modal="false" aria-label="Primeros pasos">
              <p className="eyebrow">Primeros pasos · {MODES.find((m) => m.id === mode)?.label}</p>
              <ul>{((touchDevice() ? TUTORIAL_TOUCH[mode] : null) ?? TUTORIAL[mode]!).map((t) => <li key={t}>{t}</li>)}</ul>
              <div className="row-btns">
                <button className="btn primary" onClick={() => setTutSeen({ ...tutSeen, [mode]: true })}>Entendido</button>
                <button className="btn ghost" onClick={() => { setTutorialOff(true); localStorage.setItem('alcion-tut-off', '1'); }}>No volver a mostrar</button>
              </div>
            </div>
          )}
          {paused && fp && !photoMode && (
            <PauseMenu s={s} eng={eng} onResume={resume} onSettings={() => setSettings(true)} onClose={() => setPaused(false)} />
          )}
          {settings && <Settings eng={eng} s={s} onClose={() => setSettings(false)} onChanged={() => force((x) => x + 1)} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- comunes
function Loader({ stage, p }: { stage: string; p: number }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader-inner">
        <p className="eyebrow">Varro-Lindqvist Astronautics · Designación conceptual</p>
        <h1 className="display">ALCIÓN <span className="desig">HX-4</span></h1>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ transform: `scaleX(${Math.max(0.02, p)})` }} />
        </div>
        <p className="mono small muted">{stage} · {Math.round(p * 100)} %</p>
      </div>
    </div>
  );
}

const ICONS: Record<string, JSX.Element> = {
  CINEMATIC: <path d="M3 17l5-6 4 4 3-3 6 5M3 6h18" />,
  FLIGHT: <path d="M12 3l3 7 6 2-6 2-3 7-3-7-6-2 6-2z" />,
  INTERIOR: <path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />,
  EVA: <><circle cx="12" cy="9" r="5" /><path d="M5 21c1-4 4-6 7-6s6 2 7 6" /></>,
  ENGINEERING: <path d="M4 7h16M4 12h10M4 17h16M17 10v4" />,
  MISSIONS: <path d="M6 21V4M6 4h11l-2 4 2 4H6" />,
  SANDBOX: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
};
const Icon = ({ id }: { id: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[id]}
  </svg>
);

function Dock({ s, eng, onSettings, onPhotoMode, compact }: { s: Snapshot; eng: Engine; onSettings: () => void; onPhotoMode: () => void; compact: boolean }) {
  const full = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* */ }
  };
  return (
    <header className={`dock ${compact ? 'compact' : ''}`}>
      <div className="brand" aria-label="ALCIÓN HX-4">
        <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <path d="M5 21 L16 8 L27 21" stroke="var(--accent)" strokeWidth="2.6" fill="none" />
          <path d="M10 25 H22" stroke="var(--ink)" strokeWidth="2" />
        </svg>
        <span className="brand-name">ALCIÓN</span>
      </div>
      <nav className="modes" role="tablist" aria-label="Modos de experiencia">
        {MODES.filter((m) => m.id !== 'EVA' || s.eva).map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={s.mode === m.id}
            className={s.mode === m.id ? 'on' : ''}
            title={`${m.label} · Alt+${m.key}`}
            aria-label={m.label}
            onClick={() => eng.setMode(m.id)}
          >
            <Icon id={m.id} /><span>{m.label}</span>
          </button>
        ))}
      </nav>
      <div className="dock-tools">
        <button className="icon-btn" title="Modo Foto (Mayús+P) · Captura rápida (P)" aria-label="Modo Foto" onClick={onPhotoMode}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.5-2h5L16 7" />
          </svg>
        </button>
        <button className="icon-btn hide-sm" title="Ocultar interfaz (H)" aria-label="Ocultar interfaz" onClick={() => { eng.hudHidden = true; eng.emitSnap(); }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path d="M4 20L20 4" />
          </svg>
        </button>
        <button className="icon-btn hide-sm" title="Pantalla completa" aria-label="Pantalla completa" onClick={full}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
        <button className="icon-btn" title="Ajustes" aria-label="Ajustes" onClick={onSettings}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function Alerts({ s }: { s: Snapshot }) {
  const a = s.alerts.filter((x) => x.level !== 'info').slice(0, 2);
  if (!a.length) return null;
  return (
    <div className="alerts" role="alert" aria-live="assertive">
      {a.map((x, i) => <div key={i} className={`alert ${x.level}`}><i aria-hidden="true" />{x.text}</div>)}
    </div>
  );
}

function PerfOverlay({ s, eng }: { s: Snapshot; eng: Engine }) {
  const st = s.stats;
  const views: [DebugView, string][] = [
    ['none', 'Final'],
    ['far', 'Sólo astro'],
    ['near', 'Sólo nave'],
    ['nopost', 'Sin post'],
    ['ao', 'AO'],
    ['bloom', 'Bloom'],
    ['luma', 'Exposición'],
  ];
  return (
    <div className="perf mono" aria-label="Panel de rendimiento">
      <p>{st.fps} fps · p50 {fmt(st.p50, 1)} · p95 {fmt(st.p95, 1)} · p99 {fmt(st.p99, 1)} ms</p>
      <p>CPU {fmt(st.cpu, 1)} ms · GPU {st.gpu < 0 ? 'n/d' : fmt(st.gpu, 2) + ' ms'} · sim {fmt(st.passes.sim, 2)} · UI {fmt(st.passes.ui, 2)} ms</p>
      <p>{st.calls} llamadas · {Math.round(st.tris / 1000)} k tri · DPR {fmt(st.dpr, 2)} · {st.batches} lotes / {st.instances} inst</p>
      <p>astro {fmt(st.passes.far, 2)} · nave {fmt(st.passes.near, 2)} · AO {fmt(st.passes.ao, 2)} · autoExp {fmt(st.passes.autoExp, 2)} ms</p>
      <p>bloom {fmt(st.passes.bloom, 2)} · final {fmt(st.passes.final, 2)} · AA {fmt(st.passes.aa, 2)} · cams {fmt(st.passes.cams, 2)} ms</p>
      <p>matrices {st.matrixWrites} · geo {st.mem.geo} · tex {st.mem.tex} · prog {st.mem.progs}</p>
      <div className="row-btns">
        {views.map(([v, l]) => (
          <button key={v} className={`btn xs ${s.debug === v ? 'active' : 'ghost'}`} onClick={() => { eng.debug = v; eng.emitSnap(); }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modo foto
function PhotoMode({ eng, s, initialFov, onExit }: { eng: Engine; s: Snapshot; initialFov: number; onExit: () => void }) {
  const [grid, setGrid] = useState<PhotoGrid>('thirds');
  const [fov, setFov] = useState<number>(() => Math.round(Math.min(90, Math.max(28, eng.camera.fov))));
  const [collapsed, setCollapsed] = useState(false);
  const [freeCam, setFreeCam] = useState(() => eng.flightCam === 'free');
  const [visualPaused, setVisualPaused] = useState(false);
  const [flash, setFlash] = useState(false);
  const freezeRef = useRef<HTMLCanvasElement>(null);

  const applyFov = (v: number) => {
    const clamped = Math.min(90, Math.max(28, v));
    setFov(clamped);
    eng.camera.fov = clamped;
    eng.camera.updateProjectionMatrix();
  };

  const toggleFreeCam = () => {
    const next = !freeCam;
    setFreeCam(next);
    if (typeof (eng as any).setPhotoFreeCam === 'function') {
      (eng as any).setPhotoFreeCam(next);
      return;
    }
    if ((eng.mode === 'FLIGHT' || eng.mode === 'SANDBOX') && !eng.seated) {
      if (next) {
        eng.flightCam = 'free';
        (eng as any).freeCam?.pos?.copy(eng.camera.position);
      } else {
        eng.flightCam = 'orbit';
      }
      eng.emitSnap();
    } else if (eng.mode === 'CINEMATIC') {
      eng.controls.enabled = next;
      if (next) eng.controls.target.set(3, 0, 0);
    }
  };

  const toggleVisualPause = () => {
    const next = !visualPaused;
    if (typeof (eng as any).setPhotoPaused === 'function') {
      (eng as any).setPhotoPaused(next);
      setVisualPaused(next);
      return;
    }
    if (next) {
      eng.crew.timeScale = 0;
      setVisualPaused(true);
      requestAnimationFrame(() => {
        const cv = freezeRef.current;
        if (!cv) return;
        try { (eng as any).renderFrame?.(); } catch { /* */ }
        const src = eng.renderer.domElement;
        cv.width = src.width;
        cv.height = src.height;
        const ctx = cv.getContext('2d');
        if (ctx) ctx.drawImage(src, 0, 0);
      });
    } else {
      eng.crew.timeScale = 60;
      setVisualPaused(false);
    }
  };

  const capturePng = () => {
    eng.audio.shutter();
    if (!eng.reducedMotion) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 160);
    }
    const downloadFromCanvas = (canvas: HTMLCanvasElement) => {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const saveUrl = (url: string, revoke: boolean) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `alcion_hx4_${ts}.png`;
        a.click();
        if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      };
      canvas.toBlob((blob) => {
        if (blob) saveUrl(URL.createObjectURL(blob), true);
        else {
          try { saveUrl(canvas.toDataURL('image/png'), false); } catch { /* */ }
        }
      }, 'image/png');
    };

    if (visualPaused && freezeRef.current && freezeRef.current.width > 0) {
      downloadFromCanvas(freezeRef.current);
      return;
    }
    try { (eng as any).renderFrame?.(); } catch { /* */ }
    downloadFromCanvas(eng.renderer.domElement);
  };

  const eqMm = Math.round(24 / (2 * Math.tan((fov * Math.PI) / 360)) * 1.5);

  return (
    <div className="photo-mode" aria-label="Modo Foto">
      {visualPaused && <canvas ref={freezeRef} className="photo-freeze" aria-hidden="true" />}
      {grid === 'thirds' && (
        <div className="photo-grid thirds" aria-hidden="true">
          <i className="v1" /><i className="v2" /><i className="h1" /><i className="h2" />
        </div>
      )}
      {grid === 'cross' && (
        <div className="photo-grid cross" aria-hidden="true">
          <i className="vc" /><i className="hc" /><span className="center-box" />
        </div>
      )}
      {flash && <div className="photo-flash" aria-hidden="true" />}

      <div className={`photo-bar ${collapsed ? 'collapsed' : ''}`} role="region" aria-label="Controles de cámara">
        <div className="photo-bar-head">
          <span className="eyebrow">Modo Foto · {s.body} · {fmt(s.altKm, 0)} km</span>
          <div className="photo-bar-head-actions">
            <button
              className="btn xs ghost"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Desplegar controles de foto' : 'Replegar controles de foto'}
            >
              {collapsed ? 'Controles ▴' : 'Replegar ▾'}
            </button>
            <button className="btn xs ghost" onClick={onExit} aria-label="Salir de Modo Foto (Esc)">Salir (Esc)</button>
          </div>
        </div>
        {!collapsed && (
          <div className="photo-bar-body">
            <div className="photo-group">
              <span className="eyebrow">Encuadre</span>
              <div className="seg" role="group" aria-label="Rejilla de encuadre">
                {([['none', 'Sin rejilla'], ['thirds', 'Tercios'], ['cross', 'Cruz']] as [PhotoGrid, string][]).map(([id, lbl]) => (
                  <button key={id} className={grid === id ? 'on' : ''} aria-pressed={grid === id} onClick={() => setGrid(id)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="photo-group photo-fov">
              <label htmlFor="photo-fov-slider">
                <span className="photo-fov-head">
                  <span className="eyebrow">Óptica · FOV</span>
                  <span className="mono small">{fov}° · ~{eqMm} mm</span>
                </span>
                <input
                  id="photo-fov-slider"
                  type="range"
                  min={28}
                  max={90}
                  step={1}
                  value={fov}
                  disabled={visualPaused}
                  onChange={(e) => applyFov(parseFloat(e.target.value))}
                />
              </label>
              <button className="btn xs ghost" disabled={visualPaused} onClick={() => applyFov(Math.round(initialFov))}>Restablecer</button>
            </div>
            <div className="photo-actions">
              <button className={`btn sm ${freeCam ? 'active' : 'ghost'}`} aria-pressed={freeCam} onClick={toggleFreeCam}>
                Cámara libre
              </button>
              <button className={`btn sm ${visualPaused ? 'active' : 'ghost'}`} aria-pressed={visualPaused} onClick={toggleVisualPause}>
                {visualPaused ? 'Reanudar' : 'Pausa visual'}
              </button>
              <button className="btn primary sm" onClick={capturePng}>
                Capturar PNG
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- portada cinematográfica
function Home({ s, eng }: { s: Snapshot; eng: Engine }) {
  const specs: [string, string][] = [
    ['Eslora', '19,6 m'],
    ['Volumen', '150 m³'],
    ['Tripulación', '4'],
    ['Autonomía', '45 d'],
  ];
  const secondary: { t: string; d: string; k: string; go: () => void }[] = [
    { t: 'Vuelo orbital', d: 'Pilotaje 6-GDL asistido o newtoniano y atraque IDSS.', k: '02', go: () => eng.setMode('FLIGHT') },
    { t: 'Ingeniería', d: 'Explosión por subsistemas, corte y árbol completo.', k: '03', go: () => eng.setMode('ENGINEERING') },
    { t: 'Misiones', d: 'Arranque en frío, atraque, brazo robótico y EVA.', k: '04', go: () => eng.setMode('MISSIONS') },
  ];
  return (
    <main className="home" aria-label="Portada ALCIÓN HX-4">
      <div className="home-hero">
        <div className="home-title">
          <p className="eyebrow home-brand">VARRO-LINDQVIST ASTRONAUTICS · DESIGNACIÓN CONCEPTUAL</p>
          <h1 className="display">ALCIÓN <span className="desig">HX-4</span></h1>
          <p className="lede">Vehículo orbital civil de ciencia y servicio. Recorre cada estancia, enciende la cabina y llévala tú.</p>
          <dl className="home-specs" aria-label="Ficha técnica resumida">
            {specs.map(([k, v]) => (
              <div key={k} className="home-spec-cell">
                <dt>{k}</dt>
                <dd className="mono">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <nav className="home-actions" aria-label="Experiencias principales">
          <button
            className="home-cta"
            onClick={() => eng.enterInterior('cabina')}
            disabled={!s.interiorReady}
          >
            <span className="home-cta-top">
              <span className="mono k">01</span>
              <span className="t">Subir a bordo{!s.interiorReady && <em> · cargando</em>}</span>
              <span className="arrow" aria-hidden="true">→</span>
            </span>
            <span className="d">Recorre cabina, laboratorio, habitáculos y nodo. Siéntate a los mandos.</span>
          </button>
          <div className="home-secondary">
            {secondary.map((it) => (
              <button key={it.k} className="home-item" onClick={it.go}>
                <span className="mono k">{it.k}</span>
                <span className="t">{it.t}</span>
                <span className="d">{it.d}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <footer className="home-telemetry mono small" aria-label="Telemetría orbital en vivo">
        <span>{scenarioContext(s)}</span>
        <span className="sep" aria-hidden="true">·</span>
        <span>V<sub>orb</sub> {fmt(s.orbit.vOrbKmS, 2)} km/s</span>
        <span className="sep" aria-hidden="true">·</span>
        <span>{s.eclipse > 0.5 ? 'En sombra orbital' : 'Iluminación solar'}</span>
        <span className="sep hide-sm" aria-hidden="true">·</span>
        <span className="hide-sm">{eng.crew.metText()} · {eng.crew.utcText()}</span>
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------- pausa (primera persona)
function PauseMenu({ s, eng, onResume, onSettings, onClose }: { s: Snapshot; eng: Engine; onResume: () => void; onSettings: () => void; onClose: () => void }) {
  const walk = s.locomotion === 'walk';
  return (
    <div className="pause" role="dialog" aria-modal="true" aria-labelledby="pause-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pause-inner">
        <div className="panel-head pause-head">
          <div>
            <p className="eyebrow" id="pause-title">{s.room || 'A bordo'} · {eng.crew.metText()}</p>
            <p className="mono small muted">{eng.crew.utcText()} · {scenarioContext(s)}</p>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar pausa">×</button>
        </div>
        <button className="btn primary lg" onClick={onResume} autoFocus>Continuar</button>
        <section>
          <h3 className="h3">Ir a</h3>
          <div className="dest">
            {Object.entries(WAYPOINTS).map(([id, w]) => (
              <button key={id} className="btn" onClick={() => { eng.enterInterior(id); onResume(); }}>{w.label}</button>
            ))}
          </div>
          <p className="small muted">Accesos rápidos opcionales: también puedes recorrer la nave caminando.</p>
        </section>
        <section>
          <h3 className="h3">Desplazamiento</h3>
          <div className="seg">
            <button className={walk ? 'on' : ''} onClick={() => eng.setLocomotion('walk')}>Caminar · 1 g</button>
            <button className={!walk ? 'on' : ''} onClick={() => eng.setLocomotion('float')}>Flotar · microgravedad</button>
          </div>
          <p className="small muted">«Caminar» es una licencia de juego: en órbita la tripulación flota.</p>
        </section>
        <section>
          <h3 className="h3">Tripulante</h3>
          <div className="needs">
            {(Object.entries(s.crew.needs) as [NeedId, number][]).map(([k, v]) => (
              <div key={k} className={'need' + (v < 25 ? ' low' : '')}>
                <span className="small">{NEED_LABEL[k]}</span>
                <div className="hbar"><div style={{ width: `${v}%` }} /></div>
                <span className="mono small">{Math.round(v)}</span>
              </div>
            ))}
          </div>
          <label className="chk">
            <input type="checkbox" checked={s.crew.freeExplore} onChange={(e) => eng.setFreeExplore(e.target.checked)} />
            Exploración libre (necesidades en pausa)
          </label>
        </section>
        <div className="row-btns">
          <button className="btn ghost" onClick={onSettings}>Ajustes</button>
          <button className="btn ghost" onClick={() => { onClose(); eng.setMode('CINEMATIC'); }}>Salir al exterior</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- HUD de vuelo contextual
function FlightHUD({ s, eng, armOpen, onArm }: { s: Snapshot; eng: Engine; armOpen: boolean; onArm: () => void }) {
  const [vx, vy, vz] = s.vel;
  const dockNear = !!s.dock && s.dock.range < 150;
  const sysStatus = eng.systems.status({
    airlock: s.airlock,
    dockClosing: dockNear ? s.dock!.closing : undefined,
  });

  const cycleCam = () => {
    if (s.seated) return;
    const order: FlightCam[] = ['chase', 'orbit', 'free'];
    eng.flightCam = order[(order.indexOf(eng.flightCam) + 1) % order.length];
    if (eng.flightCam === 'free') (eng as any).freeCam?.pos?.copy(eng.camera.position);
    eng.emitSnap();
  };

  const dockRateClass = s.dock
    ? s.dock.closing > 0.40 ? 'crit' : s.dock.closing > 0.25 ? 'warn' : 'ok'
    : '';
  const dockAligned = !!s.dock && s.dock.angle < 6 && s.dock.closing <= 0.25 && Math.abs(s.dock.lat) < 0.35 && Math.abs(s.dock.vert) < 0.35;

  return (
    <div className="hud flight-hud">
      <div className="reticle" aria-hidden="true"><i /><i /><i /><i /></div>

      {/* Franja superior contextual: estado de severidad + escenario + reloj maestro unificado */}
      <div className={`flight-strip sev-${sysStatus.severity}`} role="status" aria-label="Estado del vehículo y reloj de misión">
        <span className={`sev-badge sev-${sysStatus.severity}`}>
          <i aria-hidden="true" />
          <strong className="mono">{sysStatus.code}</strong>
          <span className="sev-label">{sysStatus.label}{sysStatus.active.length > 1 ? ` (+${sysStatus.active.length - 1})` : ''}</span>
        </span>
        <span className="strip-div" aria-hidden="true" />
        <span className="mono strip-scenario">{scenarioContext(s)}</span>
        <span className="strip-div hide-sm" aria-hidden="true" />
        <span className="mono strip-clock">{eng.crew.metText()} <span className="muted">· {eng.crew.utcText()}</span></span>
      </div>

      <div className="hud-left">
        <div className="hud-block">
          <p className="eyebrow">Velocidad relativa</p>
          <p className="big mono">{fmt(s.speed, 2)}<small>m/s</small></p>
          <p className="mono small">X {fmt(vx, 2)} · Y {fmt(vy, 2)} · Z {fmt(vz, 2)}</p>
          <p className="mono small muted">ω {fmt(s.w * 57.3, 2)} °/s</p>
        </div>
        <div className="hud-block thrust-block">
          <div className="thrust-row">
            <div className="vbar" aria-label={`Empuje principal ${Math.round(s.throttle * 100)} por ciento`}>
              <div style={{ height: `${s.throttle * 100}%` }} />
            </div>
            <div className="thrust-meta">
              <p className="eyebrow">Empuje principal</p>
              <p className="mono big">{Math.round(s.throttle * 100)}<small>%</small></p>
              <p className="mono small muted">Escala ×{s.thrustScale}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="hud-right">
        <div className="hud-block">
          <p className="eyebrow">{s.body} · {fmt(s.altKm, 0)} km</p>
          <p className="mono small">V<sub>orb</sub> {fmt(s.orbit.vOrbKmS, 2)} km/s · T {fmt(s.orbit.periodMin, 1)} min</p>
          <p className="mono small muted">APO {fmt(s.orbit.apogeeKm, 0)} · PER {fmt(s.orbit.perigeeKm, 0)} km · INC {fmt(s.orbit.inclinationDeg, 1)}°</p>
          {s.targets.map((t) => (
            <p key={t.label} className="mono small target-row">
              <span>{t.label}</span>
              <span>
                {t.range < 1000 ? `${fmt(t.range, 0)} m` : `${fmt(t.range / 1000, 2)} km`}{' '}
                <span className="muted">{t.rate >= 0 ? '↘' : '↗'} {fmt(Math.abs(t.rate), 2)}</span>
              </span>
            </p>
          ))}
        </div>

        {dockNear && s.dock && (
          <div className={`hud-block dock-card ${s.docked || s.dock.capture ? 'ok' : dockRateClass === 'crit' ? 'crit' : dockAligned ? 'ready' : ''}`} aria-label="Telemetría de atraque Tesela">
            <div className="dock-head">
              <span className="eyebrow">Atraque · Tesela</span>
              <span className={`dock-state mono ${s.docked || s.dock.capture ? 'ok' : dockRateClass === 'crit' ? 'crit' : dockAligned ? 'ok' : 'warn'}`}>
                {s.docked ? 'ATRACADO' : s.dock.capture ? 'CAPTURA' : dockRateClass === 'crit' ? 'CIERRE ALTO' : dockAligned ? 'EN TOLERANCIA' : 'ALINEAR'}
              </span>
            </div>
            <div className="dock-grid mono small">
              <div><span className="muted">DIST</span><strong>{fmt(s.dock.range, 2)} m</strong></div>
              <div className={dockRateClass}><span className="muted">CIERRE</span><strong>{fmt(s.dock.closing, 3)} m/s</strong></div>
              <div className={s.dock.angle < 6 ? 'ok' : 'warn'}><span className="muted">ÁNG</span><strong>{fmt(s.dock.angle, 1)}°</strong></div>
              <div><span className="muted">LAT/VERT</span><strong>{fmt(s.dock.lat, 2)} / {fmt(s.dock.vert, 2)}</strong></div>
            </div>
          </div>
        )}

        {s.sandbox && (
          <div className="hud-block">
            <p className="eyebrow">Entrenamiento</p>
            <p className="big mono">{s.sandbox.score}</p>
            <p className="mono small">Racha ×{s.sandbox.streak} · Pulsos {s.sandbox.shots}</p>
          </div>
        )}
      </div>

      <div className="hud-bottom" role="toolbar" aria-label="Controles rápidos de vuelo">
        <button
          className={`pill pill-btn ${s.assist ? 'on' : 'warn'}`}
          title="Alternar modo asistido / newtoniano (T)"
          onClick={() => { eng.flight.assist = !eng.flight.assist; eng.emitSnap(); }}
        >
          {s.assist ? 'ASISTIDO' : 'MANUAL'}
        </button>
        <span className={`pill ${s.systems.sw.RCS && s.systems.sw.BAT ? 'on' : 'off'}`}>RCS</span>
        <span className={`pill ${s.systems.sw.MAIN && s.systems.sw.BAT ? 'on' : 'off'}`}>MOTORES</span>
        <button
          className="pill pill-btn"
          disabled={s.seated}
          title="Cambiar cámara (C)"
          onClick={cycleCam}
        >
          {s.seated ? 'CABINA' : { chase: 'PERSECUCIÓN', orbit: 'ORBITAL', free: 'LIBRE', cockpit: 'CABINA' }[s.flightCam]}
        </button>
        {s.docked && <span className="pill on">ATRACADO</span>}
        <span className={`pill ${s.systems.soc < 0.12 ? 'crit' : s.systems.soc < 0.2 ? 'warn' : ''}`}>BAT {Math.round(s.systems.soc * 100)} %</span>
        <span className="pill hide-sm">BIPROP {fmt(s.systems.biprop, 0)} kg</span>
        <button className={`btn sm ${armOpen ? 'active' : ''}`} onClick={onArm} aria-expanded={armOpen}>Brazo</button>
        {s.docked && (
          <button
            className="btn sm"
            onClick={() => {
              eng.flight.docked = null;
              eng.flight.state.vel.set(-0.2, 0, 0).applyQuaternion(eng.flight.state.q);
              eng.emitSnap();
            }}
          >
            Desatracar
          </button>
        )}
        {s.seated && <button className="btn sm" onClick={() => eng.standUp()}>Levantarse (Y)</button>}
      </div>
      {s.seated && s.prompt && <div className="prompt"><kbd>G</kbd> {s.prompt}</div>}
    </div>
  );
}

function ArmPanel({ eng, s, onClose }: { eng: Engine; s: Snapshot; onClose: () => void }) {
  const names = ['Hombro rodillo', 'Hombro cabeceo', 'Codo', 'Muñeca cabeceo', 'Muñeca guiñada', 'Muñeca rodillo'];
  const activePose = eng.mech.activePose;
  const powered = s.systems.sw.RBT && s.systems.sw.BAT;
  return (
    <aside className="panel arm-panel open" role="region" aria-label="Control del brazo robótico">
      <div className="panel-head">
        <span className="eyebrow">Brazo robótico · 7 GDL</span>
        <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar panel del brazo">×</button>
      </div>
      {!powered && <p className="small warn-text">Sin alimentación: activa RBT en las consolas laterales.</p>}
      <div className="arm-presets" role="group" aria-label="Poses del brazo robótico">
        {ARM_PRESETS.map(([id, label]) => (
          <button
            key={id}
            className={`btn sm ${activePose === id ? 'active' : ''}`}
            disabled={!powered}
            onClick={() => { eng.mech.setPose(id); eng.emitSnap(); }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="row-btns">
        <button className="btn primary sm" disabled={!powered} onClick={() => eng.armCapture()}>Capturar cápsula</button>
        {s.armGrabbed && (
          <button className="btn sm" onClick={() => { eng.mech.grabbed = null; eng.canister.vel.set(0, 0.05, 0); eng.emitSnap(); }}>
            Soltar
          </button>
        )}
      </div>
      <div className="joints-list">
        {names.map((n, i) => (
          <div key={n} className="joint">
            <span className="small">{n}</span>
            <span className="mono small">{fmt(s.arm[i] * 57.3, 1)}°</span>
            <button className="btn sm" aria-label={`Reducir ${n}`} disabled={!powered} onClick={() => eng.mech.jogJoint(i, -0.1)}>−</button>
            <button className="btn sm" aria-label={`Aumentar ${n}`} disabled={!powered} onClick={() => eng.mech.jogJoint(i, 0.1)}>+</button>
          </div>
        ))}
      </div>
      <p className="small muted">Las pantallas de la estación robótica del nodo muestran la cámara del extremo del brazo.</p>
    </aside>
  );
}

// ---------------------------------------------------------------- interior y EVA
function InteriorHUD({ s, eng }: { s: Snapshot; eng: Engine }) {
  const [roomShown, setRoomShown] = useState(s.room);
  useEffect(() => {
    setRoomShown(s.room);
    const t = window.setTimeout(() => setRoomShown(''), 2600);
    return () => window.clearTimeout(t);
  }, [s.room]);
  return (
    <div className="hud interior-hud">
      <div className={`crosshair ${s.prompt ? 'live' : ''}`} aria-hidden="true" />
      {s.fade > 0.01 && <div className="sleep-fade" style={{ opacity: s.fade }}><span className="mono">{eng.crew.metText()} · {eng.crew.utcText()}</span></div>}
      {s.prompt && (
        <div className="prompt" role="status">
          {!s.activity && <kbd>{touchDevice() ? 'Usar' : 'G'}</kbd>}<span>{s.prompt}</span>
          {s.activity && <span className="hold"><i style={{ transform: `scaleX(${s.activity.p})` }} /></span>}
          {!s.activity && s.holdProgress > 0 && s.holdProgress < 1 && <span className="hold"><i style={{ transform: `scaleX(${s.holdProgress})` }} /></span>}
        </div>
      )}
      {roomShown && <div className="room-title"><span className="eyebrow">ALCIÓN HX-4</span><span>{roomShown}</span></div>}
      <div className="vitals mono small" aria-label="Estado de cabina">
        <span>{eng.crew.metText()}</span>
        <span>O₂ {fmt(s.systems.o2, 1)}</span>
        <span>CO₂ {fmt(s.systems.co2, 2)}</span>
        <span>{fmt(s.systems.temp, 1)} °C</span>
        {s.crouch && <span className="accent">agachado</span>}
        {s.climbing && <span className="accent">escalerilla</span>}
      </div>
      {!touchDevice() && <p className="esc-hint mono small">Esc · menú</p>}
    </div>
  );
}

function EvaHUD({ s }: { s: Snapshot }) {
  return (
    <div className="hud eva-hud">
      <div className="visor" aria-hidden="true" />
      <div className="crosshair" aria-hidden="true" />
      {s.prompt && (
        <div className="prompt">
          <kbd>{touchDevice() ? 'Usar' : 'G'}</kbd> {s.prompt}
          {s.holdProgress > 0 && s.holdProgress < 1 && <span className="hold"><i style={{ transform: `scaleX(${s.holdProgress})` }} /></span>}
        </div>
      )}
      <div className="hud-left">
        <div className="hud-block">
          <p className="eyebrow">Traje EVA</p>
          <p className="mono small">Propulsante de maniobra {Math.round(s.jetFuel * 100)} %</p>
          <div className="hbar"><div style={{ width: `${s.jetFuel * 100}%` }} /></div>
          <p className="mono small muted">Línea de seguridad conectada</p>
        </div>
      </div>
    </div>
  );
}

function MissionCard({ s, eng }: { s: Snapshot; eng: Engine }) {
  const m = s.mission!;
  return (
    <div className="mission-card" role="region" aria-label="Misión activa">
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
    <div className="inspect-card" role="dialog" aria-modal="false" aria-label="Inspección de equipo">
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
          {eng.astro.scenarios().map((sc) => (
            <button key={sc.id} className={`btn ${s.scenario === sc.id ? 'active' : ''}`} onClick={() => eng.setScenario(sc.id)} title={sc.desc}>
              {sc.label}
            </button>
          ))}
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
function TouchControls({ eng, mode, onMenu }: { eng: Engine; mode: Mode; onMenu: () => void }) {
  const T = eng.input.touch as Record<string, number>;
  const fly = mode === 'FLIGHT' || mode === 'SANDBOX';
  type G = { o: [number, number] | null; id: number; last: [number, number] | null };
  const st = (el: Element): G => ((el as any).__g ??= { o: null, id: -1, last: null });
  const stick = (onMove: (x: number, y: number) => void) => {
    const end = (e: React.PointerEvent) => {
      const g = st(e.currentTarget);
      if (e.pointerId !== g.id) return;
      g.o = null; g.id = -1;
      onMove(0, 0);
      const el = e.currentTarget as HTMLElement;
      el.style.setProperty('--sx', '0px');
      el.style.setProperty('--sy', '0px');
      el.classList.remove('active');
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        const g = st(e.currentTarget);
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
        g.o = [e.clientX, e.clientY];
        g.id = e.pointerId;
        (e.currentTarget as HTMLElement).classList.add('active');
      },
      onPointerMove: (e: React.PointerEvent) => {
        const g = st(e.currentTarget);
        if (!g.o || e.pointerId !== g.id) return;
        const k = 42;
        const x = Math.max(-1, Math.min(1, (e.clientX - g.o[0]) / k));
        const y = Math.max(-1, Math.min(1, (e.clientY - g.o[1]) / k));
        const el = e.currentTarget as HTMLElement;
        el.style.setProperty('--sx', `${x * 20}px`);
        el.style.setProperty('--sy', `${y * 20}px`);
        onMove(x, y);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    };
  };
  const hold = (k: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); T[k] = 1; },
    onPointerUp: () => { T[k] = 0; },
    onPointerCancel: () => { T[k] = 0; },
    onPointerLeave: () => { T[k] = 0; },
  });
  const look = (() => {
    const end = (e: React.PointerEvent) => {
      const g = st(e.currentTarget);
      if (e.pointerId === g.id) {
        g.last = null; g.id = -1;
        if (fly) { T.yawRight = T.yawLeft = T.pitchUp = T.pitchDown = 0; }
      }
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        const g = st(e.currentTarget);
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
        g.last = [e.clientX, e.clientY];
        g.id = e.pointerId;
      },
      onPointerMove: (e: React.PointerEvent) => {
        const g = st(e.currentTarget);
        if (!g.last || e.pointerId !== g.id) return;
        const dx = e.clientX - g.last[0], dy = e.clientY - g.last[1];
        g.last = [e.clientX, e.clientY];
        if (fly) {
          T.yawRight = Math.max(0, dx / 8); T.yawLeft = Math.max(0, -dx / 8);
          T.pitchUp = Math.max(0, dy / 8); T.pitchDown = Math.max(0, -dy / 8);
        } else {
          eng.input.touchLook.x += dx * 0.0045 * eng.input.sensitivity;
          eng.input.touchLook.y += dy * 0.0045 * eng.input.sensitivity;
        }
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    };
  })();

  return (
    <div className="touch" aria-label="Controles táctiles">
      <div className="look-zone" {...look} aria-hidden="true" />
      <div
        className="stick touch-stick"
        role="application"
        aria-label="Palanca de movimiento"
        {...stick((x, y) => {
          T.right = Math.max(0, x); T.left = Math.max(0, -x);
          T.fwd = Math.max(0, -y); T.back = Math.max(0, y);
        })}
      >
        <i aria-hidden="true" />
      </div>
      <div className="touch-btns">
        {(fly || eng.player.locomotion === 'float' || mode === 'EVA') && (
          <>
            <button {...hold('up')} aria-label="Subir">▲</button>
            <button {...hold('down')} aria-label="Bajar">▼</button>
          </>
        )}
        {mode === 'INTERIOR' && eng.player.locomotion === 'walk' && (
          <button onClick={() => { eng.player.crouchToggle = !eng.player.crouchToggle; }} aria-label="Agachar">Agachar</button>
        )}
        {fly && <button {...hold('brake')} aria-label="Freno asistido">Freno</button>}
        {mode === 'SANDBOX' && <button onPointerDown={() => (eng.touchFire = performance.now())} aria-label="Disparar pulso">Pulso</button>}
        {!fly && <button className="use" onClick={() => eng.tryInteract()} aria-label="Usar o interactuar">Usar</button>}
        {eng.seated && <button onClick={() => eng.standUp()} aria-label="Levantarse del asiento">Salir</button>}
        <button onClick={onMenu} aria-label="Menú">☰</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ajustes
function Settings({ eng, s, onClose, onChanged }: { eng: Engine; s: Snapshot; onClose: () => void; onChanged: () => void }) {
  const [, f] = useState(0);
  const re = () => { eng.saveSettings(); f((x) => x + 1); onChanged(); };
  const [listen, setListen] = useState<Action | null>(null);
  const qualities: [Quality, string][] = [['ultra', 'Ultra'], ['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']];

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-inner">
        <div className="panel-head">
          <span className="eyebrow" id="settings-title">Ajustes del simulador</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar ajustes">×</button>
        </div>
        <div className="settings-grid">
          <section>
            <h3 className="h3">Gráficos</h3>
            <div className="field">
              <span className="small muted">Perfil de calidad</span>
              <div className="seg seg-fill" role="group" aria-label="Perfil gráfico">
                {qualities.map(([q, label]) => (
                  <button
                    key={q}
                    className={eng.quality === q ? 'on' : ''}
                    aria-pressed={eng.quality === q}
                    onClick={() => { eng.applyQuality(q); re(); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="chk">
              <input type="checkbox" checked={eng.dynamicRes} onChange={(e) => { eng.dynamicRes = e.target.checked; re(); }} />
              Resolución dinámica (objetivo 60 fps)
            </label>
            <label className="chk">
              <input type="checkbox" checked={eng.reducedMotion} onChange={(e) => { eng.reducedMotion = e.target.checked; re(); }} />
              Movimiento reducido
            </label>
            <p className="mono small muted">
              {s.stats.fps} fps · {fmt(s.stats.ms, 1)} ms · {s.stats.calls} llamadas · {Math.round(s.stats.tris / 1000)} k tri · DPR {fmt(s.stats.dpr, 2)}
            </p>
          </section>

          <section>
            <h3 className="h3">Sonido</h3>
            <label>
              <span className="range-head"><span>Volumen maestro</span><span className="mono small">{Math.round(eng.audio.volume * 100)} %</span></span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={eng.audio.volume}
                onChange={(e) => { eng.audio.start(); eng.audio.setVolume(parseFloat(e.target.value)); re(); }}
              />
            </label>
            <div className="field">
              <span className="small muted">Modo acústico</span>
              <div className="choice-stack" role="radiogroup" aria-label="Modo de sonido">
                <button
                  role="radio"
                  aria-checked={eng.audio.mode === 'realista'}
                  className={`choice-card ${eng.audio.mode === 'realista' ? 'on' : ''}`}
                  onClick={() => { eng.audio.mode = 'realista'; re(); }}
                >
                  <strong>Realista · silencio en vacío</strong>
                  <span className="small muted">Acústica por estancia a bordo; silencio físico en el exterior.</span>
                </button>
                <button
                  role="radio"
                  aria-checked={eng.audio.mode === 'cinematico'}
                  className={`choice-card ${eng.audio.mode === 'cinematico' ? 'on' : ''}`}
                  onClick={() => { eng.audio.mode = 'cinematico'; re(); }}
                >
                  <strong>Cinematográfico</strong>
                  <span className="small muted">Mantiene presencia sutil de propulsores y mecanismos en cámara exterior.</span>
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 className="h3">Control y óptica</h3>
            <label>
              Escala de empuje
              <select value={eng.flight.thrustScale} onChange={(e) => { eng.flight.thrustScale = Number(e.target.value); re(); }}>
                <option value={1}>×1 (valores físicos aproximados)</option>
                <option value={5}>×5</option>
                <option value={10}>×10 (recomendado)</option>
                <option value={25}>×25 (ágil)</option>
              </select>
            </label>
            <label className="chk">
              <input type="checkbox" checked={eng.input.invertY} onChange={(e) => { eng.input.invertY = e.target.checked; re(); }} />
              Invertir eje vertical
            </label>
            <label>
              <span className="range-head"><span>Sensibilidad de cámara</span><span className="mono small">{fmt(eng.input.sensitivity, 1)}×</span></span>
              <input
                type="range"
                min={0.3}
                max={2.5}
                step={0.1}
                value={eng.input.sensitivity}
                onChange={(e) => { eng.input.sensitivity = parseFloat(e.target.value); re(); }}
              />
            </label>
            <label>
              <span className="range-head"><span>Campo de visión (FOV)</span><span className="mono small">{eng.fovPref}°</span></span>
              <input
                type="range"
                min={60}
                max={95}
                step={1}
                value={eng.fovPref}
                onChange={(e) => { eng.setFov(parseFloat(e.target.value)); re(); }}
              />
            </label>
          </section>

          <section className="wide">
            <h3 className="h3">Controles (haz clic y pulsa una tecla)</h3>
            <div className="bindings">
              {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                <button
                  key={a}
                  className={`binding ${listen === a ? 'listening' : ''}`}
                  onClick={() => {
                    setListen(a);
                    eng.input.listening = (code) => { eng.input.rebind(a, code); setListen(null); re(); };
                  }}
                >
                  <span>{ACTION_LABELS[a]}</span>
                  <kbd>{listen === a ? '…' : eng.input.bindings[a].join(' / ').replace(/Key|Digit/g, '')}</kbd>
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
function Engineering({ eng, s, sel, onSelectNode }: { eng: Engine; s: Snapshot; sel: TreeNode | null; onSelectNode: (n: TreeNode | null, focus?: boolean) => void }) {
  const [, f] = useState(0);
  const re = () => f((x) => x + 1);
  const [tool, setTool] = useState<'explode' | 'section' | 'views' | 'compare' | 'mech'>('explode');
  const [snapA, setSnapA] = useState<number | null>(null);
  const [snapB, setSnapB] = useState<number | null>(null);
  const [treeMobileOpen, setTreeMobileOpen] = useState(false);
  const m = eng.model;

  // Contrato W3-ENG: eng.engineeringTree?.() con fallback a rootNode / top
  const treeRoot: TreeNode | null = useMemo(() => {
    const fn = (eng as any).engineeringTree;
    if (typeof fn === 'function') {
      try {
        const res = fn.call(eng);
        if (res) return res as TreeNode;
      } catch { /* fallback */ }
    }
    return ((m as any).rootNode ?? m.top) as TreeNode | null;
  }, [eng, m, m.nodes.size, s.interiorReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'f' && sel) {
        if (typeof (eng as any).selectCode === 'function') (eng as any).selectCode(sel.code, true);
        else if (m.nodes.has(sel.code)) eng.focus(sel);
      } else if (k === 'i' && sel && m.nodes.has(sel.code)) {
        m.setIsolate(m.isolate === sel ? null : sel); re();
      } else if (k === 'h' && sel && m.nodes.has(sel.code)) {
        m.setHidden(sel, true); onSelectNode(null); re();
      } else if (k === 'x') {
        m.setXray(!m.xray); re();
      } else if (k === 'e') {
        eng.setExplode(m.explode < 0.5 ? 1 : 0, true);
      } else if (k === 'u' && sel?.parent) {
        onSelectNode(sel.parent as TreeNode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const range = eng.section.axis === 'x' ? [-6.5, 13.3] : eng.section.axis === 'y' ? [-2.4, 2.4] : [-3.6, 2.6];
  const stages = [[0, 'Ensamblada'], [0.25, 'Módulos'], [0.5, 'Sistemas'], [0.75, 'Conjuntos'], [1, 'Piezas']] as const;
  const stage = stages.reduce((a, x) => (s.explode >= x[0] - 0.001 ? x : a), stages[0]);

  const explodePresets: [ExplodePreset, string][] = [
    ['all', 'Completa'],
    ['hull', 'Casco MMOD'],
    ['interior', 'Interior'],
    ['service', 'Servicio'],
    ['power', 'Potencia'],
  ];

  const applyPreset = (id: ExplodePreset) => {
    eng.setExplodePreset(id);
    if (id !== 'all' && s.explode < 0.05) eng.setExplode(0.7, true);
    re();
  };

  return (
    <>
      <button
        className={`btn sm mobile-tree-toggle ${treeMobileOpen ? 'active' : ''}`}
        onClick={() => setTreeMobileOpen((v) => !v)}
        aria-expanded={treeMobileOpen}
        aria-label={treeMobileOpen ? 'Ocultar árbol de piezas' : 'Mostrar árbol de piezas'}
      >
        {treeMobileOpen ? 'Cerrar' : 'Árbol'}
      </button>

      <aside className={`panel tree-panel ${treeMobileOpen ? 'open' : 'mobile-closed'}`} aria-label="Árbol de sistemas">
        <div className="panel-head">
          <span className="eyebrow">Árbol de sistemas</span>
          <button className="icon-btn sm mobile-only" onClick={() => setTreeMobileOpen(false)} aria-label="Cerrar árbol">×</button>
        </div>
        {treeRoot && (
          <Tree
            eng={eng}
            root={treeRoot}
            sel={sel}
            onSelect={(n, focus) => { onSelectNode(n, focus); if (focus) setTreeMobileOpen(false); }}
            onChange={re}
            interiorReady={s.interiorReady}
          />
        )}
      </aside>

      {sel && <Info eng={eng} n={sel} onSelect={onSelectNode} onChange={re} />}

      <div className="instrument" role="region" aria-label="Herramientas de ingeniería">
        <div className="tool-tabs">
          {([['explode', 'Explosión'], ['section', 'Sección'], ['views', 'Vistas'], ['compare', 'Comparar'], ['mech', 'Mecanismos']] as const).map(([id, l]) => (
            <button key={id} className={tool === id ? 'on' : ''} onClick={() => setTool(id)}>{l}</button>
          ))}
          <span className="spacer" />
          <label className="chk"><input type="checkbox" checked={s.xray} onChange={(e) => { m.setXray(e.target.checked); re(); }} /> Rayos X</label>
          <label className="chk"><input type="checkbox" checked={eng.labels} onChange={(e) => { eng.labels = e.target.checked; re(); }} /> Etiquetas</label>
        </div>
        {tool === 'explode' && (
          <div className="explode-wrap">
            <div className="tool explode-tool">
              <div className="readout">
                <span className="big mono">{String(Math.round(s.explode * 100)).padStart(3, ' ')}<small>%</small></span>
                <span className="stage">{stage[1]}</span>
              </div>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={s.explode}
                  aria-label="Vista explosionada"
                  onChange={(e) => eng.setExplode(parseFloat(e.target.value))}
                  style={{ ['--p' as any]: s.explode }}
                />
                <div className="ticks">
                  {stages.map(([at, t]) => (
                    <button key={at} style={{ left: `${at * 100}%` }} className={s.explode >= at - 0.001 ? 'past' : ''} onClick={() => eng.setExplode(at, true)}>
                      <i aria-hidden="true" /><span>{Math.round(at * 100)}<em> · {t}</em></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="btns">
                <button className="btn sm" onClick={() => eng.setExplode(s.explode < 0.5 ? 1 : 0, true)}>{s.explode < 0.5 ? 'Explosionar' : 'Ensamblar'}</button>
                <button className="btn sm" onClick={() => eng.assemble()}>Animar</button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    eng.setExplodePreset('all');
                    eng.setExplode(0, true);
                    m.showAll();
                    onSelectNode(null);
                    m.setXray(false);
                    eng.setSection(false);
                    eng.viewPreset('iso');
                    re();
                  }}
                >
                  Restablecer
                </button>
              </div>
            </div>
            <div className="explode-presets" role="group" aria-label="Presets de explosión por subsistema">
              <span className="eyebrow">Subsistema</span>
              {explodePresets.map(([id, l]) => (
                <button key={id} className={`btn xs ${s.explodePreset === id ? 'active' : 'ghost'}`} onClick={() => applyPreset(id)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        {tool === 'section' && (
          <div className="tool section-tool">
            <label className="chk"><input type="checkbox" checked={eng.section.on} onChange={(e) => { eng.setSection(e.target.checked); re(); }} /> Corte con tapas</label>
            <div className="seg">
              {(['x', 'y', 'z'] as const).map((a) => (
                <button key={a} className={eng.section.axis === a ? 'on' : ''} onClick={() => { eng.setSection(true, a, a === 'x' ? 4.7 : 0); re(); }}>
                  {a === 'x' ? 'Transversal' : a === 'y' ? 'Longitudinal' : 'Horizontal'}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={range[0]}
              max={range[1]}
              step={0.01}
              value={eng.section.pos}
              aria-label="Plano de corte"
              onChange={(e) => { eng.setSection(true, eng.section.axis, parseFloat(e.target.value)); re(); }}
              style={{ ['--p' as any]: (eng.section.pos - range[0]) / (range[1] - range[0]) }}
            />
            <span className="mono readout-sm">{eng.section.axis.toUpperCase()} = {fmt(eng.section.pos, 2)} m</span>
            <button className="btn sm ghost" onClick={() => { eng.setSection(true, eng.section.axis, eng.section.pos, !eng.section.flip); re(); }}>Invertir</button>
          </div>
        )}
        {tool === 'views' && (
          <div className="tool views-tool">
            {([['iso', 'Isométrica'], ['front', 'Frontal'], ['side', 'Lateral'], ['top', 'Superior'], ['bottom', 'Inferior'], ['rear', 'Posterior']] as const).map(([id, l]) => (
              <button key={id} className="btn sm" onClick={() => eng.viewPreset(id)}>{l}</button>
            ))}
          </div>
        )}
        {tool === 'mech' && <MechTool eng={eng} onChange={re} />}
        {tool === 'compare' && (
          <div className="tool views-tool">
            <span className="small muted">Instantáneas de explosión: guarda dos estados y alterna entre ellos.</span>
            <button className="btn sm" onClick={() => setSnapA(s.explode)}>Guardar A {snapA !== null && `(${Math.round(snapA * 100)} %)`}</button>
            <button className="btn sm" onClick={() => setSnapB(s.explode)}>Guardar B {snapB !== null && `(${Math.round(snapB * 100)} %)`}</button>
            <button className="btn sm" disabled={snapA === null} onClick={() => eng.setExplode(snapA!, true)}>Ver A</button>
            <button className="btn sm" disabled={snapB === null} onClick={() => eng.setExplode(snapB!, true)}>Ver B</button>
          </div>
        )}
      </div>
      {eng.hoverNode && (
        <div className="hover-tip" style={{ transform: `translate(${eng.hoverXY[0] + 14}px, ${eng.hoverXY[1] + 14}px)` }}>
          <span className="mono">{eng.hoverNode.code}</span> {eng.hoverNode.label}
        </div>
      )}
    </>
  );
}

function MechTool({ eng, onChange }: { eng: Engine; onChange: () => void }) {
  const m = eng.model;
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((x) => x + 1), 250); return () => window.clearInterval(id); }, []);
  const ids = [...m.mechs.keys(), ...eng.interior.mechs.keys()];
  const hatches = ids.filter((id) => id.startsWith('hatch:') && id !== 'hatch:alk_out').sort();
  const shutters = ids.filter((id) => id.startsWith('shutter:'));
  const lockers = ids.filter((id) => id.startsWith('locker:'));
  const mechOf = (id: string) => m.mech(id) ?? eng.interior.mech(id);
  const toggle = (id: string) => {
    if (m.mech(id)) m.toggleMech(id);
    else {
      const x = eng.interior.mech(id);
      if (x) x.target = Math.abs(x.target - x.rest) < 1e-3 ? (Math.abs(x.min - x.rest) > Math.abs(x.max - x.rest) ? x.min : x.max) : x.rest;
    }
  };
  const isOpen = (id: string) => { const x = mechOf(id); return !!x && Math.abs(x.target - x.rest) > 1e-3; };
  const setAll = (list: string[], open: boolean) => { for (const id of list) if (isOpen(id) !== open) toggle(id); eng.audio.click(true); onChange(); };
  const label: Record<string, string> = { 'hatch:idss': 'Escotilla IDSS (proa)', 'hatch:aft': 'Escotilla nodo → hábitat', 'hatch:alk_in': 'Escotilla interior esclusa' };
  const rad = eng.mech.radiatorTarget > 0.5;
  const armOn = eng.systems.on('RBT');
  return (
    <div className="tool views-tool mech-tool">
      <div className="mech-group">
        <span className="eyebrow">Radiadores</span>
        <button className="btn sm" onClick={() => { eng.mech.radiatorTarget = rad ? 0 : 1; onChange(); }}>{rad ? 'Plegar' : 'Desplegar'}</button>
        <span className="mono small">{Math.round(eng.mech.radiatorDeploy * 100)} %</span>
      </div>
      <div className="mech-group">
        <span className="eyebrow">Brazo{!armOn && ' · sin potencia (RBT)'}</span>
        {ARM_PRESETS.map(([p, l]) => (
          <button key={p} className={`btn sm ${eng.mech.activePose === p ? 'active' : ''}`} disabled={!armOn} onClick={() => eng.mech.setPose(p)}>{l}</button>
        ))}
      </div>
      <div className="mech-group">
        <span className="eyebrow">Escotillas</span>
        {hatches.map((id) => (
          <button key={id} className={'btn sm' + (isOpen(id) ? ' on' : '')} onClick={() => { toggle(id); eng.audio.hatch(isOpen(id)); onChange(); }}>
            {label[id] ?? id}
          </button>
        ))}
      </div>
      <div className="mech-group">
        <span className="eyebrow">Cúpula · taquillas</span>
        <button className="btn sm" onClick={() => setAll(shutters, !shutters.some(isOpen))}>{shutters.some(isOpen) ? 'Cerrar' : 'Abrir'} contraventanas</button>
        <button className="btn sm" onClick={() => setAll(lockers, !lockers.some(isOpen))}>{lockers.some(isOpen) ? 'Cerrar' : 'Abrir'} taquillas ({lockers.length})</button>
      </div>
    </div>
  );
}

function Tree({
  eng, root, sel, onSelect, onChange, interiorReady,
}: {
  eng: Engine; root: TreeNode; sel: TreeNode | null; onSelect: (n: TreeNode | null, focus?: boolean) => void; onChange: () => void; interiorReady: boolean;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<TreeScope>('all');
  const [open, setOpen] = useState<Set<string>>(new Set([root.code]));
  const listRef = useRef<HTMLDivElement>(null);

  const allNodes = useMemo(() => collectNodes(root), [root, interiorReady, eng.model.nodes.size]);
  const counts = useMemo(() => {
    let extParts = 0, intParts = 0;
    for (const n of allNodes) {
      if (n.kind === 'part' || n.children.length === 0) {
        if (isInteriorNode(n)) intParts++;
        else extParts++;
      }
    }
    return { all: extParts + intParts, ext: extParts, int: intParts, totalNodes: allNodes.length };
  }, [allNodes]);

  // Determina qué nodos pertenecen al filtro activo (incluye ancestros que contienen hijos coincidentes)
  const visibleSet = useMemo(() => {
    if (scope === 'all') return null;
    const ok = new Set<string>();
    const visit = (n: TreeNode): boolean => {
      const selfIsInt = isInteriorNode(n);
      const selfMatch = (scope === 'int' && selfIsInt) || (scope === 'ext' && !selfIsInt && n.depth > 0);
      let childMatch = false;
      for (const c of n.children as TreeNode[]) {
        if (visit(c)) childMatch = true;
      }
      if (selfMatch || childMatch || n === root) {
        if (scope === 'ext' && selfIsInt) return false;
        ok.add(n.code);
        return selfMatch || childMatch;
      }
      return false;
    };
    visit(root);
    return ok;
  }, [root, scope, allNodes]);

  useEffect(() => {
    if (scope === 'int') {
      const expanded = new Set<string>([root.code]);
      for (const n of allNodes) {
        if (n.code === 'HAB' || n.code === 'HAB.INT' || n.code === 'FWD' || (isInteriorNode(n) && n.depth <= 3)) {
          expanded.add(n.code);
        }
      }
      setOpen(expanded);
    }
  }, [scope, root, allNodes]);

  useEffect(() => {
    if (!sel) return;
    setOpen((prev) => {
      const s2 = new Set(prev);
      let p = sel.parent;
      while (p) { s2.add(p.code); p = p.parent; }
      return s2;
    });
    requestAnimationFrame(() => listRef.current?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' }));
  }, [sel]);

  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const results = useMemo(() => {
    if (q.trim().length < 2) return null;
    const qq = norm(q);
    const out: TreeNode[] = [];
    for (const n of allNodes) {
      if (scope === 'ext' && isInteriorNode(n)) continue;
      if (scope === 'int' && !isInteriorNode(n)) continue;
      const rm = roomLabelOf(n) ?? '';
      if (norm(n.label).includes(qq) || norm(n.code).includes(qq) || norm(n.desc || '').includes(qq) || norm(rm).includes(qq)) {
        out.push(n);
      }
      if (out.length >= 120) break;
    }
    return out;
  }, [q, scope, allNodes]);

  const toggle = (c: string) => {
    const s2 = new Set(open);
    s2.has(c) ? s2.delete(c) : s2.add(c);
    setOpen(s2);
  };

  const rows: JSX.Element[] = [];
  const walk = (n: TreeNode, lvl: number) => {
    if (visibleSet && !visibleSet.has(n.code)) return;
    const visibleKids = (n.children as TreeNode[]).filter((c) => !visibleSet || visibleSet.has(c.code));
    const kids = visibleKids.length > 0;
    const isOpen = open.has(n.code);
    const inModel = eng.model.nodes.has(n.code);
    const isInt = isInteriorNode(n);
    rows.push(
      <div
        key={n.code}
        className={`row ${sel?.code === n.code ? 'sel' : ''} ${n.hidden ? 'dim' : ''}`}
        style={{ paddingLeft: 8 + lvl * 14 }}
        onClick={() => onSelect(n, false)}
        onDoubleClick={() => onSelect(n, true)}
      >
        <button
          className="caret"
          aria-label={isOpen ? 'Contraer' : 'Expandir'}
          style={{ visibility: kids ? 'visible' : 'hidden' }}
          onClick={(e) => { e.stopPropagation(); toggle(n.code); }}
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <span className="row-label">{n.label}</span>
        {isInt && n.depth >= 2 && <span className="row-tag mono">INT</span>}
        <span className="row-count mono">{n.parts > 1 ? n.parts : ''}</span>
        {n.depth > 0 && inModel && (
          <button
            className="eye"
            aria-label={n.hidden ? 'Mostrar' : 'Ocultar'}
            onClick={(e) => { e.stopPropagation(); eng.model.setHidden(n, !n.hidden); onChange(); }}
          >
            {n.hidden ? '○' : '●'}
          </button>
        )}
      </div>,
    );
    if (kids && isOpen) for (const c of visibleKids) walk(c, lvl + 1);
  };
  if (!results) walk(root, 0);

  return (
    <div className="tree">
      <div className="tree-scope" role="tablist" aria-label="Filtrar árbol por sector">
        {([
          ['all', 'Todo', counts.all],
          ['ext', 'Exterior', counts.ext],
          ['int', 'Interior', counts.int],
        ] as [TreeScope, string, number][]).map(([id, lbl, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={scope === id}
            className={scope === id ? 'on' : ''}
            onClick={() => setScope(id)}
          >
            <span>{lbl}</span>
            <span className="mono">{count}</span>
          </button>
        ))}
      </div>
      <div className="search">
        <input
          placeholder="Buscar pieza, código o estancia…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar componentes"
        />
        {q && (
          <button className="search-clear" onClick={() => setQ('')} aria-label="Limpiar búsqueda">×</button>
        )}
      </div>
      <div className="tree-list" ref={listRef}>
        {results ? (
          results.length ? (
            results.map((n) => (
              <div
                key={n.code}
                className={`row result ${sel?.code === n.code ? 'sel' : ''}`}
                onClick={() => onSelect(n, true)}
              >
                <span className="row-label">{n.label}</span>
                <span className="row-code mono">{n.code}</span>
              </div>
            ))
          ) : (
            <p className="empty">Sin coincidencias{scope !== 'all' ? ' en este sector' : ''}.</p>
          )
        ) : rows.length ? rows : (
          <p className="empty">No hay piezas en este filtro.</p>
        )}
      </div>
      <div className="tree-foot mono">
        {counts.totalNodes} nodos · {counts.all} piezas ({counts.ext} ext / {counts.int} int){!interiorReady ? ' · cargando int…' : ''}
      </div>
    </div>
  );
}

function Info({ eng, n, onSelect, onChange }: { eng: Engine; n: TreeNode; onSelect: (n: TreeNode | null, focus?: boolean) => void; onChange: () => void }) {
  const crumbs: TreeNode[] = [];
  let p: TreeNode | null = n;
  while (p) { crumbs.unshift(p); p = p.parent as TreeNode | null; }
  const size = n.box0 ? n.box0.getSize(new THREE.Vector3()) : null;
  const [subEx, setSubEx] = useState(n.localEx ?? 0);
  useEffect(() => setSubEx(n.localEx ?? 0), [n]);

  const inModel = eng.model.nodes.has(n.code);
  const isInt = isInteriorNode(n);
  const room = roomLabelOf(n);

  return (
    <aside className="panel info-panel open" aria-label="Detalle del componente seleccionado">
      <div className="panel-head">
        <span className="eyebrow">
          {n.kind === 'part' ? 'Pieza' : n.depth === 1 ? 'Módulo' : n.depth === 2 ? 'Sistema' : 'Conjunto'} · {isInt ? 'Interior' : 'Exterior'}
        </span>
        <button className="icon-btn sm" onClick={() => onSelect(null)} aria-label="Cerrar detalle">×</button>
      </div>
      <nav className="crumbs" aria-label="Jerarquía">
        {crumbs.map((c, i) => (
          <span key={c.code}>
            <button onClick={() => onSelect(c, false)} className={c.code === n.code ? 'cur' : ''}>{i === 0 ? 'Nave' : c.label}</button>
            {i < crumbs.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </nav>
      <h2 className="h2">{n.label}</h2>
      <div className="code-line">
        <p className="code mono">{n.code}</p>
        {room && <span className="room-badge">{room}</span>}
      </div>
      {n.desc && <p className="desc">{n.desc}</p>}
      {n.func && (<><p className="eyebrow mt">Función</p><p className="desc">{n.func}</p></>)}
      <dl className="kv mono">
        {room && <><dt>Estancia</dt><dd>{room}</dd></>}
        {size && <><dt>Envolvente (X·Y·Z)</dt><dd>{fmt(size.x, 2)} × {fmt(size.z, 2)} × {fmt(size.y, 2)} m</dd></>}
        <dt>Piezas contenidas</dt><dd>{n.parts ?? 1}</dd>
        <dt>Triángulos</dt><dd>{Math.round(n.tris ?? 0).toLocaleString('es-ES')}</dd>
        {n.mech && <><dt>Mecanismo</dt><dd>{n.mech.type === 'hinge' ? 'bisagra' : 'deslizadera'} · {n.mech.id}</dd></>}
      </dl>
      {inModel && n.children.length > 0 && (
        <div className="sub-explode">
          <p className="eyebrow mt">Explosión de este subsistema</p>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={subEx}
            onChange={(e) => { const v = parseFloat(e.target.value); setSubEx(v); n.localEx = v; eng.model.markDirty(); }}
            style={{ ['--p' as any]: subEx }}
            aria-label="Explosión del subsistema"
          />
        </div>
      )}
      {n.materials?.length > 0 && (
        <>
          <p className="eyebrow mt">Materiales representados</p>
          <ul className="mats">
            {n.materials.slice(0, 10).map((mm) => (
              <li key={mm.name}><span className={`sw ${mm.name}`} aria-hidden="true" /> <span>{mm.desc || mm.name}</span></li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={() => onSelect(n, true)}>Enfocar</button>
        {inModel && (
          <button
            className={`btn ${eng.model.isolate === n ? 'active' : ''}`}
            onClick={() => { eng.model.setIsolate(eng.model.isolate === n ? null : n); onChange(); }}
          >
            {eng.model.isolate === n ? 'Salir de aislamiento' : 'Aislar'}
          </button>
        )}
        {inModel && (
          <button className="btn" onClick={() => { eng.model.setHidden(n, true); onSelect(null); onChange(); }}>Ocultar</button>
        )}
        {n.mech && inModel && (
          <button className="btn" onClick={() => { eng.model.toggleMech(n.mech!.id); onChange(); }}>Accionar mecanismo</button>
        )}
        {n.parent && <button className="btn" onClick={() => onSelect(n.parent as TreeNode, false)}>Subir nivel</button>}
      </div>
      {n.children?.length > 0 && (
        <>
          <p className="eyebrow mt">Contiene ({n.children.length})</p>
          <ul className="kids">
            {(n.children as TreeNode[]).slice(0, 40).map((c) => (
              <li key={c.code}>
                <button onClick={() => onSelect(c, true)}>{c.label}</button>
                <span className="mono muted">{c.parts > 1 ? c.parts : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

const BLUEPRINTS = [
  ['front', 'Vista frontal'],
  ['side', 'Vista lateral'],
  ['top', 'Vista superior'],
  ['bottom', 'Vista inferior'],
  ['rear', 'Vista posterior'],
  ['section_long', 'Sección longitudinal'],
  ['section_cross', 'Secciones transversales'],
  ['layout', 'Distribución interior'],
  ['systems', 'Arquitectura de sistemas'],
  ['assembly', 'Ensamblaje conceptual'],
];
function Plans() {
  const [cur, setCur] = useState('front');
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setZ({ s: 1, x: 0, y: 0 }), [cur]);
  return (
    <div className="sheet plans">
      <aside className="plans-nav">
        <p className="eyebrow">Planos conceptuales</p>
        {BLUEPRINTS.map(([id, l], i) => (
          <button key={id} className={cur === id ? 'on' : ''} onClick={() => setCur(id)}>
            <span className="mono">{String(i + 1).padStart(2, '0')}</span> {l}
          </button>
        ))}
        <a className="btn ghost" href={`blueprints/${cur}.png`} download>Descargar PNG</a>
      </aside>
      <div
        className="plan-stage"
        onWheel={(e) => setZ((p) => ({ ...p, s: Math.min(6, Math.max(1, p.s * (e.deltaY < 0 ? 1.12 : 0.89))) }))}
        onPointerDown={(e) => { drag.current = { x: e.clientX - z.x, y: e.clientY - z.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setZ((p) => ({ ...p, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y })); }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setZ({ s: 1, x: 0, y: 0 })}
      >
        <img src={`blueprints/${cur}.png`} alt={`Plano ${cur}`} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
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
        <section className="spec-grid">
          {SPEC.map((b) => (
            <div key={b.title} className="spec-block">
              <h3 className="h3">{b.title}</h3>
              <dl>
                {b.rows.map((r) => (
                  <div key={r.k} className="spec-row">
                    <dt>{r.k}</dt><dd className="mono">{r.v}</dd>
                    {r.note && <span className={`tag ${r.note}`}>{r.note}</span>}
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
        <section className="profile">
          <h3 className="h2">Perfil de misión</h3>
          <ol>{PROFILE.map((p) => <li key={p.h}><span className="mono t">{p.t}</span><div><strong>{p.h}</strong><p>{p.d}</p></div></li>)}</ol>
        </section>
        <section className="philosophy">
          <h3 className="h2">Filosofía de diseño</h3>
          <div className="phil-grid">{PHILOSOPHY.map((p, i) => <div key={p.h} className={i === 0 ? 'wide' : ''}><h4>{p.h}</h4><p>{p.d}</p></div>)}</div>
        </section>
        <section className="sources">
          <h3 className="h2">Fuentes consultadas</h3>
          <ul>{SOURCES.map((x) => <li key={x.u}><a href={x.u} target="_blank" rel="noreferrer">{x.t}</a></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

export { SWITCH_LABEL, SWITCH_ORDER };
