# Informe de Validación y Limitaciones — ALCIÓN HX-4 (Project Singularity)

Este informe detalla **exactamente qué se ha verificado**, con qué herramientas y **qué limitaciones persisten**. ALCIÓN HX-4 es un vehículo conceptual y simulador interactivo; **no** es un diseño calificado para vuelo.

---

## 1. Comprobaciones Verificadas

### 1.1 Modelo maestro 3D (`blender/ALCION_HX4_master.blend`, Blender 4.0.2)
| Comprobación | Método | Resultado |
|---|---|---|
| Construcción determinista | `blender -b --python blender/build.py` + `blender/bake_lightmaps.py` | **779 piezas**, **144 grupos** (5 niveles, 923 nodos), **1.855 tornillos**, **840.926 triángulos**, **64 materiales** (`docs/stats.json`) |
| Auditoría de ingeniería conceptual | `blender -b blender/ALCION_HX4_master.blend --python blender/validate_engineering.py` | Envolvente `19,58 × 39,42 × 15,50 m`, volumen presurizado `140,7 m³`, NHV estimado `53,7 m³` (`13,4 m³/trip.`), solar `131,9 m²` (`46,6 kW` BOL), radiadores `80,3 m²` (`13,9 kW` LEO sol / `28,4 kW` espacio profundo), biprop `2,35 m³` (`Δv ≈ 419 m/s`), Xe `1,74 m³` (`Δv ≈ 2,49 km/s`). Ver [`docs/INGENIERIA_CONCEPTUAL.md`](INGENIERIA_CONCEPTUAL.md) |
| Aberturas ópticas reales | Raycasts en Blender + raycasts en Three.js (`functional.cjs` pruebas 12 y 13) | Cúpula `W7` **100 % despejada** (anillos forjados huecos), ventanas nadir `W1` (`X=5,25 m`) y `W2` (`X=6,20 m`) **100 % despejadas** |
| Horneado GI + Contact AO | `blender/bake_lightmaps.py` (Cycles DIFFUSE 3 rebotes + AO + dilatación 10 px + KTX2) | `lm_interior.png` (2,3 MiB) + `lm_interior.ktx2` (1,9 MiB, validado con `ktx validate`), 100 % de las `1.520` primitivas interiores con `TEXCOORD_1` |
| Manos anatómicas riggeadas | `blender/build_hands.py` sobre WebXR MIT (`left.glb`/`right.glb`) | `hands_fp.glb` (911 KiB): 25 huesos reales por mano, malla anatómica + guante EVA inflado sobre el mismo esqueleto + 4 accesorios 3D |
| Optimización glTF | `node web/scripts/optimize-model.mjs` (quantize + meshopt) | `alcion_hx4_exterior.glb` **3,99 MiB**, `alcion_hx4_interior.glb` **4,95 MiB** |

### 1.2 Planos e Inventario (Sincronización Byte a Byte)
- 10 láminas ortográficas regeneradas desde el modelo maestro (`blueprints/front.png` … `assembly.png`, `REV C · SINGULARITY`), revisadas visualmente (`BP-02`, `BP-06`, `BP-08`) confirmando eliminación de solapes con el brazo robótico y líneas de llamada.
- `python3 scripts/sync_all.py`: **12 / 12 archivos** (`inventario.json`, `inventario.csv` y 10 planos PNG) verificados **idénticos byte a byte por SHA-256** entre `docs/`/`blueprints/` y `web/public/`.

### 1.3 Aplicación Web (`web/`, React + TypeScript + Three.js + Playwright)
| Comprobación | Método | Resultado |
|---|---|---|
| Compilación | `npm run build` (`tsc -b && vite build`) | **0 errores de TypeScript**, bundle en ~6 s |
| Batería estricta (22 pruebas) | `node web/tests/functional.cjs` (sale con código 1 ante cualquier fallo, error de consola o HTTP ≥ 400) | **22 / 22 PASS · 0 fallos · 0 page/console errors · 0 errores HTTP (404)** |
| Eficiencia de draw calls | `renderer.info` en `BatchedMesh` | **108 lotes** para **2.730 instancias** (`107–165` llamadas en calidad baja/exterior, `~306–496` con sombras + N8AO + cámaras MFD en calidad alta) |
| Persistencia v3 real | Prueba 21: guarda `lunar`, `LT_B = false`, `freeExplore = true` → **`page.reload()` completo** → verifica restauración | **PASS** (corregido en el bucle de pruebas un bug real donde el arranque sobrescribía `localStorage` antes de `restore()`) |
| Inspección visual antes/después | 15 vistas fijas `1280×760` (`docs/singularity_baseline/` vs `docs/singularity_after/`), inspeccionadas visualmente una por una | Todos los defectos detectados (cúpula tapiada, isogrid en nadir, pantalla auxiliar invertida, banda marrón atmosférica, accesorios de mano derecha visibles, cinemática plana WebXR) corregidos y verificados |
| Móvil responsivo | Prueba 22 en viewport `390×844` (Interior + Ingeniería) | **0 px** de desbordamiento horizontal |

---

## 2. Limitaciones Conocidas y Honestidad Técnica

1. **Rendimiento en GPU real no medido:** esta máquina virtual ejecuta Chromium headless sobre **SwiftShader (CPU)** sin GPU acelerada por hardware. Las capturas son visualmente fieles al render WebGL real, pero los FPS reportados en SwiftShader (`0–1 fps`, `ms` en segundos) **no representan el rendimiento en una GPU real** (el cual debe verificarse en dispositivo real con el contador del HUD).
2. **Ingeniería conceptual no certificada:** no existen cálculos FEM estructurales, CFD, análisis térmico orbital transitorio ni simulaciones Monte Carlo de radiación (Geant4/OLTARIS).
3. **Contención radial de bastidores (`HAB.INT.*`):** la auditoría automatizada detectó con transparencia que 35 esquinas traseras de bastidores y tanques de agua alcanzan `r = 2,15–2,21 m` (aún dentro del escudo MMOD `R_S = 2,26 m`, pero sobresaliendo 5–11 cm del casco `R_P = 2,10 m`). En una fase CAD de fabricación se recortaría ese chaflán trasero.
4. **Rechazo térmico a plena potencia SEP en LEO soleado:** a 290 K los `80,3 m²` de radiadores rechazan `13,9 kW` en LEO soleado (suficiente para cabina/laboratorio ~6–9 kW, pero justo si los 4 propulsores Hall funcionasen a la vez a plena carga en LEO soleado).
5. **Blender sin OpenImageDenoise en Ubuntu 4.0.2:** el binario del sistema carece de OIDN compilado; el horneado de lightmaps usa filtrado bilateral preservando bordes por islas UV (`bake_lightmaps.py`), y los renders Cycles emplean muestreo adaptativo.
6. **Abstracciones de simulación:** la locomoción `Caminar` (1 g de entrenamiento), la escala de empuje `×10` por defecto, la mecánica orbital kepleriana sin perturbaciones J2 y la compresión temporal de esclusa/rutinas son decisiones explícitas de jugabilidad y claridad educativa.
