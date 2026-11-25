/**
 * Tripulante en primera persona: necesidades básicas, reloj de misión y actividades.
 *
 * Escala temporal: la vida a bordo transcurre en horas, así que las necesidades usan
 * un reloj de misión acelerado (por defecto ×60: 1 s real = 1 min de misión). Los
 * ritmos son órdenes de magnitud plausibles para un adulto en vuelo (≈2,5 L de agua y
 * ≈2 500 kcal al día, ~16 h de vigilia, ~2 h de ejercicio diario como en la ISS), no
 * un modelo fisiológico validado.
 */
import { clamp } from '../util';

export type NeedId = 'hydration' | 'nutrition' | 'energy' | 'hygiene' | 'morale';
export const NEED_LABEL: Record<NeedId, string> = {
  hydration: 'Hidratación', nutrition: 'Nutrición', energy: 'Descanso', hygiene: 'Higiene', morale: 'Ánimo',
};

export type ActivityId = 'drink' | 'eat' | 'sleep' | 'exercise' | 'hygiene' | 'plants' | 'science' | 'sample' | 'read';

export interface Activity {
  id: ActivityId;
  /** texto del aviso (verbo) */
  prompt: string;
  /** texto mientras se realiza */
  doing: string;
  /** duración real (s) de la animación de la actividad */
  dur: number;
  /** minutos de misión consumidos */
  minutes: number;
  effects: Partial<Record<NeedId, number>>;
  /** multiplicador metabólico (CO₂, calor) mientras dura */
  metabolic?: number;
  sound?: 'water' | 'heat' | 'exercise' | 'zip' | 'wipe';
  result: string;
}

export const ACTIVITIES: Record<ActivityId, Activity> = {
  drink: { id: 'drink', prompt: 'Beber agua (dispensador)', doing: 'Llenando la bolsa de bebida…', dur: 3, minutes: 3, effects: { hydration: 35 }, sound: 'water', result: 'Has bebido 0,4 L de agua recuperada.' },
  eat: { id: 'eat', prompt: 'Preparar y comer una ración', doing: 'Rehidratando y calentando la ración…', dur: 7, minutes: 25, effects: { nutrition: 45, hydration: 8, morale: 4 }, sound: 'heat', result: 'Ración consumida (≈700 kcal).' },
  sleep: { id: 'sleep', prompt: 'Dormir en el saco (8 h)', doing: 'Durmiendo…', dur: 5, minutes: 480, effects: { energy: 100, morale: 6, hydration: -14, nutrition: -10, hygiene: -8 }, sound: 'zip', result: 'Has dormido 8 horas.' },
  exercise: { id: 'exercise', prompt: 'Sesión de ejercicio (cicloergómetro)', doing: 'Pedaleando: frecuencia cardiaca 142 lpm…', dur: 9, minutes: 60, effects: { energy: -14, morale: 10, hygiene: -22, hydration: -12, nutrition: -6 }, metabolic: 4, sound: 'exercise', result: 'Ejercicio completado: 60 min. El CO₂ de cabina sube mientras entrenas.' },
  hygiene: { id: 'hygiene', prompt: 'Aseo personal', doing: 'Toallitas, champú sin aclarado y cepillado…', dur: 5, minutes: 15, effects: { hygiene: 65, morale: 3 }, sound: 'wipe', result: 'Aseo completado.' },
  plants: { id: 'plants', prompt: 'Cuidar el cultivo (riego y revisión)', doing: 'Regando por mecha capilar y revisando hojas…', dur: 4, minutes: 10, effects: { morale: 7 }, sound: 'water', result: 'Cultivo revisado: crecimiento normal.' },
  science: { id: 'science', prompt: 'Realizar experimento en la guantera', doing: 'Manipulando la muestra a través de los guantes…', dur: 8, minutes: 45, effects: { energy: -5, morale: 3 }, sound: 'wipe', result: 'Experimento completado: 1 muestra lista para congelar.' },
  sample: { id: 'sample', prompt: 'Guardar muestra en el congelador (−80 °C)', doing: 'Abriendo el cajón y registrando la muestra…', dur: 3, minutes: 5, effects: {}, sound: 'zip', result: 'Muestra almacenada a −80 °C.' },
  read: { id: 'read', prompt: 'Leer el registro y el plan del día', doing: 'Revisando el plan de actividades…', dur: 3, minutes: 10, effects: { morale: 2 }, result: 'Plan del día revisado.' },
};

/** Ritmos de cambio por minuto de misión en vigilia */
const RATE: Record<NeedId, number> = { hydration: -0.10, nutrition: -0.07, energy: -0.07, hygiene: -0.04, morale: 0 };

export class Crew {
  needs: Record<NeedId, number> = { hydration: 72, nutrition: 60, energy: 78, hygiene: 70, morale: 75 };
  /** minutos de misión desde el lanzamiento (día 12, 07:30) */
  clock = (11 * 24 + 7.5) * 60;
  timeScale = 60;
  samples = 0;
  stored = 0;
  /** Modo exploración libre: congela el desgaste de necesidades fisiológicas. */
  freeExplore = false;
  /** registro de actividades realizadas hoy (para la rutina) */
  log = new Set<ActivityId | 'earth'>();
  private warned = new Set<string>();

  /** avance continuo (dt real) */
  step(dt: number, ctx: { inCupolaLookingAtEarth: boolean }, warn: (msg: string) => void) {
    const min = dt * this.timeScale / 60;
    this.clock += min;
    if (this.freeExplore) {
      if (ctx.inCupolaLookingAtEarth) this.log.add('earth');
      return;
    }
    for (const k of Object.keys(RATE) as NeedId[]) this.needs[k] = clamp(this.needs[k] + RATE[k] * min, 0, 100);
    // el ánimo tiende a la media de las demás necesidades
    const mean = (this.needs.hydration + this.needs.nutrition + this.needs.energy + this.needs.hygiene) / 4;
    this.needs.morale = clamp(this.needs.morale + (mean - this.needs.morale) * 0.004 * min, 0, 100);
    if (ctx.inCupolaLookingAtEarth) {
      this.needs.morale = clamp(this.needs.morale + 0.5 * min, 0, 100);
      this.log.add('earth');
    }
    const lows: [NeedId, number, string][] = [['hydration', 25, 'Tienes sed: bebe agua en la cocina (Bahía D).'], ['nutrition', 20, 'Tienes hambre: prepara una ración en la cocina.'], ['energy', 18, 'Estás agotado: duerme en tu habitáculo (Bahía C).'], ['hygiene', 15, 'Necesitas asearte (compartimento de higiene, Bahía D).']];
    for (const [k, th, msg] of lows) {
      if (this.needs[k] < th && !this.warned.has(k)) { this.warned.add(k); warn(msg); }
      if (this.needs[k] > th + 15) this.warned.delete(k);
    }
  }

  /** ¿Se puede realizar? Devuelve el motivo si no. */
  can(id: ActivityId): string | null {
    if (this.freeExplore) {
      if (id === 'sample' && this.samples === 0) return 'No hay muestras pendientes: realiza antes un experimento en la guantera.';
      return null;
    }
    if (id === 'sleep' && this.needs.energy > 70) return 'Todavía no tienes sueño (descanso > 70 %).';
    if (id === 'drink' && this.needs.hydration > 95) return 'No tienes sed.';
    if (id === 'eat' && this.needs.nutrition > 90) return 'No tienes hambre.';
    if (id === 'exercise' && this.needs.energy < 20) return 'Demasiado cansado para entrenar: descansa primero.';
    if (id === 'sample' && this.samples === 0) return 'No hay muestras pendientes: realiza antes un experimento en la guantera.';
    return null;
  }

  apply(id: ActivityId) {
    const a = ACTIVITIES[id];
    for (const [k, v] of Object.entries(a.effects) as [NeedId, number][]) {
      this.needs[k] = id === 'sleep' && k === 'energy' ? 100 : clamp(this.needs[k] + v, 0, 100);
    }
    this.clock += a.minutes;
    if (id === 'science') this.samples++;
    if (id === 'sample') { this.samples--; this.stored++; }
    if (id === 'sleep') this.log.clear();
    this.log.add(id);
  }

  /** "Día 12 · 07:30" */
  clockText() {
    const d = Math.floor(this.clock / 1440) + 1;
    const m = Math.floor(this.clock % 1440);
    return `Día ${d} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  serialize() { return { needs: this.needs, clock: this.clock, samples: this.samples, stored: this.stored, log: [...this.log], freeExplore: this.freeExplore }; }
  deserialize(o: any) {
    if (!o) return;
    Object.assign(this.needs, o.needs ?? {});
    this.clock = o.clock ?? this.clock; this.samples = o.samples ?? 0; this.stored = o.stored ?? 0;
    this.log = new Set(o.log ?? []);
    this.freeExplore = !!o.freeExplore;
  }
}
