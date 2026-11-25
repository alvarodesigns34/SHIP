# NEXT ACTIONS

## Instrucción de reanudación (copiar en una sesión nueva si la programada no se ejecuta)
> Continúa la directiva «ALCIÓN: BEYOND ORBIT — ULTIMATE FIDELITY» en el repositorio alvarodesigns34/SHIP, rama `claude/alcion-ultimate`. Lee `docs/EXECUTION_STATE.md`, `docs/MASTER_PLAN.md`, `docs/QUALITY_AUDIT.md` y este archivo, revisa `git log` y continúa desde el último checkpoint sin pedir confirmación. La publicación en gh-pages está autorizada tras pasar `web/tests/functional.cjs`.

## Próximas acciones concretas (en orden)
1. Integrar las texturas CC0 en `web/public/textures/pbr/` (normal GL + rugosidad, 1K JPG) y sustituir los mapas procedurales en `web/src/engine/ship/materialsLib.ts`.
2. Retocar la iluminación interior en `Cockpit.ts` (luces de bahía) y `Engine.ts` (environmentIntensity, exposición e intensidad de AO en interior).
3. Hacer capturas con `web/tests/screenshots.cjs` y compararlas con `docs/baseline/`.
4. Blender: densidad interior (etiquetas, bolsas, cables) en `blender/alcion/expansion.py`; reconstruir, exportar y optimizar.
5. Manos en primera persona: nuevo `web/src/engine/player/Hands.ts`.
6. Regenerar el inventario (`blender/inventory_md.py`), los planos (`blender/blueprints.py` + `blueprint_compose.py`) y los renders (`renders/render_all.sh 64`, en segundo plano).
7. Deuda técnica: `Engine.dispose()` y retirada de listeners.
8. Pasar la batería funcional, construir, desplegar (`web/scripts/deploy-pages.sh`) y verificar la URL publicada.
