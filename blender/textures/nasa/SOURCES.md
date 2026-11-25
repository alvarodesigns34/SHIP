# Activos Externos, Texturas NASA y Licencias (Project Singularity)

## 1. Texturas Planetarias y Espacio Profundo (NASA — Dominio Público)
Las imágenes de NASA son de dominio público en EE. UU. y se utilizan únicamente con fines visuales y educativos, sin implicar respaldo de NASA.

- `web/public/textures/earth_day.jpg` (4096×2048) — **NASA Visible Earth Blue Marble Next Generation** (`world.topo.bathy.200407.3x5400x2700.jpg`, procesado mediante `blender/make_astro_textures.py` desde `blender/textures/nasa_hq/bmng_5400.jpg`). https://visibleearth.nasa.gov/collection/1484/blue-marble
- `web/public/textures/earth_ocean.jpg` (4096×2048) y `earth_normal.jpg` (2048×1024) — Máscara oceánica alineada con costa y mapa de relieve topográfico derivados de NASA Blue Marble NG (`blender/make_astro_textures.py`).
- `web/public/textures/earth_night.jpg` (3600×1800) — **NASA Earth Observatory Black Marble 2016** (`BlackMarble_2016_3km.jpg`, procesado desde `blender/textures/nasa_hq/blackmarble_3600.jpg`). https://earthobservatory.nasa.gov/features/NightLights
- `web/public/textures/earth_clouds.jpg` (4096×2048) — Cubierta nubosa de alta resolución (base NASA Visible Earth / Three.js MIT con detalle ciclónico y cirros sintetizados en `blender/make_astro_textures.py`).
- `web/public/textures/milkyway.jpg` (2048×1024) — **NASA Scientific Visualization Studio Deep Star Maps 2020** (mosaico galáctico Gaia DR2, dominio público). https://svs.gsfc.nasa.gov/4851
- `moon_lroc_color_2k.jpg` y `moon_height.png` — **NASA SVS CGI Moon Kit** (LRO/LROC WAC + LOLA `ldem_4.tif`). https://svs.gsfc.nasa.gov/4720

## 2. Manos Anatómicas Riggeadas en Primera Persona (`web/public/models/hands_fp.glb`)
- Mallas anatómicas y esqueleto estándar de 25 articulaciones por mano (`blender/assets/webxr_hands/{left,right}.glb`): **immersive-web/webxr-input-profiles** (`generic-hand`, licencia **MIT**, véase `blender/assets/webxr_hands/LICENSE.md`). https://github.com/immersive-web/webxr-input-profiles
- Guante presurizado EVA, mangas textiles Varro-Lindqvist y accesorios 3D (bolsa de bebida, bandeja, tableta, paño): generados proceduralmente en `blender/build_hands.py` sobre el mismo esqueleto de 25 huesos.

## 3. Texturas PBR Fotográficas (`web/public/textures/pbr/`)
Fuente: **ambientCG** (https://ambientcg.com), licencia **CC0 1.0** (dominio público). Versiones 1K-JPG, normales en convención OpenGL.

| Archivo | Recurso ambientCG | Uso |
|---|---|---|
| `mli_n/r` | Foil002 | Aislamiento multicapa (lámina metalizada arrugada) |
| `brushed_n/r` | Metal009 | Aluminio y acero mecanizados/cepillados |
| `fabric_n/r` | Fabric030 | Tela beta, bolsas CTB, cortinas, tejidos interiores |
| `leather_c/n/r` | Leather025 | Tapizado de asientos |
| `polymer_n/r` | Plastic010 | Paneles interiores de polímero/pintura |
| `carbon_c/n/r` | Fabric004 | CFRP (tejido de carbono) |
| `rubber_c/n/r` | Rubber004 | Juntas, asideros y pies de goma |

## 4. Transcodificador GPU KTX2 / Basis Universal (`web/public/basis/`)
- `basis_transcoder.js` y `basis_transcoder.wasm`: **Binomial LLC / Khronos Basis Universal** (Apache 2.0), redistribuidos desde `three/examples/jsm/libs/basis/`.
- `web/public/textures/lm_interior.ktx2` y `lm_interior.png`: lightmap interior horneado con Blender Cycles GI + Contact AO (`blender/bake_lightmaps.py`) y comprimido con Khronos KTX-Software UASTC + Zstd.
