# QUALITY AUDIT — qué delata que es digital (y estado)

Fuente: inspección visual de las capturas de `docs/baseline/` (Chromium/SwiftShader, calidad alta) y de la auditoría independiente aportada por el usuario.

| # | Zona | Defecto perceptivo | Causa | Acción | Estado |
|---|---|---|---|---|---|
| 1 | Interior general | Blanco plano, casi sin gradientes; parece una maqueta iluminada por igual | Demasiada luz ambiente y de entorno; luminarias rectangulares sin caída; sin AO de contacto marcado | Bajar el ambiente; luminarias con temperatura y caída; reforzar AO; más contraste | Pendiente |
| 2 | Paneles interiores | Superficies lisas de color uniforme («primitivas coloreadas») | Normal y rugosidad procedurales demasiado sutiles | Micro-normal fotográfica (polímero/pintura) y variación de rugosidad por pieza | Pendiente |
| 3 | MLI exterior | Puede leerse como papel | Normal procedural | Foil002 (lámina metálica real) como normal y rugosidad | Pendiente |
| 4 | Asientos | Plástico gris | Sin textura de cuero ni tejido | Leather025 / Fabric030 | Pendiente |
| 5 | Metales | Cepillado procedural genérico | — | Metal009 | Pendiente |
| 6 | Densidad interior | Pocas etiquetas y objetos; simetría | Modelo | Objetos y etiquetas en Blender | Pendiente |
| 7 | Primera persona | Sin cuerpo; actividades = barra de progreso | — | Manos y antebrazos animados | Pendiente |
| 8 | Inventario/planos/renders | Desfasados respecto al modelo (esclusa, interruptores) | No regenerados | Regenerar | Pendiente |
| 9 | Ventanas de nadir del laboratorio | Fondo gris; no se ve la Tierra a través del pozo | Vidrio / geometría del pozo opaca o mal orientada | Revisar materiales y fondo del pozo | Pendiente |
| 10 | Textos de ayuda del HUD | Ilegibles sobre fondo claro | Sin fondo | Corregido con fondo semitransparente (iteración 3) | ✅ |
