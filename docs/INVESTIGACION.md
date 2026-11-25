# Investigación y fundamentos — ALCIÓN HX-4

Este documento separa **los principios establecidos**, sacados de fuentes públicas de NASA y ESA y de la literatura técnica, de **las hipótesis de diseño propias** del ALCIÓN. Se estudiaron vehículos reales (ISS, Orion/ESM, Gateway/PPE, Dragon) para entender sus principios, **sin copiar ninguna configuración**.

## 1. Fuentes consultadas

| # | Fuente | Qué se ha tomado de ella |
|---|---|---|
| 1 | NASA, *International Docking System Standard (IDSS) IDD Rev. F* (2022). [NTRS 20220011643](https://ntrs.nasa.gov/api/citations/20220011643/downloads/IDSS%20IDD%20Rev%20F%20Final_07262022.pdf) | Paso libre de 800 mm. Arquitectura de captura blanda y dura, sistema andrógino. |
| 2 | NASA, *Environmental Control and Life Support Systems*. [nasa.gov](https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss) | División ECLSS: recuperación de agua, revitalización del aire y generación de oxígeno. |
| 3 | NASA MSFC, *ECLSS fact sheet*. [PDF](https://www.nasa.gov/centers/marshall/pdf/174687main_eclss_facts.pdf) | Electrólisis de agua para O₂, tamices moleculares para CO₂, recuperación de agua de orina y condensado. |
| 4 | NASA-STD-3001 Vol. 2. [nasa.gov](https://www.nasa.gov/reference/NASA-std-3001v2/) | Marco de habitabilidad: habitáculos individuales, privacidad, postura neutra en microgravedad. |
| 5 | NASA HRP, volumen habitable neto. [NTRS 20140016951](https://ntrs.nasa.gov/api/citations/20140016951/downloads/20140016951.pdf) | Recomendación de 25 m³ por persona para misiones de clase Marte (DRM 5.0). Referencia frente a la que se reconoce la limitación del ALCIÓN. |
| 6 | NASA JSC HVIT, *Shield development*. [hvit.jsc.nasa.gov](https://hvit.jsc.nasa.gov/shield-development/) | Escudo Whipple y Whipple relleno (Nextel y Kevlar entre bumper y pared trasera), su uso en la ISS y su capacidad frente a partículas de ~1,3 cm. |
| 7 | Wikipedia y NASA/LDEF, *Multi-layer insulation*; TFAWS 2023 (Europa Clipper). [PDF](https://tfaws.nasa.gov/wp-content/uploads/TFAWS23-PT-2-Paper.pdf) | MLI de Kapton o Mylar aluminizado con separadores de red. Mantas de unas 20 capas. Las costuras dominan las fugas térmicas. MLI de alta temperatura cerca de las toberas. |
| 8 | NASA Ames, ablativos de baja densidad (PICA). [nasa.gov](https://www.nasa.gov/general/thermal-protection-materials-branch-low-density-ablators) | Se consultó y **se descartó a propósito**: el ALCIÓN no reentra, así que no necesita escudo ablativo. |
| 9 | ESA, *European Service Module*. [esa.int](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module) | Concepto de módulo de servicio no presurizado (depósitos bajo escudo MMOD, radiadores, alas, lazo térmico). Solo se toma el concepto; la geometría es distinta. |
| 10 | NASA, PPE/AEPS, IEPC 2024. [NTRS 20240007012](https://ntrs.nasa.gov/api/citations/20240007012/downloads/IEPC24_358_v2.pdf) | Propulsión eléctrica solar de clase 50 kW con propulsores Hall y alas ROSA. |
| 11 | NASA RadWorks, refugio antiradiación con muro de agua. [NTRS 20150001237](https://ntrs.nasa.gov/api/citations/20150001237/downloads/20150001237.pdf) | Habitáculos como base del refugio, agua de contingencia como blindaje no parasitario, eventos de hasta 36 h y una hora para refugiarse. |
| 12 | Slaba et al. (2017). [NTRS 20170002287](https://ntrs.nasa.gov/citations/20170002287) | Unos 20 g/cm² alrededor de la tripulación; más allá apenas reducen la dosis equivalente. |
| 13 | NASA SVS, *CGI Moon Kit*. [svs.gsfc.nasa.gov/4720](https://svs.gsfc.nasa.gov/4720) | Texturas LRO/LOLA de dominio público, usadas solo como fondo de los renders. |

> No pude confirmar en las fuentes consultadas algunos valores numéricos: tolerancias exactas del IDSS, cotas interiores de los habitáculos de la ISS y espesor del muro de agua en g/cm². Donde aparecen en el ALCIÓN, son **hipótesis propias** y así se indica.

## 2. Principios establecidos frente a decisiones propias

| Tema | Principio establecido (fuente) | Decisión del ALCIÓN (hipótesis) |
|---|---|---|
| Atraque | IDSS: paso de 800 mm, captura blanda y luego dura (1) | Puerto activo en proa, sensores en el mamparo, 2 umbilicales automáticos |
| MMOD | El Whipple relleno detiene partículas mayores que la pared desnuda (6) | Escudo **poligonal de 16 facetas** con 64 paneles planos intercambiables a ~12 cm del casco; mantas blandas en el nodo |
| Aislamiento | MLI de ~20 capas, alta temperatura cerca de las toberas (7) | MLI de 20 capas bajo el escudo; faldón de popa con MLI negro de alta temperatura |
| Soporte vital | Electrólisis O₂, tamices CO₂, recuperación de agua (2, 3) | Equipos en bastidores de la Bahía D con dimensionado propio |
| Habitabilidad | Habitáculos individuales y referencia de 25 m³ por persona en misiones largas (4, 5) | 4 habitáculos de ~1,3 m³; volumen habitable neto de ~14 m³ por persona (**por debajo de la referencia; limitación reconocida**) |
| Radiación | Agua como blindaje no parasitario, ~20 g/cm² (11, 12) | Bahía C como refugio rodeado de agua y HDPE |
| Propulsión | SEP de clase 50 kW con Hall y ROSA (10) | 4 Hall de clase 6 kW en brazos orientables más 4 motores químicos de 400–500 N |
| Térmico | Lazo interno de agua y externo de amoníaco, radiadores (práctica ISS/ESM) | Radiadores perpendiculares a las alas; equipos disipativos sobre los paneles-radiador |
| Estructura | Al-Li con isogrid en módulos presurizados (práctica general) | Barriles de 2,05 m e isogrid de 12 × 35 mm (cotas ilustrativas) |

## 3. Qué no se ha copiado
- **No** se reproduce la forma de Starship, Dragon, Orion, Cygnus, ATV, Tianzhou ni de los módulos de la ISS.
- La silueta (casco prismático de 16 facetas, cono, nodo con cúpula hexagonal, módulo de servicio octogonal, radiadores en plano XZ y brazos Hall laterales), la librea, el nombre, el fabricante y la distribución interior son **originales**.
- Algunos subsistemas (IDSS, ECLSS, ROSA, Hall) siguen **principios y estándares públicos**, que es lo que se espera de un diseño realista.
