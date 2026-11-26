/**
 * Misiones interactivas. Cada paso tiene una condición comprobada sobre el
 * estado real del simulador; ninguna misión avanza por pulsar «siguiente».
 */
import type { Engine } from './Engine';
import type { SwitchId } from './ship/Systems';

export interface Step { text: string; hint?: string; check: (e: Engine, dt: number) => boolean; enter?: (e: Engine) => void; }
export interface Mission { id: string; title: string; brief: string; mode: 'INTERIOR' | 'FLIGHT' | 'EVA' | 'SANDBOX'; setup: (e: Engine) => void; steps: Step[]; }

const sw = (e: Engine, ...ids: SwitchId[]) => ids.every((i) => e.systems.sw[i]);

/** Estado auxiliar para el reinicio eléctrico del ventilador CDRA en la misión «averia». */
let cdraBreakerCycledOff = false;

export const MISSIONS: Mission[] = [
  {
    id: 'activacion', title: 'Activación de la nave', mode: 'INTERIOR',
    brief: 'La nave está apagada y fría. Lleva la cabina desde la oscuridad total hasta el estado operativo usando las consolas laterales de la Bahía A (babor: potencia e iluminación; estribor: sistemas y propulsión).',
    setup: (e) => { e.systems.coldStart(); e.enterInterior('cabina'); },
    steps: [
      {
        text: 'Conecta la BATERÍA MAESTRA (BAT) en la consola lateral de babor.',
        hint: 'En la Bahía A, mira a la consola lateral de babor (izquierda mirando a proa), fila interior (Potencia), primer interruptor a popa. Apunta y pulsa G o clic.',
        check: (e) => sw(e, 'BAT'),
      },
      {
        text: 'Conecta los buses de 120 V (BUSA y BUSB).',
        hint: 'Consola lateral de babor (izquierda), fila interior (Potencia), los dos interruptores inmediatamente a proa de BAT.',
        check: (e) => sw(e, 'BUSA', 'BUSB'),
      },
      {
        text: 'Enciende la iluminación de la Bahía A (LT_A).',
        hint: 'Consola lateral de babor (izquierda), fila exterior (Iluminación), primer interruptor a popa (LT_A).',
        check: (e) => e.systems.on('LT_A'),
      },
      {
        text: 'Arranca la aviónica (AVX) y espera a que las pantallas terminen la autoprueba.',
        hint: 'Consola lateral de babor, fila interior (Potencia), quinto interruptor (AVX). La secuencia VLA-OS tarda ~3 s.',
        check: (e) => e.systems.booted,
      },
      {
        text: 'Activa soporte vital (ECLSS), ventilación (FANS) y bombeo térmico (THERM).',
        hint: 'Cruza a la consola lateral de estribor (derecha mirando a proa), fila interior (Sistemas): los tres primeros interruptores.',
        check: (e) => e.systems.on('ECLSS') && e.systems.on('FANS') && e.systems.on('THERM'),
      },
      {
        text: 'Conecta las alas solares (SOLAR) y comprueba la carga en la página ENERGÍA.',
        hint: 'Consola lateral de babor, fila interior (Potencia), cuarto interruptor (SOLAR). Revisa la generación solar en la pantalla central C1D2 (SYS).',
        check: (e) => e.systems.on('SOLAR') && e.systems.solarKW > 1,
      },
      {
        text: 'Activa comunicaciones (COMM) y navegación (NAV).',
        hint: 'Consola lateral de estribor (derecha): COMM es el cuarto interruptor de la fila interior (Sistemas) y NAV es el último a proa de la fila exterior (Propulsión).',
        check: (e) => e.systems.on('NAV') && e.systems.on('COMM'),
      },
      {
        text: 'Arma RCS y motores (MAIN), y siéntate en el puesto del comandante.',
        hint: 'Consola lateral de estribor, fila exterior (Propulsión): activa RCS y MAIN (dos primeros). Después apunta al asiento de babor (comandante) y pulsa G o clic.',
        check: (e) => sw(e, 'RCS', 'MAIN') && e.seated,
      },
    ],
  },
  {
    id: 'rutina', title: 'Un día a bordo', mode: 'INTERIOR',
    brief: 'Rutina diaria de un tripulante: hidratarse, comer, entrenar, asearse, cuidar el cultivo, hacer ciencia y observar la Tierra. Recorre las bahías y pulsa G sobre cada equipo.',
    setup: (e) => { e.enterInterior('cq'); e.crew.log.clear(); },
    steps: [
      {
        text: 'Bebe agua en el dispensador de la cocina (Bahía D, babor).',
        hint: 'Avanza hacia popa hasta la Bahía D (Servicios). El dispensador de agua está sobre la encimera de babor (izquierda mirando a proa). Apunta y pulsa G.',
        check: (e) => e.crew.log.has('drink'),
      },
      {
        text: 'Prepara y come una ración en el calentador de alimentos (Bahía D, babor).',
        hint: 'En la misma encimera de babor de la Bahía D, justo junto al dispensador de agua. Pulsa G para calentar y consumir la ración.',
        check: (e) => e.crew.log.has('eat'),
      },
      {
        text: 'Completa una sesión de ejercicio en el cicloergómetro (Bahía D, estribor).',
        hint: 'En el lado estribor de la Bahía D (frente a la cocina). Apunta al cicloergómetro CEVIS y pulsa G; observa cómo sube el CO₂ durante el esfuerzo.',
        check: (e) => e.crew.log.has('exercise'),
      },
      {
        text: 'Aséate en el compartimento de higiene (Bahía D, estribor).',
        hint: 'Cabina cerrada en el lado estribor de la Bahía D, junto al cicloergómetro. Apunta a su puerta y pulsa G.',
        check: (e) => e.crew.log.has('hygiene'),
      },
      {
        text: 'Riega y revisa la cámara de cultivo del laboratorio (Bahía B, babor).',
        hint: 'Ve hacia proa atravesando los habitáculos (Bahía C) hasta el Laboratorio (Bahía B). La cámara hidropónica iluminada está a babor; pulsa G.',
        check: (e) => e.crew.log.has('plants'),
      },
      {
        text: 'Realiza un experimento en la guantera (Bahía B, estribor) y guarda la muestra en el congelador −80 °C (babor).',
        hint: 'Primero apunta a la guantera estanca en estribor de la Bahía B (G); al acabar, apunta al congelador −80 °C bajo la encimera de babor y pulsa G.',
        check: (e) => e.crew.stored > 0 && e.crew.log.has('sample'),
      },
      {
        text: 'Observa la Tierra unos segundos por las ventanas de nadir del laboratorio.',
        hint: 'Colócate junto a los pozos circulares de ventana en el suelo central del Laboratorio (Bahía B), o en la cúpula del Nodo, y mira directamente hacia la Tierra.',
        check: (e) => e.crew.log.has('earth'),
      },
    ],
  },
  {
    id: 'acoplamiento', title: 'Acoplamiento con la estación Tesela', mode: 'FLIGHT',
    brief: 'Aproxímate al puerto de la estación Tesela y atraca con el sistema IDSS usando la diana óptica COAS 3D y la pantalla DOCK. Captura: distancia < 0,6 m, cierre < 0,25 m/s, desalineación < 6°.',
    setup: (e) => { e.placeNear('tesela', 140); e.systems.sw.DOCK = true; e.setMode('FLIGHT'); },
    steps: [
      {
        text: 'Comprueba que el sistema de atraque (DOCK) está activo y con el anillo extendido.',
        hint: 'El interruptor DOCK está en la consola de estribor (fila Propulsión). En esta misión arranca armado.',
        check: (e) => e.systems.on('DOCK'),
      },
      {
        text: 'Acércate a menos de 30 m del puerto IDSS de Tesela.',
        hint: 'Usa W/S para avanzar o frenar, A/D y R/F para centrarte frente al anillo cian y las 4 balizas LED (verde estribor, rojo babor). B activa el frenado asistido.',
        check: (e) => (e.dockInfo()?.range ?? 1e9) < 30,
      },
      {
        text: 'Alinea el eje con la diana COAS (< 6°) a < 8 m y mantén el cierre < 0,25 m/s.',
        hint: 'Superpón la cruz adelantada COAS 3D con el centro de la placa trasera. Verifica en la pantalla DOCK (o HUD derecho) el corredor verde (< 0,25 m/s) y desalineación < 6°.',
        check: (e) => { const d = e.dockInfo(); return !!d && d.range < 8 && d.angle < 6 && d.closing < 0.25; },
      },
      {
        text: 'Contacto suave y captura dura IDSS.',
        hint: 'Con el aviso «CAPTURA LISTA», acércate suavemente (< 0,20 m/s) hasta < 0,6 m para el enganche automático.',
        check: (e) => {
          if (e.flight.docked === 'tesela') { e.audio.dockLock(); return true; }
          return false;
        },
      },
    ],
  },
  {
    id: 'inspeccion', title: 'Inspección del observatorio Halo-7', mode: 'FLIGHT',
    brief: 'Fotografía los tres puntos de inspección del observatorio Halo-7 (balizas verdes) desde menos de 25 m.',
    setup: (e) => { e.placeNear('halo7', 120); e.setMode('FLIGHT'); e.photoTargets = [0, 1, 2]; },
    steps: [
      {
        text: 'Aproxímate a menos de 40 m del observatorio Halo-7.',
        hint: 'Usa W para acercarte siguiendo el marcador de distancia en el HUD derecho y B para frenar al llegar a 30–35 m.',
        check: (e) => e.rangeTo('halo7') < 40,
      },
      {
        text: 'Fotografía las 3 balizas verdes (P) centradas en el encuadre a < 25 m.',
        hint: 'Rodea Halo-7 con A/D/R/F y centra una a una sus 3 balizas verdes (espejo superior, ala solar y escudo térmico) antes de pulsar P.',
        check: (e) => e.photoTargets.length === 0,
      },
    ],
  },
  {
    id: 'captura', title: 'Captura de la cápsula de muestras', mode: 'FLIGHT',
    brief: 'Una cápsula de muestras flota cerca. Sitúala dentro del alcance del brazo robótico dorsal, captúrala con el efector y estiba el brazo.',
    setup: (e) => { e.placeNear('canister', 30); e.setMode('FLIGHT'); },
    steps: [
      {
        text: 'Lleva la cápsula a menos de 9 m del brazo robótico (zona dorsal del módulo habitable).',
        hint: 'Busca el cilindro blanco con banda naranja y LED verde. Acércate con W/A/D/R/F situándolo por encima de la parte central-proa de la nave.',
        check: (e) => e.canisterArmDist() < 9,
      },
      {
        text: 'Detén la nave (B), abre el panel «Brazo» y ordena «Capturar cápsula».',
        hint: 'Pulsa B para anular velocidad relativa, abre el botón «Brazo» en la barra inferior y pulsa «Capturar cápsula» (asegúrate de que RBT esté encendido).',
        check: (e) => e.mech.grabbed === 'canister',
      },
      {
        text: 'Estiba el brazo robótico con la cápsula asegurada.',
        hint: 'En el panel «Brazo», pulsa «Estiba» y espera a que todas las articulaciones regresen a 0°.',
        check: (e) => e.mech.grabbed === 'canister' && e.mech.joints.every((j) => Math.abs(j.target) < 0.01) && e.mech.armBusy === 0,
      },
    ],
  },
  {
    id: 'averia', title: 'Diagnóstico: CO₂ en aumento', mode: 'INTERIOR',
    brief: 'El ventilador del eliminador de CO₂ (CDRA) se ha detenido. Consulta SOPORTE VITAL (ECLSS) para confirmar el fallo y reinicia el ventilador antes de que el CO₂ supere 0,53 kPa.',
    setup: (e) => { cdraBreakerCycledOff = false; e.enterInterior('servicios'); e.systems.raise('cdra_fan'); e.audio.beep('alarm'); },
    steps: [
      {
        text: 'Consulta la página SOPORTE VITAL (ECLSS) en una pantalla de cabina.',
        hint: 'Ve a la cabina (Bahía A) y haz clic o pulsa G sobre la pantalla C1D2, C2D2 o AUXP hasta mostrar «Soporte vital» (ECLSS).',
        check: (e) => e.viewedPage === 'ECLSS',
      },
      {
        text: 'Reinicia el ventilador del eliminador de CO₂ (CDRA).',
        hint: 'Realiza un ciclo de reinicio del interruptor FANS (apagar y volver a encender) en la consola lateral de estribor (fila Sistemas, Bahía A), o mantén G en el bastidor CDRA de la Bahía D.',
        enter: () => { cdraBreakerCycledOff = false; },
        check: (e) => {
          if (!e.systems.active('cdra_fan')) return true;
          if (!e.systems.sw.FANS) cdraBreakerCycledOff = true;
          if (cdraBreakerCycledOff && e.systems.sw.FANS) {
            e.systems.repair('cdra_fan', 3.0);
            e.toast('Ventilador CDRA reiniciado y nominal');
            return true;
          }
          return false;
        },
      },
      {
        text: 'Comprueba que el CO₂ de cabina desciende por debajo de 0,45 kPa.',
        hint: 'Mantén ECLSS y FANS encendidos y vigila el descenso del CO₂ en la barra superior de cabina o en la página ECLSS.',
        check: (e) => e.systems.co2 < 0.45,
      },
    ],
  },
  {
    id: 'eva', title: 'Mantenimiento exterior (EVA)', mode: 'EVA',
    brief: 'Un micrometeoroide ha dañado el panel MMOD R2-F14 del casco. Despresuriza la esclusa bajo el Nodo, sal en EVA, repara el panel marcado en ámbar y regresa a bordo.',
    setup: (e) => { e.systems.raise('mmod_panel'); e.enterInterior('nodo'); },
    steps: [
      {
        text: 'Cierra la escotilla interior de la esclusa y despresurízala desde su panel.',
        hint: 'En el Nodo (proa), verifica que la escotilla del pozo de esclusa (suelo) esté cerrada y pulsa G sobre el panel de la esclusa para iniciar el vacío (~6 s).',
        check: (e) => e.airlock === 'vac',
      },
      {
        text: 'Desciende por el pozo de la esclusa para salir al exterior (EVA).',
        hint: 'Con la esclusa en vacío, abre la escotilla si es necesario y baja por la escalerilla del pozo (Ctrl/C o modo Flotar) hasta atravesar la escotilla exterior.',
        check: (e) => e.player.eva,
      },
      {
        text: 'Vuela al panel dañado (marca ámbar, anillo 2) y mantén G para fijar el parche térmico.',
        hint: 'Usa WASD + Espacio/Ctrl para acercarte a < 3 m del marcador ámbar en el casco (anillo 2, zona media) y mantén pulsada la tecla G durante 3 segundos.',
        check: (e, dt) => {
          if (!e.systems.active('mmod_panel')) return true;
          if (e.player.eva && e.input.held('interact')) {
            const node = e.model.nodes.get('HAB.MMOD.R2.P14');
            if (node && e.evaBody.pos.distanceTo(node.center0) < 3.0) {
              const p = e.systems.repair('mmod_panel', dt);
              if (p >= 1) {
                e.audio.beep('ok');
                e.toast('Parche térmico fijado en panel R2-F14');
                return true;
              }
            }
          }
          return false;
        },
      },
      {
        text: 'Regresa por la escotilla exterior de la esclusa y represurízala.',
        hint: 'Vuela de vuelta bajo el nadir del Nodo (escotilla exterior de la esclusa) para entrar y pulsa G en el panel de la esclusa para represurizar (~6 s).',
        check: (e) => !e.player.eva && e.airlock === 'pres',
      },
    ],
  },
  {
    id: 'foto', title: 'Fotografía científica desde la cúpula', mode: 'INTERIOR',
    brief: 'Desde el Nodo, asciende a la cúpula de observación, verifica que las contraventanas estén abiertas y toma una fotografía científica de la Tierra o la Luna.',
    setup: (e) => { e.scienceShot = false; e.enterInterior('nodo'); },
    steps: [
      {
        text: 'Comprueba que las contraventanas de la cúpula están abiertas.',
        hint: 'En el Nodo, mira hacia la cúpula superior. Las contraventanas arrancan abiertas (puedes abrirlas/cerrarlas en Ingeniería → Mecanismos o interactuando con ellas).',
        check: (e) => e.shuttersOpen(),
      },
      {
        text: 'Asciende a la cúpula (o acércate a una ventana), encuadra la Tierra o la Luna y pulsa P.',
        hint: 'Cambia a «Flotar» (Esc → Desplazamiento) para subir cómodamente a la cúpula del Nodo, apunta hacia el planeta y pulsa P (o usa la cámara científica).',
        check: (e) => e.scienceShot || e.crew.log.has('photo'),
      },
    ],
  },
];

export interface ActiveMissionSnapshot {
  id: string;
  title: string;
  step: string;
  hint: string;
  progress: string;
  stepIndex: number;
  totalSteps: number;
  steps: string[];
}

/** Estado de lectura compartida de la misión activa para enriquecer la pantalla MFD MISSION. */
export let ACTIVE_MISSION_STATE: ActiveMissionSnapshot | null = null;

export class MissionRunner {
  active: Mission | null = null;
  step = 0;
  done = new Set<string>();
  onChange: () => void = () => {};

  private syncShared() {
    const m = this.active;
    if (!m) { ACTIVE_MISSION_STATE = null; return; }
    ACTIVE_MISSION_STATE = {
      id: m.id,
      title: m.title,
      step: m.steps[this.step]?.text ?? '',
      hint: m.steps[this.step]?.hint ?? '',
      progress: `Paso ${this.step + 1} de ${m.steps.length}`,
      stepIndex: this.step,
      totalSteps: m.steps.length,
      steps: m.steps.map((s) => s.text),
    };
  }

  start(e: Engine, id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m) return;
    this.active = m; this.step = 0;
    m.setup(e);
    m.steps[0]?.enter?.(e);
    this.syncShared();
    e.audio.comms('Control a Alción: ' + m.title);
    this.onChange();
  }
  abort() { this.active = null; this.syncShared(); this.onChange(); }

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
      this.syncShared();
      this.onChange();
    }
  }

  current() {
    const m = this.active;
    if (!m) return null;
    return {
      title: m.title,
      step: m.steps[this.step]?.text ?? '',
      hint: m.steps[this.step]?.hint ?? '',
      progress: `Paso ${this.step + 1} de ${m.steps.length}`,
      stepIndex: this.step,
      totalSteps: m.steps.length,
      steps: m.steps.map((s) => s.text),
    };
  }
}
