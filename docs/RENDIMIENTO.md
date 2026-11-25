# Informe de rendimiento

Todas las cifras se midieron en este entorno: Chromium headless con **SwiftShader**, es decir, WebGL renderizado por CPU sin GPU.

- Los **fps de este entorno no representan** el rendimiento en hardware real: van de 0 a 2 fps en todas las vistas.
- **No se afirma ninguna tasa de fotogramas** para GPUs reales porque no se ha podido medir.
- Las métricas que sí son independientes del hardware son las llamadas de dibujo, los triángulos y el tamaño de los recursos.

## Llamadas de dibujo (renderer.info, por fotograma)

| Vista | Antes (visor fase 1) | Beyond Orbit |
|---|---|---|
| Exterior / vuelo persecución | 3 100–3 500 | 209–340 |
| Cabina (piloto sentado) | — | 356 |
| Interior a pie | — | 287–387 |
| Ingeniería / pruebas en calidad baja | — | 45–48 |

La reducción viene de agrupar las 2 357 instancias en 86 lotes `BatchedMesh` (sector × material), conservando la identidad de cada pieza para selección, explosión y mecanismos.

## Recursos

| Recurso | Tamaño |
|---|---|
| GLB exterior (meshopt + cuantización) | 3,19 MB (10,82 MB sin comprimir) |
| GLB interior (incluye el atlas de etiquetas) | 2,27 MB (6,98 MB sin comprimir) |
| Texturas PBR fotográficas (14 JPG 1K) | 3,0 MB |
| JS de la aplicación | 1 595 kB (556 kB gzip) |
| CSS | 29 kB (7 kB gzip) |

## Paradas medidas y corregidas

- **Primer corte de sección:** ~3,8 s de recompilación de sombreadores, que ahora tarda 14 ms porque el plano de corte queda siempre asignado (ver ARQUITECTURA).
- **Imagen negra en cabina y laboratorio:** un material con anisotropía generaba píxeles NaN que bloom y AO propagaban. Se eliminó la anisotropía. Medido: 3 píxeles NaN en una imagen HDR de 320×200 antes y 0 después.

## Escalado

- Hay cuatro niveles de calidad (AO N8AO, sombras y resolución de mapa de sombras) y resolución dinámica opcional.
- Las sombras interiores usan las 2 luces focales más cercanas.

## Liberación de memoria
Medido tras `Engine.dispose()` en SwiftShader: geometrías en GPU de 63 a 6. Quedan texturas de render targets y de lienzo de las pantallas: no se ha verificado que se liberen todas (159 entradas en `renderer.info.memory.textures`).
