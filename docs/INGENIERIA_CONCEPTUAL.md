# ALCIÓN HX-4 — Auditoría de Ingeniería Conceptual (Project Singularity)

> **Declaración de alcance y honestidad técnica:** ALCIÓN HX-4 es un **vehículo espacial conceptual ficticio** diseñado para visualización técnica, educación y simulación interactiva. Este documento **NO constituye validación de vuelo, calificación estructural, análisis FEM/CFD ni certificación aeroespacial**. Cada magnitud se etiqueta explícitamente según su naturaleza epistémica:
> - `[MEDIDO 3D]` — medido directamente por script sobre las mallas de `blender/ALCION_HX4_master.blend`.
> - `[FÍSICA]` — calculado analíticamente a partir de leyes físicas estándar (Tsiolkovsky, Stefan-Boltzmann, irradiancia solar a 1 UA).
> - `[CONCEPTUAL]` — parámetro de diseño plausible inspirado en estándares públicos (NASA-STD-3001, IDSS, ROSA, ISS), no verificado por ensayo.
> - `[SIMULACIÓN]` — abstracción interactiva de la aplicación web para usabilidad/juego.

---

## 1. Envolvente Dimensional y Volúmenes (`[MEDIDO 3D]`)

| Parámetro | Valor | Origen | Notas |
|---|---:|---|---|
| Piezas / triángulos / vértices | `779` / `826,266` / `452,565` | `[MEDIDO 3D]` | Modelo maestro completo tras reconstrucción Singularity |
| Longitud total (eje X) | **19.58 m** | `[MEDIDO 3D]` | Desde plano de salida de toberas (`-6.35 m`) a anillo IDSS (`13.23 m`) |
| Envergadura total (eje Y) | **39.42 m** | `[MEDIDO 3D]` | Extremos de alas solares desplegadas (`-19.71 .. 19.71 m`) |
| Altura total (eje Z) | **15.50 m** | `[MEDIDO 3D]` | Extremos de radiadores desplegados (`-7.75 .. 7.75 m`) |
| Volumen presurizado bruto total | **140.7 m³** | `[MEDIDO 3D]` | Barril HAB `106.68` + domo popa `5.2` + cono `10.03` + nodo `12.4` + cúpula `0.97` + esclusa `5.45` |
| Volumen habitable neto estimado (NHV) | **53.7 m³** | `[CONCEPTUAL]` | **13.4 m³/tripulante** (4 personas) |

**Evaluación frente a referencias NASA-STD-3001 / NASA TP-2015-218564:** para misiones de 30–45 días con 4 tripulantes, la literatura de habitabilidad espacial sitúa el mínimo aceptable en ~10–12 m³/tripulante y la zona de confort en ~15–20 m³/tripulante. El valor estimado de **13.4 m³/tripulante** es coherente con una misión cislunar de 45 días, aunque apretado si se ampliara a misiones >90 días sin módulos adicionales.

---

## 2. Verificación Geométrica de Claros, Aperturas y Contención (`[MEDIDO 3D]`)

| Comprobación | Resultado | Evidencia medida |
|---|---|---|
| Contención radial interior (`HAB.INT.*` dentro de `R_P = 2.10 m`) | **ALERTA HONESTA (35 bastidores/depósitos > R_P)** | Radio máximo interior: `2.2144 m` (`HAB.INT.C.CQ3.WTR`, aún contenido dentro del escudo MMOD `R_S = 2.26 m`; en CAD de fabricación exigiría recortar ~5–11 cm el chaflán trasero) |
| Ventana cenital de la Cúpula (`W7`, raycast vertical desde `X=11.05, Z=1.48 m`) | **PASS — 100 % DESPEJADA** | Sin obstrucción metálica (corregido en Singularity al sustituir los cilindros macizos previos por anillos forjados huecos) |
| Ventana científica de nadir W1 (`X=5.25 m`, raycast hacia `-Z`) | **PASS — 100 % DESPEJADA** | Sin intrusión del isogrid `HAB.STR.B3.ISO` |
| Ventana científica de nadir W2 (`X=6.20 m`, raycast hacia `-Z`) | **PASS — 100 % DESPEJADA** | Sin intrusión del isogrid |
| Diámetro libre de paso IDSS (`FWD.DCK`) | **0,80 m** (`[CONCEPTUAL]`) | Conforme a especificación pública IDSS Rev. D |

---

## 3. Potencia Eléctrica y Control Térmico (`[MEDIDO 3D]` + `[FÍSICA]`)

| Parámetro | Valor | Origen | Ecuación / hipótesis |
|---|---:|---|---|
| Área solar activa medida (`PWR.W1/W2`) | **131.9 m²** | `[MEDIDO 3D]` | Polígonos con `M_SolarCell` |
| Potencia eléctrica BOL (1 UA, incidencia normal) | **46.6 kW** | `[FÍSICA]` | $1361\,\mathrm{W/m^2} \times A \times 0.295 \times 0.88$ (celdas triple unión GaInP/GaAs/Ge) |
| Potencia eléctrica EOL (5 años) | **40.1 kW** | `[CONCEPTUAL]` | Factor de degradación 0,86 |
| Área emisiva total de radiadores (`THR.R1/R2`, doble cara) | **80.3 m²** | `[MEDIDO 3D]` | Polígonos con `M_Radiator` ($\varepsilon = 0.88$, $T_{rad} = 290\,\mathrm{K}$) |
| Rechazo térmico en espacio profundo ($T_{sink} = 4\,\mathrm{K}$) | **28.4 kW** | `[FÍSICA]` | $Q = \varepsilon \sigma A (T_{rad}^4 - T_{sink}^4)$ |
| Rechazo térmico en LEO soleado ($T_{sink} = 245\,\mathrm{K}$) | **13.9 kW** | `[FÍSICA]` | Albedo + IR terrestre reduce el rechazo neto respecto al espacio profundo |
| Rechazo térmico en eclipse LEO ($T_{sink} = 190\,\mathrm{K}$) | **23.1 kW** | `[FÍSICA]` | |

**Hallazgo de ingeniería honesto:** con los radiadores actuales (`80.3 m²` a 290 K), el rechazo térmico en LEO soleado (`13.9 kW`) cubre cómodamente la carga de soporte vital, aviónica y laboratorio (~6–9 kW continuos), **pero operaría con margen ajustado si los 4 propulsores Hall (24 kW eléctricos, ~2–3 kW de pérdidas térmicas en PPU) funcionasen simultáneamente a máxima carga en órbita baja soleada** — en una iteración real exigiría un lazo PPU de mayor temperatura (~330 K) o ~15 % más superficie radiativa.

---

## 4. Propulsión y Presupuesto de $\Delta v$ (`[MEDIDO 3D]` + `[FÍSICA]` + `[CONCEPTUAL]`)

| Parámetro | Valor | Origen | Notas |
|---|---:|---|---|
| Volumen geométrico 4 esferas bipropelente (`SVC.PRP.BIP`) | **2.35 m³** | `[MEDIDO 3D]` | Suma de volúmenes de malla |
| Masa útil estimada MMH/MON-3 (90 % llenado) | **2464 kg** | `[CONCEPTUAL]` | $\rho_{mezcla} \approx 1165\,\mathrm{kg/m^3}$ (O/F = 1,65) |
| Volumen geométrico depósito COPV Xenón (`SVC.PRP.XE`) | **1.74 m³** | `[MEDIDO 3D]` | Cilindro con domos |
| Masa útil estimada Xenón supercrítico (~150 bar, 300 K) | **2176 kg** | `[CONCEPTUAL]` | $\rho \approx 1420\,\mathrm{kg/m^3}$ |
| Masa seca de hipótesis | **14800 kg** | `[CONCEPTUAL]` | Estimación de orden de magnitud (sin análisis FEM de masas) |
| Masa húmeda estimada | **19440 kg** | `[CONCEPTUAL]` | |
| $\Delta v$ químico disponible ($I_{sp} = 315\,\mathrm{s}$) | **419 m/s** | `[FÍSICA]` | Ecuación de Tsiolkovsky — apto para inserción orbital lunar / rendez-vous / mantenimiento, **no** para TLI desde LEO por sí solo |
| $\Delta v$ eléctrico SEP disponible ($I_{sp} = 1850\,\mathrm{s}$) | **2488 m/s** | `[FÍSICA]` | Espirales de transferencia lenta cislunar (bajo empuje, meses) |

---

## 5. Protección frente a Radiación y Micrometeoritos (`[CONCEPTUAL]`)

- **Refugio solar Bahía C (`HAB.INT.C`):** la envolvente conceptual combina casco Al-Li 2195 (30 mm $\approx 8.1\,\mathrm{g/cm^2}$), escudo MMOD Whipple relleno con Nextel/Kevlar ($\approx 2.2\,\mathrm{g/cm^2}$), bolsas de agua potable de 10 cm ($10.0\,\mathrm{g/cm^2}$) y paneles interiores de HDPE de 2 cm ($1.9\,\mathrm{g/cm^2}$), alcanzando una densidad superficial nominal de **22.2 g/cm²** (por encima del umbral conceptual de referencia de 20 g/cm² frente a eventos de partículas solares SPE, aunque sin cálculo Monte Carlo OLTARIS/Geant4 de radiación secundaria ni cobertura isotrópica en los extremos axiales).

---

## 6. Abstracciones Deliberadas del Simulador Web (`[SIMULACIÓN]`)

Para que la aplicación web sea explorable, educativa y disfrutable en tiempo real, el simulador introduce abstracciones explícitas:
1. **Escala de empuje configurable (`×1`, `×5`, `×10`, `×25`):** en modo `×1` las aceleraciones son próximas a las reales (~0,08 m/s²), demasiado lentas para maniobras breves en sesión web; por defecto se ofrece `×10`.
2. **Gravedad de entrenamiento (`Caminar` 1 g vs `Flotar` microgravedad):** el modo caminar facilita el recorrido cómodo por las cubiertas; el modo flotar representa el desplazamiento real en microgravedad con asideros.
3. **Propagación orbital simplificada:** la telemetría orbital (`V_orb`, apogeo, perigeo, periodo kepleriano $T = 2\pi\sqrt{a^3/\mu}$) se calcula analíticamente en torno al cuerpo dominante (Tierra o Luna) sin perturbaciones J2 ni efemérides N-cuerpos.
4. **Ciclo de esclusa y necesidades de tripulación acelerados:** la despresurización dura segundos en lugar de ~30 minutos reales, y el botón **Libre** permite pausar completamente el desgaste fisiológico para inspección libre.
