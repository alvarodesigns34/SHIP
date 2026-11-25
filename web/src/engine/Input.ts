/**
 * Entrada unificada: teclado, ratón (con bloqueo de puntero), mando (Gamepad API)
 * y controles táctiles. Las acciones son abstractas y reasignables; los ejes
 * analógicos devuelven valores en [-1, 1].
 */
export type Action =
  | 'fwd' | 'back' | 'left' | 'right' | 'up' | 'down'
  | 'pitchUp' | 'pitchDown' | 'yawLeft' | 'yawRight' | 'rollLeft' | 'rollRight'
  | 'throttleUp' | 'throttleDown' | 'assist' | 'brake' | 'camera' | 'interact' | 'grab'
  | 'photo' | 'hud' | 'fire' | 'boost' | 'exit';

export const ACTION_LABELS: Record<Action, string> = {
  fwd: 'Avanzar / traslación +X', back: 'Retroceder / traslación −X', left: 'Izquierda', right: 'Derecha', up: 'Subir', down: 'Bajar',
  pitchUp: 'Cabeceo arriba', pitchDown: 'Cabeceo abajo', yawLeft: 'Guiñada izquierda', yawRight: 'Guiñada derecha',
  rollLeft: 'Alabeo izquierda', rollRight: 'Alabeo derecha', throttleUp: 'Aumentar empuje principal', throttleDown: 'Reducir empuje principal',
  assist: 'Modo asistido / manual', brake: 'Frenado asistido', camera: 'Cambiar cámara', interact: 'Interactuar', grab: 'Agarrar asidero',
  photo: 'Fotografía', hud: 'Ocultar interfaz', fire: 'Pulso de luz (sandbox)', boost: 'Impulso (EVA)', exit: 'Salir / levantarse',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  fwd: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], up: ['KeyR', 'Space'], down: ['KeyF', 'ControlLeft'],
  pitchUp: ['ArrowDown', 'KeyK'], pitchDown: ['ArrowUp', 'KeyI'], yawLeft: ['ArrowLeft', 'KeyJ'], yawRight: ['ArrowRight', 'KeyL'],
  rollLeft: ['KeyQ'], rollRight: ['KeyE'], throttleUp: ['KeyX'], throttleDown: ['KeyZ'], assist: ['KeyT'], brake: ['KeyB'],
  camera: ['KeyC'], interact: ['KeyG', 'Enter'], grab: ['KeyV'], photo: ['KeyP'], hud: ['KeyH'], fire: ['KeyN'], boost: ['ShiftLeft'], exit: ['KeyY'],
};

export class Input {
  bindings: Record<Action, string[]>;
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  touch: Partial<Record<Action, number>> = {};
  touchLook = { x: 0, y: 0 };
  gamepad: Gamepad | null = null;
  invertY = false;
  sensitivity = 1;
  enabled = true;
  private el: HTMLElement;
  listening: ((code: string) => void) | null = null;
  /** todos los listeners se registran con esta señal y se retiran juntos en dispose() */
  private ac = new AbortController();
  dispose() { this.ac.abort(); if (document.pointerLockElement === this.el) document.exitPointerLock(); }

  constructor(el: HTMLElement, saved?: Partial<Record<Action, string[]>>) {
    this.el = el;
    this.bindings = { ...DEFAULT_BINDINGS, ...(saved ?? {}) };
    const signal = this.ac.signal;
    window.addEventListener('keydown', this.onKey, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', () => this.down.clear(), { signal });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === this.el), { signal });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    }, { signal });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true, signal });
  }

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.listening) { e.preventDefault(); const f = this.listening; this.listening = null; f(e.code); return; }
    if (this.isTyping(e) || !this.enabled) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.down.delete(e.code); };

  lock() { if (!this.locked && !matchMedia('(pointer: coarse)').matches) this.el.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  held(a: Action) {
    return this.bindings[a].some((c) => this.down.has(c)) || (this.touch[a] ?? 0) > 0.5;
  }
  /** Flanco de subida en este fotograma. */
  hit(a: Action) {
    return this.bindings[a].some((c) => this.pressed.has(c)) || this.padHit(a);
  }
  axis(neg: Action, pos: Action) {
    let v = (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
    v += (this.touch[pos] ?? 0) - (this.touch[neg] ?? 0);
    return Math.max(-1, Math.min(1, v + this.padAxis(neg, pos)));
  }

  // ------------------------------------------------------------ mando
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) { this.gamepad = p; break; }
    this.padPrev = this.padNow;
    this.padNow = this.gamepad ? this.gamepad.buttons.map((b) => b.pressed) : [];
  }
  private dz(v: number) { return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; }
  private padAxis(neg: Action, pos: Action): number {
    const g = this.gamepad;
    if (!g) return 0;
    const ax = (i: number) => this.dz(g.axes[i] ?? 0);
    const bt = (i: number) => g.buttons[i]?.value ?? 0;
    const key = `${neg}|${pos}`;
    switch (key) {
      case 'back|fwd': return -ax(1);
      case 'left|right': return ax(0);
      case 'down|up': return bt(7) - bt(6);
      case 'pitchDown|pitchUp': return ax(3) * (this.invertY ? -1 : 1);
      case 'yawLeft|yawRight': return ax(2);
      case 'rollLeft|rollRight': return (g.buttons[5]?.pressed ? 1 : 0) - (g.buttons[4]?.pressed ? 1 : 0);
      default: return 0;
    }
  }
  private padHit(a: Action) {
    const map: Partial<Record<Action, number>> = { interact: 0, brake: 1, camera: 3, assist: 2, fire: 7, exit: 8, photo: 9 };
    const i = map[a];
    if (i === undefined) return false;
    return !!this.padNow[i] && !this.padPrev[i];
  }
  padLook() {
    const g = this.gamepad;
    if (!g) return { x: 0, y: 0 };
    return { x: this.dz(g.axes[2] ?? 0), y: this.dz(g.axes[3] ?? 0) };
  }

  /** Consume deltas por fotograma. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }

  rebind(a: Action, code: string) {
    for (const k of Object.keys(this.bindings) as Action[]) this.bindings[k] = this.bindings[k].filter((c) => c !== code);
    this.bindings[a] = [code];
  }
}
