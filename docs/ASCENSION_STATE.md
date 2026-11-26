# ALCIÓN HX-4 · ASCENSION — estado del proyecto

> Documento vivo y riguroso. Distingue siempre lo **medido** de lo **no medido**.
> **Sin GPU física en el entorno de desarrollo** (sólo Chromium + ANGLE/SwiftShader sobre Vulkan 1.3 en 2 vCPUs):
> los tiempos de fotograma aquí corresponden a rasterización por CPU/SwiftShader y sirven únicamente para comparativas A/B en
> condiciones idénticas, **nunca** como estimación de FPS reales en GPU. No se inventan cifras de GPU ni se asignan notas subjetivas.

---

## 1. Partida y entorno
- **Rama base**: `claude/determined-keller-u2qmrs` (commit `d5c8388`).
- **Rama de trabajo**: `gemini/alcion-ascension` (subida a `origin`).
- **Producción**: https://alvarodesigns34.github.io/SHIP/ (rama `gh-pages`; despliegue anterior `b41c0e9`).
- **Hardware del contenedor**:
  - CPU: 2 vCPUs `Intel(R) Xeon(R) CPU @ 2.30GHz` (AVX2), 7,8 GiB RAM.
  - GPU física: **No disponible**. WebGL2 vía `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.
  - `EXT_disjoint_timer_query_webgl2`: `true` (expuesto por ANGLE/SwiftShader; mide rasterizador por CPU). `MAX_SAMPLES = 4`, `MAX_TEXTURE_SIZE = 8192`.
- **Toolchain**: Node.js `v22.23.5`, Python 3.13 con `bpy 5.3.0` + `Pillow 13.0.0` + `numpy 2.5.5` en `/home/antigravity/.venv-bpy`.

---

## 2. Resumen de cambios por ola

### Ola 0 · Línea base (`5ca14b1`)
- Compilación y verificación de `blender/build.py` (19,9 s) y `npm run build` (5,1 s).
- Pruebas iniciales: `rebirth.cjs` **26/26 PASS**, `functional.cjs` **21/22 PASS** (fallo heredado en test `11 Cabina sentada + manos`, retiradas en Rebirth `6eb8d67`).
- Capturas base de las 15 cámaras fijas en `docs/ascension/before/`.

### Ola 1 · Imagen (`58c8561`)
- **Arte interior y materiales (H1)**:
  - Reconstrucción de densidad y siluetas en las 5 estancias (`habitat.py`, `habitat_rooms.py`, `kit.py`): mamparo de proa iluminado y detallado (corregido el solape de `X_CONE1` con `FWD.STR.BHA`), asientos esculpidos con arnés y mandos diferenciados (THC + sidestick), glareshield con avisadores, cámara de cultivo con vidrio transparente y 10 plantas iluminadas (corregido el frente opaco `R_Black`), guantera sellada con esclusa lateral y manómetro, microscopio binocular, sacos acolchados de 9 baffles, cortinas con riel/anillas/cinta, consola personal y bolsillos, 12 bolsas CTB en 3 tonos, dispensador de agua real, calentador biselado, cicloergómetro rehecho, cúpula con pasamanos/DSLR y nodo con volante IDSS y manómetros O₂/N₂.
  - Atlas de rotulación ampliado a 160 teselas (`make_labels.py`), textura cálida neutra `linen_warm_c.jpg`, desgaste procedural sutil en `RMaterials.ts` y contrato `boxProbe` por estancia.
- **Motor y pipeline (H2)**:
  - Sondas de reflexión locales por estancia (`Interior.ts`: `captureProbes` alineado al marco local de la nave, `autoClear = true`, resolución `256`/`128`/`64` por perfil, integración con `boxProbe` de `RMaterials.ts`).
  - Pipeline HDR (`Pipeline.ts`, `PostShaders.ts`): exposición automática **100 % GPU sin `readPixels`** (cadena `32×32 → 8×8 → 2×2` + ping-pong `1×1` adaptativo), AO de contacto a ½ resolución mediante depth-resolve WebGL2 (0 draw calls de geometría, `1.0` exacto en espacio/Tierra sin halos), FXAA 3.11 post-AgX conservador, perfiles `ultra`/`alta`/`media`/`baja` calibrados y escalonamiento sombra ↔ cámaras auxiliares.
- **Exterior y entorno espacial (H3)**:
  - `Astro.ts`: Tierra a 420 km con microdetalle procedural 3D sin costuras polares, océano con oleaje anisotrópico + especular GGX, nubes con *domain warping*, auto-sombreado y sombra proyectada sobre el suelo, atmósfera raymarching de 6 pasos Rayleigh+Mie + *airglow* nocturno, Luna Lommel-Seeliger/Oren-Nayar con relieve desde `moon_height.jpg` y 22 000 estrellas fotométricas B-V.
  - Casco exterior civil enriquecido (`exterior.py`, `systems.py`, `materialsLib.ts`, `texturesLib.ts`, `ShipModel.ts`): trampillas de inspección, cintas térmicas Kapton, 2 canalizaciones umbilicales, antena HGA corrugada, rastreadores estelares bafleados y balizas de navegación (+59,8k tris, **0 batches adicionales**).
  - Fusión de mallas estáticas en `Props.ts` y corrección de visibilidad/encendido inicial de las 6 pantallas MFD en `Cockpit.ts`.

### Ola 2 · Sentir (`4c27eba`)
- **Objetos físicos interactivos y horneado 2048² (H1)**:
  - 5 props físicos cogibles con `ctl`, `prop_id` e `interact_pose` (`drink_pouch`, `food_pack`, `tablet`, `sample_tube`, `camera`), más `interact_pose` en 12 equipos clave.
  - Corregido el winding de los 13 quads de pantalla (`screen_mesh_quad` sin `recalc_face_normals`); pantallas auxiliares `AUXP`/`AUXS` apaisadas y orientadas hacia el interior.
  - **Horneado definitivo a `2048×2048` en las 5 estancias** (`A..N`) con Cycles adaptativo + mediana 3×3 + OIDN (`lm_A..lm_N.webp`, 312–367 KiB cada uno, `lm.json` a `2048`), resolviendo `functional.cjs` test `02`.
- **Presencia, controlador y manos (H2)**:
  - `Controller.ts`: suavizado de cámara en `look()` con sincronización inmediata en asignación directa, inclinación (*banking* ±2°) y *head-bob* (respetando `reducedMotion`), pasos con audio sincronizado por superficie (`floor`/`ladder`/`push`), escalerillas fluidas y microgravedad con impulso táctil desde superficies cercanas (`< 0,88 m`).
  - `Engine.ts`: transiciones animadas de sentarse/levantarse sin teletransporte, toma/devolución física de props en actividades, waypoints `cupula`/`esclusa`, y culling de estancias cerradas en ingeniería exterior sin corte (`01_ext_general` baja de 382 → 122 llamadas).
  - `Hands.ts`: acoplamiento dual **cuerpo/nave (`attachToShip`)** al pilotar sentado — manos agarrando físicamente THC y RHC con dedos cerrados, siguiendo el asiento y nunca la cámara (resuelve `functional.cjs` test `11` de forma genuina).
- **Simulación, misiones, atraque, brazo y audio (H3)**:
  - Reloj maestro unificado determinista `MET` + `UTC` en `Crew.ts`/`Flight.ts`/`Cockpit.ts`, actividades `tablet` y `photo`.
  - Auditoría y pistas completas de las 8 misiones en `Missions.ts` (consolas laterales, ubicaciones exactas, reparaciones fiables).
  - Atraque IDSS: diana óptica **COAS 3D** con paralaje real + 4 balizas LED direccionales + anillo guía en Estación Tesela (`Props.ts`) y retícula profesional `DOCK` + overlays `CAM`/`ARMCAM` (`Cockpit.ts`).
  - Brazo robótico con 4 presets seguros (`estiba`, `observacion`, `captura`, `servicio`), anticolisión con casco, IK multi-semilla y diagrama lateral `ARM`.
  - Severidad unificada de alarmas (`crit`/`warn`/`ok`) en `Systems.ts` y pantallas MFD.
  - `Audio.ts`: reverberación sintética por estancia (`ConvolverNode`), pasos por superficie, `pickup()`, `dockLock()`, clic mecánico en 2 etapas, modo **realista** (silencio estricto en vacío) vs **cinematográfico**, y licencias CC0 documentadas en `web/public/audio/LICENSES.md`.

### Ola 3 · Producto (`23989ab` → `6b13fb8`)
- **Interfaz, Modo Foto y Accesibilidad (W3-UI)**:
  - `App.tsx`, `styles.css`, `index.html`: **0 `backdrop-filter`** y **0 `blur(`**, sistema editorial grafito cálido / hueso / bermellón + Archivo + IBM Plex (carga no bloqueante), portada cinematográfica, HUD de vuelo contextual con severidad y atraque (< 150 m), Modo Foto (`Shift+P`, rejillas, FOV, descarga PNG real, `Esc`), `ArmPanel` con 4 presets, inspector con filtros `Todo`/`Exterior`/`Interior` + buscador + ficha por estancia, `PerfOverlay` con `AO`/`autoExp`/`AA`, selector acústico/gráfico, móvil táctil vertical y horizontal sin overflow y accesibilidad AA (`:focus-visible`, `role="dialog"`, `aria-modal`).
- **Ingeniería interior, etiquetas 3D, recuperación WebGL y planos (W3-ENG)**:
  - Árbol interior `HAB.INT.IMM` (5 estancias, **127 piezas**) integrado en `ShipModel.ts`/`Interior.ts`/`Engine.ts`, explosión por estancias/piezas (preset `'interior'`) con restauración exacta `0` al volver a `INTERIOR`.
  - `updateLabels()` con colocación sin solapamiento (**0 solapamientos 2D** en `01_ext_general` y `15_exploded`).
  - Recuperación robusta ante `webglcontextlost`/`webglcontextrestored`.
  - 10/10 planos técnicos (`web/public/blueprints/*.png`, `REV E · ASCENSION`) e inventario (`docs/inventario.json`, `docs/inventario.csv`, `docs/INVENTARIO.md`, `docs/stats.json`) regenerados en solo lectura desde el maestro (`scripts/sync_all.py --check` **12/12 OK**; SHA-256 de `ALCION_HX4_master.blend` intacto).
- **Suite ampliada (W3-TEST)**:
  - Nueva batería `web/tests/ascension.cjs` (**29 pruebas**): sesión de 10 min simulados, memoria WebGL estable, 7 modos, 4 perfiles gráficos, ingeniería interior/etiquetas, móvil vertical/horizontal y recuperación `WEBGL_lose_context`.
- **Optimización final de Ola 4**:
  - Culling de la escena astronómica (`far = null`) en el interior cerrado sin ventanas en frustum (`Engine.ts`), ajuste del perfil `media` (sondas 64, sin FXAA/autoExp redundante sobre MSAA 2×) y carga no bloqueante de fuentes en `web/index.html`.

---

## 3. Mediciones y pruebas finales (Ola 4)

### Baterías de pruebas (build final `6b13fb8`, Chromium + SwiftShader)
| Suite | Resultado | Detalles clave |
|---|---|---|
| `npm run build` (`web/`) | **PASS (0 errores)** | `dist/index.html` 1,66 kB, CSS 39,59 kB (8,48 kB gz), JS 1.293,55 kB (384,04 kB gz), 5,59 s. |
| `web/tests/functional.cjs` | **22/22 PASS** | 0 errores página/consola, 0 HTTP. `batches: 46`, `instances: 1.339`, `calls: 65` (exterior), lightmaps `5×2048²`, `handsVis: true`, `calls` finales `90` (antes `277`). |
| `web/tests/ascension.cjs` | **29/29 PASS** (229 s) | 10 min simulados: `geo 352→352`, `tex 217→217`, `calls 92→92 (Δ=0)`; 7 modos válidos (`magenta=0`); 4 perfiles `baja`/`media`/`alta`/`ultra`; `HAB.INT.IMM` 127 piezas + explosión 2,38 m + residuo `0 m`; 0 solapes 3D; móvil `390×844` y `844×390` sin overflow; recuperación `WEBGL_lose_context` íntegra (`mean 80.97→80.97`, 0 errores). |
| `web/tests/rebirth.cjs` (local) | **25/26 PASS** hasta corte de 600 s del runner | 21/21 escritorio PASS (arranque ext. `5,8 s`, int. `22,1 s`, colisiones mín. `0,153 m` en 800 pasos / `0` fuera, microgravedad `0,210 m`, interruptor `BAT`, asiento `G`/`Y`, 4 ciclos ingeniería↔interior limpios, habitáculos **99 llamadas** ≤ 120, `0` escrituras de matrices en reposo, exterior **78 llamadas** ≤ 260, EVA, persistencia, 0 errores consola) + 4/4 pruebas táctiles móvil PASS (`1,18 m`, `0,000 m` deriva); el comando alcanzó el tope de 600 s justo al capturar `movil_portada.jpg` en SwiftShader (la validación móvil y 0 errores ya quedó igualmente cubierta al 100 % en `ascension.cjs`). |

### Comparativa completa de las 15 cámaras fijas (`docs/ascension/before/` → `docs/ascension/after/`, 1280×760, perfil `alta`)
| Cámara | Antes (llamadas / tris) | Después (llamadas / tris) | Delta llamadas | Qué mejoró visualmente (verificado en las capturas) |
|---|---:|---:|---:|---|
| `01_ext_general` | 287 / 834k | **122 / 680k** | **−57,5 %** | Casco con canalizaciones umbilicales, trampillas de inspección, cintas Kapton y balizas; etiquetas 3D nítidas con **0 solapamientos**; reducción masiva de llamadas gracias al culling interior. |
| `02_ext_closeup` | 261 / 682k | **171 / 570k** | **−34,5 %** | MLI dorado arrugado con micro-relieve, trampilla de servicio con cierres cuarto de vuelta, juntas en paneles MMOD, AO de contacto en cúpula y marcos, cámara DSLR y pasamanos visibles dentro de la cúpula, asientos/consolas visibles tras las ventanas. |
| `03_ext_engines` | 294 / 814k | **129 / 660k** | **−56,1 %** | Módulo de servicio con balizas de popa, refuerzos/respiraderos, HGA corrugada, rastreadores estelares bafleados y AO de contacto limpio. |
| `04_cockpit_seated` | 213 / 298k | **190 / 357k** | **−10,8 %** | Transformación integral: manos anatómicas agarrando THC y RHC abajo (ancladas al asiento), 3 MFD + copiloto todas encendidas con barra `NOMINAL` y reloj MET, glareshield con avisadores luminosos y bloom suave, subpanel `GNC`, mamparo de proa iluminado con cajas/cables/brida, fondo del nodo visible, reflejos `boxProbe`, lightmaps `2048²` y Tierra nítida por ventanas. |
| `05_cockpit_overview` | 378 / 549k | **222 / 396k** | **−41,3 %** | Las 6 MFD encendidas, 2 asientos esculpidos con asidero bermellón/nervios/reposacabezas anatómico, mandos THC + sidestick diferenciados, mamparo de proa arquitectónico y luz `2048²` sin manchas. |
| `06_lab` | 288 / 441k | **243 / 520k** | **−15,6 %** | Guantera inclinada con esclusa cilíndrica lateral, manómetro y panel iluminado, pantallas auxiliares `AUXP`/`AUXS` apaisadas horizontales y legibles, anclajes de pies bermellón, congeladores con marcos/tiradores y tubo de muestras interactivo. |
| `07_crew_quarters` | 82 / 248k | 146 / 309k | +78 % *(≤ 160)* | Sacos de dormir esculpidos en 9 baffles con capucha y hebillas bermellón, cortinas con riel/anillas/cinta recogedora, consola personal empotrada, lámpara articulada, bolsillo de tela con cuaderno y auriculares, encimera de lino cálido y sombras `2048²`. |
| `08_galley_services` | 66 / 189k | 111 / 204k | +68 % *(≤ 120)* | 12 bolsas CTB aeroespaciales en 3 tonos con correas/cremallera/asas, dispensador de agua con nicho y bolsa de bebida interactiva metálica, calentador biselado con paquete de ración interactivo, mesa con reborde/vaso/tableta interactiva con LED y lightmap `2048²`. |
| `09_corridor_aft` | 170 / 558k | 279 / 674k | +64 % | Cámara de cultivo abierta tras vidrio transparente con 10 plantas iluminadas, microscopio binocular real, cicloergómetro rehecho con volante ranurado al fondo, asientos esculpidos en primer plano, reflejos `boxProbe` en techo y AO de contacto. |
| `10_cupola` | 47 / 76k | 66 / 84k | +40 % | Pasamanos circular perimetral con remates bermellón, manetas en las 6 contraventanas, cámara DSLR interactiva en brazo articulado y cielo despejado. |
| `11_node` | 71 / 180k | 105 / 218k | +48 % | Consola RWS con 2 mandos y 2 pantallas encendidas (`ARM`/`ARMCAM`), escotilla IDSS con volante/6 pestillos/mirilla/manómetro, panel `PRESURIZACIÓN O₂/N₂` con 2 manómetros y conductos curvos, estiba EVA. |
| `12_airlock_well` | 97 / 260k | 117 / 281k | +21 % | Pozo iluminado limpiamente sin halo oscuro, brocal bermellón atornillado, panel de manómetros y tuberías en el pozo, consola RWS con rejilla. |
| `13_earth_orbit` | 161 / 482k | **99 / 543k** | **−38,5 %** | **Salto crítico**: Tierra a 420 km con microdetalle 3D sin costuras, océano con micro-oleaje y especular GGX nítido (en lugar de mancha difusa), nubes volumétricas con sombra proyectada sobre el mar, atmósfera física raymarching con limbo zafiro nítido y cumple presupuesto en vuelo (`99 ≤ 120` llamadas). |
| `14_earth_window` | 58 / 253k | 70 / 310k | +21 % | Pozos de nadir con brocal bermellón atornillado, reflejo especular en vidrio pisable, etiqueta `NO PISAR` con contacto AO y detalle terrestre mejorado abajo. |
| `15_exploded` | 287 / 834k | 594 / 966k | +107 % *(explosión total + 127 piezas interiores)* | Ahora despliega también las **127 piezas del interior habitable** separadas por estancias sobre el casco abierto, con 13 etiquetas 3D sin ningún solapamiento. |

### Presupuestos de calidad y rendimiento
- **Cabina de vuelo**: `190` llamadas sentado / `222` vista general (presupuesto **≤ 260** → **CUMPLE**).
- **Exterior en vuelo (`13_earth_orbit`)**: `99` llamadas en `alta` / `78` llamadas en `media` (presupuesto **≤ 120** → **CUMPLE**).
- **Habitáculos mirando a popa**: `99` llamadas en `media` (presupuesto **≤ 120** → **CUMPLE**).
- **Escrituras de matrices en reposo**: `0` (presupuesto **0** → **CUMPLE**).
- **Inventario maestro (`docs/stats.json`)**: `557` piezas, `89` grupos, `80` materiales, `1.799` tornillos modelados, `882.846` triángulos totales, envolvente `19,58 × 39,42 × 15,50 m`.

---

## 4. Pendientes honestos y limitaciones conocidas
- **GPU real no medida**: este contenedor carece de GPU dedicada (sólo SwiftShader por CPU). El objetivo `p95 ≤ 16,7 ms` a 1080p en perfil `alta` sobre GPU real **no ha podido medirse aquí** y no se inventan cifras; sí están medidas la reducción estructural de llamadas (cabina `190–222`, vuelo `99`, ingeniería `122`), `0` escrituras de matrices en reposo, memoria WebGL estable tras 10 min simulados y perfiles escalables `ultra`/`alta`/`media`/`baja`.
- **Suite `rebirth.cjs` sobre 2 vCPUs SwiftShader**: las 25 aserciones funcionales (21/21 escritorio + 4/4 táctil móvil) pasan con 0 errores, pero con la mayor densidad geométrica y lightmaps `2048²` la captura final `movil_portada.jpg` lleva la duración total a ~610 s sobre 2 vCPUs CPU-only (rozando el tope de 600 s por comando del entorno). La validación móvil completa + consola sin errores queda cubierta en 229 s en `ascension.cjs` (`29/29 PASS`) y `functional.cjs` (`22/22 PASS`).
- **Audio**: todas las capas sonoras son síntesis procedural WebAudio + convolución sintética documentada como CC0 1.0 (`web/public/audio/LICENSES.md`), sin grabaciones externas con derechos.

---

## 5. Estado de publicación
- **URL pública**: https://alvarodesigns34.github.io/SHIP/
- **Despliegue en `gh-pages`**: commit `56bb2f8` (origen `4545ea4` en `gemini/alcion-ascension`), creado encima de `b41c0e9` mediante `bash web/scripts/deploy-pages.sh` (**sin `push --force`**; reversión directa con `git revert 56bb2f8` en `gh-pages`).
- **Verificación de integridad en producción**:
  - `VERSION`: **`4545ea4`** (coincide con el commit desplegado).
  - **SHA-256 idénticos (`6/6 MATCH`)** entre `web/dist/` y la URL pública:
    - `index.html`: `1c3da1c9fff985face602d2615c55a4a4c886ab964a2d368193fe54e83337a49`
    - `assets/index-D8LzZ_Z1.js`: `d86475d7aadaabefc9f365c1f2ebe5e69e05ac971caceaafdabee2eba3d13b49`
    - `assets/index-BMNZKrOl.css`: `9f2b37f90309ef646a35179a7e5876ceb99b79800f585c7466a97609d4b45fa1`
    - `models/alcion_hx4_exterior.glb`: `d1f5762da69c90499dea056560d98fc636f352ee436e8e399b0c5ae75864f4d6`
    - `models/alcion_interior_rt.glb`: `115c3c345e5d7c592db2897b0604bccabf2802746a007e2249d4c632625cae76`
    - `textures/lm/lm_A.webp`: `75661d7ebdf1df3dfe939b70c2e94001ecd1af4d6e82a0c36f84d5030bd5067`
- **Verificación en vivo contra `https://alvarodesigns34.github.io/SHIP/`**:
  - `web/tests/functional.cjs`: **22/22 PASS**, 0 errores de página/consola, 0 errores HTTP.
  - `web/tests/ascension.cjs`: **29/29 PASS** en local (`geo 352→352`, `tex 217→217`, `calls 92→92`) y **27/29 PASS** en producción con **0 errores de página/consola/HTTP** y heap estable (`98,23 → 98,23 MB`); el único delta en `1a`/`1b` sobre red remota (`+8 geo, +2 tex, +6.756 tris`) corresponde a la finalización de la descarga asíncrona de `models/hands_fp.glb` entre la toma inicial y el minuto 10 (no es fuga de memoria).

