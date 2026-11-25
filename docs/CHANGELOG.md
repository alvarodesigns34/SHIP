# Registro de cambios

## Ultimate Fidelity — iteración 1
- **Materiales fotográficos CC0 (ambientCG):**
  - lámina metalizada para el MLI;
  - metal mecanizado;
  - tejido;
  - tapizado de cuero;
  - polímero de paneles;
  - tejido de carbono para el CFRP;
  - goma.
- **Iluminación interior:** temperatura de color por bahía, menos relleno ambiental, AO de contacto reforzado y albedo realista de paneles.
- **Densidad interior:**
  - atlas de etiquetas legible (`blender/make_labels.py`) con etiqueta de inventario en cada taquilla;
  - 18 señales de seguridad y orientación;
  - 8 bolsas de carga con cintas y etiqueta;
  - 4 mazos de cables con abrazaderas.
- **Manos y antebrazos en primera persona**, con guantes en EVA, poses por actividad (beber, comer, ejercicio, aseo, cultivo, ciencia, lectura, dormir) y alcance al interactuar.
- **Ventanas de nadir:**
  - el isogrid ya no deja tapas de booleana;
  - el marco es anular y la contraventana queda abatida;
  - el vidrio no tiene componente difusa;
  - resultado: se ve la Tierra.
- **Cielo:** las estrellas ya no se pintan encima de la Tierra.
- **Inventario y planos** regenerados desde el modelo actual (778 piezas, 144 grupos, ≈621 k triángulos).
- **Deuda técnica:** `Engine.dispose()` libera listeners (AbortController), audio, geometrías, materiales y texturas. Las pruebas Playwright están versionadas en `web/tests/`.

## Beyond Orbit — iteración 3 (vida a bordo)
- **Caminar por la nave:** nueva locomoción a pie con gravedad de entrenamiento de 1 g.
  - Suelo y techo detectados por sondeo.
  - Escalones de hasta 0,75 m.
  - El tripulante se agacha solo bajo techos bajos y en la escotilla nodo–hábitat.
  - Escalerillas en la esclusa y la cúpula.
  - Pisadas con sonido procedural y balanceo de cabeza, que respeta el movimiento reducido.
  - Sigue disponible el modo **flotar** (microgravedad).
- **Tripulante:** cinco necesidades (hidratación, nutrición, descanso, higiene, ánimo), reloj de misión ×60 y avisos.
- **Actividades** sobre equipos reales del modelo: beber, comer, dormir (con fundido), ejercicio (sube el CO₂), aseo, cultivo, experimento en la guantera, congelar la muestra y leer el plan. Mirar la Tierra por las ventanas sube el ánimo.
- **Misión «Un día a bordo».**
- **Colisiones:** el volumen presurizado incluye el mamparo de la escotilla nodo–hábitat y el cuello de la esclusa. Se descartan las envolventes de conjuntos repartidos y los objetos blandos (trajes).
- **HUD interior:** tarjeta del tripulante, selector Caminar/Flotar y ayuda de controles.
- **Pruebas:** cuatro nuevas comprobaciones Playwright (caminar, escalerilla, vida a bordo, flotar). Hay 15 en total y todas pasan.

## Beyond Orbit — iteración 2
- Normales recalculadas en todas las mallas del generador: la manta de la esclusa ya no se ve oscura e invertida en EVA.
- Pestaña **Mecanismos** en Ingeniería (radiadores, poses del brazo, escotillas, contraventanas, taquillas), que respeta los interlocks del simulador.
- La sección ya no recompila sombreadores: de ~3,8 s a 14 ms.
- Corregida la imagen negra en cabina y laboratorio: la anisotropía generaba NaN.

## Beyond Orbit — iteración 1
- Motor modular TypeScript con `BatchedMesh`: de 3 100–3 500 a 209–390 llamadas de dibujo.
- Entorno astronómico (Tierra, Luna, Sol, estrellas, eclipses), vuelo 6DOF, cabina funcional con 24 interruptores, sistemas interconectados, misiones, sandbox, EVA y audio procedural.
- Modelo: esclusa EVA, panel de interruptores, objetos cotidianos y metadatos de mecanismos y controles.

## Fase 1
- Modelo procedural en Blender, planos, renders Cycles, inventario y visor web con vista explosionada.
