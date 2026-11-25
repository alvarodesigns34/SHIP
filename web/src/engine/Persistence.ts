/**
 * ALCIÓN HX-4 — PROJECT SINGULARITY
 * Persistencia v3 completa (compatible hacia atrás con guardados v2):
 * restaura escenario, vuelo 6DOF, sistemas, tripulante + exploración libre,
 * jugador, modo activo, estado de asiento/cámara, brazo robótico, esclusa y mecanismos.
 */
import type { ScenarioId } from './world/Astro';
import type { Mode, FlightCam } from './Engine';

const SAVE_KEY = 'alcion-bo-save';
const SETTINGS_KEY = 'alcion-bo-settings';

export interface SavePayloadV3 {
  v: 3;
  scenario: ScenarioId;
  mode: Mode;
  flightCam: FlightCam;
  seated: boolean;
  seatSide: number;
  airlock: 'pres' | 'vac';
  flight: unknown;
  systems: unknown;
  player: unknown;
  crew: unknown;
  missionsDone: string[];
  arm: number[];
  armGrabbed: string | null;
  mechs: Record<string, number>;
}

export function writeSave(payload: SavePayloadV3) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function readSave(): (Partial<SavePayloadV3> & { v: number }) | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && (o.v === 3 || o.v === 2)) return o;
    return null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* */
  }
}

export function readSettings(): any {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function writeSettings(data: Record<string, unknown>) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* */
  }
}
