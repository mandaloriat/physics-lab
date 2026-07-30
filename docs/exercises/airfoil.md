# Exercise 1 — Airfoil design

**Status:** level 1 **built and live** — solver in `physics_lab/solvers/`, page in
`frontend/experiments/airfoil/`, verified by `tests/test_panel_method.py`,
`tests/test_airfoil_solver.py` and `e2e/airfoil.spec.mjs`. Level 2 (§13) is specification only.
Where implementation contradicted this document, the document was corrected and the correction is
marked in place rather than quietly applied.
**Implements:** [the exercise contract](../exercise-contract.md).
**Replaces:** the *Wind tunnel* page's "how does the flow field change as you increase the
camber?" framing.

---

## 0. The decision this specification makes

The page must produce a lift coefficient, and the model it runs today cannot: potential flow
with no Kutta condition has no circulation, so integrating its pressure field gives exactly
zero lift at every incidence. Adding *C<sub>L</sub>*, *C<sub>D</sub>* and *L*/*D* to that page
would print numbers the equations do not support.

There are two ways out, and this specification chooses the first:

| | **Level 1 — ideal flow with Kutta condition** | **Level 2 — viscous performance** |
|---|---|---|
| Produces | *C<sub>p</sub>*, *C<sub>L</sub>*, *C<sub>m</sub>*, *x<sub>cp</sub>*, *x<sub>ac</sub>*, *L*′ | the above, plus *C<sub>D</sub>*, *L*/*D*, a polar, separation onset |
| Cost | milliseconds | seconds to minutes |
| Verifiable against | exact cylinder and Kármán–Trefftz solutions, thin-airfoil theory | wind-tunnel data only |
| Ships | **first** | later, on the same page |

Level 1 first, with the interface designed to host both. The reasons, in order:

1. **It is verifiable to the last digit.** Two exact solutions (a circular cylinder with
   circulation, a conformally mapped profile) and one asymptotic theory (thin airfoil) bracket
   the answer — and the measured agreement is 0.05 % on the case that matters (§8.2). A viscous model has no closed form to check against — its verification is
   correlation with experiment, which is a much weaker claim for a lab whose whole argument is
   that the numbers can be checked.
2. **The Kutta condition is precisely the missing physics.** It is what selects the
   circulation that makes lift exist in an ideal flow, and it is a one-equation addition to a
   model the lab already runs — not a different discipline.
   ([NASA — conformal mapping and the Kutta condition](https://www.grc.nasa.gov/www/k-12/airplane/map.html).)
3. **It fits the public-demo budget.** A panel solve is a few milliseconds, and an
   incidence sweep is nearly free (§7.3) — where a viscous solve would spend the hourly job
   quota of [ADR-010](../architecture-decisions.md#adr-010--public-demo-limits-and-what-they-do-not-cover)
   on a handful of visitors.
4. **It does not pretend.** Level 1 refuses to display drag or efficiency, and says why. A
   page that showed *L*/*D* from a model with *C<sub>D</sub>* = 0 would be worse than one that
   shows neither.

**The solver is not FEniCSx, and does not need to be.** Fenix Spoon's adapter contract takes
any Python solver with typed parameters, so the reference implementation is a **panel method**
in NumPy — which is both faster and *more accurate at the surface* than a Laplace solve on a
mesh, because the boundary is represented exactly rather than approximated by elements. A
FEniCSx variant is specified in §6.2 as an optional cross-check, not as the primary path.

---

## 1. Problem

> Choose a NACA profile and an angle of attack that generate **800 N/m of sectional lift** at
> 40 m/s and sea level, keeping **|*C<sub>m,c/4</sub>*| < 0.08**, without leaving the model's
> domain of validity.

Pass conditions, as the page checks them:

| Target | Condition |
|---|---|
| *L*′ | within ±2 % of 800 N/m |
| \|*C<sub>m,c/4</sub>*\| | < 0.08 |
| Validity | no warnings raised (§9) |
| Verification | circulation-vs-pressure consistency below 2 % (§8.4) |

The constraint is what makes it an exercise rather than a slider hunt. At *c* = 1 m, 40 m/s
and sea level the required *C<sub>L</sub>* is 0.816, which every catalogue profile can reach —
but not all of them legally. These are the solver's own answers, not estimates:

| Profile | *α* for 800 N/m | *C<sub>m,c/4</sub>* | Moment constraint | *C<sub>p,min</sub>* |
|---|---|---|---|---|
| NACA 0009 | 6.92° | −0.006 | passes | **−4.77** |
| NACA 0012 | 6.76° | −0.009 | passes | −3.30 |
| NACA 1412 | 5.69° | −0.035 | passes | −2.41 |
| NACA 2312 | 4.76° | −0.052 | passes | −1.66 |
| NACA 2412 | 4.61° | −0.061 | passes | −1.72 |
| NACA 2415 | 4.44° | −0.064 | passes | −1.55 |
| NACA 4412 | 2.47° | −0.113 | **fails** | −1.06 |
| NACA 4415 | 2.28° | −0.115 | **fails** | −1.17 |

There is no profile that wins on everything, which is the point. Camber buys the lift at low
incidence and pays for it in pitching moment: the 4412 needs only 2.5° and is disqualified by
the moment constraint. A symmetric section has no moment to speak of and pays instead in
incidence and in suction — the 0009 reaches the target only at 6.9°, with a *C<sub>p,min</sub>*
of −4.8 that a real boundary layer would not survive, and which this model cannot warn about
except by reporting the number. The run table is where that trade becomes visible.

Two further challenges reuse the same machinery and are worth shipping as alternatives:

- *Same lift, minimum suction peak* — hit 800 N/m with the least negative *C<sub>p,min</sub>*.
  The table above says the answer is a moderately cambered, thicker section, and the reasoning
  is exactly the reasoning level 2 will later be able to check.
- *Locate the aerodynamic centre* — from an incidence sweep, report *x<sub>ac</sub>*/*c* and
  compare with the thin-airfoil value of 0.25. (The solver finds 0.262 for a 2412: thickness
  moves it aft, and the sweep's *R*² of 0.9997 says the fit is entitled to three digits.)

---

## 2. Model — level 1

Steady, two-dimensional, incompressible, inviscid, irrotational flow about a closed profile,
with the Kutta condition enforced at the trailing edge.

$$\nabla^2\phi = 0,\qquad \mathbf v = \nabla\phi,\qquad
p + \tfrac12\rho|\mathbf v|^2 = p_\infty + \tfrac12\rho U_\infty^2$$

- **Unknown:** the velocity potential *φ* (equivalently the streamfunction *ψ*), plus one
  scalar — the circulation Γ — fixed by the Kutta condition.
- **Domain:** the whole plane outside the profile. The panel formulation has no outer
  boundary: the far field is satisfied analytically, so there is no domain-truncation error
  to converge (this is the one respect in which it is strictly better than a mesh solve).
- **Frame:** body axes. The chord lies along *x*, the leading edge at the origin, the trailing
  edge at (*c*, 0). Incidence is the direction of the free stream, **not** a rotation of the
  profile — see §5.1 for why this is a change from the current page.
- **Material:** air as a constant-density, constant-viscosity fluid, its properties set by
  ISA altitude or entered directly (§5.3). Density affects only the dimensional outputs
  (*L*′, pressures); every coefficient is independent of it.
- **Units:** SI throughout. Angles in degrees at the interface, radians internally.
- **Temperature is an input, never a field.** The model is isothermal and solves no energy
  equation, so a temperature field would be a picture of nothing. *T*<sub>∞</sub> enters only
  through *ρ*, *μ* and the speed of sound.

### What the model can and cannot produce

| Quantity | Level 1 | Why |
|---|---|---|
| *C<sub>p</sub>*, *C<sub>L</sub>*, *C<sub>m</sub>*, *x<sub>cp</sub>*, *x<sub>ac</sub>*, *L*′, Γ | **yes** | Circulation exists once the Kutta condition is imposed; Kutta–Joukowski and the pressure integral then agree. |
| *C<sub>D</sub>* | **no** | Inviscid and attached: d'Alembert's paradox makes the pressure drag identically zero, and there is no wall shear to add. Any non-zero value would be discretisation error. |
| *L*/*D* | **no** | A ratio whose denominator is zero is not a metric. |
| *C<sub>L,max</sub>*, stall, *α*<sub>stall</sub> | **no** | Stall is boundary-layer separation. There is no boundary layer. Lift here grows linearly with incidence forever. |
| Boundary layer, transition, *C<sub>f</sub>* | **no** | No viscosity in the equations. |
| Compressibility, shocks | **no** | Incompressible. Warned above M = 0.3 (§9). |

The page states this as a table, in the same place it states the metrics, so what is missing
is as visible as what is present.

### The no-circulation case is kept, on purpose

**Kutta condition: `enforced` (default) | `none`** is a *model* selector, in the model panel,
not a numerical setting. Setting it to `none` reproduces exactly the model the current page
runs — and reports *C<sub>L</sub>* ≈ 0, which is the cleanest demonstration in the whole lab
that circulation *is* lift, and simultaneously a verification of d'Alembert's paradox on the
discrete solution (§8.5). The challenge cannot be attempted with Kutta off: the run is marked
invalid for it.

---

## 3. Boundary conditions

Written, and marked on the geometry diagram at the boundary they apply to.

| Boundary | Condition | Meaning |
|---|---|---|
| Profile surface | **v · n** = 0 (flow tangency) | Solid, impermeable, frictionless wall. Enforced at each panel's control point. |
| Trailing edge | **Kutta:** the flow leaves the trailing edge smoothly — equal tangential speed on the two surfaces at the trailing-edge panels, and no pressure jump across it | The one condition that selects Γ. Without it the problem has a one-parameter family of solutions, of which the zero-lift one is no more correct than any other. |
| Far field | **v** → *U*<sub>∞</sub>(cos *α*, sin *α*) as \|**r**\| → ∞ | Satisfied exactly by the panel formulation. In the FEniCSx variant it becomes a Dirichlet condition on a truncated outer boundary — a numerical setting with a real error (§6.2). |
| Wake | No wake sheet; the bound circulation is the whole vortical content | Steady, so a starting vortex has convected to infinity. Downstream of the profile the model is inviscid and irrotational — no deficit, no separation. |

**Initial conditions: none.** The problem is steady, and a steady solve has no state at
*t* = 0. This section says so explicitly and stops, rather than inventing one to be
symmetrical with the transient exercises.

---

## 4. Geometry

### 4.1 The catalogue

The current implementation generates four-digit profiles but holds the maximum-camber position
fixed at *p* = 0.4, so `camber 2 %, thickness 12 %` is a NACA 2412 and a NACA 2312 cannot be
expressed at all. The catalogue starts from real profiles with all three parameters, and the
sliders are what you reach for *after* picking one:

| Profile | *m* | *p* | *t* | *α*<sub>L=0</sub> (thin airfoil) | *C<sub>m,c/4</sub>* (thin airfoil) |
|---|---|---|---|---|---|
| NACA 0009 | 0.00 | — | 0.09 | 0.00° | 0.0000 |
| NACA 0012 | 0.00 | — | 0.12 | 0.00° | 0.0000 |
| NACA 1408 | 0.01 | 0.4 | 0.08 | −1.04° | −0.0266 |
| NACA 1412 | 0.01 | 0.4 | 0.12 | −1.04° | −0.0266 |
| NACA 2312 | 0.02 | 0.3 | 0.12 | −1.92° | −0.0447 |
| NACA 2412 | 0.02 | 0.4 | 0.12 | −2.08° | −0.0531 |
| NACA 2415 | 0.02 | 0.4 | 0.15 | −2.08° | −0.0531 |
| NACA 2512 | 0.02 | 0.5 | 0.12 | −2.29° | −0.0628 |
| NACA 4412 | 0.04 | 0.4 | 0.12 | −4.15° | −0.1062 |
| NACA 4415 | 0.04 | 0.4 | 0.15 | −4.15° | −0.1062 |

Both reference columns are properties of the mean line only, so they are identical down a
thickness family — which is itself worth seeing, and is a check on the implementation.
(NACA 2412's −2.08° and −0.053 sit against measured values of about −2.1° and −0.05; these
are the numbers §8.3 compares against, and the tolerance there accounts for thickness, which
thin-airfoil theory ignores.)

Three geometry modes, in one selector:

1. **Catalogue** — a named profile from the table. `label` in the run row is the name.
2. **Parametric** — *m*, *p*, *t* sliders, seeded from the catalogue entry. `label` becomes
   the derived designation where the digits are integral (`NACA 2412`), and
   `NACA m=0.025 p=0.40 t=0.12` where they are not.
3. **Custom** — the outline after a control point has been dragged. `label` is `Custom`, and
   the run row carries the outline hash and vertex count instead of parameters. A custom
   outline is a legitimate first-class input, not a degraded mode: its chord line, incidence
   and camber line are all extracted from the geometry itself (§4.3), so every metric remains
   defined.

### 4.2 Trailing edge

The four-digit thickness polynomial with the standard coefficient (−0.1015) leaves a finite
trailing-edge thickness of about 0.25 % of chord; the closed variant (−0.1036) brings it to
zero. This matters here in a way it did not before, because the Kutta condition is applied
*at* the trailing edge:

- **`closed` (default)** — the closed coefficient, a single trailing-edge vertex, a sharp
  wedge of finite included angle. The Kutta condition is unambiguous. A single vertex, not two
  coincident ones — `Polygon2D` rejects duplicate consecutive points, which is what the
  current code's comment about a "pinched tip" is describing.
- **`as drawn`** — keeps whatever gap the outline has. The base is closed by one panel and
  Kutta is applied as equal pressure on the two adjoining panels. Correct, but the answer now
  depends on the base treatment, so a gap above 0.2 % of chord raises a validity warning.

### 4.3 What the solver derives from the outline

The solver receives a polygon, not a set of parameters, so that the custom mode is not a
second code path. From the outline it derives:

- **trailing edge** — the vertex (or gap midpoint) of maximum *x* in the outline's own frame;
- **leading edge** — the outline point at maximum distance from the trailing edge;
- **chord line and chord** *c* = |TE − LE|, in metres, which fixes *x*/*c* for the surface
  curves;
- **incidence** *α* — the angle between the chord line and the free-stream direction, reported
  back so that a custom outline has a meaningful incidence and a catalogue profile's reported
  *α* can be checked against the one requested. The two are *not* identical, and the difference
  is real rather than an error: the nose point of a cambered outline sits slightly above the
  mean line's origin, so the longest-diagonal chord of a NACA 2412 is tilted about 0.13° from
  the chord the generating formula uses. The run row therefore carries `alpha_requested_deg`,
  `chord_angle_deg` and the derived `alpha_deg`, and the thin-airfoil reference is computed in
  the *same* frame, so the tilt cancels in every comparison that matters;
- **camber line and thickness distribution** — by intersecting chord-normal lines with the two
  surfaces, which is what §8.3 needs to compare a custom shape against thin-airfoil theory.

### 4.4 Outline fidelity

`<fs-geometry-2d>` samples a closed centripetal Catmull-Rom spline through the control points,
`samples` per segment (default 8). With 13 control points that is ~104 vertices, which is a
visibly polygonal nose for a panel solve. The page sets `samples` so the submitted outline
carries **at least 200 vertices**, and the solver resamples that outline onto its panel
distribution (§7.1). The vertex count goes in the run row: it is part of what determines the
answer.

The verification suite does **not** go through the widget. It builds outlines analytically at
high density, so a spline-sampling error can never be mistaken for a solver error.

---

## 5. Physical inputs

Everything in this section describes the situation. Nothing in it changes the accuracy of the
answer. All of it is stored in the run row in SI.

| Input | Symbol | Unit | Range | Default |
|---|---|---|---|---|
| Profile | — | — | catalogue / parametric / custom | NACA 2412 |
| Chord | *c* | m | 0.05 … 5 | 1.0 |
| Angle of attack | *α* | ° | −12 … 16 | 4 |
| Free-stream speed | *U*<sub>∞</sub> | m/s | 1 … 100 | 40 |
| Atmosphere | — | — | ISA altitude / manual | ISA, 0 m |
| ISA altitude | *h* | m | 0 … 15 000 | 0 |
| Density (manual) | *ρ* | kg/m³ | 0.05 … 2 | 1.225 |
| Dynamic viscosity (manual) | *μ* | Pa·s | 1e−6 … 5e−5 | 1.789e−5 |
| Speed of sound (manual) | *a* | m/s | 100 … 400 | 340.3 |

**Span is not an input.** A span would imply a finite wing, and a finite wing has downwash,
induced drag and a spanwise loading this model does not compute. The output is per unit span
(*L*′ in N/m) and the page says so. Span becomes an input the day a 3-D or lifting-line model
exists, and not before.

### 5.1 Incidence is the stream direction, not a rotated profile

The current page rotates the profile about the quarter chord and keeps the free stream along
*x*. This specification inverts that: the profile stays in body axes and the free stream
arrives at *α*. Four consequences, all of them wanted:

- *x*/*c* on the surface curves is exact and needs no un-rotation;
- the outline hash is independent of incidence, so every run of an incidence sweep shares one
  geometry in the run table;
- an incidence sweep is one job, because only the right-hand side changes (§7.3);
- for the catalogue profiles the submitted geometry *is* the NACA definition, digit for digit.

The cost is that the picture shows an inclined stream rather than an inclined airfoil. That is
the convention every section-aerodynamics plot uses, and the diagram labels it.

### 5.2 Derived, shown next to the inputs

*q*<sub>∞</sub> = ½*ρU*<sub>∞</sub>² · Re = *ρU*<sub>∞</sub>*c*/*μ* · M = *U*<sub>∞</sub>/*a*

Re and M are shown as inputs' consequences, not as metrics: at level 1 nothing depends on
them. They exist so that runs are comparable and so §9 can say when the model has been left
behind. That Re appears and does nothing is itself the honest statement about this model.

### 5.3 ISA atmosphere

Altitude sets *T*<sub>∞</sub>, *p*<sub>∞</sub>, *ρ*<sub>∞</sub>, *μ* and *a*, so that "sea
level" and "10 000 m" are one control instead of four
([NASA — standard atmosphere](https://www.grc.nasa.gov/WWW/K-12/BGP/atmos.html)).
Troposphere (*h* ≤ 11 km), with *T*<sub>0</sub> = 288.15 K, *p*<sub>0</sub> = 101 325 Pa,
*L* = 0.0065 K/m, *R* = 287.05287 J/(kg·K), *g* = 9.80665 m/s², *γ* = 1.4:

$$T = T_0 - Lh,\qquad p = p_0\left(\frac{T}{T_0}\right)^{g/(LR)},\qquad
\rho = \frac{p}{RT},\qquad a = \sqrt{\gamma R T}$$

with the exponent *g*/(*LR*) = 5.25588. Above 11 km, *T* = 216.65 K and
*p* = *p*<sub>11</sub> exp[−*g*(*h*−11 000)/(*RT*)] with *p*<sub>11</sub> = 22 632 Pa.
Viscosity from Sutherland's law, *μ*<sub>ref</sub> = 1.716e−5 Pa·s at 273.15 K, *S* = 110.4 K:

$$\mu = \mu_\text{ref}\left(\frac{T}{273.15}\right)^{3/2}\frac{273.15 + S}{T + S}$$

Reference values the implementation is tested against:

| *h* (m) | *T* (K) | *p* (Pa) | *ρ* (kg/m³) | *μ* (Pa·s) | *a* (m/s) |
|---|---|---|---|---|---|
| 0 | 288.15 | 101 325 | 1.2250 | 1.7893e−5 | 340.29 |
| 1 000 | 281.65 | 89 875 | 1.1116 | 1.7578e−5 | 336.43 |
| 5 000 | 255.65 | 54 020 | 0.7361 | 1.6280e−5 | 320.53 |
| 11 000 | 216.65 | 22 632 | 0.3639 | 1.4215e−5 | 295.07 |
| 15 000 | 216.65 | 12 045 | 0.1937 | 1.4215e−5 | 295.07 |

Manual mode takes *ρ*, *μ* and *a* directly and reports "manual" in the run row. It exists
because a wind-tunnel comparison is done at the tunnel's conditions, not at an altitude.

---

## 6. Solvers

### 6.1 Reference implementation — `lab.airfoil_panel2d` (required)

A **Hess–Smith panel method**: constant-strength source panels plus one vortex strength common
to every panel, which is the classical formulation whose unknown count is exactly *N* + 1 and
whose closing equation is the Kutta condition.

- *N* + 1 unknowns: source strengths *q*<sub>1…N</sub> and one vortex strength *γ*.
- *N* equations: **v · n** = 0 at each panel's control point (midpoint).
- 1 equation: equal tangential speed at the control points of the two trailing-edge panels.
- Influence coefficients in closed form for a straight panel of constant source and vortex
  strength; a dense (*N*+1)² system solved by LU. At *N* = 160 that is microseconds.
- Circulation Γ = *γ* Σ Δ*s<sub>j</sub>*; surface speeds from the tangential velocity at each
  control point; *C<sub>p,i</sub>* = 1 − (*v<sub>t,i</sub>*/*U*<sub>∞</sub>)².
- Fields for the viewer: velocity, speed, *C<sub>p</sub>* and *ψ* evaluated on a sampling grid
  by superposition — a matrix-free sum over panels, one pass, and it costs less than the solve.
- Registered in `physics_lab/solvers/` per the existing note there. Pure NumPy, so it is
  available in the slim image too: this exercise does not require a FEniCSx worker.

Placing it in the lab rather than upstream is the right call for now — it is an *exercise's*
solver, and the lab is where the exercise lives — but it is written against the public
`Solver` contract with nothing lab-specific in it, so moving it upstream later is a file move.

### 6.2 Optional cross-check — `lab.airfoil_kutta2d` (FEniCSx)

Worth specifying because the two-mode structure already exists on the page, and because
cross-validating a pair of independent implementations of the same physics is upstream's own
practice.

Streamfunction form on a truncated domain, with circulation recovered by superposition —
which works because the problem is linear in three separate ways:

1. solve ∇²*ψ*<sub>A</sub> = 0 with *ψ* = *U*<sub>∞</sub>*y* far field, *ψ* = 0 on the body;
2. solve ∇²*ψ*<sub>B</sub> = 0 with *ψ* = −*U*<sub>∞</sub>*x* far field, *ψ* = 0 on the body;
3. solve ∇²*ψ*<sub>Γ</sub> = 0 with *ψ* = 0 far field, *ψ* = 1 on the body;

then *ψ* = cos *α* *ψ*<sub>A</sub> + sin *α* *ψ*<sub>B</sub> + *λψ*<sub>Γ</sub>, and *λ* is
fixed by requiring the velocity to vanish at a finite-angle trailing edge — a condition
*linear* in *λ*, hence one scalar solve. Three Laplace solves then give **every** incidence,
which is what makes a sweep affordable here too.

Its honest disadvantages, which is why it is the cross-check and not the reference: the outer
boundary is at a finite distance, so blockage is a real error requiring its own convergence
study (§7.2); the surface is resolved by elements rather than exactly, so *C<sub>p</sub>* near
the nose is the worst-resolved quantity in the whole solve — exactly the quantity the exercise
reads.

**Agreement target:** *C<sub>L</sub>* from the two solvers within 1 % on NACA 2412 at 5°, with
the far field at 20 chords and `mesh_size` at its finest admissible value. This is a test, not
a page feature.

### 6.3 Parameter schema

```python
class Params(BaseModel):
    # physical
    alpha_deg: float = Field(default=4.0, ge=-20.0, le=20.0)
    u_inf: float = Field(default=40.0, gt=0.0, le=200.0)
    rho: float = Field(default=1.225, gt=0.0)
    mu: float = Field(default=1.789e-5, gt=0.0)
    sound_speed: float = Field(default=340.29, gt=0.0)
    kutta: Literal["enforced", "none"] = "enforced"
    # numerical
    panels: int = Field(default=240, ge=40, le=400)   # see 7.1
    trailing_edge: Literal["closed", "as_drawn"] = "closed"
    resolution: int = Field(default=192, ge=16, le=512)   # sampling grid for the field
    convergence_check: bool = True                        # also solve at 2N, report the delta
    # study
    sweep_from_deg: float | None = None
    sweep_to_deg: float | None = None
    sweep_step_deg: float = Field(default=2.0, gt=0.0)
    # output
    output: Literal["grid2d", "mesh2d"] = "grid2d"
    write_vtk: bool = False
```

Chord and altitude are *not* parameters: chord is the geometry's own scale, and altitude is
resolved to *ρ*, *μ* and *a* by the page before submitting, so the solver receives fluid
properties rather than a table lookup it would have to duplicate. The run row stores both the
altitude the visitor chose and the properties that were sent.

`buildParamForm` already renders whatever the schema publishes; the exercise's `app.js`
classifies each name as physical / numerical / study per
[the contract](../exercise-contract.md#1-the-nine-sections), and the three groups are rendered
separately.

---

## 7. Numerical settings and study

### 7.1 Panels

*N* panels, cosine-clustered towards the leading edge and the trailing edge, resampled from
the submitted outline. **Default 240**, chosen against the measured consistency residual of
§8.4 rather than by eye: at 160 panels that residual is 1.6 % against a 2 % tolerance, which
leaves no room, and at 240 it is 1.0 % at the worst incidence and 0.5 % at the interesting
ones. 40 is visibly coarse and 400 is past the point where anything moves. The *only* legitimate effect of this control is on the
verification residuals, and the page says so where it is rendered.

### 7.2 Domain truncation (FEniCSx variant only)

Far-field distance in chords (default 20, minimum 5) and `mesh_size`. Blockage falls off
roughly like the inverse square of the distance, so it must be *shown* to be converged rather
than assumed: the variant's verification includes *C<sub>L</sub>* at the chosen distance and at
twice it.

### 7.3 Study — a sweep is one job

For a panel method the influence matrix depends only on the geometry and the panelling, never
on incidence: **an incidence sweep is one LU factorisation and one back-substitution per
angle**. So a sweep is a parameter of a single job, not *n* jobs — which keeps a 15-point sweep
inside the same quota cost as a single solve
([ADR-010](../architecture-decisions.md#adr-010--public-demo-limits-and-what-they-do-not-cover)),
and is a decisive practical argument for this solver over any mesh-based one.

Sweep results: a table of (*α*, *C<sub>L</sub>*, *C<sub>m,c/4</sub>*, *x<sub>cp</sub>*/*c*) in
the result artifact, from which the page computes and plots:

- **d*C<sub>L</sub>*/d*α*** — least-squares slope over the sweep, in 1/rad and 1/°;
- ***α*<sub>L=0</sub>** — the sweep's zero-lift intercept, to compare with theory;
- ***x<sub>ac</sub>*/*c* = 0.25 − d*C<sub>m,c/4</sub>*/d*C<sub>L</sub>*** — the aerodynamic
  centre, from the regression slope of *C<sub>m,c/4</sub>* against *C<sub>L</sub>*, with the
  regression's *R*² reported beside it.

The field is returned for the primary incidence only; a sweep produces one picture and a
curve, not fifteen pictures.

**The aerodynamic centre is not available from a single run, and the page must not offer it
there.** The centre of pressure moves with the flight condition; the aerodynamic centre is the
point about which the moment does not, and estimating it needs several incidences. The metrics
table shows *x<sub>ac</sub>* as "requires a sweep" until one has been run.

---

## 8. Verification

Six checks: two exact solutions (§8.1, §8.2), one asymptotic band (§8.3), one internal
consistency (§8.4), one theorem (§8.5) and one convergence study (§8.6). Each is a *number* in
the result payload with a stated tolerance; the page shows residual, tolerance and a pass mark.
The last four run on every solve and are shown on the page; the first two are the test suite's
(§12), because they need geometries the exercise does not offer.

### 8.1 Circular cylinder with circulation (exact, unit test)

For a circle of radius *a* in a stream *U* with circulation Γ, the exact surface pressure is

$$C_p(\theta) = 1 - \left(2\sin\theta + \frac{\Gamma}{2\pi a U}\right)^2$$

and the exact lift is *L*′ = *ρU*Γ (Kutta–Joukowski). Run the panel solver on a polygonal
circle with Γ imposed, and require the *C<sub>p</sub>* error in the ∞-norm below 1 % at
*N* = 200. With Γ = 0 this is the familiar 1 − 4 sin²*θ*, and the integrated force must vanish
in both components.

### 8.2 Kármán–Trefftz and Joukowski (exact, unit test)

The conformal map *z* = *ζ* + *b*²/*ζ* takes a circle of radius *R* centred at *ζ*<sub>0</sub>
and passing through *ζ* = *b* to a profile with a sharp trailing edge at *z* = 2*b*. The Kutta
condition is a *stagnation point at ζ = b*, which gives the circulation in closed form,

$$\Gamma = 4\pi U R \sin(\alpha + \beta),\qquad \beta = -\arg(b - \zeta_0)$$

and hence *C<sub>L</sub>* = 2Γ/(*U*<sub>∞</sub>*c*) with *c* measured on the mapped profile.
This is the one exact solution for a *lifting body with a sharp trailing edge*, which makes it
the single most valuable test in the suite: it validates the Kutta implementation itself, not
merely the Laplace solve.

**With one correction the implementation forced, and it is worth recording.** A Joukowski
trailing edge is a **cusp** — the two surfaces arrive parallel — and that is the hardest
trailing edge a panel method can be given: the measured error falls only at first order, from
3.6 % at 100 panels to 1.4 % at 400. It never reaches 0.5 %, so the tolerance this section
originally asked for was unachievable against that geometry, and no amount of care in the
solver would have fixed it.

The **Kármán–Trefftz** map generalises Joukowski to a trailing edge that closes at a *finite*
included angle,

$$\frac{z - kb}{z + kb} = \left(\frac{\zeta - b}{\zeta + b}\right)^{k},\qquad k = 2 - \tau/\pi$$

and it is nearly free: the flow around the circle is unchanged, so the circulation is the same
closed form and only the map differs. It is also the *representative* case — every profile the
exercise offers has a finite wedge angle, about 16° for a 12 %-thick four-digit section — and
against it the panel method is exact to **0.0–0.6 %** at 200 panels (0.05 % at 5°, 0.00 % at
10°; the largest residual is at zero incidence, where *C<sub>L</sub>* itself is small).

So the suite requires:

- **Kármán–Trefftz, *τ* = 16°**, three thickness/camber combinations × *α* ∈ {0°, 5°, 10°}:
  *C<sub>L</sub>* within 0.5 % **or** 0.005 absolute, whichever is larger.
- **Joukowski cusp**, kept deliberately: the error must *fall* with panel count and be inside
  2 % by 400 panels. The test also asserts that it does **not** pass at 0.5 % — so if a future
  change makes it, the caveat in this section is stale and the test says so.

### 8.3 Thin-airfoil theory (asymptotic, page-visible)

With *x* = (*c*/2)(1 − cos *θ*) and d*z*/d*x* the mean-line slope:

$$\alpha_{L=0} = -\frac1\pi\int_0^\pi \frac{dz}{dx}(\cos\theta - 1)\,d\theta,\qquad
A_n = \frac2\pi\int_0^\pi \frac{dz}{dx}\cos n\theta \,d\theta$$
$$C_L = 2\pi(\alpha - \alpha_{L=0}),\qquad C_{m,c/4} = \frac\pi4 (A_2 - A_1)$$

Both are computed from the run's *own* camber line (extracted per §4.3, so it works for a
custom shape) and reported beside the solved values.

This is a **consistency band, not an equality**: thin-airfoil theory neglects thickness, and a
panel method correctly finds a lift-curve slope a few per cent above 2π for a 12 %-thick
section. So the tolerances are asymmetric and stated as such — d*C<sub>L</sub>*/d*α* expected
in [2π, 1.15 × 2π] for *t*/*c* ≤ 0.15, *α*<sub>L=0</sub> within 0.5°, *C<sub>m,c/4</sub>*
within 0.02 — and a run outside them is a warning about the *comparison*, not a failure of the
solve. Section 8.2 is where tight agreement is demanded.

### 8.4 Circulation vs integrated pressure (internal consistency, page-visible)

The headline check, because it needs nothing external and runs on every solve. Compute lift
twice:

- from circulation: *L*′ = *ρU*<sub>∞</sub>Γ;
- from pressure: *L*′ = the component of −∮*p***n** d*s* perpendicular to the free stream.

Report `cl_consistency_rel` = |Δ*C<sub>L</sub>*| / max(|*C<sub>L</sub>*|, 0.05). The two routes
share the solution but not the arithmetic, so panelling error, a sign convention mistake or a
misapplied Kutta condition breaks their agreement. Tolerance 2 %, and it is the residual the
challenge gates on. Measured 0.5 % at the default 240 panels, falling by half for each
doubling — the pressure route is the first-order one, because it integrates a C_p that varies
fastest exactly where the panels are shortest.

The circulation itself is taken from the **vortex strength**, `-gamma * perimeter`, not from
integrating the surface velocity: a source sheet carries no circulation and the vortex sheet
carries all of it, so that expression is exact for the discrete solution while the surface
integral is a midpoint approximation to it. Their difference is reported too, as
`circulation_consistency_rel`.

### 8.5 d'Alembert's paradox (theorem, page-visible)

The chordwise component of the integrated pressure force must be zero. The residual
`cd_pressure_spurious` is therefore **not a drag coefficient but an error bar** — and the page
labels it that way, in the row where a visitor would otherwise look for drag. Tolerance 0.002;
measured 1.6e−5 for a NACA 2412 at 5.4° and 240 panels.

With `kutta: none` the lift is zero identically — it is not integrated at all, it is
`-gamma * perimeter` with `gamma` fixed at zero — but the *pressure* residual for that model
does **not** converge, and the reason is the whole argument for the Kutta condition: with no
circulation the flow has to turn the sharp trailing edge, so the velocity there is unbounded.
The measured peak deepens without limit as panels are added — C_p of −13 at 80 panels, −42 at
160, −141 at 320 — so the pressure integral near it converges to nothing. The page reports
that as a warning naming the singularity rather than as a residual to be squinted at, and the
non-lifting model is excluded from the challenge for this reason as well as for its zero lift.

### 8.6 Convergence (page-visible)

With `convergence_check` on, the same geometry is also solved at 2*N* panels (cheap: one more
factorisation) and `cl_convergence_delta` = |*C<sub>L</sub>*(2*N*) − *C<sub>L</sub>*(*N*)| is
reported. Tolerance 0.5 %; measured 0.15 % for a NACA 2412 at 5.4° between 120 and 240 panels.
It is the weakest of the six on its own and the page says so — it shows the discretisation has
settled, not that it settled on the truth.

---

## 9. Validity, per run

| Warning | Condition | What it says |
|---|---|---|
| Compressible | M<sub>∞</sub> > 0.3 | The incompressible assumption is spent; real pressures would differ by more than the numbers on screen. |
| Local transonic | M<sub>∞</sub>√(1 − *C<sub>p,min</sub>*) > 0.7 | The suction peak implies a local Mach number near unity even at a modest free-stream Mach. An estimate from the incompressible speed, and stated as one. |
| Beyond the linear range | \|*α* − *α*<sub>L=0</sub>\| > 10° or *C<sub>L</sub>* > 1.4 | A real section at this incidence would very likely be separated. This model has no stall and will keep producing orderly lift. |
| Trailing-edge gap | gap/*c* > 0.002 with `as_drawn` | The Kutta condition depends on the base treatment; *C<sub>L</sub>* carries an extra uncertainty. |
| Unconverged | `cl_convergence_delta` > 0.5 % | Add panels before believing this number. |
| Inconsistent | `cl_consistency_rel` > 2 % | The two routes to lift disagree; the solve is suspect, not merely coarse. |
| Not a lifting model | `kutta: none` | Lift is zero by construction. Shown as a statement of the model, not a fault. |
| Thick or unusual outline | *t*/*c* > 0.25, or the camber-line extraction fails | Thin-airfoil comparison is unavailable and the panelling may be poorly conditioned. |
| Low Reynolds | Re < 1e5 | Reported only: nothing in this model depends on Re, and that is the point. A real section here behaves qualitatively differently. |

---

## 10. Outputs

### 10.1 Fields

| Field | Unit | Notes |
|---|---|---|
| `velocity` | m/s | Vector. Protocol 1.1 carries vector fields; the viewer draws them. |
| `speed` | m/s | Magnitude, alongside the vector for the reason upstream documents: the viewer colours by it every frame. |
| `Cp` | 1 | Computed by the solver now, not derived in the browser — the panel solve knows the exact surface value, and a grid-derived *C<sub>p</sub>* would disagree with the surface curve at the very place both matter. Diverging colormap centred on zero. |
**There is no `psi` field, and that is a change from this specification's first draft.** The
streamfunction of a *source* sheet is multivalued — its branch cut runs off along the panel's
own line — so evaluating the superposition panel by panel lays a visible seam across the
picture wherever a panel's line extension crosses the grid, and the seams cancel only if the
net source strength does, which it does not do pointwise. The velocity field carries the same
information without that hazard: protocol 1.1 puts vectors on the wire and the viewer draws
them, so streamline *direction* is not lost, only the scalar whose contours drew them.

No temperature field (§2). No vorticity field: it is identically zero, and a picture of
rounding error is not a result.

### 10.2 Curves

- ***C<sub>p</sub>*(*x*/*c*)**, upper and lower surfaces as two traces, *y* axis inverted per
  the aeronautical convention (suction upward), with the stagnation point at *C<sub>p</sub>*=1
  visible at the nose.
- **thickness and camber lines** of the profile as solved — the check that the geometry the
  solver used is the geometry that was drawn.
- **sweep curves** (study only): *C<sub>L</sub>*(*α*), *C<sub>m,c/4</sub>*(*α*), and
  *C<sub>m,c/4</sub>* vs *C<sub>L</sub>* with its regression line, whose slope is the
  aerodynamic centre.

There is no result kind for a curve in protocol 1.2, so curves travel in the result artifact
(§11) — an upstream gap worth filing, since four of the five planned exercises need one.

### 10.3 Metrics

| Metric | Symbol | Unit | Definition |
|---|---|---|---|
| `C_L` | *C<sub>L</sub>* | 1 | 2Γ/(*U*<sub>∞</sub>*c*), cross-checked against the pressure integral |
| `C_m_c4` | *C<sub>m,c/4</sub>* | 1 | *M<sub>z</sub>* about (0.25*c*, 0) from −∮*p***n**, nose-up positive, over *q*<sub>∞</sub>*c*² |
| `L_prime` | *L*′ | N/m | *q*<sub>∞</sub>*c* *C<sub>L</sub>* — the dimensional answer the challenge is set in |
| `Gamma` | Γ | m²/s | Bound circulation |
| `x_cp_over_c` | *x<sub>cp</sub>*/*c* | 1 | 0.25 − *C<sub>m,c/4</sub>*/*C<sub>N</sub>*; **reported as not applicable when \|*C<sub>N</sub>*\| < 0.05**, because the centre of pressure genuinely runs off to infinity as the normal force vanishes |
| `Cp_min` | *C<sub>p,min</sub>* | 1 | Minimum surface pressure coefficient, with its *x*/*c* |
| `alpha_deg` | *α* | ° | Incidence as the solver derived it from the outline (§4.3) |
| `alpha_L0_deg` | *α*<sub>L=0</sub> | ° | Zero-lift incidence: from the sweep when one was run, from theory otherwise, labelled with which |
| `dCL_dalpha` | d*C<sub>L</sub>*/d*α* | 1/rad | Sweep only |
| `x_ac_over_c` | *x<sub>ac</sub>*/*c* | 1 | Sweep only, with the regression *R*² |

Declared through `Solver.metrics` as `MetricSpec` entries (#43), so `capability.describe` with
`sections: ["metrics"]` answers what a run will report before one is submitted.

`stats` carries `panels`, `dofs`, `cells` (the sampling grid) and `seconds`, and nothing that
belongs above.

---

## 11. Result transport and the run row

Per [the contract §6](../exercise-contract.md#6-what-a-solver-has-to-return-on-protocol-12),
the solver writes an always-present `report.json` artifact:

```jsonc
{
  "schema": 1,
  "solver": { "name": "lab.airfoil_panel2d", "version": "1.0.0" },
  "model": { "level": 1, "kutta": "enforced", "trailing_edge": "closed" },
  "geometry": { "chord_m": 1.0, "te_gap_over_c": 0.0, "vertices": 208, "panels": 160,
                "hash": "sha256:…", "alpha_deg": 4.0,
                "camber_line": [[0.0, 0.0], "…"], "thickness": [[0.0, 0.0], "…"] },
  "metrics": { "C_L": 0.6693, "C_m_c4": -0.0537, "L_prime": 655.9, "…": "…" },
  "curves": { "cp_upper": [[0.0, 1.0], "…"], "cp_lower": [["…"]] },
  "sweep": null,
  "verification": { "cl_consistency_rel": 0.0031, "cd_pressure_spurious": 0.0004,
                    "cl_convergence_delta": 0.0018,
                    "thin_airfoil": { "alpha_L0_deg": -2.077, "C_m_c4": -0.0531,
                                      "dCL_dalpha_band": [6.283, 7.226] } },
  "validity": { "warnings": [] }
}
```

The page merges this with the inputs it owns (altitude, atmosphere mode, catalogue label) and
the envelope's `stats` to build the run row. Every field of the row is filled: a row that
cannot be recomputed is not saved.

---

## 12. Acceptance criteria

**Physics — `tests/test_panel_method.py`, 35 tests, no server and no FEniCSx.** All passing;
each line names what is checked and against what.

| # | Check | Tolerance | Measured |
|---|---|---|---|
| 1 | Cylinder, Γ = 0, against 1 − 4 sin²*θ* | 1 % (∞-norm) | 1.5e−14 |
| 2 | Cylinder, Γ = 0: both force components | 1e−3 | exact to machine precision |
| 3 | Cylinder, Γ ≠ 0: lift against *ρU*Γ | 0.5 % | passes at 300 panels |
| 4 | Kármán–Trefftz (*τ* = 16°), 3 sections × *α* ∈ {0°, 5°, 10°} | 0.5 % or 0.005 | 0.00–0.58 % |
| 5 | Joukowski cusp: error falls with panels, inside 2 % at 400 | see §8.2 | 3.6 → 1.4 % |
| 6 | Thin-airfoil *α*<sub>L=0</sub> and *C<sub>m,c/4</sub>* for five catalogue profiles, from the **extracted** camber line | 0.15°, 0.005 | passes |
| 7 | NACA 2412 lift slope inside [2π, 1.15 × 2π] and *α*<sub>L=0</sub> ≈ −2.08° | 0.5° | 6.91 /rad, −2.15° |
| 8 | Symmetric profile at *α* = 0: *C<sub>L</sub>*, *C<sub>m</sub>* | 1e−6 | 9e−18, 5e−16 |
| 9 | Centre of pressure absent, not infinite, when *C<sub>N</sub>* → 0 | — | reported as `null` |
| 10 | `kutta: none` gives zero lift at every incidence | 1e−12 | exact |
| 11 | `kutta: none` trailing-edge peak deepens without limit, and the Kutta condition removes it | — | −13 → −141 |
| 12 | Circulation-vs-pressure consistency, and that it *falls* with panel count | 2 % | 0.5 % at 240 |
| 13 | Panel convergence, 240 → 480 | 0.5 % | 0.15 % |
| 14 | *x<sub>ac</sub>*/*c* from a sweep | 0.02 of 0.25 | 0.262, *R*² 0.9997 |
| 15 | A sweep equals the same angles solved one at a time | 1e−12 | identical, 10× faster |
| 16 | The profile reads the same in any frame (rotated 30°, translated) | 1e−6 | passes |
| 17 | No zero-length panel for either trailing-edge treatment | — | passes |

**The seam with Fenix Spoon — `tests/test_airfoil_solver.py`, 24 tests.** That the adapter
registers itself by import alone; that the params schema publishes every bound and description
the page's form is generated from; that **every declared metric is actually reported**; that the
declared artifact is the one written; that both result kinds validate against `ResultEnvelope`;
that `stats` and the metrics share no key; that the masked interior carries no flow; that the
cost estimate matches the grid returned; that the withheld quantities are absent *and* named;
that a sweep is required before *x<sub>ac</sub>* appears; that the requested incidence is always
one of the sweep's stations; that each warning of §9 fires when its threshold is crossed and
that a valid run raises none; that the report carries everything needed to recompute the run;
and that two identical runs give byte-identical metrics.

**The page — `e2e/airfoil.spec.mjs`, 12 tests in a real browser.** That the problem is stated
before a solver is offered and every target reads *not run yet*; that the three parameter groups
are separate panels with no control in two of them, and that density, viscosity and the speed of
sound are not offered as free inputs at all; that the ISA table of §5.3 comes out to the digits
shown *in the browser*, and that the altitude control drives it; that the intended solution
reports the target met with every check passed and an explicit validity statement; that the
*C<sub>p</sub>* curve is drawn with the suction peak upward; that drag and efficiency cannot be
talked out of the model; that a run at Mach 0.44 is disqualified however good its numbers; that
the aerodynamic centre is unavailable until a sweep and lands between 0.23 and 0.29 chords when
it is; that turning the Kutta condition off returns the page to zero lift and says why; that a
kept run carries every input, that two runs can be compared, and that loading one restores its
inputs without re-solving; that a NACA 4412 reaches the lift and **fails** the moment constraint,
so the challenge still discriminates; that the camber position really moves for a 2312 against a
2512, read from the camber line the solver extracted rather than from the outline's highest
point; and that the geometry the solver read is reported back.

---

## 13. Level 2, and what it must not claim

Level 2 adds Reynolds-number dependence, a no-slip wall, and therefore drag. Two candidate
implementations, in order of cost:

1. **Panel method + integral boundary layer** — the level-1 inviscid solve provides the edge
   velocity; a two-equation integral method marches momentum and shape factor, transition by a
   correlation, drag by Squire–Young. This is what XFOIL does, it is cheap enough for the
   public budget, and it produces a credible polar and a separation-onset indication.
2. **Incompressible Navier–Stokes in FEniCSx** — resolves the boundary layer directly and
   produces separation without correlation. It needs a boundary-layer-resolved mesh, a
   turbulence treatment above Re ≈ 1e5, and orders of magnitude more compute; it is out of
   reach of a public demo at useful Reynolds numbers, and both facts should be said out loud.

Either way, the interface is already designed for it: `model.level` is in the run row, the
withheld-metrics table (§2) becomes shorter, and the metrics panel gains *C<sub>D</sub>*,
*L*/*D*, *x*<sub>sep</sub> and a *C<sub>L</sub>*–*C<sub>D</sub>* polar. What level 2 must not
do is quietly reinterpret level-1 rows: a run row records the level it was solved at, and the
comparison view refuses to plot a level-1 *L*/*D* against a level-2 one, because the first
does not exist.

---

## 14. Decisions, resolved and still open

**Resolved by the implementation.**

1. **Does the page keep the upstream solvers?** No. The lab's own solver implements
   `kutta: none` itself, so the no-circulation model is one code path with the lifting one and
   is exercised by the same tests. Keeping `mock.laplace2d` on the page would have meant a
   second model that cannot express a non-zero incidence (it imposes the stream along *x*), for
   a comparison the selector already provides.
2. **Where does the pin land?** Bumped: `712dea2` → `988ad64`, protocol 1.2, which is what makes
   `MetricSpec` and `ArtifactSpec` available. Verified additive first — no shipped solver's
   `Params` changed a field — and both images exist for the new commit. See ADR-007.
3. **Kármán–Trefftz, not Joukowski, is the primary exact check.** Forced by measurement: a
   Joukowski cusp cannot be resolved to 0.5 % by any reasonable panel count, and every profile
   the exercise offers has a finite trailing-edge angle anyway (§8.2).

**Still open.**

4. **Does the mode selector stay prefix-based?** `api.js` maps `mock.` to "fast preview" and
   `dolfinx.` to "FEniCSx computation". `lab.airfoil_panel2d` is neither, and calling a panel
   method a "preview" would be wrong — it is the most accurate surface solution on the page.
   The adapter declares `availability = "panel-method"`, and the pin now publishes that field
   through `capability.describe`, so the honest fix is for the page to read it instead of
   parsing the name. That is page work, and it is the one thing in `shared/api.js` this
   exercise wants changed.
5. **How many catalogue profiles?** Eight are implemented in the challenge table of §1, which is
   enough to make the camber/moment trade visible. Five-digit and 6-series profiles need a
   different generator and are a separate decision.
6. **Does the FEniCSx cross-check get built?** §6.2 specifies it and nothing depends on it. Its
   value is a second implementation of the same physics; its cost is a mesh, a truncated far
   field and its own convergence study. Worth doing when there is a reason to doubt the panel
   method, and the exact solutions of §8.2 are currently a better use of the same effort.
