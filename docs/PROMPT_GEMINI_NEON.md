# Prompt maestro — ALCIÓN HX-4 · siguiente iteración (Gemini 4 Neon como orquestador + subagentes Hydrogen)

> Uso previsto: Google Antigravity, modelo de la conversación **Gemini 4 Neon** (razonamiento High o Extra), lanzado con `/swarm`. Neon coordina y verifica; los trabajadores son **Gemini 4 Hydrogen**. **Máximo 3 subagentes simultáneos en total** (incluido cualquier verificador o monitor que el enjambre cree por defecto).

---

```
/swarm

ERES EL COORDINADOR (Gemini 4 Neon). Tu trabajo es planificar, repartir, integrar y VERIFICAR.
Los trabajadores son Gemini 4 Hydrogen. Regla dura: NUNCA más de 3 subagentes activos a la vez,
contando verificadores y monitores. No crees @verifier ni @monitor adicionales: la verificación
la haces tú. Responde y documenta siempre en ESPAÑOL.

## 1. Proyecto y punto de partida
- Repositorio: github.com/alvarodesigns34/SHIP. Rama base: `claude/determined-keller-u2qmrs`
  (último commit de Rebirth). Crea tu rama de trabajo `gemini/alcion-ascension` desde ella.
- Producción: https://alvarodesigns34.github.io/SHIP/ (rama `gh-pages`; despliegue actual b41c0e9).
- ALCIÓN HX-4 es una nave civil CONCEPTUAL original (fabricante ficticio Varro-Lindqvist), ~19,6 m,
  4 tripulantes. Simulación educativa y recreativa: nada de armamento realista ni de documentación
  de fabricación.
- LEE PRIMERO, ENTERO: `docs/REBIRTH_STATE.md` (arquitectura, mediciones, limitaciones honestas).
  No re-litigues decisiones que ya funcionan; mejóralas.

Arquitectura vigente (respétala salvo que midas algo mejor):
- Modelo maestro generado por código Python con bpy (Blender 5.1 como módulo, `pip install bpy`):
  `blender/build.py` (~10 s) → `blender/ALCION_HX4_master.blend` + `export/*.glb`.
  Interior inmersivo: `blender/alcion/habitat.py`, `habitat_rooms.py`, `kit.py`, `canopy.py`.
- Iluminación interior horneada por estancia (A cabina, B laboratorio, C habitáculos, D servicios,
  N nodo): `blender/bake_rebirth.py --samples 128 --res 2048` (≈25–40 min en CPU; OIDN incluido)
  → `web/public/textures/lm/lm_*.webp` + `export/alcion_interior_rt.glb`.
  `node web/scripts/optimize-model.mjs` → `web/public/models/`.
- Web: React + TypeScript + Three.js r169 (`web/`). Motor `web/src/engine/Engine.ts`; pipeline propio
  `render/Pipeline.ts` (RT HDR MSAA, bloom por mips, AgX); interior `interior/Interior.ts` +
  `interior/RMaterials.ts` (materiales R_* por nombre, lightmap por estancia, rejilla de vóxeles
  de colisión); jugador `player/Controller.ts`; exterior/ingeniería `ship/ShipModel.ts` (BatchedMesh);
  entorno `world/Astro.ts`; interfaz `src/App.tsx` + `src/styles.css`.
- Pruebas: `web/tests/rebirth.cjs` (26 pruebas de producto con entradas reales) y
  `web/tests/functional.cjs` (22 heredadas). Comparativa con cámaras fijas:
  `web/tests/compare_rebirth.cjs <dir>`. Hoy: 26/26 y 22/22.
- Publicación: `bash web/scripts/deploy-pages.sh` (commit nuevo sobre gh-pages, SIN force push).

## 2. Objetivo
Llevar ALCIÓN HX-4 de "limpio y coherente" a GENUINAMENTE IMPRESIONANTE en tiempo real,
sin perder estabilidad ni rendimiento: calidad de imagen, formas, materiales, entorno espacial,
simulación, inmersión, interfaz y sonido. El criterio es lo que ve y siente un usuario en el
navegador, no la cantidad de código ni de triángulos.

Debilidades conocidas (de REBIRTH_STATE.md, en orden de impacto):
1. Interior: falta densidad de detalle de calidad (cableado gestionado, rotulación fina, desgaste,
   objetos personales y equipamiento con modelado creíble). Piezas toscas: cicloergómetro, asientos,
   puertos de guante, cortinas, bolsas.
2. Exterior y entorno: casco heredado (cilindro con paneles); Tierra/nubes/atmósfera mejorables de
   cerca; estrellas y Luna básicas.
3. Manos: retiradas al pilotar por falta de calidad; actividades sin animación de manos.
4. Audio sin revisar. 5. Árbol de ingeniería sin piezas del interior.
6. Rendimiento en GPU real SIN MEDIR (sólo SwiftShader).

## 3. Reglas de trabajo (obligatorias)
- Cada trabajador posee ARCHIVOS concretos (ver §4). Dos trabajadores nunca editan el mismo archivo
  en la misma ola. Si una tarea necesita tocar un archivo ajeno, se lo pide al coordinador.
- Cada trabajador trabaja en una COPIA DE TRABAJO propia (working copy o rama
  `gemini/ascension-<rol>`) y entrega un parche; el coordinador integra en `gemini/alcion-ascension`.
- HORNEADO = RECURSO EXCLUSIVO: sólo un proceso de `bake_rebirth.py` a la vez en toda la sesión
  (satura la CPU 25–40 min). Agrupa todos los cambios de geometría interior en una tanda por ola.
  Para cambiar sólo luces de una estancia: editar marcadores LMARK_* en el maestro y
  `bake_rebirth.py --rooms X` (no ejecutar build.py antes, o se pierden las UV "LM" de las demás).
- Toda geometría se genera por código (bpy). No edites el .blend a mano ni con Blender MCP: el
  maestro debe ser reproducible desde los scripts.
- Prohibido: inflar triángulos sin beneficio visible, desactivar o rebajar pruebas para que pasen,
  autoevaluaciones numéricas sin evidencia, renders de Cycles presentados como tiempo real,
  force push, borrar historial.
- Si una técnica no mejora la imagen de forma visible en la comparativa, se revierte.
- Commits pequeños y frecuentes con mensaje en español. Nunca dejes `main` ni `gh-pages` rotos.

## 4. Roles (máximo 3 Hydrogen simultáneos)
H1 · ARTE INTERIOR Y MATERIALES
  Posee: blender/alcion/habitat.py, habitat_rooms.py, kit.py, blender/bake_rebirth.py,
  web/src/engine/interior/RMaterials.ts, web/public/textures/pbr/, labels.
  Única con permiso para lanzar horneados.
H2 · MOTOR, RENDIMIENTO, INMERSIÓN
  Posee: web/src/engine/render/, Engine.ts, interior/Interior.ts, player/ (Controller, Hands),
  Input.ts, Persistence.ts, web/tests/.
H3 · EXTERIOR, ENTORNO, SIMULACIÓN, SONIDO
  Posee: blender/alcion/exterior.py, systems.py, canopy.py, expansion.py (sólo exterior),
  web/src/engine/world/ (Astro, Props), sim/, Missions.ts, Audio.ts, ship/ (Cockpit, Systems,
  Mechanisms, ShipModel, materialsLib).
Interfaz (App.tsx, styles.css) y documentación: las asigna el coordinador a quien esté libre en la
ola 3. El coordinador (tú) integra, ejecuta pruebas, captura comparativas y decide.

## 5. Olas
OLA 0 — tú solo, sin subagentes (≤ 30 min):
  npm ci en web/; pip install bpy; build.py; (no hornees: los lightmaps del repo son válidos);
  npm run build; vite preview; ejecuta rebirth.cjs y functional.cjs; captura
  compare_rebirth.cjs → docs/ascension/before/. Detecta el hardware (¿hay GPU? ¿EXT_disjoint_timer_query?).
  Escribe docs/ASCENSION_STATE.md con la línea base medida. Luego lanza la ola 1.

OLA 1 — "imagen" (3 trabajadores en paralelo):
  H1: pasada de densidad y forma en TODAS las estancias. Prioriza lo que más pesa en pantalla:
      asientos de piloto esculpidos (costuras, perforado, bastidor mecanizado), consolas con
      paneles secundarios y botoneras reales, cicloergómetro y guantera rehechos, cableado y
      conductos gestionados en las juntas, rejillas, pasamanos con soportes, objetos personales,
      ropa y tejidos con pliegues (simulación de tela de Blender cuando aporte), desgaste sutil
      (bordes, zonas de paso) mediante máscaras, más rotulación del atlas. Revisa la densidad de
      texel por estancia (sube a 4096 sólo si se ve la diferencia). Una tanda de horneado al final.
  H2: calidad de imagen del pipeline y rendimiento: SSAO/GTAO barato SÓLO para piezas dinámicas o
      sin lightmap si mejora la imagen; reflejos de caja (box-projected env maps) por estancia;
      TAA o mejor antialiasing de bordes finos si el MSAA no basta; exposición automática
      (luminancia media por mips, sin readPixels síncrono); presupuesto de 60 FPS con perfiles
      ultra/alta/media/baja. Mide cada técnica (coste + capturas A/B) y quita lo que no gane.
  H3: exterior y espacio: Tierra con detalle a 420 km (normal + especular oceánico + nubes con
      sombra sobre el suelo + atmósfera con dispersión física), terminador y luces nocturnas,
      Luna con relieve, campo estelar fotométrico; casco con más identidad (paneles con variación,
      cintas, juntas, antenas, luces de navegación) sin cambiar el carácter civil.
  Cierre de ola (tú): integra, compila, 26+22 pruebas, comparativa → docs/ascension/after_ola1/.

OLA 2 — "sentir" (3 trabajadores):
  H2: controlador y presencia: suavizado de cámara, inclinación al girar, pasos con audio
      sincronizado, transiciones de sentarse/levantarse animadas (no teletransporte), escalerillas
      fluidas, microgravedad con impulso desde superficies y asideros; manos de calidad o nada
      (si se recuperan al pilotar, deben AGARRAR los controladores con dedos cerrados y seguir el
      cuerpo, no la cámara).
  H3: simulación: reloj único, misiones más guiadas y fiables, atraque con referencias visuales,
      brazo robótico controlable, alarmas y sistemas coherentes con las pantallas; audio por
      estancia (ventilación, equipos, mecanismos, interacción), modo realista sin sonido en vacío y
      modo cinematográfico; activos sonoros CC0 con licencias documentadas.
  H1: actividades con objetos reales (bolsa de bebida, ración, tableta, muestras) que se toman y
      se dejan; puntos de interacción definidos en las piezas (ctl) con pose y posición.

OLA 3 — "producto":
  Un trabajador: interfaz (portada cinematográfica, HUD de vuelo contextual, modo foto, inspector,
  móvil táctil real, accesibilidad), con el mismo sistema visual actual (grafito cálido, hueso,
  acento bermellón, Archivo + IBM Plex) sin glassmorphism ni desenfoques CSS.
  Otro: árbol de ingeniería con el interior, vista explosionada del interior por piezas, planos
  regenerados (blender/blueprints.py + blueprint_compose.py + scripts/sync_all.py) e inventario.
  Otro: ampliar pruebas (sesión larga de 10 min sin degradación, memoria estable, todos los modos,
  perfiles gráficos, móvil vertical/horizontal, recuperación de contexto WebGL).

OLA 4 — tú: integración final, pruebas, comparativas, documentación concisa y publicación.

## 6. Contrato de cada subtarea (cópialo en cada encargo)
  OBJETIVO: una frase.
  ARCHIVOS QUE POSEES: lista cerrada.
  NO TOCAR: lo demás; nunca bajar umbrales de pruebas ni borrar aserciones.
  HECHO CUANDO: (a) `npm run build` sin errores; (b) `node web/tests/rebirth.cjs` 26/26 o más;
    (c) capturas A/B de las cámaras afectadas en docs/ascension/<ola>/; (d) cifras de llamadas,
    triángulos y ms antes/después; (e) commit en tu rama.
  PARAR Y AVISAR SI: necesitas un archivo ajeno, una técnica empeora la imagen o el rendimiento,
    o el presupuesto de la ola se agota.

## 7. Puertas de calidad antes de publicar (no las rebajes)
- 0 errores de consola; 26/26 + 22/22 (más las nuevas); sin defectos gráficos reproducibles
  (superposiciones, transparencias erróneas, NaN, penetración de cámara, contaminación entre modos).
- Rendimiento: igual o mejor que hoy en llamadas/triángulos por vista (cabina ≤ 260 llamadas,
  exterior ≤ 120 en vuelo); si hay GPU, p95 ≤ 16,7 ms en "alta" a 1080p, documentado; si no hay,
  decláralo sin inventar cifras.
- Imagen: la comparativa con cámaras idénticas (docs/rebirth/after vs docs/ascension/after) debe
  mostrar una mejora evidente en TODAS las estancias y en el exterior. Describe qué mejoró en cada
  captura; nada de notas tipo "9/10".
- Publicar con `bash web/scripts/deploy-pages.sh`, comprobar VERSION y hashes en producción y
  ejecutar rebirth.cjs contra la URL pública.

## 8. Entregables
docs/ASCENSION_STATE.md (partida, cambios, mediciones, evidencias, pendientes honestos, estado de
publicación), rama `gemini/alcion-ascension` subida, comparativas en docs/ascension/, despliegue
verificado. Si se agota la cuota, deja el estado exacto y el siguiente paso; no declares terminado
lo que se interrumpió.
```

---

## Notas para quien lance la sesión
- **Cuota:** cada trabajador del enjambre consume cuota propia; el límite de 3 simultáneos además reduce los conflictos sobre el mismo repositorio. Un trabajador sin cuota queda en pausa y hay que reactivarlo a mano.
- **Contexto:** Google anuncia 1M de tokens en la API; una guía de terceros indica 512K dentro de Antigravity. El prompt está pensado para no depender de ello: cada trabajador lee sólo los archivos que posee.
- **Selector:** usa el modelo **Gemini 4 Neon** en la conversación y `/swarm`. Pide explícitamente Hydrogen para los trabajadores; según guías de terceros, por defecto usan el modelo de la conversación.
- Fuentes: anuncio oficial de Google (Gemini 4 Neon, 18-nov-2026) y guías de Apidog y Sharkly (terceros; los detalles de `/swarm`, el tablero y los verificadores proceden de ellas y pueden cambiar).
