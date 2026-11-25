# EXECUTION STATE

Última actualización: 2026-11-25 19:10 (Europe/Madrid)

## Checkpoint actual
- Rama `claude/alcion-ultimate`; último commit: ver `git log` («ventanas de nadir transparentes…»).
- Reanudación programada: **2026-11-25 20:45 Europe/Madrid** con `send_later` en esta sesión cloud (trigger `trig_0127ouAAMb2J1gHaxho2vxrJ`). Si la sesión ya no existe a esa hora, usar la instrucción de `NEXT_ACTIONS.md`.
- Renders Cycles finales (`renders/render_all.sh 48`) en curso en segundo plano: se han guardado parte de las vistas (ver la fecha de `renders/*_final.png`).

## Estado por eje
| Eje | Estado |
|---|---|
| A Continuidad | ✅ |
| B Pruebas versionadas | ✅ `web/tests/functional.cjs`: 15/15 PASS en la última ejecución (19:04), sin errores de página |
| C Materiales PBR fotográficos | ✅ 7 conjuntos CC0 (ambientCG) integrados; KTX2 **no** implementado (no hay `toktx`/`basisu` en el entorno) |
| D Iluminación interior | ✅ primera pasada: temperatura de color por bahía, menos ambiente, AO de contacto más fuerte; ⏳ sin lightmaps horneados |
| E Densidad interior | ✅ atlas de etiquetas legible y etiqueta en cada taquilla, 18 señales, 8 bolsas CTB con cintas, 4 mazos de cables |
| F Manos 1.ª persona | ✅ manos y antebrazos (guantes en EVA) con poses por actividad y alcance al interactuar; estilizadas (geometría primitiva) |
| G Inventario/planos/renders | ✅ inventario y planos regenerados; ⏳ renders Cycles en curso |
| H Deuda técnica | ✅ `Engine.dispose()` completo y listeners con AbortController; ⏳ división de Engine.ts pendiente |
| I Entorno | ✅ estrellas ya no se pintan sobre la Tierra; ✅ ventanas de nadir muestran la Tierra |
| J Publicación | ⏳ |

## Archivos principales tocados en esta directiva
`blender/make_labels.py`, `blender/alcion/density.py`, `blender/alcion/interior.py`, `blender/alcion/exterior.py`, `blender/build.py`,
`web/src/engine/player/Hands.ts`, `web/src/engine/ship/{materialsLib,texturesLib,Cockpit}.ts`, `web/src/engine/{Engine,Input}.ts`,
`web/src/engine/world/Astro.ts`, `web/public/textures/pbr/*`, `web/tests/*`, `docs/*`.
