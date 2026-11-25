# ALCIÓN HX-4 — Vehículo tripulado cislunar de ciencia y servicio

Proyecto de ingeniería conceptual y modelado 3D de una nave espacial **original**. Incluye un modelo maestro procedural en Blender, planos generados desde el propio modelo, renders físicos y una aplicación web de inspección con vista explosionada integral.

> **Aviso.** Es un diseño conceptual de alta fidelidad, no un vehículo certificado ni planos de fabricación. El fabricante, *Varro-Lindqvist Astronautics*, es ficticio. Las cifras de rendimiento son hipótesis de orden de magnitud (ver [`docs/VALIDACION.md`](docs/VALIDACION.md)).

![Render principal](renders/hero_final.png)

## Resumen

| | |
|---|---|
| Misión | Salidas de hasta 45 días desde una estación lunar (NRHO): servicio robótico de observatorios, captura de muestras y ciencia en órbita |
| Tripulación | 4 |
| Dimensiones | 19,6 m de longitud · 39,4 m de envergadura · 15,5 m de altura con radiadores |
| Presurizado | ≈ 139 m³ (nodo con cúpula + módulo habitable de 4 bahías) |
| Propulsión | 4 Hall de clase 6 kW (SEP) + 4 bipropelentes de 400–500 N + 40 propulsores RCS |
| Potencia | 2 alas enrollables de 4,4 × 16 m (≈ 48 kW al inicio de vida) |
| Modelo | **778 piezas** en **144 grupos** (5 niveles), **1.791 tornillos** modelados, ≈ 621 k triángulos, 63 materiales PBR (cifras de `docs/stats.json`) |

## Entregables

| Entregable | Ruta |
|---|---|
| Modelo maestro de Blender | [`blender/ALCION_HX4_master.blend`](blender/ALCION_HX4_master.blend) |
| Scripts de generación | [`blender/alcion/`](blender/alcion) (`spec`, `lib`, `materials`, `exterior`, `systems`, `interior`), [`blender/build.py`](blender/build.py) |
| Scripts de automatización | [`blender/render.py`](blender/render.py), [`blender/blueprints.py`](blender/blueprints.py), [`blender/blueprint_compose.py`](blender/blueprint_compose.py), [`blender/inventory_md.py`](blender/inventory_md.py), [`blender/make_textures.py`](blender/make_textures.py), [`renders/render_all.sh`](renders/render_all.sh) |
| GLB completo (máxima fidelidad) | [`export/alcion_hx4.glb`](export/alcion_hx4.glb) |
| GLB optimizados (web: exterior + interior diferido) | [`web/public/models/`](web/public/models) |
| Planos conceptuales (10 láminas) | [`blueprints/`](blueprints) |
| Inventario jerárquico | [`docs/INVENTARIO.md`](docs/INVENTARIO.md), [`docs/inventario.json`](docs/inventario.json), [`docs/inventario.csv`](docs/inventario.csv) |
| Documentación técnica | [`docs/INFORME_TECNICO.md`](docs/INFORME_TECNICO.md) |
| Investigación y referencias | [`docs/INVESTIGACION.md`](docs/INVESTIGACION.md) |
| Renders exteriores e interiores | [`renders/`](renders) |
| Aplicación web interactiva | [`web/`](web) |
| Informe de validación y limitaciones | [`docs/VALIDACION.md`](docs/VALIDACION.md) |

## Requisitos

- **Blender 4.2 LTS** (probado con 4.2.3). Sin MCP: todo se ejecuta por línea de órdenes con `bpy`.
- **Python 3** con `Pillow` y `numpy`, para componer los planos.
- **Node.js 20+**, para la aplicación web.

## Ejecución

```bash
# 1. Construir el modelo maestro (.blend), exportar GLB e inventario (~10 s)
blender -b --python blender/build.py

# 2. Optimizar los GLB para la web (meshopt + cuantización, conserva la jerarquía)
cd web && npm install && npm run optimize-model && cd ..

# 3. Planos: proyecciones ortográficas + composición con cotas y cajetín
blender -b blender/ALCION_HX4_master.blend --python blender/blueprints.py
python3 blender/blueprint_compose.py && cp blueprints/*.png web/public/blueprints/

# 4. Inventario en Markdown
python3 blender/inventory_md.py

# 5. Renders finales (Cycles CPU; ~5 min por vista a 1920×1080 y 96 muestras)
bash renders/render_all.sh 96
#    vista individual o explosionada:
blender -b blender/ALCION_HX4_master.blend --python blender/render.py -- \
    --mode final --views hero --res 1920x1080 --samples 128 --out renders
blender -b blender/ALCION_HX4_master.blend --python blender/render.py -- \
    --mode final --views exploded --explode 1.0 --out renders

# 6. Aplicación web
cd web
npm run dev        # desarrollo en http://localhost:5173
npm run build      # producción en web/dist (estática, se puede servir desde cualquier hosting)
npx vite preview   # servir la build
bash scripts/deploy-pages.sh   # publicar en GitHub Pages (rama gh-pages)
```

## Aplicación web — ALCIÓN: Beyond Orbit

Simulación interactiva en el navegador (React + TypeScript + three.js r169). Siete modos (Alt+1…7):

| Modo | Qué se puede hacer |
|---|---|
| **Cinemático** | Planos automáticos de la nave en órbita baja, órbita lunar o eclipse. |
| **Vuelo** | Vuelo 6DOF newtoniano (paso fijo 120 Hz) con modo asistido/manual, freno, cámaras persecución/órbita/cabina/libre, atraque con la estación ficticia Tesela y brazo robótico con IK. |
| **Interior** | **Caminar** por toda la nave en primera persona o **flotar** en microgravedad; usar interruptores, pantallas, taquillas, escotillas, asientos y las actividades de la vida a bordo. |
| **EVA** | Salida por la esclusa (ciclo de presión de 6 s) con unidad de maniobra y línea de seguridad. |
| **Ingeniería** | Árbol de 800+ piezas, vista explosionada por etapas, sección con tapas, rayos X, vistas, comparación y control directo de los **mecanismos**. |
| **Misiones** | Activación en frío, acoplamiento, inspección fotográfica, captura con el brazo, averías, EVA, fotografía científica y **Un día a bordo**. |
| **Sandbox** | Pulsos de luz ficticios contra blancos (sin armas reales). |

### Caminar por la nave y vida a bordo

- **Locomoción a pie** (por defecto): gravedad de entrenamiento de 1 g, como en una maqueta de entrenamiento en tierra. El tripulante pisa la cubierta del pasillo, sube umbrales de hasta 0,75 m y **se agacha solo** al cruzar la escotilla nodo–hábitat (Ø≈1,05 m) o bajo equipos. Hay escalerillas en el pozo de la esclusa y en la cúpula. Incluye pisadas con sonido procedural y un ligero balanceo de cabeza, que se desactiva con «movimiento reducido».
  - Controles: WASD para andar, Mayús para correr, Ctrl para agacharse o bajar por la escalerilla, Espacio para saltar o subir, G o clic para interactuar. Táctil y mando también funcionan.
- **Flotar** (microgravedad realista): impulso con WASD y R/F, y agarrarse a los asideros con V. Se cambia con el selector *Caminar / Flotar* del HUD.
- **Necesidades del tripulante:** hidratación, nutrición, descanso, higiene y ánimo, con un reloj de misión acelerado ×60.
- **Actividades** (G sobre el equipo):
  - beber agua en el dispensador o con las bolsas de bebida;
  - preparar y comer una ración en la cocina;
  - ejercicio en el cicloergómetro, que **eleva el CO₂ de cabina** en el modelo de soporte vital;
  - aseo en el compartimento de higiene;
  - dormir 8 h en un habitáculo, con fundido a negro;
  - cuidar el cultivo;
  - hacer un experimento en la guantera y congelar la muestra a −80 °C;
  - leer el plan del día;
  - mirar la Tierra por las ventanas de nadir o desde la cúpula, que sube el ánimo.
- La misión **Un día a bordo** recorre esa rutina, y cada paso se comprueba sobre el estado real del simulador.

### Ejecución y pruebas

```bash
cd web && npm install && npm run build && npx vite preview   # http://localhost:4173
```

La batería funcional con Playwright tiene 15 comprobaciones: modos, interruptores, aviónica, física, atraque, esclusa y EVA, colisiones, misiones, explosión, guardado, caminar, escalerilla, vida a bordo, flotar y cúpula. Se describe en `docs/VALIDACION.md`. La arquitectura está en `docs/ARQUITECTURA.md`, las mediciones en `docs/RENDIMIENTO.md` y los cambios en `docs/CHANGELOG.md`.

<p>
<img src="docs/capturas/interior_caminar_cabina.jpg" width="49%"> <img src="docs/capturas/interior_caminar_popa.jpg" width="49%">
<img src="docs/capturas/interior_habitaculo_dormir.jpg" width="49%"> <img src="docs/capturas/cabina_puesto_piloto.jpg" width="49%">
</p>

Las capturas son de Chromium sin GPU (SwiftShader). En una GPU real la imagen es la misma, pero la fluidez no es comparable.

## Estructura

```
blender/            generador procedural, render, planos, texturas
  alcion/spec.py    cotas maestras: fuente única de verdad
  ALCION_HX4_master.blend
export/             GLB de máxima fidelidad
blueprints/         láminas BP-01 … BP-10
renders/            renders Cycles
docs/               informe técnico, investigación, inventario, validación
web/                aplicación React + TypeScript + three.js
```

## Galería

| | |
|---|---|
| ![](renders/hero2_final.png) Vista trasera: propulsión, Hall, alas y radiadores | ![](renders/front34_final.png) Proa: nodo, cúpula, atraque IDSS y brazo |
| ![](renders/dock_final.png) Puerto IDSS activo y sensores de aproximación | ![](renders/cupola_final.png) Cúpula de 7 ventanas con contraventanas abiertas |
| ![](renders/exploded_x100_final.png) Vista explosionada al 100 % | ![](renders/exploded_mid_x50_final.png) Vista explosionada al 50 % (sistemas) |
| ![](renders/section_final.png) Sección longitudinal iluminada | ![](renders/cockpit_final.png) Cabina de vuelo (Bahía A) |
| ![](renders/interior_lab_final.png) Laboratorio y estación de nadir (Bahía B) | ![](renders/interior_cq_final.png) Habitáculos y refugio antiradiación (Bahía C) |
| ![](renders/interior_aft_final.png) Servicios y soporte vital (Bahía D) | ![](renders/engines_final.png) Motores bipropelentes y escudo de popa |
| ![](blueprints/side.png) BP-02 Vista lateral | ![](blueprints/section_long.png) BP-06 Sección longitudinal |
| ![](blueprints/layout.png) BP-08 Distribución interior | ![](blueprints/systems.png) BP-09 Arquitectura de sistemas |

Los renders son de Cycles a 1920×1080. La Luna de fondo usa texturas de dominio público del CGI Moon Kit de NASA SVS (ver `blender/textures/nasa/SOURCES.md`).
