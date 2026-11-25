/**
 * Ficha técnica conceptual del ALCIÓN HX-4.
 * Las cotas geométricas proceden de blender/alcion/spec.py y de la caja
 * envolvente medida en el modelo. Las cifras de rendimiento son
 * ESTIMACIONES DE ORDEN DE MAGNITUD (hipótesis de diseño), no valores
 * validados por ingeniería.
 */
export type Row = { k: string; v: string; note?: 'medido' | 'derivado' | 'hipótesis' | 'estándar' };
export type Block = { title: string; rows: Row[] };

export const IDENTITY = {
  name: 'ALCIÓN',
  designation: 'HX-4',
  maker: 'Varro-Lindqvist Astronautics',
  makerNote: 'Empresa ficticia creada para este proyecto.',
  role: 'Vehículo tripulado cislunar de ciencia y servicio',
  motto: 'Un laboratorio que va a buscar la ciencia, en lugar de esperarla.',
  etymology: 'Alción: ave marina mítica asociada a la calma del mar. El vehículo está pensado para trabajos largos y pausados en órbita lunar.',
};

export const SPEC: Block[] = [
  {
    title: 'Geometría',
    rows: [
      { k: 'Longitud total (atraque → toberas)', v: '19,6 m', note: 'medido' },
      { k: 'Envergadura de alas solares', v: '39,4 m', note: 'medido' },
      { k: 'Altura con radiadores desplegados', v: '15,5 m', note: 'medido' },
      { k: 'Diámetro del casco presurizado', v: '4,20 m', note: 'medido' },
      { k: 'Diámetro sobre escudo MMOD (entre caras)', v: '4,52 m', note: 'medido' },
      { k: 'Volumen presurizado total', v: '≈ 140,7 m³', note: 'medido' },
      { k: 'Volumen habitable neto', v: '≈ 53,7 m³ (≈ 13,4 m³ por tripulante)', note: 'derivado' },
      { k: 'Sección del pasillo interior', v: '2,30 × 2,30 m', note: 'medido' },
    ],
  },
  {
    title: 'Misión y tripulación',
    rows: [
      { k: 'Tripulación', v: '4', note: 'hipótesis' },
      { k: 'Duración de salida', v: 'hasta 45 días', note: 'hipótesis' },
      { k: 'Base de operaciones', v: 'Estación en órbita halo casi rectilínea (NRHO) lunar', note: 'hipótesis' },
      { k: 'Reentrada atmosférica', v: 'No (vehículo exclusivamente espacial)', note: 'hipótesis' },
      { k: 'Llegada/salida de tripulación', v: 'Por vehículo de transporte atracado al puerto IDSS', note: 'hipótesis' },
    ],
  },
  {
    title: 'Propulsión',
    rows: [
      { k: 'Motores principales', v: '4 × bipropelente MMH/MON-3, clase 400–500 N', note: 'hipótesis' },
      { k: 'Propulsión eléctrica', v: '4 × propulsor Hall clase 6 kW, en 2 brazos orientables', note: 'hipótesis' },
      { k: 'Control de reacción', v: '8 cuadretes × 5 propulsores', note: 'medido' },
      { k: 'Bipropelente', v: '≈ 2,46 t (4 esferas de Ti, 2,35 m³ medidos)', note: 'derivado' },
      { k: 'Xenón', v: '≈ 2,18 t (COPV de 1,74 m³ medidos)', note: 'derivado' },
      { k: 'Δv química (Tsiolkovsky, Isp 315 s)', v: '≈ 419 m/s', note: 'derivado' },
      { k: 'Δv eléctrica (Tsiolkovsky, Isp 1850 s)', v: '≈ 2,49 km/s', note: 'derivado' },
    ],
  },
  {
    title: 'Potencia y control térmico',
    rows: [
      { k: 'Generación', v: '≈ 46,6 kW BOL / 40,1 kW EOL (1 UA)', note: 'derivado' },
      { k: 'Alas solares', v: '2 × 4,4 × 16 m, enrollables (131,9 m² celdas activas)', note: 'medido' },
      { k: 'Almacenamiento', v: '2 módulos Li-ion (≈ 24 kWh útiles)', note: 'hipótesis' },
      { k: 'Bus primario', v: '120 V CC', note: 'hipótesis' },
      { k: 'Radiadores desplegables', v: '2 × 3 paneles, doble cara (80,3 m² emisivos medidos)', note: 'medido' },
      { k: 'Rechazo térmico (Stefan-Boltzmann)', v: '13,9 kW LEO sol · 23,1 kW eclipse · 28,4 kW espacio profundo', note: 'derivado' },
    ],
  },
  {
    title: 'Soporte vital y protección',
    rows: [
      { k: 'Atmósfera', v: '101,3 kPa, N₂/O₂', note: 'hipótesis' },
      { k: 'O₂', v: 'Electrólisis PEM de agua', note: 'estándar' },
      { k: 'CO₂', v: 'Tamices moleculares regenerativos', note: 'estándar' },
      { k: 'Agua', v: 'Destilación por compresión de vapor + filtración', note: 'estándar' },
      { k: 'Refugio antiradiación', v: 'Bahía C (agua + HDPE + casco): ≈ 22,2 g/cm² nominales', note: 'hipótesis' },
      { k: 'MMOD', v: 'Whipple relleno: bumper Al 1,6 mm + Nextel/Kevlar, ~12 cm de separación', note: 'estándar' },
    ],
  },
  {
    title: 'Comunicaciones, guiado y robótica',
    rows: [
      { k: 'Alta ganancia', v: 'Antena de 1,6 m, bandas X/Ka', note: 'medido' },
      { k: 'Óptica', v: 'Terminal láser de 10 cm', note: 'hipótesis' },
      { k: 'Respaldo', v: '2 antenas de banda S omnidireccionales', note: 'medido' },
      { k: 'Navegación', v: '2 rastreadores estelares, IMU, 4 sensores solares, LIDAR de atraque', note: 'medido' },
      { k: 'Actitud', v: '4 ruedas de reacción en pirámide', note: 'medido' },
      { k: 'Brazo robótico', v: '7 grados de libertad, ≈ 8 m de alcance', note: 'medido' },
      { k: 'Atraque', v: 'IDSS activo, paso libre de 0,80 m', note: 'estándar' },
    ],
  },
];

export const PROFILE = [
  { t: 'Día 0', h: 'Embarque', d: 'La tripulación llega en un vehículo de transporte y atraca en el puerto IDSS de proa. Transferencia de carga y verificación de sistemas.' },
  { t: 'Día 1–6', h: 'Transferencia eléctrica', d: 'Los propulsores Hall llevan el vehículo, con empuje bajo y continuo, desde la órbita de la estación hasta una órbita lunar baja o un punto de Lagrange.' },
  { t: 'Día 7–35', h: 'Trabajo en órbita', d: 'Servicio de observatorios y relés con el brazo robótico, ciencia en el laboratorio, captura de cápsulas de muestras lanzadas desde la superficie y observación desde las ventanas de nadir.' },
  { t: 'Contingencia', h: 'Evento de partículas solares', d: 'La tripulación se refugia en la Bahía C, rodeada de depósitos de agua y paneles de HDPE, hasta 36 h.' },
  { t: 'Día 36–44', h: 'Regreso', d: 'Transferencia SEP de vuelta. Si hay prisa, los motores químicos dan maniobras rápidas o de aborto.' },
  { t: 'Día 45', h: 'Atraque y relevo', d: 'Atraque en la estación, desembarco, recarga de propulsante y consumibles, y mantenimiento hasta la siguiente salida.' },
];

export const PHILOSOPHY = [
  { h: 'Función antes que forma', d: 'Cada elemento visible responde a una función identificable: protección MMOD, rechazo térmico, propulsión, atraque, observación o servicio robótico.' },
  { h: 'Calor y frío separados', d: 'Los radiadores son perpendiculares a las alas solares. Cuando las alas siguen al Sol girando sobre el eje Y, los radiadores le quedan de canto y nunca reciben luz directa.' },
  { h: 'Un casco que se deja mantener', d: 'Las 16 facetas planas del escudo son 64 paneles intercambiables e idénticos, más fáciles de fabricar, inspeccionar y sustituir que un escudo curvo de una sola pieza.' },
  { h: 'La masa útil también protege', d: 'El agua de reserva y los depósitos del muro de agua sirven además de blindaje alrededor de los habitáculos, en lugar de cargar masa muerta solo para eso.' },
  { h: 'Dos maneras de moverse', d: 'La propulsión eléctrica es eficiente para el trabajo rutinario. La química aporta rapidez y una vía de aborto.' },
];

export const SOURCES = [
  { t: 'NASA — International Docking System Standard (IDSS) IDD Rev. F (2022)', u: 'https://ntrs.nasa.gov/api/citations/20220011643/downloads/IDSS%20IDD%20Rev%20F%20Final_07262022.pdf' },
  { t: 'NASA — Environmental Control and Life Support Systems (ECLSS)', u: 'https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss' },
  { t: 'NASA MSFC — ECLSS fact sheet', u: 'https://www.nasa.gov/centers/marshall/pdf/174687main_eclss_facts.pdf' },
  { t: 'NASA-STD-3001 Vol. 2 — Human Factors, Habitability and Environmental Health', u: 'https://www.nasa.gov/reference/NASA-std-3001v2/' },
  { t: 'NASA HRP — Net habitable volume for long-duration missions (NTRS 20140016951)', u: 'https://ntrs.nasa.gov/api/citations/20140016951/downloads/20140016951.pdf' },
  { t: 'NASA JSC HVIT — MMOD shield development (Whipple / stuffed Whipple)', u: 'https://hvit.jsc.nasa.gov/shield-development/' },
  { t: 'NASA Ames — Thermal Protection Materials, low-density ablators (PICA)', u: 'https://www.nasa.gov/general/thermal-protection-materials-branch-low-density-ablators' },
  { t: 'ESA — European Service Module (Orion)', u: 'https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module' },
  { t: 'NASA — PPE / AEPS 50 kW-class SEP (IEPC 2024)', u: 'https://ntrs.nasa.gov/api/citations/20240007012/downloads/IEPC24_358_v2.pdf' },
  { t: 'NASA — Storm shelter / water-wall radiation protection (NTRS 20150001237)', u: 'https://ntrs.nasa.gov/api/citations/20150001237/downloads/20150001237.pdf' },
  { t: 'Slaba et al. — Optimal shielding thickness for galactic cosmic ray environments (NTRS 20170002287)', u: 'https://ntrs.nasa.gov/citations/20170002287' },
  { t: 'TFAWS 2023 — MLI design practice (Europa Clipper)', u: 'https://tfaws.nasa.gov/wp-content/uploads/TFAWS23-PT-2-Paper.pdf' },
  { t: 'NASA Visible Earth — Blue Marble Next Generation & Black Marble 2016 (dominio público)', u: 'https://visibleearth.nasa.gov/collection/1484/blue-marble' },
  { t: 'NASA SVS — CGI Moon Kit (LRO) & Deep Star Maps 2020 (Gaia DR2, dominio público)', u: 'https://svs.gsfc.nasa.gov/4851' },
  { t: 'Immersive Web — WebXR Input Profiles generic rigged hands (licencia MIT)', u: 'https://github.com/immersive-web/webxr-input-profiles' },
];

export const STORY = [
  { id: 'intro', eyebrow: 'Vehículo tripulado cislunar', h: 'ALCIÓN HX-4', d: 'Un laboratorio orbital de 19,6 m que sale de una estación lunar durante 45 días a dar servicio a observatorios, recoger muestras y hacer ciencia donde ocurre.', cam: [26, 9, 30], tgt: [2.5, -0.6, 0], ex: 0, xray: false },
  { id: 'hull', eyebrow: '01 · Casco', h: 'Dieciséis facetas, sesenta y cuatro paneles', d: 'El escudo MMOD poligonal funciona como un Whipple relleno: paneles de aluminio de 1,6 mm a 12 cm del casco de Al-Li, con capas de Nextel y Kevlar dentro de la manta MLI. Cada panel se puede sustituir.', cam: [9, 4.5, 9.5], tgt: [4.5, 0.5, 0], ex: 0, xray: false },
  { id: 'dock', eyebrow: '02 · Proa', h: 'Atraque y observación', d: 'Puerto IDSS activo con captura blanda de 6 actuadores y captura dura de 12 ganchos. Encima, una cúpula de 7 ventanas desde la que se maneja el brazo robótico viendo directamente lo que hace.', cam: [17.5, 3.8, 4.5], tgt: [11.5, 0.8, 0], ex: 0, xray: false },
  { id: 'power', eyebrow: '03 · Energía y calor', h: 'Las alas siguen al Sol; los radiadores le dan el canto', d: 'Dos alas enrollables de 16 m dan unos 48 kW. Los radiadores de doble cara están en el plano perpendicular, así que nunca reciben el Sol de frente.', cam: [-14, 22, 26], tgt: [-1.5, 0, 0], ex: 0, xray: false },
  { id: 'explode1', eyebrow: '04 · Arquitectura', h: 'Ocho módulos, una sola estructura', d: 'Nodo de proa, módulo habitable, módulo de servicio, bahía de propulsión, potencia, radiadores, comunicaciones y brazo robótico se separan siguiendo su eje de integración.', cam: [30, 22, 36], tgt: [0, 0, 0], ex: 0.3, xray: false },
  { id: 'explode2', eyebrow: '05 · Sistemas', h: 'Dentro del casco', d: 'Al retirar los paneles MMOD y el aislamiento quedan a la vista el casco isogrid, los depósitos, la aviónica y el interior presurizado, que se extrae por debajo de la nave.', cam: [26, 12, 34], tgt: [0, -3, 0], ex: 0.62, xray: false },
  { id: 'explode3', eyebrow: '06 · Piezas', h: 'Descomposición completa', d: 'Bastidores, taquillas, asientos, toberas, módulos fotovoltaicos y paneles por separado. Cada pieza se puede seleccionar, aislar y consultar en el inspector.', cam: [34, 20, 44], tgt: [0, -2, 0], ex: 1, xray: false },
  { id: 'xray', eyebrow: '07 · Interior', h: 'Cuatro bahías de 2,05 m', d: 'Cabina de vuelo, laboratorio, habitáculos con muro de agua y servicios con soporte vital, en un pasillo de 2,30 m de sección.', cam: [8, 6, 10], tgt: [4.6, 0, 0], ex: 0, xray: true },
];
