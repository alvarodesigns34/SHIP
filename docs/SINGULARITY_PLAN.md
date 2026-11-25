# ALCIÓN HX-4 — PROJECT SINGULARITY: EXECUTION PLAN

**Branch:** `gemini/alcion-singularity`  
**Autonomy:** Full continuous execution, no subagents, no Blender MCP.

## Phases & Priorities

### Phase 0 — Environment, Baseline & Research (Active)
- [x] Fetch all remote branches, create `gemini/alcion-singularity` from `claude/alcion-ultimate` (`9b02a11`).
- [x] Install Blender 4.0.2, Python PIL/NumPy, Playwright devDependency, Khronos `ktx` CLI.
- [x] Acquire verified open-license high-value assets:
  - MIT-licensed 25-joint rigged anatomical WebXR hands (`immersive-web/webxr-input-profiles`).
  - Public Domain NASA Blue Marble Next Generation (5400×2700) & Black Marble 2016 (3600×1800) & Deep Star Maps Milky Way.
- [ ] Complete 15 fixed-camera baseline captures (`docs/singularity_baseline/*.jpg`).

### Phase 1 — Radical Geometric Reconstruction (Blender Master Model)
- Create `blender/alcion/singularity_geo.py` with organic subdivided/sculpted/hard-surface generators:
  - Sculpted ergonomic aerospace crew seats (CFRP shell, contoured bolsters, curved headrest, draped 5-point harness, rotary buckle, sculpted RHC/THC controls, damper rails).
  - Quilted organic puffed sleeping bags, pleated fabric privacy curtains, acoustic wall liners, articulated reading lamps, detailed laptops, framed real crew photos & mission patches.
  - Soft pillowed Nomex CTBs with stitched piping, curved zippers, grab handles & bungee straps; staggered aft bulkhead stowage + COPV manifold gauges.
  - High-detail Laboratory: open recessed illuminated glovebox with wrinkled glove sleeves & instruments, botanical multi-leaf hydroponics chamber, detailed EXPRESS payload racks with connectors/umbilicals/OLEDs/gauges, cryo freezer cam-latches, multispectral nadir camera gimbal.
  - Upgraded Cockpit: wrap-around glare shield, eyebrow annunciators, beveled MFD frames with softkeys, machined radial ribs & bolted flange on forward bulkhead, detailed rotary-dogging viewport hatch.
  - Upgraded Galley, Hygiene, Exercise rig & contoured EMU spacesuits in Airlock.
  - Exterior cinematic upgrades: quilted metallic aft heatshield (fixing procedural noise artifact), ribbed regeneratively-cooled engine nozzles with gimbal actuators & plumbing, ribbed/actuated cupola shutters, pillowed quilted MLI blankets, detailed solar yoke/SADA & radiator manifolds.
- Upgrade high-DPI `labels_atlas.png` + `crew_photos_atlas.png`.
- Rebuild `ALCION_HX4_master.blend` & inspect Blender preview/Cycles renders.

### Phase 2 — Real Cycles Baked Lightmaps, Reflection Probes & Unified PBR + KTX2
- Build `blender/bake_lightmaps.py`: generate clean non-overlapping UV2 (`UVMap_LM` / `TEXCOORD_1`) on interior architectural & rack meshes, bake multi-bounce Cycles GI lightmaps + contact AO with OpenImageDenoise across interior zones (Bay A/B, Bay C/D, Node/Cupola/Airlock).
- Compress textures with Khronos `ktx` CLI (UASTC/ETC1S KTX2) + integrate `KTX2Loader` with graceful fallback.
- Preserve `uv1` in `ShipModel.ts` (`normalizeGeometry`) so `BatchedMesh` natively renders Cycles baked lightmaps, modulated dynamically per bay by live `Systems` lighting levels!
- Add local interior `PMREM` reflection probe environment so interior metals/glass/screens reflect cabin lighting instead of empty space.
- Upgrade `materialsLib.ts` with fabric `sheen`, clearcoat calibration, thermal-gradient nozzle alloy, crisp optical glass, and unified Blender↔Web PBR response.

### Phase 3 — Anatomical Skinned Hands, EVA Gloves & High-Detail Props
- Build `blender/build_hands.py`: import MIT WebXR anatomical rigged hands, attach sculpted cuffed Varro-Lindqvist flight-suit sleeves + sculpted pressurized ribbed EVA gloves on the same 25-joint rig, plus detailed 3D held props (pleated drink pouch, meal tray & spoon, flight tablet, sample vial, microfiber wipe, torque wrench), export to `web/public/models/hands_fp.glb`.
- Rewrite `web/src/engine/player/Hands.ts` using real `SkinnedMesh` skeletal posing, smooth finger articulation, 2-bone arm IK, cockpit RHC/THC stick grip while seated, handrail wrapping, and physicalized activity animations.

### Phase 4 — Cinematographic Earth, Moon, Deep Space & Orbital Landmarks
- Build crisp 4K Earth texture set from NASA Blue Marble NG + Black Marble + high-detail clouds + ocean mask + normal map + Milky Way backdrop.
- Rewrite `Astro.ts` with physically-inspired Rayleigh + Mie atmospheric scattering shader, elevated animated 3D cloud sphere casting soft parallax shadows, sunset/sunrise terminator reddening, Fresnel ocean glint, warm night city lights, enhanced Moon relief + Earthshine.
- Upgrade `Props.ts` (Estación Tesela, Observatorio Halo-7, Cápsula de muestras, Sandbox targets) with PBR materials, truss details, solar arrays, gold MLI, and glowing beacons.

### Phase 5 — Simulation, Cockpit, Audio, Exploded View, UI & Architecture
- Decompose `Engine.ts` cleanly (`CameraRig.ts`, `SceneLighting.ts`, `Persistence.ts`, `EffectsManager.ts`).
- Fix `Engine.ts` per-frame `markVisDirty()` bug & optimize selective dirty-node matrix updates in `ShipModel.ts`.
- Add Keplerian orbital telemetry & dynamics context to `Flight.ts`, Crew Free-Explore mode toggle, complete v3 state persistence (`save`/`restore` including mode, seated, camera, arm).
- Fix `hideExteriorSkin` so hull/wings/arm remain visible through Cupola windows.
- Upgrade `Cockpit.ts` MFDs (1024×640 crisp glass-cockpit graphics, pitch ladder, ground track, docking reticle, bus schematic) + animated RHC/THC stick tilt.
- Upgrade `Audio.ts` with compartment-differentiated ambient acoustics and multi-layered sound effects.
- Upgrade Exploded View (system explosion presets, local subsystem explode, search/filter, smooth reversible assembly).
- Elevate UI (`App.tsx`, `styles.css`): refined aerospace glassmorphism, Photo Mode, Free-Explore toggle, clean mobile layout.

### Phase 6 — Conceptual Engineering Audit, Blueprints, Renders, Sync, Tests & Publication
- Run automated Blender geometric & conceptual engineering validator (`blender/validate_engineering.py`) → `docs/INGENIERIA_CONCEPTUAL.md`.
- Upgrade & regenerate all 10+ blueprints cleanly (`blender/blueprints.py`, `blueprint_compose.py`) eliminating overlaps and syncing to `web/public/blueprints/`.
- Run `scripts/sync_all.py` guaranteeing byte-exact sync of `docs/inventario.{json,csv}` ↔ `web/public/data/inventario.{json,csv}`, blueprints, and `stats.json`.
- Regenerate updated Cycles renders (`renders/*_final.png`).
- Build comprehensive failing-capable `web/tests/functional.cjs` (20+ real assertions including Cupola view, full page-reload persistence, sync verification, mobile viewport, exit code 1 on failure).
- Capture final 15 fixed-camera comparison shots (`docs/singularity_after/*.jpg`), inspect every shot side-by-side vs baseline, run iterative fix loops until satisfied.
- Final commits, push `gemini/alcion-singularity`, publish to `gh-pages`, and verify live on `https://alvarodesigns34.github.io/SHIP/`.
