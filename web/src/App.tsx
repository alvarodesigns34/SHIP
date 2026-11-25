import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Viewer, PartNode, WAYPOINTS, LightingPreset, Quality, Axis } from './viewer/Viewer';
import { IDENTITY, SPEC, PROFILE, PHILOSOPHY, SOURCES, STORY } from './data/spec';

type Mode = 'inspect' | 'story' | 'plans' | 'spec';

const LIGHTS: { id: LightingPreset; label: string }[] = [
  { id: 'lunar', label: 'Órbita lunar' },
  { id: 'sun', label: 'Sol directo' },
  { id: 'studio', label: 'Estudio' },
  { id: 'technical', label: 'Técnico' },
];

const BLUEPRINTS = [
  { id: 'front', label: 'Vista frontal' },
  { id: 'side', label: 'Vista lateral' },
  { id: 'top', label: 'Vista superior' },
  { id: 'bottom', label: 'Vista inferior' },
  { id: 'rear', label: 'Vista posterior' },
  { id: 'section_long', label: 'Sección longitudinal' },
  { id: 'section_cross', label: 'Secciones transversales' },
  { id: 'layout', label: 'Distribución interior' },
  { id: 'systems', label: 'Arquitectura de sistemas' },
  { id: 'assembly', label: 'Ensamblaje conceptual' },
];

const STAGE_LABELS = [
  { at: 0, t: 'Ensamblada' },
  { at: 0.25, t: 'Módulos' },
  { at: 0.5, t: 'Sistemas' },
  { at: 0.75, t: 'Conjuntos' },
  { at: 1, t: 'Piezas' },
];

const fmt = (n: number, d = 2) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [progress, setProgress] = useState({ stage: 'Iniciando', p: 0 });
  const [ready, setReady] = useState(false);
  const [interiorReady, setInteriorReady] = useState(false);
  const [intro, setIntro] = useState(true);
  const [mode, setMode] = useState<Mode>('inspect');
  const [sel, setSel] = useState<PartNode | null>(null);
  const [hover, setHover] = useState<{ n: PartNode | null; x: number; y: number }>({ n: null, x: 0, y: 0 });
  const [explode, setExplode] = useState(0);
  const [xray, setXray] = useState(false);
  const [labels, setLabels] = useState(true);
  const [guides, setGuides] = useState(true);
  const [section, setSection] = useState<{ on: boolean; axis: Axis; pos: number; flip: boolean }>({ on: false, axis: 'y', pos: 0, flip: false });
  const [lighting, setLighting] = useState<LightingPreset>('lunar');
  const [quality, setQuality] = useState<Quality>(isMobile() ? 'baja' : 'alta');
  const [walk, setWalk] = useState(false);
  const [stats, setStats] = useState({ fps: 0, calls: 0, tris: 0 });
  const [treeOpen, setTreeOpen] = useState(!isMobile());
  const [infoOpen, setInfoOpen] = useState(true);
  const [ortho, setOrtho] = useState(false);
  const [present, setPresent] = useState(false);
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);

  useEffect(() => {
    if (!host.current) return;
    const v = new Viewer(host.current, {
      onProgress: (stage, p) => setProgress({ stage, p }),
      onReady: () => { setReady(true); rerender(); },
      onInteriorReady: () => { setInteriorReady(true); rerender(); },
      onSelect: (n) => { setSel(n); if (n) setInfoOpen(true); },
      onHover: (n, x, y) => setHover({ n, x, y }),
      onStats: setStats,
      onWalkChange: setWalk,
    });
    viewerRef.current = v;
    v.setQuality(quality);
    (window as any).__viewer = v;
    v.load();
    return () => v.dispose();
  }, []);

  // cinemática inicial
  useEffect(() => {
    const v = viewerRef.current;
    if (!ready || !v) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const end = new THREE.Vector3(27, 10, 31), endT = new THREE.Vector3(2.5, -0.6, 0);
    if (reduce) { v.camera.position.copy(end); v.controls.target.copy(endT); setIntro(false); v.requestRender(); return; }
    const pts = [new THREE.Vector3(-70, -14, -40), new THREE.Vector3(-28, 3, 26), new THREE.Vector3(6, 6, 34), end];
    const tgs = [new THREE.Vector3(-4, 0, 0), new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0), endT];
    v.camera.position.copy(pts[0]);
    v.flyPath(pts, tgs, 9000, () => setIntro(false));
  }, [ready]);

  const v = viewerRef.current;
  const skipIntro = () => {
    if (!v) return;
    v.stopTween();
    v.camera.position.set(27, 10, 31);
    v.controls.target.set(2.5, -0.6, 0);
    v.requestRender();
    setIntro(false);
  };

  // sincronizar estado → visor
  useEffect(() => { v?.setExplode(explode); }, [explode]);
  useEffect(() => { v?.setXray(xray); }, [xray]);
  useEffect(() => { if (v) { v.labels = labels; v.requestRender(); } }, [labels]);
  useEffect(() => { if (v) { v.guides = guides; v.applyExplode(); } }, [guides]);
  useEffect(() => { v?.setSection(section.on, section.axis, section.pos, section.flip); }, [section]);
  useEffect(() => { v?.setLighting(lighting); }, [lighting]);
  useEffect(() => { if (v && ready) v.setQuality(quality); }, [quality]);

  // modo presentación a pantalla completa
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) { setPresent(false); v?.setAutoOrbit(false); } };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [v]);
  const togglePresent = async () => {
    if (!present) {
      try { await document.documentElement.requestFullscreen(); } catch { /* iOS */ }
      setPresent(true);
      v?.select(null);
      v?.setAutoOrbit(true);
    } else {
      if (document.fullscreenElement) await document.exitFullscreen();
      setPresent(false);
      v?.setAutoOrbit(false);
    }
  };

  const animateExplode = (t: number) => {
    if (!v) return;
    v.setExplode(t, true, 1600);
    const t0 = performance.now(), a = explode;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1600);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setExplodeSilently(a + (t - a) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  };
  const silent = useRef(false);
  const setExplodeSilently = (x: number) => { silent.current = true; setExplodeUI(x); };
  const [explodeUI, setExplodeUI] = useState(0);
  useEffect(() => { if (!silent.current) setExplodeUI(explode); silent.current = false; }, [explode]);

  const onSlider = (x: number) => { setExplodeUI(x); setExplode(x); };

  return (
    <div className={`app mode-${mode} ${present ? 'presenting' : ''} ${intro ? 'in-intro' : ''}`}>
      <div className="viewport" ref={host} />

      {!ready && <Loader stage={progress.stage} p={progress.p} />}

      {ready && intro && (
        <div className="intro-card">
          <p className="eyebrow">{IDENTITY.maker} · {IDENTITY.role}</p>
          <h1 className="display">{IDENTITY.name} <span className="desig">{IDENTITY.designation}</span></h1>
          <p className="lede">{IDENTITY.motto}</p>
          <button className="btn ghost" onClick={skipIntro}>Saltar introducción</button>
        </div>
      )}

      {/* barra superior */}
      <header className="topbar">
        <div className="brand" onClick={() => { setMode('inspect'); v?.select(null); }}>
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden><path d="M5 21 L16 8 L27 21" stroke="var(--accent)" strokeWidth="2.6" fill="none" /><path d="M10 25 H22" stroke="var(--ink)" strokeWidth="2" /></svg>
          <span className="brand-name">ALCIÓN</span><span className="brand-desig">HX-4</span>
        </div>
        <nav className="tabs" role="tablist">
          {([['inspect', 'Inspector'], ['story', 'Presentación'], ['plans', 'Planos'], ['spec', 'Ficha técnica']] as [Mode, string][]).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => {
              setMode(id);
              if (id === 'story') { v?.select(null); setXray(false); }
            }}>{l}</button>
          ))}
        </nav>
        <div className="top-right">
          <select aria-label="Iluminación" value={lighting} onChange={(e) => setLighting(e.target.value as LightingPreset)}>
            {LIGHTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select aria-label="Calidad" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="alta">Calidad alta</option><option value="media">Calidad media</option><option value="baja">Calidad baja</option>
          </select>
          <button className="icon-btn" title="Presentación a pantalla completa" onClick={togglePresent} aria-label="Pantalla completa">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
          </button>
        </div>
      </header>

      {mode === 'inspect' && ready && !present && (
        <>
          <aside className={`panel tree-panel ${treeOpen ? 'open' : ''}`}>
            <div className="panel-head">
              <span className="eyebrow">Árbol de sistemas</span>
              <button className="icon-btn sm" onClick={() => setTreeOpen(false)} aria-label="Cerrar árbol">×</button>
            </div>
            {v?.root && <Tree viewer={v} root={v.root} sel={sel} onChange={rerender} interiorReady={interiorReady} />}
          </aside>
          {!treeOpen && <button className="fab fab-left" onClick={() => setTreeOpen(true)}>Sistemas</button>}

          {sel && infoOpen && v && <Info viewer={v} n={sel} onClose={() => { v.select(null); }} onChange={rerender} />}

          <Instrument
            explode={explodeUI} onExplode={onSlider} onAnimate={animateExplode}
            xray={xray} setXray={setXray} labels={labels} setLabels={setLabels} guides={guides} setGuides={setGuides}
            section={section} setSection={setSection} walk={walk} viewer={v!} interiorReady={interiorReady}
            ortho={ortho} setOrtho={setOrtho}
          />
          {walk && <WalkPad viewer={v!} />}
          <div className="stats mono">{stats.fps} fps · {stats.calls} llamadas · {(stats.tris / 1000).toFixed(0)} k tri{!interiorReady && ' · cargando interior…'}</div>
          {hover.n && !walk && (
            <div className="hover-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }}>
              <span className="mono">{hover.n.code}</span> {hover.n.label}
            </div>
          )}
        </>
      )}

      {mode === 'story' && v && <Story viewer={v} onExplode={setExplodeSilently} />}
      {mode === 'plans' && <Plans />}
      {mode === 'spec' && <SpecSheet />}
      {present && <div className="present-hint">Pulsa <kbd>Esc</kbd> para salir del modo presentación</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Loader
function Loader({ stage, p }: { stage: string; p: number }) {
  return (
    <div className="loader">
      <div className="loader-inner">
        <p className="eyebrow">Varro-Lindqvist Astronautics</p>
        <h1 className="display sm">ALCIÓN <span className="desig">HX-4</span></h1>
        <div className="bar"><div style={{ transform: `scaleX(${Math.max(0.02, p)})` }} /></div>
        <p className="mono small">{stage} · {Math.round(p * 100)} %</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Árbol
function Tree({ viewer, root, sel, onChange, interiorReady }: { viewer: Viewer; root: PartNode; sel: PartNode | null; onChange: () => void; interiorReady: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['ALCION']));
  const listRef = useRef<HTMLDivElement>(null);

  // abrir la rama de la selección
  useEffect(() => {
    if (!sel) return;
    const s = new Set(open);
    let p = sel.parent;
    while (p) { s.add(p.code); p = p.parent; }
    setOpen(s);
    requestAnimationFrame(() => listRef.current?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' }));
  }, [sel]);

  const results = useMemo(() => {
    if (q.trim().length < 2) return null;
    const qq = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const out: PartNode[] = [];
    for (const n of viewer.nodes.values()) {
      if (norm(n.label).includes(qq) || norm(n.code).includes(qq) || norm(n.desc).includes(qq)) out.push(n);
      if (out.length > 120) break;
    }
    return out;
  }, [q, viewer.nodes.size, interiorReady]);

  const toggle = (c: string) => { const s = new Set(open); s.has(c) ? s.delete(c) : s.add(c); setOpen(s); };
  const rows: JSX.Element[] = [];
  const walkTree = (n: PartNode, lvl: number) => {
    const hasKids = n.children.length > 0;
    const isOpen = open.has(n.code);
    rows.push(
      <div key={n.code} className={`row ${sel === n ? 'sel' : ''} ${n.hidden ? 'dim' : ''}`} style={{ paddingLeft: 8 + lvl * 14 }}
        onClick={() => viewer.select(n)} onDoubleClick={() => viewer.select(n, true)}>
        <button className="caret" aria-label={isOpen ? 'Contraer' : 'Expandir'} style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          onClick={(e) => { e.stopPropagation(); toggle(n.code); }}>{isOpen ? '▾' : '▸'}</button>
        <span className="row-label">{n.label}</span>
        <span className="row-count mono">{n.parts > 1 ? n.parts : ''}</span>
        {n.depth > 0 && (
          <button className="eye" aria-label={n.hidden ? 'Mostrar' : 'Ocultar'} title={n.hidden ? 'Mostrar' : 'Ocultar'}
            onClick={(e) => { e.stopPropagation(); viewer.setHidden(n, !n.hidden); onChange(); }}>
            {n.hidden ? <EyeOff /> : <Eye />}
          </button>
        )}
      </div>,
    );
    if (hasKids && isOpen) for (const c of n.children) walkTree(c, lvl + 1);
  };
  if (!results) walkTree(root, 0);

  return (
    <div className="tree">
      <div className="search">
        <input placeholder="Buscar componente, código o función…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar componentes" />
        {q && <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Limpiar">×</button>}
      </div>
      <div className="tree-list" ref={listRef}>
        {results ? (
          results.length ? results.map((n) => (
            <div key={n.code} className={`row result ${sel === n ? 'sel' : ''}`} onClick={() => viewer.select(n, true)}>
              <span className="row-label">{n.label}</span><span className="row-code mono">{n.code}</span>
            </div>
          )) : <p className="empty">Sin coincidencias.</p>
        ) : rows}
      </div>
      <div className="tree-foot mono">{viewer.nodes.size} nodos · {root.parts} piezas{!interiorReady ? ' (interior cargando)' : ''}</div>
    </div>
  );
}

const Eye = () => <svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" stroke="currentColor" strokeWidth="1.5" fill="none" /><circle cx="12" cy="12" r="2.6" fill="currentColor" /></svg>;
const EyeOff = () => <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 3l18 18M10.6 6.1A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.2 7.6C3.6 9.4 2 12 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4.2-.9" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>;

// ---------------------------------------------------------------- Ficha de pieza
function Info({ viewer, n, onClose, onChange }: { viewer: Viewer; n: PartNode; onClose: () => void; onChange: () => void }) {
  const crumbs: PartNode[] = [];
  let p: PartNode | null = n;
  while (p) { crumbs.unshift(p); p = p.parent; }
  const size = n.box0.getSize(new THREE.Vector3());
  // tamaño en ejes Blender (X proa, Y babor, Z cenit)
  const dims = [size.x, size.z, size.y];
  return (
    <aside className="panel info-panel open">
      <div className="panel-head">
        <span className="eyebrow">{n.kind === 'part' ? 'Pieza' : n.depth === 1 ? 'Módulo' : n.depth === 2 ? 'Sistema' : 'Conjunto'} · nivel {n.depth}</span>
        <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar ficha">×</button>
      </div>
      <nav className="crumbs">
        {crumbs.map((c, i) => (
          <span key={c.code}>
            <button onClick={() => viewer.select(c)} className={c === n ? 'cur' : ''}>{i === 0 ? 'Nave' : c.label}</button>
            {i < crumbs.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </nav>
      <h2 className="h2">{n.label}</h2>
      <p className="code mono">{n.code}</p>
      {n.desc && <p className="desc">{n.desc}</p>}
      {n.func && (<><p className="eyebrow mt">Función</p><p className="desc">{n.func}</p></>)}
      <dl className="kv mono">
        <dt>Envolvente (X·Y·Z)</dt><dd>{fmt(dims[0])} × {fmt(dims[1])} × {fmt(dims[2])} m</dd>
        <dt>Piezas contenidas</dt><dd>{n.parts}</dd>
        <dt>Triángulos</dt><dd>{Math.round(n.tris).toLocaleString('es-ES')}</dd>
        <dt>Subconjuntos</dt><dd>{n.children.length}</dd>
      </dl>
      {n.materials.length > 0 && (
        <>
          <p className="eyebrow mt">Materiales representados</p>
          <ul className="mats">
            {n.materials.slice(0, 10).map((m) => <li key={m.name}><span className={`sw ${m.name}`} /> <span>{m.desc || m.name}</span></li>)}
            {n.materials.length > 10 && <li className="muted">+ {n.materials.length - 10} más</li>}
          </ul>
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={() => viewer.focus(n)}>Enfocar</button>
        <button className={`btn ${viewer.isolate === n ? 'active' : ''}`} onClick={() => { viewer.setIsolate(viewer.isolate === n ? null : n); onChange(); }}>{viewer.isolate === n ? 'Salir de aislamiento' : 'Aislar'}</button>
        <button className="btn" onClick={() => { viewer.setHidden(n, true); viewer.select(null); onChange(); }}>Ocultar</button>
        {n.parent && <button className="btn" onClick={() => viewer.select(n.parent)}>Subir nivel</button>}
      </div>
      {n.children.length > 0 && (
        <>
          <p className="eyebrow mt">Contiene</p>
          <ul className="kids">
            {n.children.slice(0, 30).map((c) => <li key={c.code}><button onClick={() => viewer.select(c, true)}>{c.label}</button><span className="mono muted">{c.parts > 1 ? c.parts : ''}</span></li>)}
            {n.children.length > 30 && <li className="muted">+ {n.children.length - 30} más</li>}
          </ul>
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- Instrumento inferior
function Instrument(props: {
  explode: number; onExplode: (x: number) => void; onAnimate: (x: number) => void;
  xray: boolean; setXray: (b: boolean) => void; labels: boolean; setLabels: (b: boolean) => void; guides: boolean; setGuides: (b: boolean) => void;
  section: { on: boolean; axis: Axis; pos: number; flip: boolean }; setSection: (s: any) => void; walk: boolean; viewer: Viewer; interiorReady: boolean;
  ortho: boolean; setOrtho: (b: boolean) => void;
}) {
  const { explode, onExplode, onAnimate, section, setSection, viewer } = props;
  const [tool, setTool] = useState<'explode' | 'section' | 'views' | 'interior'>('explode');
  const range = section.axis === 'x' ? [-6.5, 13.3] : section.axis === 'y' ? [-2.4, 2.4] : [-2.4, 2.6];
  const stage = STAGE_LABELS.reduce((a, s) => (explode >= s.at - 0.001 ? s : a), STAGE_LABELS[0]);
  return (
    <div className="instrument">
      <div className="tool-tabs">
        {([['explode', 'Explosión'], ['section', 'Sección'], ['views', 'Vistas'], ['interior', 'Interior']] as const).map(([id, l]) => (
          <button key={id} className={tool === id ? 'on' : ''} onClick={() => setTool(id)}>{l}</button>
        ))}
        <span className="spacer" />
        <label className="chk"><input type="checkbox" checked={props.xray} onChange={(e) => props.setXray(e.target.checked)} /> Rayos X</label>
        <label className="chk"><input type="checkbox" checked={props.labels} onChange={(e) => props.setLabels(e.target.checked)} /> Etiquetas</label>
        <label className="chk hide-sm"><input type="checkbox" checked={props.guides} onChange={(e) => props.setGuides(e.target.checked)} /> Guías</label>
      </div>

      {tool === 'explode' && (
        <div className="tool explode-tool">
          <div className="readout">
            <span className="big mono">{Math.round(explode * 100).toString().padStart(3, ' ')}<small>%</small></span>
            <span className="stage">{stage.t}</span>
          </div>
          <div className="slider-wrap">
            <input type="range" min={0} max={1} step={0.001} value={explode} aria-label="Vista explosionada"
              onChange={(e) => onExplode(parseFloat(e.target.value))} style={{ ['--p' as any]: explode }} />
            <div className="ticks">
              {STAGE_LABELS.map((s) => (
                <button key={s.at} style={{ left: `${s.at * 100}%` }} className={explode >= s.at - 0.001 ? 'past' : ''} onClick={() => onAnimate(s.at)}>
                  <i /><span>{Math.round(s.at * 100)}<em> · {s.t}</em></span>
                </button>
              ))}
            </div>
          </div>
          <div className="btns">
            <button className="btn" onClick={() => onAnimate(explode < 0.5 ? 1 : 0)}>{explode < 0.5 ? 'Explosionar' : 'Ensamblar'}</button>
            <button className="btn ghost" onClick={() => { onAnimate(0); viewer.showAll(); viewer.select(null); props.setXray(false); setSection({ ...section, on: false }); viewer.viewPreset('iso'); }}>Restablecer</button>
          </div>
        </div>
      )}

      {tool === 'section' && (
        <div className="tool section-tool">
          <label className="chk"><input type="checkbox" checked={section.on} onChange={(e) => setSection({ ...section, on: e.target.checked, pos: section.pos })} /> Corte activo</label>
          <div className="seg">
            {(['x', 'y', 'z'] as Axis[]).map((a) => (
              <button key={a} className={section.axis === a ? 'on' : ''} onClick={() => setSection({ ...section, on: true, axis: a, pos: a === 'x' ? 4.7 : 0 })}>
                {a === 'x' ? 'Transversal' : a === 'y' ? 'Longitudinal' : 'Horizontal'}
              </button>
            ))}
          </div>
          <input type="range" min={range[0]} max={range[1]} step={0.01} value={section.pos} aria-label="Posición del plano de corte"
            onChange={(e) => setSection({ ...section, on: true, pos: parseFloat(e.target.value) })} style={{ ['--p' as any]: (section.pos - range[0]) / (range[1] - range[0]) }} />
          <span className="mono readout-sm">{section.axis.toUpperCase()} = {fmt(section.pos)} m</span>
          <button className="btn ghost" onClick={() => setSection({ ...section, flip: !section.flip, on: true })}>Invertir</button>
        </div>
      )}

      {tool === 'views' && (
        <div className="tool views-tool">
          {([['iso', 'Isométrica'], ['front', 'Frontal'], ['side', 'Lateral'], ['top', 'Superior'], ['bottom', 'Inferior'], ['rear', 'Posterior']] as const).map(([id, l]) => (
            <button key={id} className="btn" onClick={() => viewer.viewPreset(id, props.ortho && id !== 'iso')}>{l}</button>
          ))}
          <label className="chk"><input type="checkbox" checked={props.ortho} onChange={(e) => props.setOrtho(e.target.checked)} /> Cuasi-ortográfica</label>
        </div>
      )}

      {tool === 'interior' && (
        <div className="tool interior-tool">
          {!props.interiorReady ? <span className="muted">Cargando interior…</span> : (
            <>
              {WAYPOINTS.map((w) => (
                <button key={w.id} className="btn" onClick={() => (props.walk ? viewer.goWaypoint(w) : viewer.setWalk(true, w))}>{w.label}</button>
              ))}
              {props.walk && <button className="btn active" onClick={() => viewer.setWalk(false)}>Salir del interior</button>}
              <span className="muted small hide-sm">Arrastra para mirar · WASD para moverte · Q/E bajar/subir</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WalkPad({ viewer }: { viewer: Viewer }) {
  const hold = (k: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); viewer.walkInput(k, true); },
    onPointerUp: () => viewer.walkInput(k, false),
    onPointerLeave: () => viewer.walkInput(k, false),
  });
  return (
    <div className="walkpad" aria-label="Controles de desplazamiento interior">
      <button {...hold('w')}>▲</button>
      <div><button {...hold('a')}>◀</button><button {...hold('s')}>▼</button><button {...hold('d')}>▶</button></div>
      <div><button {...hold('q')}>Bajar</button><button {...hold('e')}>Subir</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- Presentación ligada al scroll
function Story({ viewer, onExplode }: { viewer: Viewer; onExplode: (x: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.clientHeight;
    const f = Math.min(STORY.length - 1, Math.max(0, el.scrollTop / h));
    const i = Math.floor(f), j = Math.min(STORY.length - 1, i + 1);
    let k = f - i;
    k = k * k * (3 - 2 * k);
    const a = STORY[i], b = STORY[j];
    const lerp = (x: number[], y: number[]) => new THREE.Vector3(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k);
    viewer.stopTween();
    viewer.camera.position.copy(lerp(a.cam, b.cam));
    viewer.controls.target.copy(lerp(a.tgt, b.tgt));
    viewer.camera.lookAt(viewer.controls.target);
    const ex = a.ex + (b.ex - a.ex) * k;
    viewer.setExplode(ex);
    onExplode(ex);
    const wantX = (k < 0.5 ? a : b).xray;
    if (wantX !== viewer.xray) {
      if (wantX) viewer.selectByCode('HAB.INT'); else viewer.select(null);
      viewer.setXray(wantX);
    }
    viewer.requestRender();
  }, [viewer]);
  useEffect(() => {
    viewer.setSection(false);
    apply();
    return () => { viewer.setXray(false); viewer.select(null); };
  }, []);
  return (
    <div className="story" ref={ref} onScroll={apply}>
      {STORY.map((s, i) => (
        <section key={s.id} className={`story-sec ${i % 2 ? 'right' : ''}`}>
          <div className="story-card">
            <p className="eyebrow">{s.eyebrow}</p>
            <h2 className={i === 0 ? 'display' : 'h1'}>{s.h}</h2>
            <p className="lede">{s.d}</p>
            {i === 0 && <p className="scroll-hint mono">Desplázate para recorrer el vehículo ↓</p>}
          </div>
        </section>
      ))}
      <div className="story-progress" aria-hidden>{STORY.map((s) => <i key={s.id} />)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Planos
function Plans() {
  const [cur, setCur] = useState(BLUEPRINTS[0].id);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setZ({ s: 1, x: 0, y: 0 }), [cur]);
  return (
    <div className="sheet plans">
      <aside className="plans-nav">
        <p className="eyebrow">Planos conceptuales</p>
        {BLUEPRINTS.map((b, i) => (
          <button key={b.id} className={cur === b.id ? 'on' : ''} onClick={() => setCur(b.id)}>
            <span className="mono">{String(i + 1).padStart(2, '0')}</span> {b.label}
          </button>
        ))}
        <p className="small muted note">Generados por proyección ortográfica directa del modelo maestro (blender/blueprints.py); las cotas provienen de blender/alcion/spec.py.</p>
        <a className="btn ghost" href={`blueprints/${cur}.png`} download>Descargar PNG</a>
      </aside>
      <div className="plan-stage"
        onWheel={(e) => setZ((p) => ({ ...p, s: Math.min(6, Math.max(1, p.s * (e.deltaY < 0 ? 1.12 : 0.89))) }))}
        onPointerDown={(e) => { drag.current = { x: e.clientX - z.x, y: e.clientY - z.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setZ((p) => ({ ...p, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y })); }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setZ({ s: 1, x: 0, y: 0 })}>
        <img src={`blueprints/${cur}.png`} alt={BLUEPRINTS.find((b) => b.id === cur)?.label} draggable={false}
          style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
        <div className="plan-help mono small">Rueda: zoom · arrastrar: desplazar · doble clic: ajustar</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Ficha técnica
function SpecSheet() {
  return (
    <div className="sheet spec">
      <div className="spec-inner">
        <header className="spec-head">
          <p className="eyebrow">{IDENTITY.maker} · Documento de concepto</p>
          <h1 className="display">{IDENTITY.name} <span className="desig">{IDENTITY.designation}</span></h1>
          <p className="lede">{IDENTITY.role}. {IDENTITY.etymology}</p>
          <p className="small muted">{IDENTITY.makerNote} Es un diseño conceptual de alta fidelidad, no un vehículo certificado. Las cifras marcadas como <em>hipótesis</em> son estimaciones de orden de magnitud.</p>
        </header>
        <section className="spec-grid">
          {SPEC.map((b) => (
            <div key={b.title} className="spec-block">
              <h3 className="h3">{b.title}</h3>
              <dl>
                {b.rows.map((r) => (
                  <div key={r.k} className="spec-row"><dt>{r.k}</dt><dd className="mono">{r.v}</dd>{r.note && <span className={`tag ${r.note}`}>{r.note}</span>}</div>
                ))}
              </dl>
            </div>
          ))}
        </section>
        <section className="profile">
          <h3 className="h2">Perfil de misión</h3>
          <ol>
            {PROFILE.map((p) => <li key={p.h}><span className="mono t">{p.t}</span><div><strong>{p.h}</strong><p>{p.d}</p></div></li>)}
          </ol>
        </section>
        <section className="philosophy">
          <h3 className="h2">Filosofía de diseño</h3>
          <div className="phil-grid">
            {PHILOSOPHY.map((p, i) => <div key={p.h} className={i === 0 ? 'wide' : ''}><h4>{p.h}</h4><p>{p.d}</p></div>)}
          </div>
        </section>
        <section className="sources">
          <h3 className="h2">Fuentes consultadas</h3>
          <p className="small muted">Las fuentes sustentan principios establecidos (estándar IDSS, arquitectura ECLSS, blindaje Whipple, MLI, SEP, protección radiológica). La configuración, las dimensiones y la integración del ALCIÓN son hipótesis de diseño propias.</p>
          <ul>{SOURCES.map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noreferrer">{s.t}</a></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
