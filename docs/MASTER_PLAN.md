# MASTER PLAN — ALCIÓN: Beyond Orbit · Ultimate Fidelity

Rama de trabajo: `claude/alcion-ultimate`, creada desde `claude/alcion-beyond-orbit`, que se conserva.
Publicación: `gh-pages` → https://alvarodesigns34.github.io/SHIP/ (autorizada por el usuario, una vez pasadas las puertas de calidad).

## Objetivo
Llevar la experiencia hacia el hiperrealismo perceptivo, con el interior como prioridad absoluta, sin perder funcionalidad y documentando con evidencias visuales. No se afirma nada que no se haya medido o visto.

## Ejes y orden de ataque (impacto perceptivo / coste)

| # | Eje | Contenido | Prioridad |
|---|---|---|---|
| A | Continuidad | MASTER_PLAN, EXECUTION_STATE, QUALITY_AUDIT, NEXT_ACTIONS; reanudación programada; commits frecuentes | Inmediata |
| B | Pruebas versionadas | `web/tests/functional.cjs`, `web/tests/screenshots.cjs` y línea base `docs/baseline/` | Inmediata |
| C | Materiales PBR fotográficos | Texturas CC0 (ambientCG) para normal y rugosidad de detalle: MLI (Foil002), metal cepillado (Metal009), tejido (Fabric030), cuero de asientos (Leather025), polímero de paneles (Plastic010) | Alta |
| D | Iluminación interior | Menos luz ambiente plana; luminarias lineales con temperatura de color; contraste y AO de contacto; reacción a ventanas y eclipses | Alta |
| E | Densidad interior (Blender) | Etiquetas legibles, bolsas, cables, cintas, velcro, herramientas y objetos personales repartidos con criterio, sin simetría perfecta | Alta |
| F | Presencia física | Manos y antebrazos en primera persona (guantes en EVA) con animaciones por actividad (alcanzar, sujetar, beber, pulsar) | Media-alta |
| G | Sincronización | Regenerar inventario (md/csv/json), planos BP y renders Cycles desde el modelo actual | Media |
| H | Deuda técnica | `dispose()` del motor y limpieza de listeners; persistencia completa; dividir responsabilidades de Engine.ts donde sea seguro | Media |
| I | Entorno | Sombras de nubes, atmósfera en el terminador y estaciones o satélites a la altura | Media |
| J | Publicación | Build, despliegue gh-pages y verificación remota con Playwright | Final |

## Criterios de aceptación
1. La batería funcional pasa entera, sin errores de página.
2. Hay capturas antes/después desde las mismas cámaras, inspeccionadas; cada mejora declarada tiene evidencia visual.
3. Inventario, planos y renders se derivan del mismo `.blend`.
4. La URL publicada sirve el hash de la compilación validada y carga los modelos.
5. La documentación de limitaciones es honesta: rendimiento en GPU no medido y licencias de juego (1 g al caminar).
