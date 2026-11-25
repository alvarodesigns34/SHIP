"""
Biblioteca de materiales PBR del ALCIÓN HX-4.

Cada material se construye con el Principled BSDF y, para el renderizado en
Cycles, con microdetalle procedural (ruido de rugosidad, arrugado del
aislamiento multicapa, malla de celdas solares, etc.). El exportador glTF solo
transmite los factores base (color, metalicidad, rugosidad, emisión); la
aplicación web reconstruye el microdetalle a partir del NOMBRE del material
(ver web/src/materials.ts), por lo que los nombres son parte del contrato.
"""
import bpy

MATS = {}

# nombre: (color RGB lineal aprox., metallic, roughness, extra)
SPEC = {
    "M_ShieldWhite":  ((0.80, 0.80, 0.78), 0.0, 0.52, {"noise": 0.08, "desc": "Panel escudo MMOD: aluminio 6061 pintado blanco térmico (Z-93 tipo)"}),
    "M_ShieldWarm":   ((0.74, 0.73, 0.69), 0.0, 0.58, {"noise": 0.10, "desc": "Panel escudo MMOD, variante de lote"}),
    "M_BetaCloth":    ((0.86, 0.85, 0.80), 0.0, 0.88, {"noise": 0.15, "fabric": True, "desc": "Tejido beta (fibra de vidrio recubierta de PTFE)"}),
    "M_MLI_Gold":     ((0.95, 0.62, 0.22), 1.0, 0.22, {"crinkle": True, "desc": "MLI exterior: Kapton aluminizado (cara ámbar)"}),
    "M_MLI_Silver":   ((0.90, 0.90, 0.92), 1.0, 0.18, {"crinkle": True, "desc": "MLI: Mylar aluminizado"}),
    "M_MLI_Black":    ((0.03, 0.03, 0.035), 0.3, 0.45, {"crinkle": True, "desc": "MLI con capa exterior de Kapton negro conductor"}),
    "M_AlBare":       ((0.91, 0.92, 0.93), 1.0, 0.33, {"noise": 0.10, "brushed": True, "desc": "Aluminio mecanizado"}),
    "M_AlLi":         ((0.78, 0.80, 0.82), 1.0, 0.42, {"noise": 0.12, "desc": "Aleación Al-Li 2195 (casco presurizado, isogrid)"}),
    "M_AlChromate":   ((0.75, 0.68, 0.32), 1.0, 0.45, {"noise": 0.12, "desc": "Aluminio con conversión química (alodine)"}),
    "M_AlAnodBlack":  ((0.025, 0.025, 0.028), 0.85, 0.38, {"noise": 0.05, "desc": "Aluminio anodizado negro"}),
    "M_Titanium":     ((0.62, 0.60, 0.57), 1.0, 0.36, {"noise": 0.10, "desc": "Titanio Ti-6Al-4V"}),
    "M_CFRP":         ((0.035, 0.036, 0.04), 0.2, 0.32, {"weave": True, "desc": "Compuesto de fibra de carbono (CFRP)"}),
    "M_Steel":        ((0.66, 0.66, 0.67), 1.0, 0.28, {"desc": "Acero inoxidable A286"}),
    "M_Bolt":         ((0.70, 0.70, 0.70), 1.0, 0.30, {"desc": "Tornillería de acero pasivado / titanio"}),
    "M_Copper":       ((0.95, 0.60, 0.42), 1.0, 0.30, {"desc": "Cobre"}),
    "M_GoldPlate":    ((1.00, 0.77, 0.36), 1.0, 0.20, {"desc": "Contactos dorados"}),
    "M_SolarCell":    ((0.010, 0.016, 0.050), 0.0, 0.22, {"cells": True, "desc": "Células solares de triple unión GaInP/GaAs/Ge"}),
    "M_SolarBack":    ((0.70, 0.52, 0.22), 0.6, 0.45, {"crinkle": True, "desc": "Sustrato del manto solar (Kapton)"}),
    "M_Radiator":     ((0.92, 0.93, 0.95), 0.0, 0.10, {"noise": 0.04, "tape": True, "desc": "Radiador: cinta de teflón plateado (OSR flexible)"}),
    "M_Glass":        ((0.80, 0.88, 0.95), 0.0, 0.02, {"glass": True, "desc": "Vidrio de sílice fundida multipanel"}),
    "M_GlassInner":   ((0.70, 0.80, 0.90), 0.0, 0.04, {"glass": True, "desc": "Panel interior de policarbonato antirayado"}),
    "M_Nozzle":       ((0.18, 0.18, 0.21), 1.0, 0.48, {"noise": 0.2, "desc": "Tobera de aleación de niobio C-103 con recubrimiento R512E"}),
    "M_NozzleHot":    ((0.30, 0.20, 0.16), 1.0, 0.55, {"noise": 0.3, "desc": "Tobera, zona de garganta (decoloración térmica)"}),
    "M_HallBody":     ((0.30, 0.30, 0.31), 1.0, 0.40, {"desc": "Cuerpo de propulsor Hall (circuito magnético de hierro)"}),
    "M_BoronNitride": ((0.88, 0.86, 0.82), 0.0, 0.70, {"noise": 0.1, "desc": "Cerámica de nitruro de boro (canal de descarga)"}),
    "M_InteriorPanel":((0.76, 0.75, 0.72), 0.0, 0.58, {"noise": 0.06, "desc": "Panel interior (compuesto Nomex/fibra de vidrio blanco cálido)"}),
    "M_InteriorGrey": ((0.30, 0.32, 0.35), 0.0, 0.50, {"noise": 0.05, "desc": "Panel interior gris grafito"}),
    "M_InteriorDark": ((0.055, 0.060, 0.068), 0.15, 0.44, {"desc": "Bastidor interior anodizado oscuro"}),
    "M_Fabric":       ((0.76, 0.71, 0.61), 0.0, 0.90, {"fabric": True, "desc": "Tejido Nomex acolchado de estiba"}),
    "M_FabricBlue":   ((0.08, 0.15, 0.28), 0.0, 0.88, {"fabric": True, "desc": "Tejido técnico azul marino (literas, sujeciones)"}),
    "M_SeatCushion":  ((0.045, 0.048, 0.055), 0.0, 0.72, {"fabric": True, "desc": "Tapizado ergonómico de asiento (Alcantara / cuero técnico)"}),
    "M_Handrail":     ((0.85, 0.62, 0.10), 0.3, 0.42, {"desc": "Pasamanos (aluminio anodizado amarillo)"}),
    "M_EVAYellow":    ((0.90, 0.68, 0.05), 0.2, 0.45, {"desc": "Pasamanos EVA (amarillo de alta visibilidad)"}),
    "M_Screen":       ((0.01, 0.01, 0.012), 0.0, 0.08, {"emit": (0.25, 0.55, 0.95), "strength": 3.0, "screen": True, "desc": "Pantalla LCD de cabina"}),
    "M_ScreenAmber":  ((0.01, 0.01, 0.01), 0.0, 0.08, {"emit": (1.0, 0.55, 0.15), "strength": 2.5, "screen": True, "desc": "Pantalla de estado (ámbar)"}),
    "M_LED":          ((1.0, 0.97, 0.92), 0.0, 0.3, {"emit": (1.0, 0.95, 0.88), "strength": 8.0, "desc": "Iluminación LED de estado sólido"}),
    "M_LEDGreen":     ((0.1, 1.0, 0.3), 0.0, 0.3, {"emit": (0.2, 1.0, 0.35), "strength": 5.0, "desc": "Indicador LED verde"}),
    "M_LEDRed":       ((1.0, 0.1, 0.05), 0.0, 0.3, {"emit": (1.0, 0.1, 0.05), "strength": 5.0, "desc": "Indicador LED rojo"}),
    "M_NavLight":     ((1.0, 1.0, 1.0), 0.0, 0.2, {"emit": (1.0, 1.0, 1.0), "strength": 20.0, "desc": "Baliza de navegación"}),
    "M_Rubber":       ((0.02, 0.02, 0.02), 0.0, 0.85, {"desc": "Elastómero / sellos de silicona"}),
    "M_Cable":        ((0.025, 0.025, 0.03), 0.0, 0.6, {"desc": "Mazo de cables con funda"}),
    "M_CableOrange":  ((0.85, 0.30, 0.05), 0.0, 0.55, {"desc": "Cable de alta tensión (funda naranja)"}),
    "M_CableWhite":   ((0.80, 0.80, 0.78), 0.0, 0.55, {"desc": "Cable de datos (funda blanca)"}),
    "M_DuctFlex":     ((0.62, 0.63, 0.65), 0.3, 0.55, {"desc": "Conducto flexible de aire"}),
    "M_Water":        ((0.20, 0.38, 0.62), 0.0, 0.35, {"desc": "Bolsas de agua del muro antiradiación"}),
    "M_HDPE":         ((0.85, 0.84, 0.80), 0.0, 0.6, {"desc": "Polietileno de alta densidad (blindaje)"}),
    "M_Kevlar":       ((0.80, 0.65, 0.25), 0.0, 0.8, {"fabric": True, "desc": "Tejido de Kevlar"}),
    "M_Nextel":       ((0.85, 0.83, 0.78), 0.0, 0.85, {"fabric": True, "desc": "Tejido cerámico Nextel"}),
    "M_Decal":        ((0.03, 0.035, 0.04), 0.0, 0.45, {"desc": "Marcado serigrafiado (negro)"}),
    "M_DecalRed":     ((0.75, 0.16, 0.04), 0.0, 0.45, {"desc": "Marcado de seguridad (rojo)"}),
    "M_Accent":       ((0.78, 0.22, 0.06), 0.0, 0.40, {"desc": "Pintura de identidad (bermellón ALCIÓN)"}),
    "M_Graphite":     ((0.06, 0.065, 0.07), 0.1, 0.45, {"desc": "Pintura de identidad (grafito)"}),
    "M_Teflon":       ((0.92, 0.92, 0.90), 0.0, 0.25, {"desc": "PTFE"}),
    "M_Sensor":       ((0.02, 0.02, 0.025), 0.4, 0.15, {"desc": "Óptica de sensor (recubrimiento antirreflejos)"}),
    "M_Lens":         ((0.05, 0.08, 0.12), 0.0, 0.03, {"glass": True, "desc": "Lente óptica"}),
    "M_Dish":         ((0.88, 0.88, 0.86), 0.0, 0.45, {"desc": "Reflector de antena (CFRP pintado)"}),
    "M_Battery":      ((0.20, 0.22, 0.24), 0.5, 0.45, {"desc": "Carcasa de batería Li-ion"}),
    "M_COPV":         ((0.05, 0.05, 0.055), 0.3, 0.30, {"weave": True, "desc": "Depósito COPV (liner de titanio + bobinado de carbono)"}),
    "M_Leaf":         ((0.05, 0.16, 0.035), 0.0, 0.55, {"noise": 0.1, "desc": "Hojas de cultivo (lechuga roja/verde)"}),
    "M_TankTi":       ((0.55, 0.54, 0.52), 1.0, 0.30, {"noise": 0.1, "desc": "Depósito de titanio"}),
}

MAT_DESC = {k: v[3].get("desc", "") for k, v in SPEC.items()}


def _principled(mat):
    nt = mat.node_tree
    return nt.nodes.get("Principled BSDF")


def _add_noise_rough(nt, bsdf, base_rough, amount, scale=40.0):
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = 8
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = max(0.0, base_rough - amount)
    mr.inputs["To Max"].default_value = min(1.0, base_rough + amount)
    nt.links.new(tex.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], bsdf.inputs["Roughness"])
    return coord


def _add_bump(nt, bsdf, coord, scale, strength, kind="noise", distortion=0.0):
    if kind == "voronoi":
        tex = nt.nodes.new("ShaderNodeTexVoronoi")
        tex.inputs["Scale"].default_value = scale
        out = tex.outputs["Distance"]
    elif kind == "wave":
        tex = nt.nodes.new("ShaderNodeTexWave")
        tex.inputs["Scale"].default_value = scale
        tex.inputs["Distortion"].default_value = distortion
        out = tex.outputs["Fac"]
    else:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = scale
        tex.inputs["Detail"].default_value = 6
        tex.inputs["Distortion"].default_value = distortion
        out = tex.outputs["Fac"]
    nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    nt.links.new(out, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def build_all():
    for name, (col, metal, rough, ex) in SPEC.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = _principled(m)
        b.inputs["Base Color"].default_value = (*col, 1.0)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        m.diffuse_color = (*col, 1.0)
        m.metallic = metal
        m.roughness = rough
        coord = None
        if ex.get("noise"):
            coord = _add_noise_rough(nt, b, rough, ex["noise"], 25.0)
            _add_bump(nt, b, coord, 300.0, 0.03)
        if ex.get("brushed"):
            if coord is None:
                coord = nt.nodes.new("ShaderNodeTexCoord")
            b.inputs["Anisotropic"].default_value = 0.6
        if ex.get("crinkle"):
            coord = _add_noise_rough(nt, b, rough, 0.10, 4.5)
            _add_bump(nt, b, coord, 4.5, 0.13, "noise", 1.1)
        if ex.get("fabric"):
            if coord is None:
                coord = nt.nodes.new("ShaderNodeTexCoord")
            _add_bump(nt, b, coord, 400.0, 0.25, "wave", 2.0)
        if ex.get("weave"):
            coord = _add_noise_rough(nt, b, rough, 0.06, 60.0)
            _add_bump(nt, b, coord, 220.0, 0.12, "wave", 0.5)
        if ex.get("cells"):
            # cuadrícula de células: brick texture
            br = nt.nodes.new("ShaderNodeTexBrick")
            br.offset = 0.0
            br.inputs["Scale"].default_value = 1.0
            br.inputs["Color1"].default_value = (*col, 1)
            br.inputs["Color2"].default_value = (col[0] * 1.6, col[1] * 1.6, col[2] * 1.5, 1)
            br.inputs["Mortar"].default_value = (0.06, 0.06, 0.07, 1)
            br.inputs["Mortar Size"].default_value = 0.0015
            br.inputs["Brick Width"].default_value = 0.08
            br.inputs["Row Height"].default_value = 0.04
            cc = nt.nodes.new("ShaderNodeTexCoord")
            nt.links.new(cc.outputs["Object"], br.inputs["Vector"])
            nt.links.new(br.outputs["Color"], b.inputs["Base Color"])
        if ex.get("tape"):
            br = nt.nodes.new("ShaderNodeTexWave")
            br.inputs["Scale"].default_value = 6.0
            br.inputs["Distortion"].default_value = 0.0
            cc = nt.nodes.new("ShaderNodeTexCoord")
            nt.links.new(cc.outputs["Object"], br.inputs["Vector"])
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.inputs["To Min"].default_value = 0.06
            mr.inputs["To Max"].default_value = 0.16
            nt.links.new(br.outputs["Fac"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])
        if ex.get("glass"):
            b.inputs["Transmission Weight"].default_value = 0.95
            b.inputs["IOR"].default_value = 1.46
            m.blend_method = 'BLEND'
            b.inputs["Alpha"].default_value = 0.35
        if ex.get("emit"):
            b.inputs["Emission Color"].default_value = (*ex["emit"], 1)
            b.inputs["Emission Strength"].default_value = ex.get("strength", 2.0)
        m["desc"] = ex.get("desc", "")
        MATS[name] = m
    return MATS


def M(name):
    return MATS[name]
