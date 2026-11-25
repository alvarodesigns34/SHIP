"""
Parámetros geométricos maestros del ALCIÓN HX-4.

Todas las cotas de los planos (blueprints/) y de la documentación (docs/)
derivan de estas constantes: el modelo, los planos y la ficha técnica
comparten una única fuente de verdad.
"""
import math

# --- Módulo habitable (HAB) -------------------------------------------------
R_P = 2.10          # radio exterior del casco presurizado (Al-Li 2195)
T_P = 0.030         # espesor equivalente de pared
R_MLI = 2.135       # radio exterior del manto MLI sobre el casco
R_S = 2.26          # apotema del escudo MMOD poligonal (16 facetas)
N_FACETS = 16
X_HAB_A = 0.60      # extremo de popa del barril cilíndrico
X_HAB_F = 8.80      # extremo de proa del barril cilíndrico
N_BARRELS = 4
BARREL_L = (X_HAB_F - X_HAB_A) / N_BARRELS        # 2.05 m
X_DOME_A = 0.00     # vértice del mamparo de popa (elipsoidal)
X_CONE_F = 9.90     # extremo del cono adaptador HAB→NODO
R_CONE_F = 1.40

# Sección interior del pasillo (envolvente de bastidores, ISPR-like)
AISLE = 2.30        # lado del pasillo cuadrado libre (m)
R_INNER = 2.035     # radio interior libre tras el isogrid

# --- Nodo de proa (FWD) -----------------------------------------------------
R_N = 1.35
X_NODE_A = 9.90
X_NODE_F = 12.20
R_N_SHIELD = 1.43
X_CUPOLA = 11.05
DOCK_X0 = 12.25
DOCK_X1 = 12.95
IDSS_PASSAGE = 0.80  # diámetro libre de paso IDSS (estándar público)

# --- Módulo de servicio (SVC) -----------------------------------------------
SVC_X0 = 0.60
SVC_X1 = -4.40
SVC_MID = -1.90
SVC_APOTHEM = 2.16
N_OCT = 8

# --- Propulsión (PRP) -------------------------------------------------------
PRP_X0 = -4.40
PRP_X1 = -5.20
ENGINE_R = 0.95
ENGINE_EXIT_X = -6.35

# --- Potencia (PWR) ---------------------------------------------------------
SADA_X = -2.60
WING_ROOT_Y = 3.55
WING_L = 16.0
WING_W = 4.40
WING_SEGMENTS = 12

# --- Térmico (THR) ----------------------------------------------------------
RAD_X0 = -0.70
RAD_X1 = -3.90
RAD_PANEL_H = 1.75
RAD_PANELS = 3
RAD_ROOT_Z = 2.30

# Derivados útiles
LENGTH_OVERALL = DOCK_X1 - ENGINE_EXIT_X
SPAN_OVERALL = 2 * (WING_ROOT_Y + WING_L)
TAU = math.tau


def facet_angle(i):
    return TAU * i / N_FACETS


def oct_angle(i):
    return TAU * i / N_OCT
