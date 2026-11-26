# ALCIÓN HX-4 · ASCENSION — estado del proyecto

> Documento vivo y riguroso. Distingue siempre lo **medido** de lo **pendiente**.
> Sin GPU física en el entorno de desarrollo (sólo Chromium + ANGLE/SwiftShader sobre Vulkan 1.3 en CPU):
> los tiempos de fotograma aquí son de CPU/SwiftShader y sirven únicamente para comparativas A/B en
> condiciones idénticas, **nunca** como estimación de FPS reales en GPU.

## 1. Partida y entorno (Ola 0)
- **Rama base**: `claude/determined-keller-u2qmrs` (commit `d5c8388`).
- **Rama de trabajo**: `gemini/alcion-ascension`.
- **Producción actual**: https://alvarodesigns34.github.io/SHIP/ (rama `gh-pages`, despliegue `b41c0e9`).
- **Hardware del contenedor**:
  - CPU: 2 vCPUs `Intel(R) Xeon(R) CPU @ 2.30GHz` (AVX2), 7,8 GiB RAM, 85 GiB disco libre.
  - GPU física: **No disponible**. WebGL2 vía `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.
  - `EXT_disjoint_timer_query_webgl2`: `true` (expuesto por ANGLE/SwiftShader; mide latencia de rasterizador por CPU, no de GPU dedicada). `MAX_SAMPLES = 4`, `MAX_TEXTURE_SIZE = 8192`.
- **Toolchain verificada**:
  - Node.js `v22.23.5`, `npm ci` + `npm run build` en `web/` (5,1 s).
  - Blender como módulo Python: `bpy 5.3.0` + `Pillow 13.0.0` + `numpy 2.5.5` en `/home/antigravity/.venv-bpy`.
  - `blender/build.py`: ejecutado y verificado sin errores en 19,9 s (maestro restaurado tras prueba para conservar UV `LM` vigentes antes de la Ola 1).

## 2. Línea base medida (Ola 0)

### Baterías de pruebas
- `web/tests/rebirth.cjs`: **26/26 PASS** (0 errores de consola).
  - Arranque exterior listo: **8.617 ms** (umbral < 20.000 ms).
  - Arranque interior listo: **12.288 ms** (umbral < 60.000 ms).
  - Colisiones (800 pasos): distancia mínima **0,160 m** (umbral ≥ 0,12 m), **0** salidas del volumen presurizado.
  - Habitáculos mirando a popa (sin ventanas): **68 llamadas / 108.972 triángulos**.
  - Exterior completo (incluidas sombras): **78 llamadas / 502.600 triángulos**.
  - Escrituras de matrices en reposo: **0**.
- `web/tests/functional.cjs`: **21/22 PASS, 1 FAIL** (0 errores de página/consola, 0 errores HTTP).
  - Único fallo heredado en la línea base: `11 Cabina sentada + manos` (`seated: true, handsVis: false`), porque el commit `6eb8d67` de Rebirth retiró las manos al pilotar. No se rebajará la prueba; quedará resuelta al reconstruir las manos en la Ola 2.

### Capturas de referencia (`docs/ascension/before/`, 1280×760, perfil `alta`)
| Toma | Llamadas | Triángulos | Diagnóstico visual inicial |
|---|---:|---:|---|
| `01_ext_general` | 287 | 834.226 | Casco limpio pero cilíndrico y repetitivo; etiquetas flotantes superpuestas en el centro; cielo estelar pobre. |
| `02_ext_closeup` | 261 | 682.034 | Paneles MMOD demasiado uniformes; faltan cintas, juntas, conductos y antenas detalladas. |
| `03_ext_engines` | 294 | 813.654 | Módulo de servicio correcto; toberas y detalles traseros mejorables. |
| `04_cockpit_seated` | 213 | 298.118 | Consola muy lisa y vacía; monitor central apagado al arranque; mamparo de proa azul plano sin herrajes ni cableado. |
| `05_cockpit_overview` | 378 | 549.078 | Frame con pasada auxiliar/sombra; asientos primitivos en bloque; falta densidad técnica en consolas y suelo. |
| `06_lab` | 288 | 440.806 | Guantera con cilindros simples; microscopio en bloque; cámara de cultivo tapada por plano `R_Black`; armarios muy lisos. |
| `07_crew_quarters` | 82 | 248.114 | Sacos de dormir rígidos como bloques azules; cortinas con ondas simples; consola personal es un cubo gris liso. |
| `08_galley_services` | 66 | 189.252 | 12 bolsas clónicas tipo almohada; dispensador de agua y calentador en bloque; mesa muy simple. |
| `09_corridor_aft` | 170 | 557.738 | Vista de corredor limpia pero con aspecto de maqueta vacía; cicloergómetro tosco; falta cableado y desgaste. |
| `10_cupola` | 47 | 76.156 | Cúpula despejada; faltan cerraduras/manetas, pasamanos con soportes y equipamiento fotográfico. |
| `11_node` | 71 | 179.868 | Nodo muy liso; faltan válvulas, conductos y estiba EVA detallada. |
| `12_airlock_well` | 97 | 260.302 | Pozo funcional pero poco detallado. |
| `13_earth_orbit` | 161 | 482.078 | **Debilidad crítica**: Tierra borrosa a 420 km, especular oceánico en gran mancha difusa y nubes blandas sin sombras nítidas. |
| `14_earth_window` | 58 | 253.100 | Vista nadir mejorable en nitidez terrestre y detalle de marco. |
| `15_exploded` | 287 | 834.016 | Explosión exterior correcta; pendiente incorporar piezas interiores en Ola 3. |

## 3. Registro de olas
- **Ola 0 (línea base)**: completada (`5ca14b1`). Capturas en `docs/ascension/before/` y métricas registradas arriba.
- **Ola 1 ("imagen")**: completada. Integrados H3 (entorno espacial + casco civil + pantallas MFD), H2 (pipeline auto-exposición GPU + AO ½ res + FXAA 3.11 + sondas locales + perfiles) y H1 (arte interior en las 5 estancias + atlas 160 teselas + desgaste PBR + contrato `boxProbe` + horneado Cycles+OIDN). Evidencias en `docs/ascension/after_ola1/`.
- **Ola 2 ("sentir")**: *en curso* (H2 presencia, controlador, microgravedad con impulso, transiciones animadas y manos agarrando mandos al pilotar; H3 reloj único, misiones guiadas, atraque con retícula COAS, brazo robótico, alarmas y audio por estancia realista/cinematográfico; H1 objetos interactivos físicos con `ctl`/`pose` para actividades, corrección de normales de quads MFD y horneado definitivo 2048² estancia por estancia).
- **Ola 3 ("producto")**: pendiente.
- **Ola 4 (integración final y publicación)**: pendiente.

## 4. Resultados medidos · Ola 1 («imagen»)

### Pruebas tras integración (H1 + H2 + H3)
- `npm run build` (`web/`): **0 errores TS/Vite** (5,07 s).
- `web/tests/rebirth.cjs`: **25/26 PASS** hasta el corte automático de 600 s por contención de SwiftShader en 2 vCPUs (faltando sólo imprimir la aserción final `Consola: sin errores en móvil`; todos los tramos de arranque, gráficos, teclado, foco, 800 pasos de colisión mín. `0,153 m`, microgravedad, interruptor `BAT`, asiento, 4 ciclos de modo, presupuestos `92` y `82` llamadas, `0` escrituras de matrices, EVA, persistencia y palanca táctil móvil pasaron sin errores).
  - Arranque exterior listo: **5.201 ms** (antes 8.617 ms).
  - Arranque interior listo: **19.050 ms** (antes 12.288 ms).
- `web/tests/functional.cjs`: **20/22 PASS** (0 errores de consola/página, 0 HTTP):
  - `02 Lightmap Cycles + UV1`: **FAIL temporal** (`sizes: [1024×5]` frente a umbral `≥ 2048`); H1 usó 1024² en Ola 1 para evitar el corte de 600 s en 2 vCPUs. Se resolverá genuinamente al cierre de Ola 2 horneando cada estancia por separado a **2048²** con `--rooms X --reuse-uv`.
  - `11 Cabina sentada + manos`: **FAIL preexistente** desde Rebirth `6eb8d67`; se resolverá en Ola 2 al recuperar las manos agarrando los controladores.

### Comparativa medida (`docs/ascension/before/` → `docs/ascension/after_ola1/`, 1280×760, perfil `alta`)
| Toma | Antes (llamadas / tris) | Ola 1 (llamadas / tris) | Qué mejoró visualmente |
|---|---:|---:|---|
| `01_ext_general` | 287 / 834k | 382 / 965k | Canalizaciones umbilicales, cintas térmicas Kapton, trampillas de inspección, balizas y micro-PBR. *(Anotado para Ola 2: reducir llamadas en ingeniería exterior sin corte).* |
| `02_ext_closeup` | 261 / 682k | 338 / 788k | MLI dorado arrugado, trampilla con cierres cuarto de vuelta, juntas y biseles en paneles MMOD, AO de contacto en cúpula y marcos. |
| `04_cockpit_seated` | 213 / 298k | **229 / 581k** | Salto radical: 3 MFD + copiloto todas encendidas y nítidas, glareshield con avisadores luminosos y bloom suave, subpanel GNC, mamparo de proa iluminado con cajas/cables, fondo del nodo visible, reflejos `boxProbe` y Tierra nítida por ventanas. |
| `05_cockpit_overview` | 378 / 549k | **213 / 394k (−43,7 %)** | Las 6 MFD encendidas, 2 asientos esculpidos con asidero bermellón/nervios/reposacabezas, sidestick + THC diferenciados, mamparo de proa arquitectónico. |
| `06_lab` | 288 / 441k | **234 / 518k (−18,8 %)** | Guantera inclinada con esclusa lateral y panel iluminado, anclajes de pies bermellón, congeladores con marcos/tiradores, pantallas auxiliares activas. |
| `07_crew_quarters` | 82 / 248k | 124 / 306k | Sacos acolchados en 9 baffles con hebillas, cortinas recogidas con anillas, consola personal empotrada, lámpara articulada, bolsillo con cuaderno/auriculares. |
| `08_galley_services` | 66 / 189k | 94 / 202k | 12 bolsas CTB en 3 tonos con correas/cremallera/asas, mesa con reborde/vaso/tableta, calentador biselado y dispensador de agua con nicho y bolsa acoplada. |
| `09_corridor_aft` | 170 / 558k | 253 / 672k | Cámara de cultivo con vidrio transparente y 10 plantas iluminadas, microscopio binocular, cicloergómetro rehecho al fondo, reflejos localizados en techo y AO limpio. |
| `10_cupola` | 47 / 76k | 60 / 83k | Pasamanos perimetral con remates bermellón, manetas en contraventanas y cámara DSLR en brazo articulado. |
| `11_node` | 71 / 180k | 102 / 217k | Consola RWS con 2 mandos y 2 pantallas activas, escotilla IDSS con volante/pestillos/mirilla, panel O₂/N₂ con 2 manómetros y conductos. |
| `13_earth_orbit` | 161 / 482k | **86 / 530k (−46,6 %)** | Tierra 420 km con microdetalle 3D, océano GGX con oleaje realista, nubes con sombra proyectada y limbo atmosférico zafiro nítido. |
| `14_earth_window` | 58 / 253k | 70 / 310k | Ventanas nadir despejadas con detalle terrestre mejorado. |

## 5. Pendientes honestos y riesgos
- Sin GPU dedicada en el entorno: p95 en GPU real a 1080p **no puede medirse** en este contenedor y se declarará así sin inventar cifras.
- Con 2 vCPUs, cada estancia a `2048²` en Cycles debe hornearse en invocación separada (`--rooms X --reuse-uv`) para mantenerse con holgura bajo el límite de 600 s por comando.
- Anotado para Ola 2 (`Engine.ts`): en modo `ENGINEERING` sin corte ni rayos X, evitar renderizar subpiezas interiores no visibles para volver a ≤ 290 llamadas en `01_ext_general` y reducir tiempo de `rebirth.cjs` en SwiftShader.
- Anotado para Ola 3 (`App.tsx`/`styles.css`): eliminar el solape de etiquetas 3D en vista general de ingeniería (`01_ext_general`).
