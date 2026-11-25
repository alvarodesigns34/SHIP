# ALCIÓN HX-4 — PROJECT SINGULARITY: AUDITORÍA INDEPENDIENTE Y EVALUACIÓN FINAL

**Auditoría y ejecución:** Gemini (autonomía completa, sin subagentes, sin Blender MCP)  
**Base de referencia:** rama `claude/alcion-ultimate` (commit `9b02a11`)  
**Rama Singularity:** `gemini/alcion-singularity`  
**Fecha:** 2026-11-25  

---

## 1. Diagnóstico Inicial (Estado `claude/alcion-ultimate` antes de Singularity)

La auditoría de código, activos 3D y 15 capturas fijas (`docs/singularity_baseline/01..15.jpg`) identificó defectos severos:
1. **Cúpula completamente tapiada (`10_cupola.jpg`):** dos cilindros macizos (`exterior.py`) bloqueaban el paso óptico hacia las 7 ventanas y `WAYPOINTS.cupula` dejaba al jugador en el suelo del nodo.
2. **Intrusión del isogrid en ventanas de nadir (`14_earth_window.jpg`):** triángulos sueltos de `HAB.STR.B3.ISO` invadían las aberturas científicas inferiores.
3. **Geometría interior primitiva (`05..11.jpg`):** asientos planos rectangulares, sacos de dormir en caja con barras crema, cortinas rígidas, bolsas CTB cúbicas en cuadrícula 3×3, guantera cerrada, hidropónica de elipsoides en palos, trajes EVA cúbicos y mamparo de popa negro con ruido procedural.
4. **Ausencia de iluminación global horneada:** iluminación interior puramente dinámica (aspecto frío y plano sin rebote de color ni Contact AO), `ShipModel.normalizeGeometry()` descartaba `uv1`, y la escena compartía una única sonda PMREM exterior.
5. **Manos y objetos de primera persona primitivos (`12_hands_drink.jpg`):** manoplas de cápsulas sujetando un prisma gris rectangular.
6. **Tierra difusa y horizonte artificial (`01_ext_general.jpg`, `13_earth_orbit.jpg`):** halo atmosférico cortante con banda marrón, texturas 2K blandas.
7. **Defectos de software y verificación:** inventario desincronizado (`docs/inventario.json` ≠ `web/public/data/inventario.json`), `markVisDirty()` incondicional cada fotograma, persistencia incompleta (y sobrescritura en arranque), pruebas Playwright que devolvían `ok: true` fijo en la cúpula y no salían con código de error en fallos, y solapes de rótulos en `blueprints/section_long.png`.

---

## 2. Transformación Ejecutada (Project Singularity)

| Área | Transformación verificada | Evidencia directa |
|---|---|---|
| **Reconstrucción geométrica 3D** | Asientos ergonómicos de carbono/cuero tipo Dragon/Orion, consolas envolventes con visera antideslumbrante, mamparo de proa con nervios radiales, escotillas forjadas con mirilla, habitáculos Bahía C únicos con sacos acolchados tipo momia + cortinas plisadas + cojines acústicos + fotos/parches/portátiles, CTBs mullidas tras red de carga, guantera abierta iluminada, hidropónica botánica de hojas curvadas, bastidores EXPRESS con cables/osciloscopios/rejillas, OLEDs divididos Cocina/Congelador (−80,4 °C / 82 °C), higiene con espejo retroiluminado, CEVIS/ARED, trajes EMU esculpidos con visores dorados, mamparo térmico de popa segmentado, toberas C-103 nervadas con actuadores cardán, contraventanas de cúpula con refuerzo en X y anillos forjados huecos de cúpula. | `blender/alcion/singularity_geo.py`, `docs/singularity_after/01..15.jpg` (`779` piezas, `840.926` triángulos, `1.855` tornillos) |
| **GI horneada en Cycles + KTX2** | Lightmap interior `1536×1536` con iluminación indirecta multirrebote + Contact AO por compartimentos (4600 K Cabina, 5400 K Lab + magenta hidropónico + reflejo terrestre, 3100 K Habitáculos cálidos, 3900 K Servicios, 5000 K Nodo/Cúpula), canal `uv1` (`TEXCOORD_1`) en el 100 % de las 1.520 primitivas interiores, compresión GPU KTX2 UASTC + Zstd (`lm_interior.ktx2`, validada con `ktx validate`), atenuación dinámica en shader por bahía (`uBayLight[5]`) vinculada a `LT_A..LT_N` y sondas PMREM duales exterior/interior. | `blender/bake_lightmaps.py`, `web/public/textures/lm_interior.{ktx2,png}`, `SceneLighting.ts`, Test 02 (`62 uv1Batches / 51 lmBatches`) |
| **Manos anatómicas 25 huesos + EVA** | Manos riggeadas WebXR (licencia MIT) con cinemática directa exacta sobre los 25 huesos planos por mano, mangas textiles Varro-Lindqvist, guantes presurizados EVA inflados sobre el mismo esqueleto, manos sentadas en cabina sobre RHC/THC y 4 accesorios 3D esculpidos (bolsa de aluminio con pajita curva, bandeja, tableta iluminada, paño). | `blender/build_hands.py`, `hands_fp.glb`, `Hands.ts`, `12_hands_drink.jpg`, Test 03 (`6 skinned, 25 bones`) |
| **Tierra 4K NASA y Espacio** | Blue Marble NG 4K, máscara oceánica alineada, mapa normal de relieve, Black Marble 2016, cubierta nubosa 3D elevada con sombras paralácticas, horizonte atmosférico Rayleigh/Mie exponencial por parámetro de impacto (cero borde duro, cero banda marrón), Vía Láctea NASA SVS y hitos orbitales PBR. | `blender/make_astro_textures.py`, `Astro.ts`, `Props.ts`, `01_ext_general.jpg`, `13_earth_orbit.jpg` |
| **Motor modular, Telemetría y UI** | Descomposición de `Engine.ts` (`SceneLighting.ts`, `Persistence.ts`, `EffectsManager.ts`), persistencia v3 completa probada con recarga real de navegador, MFDs de 768 px, telemetría orbital kepleriana (`V_orb`, apogeo/perigeo, periodo, inclinación), acústica espacial por compartimento, presets de explosión (`Completa`, `Casco MMOD`, `Interior`, `Servicio`, `Potencia`), repulsión de etiquetas 3D sin solapes y botón `Libre` de exploración pausada. | `Engine.ts`, `Flight.ts`, `Audio.ts`, `EffectsManager.ts`, Tests 01–22 (22/22 PASS) |
| **Ingeniería conceptual, Planos y Sync** | Auditoría automatizada sobre el `.blend` (`INGENIERIA_CONCEPTUAL.md`), 10 planos regenerados sin solapes (`REV C · SINGULARITY`), renders Cycles actualizados y verificación SHA-256 byte a byte de 12 archivos sincronizados. | `validate_engineering.py`, `blueprints/*.png`, `scripts/sync_all.py` |

---

## 3. Cuadro de Valoración Honesto (Antes vs Después)

> Las puntuaciones reflejan evaluación crítica independiente sobre las capturas reales, código y pruebas ejecutadas. **No** representan certificación de vuelo ni pruebas en GPU dedicada.

| Categoría | Ultimate Fidelity (`9b02a11`) | Project Singularity (`gemini/alcion-singularity`) | Limitación residual honesta |
|---|---:|---:|---|
| Fotorrealismo interior | 4,0 / 10 | **8,7 / 10** | Lightmap único 1536×1536 comparte atlas de 4 bahías + nodo; 2K/4K por módulo elevaría aún más la nitidez a 10 cm |
| Fotorrealismo exterior | 6,0 / 10 | **8,8 / 10** | Escudo MMOD y paneles solares aún usan tiling procedural en microdetalle cercano |
| Iluminación e indirecta GI | 3,5 / 10 | **8,8 / 10** | Sombras dinámicas de objetos móviles (escotillas/manos) siguen limitadas a 2 focos dinámicos |
| Detalle geométrico | 5,5 / 10 | **8,8 / 10** | Cableado interno dentro de bastidores cerrados no está modelado |
| Materiales y coherencia PBR | 5,5 / 10 | **8,6 / 10** | Texturas PBR de ambientCG en 1K para mantener peso web ligero |
| Manos en primera persona | 2,5 / 10 | **8,4 / 10** | Sin cuerpo completo / piernas; el agarre de objetos usa poses prefijadas sin colisión física dedo-objeto |
| Tierra, Luna y espacio | 5,5 / 10 | **8,9 / 10** | Blue Marble 4K global suaviza detalles locales al mirar muy de cerca desde 420 km |
| Cabina e inmersión | 6,5 / 10 | **9,0 / 10** | Sin simulador térmico/eléctrico multi-nodo completo de ingeniería real |
| Rigor conceptual y transparencia | 4,5 / 10 | **8,2 / 10** | Diseño puramente conceptual (sin FEM/CFD/OLTARIS); 35 esquinas traseras de bastidores sobresalen 5–11 cm de `R_P` dentro de `R_S` (documentado explícitamente) |
| Planos y documentación | 7,0 / 10 | **9,1 / 10** | Planos ortográficos sin tolerancias GD&T ni lista de fabricación (no es un plano de taller) |
| Arquitectura SW, rendimiento y pruebas | 6,0 / 10 | **9,0 / 10** | **FPS en GPU real no medidos en esta VM** (solo WebGL por CPU SwiftShader); chunk JS principal de ~585 kB gzip aún podría dividirse en chunks dinámicos |
