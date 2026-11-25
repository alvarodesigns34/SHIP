/**
 * Simulación conceptual y simplificada de los sistemas de la nave (juego, no
 * procedimiento operativo real). Cada interruptor del panel cenital alimenta
 * un consumo y produce consecuencias perceptibles (luces, pantallas,
 * ventilación, control de vuelo, atmósfera).
 */
export type SwitchId =
  | 'BAT' | 'BUSA' | 'BUSB' | 'SOLAR' | 'AVX' | 'FWD'
  | 'LT_A' | 'LT_B' | 'LT_C' | 'LT_D' | 'LT_N' | 'LT_EXT'
  | 'ECLSS' | 'FANS' | 'THERM' | 'COMM' | 'SCI' | 'HEAT'
  | 'RCS' | 'MAIN' | 'SEP' | 'RBT' | 'DOCK' | 'NAV';

export const SWITCH_LABEL: Record<SwitchId, string> = {
  BAT: 'Batería maestra', BUSA: 'Bus A 120 V', BUSB: 'Bus B 120 V', SOLAR: 'Alas solares', AVX: 'Aviónica', FWD: 'Alimentación del nodo',
  LT_A: 'Luces bahía A', LT_B: 'Luces bahía B', LT_C: 'Luces bahía C', LT_D: 'Luces bahía D', LT_N: 'Luces del nodo', LT_EXT: 'Focos exteriores',
  ECLSS: 'Soporte vital', FANS: 'Ventilación', THERM: 'Bombeo térmico', COMM: 'Comunicaciones', SCI: 'Laboratorio', HEAT: 'Calentadores',
  RCS: 'Armado RCS', MAIN: 'Armado motores', SEP: 'Propulsión eléctrica', RBT: 'Brazo robótico', DOCK: 'Sistema de atraque', NAV: 'Navegación',
};
export const SWITCH_ORDER: SwitchId[] = ['BAT', 'BUSA', 'BUSB', 'SOLAR', 'AVX', 'FWD', 'LT_A', 'LT_B', 'LT_C', 'LT_D', 'LT_N', 'LT_EXT', 'ECLSS', 'FANS', 'THERM', 'COMM', 'SCI', 'HEAT', 'RCS', 'MAIN', 'SEP', 'RBT', 'DOCK', 'NAV'];

/** Bus que alimenta cada carga. */
const BUS: Record<SwitchId, 'A' | 'B' | 'F' | null> = {
  BAT: null, BUSA: null, BUSB: null, SOLAR: null, AVX: 'A', FWD: null, LT_A: 'A', LT_B: 'A', LT_C: 'B', LT_D: 'B', LT_N: 'F', LT_EXT: 'F',
  ECLSS: 'B', FANS: 'B', THERM: 'B', COMM: 'A', SCI: 'A', HEAT: 'B', RCS: 'A', MAIN: 'A', SEP: 'A', RBT: 'F', DOCK: 'F', NAV: 'A',
};
/** Consumo conceptual (kW). */
const LOAD: Partial<Record<SwitchId, number>> = {
  AVX: 1.4, LT_A: 0.18, LT_B: 0.18, LT_C: 0.16, LT_D: 0.16, LT_N: 0.12, LT_EXT: 0.45, ECLSS: 1.8, FANS: 0.45, THERM: 0.7, COMM: 0.6,
  SCI: 1.1, HEAT: 0.9, RCS: 0.25, MAIN: 0.2, SEP: 0.15, RBT: 0.4, DOCK: 0.3, NAV: 0.35,
};

export type AnomalyId = 'cdra_fan' | 'mmod_panel' | 'pump_b';
export interface Anomaly { id: AnomalyId; label: string; where: string; fixed: boolean; progress: number; }
export interface Alert { id: string; level: 'info' | 'warn' | 'alarm'; text: string; t: number; }

export class Systems {
  sw: Record<SwitchId, boolean>;
  soc = 0.82;
  capacityKWh = 24;
  solarKW = 0;
  loadKW = 0;
  sepKW = 0;
  o2 = 21.2;
  co2 = 0.32; // kPa
  temp = 22.0;
  avionicsTemp = 28;
  commLink = 0;
  bootT = 0;
  booted = false;
  biprop = 2400; // kg
  xenon = 2600;
  anomalies: Anomaly[] = [];
  alerts: Alert[] = [];
  t = 0;
  private lastAlert = new Map<string, number>();
  listeners: ((a: Alert) => void)[] = [];

  constructor(cold = false) {
    this.sw = Object.fromEntries((Object.keys(SWITCH_LABEL) as SwitchId[]).map((k) => [k, !cold])) as Record<SwitchId, boolean>;
    if (!cold) { this.sw.LT_EXT = false; this.booted = true; this.bootT = 4; }
  }

  coldStart() {
    for (const k of Object.keys(this.sw) as SwitchId[]) this.sw[k] = false;
    this.booted = false; this.bootT = 0;
  }

  bus(b: 'A' | 'B' | 'F') {
    if (!this.sw.BAT || this.soc <= 0.001 && this.solarKW < 0.1) return false;
    if (b === 'A') return this.sw.BUSA;
    if (b === 'B') return this.sw.BUSB;
    return this.sw.FWD && (this.sw.BUSA || this.sw.BUSB);
  }
  /** ¿Está alimentada y encendida esta carga? */
  on(id: SwitchId) {
    const b = BUS[id];
    if (b === null) return this.sw[id] && this.sw.BAT;
    return this.sw[id] && this.bus(b);
  }
  lightLevel(bay: 'A' | 'B' | 'C' | 'D' | 'N') { return this.on(('LT_' + bay) as SwitchId) ? 1 : 0; }
  screensOn() { return this.on('AVX') && this.booted; }

  toggle(id: SwitchId) {
    this.sw[id] = !this.sw[id];
    return this.sw[id];
  }

  raise(anom: AnomalyId) {
    if (this.anomalies.some((a) => a.id === anom && !a.fixed)) return;
    const meta: Record<AnomalyId, [string, string]> = {
      cdra_fan: ['Ventilador de eliminación de CO₂ detenido', 'Bahía D · bastidor cenital (CO₂)'],
      mmod_panel: ['Impacto MMOD en panel R2-F14: fuga térmica', 'Exterior · anillo 2, faceta 14'],
      pump_b: ['Bomba de amoníaco B con caudal bajo', 'Módulo de servicio · módulo de bombeo'],
    };
    this.anomalies.push({ id: anom, label: meta[anom][0], where: meta[anom][1], fixed: false, progress: 0 });
    this.alert(`anom:${anom}`, 'alarm', meta[anom][0]);
  }
  active(anom: AnomalyId) { return this.anomalies.some((a) => a.id === anom && !a.fixed); }
  repair(anom: AnomalyId, dt: number) {
    const a = this.anomalies.find((x) => x.id === anom && !x.fixed);
    if (!a) return 1;
    a.progress = Math.min(1, a.progress + dt / 3.0);
    if (a.progress >= 1) { a.fixed = true; this.alert(`fix:${anom}`, 'info', `Reparado: ${a.label}`); }
    return a.progress;
  }

  alert(id: string, level: Alert['level'], text: string) {
    const last = this.lastAlert.get(id) ?? -1e9;
    if (this.t - last < 20) return;
    this.lastAlert.set(id, this.t);
    const a = { id, level, text, t: this.t };
    this.alerts.unshift(a);
    this.alerts = this.alerts.slice(0, 12);
    this.listeners.forEach((f) => f(a));
  }

  /**
   * sunFactor: iluminación solar sobre las alas (0..1: eclipse y orientación).
   * thrust: 0..1 motores; sep: 0..1 propulsión eléctrica; crewInside: ocupación.
   */
  step(dt: number, p: { sunFactor: number; wingsDeployed: number; thrust: number; sep: number; rcsUse: number; hgaError: number; crew: number }) {
    this.t += dt;
    const k = 60; // escala temporal de los procesos lentos (juego): 1 s real = 1 min de nave
    // generación y consumo
    this.solarKW = this.sw.SOLAR && this.sw.BAT ? 48 * p.sunFactor * p.wingsDeployed : 0;
    let load = 0;
    for (const id of Object.keys(LOAD) as SwitchId[]) if (this.on(id)) load += LOAD[id]!;
    this.sepKW = this.on('SEP') ? 24 * p.sep : 0;
    load += this.sepKW + (this.on('MAIN') ? 0.4 * p.thrust : 0);
    if (this.active('pump_b') && this.on('THERM')) load += 0.3;
    this.loadKW = this.sw.BAT ? load : 0;
    const net = this.solarKW - this.loadKW;
    this.soc = Math.min(1, Math.max(0, this.soc + (net * dt * k / 3600) / this.capacityKWh));
    if (this.soc < 0.2 && this.sw.BAT) this.alert('soc', 'warn', 'Batería por debajo del 20 %');
    // arranque de aviónica
    if (this.on('AVX')) { this.bootT += dt; if (this.bootT > 3.2 && !this.booted) { this.booted = true; this.alert('boot', 'info', 'Aviónica en línea'); } }
    else { this.bootT = 0; this.booted = false; }
    // atmósfera (escala acelerada)
    const crew = p.crew;
    const scrub = this.on('ECLSS') && this.on('FANS') && !this.active('cdra_fan');
    this.co2 += (crew * 0.0009 - (scrub ? 0.0045 * (this.co2 / 0.4) : 0)) * dt * k / 60;
    this.co2 = Math.max(0.15, this.co2);
    const o2gen = this.on('ECLSS') ? 0.006 : 0;
    this.o2 += (o2gen * (21.3 - this.o2) / 21.3 * 10 - crew * 0.00004) * dt * k / 60;
    if (this.co2 > 0.53) this.alert('co2', 'alarm', `CO₂ alto: ${this.co2.toFixed(2)} kPa`);
    else if (this.co2 > 0.45) this.alert('co2w', 'warn', `CO₂ en aumento: ${this.co2.toFixed(2)} kPa`);
    // térmico
    const heatIn = (this.on('AVX') ? 1 : 0) + crew * 0.12 + (this.on('SCI') ? 0.6 : 0);
    const reject = this.on('THERM') ? (this.active('pump_b') ? 0.5 : 1.0) * 1.6 : 0;
    const heaters = this.on('HEAT') ? 0.8 : 0;
    const passive = (this.temp - 4) * 0.035;
    this.temp += (heatIn + heaters - reject * Math.max(0, (this.temp - 18) / 6) - passive) * dt * k / 600;
    this.avionicsTemp += ((this.on('AVX') ? 1.2 : 0) - (this.on('THERM') ? 1.0 : 0.05) * (this.avionicsTemp - 22) / 8) * dt * k / 300;
    if (this.avionicsTemp > 48) this.alert('avx', 'warn', 'Temperatura de aviónica alta: comprueba el bombeo térmico');
    if (this.temp < 15) this.alert('cold', 'warn', 'Cabina fría: activa los calentadores');
    // comunicaciones
    this.commLink = this.on('COMM') ? Math.max(0, Math.cos(Math.min(Math.PI / 2, p.hgaError * 4))) : 0;
    // propulsantes
    this.biprop = Math.max(0, this.biprop - (p.thrust * 0.65 + p.rcsUse * 0.05) * dt);
    this.xenon = Math.max(0, this.xenon - p.sep * 0.0006 * dt);
  }

  snapshot() {
    return {
      soc: this.soc, solarKW: this.solarKW, loadKW: this.loadKW, o2: this.o2, co2: this.co2, temp: this.temp, avionicsTemp: this.avionicsTemp,
      commLink: this.commLink, booted: this.booted, biprop: this.biprop, xenon: this.xenon, sw: { ...this.sw },
      anomalies: this.anomalies.map((a) => ({ ...a })),
    };
  }

  load(s: any) {
    if (!s) return;
    Object.assign(this, { soc: s.soc, o2: s.o2, co2: s.co2, temp: s.temp, biprop: s.biprop, xenon: s.xenon, booted: s.booted });
    if (s.sw) this.sw = { ...this.sw, ...s.sw };
    if (s.anomalies) this.anomalies = s.anomalies;
    this.bootT = this.booted ? 4 : 0;
  }
}
