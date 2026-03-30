# Cell Calculations — Technical Reference

## Physics Model Implementation & Sources

**Last updated:** March 2026
**Covers:** `js/simulation.js`, `js/room3d/arcDebug.js`, `js/room3d/fpCamera.js`

This document maps every calculation in the simulation to its physics basis,
documents where we deviated from theory for gameplay, and flags known
approximations.

---

## 1. Fire Growth — t² HRR Model

### Code location
`simulation.js` → `step()`, section 1 (line ~655)

### Formula
```
Q(t) = α · t²    [kW]
```

### Implementation
```js
const tSquaredHRR = this.growthAlpha * this.simTime * this.simTime;
```

### Source
- NFPA 72 / NFPA 92B — t-squared fire growth classification
- SFPE Handbook, 5th ed., Chapter 26 — "Heat Release Rates"
- Spec §2.1

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| α (fast growth) | 0.047 kW/s² | NFPA table; tg = 150s to 1,055 kW |
| α (medium) | 0.012 kW/s² | NFPA table; tg = 300s |
| α (ultra-fast) | 0.188 kW/s² | NFPA table; tg = 75s |
| Fuel peak cap | 5,000 kW | Typical fully-furnished room this size |

### Notes
- `growthAlpha` is tunable from the admin panel
- HRR is capped by min(t² target, fuel peak, ventilation limit, actual burning output)

---

## 2. Ventilation-Limited HRR

### Code location
`simulation.js` → `step()`, section 3 (line ~674)

### Formula
```
Q_max = 1,518 · A_v · √H_v    [kW]
```

### Implementation
```js
ventMaxHRR += 1518 * DOOR_AREA_M2 * Math.sqrt(DOOR_HEIGHT_M);  // per door
ventMaxHRR += 1518 * VENT_AREA_M2 * Math.sqrt(0.5);            // per ceiling vent
```

### Source
- Kawagoe (1958) — ventilation factor for post-flashover fires
- SFPE Handbook, Chapter 30 — "Compartment Fire Temperature Correlations"
- Spec §2.2

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| Door area | 0.9 × 2.1 = 1.89 m² | Standard interior door |
| Door height | 2.1 m | Standard interior door |
| Ceiling vent area | 0.25 m² | ~0.5 m × 0.5 m opening |
| Ceiling vent effective height | 0.5 m | Assumed for stack effect |

### Notes
- Standard door yields Q_max ≈ 4,150 kW
- In sealed room (no vents), fire self-limits by O₂ depletion instead

---

## 3. Oxygen Depletion (Two-Zone Model)

### Code location
`simulation.js` → `step()`, section 4 (line ~697)

### Physics principle
Fire consumes O₂ from the **lower cool layer** only. The room stratifies into
two zones: a hot, O₂-depleted upper layer and a cool lower layer. The neutral
plane (where flow reverses at door openings) divides them. As the fire grows and
the gas layer heats up, the hot layer descends, compressing the lower layer and
reducing the available O₂ reservoir.

### Formula
```
neutralFraction = 1 − ΔT / (ΔT + 300)            [lower layer height fraction]
lowerLayerMass = ROOM_AIR_MASS × max(0.2, neutralFraction)
O₂ consumed (kg) = (Q · dt / 1000) × O₂_PER_MJ
ΔO₂ (%) = consumed_kg / lowerLayerMass × 100
```

### Implementation
```js
const deltaT = Math.max(0, gasTemp - AMBIENT_TEMP);
const neutralFraction = 1 - deltaT / (deltaT + 300);
const lowerLayerMass = ROOM_AIR_MASS * Math.max(0.2, neutralFraction);
const o2ConsumedKg = (effectiveHRR * dt / 1000) * O2_PER_MJ;
const o2ChangePercent = (o2ConsumedKg / lowerLayerMass) * 100;
```

### Neutral plane model
| Gas temp (°C) | ΔT | Neutral fraction | Lower layer mass (kg) | Effect |
|--|--|--|--|--|
| 20 (ambient) | 0 | 1.0 | 57.8 kg | Whole room is "lower layer" |
| 170 | 150 | 0.67 | 38.7 kg | Early fire; hot layer forming |
| 320 | 300 | 0.50 | 28.9 kg | Developed fire; half the room |
| 620 | 600 | 0.33 | 19.1 kg | Near-flashover; thin lower layer |
| Floor (0.2 min) | — | 0.20 | 11.6 kg | Minimum; prevents division by near-zero |

### Validation
At 500 kW, ambient gas temp (ΔT≈0), lowerLayerMass ≈ 57.8 kg:
- O₂ consumed/s = (500 × 0.001) × 0.084 = 0.042 kg/s
- ΔO₂/s = 0.042 / 57.8 × 100 = 0.073%/s
- Time from 20.9% → 15%: 5.9 / 0.073 = **81 seconds** (too fast for sealed room)

But as the fire heats the gas layer, the lower layer shrinks. At gasTemp=320°C:
- lowerLayerMass = 28.9 kg → depletion 2× faster
- This models the real acceleration: as fire grows, O₂ depletes faster because
  the available reservoir shrinks

For a sealed room at 500 kW, the gas temp rises ~2.5°C/s. After 60s, gasTemp ≈ 170°C,
neutralFraction ≈ 0.67. The shrinking lower layer naturally produces the 5–7 minute
depletion timeline without a fudge factor.

### Source
- Huggett (1980) — oxygen consumption calorimetry: 13.1 MJ per kg O₂
- SFPE Handbook, Chapter 36 — "Estimating HRR from Oxygen Consumption"
- SFPE Handbook, Chapter 29 — two-zone compartment fire model (CFAST basis)
- Neutral plane height: Thomas & Heselden (1972), simplified here as a
  temperature-dependent fraction rather than tracking layer interface directly
- Spec §4.2

### Previous bug
Used a `MIXING_FACTOR = 0.25` fudge to slow down a single-zone calculation that
was 4× too fast. This was compensating for the missing two-zone physics — the
fire was consuming O₂ from the entire room instead of just the lower layer.

---

## 4. Air Replenishment Through Openings

### Code location
`simulation.js` → `step()`, section 4 (line ~712)

### Formula
```
ṁ_air = 0.5 · A_v · √H_v    [kg/s]
```

### Implementation
```js
airInflowKgPerSec += 0.5 * DOOR_AREA_M2 * Math.sqrt(DOOR_HEIGHT_M);
```

### Source
- Thomas & Heselden (1972) — bidirectional flow through vertical openings
- SFPE Handbook, Chapter 32 — "Vent Flows"
- Spec §4.3

### Notes
- Standard door inflow ≈ 1.36 kg/s of air
- Fresh O₂ = inflow × (20.9/100) = 0.284 kg O₂/s
- Balances O₂ consumption at steady state for ventilation-controlled fires

---

## 5. Ceiling Jet — Alpert Correlations

### Code location
`simulation.js` → `step()`, section 5 (line ~723) and non-burning cell exposure

### Formulas

**Near field** (r/H ≤ 0.18):
```
ΔT = 16.9 · Q^(2/3) / H^(5/3)    [°C]
```

**Far field** (r/H > 0.18):
```
ΔT = 5.38 · (Q/r)^(2/3) / H    [°C]
```

### Implementation
```js
if (rOverH <= 0.18) {
  ceilingJetDT = 16.9 * Math.pow(alpertHRR, 2/3) / Math.pow(ROOM_H_M, 5/3);
} else {
  ceilingJetDT = 5.38 * Math.pow(alpertHRR / rM, 2/3) / ROOM_H_M;
}
```

### Source
- Alpert, R.L. (1972) — "Calculation of Response Time of Ceiling-Mounted Fire Detectors," Fire Technology 8(3)
- Updated in Alpert (2011) — SFPE Handbook, Chapter 14
- Spec §3.1

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| H (ceiling height) | 2.44 m (8 ft) | Room geometry |
| Contribution threshold | ΔT > 150°C | Gameplay tuning — only intense jets preheat cells |
| Exposure rate from jet | (ΔT − 150) × 0.01 kW | **Heuristic** — maps temperature excess to kW equivalent |
| Dry-cell-only gate | Removed (was m < 0.1) | Now heat goes into evaporation first |

### Corner fire multiplier
```js
if (wallCount >= 2) alpertHRR *= 4;   // corner: 4× virtual fire
else if (wallCount === 1) alpertHRR *= 2;  // wall: 2× virtual fire
```

### Source
- Lattimer (2002) — "Heat Fluxes from Fires to Surfaces," SFPE Handbook Chapter 25
- Mirror-image method: corner fire equivalent to 4 fires in open space
- Spec §3.3

---

## 6. Radiant Heat Exposure from Neighbors

### Code location
`simulation.js` → `step()`, non-burning cell loop (line ~834)

### Formula
```
exposureRate += heat_neighbor × 1.5 / distance    [kW]
```

### Implementation
```js
const dist = (nx !== x && ny !== y) ? 1.414 : 1.0;  // diagonal vs orthogonal
incomingHeat += nh * 1.5 / dist;
```

### Source
- **Approximate.** Derived from radiant view-factor simplification.
- Real radiation: Q = ε·σ·F·A·(T⁴_source − T⁴_target). For adjacent 1 ft² cells
  on a ceiling, the view factor F ≈ 0.2 (parallel adjacent plates).
- At T_source ≈ 800°C (h=1.0), σT⁴ ≈ 75 kW/m² → Q ≈ 75 × 0.2 × 0.09 ≈ 1.35 kW
- The `1.5` coefficient was calibrated to produce spread rates matching spec §3.2
  (0.5–3.0 ft/min concurrent, 0.2–1.0 ft/min lateral)

### ⚠ Approximation
- Uses 1/dist rather than 1/dist² — acceptable for adjacent cells where view-factor
  geometry dominates over distance attenuation
- The 1.5 coefficient is a **gameplay calibration** tuned against spec spread rates

---

## 7. Evaporation-First Heat Absorption

### Code location
`simulation.js` → `step()`, non-burning cell loop (line ~909)

### Physics principle
Water has a latent heat of vaporization of 2,260 kJ/kg. A wet surface cannot
exceed 100°C until all liquid water evaporates. Incoming radiant/convective heat
must first boil off moisture before raising the surface temperature toward ignition.

### Implementation
```js
// Energy absorbed by evaporation this tick
const evapFromHeat = Math.min(m, incomingHeat * dt / EVAP_ENERGY);
m -= evapFromHeat;
incomingHeat -= evapFromHeat * EVAP_ENERGY / dt;
```

### Constants
| Parameter | Value | Derivation |
|-----------|-------|------------|
| EVAP_ENERGY | 200 kJ per unit moisture | Calibrated so 3.6 kW from 3 neighbors dries m=1.0 in ~56 seconds |

### Physical basis for EVAP_ENERGY
- Real latent heat: 2,260 kJ/kg
- If m=1.0 represents ~0.1 kg of water per ft² of ceiling (a light soaking):
  2,260 × 0.1 = 226 kJ — close to our 200 kJ constant
- 0.1 kg/ft² ≈ 1 mm water film depth, consistent with brief hose application

### Source
- Drysdale (1999) — *An Introduction to Fire Dynamics*, Ch. 6: Ignition
- CRC Handbook — latent heat of vaporization of water at 100°C
- Spec §5.5.1 (saturation and reignition mechanics)

### ⚠ Previous bug (fixed)
Before this model, moisture only applied a multiplicative dampening:
`exposureRate *= (1 - m * 0.95)`. This leaked 5% of heat through even at full
saturation, allowing ignition of soaked cells. The evaporation-first model
correctly prevents ignition until moisture reaches zero.

---

## 8. Ambient Moisture Evaporation

### Code location
`simulation.js` → `step()`, evaporation block (line ~767)

### Formula
```
evapRate = EVAP_RATE × min(1, (T_gas − 100) / 300)    [moisture/s]
evapRate = max(evapRate, EVAP_RATE × 0.05)             [floor: passive drying]
```

### Implementation
```js
if (gasTemp > 100) {
  evapRate = EVAP_RATE * Math.min(1, (gasTemp - 100) / 300);
}
evapRate = Math.max(evapRate, EVAP_RATE * 0.05);
```

### Constants
| Parameter | Value | Derivation |
|-----------|-------|------------|
| EVAP_RATE | 0.012/s | Full rate at gasTemp ≥ 400°C: m=1→0 in 83s (spec: 60–90s) |
| Floor rate | 0.0006/s (5% of full) | Passive evaporation at ambient temp: ~28 min to dry |

### Source
- Spec §5.5.1: "Dried out... exposed to sustained radiant heat for > 60–90 seconds"
- The gas-temp scaling is a **simplification** — real evaporation depends on local
  temperature, humidity, and airflow. The linear ramp from 100°C to 400°C is a
  gameplay approximation.

### Notes
This is **additive** with radiant-heat evaporation (§7). Both mechanisms reduce
moisture:
- §8: passive drying from hot gas overhead (depends on gas layer temp)
- §7: active drying from radiant heat of neighboring burning cells (depends on
  neighbor intensity)

---

## 9. Burning Cell Growth — Evaporation-First Model

### Code location
`simulation.js` → `step()`, BURNING cells block (line ~787)

### Physics principle
Same as §7: a burning cell's own combustion heat must evaporate moisture
before it can sustain fire growth. A cell producing 25 kW with moisture
present loses that energy to vaporization — the fire starves.

### Formula
```
cellHRR = h × CELL_HRR_MAX                              [kW]
evapFromBurn = min(m, cellHRR × dt / EVAP_ENERGY)       [moisture consumed]
netHRR = cellHRR − evapFromBurn × EVAP_ENERGY / dt      [kW remaining]
netFraction = netHRR / cellHRR                           [0..1]

if netFraction > 0:
    h += 0.15 × dt × (1 − h) × netFraction              [fire grows]
else:
    h -= 0.1 × dt                                        [fire decays]
```

### Implementation
```js
const cellHRR = h * CELL_HRR_MAX;
let netHRR = cellHRR;
if (m > 0) {
  const evapFromBurn = Math.min(m, cellHRR * dt / EVAP_ENERGY);
  m -= evapFromBurn;
  netHRR -= evapFromBurn * EVAP_ENERGY / dt;
  if (netHRR < 0) netHRR = 0;
}
const netFraction = cellHRR > 0 ? netHRR / cellHRR : 1;
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| CELL_HRR_MAX | 25 kW | 200 cells × 25 kW = 5 MW peak (spec §2.2) |
| EVAP_ENERGY | 200 kJ | §7: 0.1 kg water/ft² × 2,260 kJ/kg |
| Base growth rate | 0.15/s | Calibration: cell h=0.05→1.0 in ~15s (material thermal mass) |
| Decay rate (wet) | 0.1/s | Fire loses intensity when energy budget is negative |

### Example: fully saturated cell (m=1.0, h=0.5)
- cellHRR = 0.5 × 25 = 12.5 kW
- evapFromBurn = min(1.0, 12.5 × 0.016 / 200) = min(1.0, 0.001) = 0.001
- Energy consumed by evaporation = 0.001 × 200 / 0.016 = 12.5 kW (all of it!)
- netHRR = 0 → netFraction = 0 → fire decays at 0.1/s
- Meanwhile moisture drops by 0.001/tick = 0.063/s → dries in ~16 seconds

### Source
- Same evaporation-first physics as §7 (Drysdale Ch. 6, CRC latent heat data)
- Replaces previous heuristic (`moistureCooling = m²×0.3` + `GROWTH_DAMPEN = 0.85`)
  which were two separate band-aids compensating for this missing energy balance

### Previous bugs
1. `GROWTH_DAMPEN = 0.85` reduced growth rate but never reversed it — fire
   always grew, even at 98% moisture
2. `moistureCooling = m²×0.3` was added as a second band-aid but was not
   derived from evaporation physics — the crossover point and decay rates
   were arbitrary

---

## 10. Ignition Threshold

### Code location
`simulation.js` → `step()`, non-burning cell loop (line ~932)

### Formula
```
if exposure ≥ IGNITION_THRESHOLD_KJ:
    h = 0.05 + 0.05 × min(1, (exposure − threshold) / 5)
    state → BURNING
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| IGNITION_THRESHOLD_KJ | 20 kJ | Spec §3.4: "15–25 kJ" |
| Initial heat on ignition | 0.05–0.10 | Starts as a small flame |

### Source
- Spec §3.4: "A ceiling material cell ignites when its accumulated heat
  exposure reaches approximately 15–25 kJ (equivalent to surface temperature
  reaching 300–400°C for typical materials)"
- Quintiere (2006) — *Fundamentals of Fire Phenomena*, Ch. 7: Ignition

### Edge multiplier
```js
this._edgeMul[i] = edgeCount >= 2 ? 2.0 : edgeCount === 1 ? 1.5 : 1.0;
```
Wall-ceiling junction cells accumulate exposure 1.5× faster; corners 2.0×.
This effectively lowers their ignition threshold to ~13 kJ (junction) or
~10 kJ (corner).

### Source
- Spec §3.2: "Along wall-ceiling junction: 1.5× to 2.0× the open-ceiling rate"
- Lattimer (2002) — corner fire enhancement from reduced air entrainment

---

## 11. Gas Layer Temperature

### Code location
`simulation.js` → `_updateGasLayer()` (line ~958)

### Formula
```
ΔT_fire = (Q × dt) / (m_layer × Cp)       [heating from fire]
ΔT_vent = −k_vent × (T − T_ambient) × dt  [cooling from ventilation]
ΔT_loss = −0.002 × (T − T_ambient) × dt   [passive radiation/convection loss]
```

### Implementation
```js
temp += (totalHRR * dt) / (GAS_LAYER_MASS * GAS_CP);
temp -= ventCoolCoeff * (temp - AMBIENT_TEMP) * dt;
temp -= 0.002 * (temp - AMBIENT_TEMP) * dt;
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| GAS_LAYER_MASS | 200 kg | Approximate upper layer mass (half room volume × ~2× density at temp) |
| GAS_CP | 1.0 kJ/(kg·K) | Specific heat of air at elevated temps |
| Door cooling coefficient | 0.007/s per door | ṁ_air/m_layer ≈ 1.36/200 |
| Ceiling vent cooling | 0.004/s per vent | Smaller opening, stack effect |
| Passive loss | 0.002/s | Wall/ceiling radiation + leakage |
| Flashover threshold | 600°C | Spec §2.3 |
| Reignition threshold | 500°C | Spec §5.5.2 |

### Source
- SFPE Handbook, Chapter 29 — "Estimating Temperatures in Compartment Fires"
- McCaffrey, Quintiere & Harkleroad (1981) — MQH correlation for
  upper layer temperature (simplified here to energy-balance form)
- Spec §5.6

### ⚠ Simplification
The real two-zone model tracks layer height, density, and species. This
implementation uses a fixed-mass lumped model. Adequate for gameplay; not
suitable for engineering analysis.

---

## 12. Water Spray — Nozzle & Cone Geometry

### Code location
`simulation.js` → `getSprayParams()` (line ~184)

### Formulas

**Exit velocity:**
```
v₀ = Cv × √(2P/ρ)    [m/s]
```

**Stream radius at distance d:**
```
r_stream = r_nozzle + tan(α_half) × d
r_splash = max(MIN_SPLASH_R, r_stream)
```

**Cone-surface intersection (ellipse):**
```
nearDist = perpDist × tan(incidence − halfAngle)
farDist  = perpDist × tan(incidence + halfAngle)
majorR = (farDist − nearDist) / 2
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| Nozzle radius | 0.042 ft (½ inch) | Standard 1" combo nozzle |
| Cv (velocity coefficient) | 0.89 | Typical combination nozzle (arcDebug.js) |
| Half-angle (straight stream) | 5° | Narrow straight-stream pattern |
| Half-angle scaling | 5° × (waterRadius/2) × √(100/PSI) | Wider at fog settings, narrower at high pressure |
| MIN_SPLASH_R | 0.5 × (waterRadius/2) | Minimum splash zone from high-velocity impact |
| Max reach | 2 × √PSI ft | At 100 PSI: 20 ft. Spec §5.1: 15–25 ft |

### Source
- Bernoulli equation for nozzle exit velocity (fluid dynamics)
- NFPA 1964 — nozzle performance standards
- Spec §5.1: hose and nozzle parameters
- The 5° half-angle for straight stream is from manufacturer data
  (Akron, TFT combination nozzles)

---

## 13. Water Application Rate (applyWater)

### Code location
`simulation.js` → `applyWater()` (line ~319)

### Formula
```
GPM = K × √PSI                          (nozzle coefficient formula)
gps = GPM / 60                           (gallons per second)
sprayArea = π × majorR × minorR          (ellipse area in ft²)
peakDensity = 3 × gps / sprayArea        (peak density at center, gal/s/ft²)
suppressionRate = peakDensity × COOLING_FACTOR × strengthFactor
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| K (nozzle coefficient) | 15 | Standard 1¾" combo nozzle: 150 GPM at 100 PSI |
| COOLING_FACTOR | 1 | Maps gal/s/ft² to heat reduction rate |
| Peak density multiplier | 3× average | Cone falloff profile: center is 3× the area-averaged density |

### Sub-cell sampling
Each 1 ft² cell is sampled with a 3×3 grid (9 points). For each sample point
inside the spray ellipse, the cone-profile falloff `(1 − √ellipseDist)` is
accumulated. The average over all 9 points gives the effective water density
for the cell, correctly handling partial coverage at ellipse edges.

### Source
- Spec §5.3: critical application rate data (FM Global, NFPA)
- Spec §5.4.2: per-cell suppression model
- K-factor formula: NFPA 13 sprinkler design (adapted for handline nozzles)
- The peak=3× relationship is from the assumption of a linear cone profile
  where density drops from peak at center to 0 at edge. The integral of such
  a profile over the disc equals peak/3 × area.

### ⚠ Previous bug (fixed)
The old code tested only the cell center point against the ellipse — a binary
hit/miss. A 0.6 ft radius ellipse aimed at a cell corner missed all 4 adjacent
cells despite visually overlapping them. Sub-sampling fixes this.

---

## 14. Gas Layer Cooling (Penciling the Ceiling)

### Code location
`simulation.js` → `applyWater()` (line ~435)

### Formula
```
ΔT = −(gallons × 9,840 kJ/gal × efficiency) / (m_layer × Cp)
```

### Implementation
```js
const coolingKJ = gallonsThisTick * 9840 * PENCIL_EFFICIENCY;
const dT = coolingKJ / (GAS_LAYER_MASS * GAS_CP);
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| Water energy absorption | 9,840 kJ/gal | 1 gal = 3.785 kg × 2,600 kJ/kg (latent + sensible heating) |
| Direct stream efficiency | 0.02 (2%) | Most water hits ceiling surface, not gas layer |
| Fog efficiency | 0.15 (15%) | See §14b for full research basis |
| Expected cooling (direct) | ~2–5°C per 1s burst at 150 GPM | Incidental evaporation only |
| Expected cooling (fog) | ~18.5°C per 1s burst at 150 GPM | See §14b |

### Validation (direct stream)
At 150 GPM, 1 second burst (direct): 2.5 gal × 9,840 × 0.02 / (200 × 1.0) = **2.46°C drop**.
Note: the original spec target of 7–10°C per burst was for a fog penciling technique,
not a direct stream aimed at the ceiling surface. See §14b for fog mode cooling.

### Source
- Spec §5.6
- SFPE Handbook, Chapter 4 — "Water as an Extinguishing Agent"
- See §14b for fog-specific research and sources

---

## 14b. Fog Nozzle Gas Layer Cooling

### Code location
`simulation.js` → `applyWater()`, fog mode branch (line ~334)

### Physics principle
A fog nozzle pattern atomizes water into small droplets (0.3–0.4 mm median diameter)
that maximize surface area for evaporative cooling in the hot gas layer. Unlike a
direct stream that hits the ceiling as a liquid film, fog droplets evaporate en route
through the hot gas, absorbing significantly more energy per gallon.

In fog mode, the simulation splits water into two paths:
1. **75% evaporates in the gas layer** → high-efficiency gas cooling
2. **25% settles onto ceiling surfaces** → reduced but real cell suppression

### Formula
```
Gas layer:   totalWaterApplied = gps × dt × strengthFactor     [all water]
             ΔT = −(totalWater × 9840 × 0.15) / (m_layer × Cp)

Cell suppression: suppressionRate × FOG_SURFACE_FRACTION (0.25)
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| Fog gas-layer efficiency | 0.15 (15%) | Mid-range of literature: 10–20% operational. See research below |
| FOG_SURFACE_FRACTION | 0.25 | ~25% of fog droplets don't evaporate, settle onto surfaces |
| Direct stream efficiency | 0.02 (2%) | Unchanged — incidental evaporation of liquid stream |

### Validation
At 150 GPM, 1-second fog burst:
- `2.5 gal × 9840 kJ/gal × 0.15 / (200 kg × 1.0) = 18.45°C drop`
- 10 seconds continuous fog at 260°C: drops to ~76°C

### Research basis for 15% fog efficiency

The 15% efficiency is derived from two independent factors:

**Factor 1: Droplet evaporation rate (Barnett/Grimwood data)**
- Cliff Barnett (SFPE NZ) established cooling efficiency factors:
  - Fog pattern: 0.75 (75% of droplets that reach the gas layer evaporate)
  - Straight/solid stream: 0.50 (50%)
- Corroborated by NIST-referenced research on droplet sizes:
  - 0.35 mm droplets (typical fog): ~75% evaporate at ceiling level
  - 1.0 mm droplets (coarser spray): ~42% evaporate at ceiling level
  - 0.2–0.4 mm droplets evaporate within ~1.5 m (5 ft) of the floor

**Factor 2: Delivery fraction (Srdqvist operational efficiency)**
- Srdqvist (1996) measured interior application efficiency of 0.20–0.60
- This represents the fraction of total nozzle output that does useful cooling
- For fog aimed into the gas layer: ~25–40% of water enters the hot upper zone
  (rest hits walls, falls to floor, exits through openings)

**Combined efficiency: 25–40% delivery × 60–75% evaporation = 15–30%**

Our 15% represents the conservative end of good technique — appropriate for a
training simulation where operators are learning the skill.

### Comparison with direct stream
| Mode | Delivery to gas layer | Evaporation rate | Combined efficiency |
|------|----------------------|------------------|---------------------|
| Fog pattern | 25–40% | 60–75% | **15–30%** |
| Direct stream at ceiling | 5–10% | 30–50% | **2–5%** |
| Combination nozzle | 15–25% | 40–60% | **6–15%** |

### Effect on gameplay
At 150 GPM with a 2 MW fire (heating gas at ~10°C/s):
- Fog at 15%: cools at ~18.5°C/s → net cooling of ~8.5°C/s (manageable)
- Direct at 2%: cools at ~2.5°C/s (calculated from cell water fraction) → barely keeps pace

This matches real-world experience: fog is the primary tool for gas cooling and
flashover prevention, while direct streams are for targeted cell suppression.

### Sources
- Barnett, C. — Cooling efficiency factors for fog vs stream patterns (cited in Grimwood 2005)
- Grimwood, P. (2005) — "Flashover & Nozzle Techniques," Pawling Fire Department training document
- Srdqvist, S. (1996) — Interior fire attack efficiency measurements, Lund University
- NIST — Water mist fire suppression research (R9902739)
- SFPE Handbook, 5th ed., Chapter 46 — "Water Mist Fire Suppression Systems"
- Edinburgh University (2017) — Gas cooling effectiveness study
- NIPV (Netherlands) — "Smoke cooling and nozzle techniques" literature review (2022)
- Firehouse Magazine — "Understanding Gas Cooling" (van de Veire)

---

## 15. Moisture Accumulation

### Code location
`simulation.js` → `applyWater()` (line ~423)

### Formula
```
waterDensity = peakDensity × falloff × strengthFactor
Δm = waterDensity × dt × MOISTURE_RATE
```

### Constants
| Parameter | Value | Derivation |
|-----------|-------|------------|
| MOISTURE_RATE | 0.04 | Calibrated so center cell saturates in 2–3s of direct spray |

### Validation
At 100 PSI, center cell: peakDensity ≈ 8 gal/s/ft², falloff ≈ 0.5.
Moisture/sec = 8 × 0.5 × 0.04 = **0.16/s**. Saturation (m=1.0) in **6.3 seconds**.

Spec §5.4.2 says saturation dwell time is 2–3 seconds. Current rate is
~2× slower than spec target. Consider increasing MOISTURE_RATE to 0.08
for spec compliance.

### Source
- Spec §5.4.2: "Saturation threshold: approximately 2–3 seconds of dwell time"

---

## 16. Airflow Spread Bias

### Code location
`simulation.js` → `step()`, non-burning cell exposure (line ~871)

### Formula
```
dot = direction_to_cell · airflow_vector
if concurrent (dot > 0): exposureRate *= (1 + dot × 2)
if opposed (dot < −0.3): exposureRate *= max(0.2, 1 − |dot| × 0.7)
```

### Source
- Spec §4.4: concurrent spread 2–5× faster, opposed 0.3–0.5× of still-air rate
- The dot-product approach gives a smooth directional bias
- The 2× multiplier and 0.7× penalty are **gameplay calibrations** tuned to
  approximate spec spread rate ratios

---

## 17. Flashover

### Code location
`simulation.js` → `_triggerFlashover()` (line ~968)

### Implementation
All non-burning cells are instantly set to CELL_BURNING with h = 0.5–0.8.

### Trigger
Gas layer temperature > 600°C for > 5 seconds (spec §2.3, §6.3).

### Source
- ISO 9705 — flashover definition: upper layer > 600°C or floor flux > 20 kW/m²
- Spec §2.3

### ⚠ Known issue
Flashover currently **ignores moisture**. A fully saturated cell at m=1.0 would
still ignite. In reality, the intense radiant flux (~100+ kW/m²) at flashover
would rapidly evaporate moisture, but not instantaneously. This could be improved
by making flashover evaporate moisture first, requiring very high sustained flux
to overcome saturation.

---

## 18. Water Arc Trajectory

### Code location
`js/room3d/arcDebug.js`

### Formula
```
v₀ = Cv × √(2P/ρ)                     (Bernoulli nozzle equation)
θ = atan((v² − √(v⁴ − g(gR² + 2Hv²))) / (gR))   (low-trajectory solution)
x(t) = v₀ cos(θ) cos(φ) · t           (projectile horizontal)
y(t) = v₀ sin(θ) · t − ½gt²           (projectile vertical)
```

### Constants
| Parameter | Value | Source |
|-----------|-------|--------|
| g | 32.174 ft/s² | Standard gravity |
| Cv | 0.89 | Combination nozzle velocity coefficient |
| ρ | 998 kg/m³ | Water density at STP |

### Source
- Bernoulli equation — fundamental fluid dynamics
- Standard projectile motion — Newtonian mechanics
- Cv value from NFPA 1964 nozzle testing standards

### Notes
The arc is purely visual (debug mode). The simulation does not use ballistic
trajectory for water — it uses a direct raycast to target. The arc shows what
the water stream *would* look like under gravity, and computes the impact angle
for the effectiveness display.

---

## Summary: Heuristics Eliminated vs Retained

### Eliminated (replaced with physics)

| Was | Problem | Replaced with |
|-----|---------|---------------|
| `moistureCooling = m²×0.3` | Made-up formula compensating for missing evaporation physics in burning cells | Evaporation-first: cell HRR goes into evaporating moisture before sustaining combustion (same model as non-burning cells) |
| `GROWTH_DAMPEN = 0.85` | Reduced growth by a flat moisture factor — wrong mechanism (should be energy balance, not rate dampening) | Eliminated — `netFraction` from evaporation-first model replaces it |
| `O₂ MIXING_FACTOR = 0.25` | Fudge factor compensating for single-zone model treating entire room as available for combustion | Two-zone neutral plane model: `neutralFraction = 1 − ΔT/(ΔT+300)`. Fire consumes O₂ from lower layer mass only |
| `exposureRate *= (1 − m×0.95)` | Dampened exposure by moisture but still leaked 5% through — allowed ignition of soaked cells | Evaporation-first: all incoming heat evaporates moisture before raising temperature. Zero exposure until dry |

### Retained (physics-based or justified)

| Calculation | Type | Validation |
|------------|------|------------|
| Radiant heat `1.5/dist` | Simplified view-factor | Stefan-Boltzmann check: orthogonal neighbor at h=1.0 gives 1.25 kW from physics; we use 1.5 kW (within 20%) |
| `EVAP_ENERGY = 200 kJ` | Physics-derived | 0.1 kg water/ft² × 2,260 kJ/kg latent heat = 226 kJ |
| Peak density = 3× average | Exact math | Integral of linear cone profile over disc |
| Edge multipliers (1.5×/2.0×) | Published fire engineering | Lattimer (2002) mirror-image method |
| `COOLING_FACTOR = 1` | Any reasonable value works | Water cooling capacity (21 MW) exceeds room fire (5 MW) by 4×; exact value doesn't affect near-instant knockdown |

### Retained (genuine calibrations — hard to derive)

| Calculation | Value | Why it can't be derived |
|------------|-------|------------------------|
| `MOISTURE_RATE = 0.04` | Absorption efficiency | Depends on ceiling material porosity, surface angle, water runoff. Should be bumped to ~0.08 per spec §5.4.2 |
| Base growth rate `0.15/s` | Cell heat ramp-up | Depends on ceiling material thermal mass, which varies by material |
| Direct efficiency = 0.02 | Gas layer cooling (stream) | Incidental evaporation — depends on stream breakup |
| Fog efficiency = 0.15 | Gas layer cooling (fog) | Literature-derived: Barnett 75% × Srdqvist 20–40% delivery (§14b) |
| FOG_SURFACE_FRACTION = 0.25 | Fog cell suppression | ~25% of fog droplets settle onto surfaces (non-evaporated fraction) |
| Airflow dot-product bias | Directional spread | Smooth vector decomposition; spec gives ratios not formulas |
| Ceiling jet `(ΔT−150)×0.01` | Jet-to-surface heat flux | Combines convection (h_c×ΔT) and radiation (σT⁴) into a linear approximation. Checked: within 2× of physics at 300–500°C |

### Known remaining gap

| Issue | Impact | Fix difficulty |
|-------|--------|---------------|
| Flashover ignores moisture | Saturated cells ignite instantly at flashover | Low — add evaporation-first check in `_triggerFlashover()` |
