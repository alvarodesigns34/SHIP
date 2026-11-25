# Arquitectura — ALCIÓN: Beyond Orbit

## Flujo de datos

```
blender/alcion/*.py ──build.py──▶ ALCION_HX4_master.blend
                                   │  propiedades personalizadas → extras glTF:
                                   │  ex, depth, label, desc, func, mech{…}, ctl, inspect
                                   ▼
                    export/alcion_hx4_{exterior,interior}.glb
                                   │  web/scripts/optimize-model.mjs (meshopt + cuantización)
                                   ▼
                    web/public/models/*.glb ──▶ ShipModel (BatchedMesh por sector+material)
```

La geometría y los metadatos salen de una sola fuente (`spec.py` → `build.py`). La web no codifica posiciones de piezas, salvo los puntos de visita y algunas zonas de colisión del casco.

## Módulos web (`web/src/engine`)

| Módulo | Responsabilidad |
|---|---|
| `Engine.ts` | Orquestador. Modos, cámaras, bucle (`simStep` + `renderFrame`), interacción, esclusa, atraque, persistencia y compositor de postproceso. Incluye `tick(s)` determinista para pruebas. |
| `ship/ShipModel.ts` | Carga los GLB y agrupa las piezas en `BatchedMesh` por sector y material: una llamada de dibujo por lote y una identidad por instancia. Gestiona transformaciones compuestas `T(explosión)·R(mecanismo)·extra·base`, visibilidad, selección, picking por `batchId` y tapas de sección. |
| `ship/materialsLib.ts`, `texturesLib.ts` | Biblioteca PBR coherente con `materials.py`: mapas procedurales de MLI, pintura, tejido, CFRP, células solares y radiador. |
| `ship/Mechanisms.ts` | Brazo de 6 articulaciones con FK e IK (CCD), radiadores en acordeón, seguimiento solar de las alas y apuntamiento de la antena de alta ganancia. |
| `ship/Systems.ts` | Red eléctrica (buses A/B), 24 interruptores, cargas, batería, solar, O₂/CO₂/temperatura, arranque de aviónica, averías con reparación y alertas. |
| `ship/Cockpit.ts` | Pantallas en canvas con páginas, cámaras en textura, LEDs por interruptor y luces de bahía con presupuesto de sombras. |
| `sim/Flight.ts` | Dinámica 6DOF con paso fijo de 1/120 s e interpolación; modos asistido, manual y freno. |
| `sim/Crew.ts` | Necesidades del tripulante, reloj de misión acelerado y catálogo de actividades con efectos y multiplicador metabólico. |
| `player/Player.ts` | Tripulante en espacio de nave. Tiene dos locomociones: **caminar** (gravedad de 1 g, suelo y techo por sondeo de cajas y del casco presurizado, escalones, agacharse, escalerillas, pisadas) y **flotar** (microgravedad con asideros). La EVA usa colisionadores exteriores. |
| `world/Astro.ts`, `world/Props.ts` | Escena lejana en km: Tierra con atmósfera, nubes, océano y luces nocturnas, Luna, Sol, estrellas y eclipses. También la estación Tesela, el observatorio Halo-7, la cápsula y los blancos. |
| `Missions.ts`, `Sandbox.ts` | Misiones como máquinas de estados cuyas comprobaciones leen el estado real; sandbox de pulsos de luz. |
| `Input.ts`, `Audio.ts` | Acciones reasignables (teclado, mando y táctil) y audio procedural WebAudio en modo realista o cinematográfico. |

## Decisiones clave

- **Origen flotante:** la nave se dibuja en el origen. Las posiciones absolutas se guardan en dobles de JS, y la escena lejana (km) se dibuja en un pase previo.
- **Sección sin recompilación:** todos los materiales del modelo tienen siempre asignado el plano de corte. Cuando la sección está inactiva, el plano se desplaza al infinito, así que activarla no cambia la clave de programa del sombreador.
- **Colisiones a pie:** se usan cajas de las piezas, sin la tornillería ni los objetos blandos (trajes, bolsas), más una función analítica del volumen presurizado. Esa función incluye el mamparo de la escotilla nodo–hábitat (r = 0,52 m) y el cuello de la esclusa (r = 0,5 m). Las envolventes de conjuntos repartidos alrededor del pasillo se descartan para que no tapen el paso.
