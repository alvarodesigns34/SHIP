# QUALITY AUDIT — qué delata que es digital (y estado)

Fuente: inspección visual de las capturas de `docs/baseline/` (Chromium/SwiftShader, calidad alta) y de la auditoría independiente aportada por el usuario.

| # | Zona | Defecto perceptivo | Causa | Acción | Estado |
|---|---|---|---|---|---|
| 1 | Interior general | Blanco plano, casi sin gradientes; parece una maqueta iluminada por igual | Demasiada luz ambiente y de entorno; luminarias rectangulares sin caída; sin AO de contacto marcado | Bajar el ambiente; luminarias con temperatura y caída; reforzar AO; más contraste | ✅ Mejorado (temperatura, AO, albedo) — sin lightmaps |
| 2 | Paneles interiores | Superficies lisas de color uniforme («primitivas coloreadas») | Normal y rugosidad procedurales demasiado sutiles | Micro-normal fotográfica (polímero/pintura) y variación de rugosidad por pieza | ✅ Plastic010 |
| 3 | MLI exterior | Puede leerse como papel | Normal procedural | Foil002 (lámina metálica real) como normal y rugosidad | ✅ |
| 4 | Asientos | Plástico gris | Sin textura de cuero ni tejido | Leather025 / Fabric030 | ✅ |
| 5 | Metales | Cepillado procedural genérico | — | Metal009 | ✅ |
| 6 | Densidad interior | Pocas etiquetas y objetos; simetría | Modelo | Objetos y etiquetas en Blender | ✅ etiquetas legibles, señales, bolsas, cables |
| 7 | Primera persona | Sin cuerpo; actividades = barra de progreso | — | Manos y antebrazos animados | ✅ estilizadas (sin modelo anatómico detallado) |
| 8 | Inventario/planos/renders | Desfasados respecto al modelo (esclusa, interruptores) | No regenerados | Regenerar | ✅ inventario y planos; renders en curso |
| 9 | Ventanas de nadir del laboratorio | Fondo gris; no se ve la Tierra a través del pozo | Vidrio / geometría del pozo opaca o mal orientada | Revisar materiales y fondo del pozo | ✅ tapas espurias del isogrid, marco macizo, contraventana y vidrio con albedo blanco corregidos |
| 10 | Textos de ayuda del HUD | Ilegibles sobre fondo claro | Sin fondo | Corregido con fondo semitransparente (iteración 3) | ✅ |
| 11 | Cielo | Estrellas pintadas sobre el disco terrestre | Material de estrellas en la lista de transparentes | Lista opaca (aditiva) antes de los cuerpos | ✅ |
| 12 | Manos | Geometría primitiva (cápsulas); se nota digital de cerca | Sin modelo anatómico ni rig | Modelo de mano esculpido + skinning | Pendiente |
| 13 | Iluminación | Sin iluminación indirecta horneada | Falta pipeline de lightmaps (UV2 + bake Cycles) | Hornear AO/indirecta del interior | Pendiente |
