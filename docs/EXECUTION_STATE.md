# EXECUTION STATE

Última actualización: 2026-11-25 21:00 (Europe/Madrid)

## Checkpoint actual
- Rama `claude/alcion-ultimate`; último commit: ver `git log` («ventanas de nadir transparentes…»).
- Reanudación programada: **2026-11-25 20:45 Europe/Madrid** con `send_later` en esta sesión cloud (trigger `trig_0127ouAAMb2J1gHaxho2vxrJ`). Si la sesión ya no existe a esa hora, usar la instrucción de `NEXT_ACTIONS.md`.
- Renders Cycles: 8 de 15 regenerados y en el repositorio (hero, hero2, front34, dock, cockpit, interior_lab, interior_cq, section). El reinicio del proceso de trabajo interrumpió el resto; están relanzados con `renders/render_rest2.sh 48` (aft34, cupola, engines, hall, interior_aft, exploded, exploded_mid).

## Estado por eje
| Eje | Estado |
|---|---|
| A Continuidad | ✅ |
| B Pruebas versionadas | ✅ `web/tests/functional.cjs`: 15/15 PASS en la última ejecución (19:04), sin errores de página |
| C Materiales PBR fotográficos | ✅ 7 conjuntos CC0 (ambientCG) integrados; KTX2 **no** implementado (no hay `toktx`/`basisu` en el entorno) |
| D Iluminación interior | ✅ primera pasada: temperatura de color por bahía, menos ambiente, AO de contacto más fuerte; ⏳ sin lightmaps horneados |
| E Densidad interior | ✅ atlas de etiquetas legible y etiqueta en cada taquilla, 18 señales, 8 bolsas CTB con cintas, 4 mazos de cables |
| F Manos 1.ª persona | ✅ manos y antebrazos (guantes en EVA) con poses por actividad y alcance al interactuar; estilizadas (geometría primitiva) |
| G Inventario/planos/renders | ✅ inventario y planos regenerados; ⏳ 7 renders Cycles en curso |
| H Deuda técnica | ✅ `Engine.dispose()` completo y listeners con AbortController; ⏳ división de Engine.ts pendiente |
| I Entorno | ✅ estrellas ya no se pintan sobre la Tierra; ✅ ventanas de nadir muestran la Tierra |
| J Publicación | ✅ publicado en gh-pages (hash `index-DfRpWcEg.js`) y verificado: la URL sirve el hash nuevo, los modelos y las texturas responden 200 y `web/tests/functional.cjs` contra la URL pública da 15/15 PASS sin errores de página |

## Archivos principales tocados en esta directiva
`blender/make_labels.py`, `blender/alcion/density.py`, `blender/alcion/interior.py`, `blender/alcion/exterior.py`, `blender/build.py`,
`web/src/engine/player/Hands.ts`, `web/src/engine/ship/{materialsLib,texturesLib,Cockpit}.ts`, `web/src/engine/{Engine,Input}.ts`,
`web/src/engine/world/Astro.ts`, `web/public/textures/pbr/*`, `web/tests/*`, `docs/*`.
