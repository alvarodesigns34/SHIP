# Informe final de validación y limitaciones — ALCIÓN HX-4

Este informe dice **qué se ha comprobado de verdad**, cómo se ha comprobado y **qué no está validado**. No se afirma en ningún momento que el vehículo pueda volar.

## 1. Comprobaciones realizadas

### 1.1 Modelo maestro (Blender 4.2.3, `blender/build.py`)
| Comprobación | Método | Resultado |
|---|---|---|
| El modelo se construye de forma determinista | Ejecución repetida de `build.py` en modo headless | 665 piezas, 126 grupos, 1.787 tornillos (por instancia) y ≈ 541 k triángulos en ≈ 9 s |
| Jerarquía coherente | Volcado a `docs/inventario.json` y poda automática de grupos vacíos | 5 niveles (nave → módulo → sistema → conjunto → pieza), 791 nodos |
| Interior compatible con el casco | Trasera poligonal de los bastidores comparada con el radio libre de 2,035 m; inspección en secciones | Esquinas a ≤ 2,03 m; ningún bastidor atraviesa el isogrid en las secciones BP-06 y BP-07 |
| Aberturas reales | Booleanas exactas: cúpula en el barril y las mantas del nodo; ventanas de nadir en piel, isogrid, MLI y panel MMOD | Visibles en las secciones y en los renders interiores |
| Coherencia de capacidades | Volumen de los depósitos modelados → masa de propulsante | Corregida una incoherencia detectada en una iteración (4,6 → 2,4 t de bipropelente) |
| Inspección visual | Renders Workbench de inspección y Cycles de prueba, revisados en cada iteración | Defectos encontrados y corregidos (ver §2) |

### 1.2 Planos
- Son proyecciones ortográficas del mismo `.blend`, y las secciones usan el plano de recorte de la cámara. **Las láminas no pueden discrepar de la geometría.**
- Las cotas (19,58 m de longitud, 39,42 m de envergadura, 15,50 m de altura con radiadores, Ø4,52 m) se calculan con puntos proyectados del modelo y constantes de `spec.py`.

### 1.3 Aplicación web
| Comprobación | Método | Resultado |
|---|---|---|
| Compilación | `tsc -b` + `vite build` | Sin errores de tipos |
| Funcionamiento | Playwright + Chromium headless (WebGL por software SwiftShader): carga, introducción, explosión al 100 %, selección, interior, presentación, planos, ficha técnica, sección, rayos X y móvil (iPhone 13) | Sin errores de página; capturas revisadas una a una |
| Carga progresiva | Exterior inmediato (2,81 MB) e interior diferido (1,27 MB) | El interior se injerta en `HAB`/`FWD` sin duplicar nodos |
| Compresión | gltf-transform: dedup, prune, reorder, cuantización y EXT_meshopt_compression | 13,1 MB → 4,1 MB, sin perder nodos ni metadatos |
| Coste de dibujado | `renderer.info` con calidad alta, nave completa | ≈ 3.100–3.500 llamadas de dibujo y ≈ 1,0–1,1 M triángulos por fotograma (incluye la pasada de sombras) |

> **FPS no medidos de forma representativa.** El entorno de pruebas no tiene GPU y SwiftShader rasteriza en CPU, así que no hay cifra fiable de fotogramas por segundo. El visor reduce la carga con renderizado bajo demanda, descarte de piezas por debajo de 1 px y niveles de calidad (en móvil arranca en «baja», sin sombras ni oclusión ambiental). El rendimiento en hardware real debe medirse con el indicador de la esquina superior derecha.

## 2. Defectos detectados y corregidos en el bucle iterativo
1. Contraventanas de la cúpula apoyadas sobre la manta, poco creíbles → rediseñadas como aleros sobre bisagra superior.
2. Mesa de la cocina paralela a la pared, flotando → desplegada en perpendicular con tirantes.
3. Mundo de Cycles con fondo azul por un rango de gradiente invertido → corregido; el albedo lunar solo ilumina, no se ve.
4. Células solares que parecían plateadas: junta del ladrillo procedural demasiado ancha → junta de 1,5 ‰.
5. MLI con aspecto de corcho en la web → mapa de normales de menor frecuencia e intensidad.
6. Texto de las serigrafías invertido en babor → regla de orientación por semiespacio.
7. Normal de los paneles cónicos mal calculada → producto vectorial sobre las aristas reales.
8. Cámaras y LIDAR de atraque dentro del barril del nodo → reubicados sobre el mamparo de proa.
9. Lámina de distribución interior girada 90° → vector «arriba» de cámara corregido.
10. Llamadas de grupos simétricos (alas, radiadores) apuntando al eje → dirigidas a un ala concreta.
11. Tras salir de la Presentación, la explosión quedaba aplicada sin reflejarse en la interfaz → estado sincronizado al desmontar.
12. En móvil, el árbol se pintaba aunque estuviera cerrado y las pestañas se desbordaban → reglas CSS específicas.
13. Biselado que duplicaba los triángulos al biselar también la tornillería → limitado a piezas estructurales (925 k → 541 k triángulos).
14. Errata «Cúpola» → «Cúpula».

## 3. Limitaciones conocidas

### Ingeniería
- **Sin validación de ingeniería:** no hay análisis estructural (cargas de lanzamiento y de atraque), térmico, de dosis de radiación, de trayectorias ni de fiabilidad. Masas, Δv, potencia y rechazo térmico son **estimaciones de orden de magnitud**.
- **Volumen habitable neto** de ≈ 14 m³ por tripulante, por debajo de la recomendación HRP de 25 m³ para misiones largas. Solo se justifica para salidas de ≤ 45 días.
- **No hay esclusa EVA.** Se asume que la EVA de contingencia se hace desde el vehículo atracado, y el servicio rutinario es robótico. Una versión futura debería evaluar una esclusa.
- El conjunto **lanzamiento/carenado** no se ha estudiado: el casco de Ø4,52 m sobre el escudo cabría en carenados de 5 m, pero las alas, radiadores y brazos solo se representan desplegados.
- Las cotas del isogrid, de las fijaciones y de los espesores son **ilustrativas**, no dimensionadas.

### Modelo y visualización
- Las piezas repetidas (tornillería, pestañas, tubos de radiador) forman parte de la malla de su conjunto. Se pueden inspeccionar **como conjunto**, no tornillo a tornillo; separarlas multiplicaría por 3 las llamadas de dibujo.
- No se modelan las rutas internas de cableado dentro de cada bastidor ni los mazos dentro del módulo de servicio más allá de los troncales.
- **Materiales web:** el microdetalle se reconstruye con texturas procedurales del navegador. Es más simple que los materiales Cycles del modelo maestro.
- La **sección** web no dibuja tapas sólidas en el plano de corte; muestra las caras interiores (doble cara).
- El brazo robótico solo se representa en estiba, sin cinemática.
- La iluminación interior web usa luces rectangulares sin sombras; las sombras interiores realistas solo están en los renders Cycles.
- **Renders:** Cycles en CPU, 96 muestras más desenfoque de ruido OpenImageDenoise. Con GPU y más muestras se ganaría nitidez en reflejos y zonas oscuras.

## 4. Conclusión
Los entregables son reproducibles desde código y mutuamente coherentes: modelo, GLB, planos, inventario y web salen de la misma fuente (`spec.py` → `build.py`). La nave es un **concepto internamente consistente y verosímil**, apoyado en principios publicados (IDSS, ECLSS, Whipple relleno, MLI, SEP, refugio de agua). Sus cifras de rendimiento son hipótesis que una fase de ingeniería tendría que validar o corregir.
