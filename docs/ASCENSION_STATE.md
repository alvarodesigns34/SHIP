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
- **Ola 0 (línea base)**: completada. Capturas en `docs/ascension/before/` y métricas registradas arriba.
- **Ola 1 ("imagen")**: *en curso* (H1 arte interior + materiales + horneado; H2 pipeline, box-projected env maps, auto-exposición GPU, GTAO/AA medido y perfiles; H3 Tierra/Luna/estrellas cinematográficas + exterior civil detallado + pantallas de cabina).
- **Ola 2 ("sentir")**: pendiente.
- **Ola 3 ("producto")**: pendiente.
- **Ola 4 (integración final y publicación)**: pendiente.

## 4. Pendientes honestos y riesgos
- Sin GPU dedicada en el entorno: p95 en GPU real a 1080p **no puede medirse** en este contenedor y se declarará así sin inventar cifras.
- Con 2 vCPUs, el horneado completo en Cycles (`bake_rebirth.py`) y las suites Playwright en SwiftShader requieren planificación cuidadosa (tandas pequeñas para `compare_rebirth.cjs` y muestreo adaptativo + OIDN en `bake_rebirth.py`).
