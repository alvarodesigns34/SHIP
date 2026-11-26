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

## Mediciones
Ver `docs/rebirth/metrics.json` y `docs/rebirth/tests/results.json` (generados por las pruebas).

## Evidencias visuales
- `docs/rebirth/compare/` — pares Singularity (izquierda) / Rebirth (derecha) con cámaras, FOV y resolución idénticos, capturados del renderizado real de la aplicación.
- `renders/rebirth/` — renders Cycles del interior (categoría separada: NO son evidencia del tiempo real).

## Pendiente / limitaciones conocidas
Ver sección final (se actualiza al cierre de la sesión).
