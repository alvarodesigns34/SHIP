# NEXT ACTIONS

## Instrucción de reanudación (copiar en una sesión nueva si la programada no se ejecuta)
> Continúa la directiva «ALCIÓN: BEYOND ORBIT — ULTIMATE FIDELITY» en el repositorio alvarodesigns34/SHIP, rama `claude/alcion-ultimate`. Lee `docs/EXECUTION_STATE.md`, `docs/MASTER_PLAN.md`, `docs/QUALITY_AUDIT.md` y este archivo, revisa `git log` y continúa desde el último checkpoint sin pedir confirmación. La publicación en gh-pages está autorizada tras pasar `web/tests/functional.cjs`.

## Próximas acciones concretas (en orden)
1. Cuando termine `renders/render_rest2.sh`, revisar visualmente los 7 renders restantes y hacer commit.
2. (Hecho) Publicación verificada. Tras cada cambio futuro: `cd web && npx vite build && bash scripts/deploy-pages.sh` y `ALCION_URL=https://alvarodesigns34.github.io/SHIP/ node tests/functional.cjs`.
3. Iluminación indirecta horneada del interior: segundo canal UV en Blender (Smart UV Project), bake de AO/difuso en Cycles a 2K por sector y aplicación como `aoMap`/`lightMap` en la web.
4. Manos: sustituir las cápsulas por una malla esculpida en Blender (dedos con falanges y nudillos) exportada aparte.
5. Dividir `Engine.ts`: cámaras (`CameraRig`), interacción (`Interaction`) y persistencia (`Persistence`).
6. KTX2/Basis: requiere `toktx` o `basisu` (no disponibles en el entorno actual).
