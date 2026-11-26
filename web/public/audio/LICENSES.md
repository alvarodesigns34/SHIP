# Licencias y procedencia del audio — ALCIÓN HX-4

Toda la biblioteca sonora activa de **ALCIÓN HX-4** se genera mediante **síntesis procedural determinista en tiempo real** con la Web Audio API (`web/src/engine/Audio.ts`), sin archivos propietarios ni grabaciones con derechos de terceros.

## Licencia de la síntesis procedural

- **Origen**: Código original del proyecto ALCIÓN HX-4 (`web/src/engine/Audio.ts`).
- **Licencia**: **CC0 1.0 Universal (Dominio Público)** — [https://creativecommons.org/publicdomain/zero/1.0/](https://creativecommons.org/publicdomain/zero/1.0/).
- **Tamaño en disco**: 0 bytes de activos de audio externos; todos los búferes (ruido filtrado de 10 s y respuesta al impulso estéreo de 0,65 s) se generan deterministamente en memoria con PRNG LCG al iniciar `AudioContext`.

## Catálogo sonoro sintetizado

| Familia | Método / Nodo | Descripción | Modo realista en vacío |
|---|---|---|---|
| Reverberación de compartimento | `ConvolverNode` + `buildSyntheticIR()` | Respuesta al impulso estéreo sintética determinista (0,65 s, 6 reflexiones tempranas). Mezcla wet diferenciada: `quarters` 0,04 (muy seco), `cockpit` 0,10, `lab` 0,16, `services` 0,18, `node` 0,32, `airlock` 0,38. | 0,0 (silencio) |
| Ambiente interior por estancia | `fanGain`, `humGain`, `cryoGain` | Ventilación filtrada por compartimento, armónicos de aviónica (60/120/180 Hz) y compresor criogénico Stirling (−80 °C en laboratorio). | 0,0 (silencio) |
| Ciclo de esclusa | `airlockHissGain` | Silbido de ecualización de presión durante despresurización/represurización. | Silencio fuera (audible dentro/traje) |
| Traje EVA (PLSS) | `suitGain` | Ventilador interno del PLSS y ciclo respiratorio rítmico modulado por LFO (0,22 Hz). | Audible dentro del casco EVA |
| Ambiente espacial cinematográfico | `spaceAmbGain` | Cama subarmónica grave (55/82,4 Hz + ruido < 190 Hz), exclusivamente en `mode === 'cinematico'`. | 0,0 (silencio estricto) |
| Propulsión y RCS | `engineGain`, `rcs()` | Vibración estructural grave amortiguada (< 210 Hz) dentro de la nave; empuje exterior amplio sólo en `cinematico`. | 0,0 en exterior |
| Servomotores del brazo | `servoOsc`, `servoOsc2`, `servoGearGain` | Motor brushless dual + zumbido armónico de engranaje (1,15 kHz). | 0,0 en exterior |
| Interruptores mecánicos | `click(on)` | Clic en 2 etapas (liberación de palanca + encaje de resorte metálico + resonancia de panel). | Silencio en exterior |
| Desplazamiento por superficie | `footstep(strength, surface)` | Diferenciado en `floor` (caucho), `ladder` (peldaño metálico) y `push` (impulso en asidero). | Silencio en exterior |
| Interacción táctil | `pickup(putDown)` | Sonido sutil de velcro/pestillo al coger o dejar objetos de actividades. | Silencio en exterior |
| Acoplamiento IDSS | `dockLock()` | Secuencia de 3 fases: captura suave, retracción de actuadores y doble cerrojo estructural. | Silencio en exterior (audible a bordo) |
| Avisos de aviónica | `beep(kind)`, `comms()` | Master Warning bitonal (`alarm`), Master Caution (`warn`), confirmación (`ok`), info y tono Quindar (`2525 Hz`). | Audible en cabina/EVA |
| Actividades y cámara | `activity()`, `hatch()`, `shutter()`, `pulse()`, `burst()` | Efectos de agua, calor, ejercicio, cremallera, limpieza, escotillas, obturador y dianas sandbox. | Silencio en exterior (salvo obturador/cinemático) |

## Política para futuras muestras grabadas

Cualquier muestra externa que se incorpore en el futuro en `web/public/audio/` debe cumplir:

1. Licencia **CC0 1.0 Universal** o **Dominio Público** verificable (p. ej. NASA Public Domain Audio o Freesound CC0).
2. Registro obligatorio en este archivo con nombre de fichero, autor/fuente, URL de procedencia y licencia exacta.
3. Compresión ligera (Opus/OGG o MP3 mono ≤ 96 kbps) para preservar el presupuesto de descarga.
