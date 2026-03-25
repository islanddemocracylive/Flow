# Fire Suppression Simulation — Technical Specification

## Fire Spread Model & Hose Suppression Mechanics

**Room Configuration:** 10 ft × 20 ft × 8 ft ceiling
**Draft v1.0 — March 2026**

---

## 1. Overview

This document defines the fire dynamics model for a simulation featuring a corner-origin fire spreading across a ceiling in a 10 ft × 20 ft × 8 ft room, and a player-controlled fire hose used to suppress it. The model is grounded in established fire engineering research (SFPE Handbook, NIST correlations, UL FSRI studies, FM Global data) but simplified for real-time interactive use.

The spec covers four interconnected systems: fire growth (heat release rate over time), ceiling flame spread (spatial progression), ventilation effects (oxygen supply and flow path), and hose suppression (water application and extinguishment). All values are provided in both SI and imperial units.

---

## 2. Fire Growth Model (Heat Release Rate)

### 2.1 t-Squared Growth Curve

Fire growth follows the standard t-squared model used throughout fire protection engineering. The heat release rate (HRR) at time t seconds after effective ignition is:

```
Q(t) = α · t²    [kW]
```

where α is the fire growth coefficient in kW/s². The growth time t_g is the time to reach 1,055 kW (1,000 BTU/s).

| Growth Rate | α (kW/s²) | t_g (seconds) | Typical Scenario |
|-------------|-----------|---------------|------------------|
| Slow | 0.003 | 600 | Dense hardwood, minimal synthetics |
| Medium | 0.012 | 300 | Mixed office/residential furnishings |
| Fast | 0.047 | 150 | Upholstered furniture, synthetics |
| Ultra-fast | 0.188 | 75 | High-stack storage, flammable liquids |

**Recommended default for simulation:** Fast growth (α = 0.047 kW/s²). Modern residential contents with synthetic materials typically produce fast-category fires. At this rate, the fire reaches 1 MW in 150 seconds (2.5 minutes).

### 2.2 Peak HRR and Ventilation Limit

The fire grows according to the t² curve until it hits one of two caps:

1. **Fuel-controlled peak:** The maximum HRR the available fuel package can sustain. For a furnished room this size, approximately 2–5 MW depending on fuel load.

2. **Ventilation-controlled peak:** When oxygen supply limits combustion. The maximum ventilation-limited HRR is approximately:

```
Q_max = 1,518 · A_v · √H_v    [kW]
```

where A_v is the vent opening area (m²) and H_v is the vent height (m). For a standard interior door (0.9 m × 2.1 m), this yields approximately 4.2 MW.

In a closed room with no openings, the fire will self-limit as oxygen depletes below approximately 15% concentration, at which point flaming combustion ceases. The fire enters a smouldering, ventilation-limited state.

### 2.3 Flashover Conditions

Flashover occurs when the upper gas layer reaches approximately 500–600°C (932–1112°F) or the floor-level heat flux reaches 20 kW/m². For a room this size with a fast-growth fire and an open doorway:

- Time to flashover: approximately 3–5 minutes from ignition
- HRR at flashover onset: approximately 1–2 MW (depends on ventilation and room geometry)
- Post-flashover gas temperature: 700–1200°C (1292–2192°F)

Closing the room door can prevent flashover entirely if the fire has not yet reached it.

---

## 3. Ceiling Fire Spread Model

### 3.1 Ceiling Jet Dynamics

When fire plume gases hit the ceiling, they form a ceiling jet — a thin, fast-moving layer of hot gas that spreads radially. The Alpert correlations (1972, revised) give the maximum temperature and velocity at radial distance r from the plume impingement point:

#### 3.1.1 Temperature (near field, r/H ≤ 0.18)

```
T_max − T_ambient = 16.9 · Q^(2/3) / H^(5/3)    [°C]
```

#### 3.1.2 Temperature (far field, r/H > 0.18)

```
T_max − T_ambient = 5.38 · (Q / r)^(2/3) / H    [°C]
```

#### 3.1.3 Velocity (near field, r/H ≤ 0.15)

```
U_max = 0.96 · (Q / H)^(1/3)    [m/s]
```

#### 3.1.4 Velocity (far field, r/H > 0.15)

```
U_max = 0.195 · Q^(1/3) · H^(1/2) / r^(5/6)    [m/s]
```

Where Q = heat release rate (kW), H = floor-to-ceiling height (m), r = radial distance from plume axis (m), T in °C, U in m/s.

For the simulation room (H = 2.44 m), at a 500 kW fire, the ceiling jet at 3 m from the plume axis has a temperature rise of approximately 50°C and velocity of approximately 1.5 m/s.

### 3.2 Flame Spread Rate Along Ceiling

Flame spread across the ceiling occurs through two coupled mechanisms: direct flame extension from the fire plume, and remote ignition of ceiling materials preheated by the ceiling jet radiation and convection. The spread rate depends heavily on the direction relative to the fire and room geometry.

| Spread Direction | Rate | Mechanism |
|-----------------|------|-----------|
| Concurrent (with ceiling jet) | 0.5–3.0 ft/min (2.5–15 mm/s) pre-flashover, accelerating toward flashover | Hot gases preheat surface ahead of flame front; radiant feedback from hot gas layer amplifies |
| Along wall-ceiling junction | 1.5× to 2.0× the open-ceiling rate | Corner/edge geometry traps radiant heat; reduced entrainment of cool air concentrates energy |
| Lateral (perpendicular to jet) | 0.2–1.0 ft/min (1–5 mm/s) | Weaker preheating; spread driven primarily by direct radiant exposure from adjacent flames |
| Post-flashover (all directions) | Effectively instantaneous | All exposed surfaces above ignition temperature simultaneously; full room involvement |

### 3.3 Corner Origin Fire Geometry

A fire originating in a corner has significantly enhanced spread characteristics compared to a room-centre fire:

- **Corner fire plume:** Two adjacent walls create a virtual fire that is effectively 4× the HRR of the same fire in open air (due to mirror-image reflections in both walls). This dramatically increases ceiling jet temperatures near the origin.

- **Initial spread shape:** Quarter-circle expanding from the corner, with faster spread along the two wall-ceiling junctions than across the open ceiling.

- **Edge-led pattern:** The flame front along each wall races ahead of the interior ceiling spread, creating a characteristic "fingers along the edges" pattern before the interior fills in.

### 3.4 Simplified Spread Model for Simulation

Model the burning area on the ceiling as a set of discrete cells (grid). Each cell has a state: **unignited**, **preheating**, **burning**, **suppressed** (wet), or **extinguished** (fuel consumed). At each simulation tick:

1. Compute the total HRR from all burning cells.
2. For each unignited cell, accumulate heat exposure from: (a) ceiling jet temperature at that distance (Alpert), (b) radiant view factor from adjacent burning cells, (c) edge multiplier if cell is at a wall junction.
3. When a cell's accumulated heat exposure exceeds its ignition threshold, transition it to burning.
4. Each burning cell contributes to the total HRR (feedback loop: more burning area → higher HRR → hotter ceiling jet → faster spread).

**Ignition threshold:** A ceiling material cell ignites when its accumulated heat exposure reaches approximately 15–25 kJ (equivalent to surface temperature reaching 300–400°C for typical materials). Cells at wall-ceiling junctions use a 0.6× threshold multiplier.

---

## 4. Ventilation and Airflow Effects

### 4.1 Burning Regime Transitions

The fire operates in one of two regimes, determined by the relationship between oxygen demand and oxygen supply:

| Regime | Condition | Effect on Simulation |
|--------|-----------|---------------------|
| Fuel-controlled | Oxygen supply exceeds fire demand. Occurs during early growth or in well-ventilated rooms. | HRR follows the t² curve unconstrained. Opening/closing vents has minimal effect on fire growth. |
| Ventilation-controlled | Fire demand exceeds oxygen supply. Typical after growth phase in enclosed rooms. | HRR capped by available ventilation. Opening a door/window causes rapid HRR increase. Closing a door reduces HRR, may prevent flashover. |

### 4.2 Oxygen Depletion Model

A simplified two-zone model tracks the upper (hot) and lower (cool) gas layers. Key parameters:

- Ambient O₂ concentration: 20.9%
- Flaming combustion ceases below: ~15% O₂
- O₂ consumption rate: approximately 1.1 kg O₂ per 13.1 MJ of energy released (stoichiometric for typical organic fuels)
- Room air volume: 10 × 20 × 8 = 1,600 ft³ (45.3 m³), containing approximately 57.8 kg of air and 12.4 kg of O₂

In a fully sealed room, a 500 kW fire would deplete available oxygen from 20.9% to 15% in approximately 5–7 minutes. In practice, no room is perfectly sealed; leakage sustains a smouldering fire and accumulates hot, fuel-rich gases.

### 4.3 Vent Openings and Flow Path

When a door or window opens, a bidirectional flow establishes at the opening: hot gas exits through the upper portion, fresh air enters through the lower portion. The air inflow rate through a full-height opening is approximately:

```
m_air = 0.5 · A_v · √H_v    [kg/s]
```

where A_v = opening area (m²), H_v = opening height (m). For a standard door, this is approximately 1.36 kg/s of air.

#### 4.3.1 Ventilation Scenarios

| Scenario | Vent Config | Fire Behaviour |
|----------|-------------|----------------|
| Room sealed | No openings or negligible leakage | Fire self-limits within 3–6 min. No flashover. Room fills with hot, unburnt gases. |
| Single door open | 0.9 m × 2.1 m doorway | Fuel-controlled growth to flashover in 3–5 min. Post-flashover HRR ≈ 4.2 MW. Flames extend out doorway. |
| Door + window | Door + 1.0 m × 1.5 m window | Through-ventilation creates strong flow path. Accelerated growth. Dominant flame spread direction follows airflow path from inlet to outlet. |
| Window breaks during fire | Sudden vent change | Rapid transition: fire surges as fresh O₂ reaches hot gases. Potential for flashover within seconds of vent change. |

### 4.4 Wind and Airflow Direction

When ventilation creates a directional airflow across the ceiling, flame spread is strongly asymmetric:

- **Concurrent spread (with airflow):** 2–5× faster than still-air rate. Hot gases preheat surfaces far ahead of the flame front. This is the dominant hazard direction.

- **Opposed spread (against airflow):** 0.3–0.5× the still-air rate. Incoming air cools the surface ahead of the flame. Flames may stall or retreat if airflow is strong enough.

- **Lateral spread (crosswind):** Approximately still-air rates, with slight deflection toward the leeward side.

For the simulation, apply a directional multiplier to the base spread rate based on the angle between the cell's direction from the fire front and the dominant airflow vector.

---

## 5. Hose Suppression Model

### 5.1 Hose and Nozzle Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Hose size | 1¾ inch (45 mm) | Standard interior attack handline |
| Flow rate | 150–185 GPM (570–700 L/min) | Typical nozzle setting for interior operations |
| Nozzle pressure | 50–100 psi (3.5–7 bar) | Combination (fog) or smooth-bore nozzle |
| Effective reach | 15–25 ft (4.5–7.5 m) direct stream | Reduced in smoke/heat conditions |
| Stream diameter at target | ~2–4 ft (0.6–1.2 m) coverage area | Varies with nozzle pattern and distance |
| Nozzle reaction force | 60–75 lbs (270–335 N) | Affects player mobility while flowing |

### 5.2 Water Cooling Capacity

Water absorbs approximately 8,000 BTU per gallon (2.6 MJ/L) when converting from liquid to steam at 100°C. A 150 GPM stream therefore has a theoretical cooling capacity of approximately 1,200,000 BTU/min (21 MW). This massively exceeds the fire's HRR, which is why direct water application produces near-instant knockdown.

However, only a fraction of the water effectively contacts the burning surface. Typical application efficiency is 30–60% depending on stream type, distance, and technique. At 40% efficiency, a 150 GPM stream delivers approximately 8.4 MW of cooling — still well above any single-room fire.

### 5.3 Critical Application Rate

The critical application rate (CAR) is the minimum water flux density needed to control a fire on a given surface. Values from FM Global and NFPA research:

| Material/Scenario | CAR (GPM/ft²) | CAR (mm/min) | Notes |
|-------------------|---------------|-------------|-------|
| Light hazard (office, residential) | 0.10 | 4 | Standard sprinkler design density |
| Ordinary hazard (mixed combustibles) | 0.15–0.20 | 6–8 | Moderate fuel loads |
| Extra hazard (high-piled storage) | 0.25–0.60 | 10–25 | Dense combustible storage |
| Direct hose stream on ceiling | Massively exceeds CAR | — | 150 GPM concentrated on ~4 ft² = ~37 GPM/ft² |

A direct hose stream delivers approximately **37 GPM/ft²** to the impact area, which is roughly 250× the critical rate for ordinary hazards. This is why knockdown at the point of contact is essentially instantaneous.

### 5.4 Knockdown and Extinguishment Timing

#### 5.4.1 Critical Flow Rate for Room

The critical flow rate (CFR) for a fully involved compartment is the minimum GPM that must be applied to achieve net cooling. For a room of 500 ft² at 8 ft ceiling height with typical fuel loads, research shows a CFR of approximately 130–170 GPM. Below this, the fire cannot be darkened regardless of application duration. Above it, knockdown time drops dramatically:

| Applied GPM | Knockdown Time | Water Used | Outcome |
|-------------|---------------|------------|---------|
| < 130 GPM | Never | Unlimited | Fire cannot be controlled; continues growing |
| 160 GPM | ~5 minutes | ~800 gallons | Just above CFR; slow, struggling knockdown |
| 200 GPM | ~15–30 seconds | ~50–75 gallons | Clean knockdown; effective attack |
| 300 GPM | ~3–5 seconds | ~15–25 gallons | Rapid dominance; overwhelming application |

#### 5.4.2 Per-Cell Suppression Model

For the grid-based simulation, each ceiling cell targeted by the hose stream should track:

1. **Water accumulated:** Total water applied to this cell (gallons or litres)
2. **Flame knockdown threshold:** Approximately 0.5–1.0 seconds of direct stream contact (~1.2–2.5 gallons at 150 GPM). Flames cease at this point.
3. **Saturation threshold:** Approximately 2–3 seconds of dwell time (~5–8 gallons at 150 GPM). Surface is cooled below ignition temperature and sufficiently wetted to resist reignition.

### 5.5 Reignition Mechanics

This is the core tension in the gameplay loop. Whether a knocked-down cell reignites depends on two factors:

#### 5.5.1 Surface Saturation State

| State | Condition | Reignition? |
|-------|-----------|------------|
| Flame knocked down, not saturated | Water contact < 2 seconds. Surface cooled briefly but not soaked. | **YES** — Will reignite if exposed to sufficient heat flux from adjacent burning cells or hot gas layer. Reignition time: 5–15 seconds. |
| Saturated (wet) | Water contact ≥ 2–3 seconds. Surface soaked, temperature well below ignition. | **NO** — Remains suppressed even with nearby fire. Water must evaporate before surface can re-approach ignition temperature. |
| Dried out (extended scenario) | Saturated cell that has been exposed to sustained radiant heat for > 60–90 seconds without re-wetting. | **YES** — In prolonged scenarios, evaporation can dry out a cell. Re-application needed. (Optional mechanic for harder difficulty.) |

#### 5.5.2 Hot Gas Layer Temperature

The hot gas layer (upper layer in the two-zone model) acts as a global reignition driver. If the upper layer temperature exceeds approximately 500–600°C, it provides sufficient radiant heat flux (≥20 kW/m²) to reignite any unsaturated surface. This is why real firefighting technique involves "penciling the ceiling" — short bursts into the overhead gas layer to cool it — before or during the main attack on the burning surfaces.

**Simulation implementation:** Track a global `upper_layer_temperature` value. Cooling it requires water application to the gas layer (overhead bursts), not just surface application. Each gallon of water evaporated in the hot gas layer absorbs approximately 8,000 BTU and reduces the layer temperature. The layer also cools through radiation to walls and convective flow out openings.

### 5.6 Ceiling Gas Layer Cooling (Penciling)

Short, upward bursts of water into the smoke layer convert to steam and rapidly cool the gas. Model this as:

```
dT_layer = −(m_water · 2.6 MJ/kg) / (m_layer · c_p)
```

where `m_water` is the mass of water evaporated in the layer per tick, `m_layer` is the mass of the upper gas layer, and `c_p` is the specific heat of the gas mixture (~1.0 kJ/kg·K). A 1-second burst at 150 GPM into a hot gas layer (~200 kg of gas at 600°C) drops the layer temperature by approximately 7–10°C per burst. Multiple rapid bursts can meaningfully reduce the layer temperature.

---

## 6. Integrated Simulation Loop

### 6.1 Per-Tick Update Order

Each simulation tick (recommended: 100–200 ms real-time, representing 0.5–1.0 seconds of simulation time):

1. Sum HRR from all burning cells → total Q
2. Update O₂ level based on Q and current ventilation
3. If O₂ < 15%, suppress all flaming (transition to smouldering); if vent opens, allow re-ignition of smouldering cells
4. Compute ceiling jet temperature/velocity at each unignited cell using Alpert correlations with current Q
5. Accumulate heat on each unignited cell; transition to burning if threshold reached
6. Apply hose stream: identify targeted cells, apply water per 5.4.2
7. Check reignition: for each knocked-down-but-not-saturated cell adjacent to burning cells or under hot gas layer > 500°C, apply reignition probability
8. Update upper layer temperature: heat input from fire, cooling from water, cooling from ventilation outflow
9. Check win/lose conditions

### 6.2 Suggested Grid Resolution

For a 10 ft × 20 ft ceiling, a 6-inch grid gives 20 × 40 = 800 cells. This is coarse enough for real-time performance but fine enough to show realistic spread patterns. Each cell is 0.25 ft² (0.023 m²). A burning cell contributes approximately 2.5–6.5 kW to total HRR (yields 2–5 MW at full ceiling involvement).

### 6.3 Win/Lose Conditions

| Condition | Trigger | Description |
|-----------|---------|-------------|
| Win | All cells extinguished or saturated; no burning cells remain | Player has fully suppressed the fire |
| Lose (flashover) | Upper layer temperature > 600°C for > 5 seconds | Room has flashed over; untenable for firefighter |
| Lose (oxygen) | O₂ < 12% in lower layer | Atmosphere no longer supports human life |
| Partial win | Fire contained to < 25% of ceiling for > 30 seconds | Fire controlled but not fully extinguished |

---

## 7. Quick Reference: Key Constants

| Parameter | Value | Unit |
|-----------|-------|------|
| Room dimensions | 10 × 20 × 8 | ft |
| Room volume | 1,600 / 45.3 | ft³ / m³ |
| Ceiling area | 200 / 18.6 | ft² / m² |
| Ceiling height (H) | 8 / 2.44 | ft / m |
| t² growth coefficient (α) | 0.047 | kW/s² (fast) |
| Time to 1 MW | 146 | seconds |
| Time to flashover (approx) | 180–300 | seconds |
| Flashover threshold (gas layer) | 500–600 | °C |
| O₂ floor for flaming | 15 | % |
| Hose flow rate | 150–185 | GPM |
| Water cooling capacity | ~8,000 BTU/gal (2.6 MJ/L) | — |
| Critical application rate (ordinary) | 0.10–0.15 | GPM/ft² |
| Knockdown dwell time | 0.5–1.0 | seconds |
| Saturation dwell time | 2–3 | seconds |
| Reignition window (unsaturated) | 5–15 | seconds |
| Max ventilation-limited HRR (std door) | ~4,200 | kW |

---

## 8. Sources and Further Reading

The values and correlations in this spec are derived from the following fire engineering references. These can be consulted for deeper modelling if needed:

- **SFPE Handbook of Fire Protection Engineering, 5th/6th Edition** — Chapters on ceiling jets, flame spread, heat release rates, and compartment fire dynamics
- **Alpert, R.L. (1972/2011)** — Ceiling jet temperature and velocity correlations (Fire Technology, FMRC reports)
- **UL FSRI (Fire Safety Research Institute)** — Full-scale residential fire studies on ventilation impact, fire flow requirements, and suppression tactics
- **FM Global Data Sheets (DS 3-0, DS 3-26)** — Water supply, sprinkler design densities, and critical application rates for various hazard classifications
- **NIST (National Institute of Standards and Technology)** — NISTIR reports on calculating flame spread, fire plume dynamics, and zone models (CFAST)
- **NFPA 92B / NFPA 72 / NFPA 13** — t-squared fire growth parameters, detector/sprinkler design criteria
- **Fire Engineering magazine** — Critical flow rate research, fire flow studies, and operational suppression data
- **Drysdale, D. (1999)** — An Introduction to Fire Dynamics, 2nd ed. (Wiley) — Flame spread theory, ignition, and compartment fire behaviour
