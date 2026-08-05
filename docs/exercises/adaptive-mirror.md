# Exercise 6 — The adaptive mirror

**Status:** *specified, not built.* It depends on a plate element the toolkit does not have;
§11 says so plainly.
**Implements:** [the exercise contract](../exercise-contract.md).
**Contract row:** new, and the first **transient** exercise in the lab — the first that has a
[§4](../exercise-contract.md#4-validity-stated-per-run) to fill in at all.
**Sources:** the `P45` archive (`mandaloriat/P45`) and M. Andolfatto, *Accoppiamenti magnetici
nell'analisi servoelastica di uno specchio adattivo*, Politecnico di Milano, 2015,
[POLITesi 10589/109051](https://www.politesi.polimi.it/handle/10589/109051), chapter
*Lo specchio*. The P45 mirror itself is an experimental article from earlier work at the same
group.
**Depends on:** [Exercise 5](capacitive-sensor.md), which produces this exercise's sensor
model.

---

## 0. What is being controlled, and what makes it hard

[Exercise 5](capacitive-sensor.md#0-what-an-adaptive-mirror-is-and-why-the-capacitor-is-the-whole-problem)
sets out the adaptive-optics loop and the sensor. This page is the plant and its controller.

Three properties make the mirror an unpleasant thing to control, and each of them is a
parameter the visitor gets to move.

**It is free.** The shell hangs over the reference body on a central membrane that is stiff
in-plane and negligible out of plane. Omitting that support, the structure is *labile*: it has
rigid-body modes and is held in dynamic equilibrium by the control forces alone. Three modes
at 0 Hz are not a modelling defect to be constrained away; they are the operating condition.

**It has a dense, lightly damped modal spectrum.** For P45 the first elastic mode is at 112.8
Hz and the fiftieth is at 2640.9 Hz, with most of them in degenerate pairs from the annular
symmetry. Forty-seven elastic modes inside 2.7 kHz, at very low damping, is the definition of
a spillover problem: energy the controller puts in to move one shape reappears in a mode it
was not addressing.

**Its loop cannot be centralised.** Acquiring 45 (or 5000) sensors, computing a global control
law, and distributing the commands takes longer than the dynamics allow. The architecture is
therefore two-level, and the exercise should show it as two levels:

| Level | Rate | What it does | Where the shape comes from |
|---|---|---|---|
| Feed-forward, centralised | 1–2 kHz | issues the commanded position for every control point, held constant for one cycle and blended between cycles | the wavefront sensor, upstream |
| Feedback, decentralised | ~100 kHz | each unit tracks its own reference from its own capacitive reading | itself |

`P45` runs the inner loop at 80 kHz (Δ*t* = 12.5 µs) with a 40 kHz first-order sensor filter,
which is where those numbers in §5 come from.

---

## 1. The problem

**Challenge.** The mirror is given and fixed. Tune the controller so the surface reaches a
commanded shape within a residual and a settling time, without exceeding the actuators, and
without leaving energy in the high modes.

That last clause is the point of the exercise. A gain pair that hits the residual by ringing
the plate at 1.9 kHz has not solved the problem, and a page that reports only the residual
would tell the visitor it had.

```json
{
  "challenge": {
    "statement": "Track a commanded shape change of 1 µm at every control point: settle inside a 10 nm RMS residual within 5 ms, with no actuator above 1 N, and less than 2% of the control energy above 1 kHz.",
    "targets": [
      { "metric": "rms_residual_settled", "comparator": "<", "value": 10, "unit": "nm" },
      { "metric": "settling_time", "comparator": "<", "value": 5, "unit": "ms" },
      { "metric": "peak_actuator_force", "comparator": "<", "value": 1.0, "unit": "N" },
      { "metric": "spillover_fraction", "comparator": "<", "value": 0.02, "unit": "1" }
    ],
    "requires_valid": true,
    "requires_verified": { "metric": "energy_balance_rel", "below": 0.01 },
    "next_step": "the same residual with feed-forward off, on feedback gains alone"
  }
}
```

The numbers above are placeholders in the right shape. They get fixed by running `P45`'s own
configuration first and reading off what it achieves, which makes the target *reachable by the
reference solution* by construction.

There is also a constraint the visitor can violate outright rather than miss by a margin: the
loop has a stability boundary in the damping, and crossing it diverges (§2). A run that
diverges is not a failed target, it is a run with no metrics, and the page has to say so in
those terms.

---

## 2. The model, and why it is two solves

This is the design decision the exercise turns on, and it is what makes it affordable.

**Solve A — the plant.** A Mindlin plate on the annular 2-D domain, unknowns *w*, θ<sub>x</sub>,
θ<sub>y</sub>, assembled to **K** and **M**, plus at each of the 45 control points a
concentrated mass matrix and a concentrated stiffness from the permanent-magnet pair. Then
static condensation onto the 45 control degrees of freedom, giving **K**<sub>red</sub> and
**M**<sub>red</sub> (45×45).

**Solve B — the loop.** Time integration of

  **M**<sub>red</sub> **ẅ** + **C**<sub>red</sub> **ẇ** + **K**<sub>red</sub> **w** = **f**<sub>ff</sub>(*t*) + **f**<sub>fb</sub>(*t*)

at 80 kHz, with the feedback force read through the sensor model of
[Exercise 5](capacitive-sensor.md).

Solve A is expensive, deterministic, and depends **only on the mirror** — which this exercise
holds fixed. Solve B is a few thousand 45×45 operations and is what a run actually varies.
So A is computed once and cached, and every subsequent run is B alone. Without that split the
exercise is a finite-element solve per controller tweak and nobody tunes a gain twice; with
it, the page is interactive.

The toolkit has the mechanism: the content-addressed cache keys a solve by its content and
`provenance` reports the `cache_key` back, so **K**<sub>red</sub>/**M**<sub>red</sub> is a
cached artifact of the mirror's parameter hash. Whether B can *declare* that it consumes A's
artifact, rather than re-deriving A's key itself, is an open question against the workspace
object store — §11.4, and it is a question to answer before it is worked around.

`P45` does exactly this split already — `condense.py` writes `Kred.npy` and `Mred.npy`, and
the controllers load them — so the split is inherited from the reference implementation
rather than invented here.

**Damping is aerodynamic, and it is an input with physical meaning.** This is the part of the
model most likely to be got wrong by reading the code, so it is stated at length.

The shell floats about 10⁻⁴ m above the reference body. At low frequency the dissipation is
dominated not by the material but by the **air film in that gap**, and the thesis anchors it
at ζ₁ = 0.5 at 1 Hz. Zerodur contributes nothing like that; a squeeze film does.

Aerodynamic dissipation falls away with frequency, so the second anchor is a separate
question, and the thesis answers it experimentally rather than by material data: ζ₂ = 10⁻⁴ at
10 kHz was tried and **the closed loop went unstable**. Damping was then added until the
system was just stable, settling at **ζ₂ = 10⁻³ at 1 kHz**. The high-frequency anchor is
therefore a stability boundary, not a measurement, and the exercise should present it as one.

Solving 2ζ = α/ω + βω at those two anchors gives

  α = 6.2832  β = 1.59 × 10⁻⁷

which puts ζ = 0.45% at the first elastic mode (112.8 Hz), a minimum of ζ = 0.1% at 1.00 kHz,
and ζ = 0.15% at the fiftieth mode. Lightly damped, as a floating glass annulus should be.

**So the page exposes the two anchor points, not α and β.** (ζ₁, *f*₁) and (ζ₂, *f*₂) have
physical meaning and the Rayleigh coefficients do not, and it is the anchors the visitor
should be allowed to move. The later `P45` drivers already work this way — `time_history_3`
and `for_data_extraction` solve the 2×2 system at run time and then overwrite the feed-forward
model's coefficients with the result.

**A warning for whoever reads the code first.** `feedforward.py` initialises `self.alfa` and
`self.beta` to 10⁻³ each. Those are a stale class default, superseded at line 310 of the
drivers that matter; the earlier variants, `control/` among them, never overwrite them and so
run with them. Taken literally they give ζ ≈ 0.35 at 112.8 Hz and ζ ≈ 0.87 at 276.6 Hz, which
is not a mirror. **The port takes α and β from the anchors, and treats the 10⁻³ pair as the
bug it is.**

That leaves one thing genuinely separate: the plant's damping and the *feed-forward model's*
damping. The thesis is explicit that the open-loop force is computed from experimentally
identified **K**\*, **M**\*, **C**\*, which resemble the condensed matrices but differ through
the non-collocation of sensors and actuators. Two objects, and the page should carry them as
two inputs, with the difference between them a thing the visitor can turn on.

**And the instability is a feature.** Lowering the high-frequency damping anchor makes the
loop go unstable, and that is a real result reproduced from the reference work, not a
numerical accident. It belongs in the challenge as the constraint that gives the exercise
teeth.

---

## 3. Boundary conditions

| Boundary | Condition |
|---|---|
| Inner edge, *r* = 0.12 m | free |
| Outer edge, *r* = 0.2834 m | free |
| Central membrane support | omitted — stiff in-plane, negligible transversally |
| 45 control points | point force from the actuator; concentrated mass and magnet stiffness |

Every edge free, and the page should say why that is deliberate rather than leave a reader
looking for the missing clamp.

---

## 4. Initial conditions

The first exercise in the lab that has any. **w**(0) = **0**, **ẇ**(0) = **0** for a step from
rest; optionally a perturbed starting shape, so the visitor can watch the loop recover from a
disturbance instead of only from zero.

---

## 5. Inputs, in three groups

The contract's [step 2](../exercise-contract.md#7a-the-order-a-page-presents-them-in) already
gives *Design*, *Conditions* and *Advanced*. A controller gain is neither a physical input nor
a numerical setting — change it and the answer *should* change, but it is not a fact about the
plant. It is **Design**, and the existing grouping absorbs it without amendment. Recording
that here because it is the first exercise where *Design* means something other than geometry.

**Design — the controller**

| Input | P45 value | Note |
|---|---|---|
| Proportional gain *g*<sub>p</sub> | 10 000 N/m | per actuator; scalar or per-unit |
| Derivative gain *g*<sub>d</sub> | 35 N·s/m | per actuator |
| Feed-forward | on | uses **K**<sub>red</sub>, **M**<sub>red</sub> and the blended trajectory |
| Feed-forward blend | raised cosine over *T*/4 | `shapew`/`shapewd`/`shapewdd` in `feedforward.py` |
| Sensor filter cutoff | 40 kHz | first order |
| Sensor model | linear / curve / off | the hand-off from [Exercise 5](capacitive-sensor.md) |
| A-D conversion | 15 bit, *C*<sub>ref</sub> 39 pF, *C*<sub>stray</sub> 3.9 pF, amplitude-dependent noise | `digital_cap2disp` |
| Non-collocation | on/off | `Kred_with_cond.npy` vs `Kred.npy` |

**Conditions — the command, the disturbance and the air film**

| Input | P45 value | Note |
|---|---|---|
| Commanded shape | 45 target positions | or a low-order Zernike sampled at them |
| Open-loop update period *T*<sub>ol</sub> | 0.5–1 ms | 1–2 kHz |
| Command amplitude | 1 µm | |
| Damping anchor 1 (ζ₁, *f*₁) | 0.5 at 1 Hz | the squeeze film in the gap |
| Damping anchor 2 (ζ₂, *f*₂) | 10⁻³ at 1 kHz | **the stability boundary.** 10⁻⁴ at 10 kHz diverges |
| Sensor noise | from the A-D model | |

α and β are *derived* from the two anchors and reported, never typed.

**Advanced — numerics**

Integrator (explicit Euler, or the Mantegazza scheme with ρ<sub>∞</sub> near 1 for controlled
high-frequency filtering), time step, simulated duration, number of retained modes, plate mesh
size for solve A.

`P45` deliberately kept ρ<sub>∞</sub> close to 1 so that the integrator's own numerical damping
would not hide spillover. That is a nice thing to expose as a knob: turn it down and the high
modes disappear, but they disappear from the *integrator*, not from the mirror.

---

## 6. Fields and curves

**Field:** the deformed surface on the annulus, and — the one that matters — the **residual
map**, commanded minus achieved, at a chosen instant. The residual map is where a visitor sees
that the error is not uniform but has the shape of a mode.

**Curves:** displacement history at a selected control point against its reference; RMS
residual against time; actuator force history; and the spectrum of the residual, which is
where spillover is legible. All of them go back in the envelope's `series` list, which the
airfoil adapters already use to return a flow field and its surface *C<sub>p</sub>* from one
solve.

**Frames.** The deformed shape at intermediate instants goes back as time-stamped artifacts,
indexed by the result's `frames` list. The precedent and its limitation are both
`mock.transient_heat2d`: the field the envelope carries is the **final instant**, the history
crosses as references, and a declared metric reduces the payload rather than the whole time
history. So peak-over-time quantities — worst residual, peak force — are computed inside the
adapter and reported as metrics, not declared as reductions of a field.

---

## 7. Engineering metrics

| Metric | Symbol | Unit | Definition |
|---|---|---|---|
| Settled RMS residual | — | nm | RMS over the 45 points of (commanded − achieved), averaged over the last 10% of the run |
| Peak residual | — | nm | worst point, worst instant after settling |
| Settling time | *t*<sub>s</sub> | ms | first time after which the RMS residual stays inside the band |
| Peak actuator force | — | N | max over units and time |
| RMS actuator force | — | N | the number a coil is thermally sized on |
| Control effort | — | N²·s | ∫Σ*f*<sub>i</sub>² d*t* |
| Spillover fraction | — | 1 | share of residual energy above the feed-forward update frequency |
| Sensor-induced error | — | nm | run repeated with the ideal sensor; the difference is what the capacitor cost |

The last row is the one that joins the two exercises, and it is only definable because the
same run can be done with and without the sensor model.

---

## 8. Verification

| Check | What it compares | Source |
|---|---|---|
| **Benchmark — modal** | the assembled plant's natural frequencies against the published 50 | 0, 0, 0, 112.8, 112.8, 182.3, 276.6, 276.7, 417.2, 417.3, 485.1, 485.2, … 2640.9 Hz |
| **Analytic — rigid body** | exactly three zero-frequency modes, and their shapes are piston and two tilts | free Mindlin plate |
| **Balance** | work done by the actuators against strain plus kinetic plus dissipated energy, over the run | |
| **Convergence** | the same run at Δ*t* and Δ*t*/2, and at two plate mesh sizes | |
| **Benchmark — stability** | the loop diverges at ζ₂ = 10⁻⁴ / 10 kHz and holds at ζ₂ = 10⁻³ / 1 kHz | the thesis, §2 |
| **Regression** | the time histories against `P45`'s stored `.dat` output for the same configuration | the archive |

The modal row is a strong check and it is free: fifty numbers, computed in 2015 by a different
code, sitting in a published table. Getting the first three to be zero and the fourth to be
112.8 Hz means the plate element, the concentrated masses and the magnet stiffness are all
right at once.

A note for whoever cites it: that table is captioned *"Pannello rettangolare"* in the thesis,
carried over from the validation case on the preceding pages. The numbers are P45's.

**And the regression row is why `P45` stays archived rather than deleted.** Three hundred and
sixty `.dat` files are the output of a version known to be correct. A port with no reference
output is a rewrite with a hope attached.

---

## 9. Save result

Per the contract. Two additions worth naming: `solver` records **both** solve A's cache key and
solve B's version, because a run is only reproducible if the reduced model it ran on is
identified; and `physical` carries the whole 45-point command vector, not a summary of it.

---

## 10. What the port should *not* carry over

`P45` is 15 715 lines of Python across thirteen driver scripts that diverged from each other
over eight years. The port is not a translation of it. Concretely:

- **The thirteen variants are one solver plus configuration.** `time_history`,
  `time_history_2_order_filter`, `time_history_3`, `time_history_with_act_dyn`,
  `time_history_with_act_dyn_expl`, `for_data_extraction`, `voltage`, `control`, `space` and
  `pippo` are the same plant with a different controller, integrator or output. They become
  parameters, not directories.
- **The geometry is already one file.** Eleven of the thirteen `geom.geo` are byte-identical;
  the other two differ in one line, the Gmsh mesh resolution. There is one geometry.
- **The `1e-3` damping default in `feedforward.py`** is superseded in the drivers that matter
  and left standing in the ones that do not. §2 has it. Do not port the constant; port the
  two anchor points it was meant to approximate.
- **The README in the archive is wrong in two places** and the port should not inherit its
  numbers. It states an outer radius of 120 mm and an inner radius of ~28 mm; the thesis
  states inner 0.12 m, outer 0.2834 m. It calls the material "aluminum-like"; it is Zerodur,
  with the elastic constants the README quotes correctly. The README was generated by an
  automated pass over the code in March 2026, and it guessed.

---

## 11. What this needs that does not exist yet

Ordered by how much of the exercise is blocked on it.

Both solvers are **lab adapters** — `lab.mirror_plate2d` for solve A, `lab.mirror_loop` for
solve B — registered beside `lab.truss2d`, which already set the precedent that a lab solver
need not be a continuum solve. One item below is the exception and is marked as such: the
eigenvalue solve is a *question kind* rather than physics, and question kinds have been
upstream's every time.

1. **A Mindlin plate element.** The toolkit ships `dolfinx.elasticity2d`, which is plane
   continuum, not a plate, so the element is the lab's to write. A shear-deformable plate needs
   its locking handled — MITC-style tying, reduced integration, or a stabilised formulation —
   and at 1.61 mm over a 163 mm annular width this plate is thin enough for locking to be the
   difference between the right modal frequencies and plausible wrong ones. **This is the
   exercise's real technical risk**, and the modal benchmark in §8 is what will catch it.
   [The business case](../proposals/mindlin-plate-and-modes.md) separates this from the item
   below and proposes retiring the risk *before* the exercise is built around it: the element
   and the eigen-check against the fifty published frequencies, and nothing downstream of them.
2. **An eigenvalue solve.** Named separately from the element, because it is a different kind
   of ask with a different owner. Nothing upstream solves an eigenproblem — every registered
   adapter is a forward solve — while the protocol has described the *answer* since 1.5, where
   `series1d`'s own documentation lists "a list of modal frequencies" among the curves it exists
   for. The proposal above argues that gap is Fenix Spoon's rather than the lab's, and that the
   contract's *Room modes* row is the second consumer that makes the case.
3. **Point mass and point stiffness as parameters.** Forty-five 3×3 blocks are neither
   geometry nor material. [ADR-019](../architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)
   already set the precedent by carrying the truss lattice in `params`, and this is the same
   shape of problem.
4. **Nothing for the curves or the time history.** `series1d`, the `series` list and `frames`
   over time-stamped artifacts all landed (protocol 1.5 and 1.7;
   [#46](https://github.com/mandaloriat/fenix-spoon/issues/46) and #82, both closed). §6 says
   how this exercise uses them, including the one real limitation.
5. **A declared dependency between solves — to be checked before it is assumed.** Solver B
   needs solver A's artifact. `provenance.cache_key` and the workspace object store both
   landed after this spec was first drafted, and between them they may already express it. If
   they do, this is a documentation item. If they do not, it is worth an upstream issue before
   the lab works around it a second time.

---

## 12. Order, and an honest estimate

Build [Exercise 5](capacitive-sensor.md) first, and not because it is smaller. It is steady,
linear, scalar, on a domain a few millimetres across; it needs one thing from the toolkit (an
axisymmetric form) and that thing is an integrand factor; it has an analytic check *and* a
published benchmark; and its output is this exercise's input. It is the shortest path from
nothing to a page that is verifiably right about something.

Then this one, and expect the plate element to be most of it. The control loop is a few
hundred lines of NumPy and is the part already written twice. The rest is the exercise
contract's own machinery, which the lab has built four times now.

`P45` stays archived throughout, and gets one line at the top of its README pointing here. It
is the specification, the reference implementation and the regression fixture. It is not the
codebase.
