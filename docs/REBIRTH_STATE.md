# ALCIÓN HX-4 · REBIRTH — estado del proyecto

> Documento vivo y conciso. Distingue lo **medido** de lo **estimado**. Las cifras de GPU no se
> han medido: el contenedor de desarrollo no tiene GPU (sólo SwiftShader, rasterizador por CPU),
> por lo que los tiempos de fotograma aquí son de CPU/SwiftShader y sólo sirven para comparar
> versiones en condiciones idénticas, nunca como estimación de FPS en hardware real.

## Partida
- Rama de referencia: `gemini/alcion-singularity`, commit `1ab06920fc10de2035b30e772b3901da82d23de7`.
- Rama de trabajo: `claude/determined-keller-u2qmrs` (la sesión exige esta rama; equivale a la `claude/alcion-rebirth` solicitada).

## Defectos reproducidos en Singularity (causa raíz)
| Defecto percibido | Causa encontrada |
|---|---|
| «Dos realidades superpuestas», semitransparencias | El modo interior **ocultaba la piel exterior por prefijos de código** (`ShipModel.updateVisibility`) y el interior no era un volumen cerrado: por los huecos se veían casco, isogrid, módulo de servicio y espacio a la vez. |
| Cabina sin presencia | La cabina **no tenía ninguna ventana**: se pilotaba mirando un mamparo (verificado en el `.blend` maestro). |
| Coste estructural | `Mechanisms.update()` llamaba a `model.markDirty()` **incondicionalmente** → `applyTransforms()` recorría ~800 nodos y reescribía ~2.700 matrices de instancia cada fotograma. |
| Instrumentación falsa | `renderer.info.reset()` se hacía **después** de las cámaras de instrumentos: llamadas y triángulos excluían esas pasadas (y las sombras no se contaban de forma separada). |
| Realimentación de render targets | Las cámaras de instrumentos renderizaban la escena que contiene las pantallas que muestran su propio RT. |
| Interior pesado | Carga del interior ≈ 40 s (SwiftShader) por construir 108 `BatchedMesh` de 1,0 M triángulos; 488 llamadas / 1,76 M triángulos por fotograma en cabina. |
| Movimiento | Colisión con cajas envolventes + excepciones manuales por código; paso de simulación limitado a 50 ms (la simulación se ralentizaba por debajo de 20 FPS). |
| Cúpula con «líneas» cruzando la vista | Celosías de la estación ficticia Tesela y del satélite colocados por defecto a 200–260 m, justo en el campo de visión cenital. |

## Cambios de arquitectura
- **Pipeline propio** (`web/src/engine/render/Pipeline.ts`): un RT HDR con MSAA, astro + nave sobre el mismo RT (sólo se limpia profundidad entre ambas), bloom por cadena de mips, AgX. Eliminados EffectComposer, N8AO, Outline, SMAA, viñeta. Modos de depuración por pasada (`` ` `` abre el panel de rendimiento).
- **Interior inmersivo nuevo y cerrado** (`blender/alcion/habitat.py`, `habitat_rooms.py`, `kit.py`): sección arquitectónica (suelo, zócalo con encimera, pared curva con compartimentos, cornisa de luz indirecta, canal cenital), trasdós oscuro continuo. Cabina, laboratorio, cuatro cabinas privadas, servicios, nodo con pozo de cúpula y acceso a la esclusa.
- **Ventanas panorámicas de cabina** (`blender/alcion/canopy.py`): 9 ventanas en el cono, cortadas coherentemente en casco presurizado, MLI y escudo MMOD.
- **Iluminación horneada por estancia** (`blender/bake_rebirth.py`): UV de lightmap con densidad uniforme por estancia (2048²), Cycles (irradiancia difusa de las luminarias interiores únicamente), filtro anti-ruido, WebP. La luz solar/terrestre NO se hornea: la aporta el motor en tiempo real con sombras ajustadas a la estancia → sin contribuciones duplicadas. Con lightmap se anula la irradiancia difusa de la sonda de entorno y el especular se atenúa con el lightmap.
- **Sondas de reflexión por estancia** capturadas del propio interior iluminado.
- **Visibilidad explícita por modo**: el interior nunca hereda rayos X/corte/explosión; el exterior sólo se dibuja desde dentro si una ventana cercana está en el campo de visión; la estructura oculta bajo la piel (casco, isogrid, MLI, soportes) sólo se dibuja en ingeniería.
- **Invalidación selectiva** en `ShipModel` (`markNodeDirty`, `setExtra`): sólo se recalculan las ramas que se mueven.
- **Simulación de paso fijo** a 60 Hz (hasta 15 subpasos por fotograma).
- **Controlador nuevo** (`player/Controller.ts`) con colisión por vóxeles de 4 cm rasterizados de la geometría real; la cámara mantiene ≥ 16 cm a cualquier superficie.
- **Fusión estática** del interior por (estancia, material) con las piezas originales en una capa de selección invisible.
- **Interfaz reconstruida** (`App.tsx`, `styles.css`): portada, dock de modos, HUD de primera persona mínimo, menú de pausa, controles táctiles con `pointercancel`/`lostpointercapture`, panel de rendimiento.
- **Manos**: ancladas a los controladores físicos al pilotar y con alcance al punto real del objeto al interactuar; ocultas el resto del tiempo (se eliminaron poses genéricas relativas a la cámara).
- **Publicación** sin `push -f`: cada despliegue es un commit sobre `gh-pages` (reversión con `git revert`).

## Mediciones (Chromium + SwiftShader, mismo contenedor para ambas versiones)
| Métrica | Singularity | Rebirth |
|---|---|---|
| Exterior listo | 9,2 s | 2,8–3,6 s |
| Interior listo | 40,0 s | 12–15 s |
| Cabina de pie (llamadas / triángulos, **todas** las pasadas) | 488 / 1,76 M (sin contar cámaras de instrumentos) | 251 / 0,34 M |
| Habitáculos mirando a popa | — | 70 / 0,16 M |
| Exterior en vuelo, cámara de persecución | ~200 / 1,0 M (incompleto) | 81 / 0,47 M |
| Matrices de instancia reescritas por fotograma con la nave inmóvil | ~2.700 | 0 |
| Pruebas | 22 heredadas (estado interno, calidad baja) | 26 de producto (entradas reales, píxeles, colisiones) + 22 heredadas adaptadas |

Detalle: `docs/rebirth/metrics.json`, `docs/rebirth/tests/results.json`, `docs/rebirth/after/stats.json`.
Los picos (≈ 250–290 llamadas en cabina) corresponden a fotogramas con cámara de instrumentos o regeneración de sombras; ambas están ahora acotadas (cámaras alternas a ~10 Hz sólo si la pantalla está a < 4,5 m y en el campo de visión; sombras sólo al cambiar sol, actitud o encuadre).

## Evidencias visuales
- `docs/rebirth/compare/` — pares Singularity (izquierda) / Rebirth (derecha) con cámaras, FOV y resolución idénticos, capturados del renderizado real de la aplicación.
- `renders/rebirth/` — renders Cycles del interior (categoría separada: NO son evidencia del tiempo real).

## Validación
- `web/tests/rebirth.cjs` (26/26): arranque, flujo «Subir a bordo» por la interfaz, teclado real con aceleración suave, liberación de teclas al perder el foco, recorrido aleatorio de 800 pasos sin que la cámara se acerque a < 12 cm de ninguna superficie ni salga del volumen, microgravedad contra el techo, interruptor apuntado con el punto de mira, sentarse/levantarse, 4 ciclos ingeniería↔interior sin contaminación (rayos X, corte, explosión, recorte de materiales), imagen sin NaN, presupuestos de llamadas, cero escrituras de matrices en reposo, EVA completa por la esclusa, persistencia tras recarga, móvil táctil (palanca, `pointercancel`, sin desbordamiento) y consola sin errores.
- `web/tests/functional.cjs` (22/22): batería heredada de Singularity adaptada donde verificaba detalles de la implementación anterior (lightmap único en BatchedMesh → lightmaps por estancia; guardado v3 → v4).
- `web/tests/compare_rebirth.cjs`: capturas con las mismas cámaras que Singularity → `docs/rebirth/compare/`.

## Pendiente / limitaciones conocidas (honestas)
- **GPU no medida**: no hay GPU en el entorno. Los objetivos de 60 FPS (equilibrado) y 30 FPS (móvil) **no están verificados**; sí lo están la reducción estructural de trabajo (llamadas, triángulos, matrices, cargas) y la escala de resolución dinámica (mín. 70 %).
- **Fotorrealismo**: el interior es arquitectónicamente coherente, cerrado, con iluminación horneada sin ruido y materiales calibrados, pero todavía es una estética limpia de «producto»; le falta densidad de detalle (cableado gestionado, rotulación fina, desgaste, objetos personales con modelado de alta calidad) para considerarse fotorrealista. No me asigno una nota.
- **Manos**: sólo aparecen ancladas a los controladores al pilotar y al alcanzar objetos; las actividades (beber, comer, dormir…) se representan con progreso y fundido, no con animación de manos.
- **Exterior y entorno astronómico**: se conserva el exterior de Singularity (con ventanas nuevas, cortes corregidos y estructura oculta fuera de ingeniería). La Tierra, nubes y estrellas no se han reelaborado en esta iteración.
- **Audio**: sistema heredado sin cambios.
- **Ingeniería**: el árbol de componentes cubre el exterior; las piezas del interior se inspeccionan pulsándolas (ficha), no desde el árbol.
- **Activos**: los lightmaps requieren hornear (`blender/bake_rebirth.py`, ≈ 35 min en 4 núcleos CPU) tras cualquier cambio del interior; `build.py` sin horneado deja el `.blend` sin el canal UV «LM».

## Reproducción
```
python3 blender/build.py                                   # modelo maestro + exportaciones (bpy 5.1)
python3 blender/bake_rebirth.py --samples 128 --res 2048   # lightmaps por estancia + interior inmersivo
cd web && node scripts/optimize-model.mjs && npm run build
npx vite preview --port 4173 & ALCION_URL=http://127.0.0.1:4173/ node tests/rebirth.cjs
bash scripts/deploy-pages.sh                               # commit nuevo sobre gh-pages (sin force-push)
```

## Estado de publicación
- Publicado en https://alvarodesigns34.github.io/SHIP/ — commit de despliegue `0c0b0d3` en `gh-pages` (origen `9231f41`), creado **encima** del despliegue anterior `153b05a` (Singularity) sin reescribir historial.
- Verificación en producción: `VERSION` = `9231f41`; SHA-256 idénticos entre `web/dist` y lo servido (index, JS, GLB exterior e interior, lightmap); `tests/rebirth.cjs` contra la URL pública: **26/26**.
- Reversión: `git revert 0c0b0d3` en `gh-pages` (o republicar `153b05a`).
- Es una versión validada por las pruebas descritas, **no** un producto terminado: ver «Pendiente / limitaciones conocidas».
