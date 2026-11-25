/**
 * Misiones interactivas. Cada paso tiene una condición comprobada sobre el
 * estado real del simulador; ninguna misión avanza por pulsar «siguiente».
 */
import type { Engine } from './Engine';
import type { SwitchId } from './ship/Systems';

export interface Step { text: string; hint?: string; check: (e: Engine, dt: number) => boolean; enter?: (e: Engine) => void; }
export interface Mission { id: string; title: string; brief: string; mode: 'INTERIOR' | 'FLIGHT' | 'EVA' | 'SANDBOX'; setup: (e: Engine) => void; steps: Step[]; }

const sw = (e: Engine, ...ids: SwitchId[]) => ids.every((i) => e.systems.sw[i]);

export const MISSIONS: Mission[] = [
  {
    id: 'activacion', title: 'Activación de la nave', mode: 'INTERIOR',
    brief: 'La nave está apagada y fría. Lleva la cabina desde la oscuridad total hasta el estado operativo usando el panel cenital de la Bahía A.',
    setup: (e) => { e.systems.coldStart(); e.enterInterior('cabina'); },
    steps: [
      { text: 'Conecta la BATERÍA MAESTRA (fila 1 del panel cenital, Bahía A).', hint: 'Mira al techo de la cabina y pulsa G o haz clic sobre la palanca.', check: (e) => sw(e, 'BAT') },
      { text: 'Conecta los buses A y B.', check: (e) => sw(e, 'BUSA', 'BUSB') },
      { text: 'Enciende la iluminación de la Bahía A.', check: (e) => e.systems.on('LT_A') },
      { text: 'Arranca la aviónica y espera a que las pantallas terminen la autoprueba.', check: (e) => e.systems.booted },
      { text: 'Activa soporte vital, ventilación y bombeo térmico.', check: (e) => e.systems.on('ECLSS') && e.systems.on('FANS') && e.systems.on('THERM') },
      { text: 'Conecta las alas solares y comprueba que la batería se carga (página ENERGÍA).', check: (e) => e.systems.on('SOLAR') && e.systems.solarKW > 1 },
      { text: 'Activa navegación y comunicaciones.', check: (e) => e.systems.on('NAV') && e.systems.on('COMM') },
      { text: 'Arma el RCS y los motores. La nave está operativa: siéntate en el puesto del comandante.', check: (e) => sw(e, 'RCS', 'MAIN') && e.seated },
    ],
  },
  {
    id: 'rutina', title: 'Un día a bordo', mode: 'INTERIOR',
    brief: 'Rutina diaria de un tripulante: hidratarse, comer, entrenar, asearse, cuidar el cultivo, hacer ciencia y observar la Tierra antes de dormir. Camina por la nave (o flota) y usa G sobre cada equipo.',
    setup: (e) => { e.enterInterior('cq'); e.crew.log.clear(); },
    steps: [
      { text: 'Bebe agua en el dispensador de la cocina (Bahía D, popa).', hint: 'Mira la cocina y pulsa G. Las bolsas de bebida sueltas también sirven.', check: (e) => e.crew.log.has('drink') },
      { text: 'Prepara y come una ración en la cocina.', check: (e) => e.crew.log.has('eat') },
      { text: 'Completa una sesión de ejercicio en el cicloergómetro (suelo de la Bahía D). Observa cómo sube el CO₂.', check: (e) => e.crew.log.has('exercise') },
      { text: 'Aséate en el compartimento de higiene.', check: (e) => e.crew.log.has('hygiene') },
      { text: 'Riega y revisa la unidad de cultivo del laboratorio (Bahía B).', check: (e) => e.crew.log.has('plants') },
      { text: 'Realiza un experimento en la guantera y guarda la muestra en el congelador a −80 °C.', check: (e) => e.crew.stored > 0 && e.crew.log.has('sample') },
      { text: 'Observa la Tierra unos segundos por las ventanas de nadir del laboratorio.', hint: 'Colócate sobre los pozos de ventana del suelo del laboratorio y mira hacia abajo.', check: (e) => e.crew.log.has('earth') },
    ],
  },
  {
    id: 'acoplamiento', title: 'Acoplamiento con la estación Tesela', mode: 'FLIGHT',
    brief: 'Aproxímate al puerto de la estación ficticia Tesela y atraca con el sistema IDSS. Captura: distancia < 0,6 m, velocidad de cierre < 0,25 m/s, desalineación < 6°.',
    setup: (e) => { e.placeNear('tesela', 140); e.systems.sw.DOCK = true; e.setMode('FLIGHT'); },
    steps: [
      { text: 'Activa el sistema de atraque (DOCK) si no lo está y extiende el anillo de captura.', check: (e) => e.systems.on('DOCK') },
      { text: 'Acércate a menos de 30 m del puerto (marcador verde). Usa la página ATRAQUE o el HUD.', check: (e) => (e.dockInfo()?.range ?? 1e9) < 30 },
      { text: 'Alinea la nave con el eje del puerto (< 6°) y reduce la velocidad de cierre (< 0,25 m/s).', check: (e) => { const d = e.dockInfo(); return !!d && d.range < 8 && d.angle < 6 && d.closing < 0.25; } },
      { text: 'Contacto y captura.', check: (e) => e.flight.docked === 'tesela' },
    ],
  },
  {
    id: 'inspeccion', title: 'Inspección del observatorio Halo-7', mode: 'FLIGHT',
    brief: 'Fotografía los tres puntos de inspección del observatorio ficticio Halo-7 (balizas verdes) desde menos de 25 m.',
    setup: (e) => { e.placeNear('halo7', 120); e.setMode('FLIGHT'); e.photoTargets = [0, 1, 2]; },
    steps: [
      { text: 'Aproxímate a menos de 40 m del observatorio.', check: (e) => e.rangeTo('halo7') < 40 },
      { text: 'Fotografía los 3 puntos de inspección (P) con la baliza en el centro del encuadre, a < 25 m.', check: (e) => e.photoTargets.length === 0 },
    ],
  },
  {
    id: 'captura', title: 'Captura de la cápsula de muestras', mode: 'FLIGHT',
    brief: 'Una cápsula de muestras lanzada desde la superficie flota cerca. Acércate, despliega el brazo robótico y captúrala con el efector terminal.',
    setup: (e) => { e.placeNear('canister', 30); e.setMode('FLIGHT'); },
    steps: [
      { text: 'Lleva la cápsula a menos de 9 m del brazo (zona superior del módulo habitable).', check: (e) => e.canisterArmDist() < 9 },
      { text: 'Detén la nave (B) y abre la consola del brazo para ordenar «Capturar».', check: (e) => e.mech.grabbed === 'canister' },
      { text: 'Guarda el brazo (posición de estiba) con la muestra asegurada.', check: (e) => e.mech.grabbed === 'canister' && e.mech.joints.every((j) => Math.abs(j.target) < 0.01) && e.mech.armBusy === 0 },
    ],
  },
  {
    id: 'averia', title: 'Diagnóstico: CO₂ en aumento', mode: 'INTERIOR',
    brief: 'El ventilador del sistema de eliminación de CO₂ se ha detenido. Diagnostica la avería y repárala antes de que el CO₂ supere 0,53 kPa.',
    setup: (e) => { e.enterInterior('servicios'); e.systems.raise('cdra_fan'); e.audio.beep('alarm'); },
    steps: [
      { text: 'Consulta la página SOPORTE VITAL en cualquier pantalla para localizar la avería.', check: (e) => e.viewedPage === 'ECLSS' },
      { text: 'Ve al bastidor cenital de la Bahía D y mantén pulsada la interacción para reiniciar el ventilador.', check: (e) => !e.systems.active('cdra_fan') },
      { text: 'Comprueba que el CO₂ desciende por debajo de 0,45 kPa.', check: (e) => e.systems.co2 < 0.45 },
    ],
  },
  {
    id: 'eva', title: 'Mantenimiento exterior (EVA)', mode: 'EVA',
    brief: 'Un micrometeoroide ha dañado un panel del escudo. Sal por la esclusa, localiza el panel marcado y fija un parche térmico.',
    setup: (e) => { e.systems.raise('mmod_panel'); e.enterInterior('esclusa'); },
    steps: [
      { text: 'Entra en la esclusa y usa su panel de control para despresurizarla.', check: (e) => e.airlock === 'vac' },
      { text: 'Sal al exterior.', check: (e) => e.player.eva },
      { text: 'Desplázate hasta el panel dañado (marca ámbar, anillo 2) y mantén la interacción para repararlo.', check: (e) => !e.systems.active('mmod_panel') },
      { text: 'Regresa a la esclusa y represurízala.', check: (e) => !e.player.eva && e.airlock === 'pres' },
    ],
  },
  {
    id: 'foto', title: 'Fotografía científica desde la cúpula', mode: 'INTERIOR',
    brief: 'Abre las contraventanas de la cúpula y toma una fotografía de la Tierra (o de la Luna) con el planeta en el encuadre.',
    setup: (e) => { e.enterInterior('cupula'); },
    steps: [
      { text: 'Comprueba que las contraventanas están abiertas (interactúa con una para abrirlas/cerrarlas).', check: (e) => e.shuttersOpen() },
      { text: 'Encuadra la Tierra o la Luna desde la cúpula y pulsa P.', check: (e) => e.scienceShot },
    ],
  },
];

export class MissionRunner {
  active: Mission | null = null;
  step = 0;
  done = new Set<string>();
  onChange: () => void = () => {};

  start(e: Engine, id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m) return;
    this.active = m; this.step = 0;
    m.setup(e);
    m.steps[0]?.enter?.(e);
    e.audio.comms('Control a Alción: ' + m.title);
    this.onChange();
  }
  abort() { this.active = null; this.onChange(); }

  update(e: Engine, dt: number) {
    const m = this.active;
    if (!m) return;
    const s = m.steps[this.step];
    if (s && s.check(e, dt)) {
      this.step++;
      e.audio.beep('ok');
      if (this.step >= m.steps.length) {
        this.done.add(m.id);
        e.audio.comms('Misión completada. Buen trabajo, Alción.');
        e.toast(`Misión completada: ${m.title}`);
        this.active = null;
      } else m.steps[this.step].enter?.(e);
      this.onChange();
    }
  }

  current() {
    const m = this.active;
    if (!m) return null;
    return { title: m.title, step: m.steps[this.step]?.text ?? '', hint: m.steps[this.step]?.hint ?? '', progress: `Paso ${this.step + 1} de ${m.steps.length}` };
  }
}
