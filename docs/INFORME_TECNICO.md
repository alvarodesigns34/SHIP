# ALCIÓN HX-4 — Documentación técnica del concepto

> **Naturaleza del documento.** El ALCIÓN HX-4 es un **diseño conceptual original de alta fidelidad**. No es un vehículo certificado ni un conjunto de planos de fabricación. Las cifras de rendimiento son **estimaciones de orden de magnitud** y no han pasado por un análisis de ingeniería (estructural, térmico, de trayectorias o de fiabilidad). Cada dato va marcado como *medido* (sale de la geometría del modelo), *derivado* (cálculo simple a partir de lo medido), *estándar* (principio establecido y documentado) o *hipótesis* (decisión de diseño propia).

---

## 1. Identidad

| Campo | Valor |
|---|---|
| Nombre | **ALCIÓN** (ave mítica asociada a la calma del mar) |
| Designación | **HX-4** («H» de hábitat, «X» de exploración, 4 tripulantes) |
| Fabricante | **Varro-Lindqvist Astronautics (VLA)**, empresa *ficticia* |
| Clase | Vehículo tripulado cislunar de ciencia y servicio |
| Matrícula | VLA · HX-4 · 01 |
| Librea | Blanco térmico, banda grafito en popa y bermellón con filete grafito en proa |

### 1.1 Propósito
El ALCIÓN es un **laboratorio orbital autopropulsado y reutilizable** con base en una estación en órbita halo casi rectilínea (NRHO) lunar. En salidas de hasta 45 días (hipótesis):

- da **servicio robótico** a observatorios y relés en órbita lunar o en los puntos de Lagrange;
- **captura** cápsulas de muestras lanzadas desde la superficie lunar;
- hace **ciencia en órbita** en un laboratorio con guantera, congeladores y ventanas ópticas de nadir.

**No reentra en la atmósfera.** La tripulación sube y baja en un vehículo de transporte atracado al puerto IDSS. Por eso el vehículo puede tener una forma no aerodinámica, optimizada para mantenimiento, protección MMOD y radiación, sin escudo térmico de ablación.

### 1.2 Perfil de misión (hipótesis)
1. **Día 0, embarque:** atraque del vehículo de tripulación y transferencia de carga.
2. **Días 1–6, transferencia SEP:** empuje bajo y continuo con 4 propulsores Hall.
3. **Días 7–35, trabajo en órbita:** brazo robótico, laboratorio y observación.
4. **Contingencia:** refugio en la Bahía C durante eventos de partículas solares (hasta 36 h, el criterio de diseño de la literatura NASA consultada).
5. **Días 36–44, regreso:** SEP, con motores químicos para maniobras rápidas o aborto.
6. **Día 45:** atraque, relevo, recarga de propulsante y consumibles.

---

## 2. Filosofía de diseño

1. **Función antes que forma.** Cada elemento visible tiene una función identificable. No hay superficies «futuristas» sin propósito.
2. **Calor y frío separados.** Las alas solares giran sobre el eje Y para seguir al Sol. Los radiadores están en el plano XZ (normal ±Y), así que el Sol siempre les llega de canto y pueden radiar por ambas caras.
3. **Un casco que se deja mantener.** El escudo MMOD es un prisma de 16 facetas con **64 paneles planos idénticos e intercambiables**, más fáciles de fabricar, inspeccionar con cámaras del brazo y sustituir en EVA que un escudo curvo de una pieza.
4. **La masa útil también protege.** El agua de reserva rodea los habitáculos y hace de blindaje contra la radiación, en lugar de añadir masa parásita.
5. **Dos maneras de moverse.** La propulsión eléctrica, eficiente, se usa para el trabajo rutinario. La química aporta rapidez y una vía de aborto.
6. **Arquitectura de pasillo con bastidores.** Un pasillo cuadrado rodeado de bastidores pivotables, con las utilidades en las esquinas. Es un principio probado en la ISS, aplicado aquí con dimensiones y distribución propias.

---

## 3. Sistema de coordenadas y estaciones

Modelo maestro en metros. **+X proa**, **+Y babor**, **+Z cenit**. Las estaciones están definidas en `blender/alcion/spec.py`, la fuente única de verdad del modelo, los planos y esta documentación.

| Estación | X (m) | Elemento |
|---|---:|---|
| Salida de toberas | −6,35 | Plano de salida de los motores principales |
| Placa de empuje | −4,40 | Interfaz propulsión / servicio |
| SADA | −2,60 | Eje de las alas solares |
| Vértice del mamparo de popa | 0,00 | Mamparo elipsoidal 2:1 |
| Anillo de interfaz | 0,60 | HAB / módulo de servicio |
| Marcos de barril | 0,60 · 2,65 · 4,70 · 6,75 · 8,80 | Límites de las bahías D, C, B y A |
| Cono → nodo | 9,90 | Mamparo de popa del nodo |
| Cúpula | 11,05 | Eje de la cúpula |
| Mamparo de proa | 12,20 | Base del IDSS |
| Anillo de captura blanda | ≈13,2 | Extremo de proa |

### 3.1 Dimensiones generales (medidas en el modelo)
| Magnitud | Valor |
|---|---|
| Longitud total | **19,59 m** |
| Envergadura (alas solares) | **39,42 m** |
| Altura (radiadores desplegados) | **15,50 m** |
| Diámetro exterior del casco presurizado | 4,20 m |
| Diámetro sobre el escudo MMOD (entre caras) | 4,52 m |
| Diámetro del nodo | 2,70 m |
| Paso libre IDSS | 0,80 m (estándar) |

---

## 4. Arquitectura modular

La jerarquía del modelo sigue la pauta **nave → módulo → sistema → conjunto → pieza**, y es la misma en Blender, en el GLB y en la aplicación web. El listado completo está en [`INVENTARIO.md`](INVENTARIO.md).

### 4.1 `FWD` Módulo Nodo de Proa
- **Estructura (`FWD.STR`):** barril de Al-Li 2195 de Ø2,70 × 2,30 m; mamparo de proa con brida IDSS de 36 tornillos; mamparo de popa con escotilla de 1,12 m; 3 marcos; anillo forjado de la cúpula con 24 tornillos. La abertura de la cúpula está **recortada de verdad** (operación booleana) en el barril y en las mantas.
- **Protección (`FWD.MMOD`):** 4 mantas blandas tipo *stuffed Whipple* (beta cloth, Nextel, Kevlar y MLI) con costuras de acolchado. Aquí se usan mantas porque la geometría (cúpula, atraque) complica los paneles rígidos.
- **Atraque (`FWD.DCK`):** túnel adaptador; sistema de **captura dura** con 12 ganchos y doble sello; **captura blanda** con 6 actuadores lineales en plataforma de 6 GDL y anillo con 3 pétalos guía; sensores (2 cámaras, LIDAR de destello, 2 focos, diana de atraque); 2 conectores umbilicales.
- **Cúpula (`FWD.CUP`):** tronco de pirámide hexagonal con 6 ventanas trapezoidales y una cenital circular de Ø0,62 m. Cada ventana tiene panel exterior, 2 paneles de presión y panel interior. Lleva 7 contraventanas MMOD abiertas y un pasamanos perimetral.
- **Exterior (`FWD.EXT`) e interior (`FWD.INT`):** 2 antenas de banda S, balizas de navegación roja (babor) y verde (estribor), pasamanos EVA, escotillas, **estación de trabajo robótica** (2 pantallas y 2 controladores manuales) y 18 taquillas.

### 4.2 `HAB` Módulo Habitable Presurizado
- **Estructura (`HAB.STR`):** 4 barriles de 2,05 m con **isogrid interno** de nervios de 12 × 35 mm, 5 marcos anulares, cono adaptador, mamparo elipsoidal de popa con 6 pasamuros y anillo en Y de interfaz con 64 tornillos.
- **MLI (`HAB.MLI`):** 4 mantas de cuadrante con 20 capas, más mantas en el cono y en el mamparo.
- **Escudo MMOD (`HAB.MMOD`):** 64 paneles bumper de Al 6061-T6 en 4 anillos de 16 facetas, con 18 fijaciones por panel, pestañas rigidizadoras y casquillos EVA. Se apoyan en 192 soportes de titanio. El cono lleva 16 paneles trapezoidales más. El panel R3-F13 tiene recortes para las ventanas de nadir.
- **RCS de proa (`HAB.RCS`):** 4 cuadretes en diagonal, de 5 propulsores cada uno.
- **Exterior (`HAB.EXT`):** 16 pasamanos EVA, accesorio de agarre del brazo, 2 ventanas científicas de nadir con contraventana, 3 focos y serigrafías: nombre, matrícula, fabricante y avisos. Cada serigrafía es hija del panel sobre el que está pintada.
- **Interior (`HAB.INT`):** ver §6.
- **Utilidades (`HAB.UTL`):** ver §6.6.

### 4.3 `SVC` Módulo de Servicio
Octógono no presurizado de 5 m de longitud.
- **Estructura (`SVC.STR`):** 3 marcos octogonales de Al 7075, 8 longerones, 16 diagonales de CFRP con terminales de titanio y **cono de empuje** central de CFRP.
- **Cierre (`SVC.SKN`):** 16 paneles sándwich desmontables. Los cenitales y nadirales son **radiadores corporales** (OSR) y el resto lleva MLI ámbar o plata.
- **Propulsante (`SVC.PRP`):** 4 esferas de titanio de Ø1,04 m (MMH ×2, MON-3 ×2) con puntales, depósito COPV de xenón central de Ø0,90 × 2,9 m, 2 COPV de helio, panel de control de fluidos (FCA), líneas de alimentación y líneas de xenón hacia los brazos Hall.
- **Aviónica (`SVC.AVX`):** 3 ordenadores de vuelo, PCDU, 2 baterías, 2 PPU, IMU y transpondedor. Todos los equipos disipativos van **montados en la cara interior de los paneles-radiador**, una decisión térmica coherente. Se añaden 4 ruedas de reacción en pirámide y los mazos troncales.
- **Térmico activo (`SVC.THM`):** módulo de bombeo de amoníaco, intercambiador agua/amoníaco y líneas a las juntas rotativas de los radiadores. El lazo interno es de **agua**, seguro para la tripulación, y el externo de **amoníaco**: es la práctica establecida en la ISS.
- **Exterior (`SVC.EXT`):** 4 cuadretes RCS de popa, 2 rastreadores estelares con parasol de 4 deflectores, 4 sensores solares, terminal óptico láser y pasamanos.

### 4.4 `PRP` Bahía de Propulsión
- Placa de empuje con alojamientos recortados, faldón con MLI de alta temperatura y escudo térmico de popa.
- **4 motores bipropelentes** de clase 400–500 N. Cada uno tiene bloque de válvulas, inyector, cámara, tobera de C-103 con garganta decolorada y trípode de titanio aislante. Con cuatro motores se tolera el fallo de uno.
- **Propulsión eléctrica (`PRP.SEP`):** 2 brazos orientables de 2 ejes, cada uno con 2 propulsores Hall. Cada propulsor modela el circuito magnético, el canal de nitruro de boro, las bobinas y un cátodo hueco lateral.

### 4.5 `PWR` Sistema de Potencia Solar
2 alas enrollables tipo ROSA de **4,4 × 16 m**. Cada ala tiene mecanismo SADA, mástil con bisagra, estructura de raíz, 2 mástiles de tubo ranurado de CFRP, **12 módulos fotovoltaicos**, mandril de punta y cables tensores.

### 4.6 `THR` Radiadores Desplegables
2 alas de 3 paneles de 3,2 × 1,75 m. Cada panel lleva 16 tubos de flujo por cara, colectores y marco. Se completan con bisagras de muelle, latiguillos flexibles en bucle y base con junta rotativa de fluido.

### 4.7 `COM` Comunicaciones de Alta Ganancia
Antena Cassegrain de **Ø1,6 m** (paraboloide real con f/D coherente, 8 nervios traseros, bocina corrugada y subreflector sobre trípode) en mástil de CFRP con actuadores de acimut y elevación.

### 4.8 `RBT` Brazo Robótico de Servicio
7 GDL y unos 8 m de alcance, mostrado en estiba. Se compone del efector de base (LEE), 7 articulaciones, 2 segmentos de CFRP, el efector terminal de lazos, cámaras y las retenciones de lanzamiento.

---

## 5. Materiales representados

61 materiales PBR con nombre normalizado (`blender/alcion/materials.py`). Entre otros: Al-Li 2195 del casco, aluminio 6061 pintado del escudo, MLI de Kapton aluminizado (ámbar, plata y negro), beta cloth, Nextel, Kevlar, CFRP, titanio Ti-6Al-4V, acero A286, niobio C-103 (toberas), nitruro de boro (Hall), células GaInP/GaAs/Ge, OSR de teflón plateado, sílice fundida, HDPE, Nomex, elastómeros y pantallas con interfaz.

- **En Cycles**, los materiales llevan microdetalle procedural: rugosidad con ruido, arrugado del MLI, trama de tejido y de carbono, retícula de células y tiras OSR.
- **En la web**, el exportador glTF no transmite los nodos procedurales. El microdetalle se **reconstruye a partir del nombre del material** con texturas generadas en el navegador, sobre UV de proyección cúbica en metros (`web/src/viewer/materials.ts`).

---

## 6. Distribución interior

### 6.1 Sección tipo
Pasillo libre de **2,30 × 2,30 m**. A cada lado («suelo», «techo», «babor», «estribor») hay bastidores con trasera poligonal adaptada al casco: la profundidad es de 0,79 m en el centro y de 0,47 m en los bordes, verificada contra el radio libre interior de 2,035 m. Las cuatro esquinas alojan las utilidades.

### 6.2 Bahía A — Cabina de vuelo (X 6,75–8,80)
- 2 consolas independientes de 3 pantallas para el comandante y el piloto. El pasillo central queda libre hacia la escotilla del nodo.
- 4 asientos con arnés de 5 puntos. Los delanteros llevan controladores de traslación y rotación.
- Panel de interruptores cenital (36 interruptores protegidos con LED), estaciones laterales de aviónica con pantalla auxiliar y estiba.

### 6.3 Bahía B — Laboratorio (X 4,70–6,75)
Guantera científica, congelador de −80 °C de 4 cajones, 2 bastidores experimentales y **estación de nadir** con 2 pozos de ventana, cámara científica y paneles de suelo con asideros. Los pozos coinciden con los recortes reales del casco, del MLI y del panel MMOD.

### 6.4 Bahía C — Habitáculos y refugio antiradiación (X 2,65–4,70)
4 habitáculos de unos 1,3 m³ (envolvente con HDPE, puerta acordeón, saco de dormir, portátil articulado, luz, ventilación y red de estiba). Detrás de cada uno van bolsas de agua, y en suelo y techo hay depósitos de agua flexibles. El objetivo de diseño es **≥ 20 g/cm²** de blindaje equivalente en el refugio (hipótesis inspirada en Slaba et al.). El modelo solo representa la disposición; no se ha hecho un análisis de dosis.

### 6.5 Bahía D — Servicios y soporte vital (X 0,60–2,65)
Cocina (calentador, dispensador y mesa abatible), despensa, compartimento de higiene, **generador de oxígeno por electrólisis**, **eliminación de CO₂ por tamices moleculares**, **recuperación de agua por destilación**, control de contaminantes y plataforma de ejercicio (cicloergómetro y dispositivo resistivo de vacío).

### 6.6 Utilidades y mamparo de popa
- **Utilidades:** en cada esquina hay un conducto de aire de Ø170 mm con anillos cada 0,5 m, una bandeja con 4 mazos (120 V CC en naranja, datos en blanco, señal en negro) y el lazo de agua (suministro azul, retorno rojo). Los carriles de fijación tienen orificios cada 25,4 mm.
- **Mamparo de popa:** 4 COPV de O₂/N₂, 9 bolsas de transferencia y un extintor de niebla de agua.

### 6.7 Volúmenes (derivados)
| Concepto | Valor |
|---|---|
| Volumen presurizado | ≈ 139 m³ |
| Volumen habitable neto | ≈ 57 m³ (≈ 14 m³ por tripulante) |

> **Limitación reconocida.** Un panel de expertos del programa HRP de NASA recomendó **25 m³ por persona** para misiones de clase Marte. Las 14 m³ por persona del ALCIÓN solo se defienden para salidas de **≤ 45 días** con acceso posterior a la estación, y es la hipótesis más discutible del concepto.

---

## 7. Presupuestos (orden de magnitud)

| Concepto | Valor | Base |
|---|---|---|
| Potencia al inicio de vida | ≈ 48 kW | 134 m² activos × 1361 W/m² × 30 % × 0,88 de empaquetamiento |
| Rechazo térmico | ≈ 10–12 kW netos | 67 m² radiantes, ε ≈ 0,8, T ≈ 280 K → ≈ 18 kW brutos menos cargas ambientales |
| Bipropelente | ≈ 2,4 t | 4 × 0,589 m³ al 90 %, densidades MMH 0,88 y MON 1,43 t/m³ |
| Xenón | ≈ 2,6 t | 1,74 m³ × ≈ 1,5 t/m³ |
| Masa total (hipótesis) | ≈ 26 t | Seca ≈ 19 t + propulsantes + consumibles |
| Δv química | ≈ 300 m/s | Isp ≈ 320 s |
| Δv eléctrica | ≈ 2 km/s | Isp ≈ 2000 s |

Ninguna de estas cifras está validada por ingeniería. Sirven para comprobar la coherencia interna, no para dimensionar.

---

## 8. Vista explosionada: lógica

- Cada nodo guarda en `extras.ex` su **vector de separación respecto a su padre** y en `extras.depth` su nivel. Los vectores se calculan en `build.py` según el modo de cada nodo: *radial* (paneles, mantas, bastidores), *axial* (bahías), *vector explícito* (módulos, alas, radiadores) o *automático*.
- El deslizador activa cada nivel en una ventana suavizada: nivel 1 entre 0 y 25 %, nivel 2 entre 20 y 50 %, nivel 3 entre 45 y 75 %, nivel 4 entre 70 y 92 % y niveles inferiores entre 82 y 100 %. Así la descomposición es progresiva y reversible.
- Como los grupos tienen transformación identidad, los desplazamientos **se acumulan** a lo largo del árbol: una taquilla se mueve con su bastidor, el bastidor con su bahía y la bahía con el interior.
- Las serigrafías son hijas de su panel y lo acompañan.
- La misma ley se aplica en Blender (`render.py --explode`, `blueprints.py`) y en la web (`stageOf`), de modo que renders, planos e interfaz son coherentes.

---

## 9. Correspondencia entre planos y modelo

Los planos (`blueprints/`) **no son dibujos independientes**:
- Son proyecciones ortográficas del propio `ALCION_HX4_master.blend`.
- Las secciones usan el plano de recorte de la cámara, así que el corte es exacto.
- Cotas, estaciones y llamadas se calculan proyectando puntos y centros de nodos del modelo (`_raw/*.json`).

Si cambia el modelo, los planos se regeneran con dos órdenes (ver README). El diagrama de sistemas (BP-09) es funcional, no a escala, y cada bloque cita los códigos reales de los componentes.
