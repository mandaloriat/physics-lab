# Exercise — the heat sink

**State:** specification. Not built.
**Solver:** `dolfinx.heat2d`, with `mock.heat2d` as the cross-check — **both upstream**. This is
the first exercise in the lab that needs no solver of its own, and §11 explains why that is
worth defending rather than quietly undoing.
**Contract:** [the nine sections](../exercise-contract.md#1-the-nine-sections), and the
*Heat-sink challenge* row of [§7](../exercise-contract.md#7-the-exercises).

---

## 0. The lesson the field alone does not teach

The home page has carried a heat sink under *In preparation* for some time, with an honest
caption: *"the preview solver exists upstream — the field above is one of its solves. The lesson
does not."* That is the whole gap. Upstream ships the physics, cross-validated across two
adapters, with a demo page that builds its controls from `params_schema`. What it does not ship
is a question with a right answer.

The card also states the question this exercise exists to answer:

> **How many fins actually help, and when do they stop?**

**As specified upstream, that question has no answer, and the reason is in the solver's own
assumption.** `convection_coefficient` says the fluid is not solved: `h` enters as a single
coefficient on exposed faces, and the assumption excludes `flow_field`, `buoyancy` and
`local_heat_transfer_coefficient` by name. With `h` held constant, adding fins adds surface at
no cost, so thermal resistance falls monotonically with fin count and the model says *more fins
are always better* — right up to fins of zero thickness. A visitor who trusts it learns
something false.

The real sink stops improving because narrowing the channel between fins chokes the flow through
it, and `h` falls faster than area grows. §2 is where this exercise puts that back, and it is
the design decision the page turns on.

---

## 1. The problem

An extruded aluminium heat sink carries a power device on its base. Dissipate the device's heat
while keeping it under its rated temperature, **using less metal** — mass is what the challenge
is scored against, because thermal resistance alone is bought trivially by adding material.

**Nominal case.** 30 W over a 60 mm base, ambient 25 °C, natural convection. The device's case
limit is 85 °C, so the sink has 60 K of rise to spend.

**Targets.**

| | Target | Tolerance |
|---|---|---|
| *T*<sub>max</sub> | ≤ 85 °C at 30 W and 25 °C ambient | hard limit; a run above it fails |
| mass | ≤ the budget the page states, per metre of extrusion | hard limit |
| *R*<sub>θ</sub> | minimise | the score |

**Why it is not trivial.** Fin count, fin thickness and fin height trade against each other and
against mass, and two of the three have an optimum rather than a direction.

---

## 2. The model, and the one thing it does not solve

Steady conduction in the solid:

  ∇·(*k* ∇*T*) = 0

on the **cross-section of the extrusion**, with convection on every exposed face.

**The two-dimensional model is the right one here, not a compromise.** Every other exercise in
this lab argues that a 2-D slice answers the question well enough. An extruded sink is genuinely
prismatic: the cross-section repeats along the whole length, so the 2-D solve is exact for the
conduction problem and everything is reported per unit depth. It is worth saying on the page,
because it is the one case where the visitor should *not* be warned about the third dimension.

**The geometry maps onto `regions2d` without a gap.** The region set is the solid — base and
fins — and the background is the fluid, which `mock.heat2d` does not solve at all: it becomes
the convective boundary condition, and the result's `mask` marks the cells that were not solved.
That is exactly the semantics documented for the kind. Unlike the bridge, this exercise finds no
edge of the geometry schema; it fits the second kind as written.

### 2.1 `h` is a function of the channel, and that is what makes the question answerable

**This is the exercise's one modelling decision, and it lives in the page rather than in the
solve.** The finite-element model takes `h` as an input, as it should. What the page adds is
*where the number comes from*: a published correlation evaluated from the geometry the visitor
set, so that narrowing the channel lowers `h` the way it does in a real sink.

  *h* = *h*(*s*, *H*, Δ*T*, fluid), with *s* = (*W* − *N t*) / (*N* − 1)

- **Natural convection**, the nominal case: the vertical-parallel-plate family — Elenbaas, and
  the optimum-spacing result of Bar-Cohen and Rohsenow. **The exact correlation and its
  coefficients must be pinned to a cited source when the page is built**, not reconstructed from
  memory, and the page must state its range of validity beside the number.
- **Forced convection**, if the page offers a fan: a channel-Nusselt correlation on the channel
  Reynolds number.

**Three consequences, all of which belong on the page rather than in a footnote.**

1. The optimum fin count becomes real. Surface grows like *N*; `h` falls as *s* narrows; the
   product has a maximum, and finding it *is* the exercise.
2. **The correlation is now carrying physics the finite-element model does not have**, which
   makes it the first thing to distrust when an answer looks wrong. It is an input with a
   validity range, shown as one, and §4 of the run's validity block says so.
3. It stays an *input*. Nothing about the solve changes, no adapter is written, and the
   `convection_coefficient` assumption upstream declares remains exactly true — the page has
   simply stopped pretending the coefficient is independent of the geometry it sits on.

**What is still not modelled, and is declared:** the flow field itself, buoyancy, fin-to-fin
radiative exchange, and the spreading resistance of a device smaller than the base — the last of
which is a real effect and the natural second version of this page.

---

## 3. Boundary conditions

| Boundary | Condition |
|---|---|
| Base, under the device footprint | heat flux *q*″ = *Q* / (footprint × depth), or a fixed base temperature at model level 2 |
| Base, outside the footprint | convection, or adiabatic if the sink is mounted flush — a choice the page exposes, because the two differ more than a visitor expects |
| Fin faces and tips | convection *h*(*T* − *T*<sub>∞</sub>), with `h` from §2.1 |
| Lateral symmetry planes | adiabatic, when the page solves one repeating channel rather than the whole profile |

---

## 4. Initial conditions

**None — the problem is steady**, and the contract asks for this section only where a problem is
transient. Stated rather than omitted, because upstream's `steady_state` assumption is explicit
that the wrong reading of it is silent: *"every temperature reported is the equilibrium the
device settles at, reached after a time this model cannot tell you."* A visitor sizing a sink for
a duty cycle is asking a different question, and the page should say so where they will see it.

---

## 5. Physical inputs

**Design** — base width *W*, base thickness *t*<sub>b</sub>, fin count *N*, fin thickness *t*,
fin height *H*, material (aluminium 6063, *k* = 201 W/m·K; copper, *k* = 385; and a cheap alloy,
so that *k* is visibly not the whole story).

**Conditions** — dissipated power *Q*, ambient temperature *T*<sub>∞</sub>, and the cooling
mode: natural, or forced with a face velocity.

**Advanced** — mesh size; whether `h` is taken from the correlation or overridden by hand, the
override existing precisely so a visitor can see what the constant-`h` model would have told
them.

---

## 6. Fields

`T` over the solid, the conductive flux vector and its magnitude, and the `mask` that marks the
fluid the solve did not touch. The flux vectors are worth showing by default here: they run from
the footprint into the base and turn up the fins, and where they crowd is where the metal is
working — which is the picture that makes §7's fin efficiency mean something.

---

## 7. Engineering metrics

| Metric | Unit | Source |
|---|---|---|
| *T*<sub>max</sub> | °C | **upstream**, `HEAT_METRICS` |
| *T*<sub>rise</sub> | K | **upstream** |
| flux<sub>max</sub> | W/m² | **upstream** |
| *R*<sub>θ</sub> = (*T*<sub>max</sub> − *T*<sub>∞</sub>) / *Q* | K/W | derived |
| mass per unit depth | kg/m | derived, from the region areas and the density |
| fin efficiency η | 1 | derived |
| *R*<sub>θ</sub> · mass — **the score** | K·kg/(W·m) | derived |

Three of the seven ship upstream and four are arithmetic on the solve. §11 carries the one
question that raises.

---

## 8. Verification

| Check | What it compares | Expected |
|---|---|---|
| **Analytic — fin theory** | η against the straight-fin result η = tanh(*mL*<sub>c</sub>)/(*mL*<sub>c</sub>), *m* = √(2*h*/*k t*), *L*<sub>c</sub> = *H* + *t*/2 | agreement within a few percent at nominal, where the fins are short and stubby (η ≈ 0.96) and 1-D fin theory is at its best. **The check earns its keep at the other end**: tall thin fins drive η down, and that is where a 2-D solve and 1-D theory should start to separate — the page should show where they do |
| **Limiting case** | a bare plate, *N* = 1 | *R*<sub>θ</sub> = 1/(*hA*) exactly, since there is no fin left to be inefficient |
| **Energy balance** | *Q* in against ∫*h*(*T* − *T*<sub>∞</sub>) d*S* out | closes below 1% |
| **Cross-adapter** | `mock.heat2d` against `dolfinx.heat2d` | **free**: upstream already cross-validates these two, and the exercise inherits the check rather than inventing one |
| **Convergence** | mesh size halved | change in *T*<sub>max</sub> below the tolerance the page declares |

**The cross-adapter row is unusually cheap and should not be undersold.** Two independent
implementations agreeing is a stronger statement than one implementation converging, and this is
the only exercise in the lab that gets it without doing any work.

---

## 9. Save result

The run row per [§5 of the contract](../exercise-contract.md#5-the-run-table). `geometry.source`
is `parametric`; `physical` carries the six design parameters, the power, the ambient and the
cooling mode; `numerics` carries the mesh size. **`physical` must also record the `h` the
correlation produced and which correlation produced it** — a run is not reproducible from the
geometry alone once a correlation stands between the geometry and the boundary condition.

---

## 10. The number this exercise exists to produce

**The fin count at which the sink stops improving**, and the visitor finding that it is a
number rather than a direction.

Sweep *N* at fixed mass and the curve turns: thermal resistance falls while added surface wins,
flattens, and rises once the channels are too narrow for the air to move through them. The
minimum is the answer, and it moves — to higher *N* under forced convection, to lower *N* as the
fins get taller.

The second thing it teaches is quieter and comes free with the *Advanced* override: pin `h`
constant and re-run the sweep, and the curve stops turning. That comparison, on one page, is the
difference between a model that produces a field and a model that answers a question.

---

## 11. What this needs that does not exist yet

**Almost nothing, and that is this exercise's distinguishing feature.** The physics, the geometry
kind, the metrics and the cross-validated second adapter are all upstream today. There is no
issue to open and nothing to wait for — which is exactly why it is the right exercise to build
while [#100](https://github.com/mandaloriat/fenix-spoon/issues/100) and
[#101](https://github.com/mandaloriat/fenix-spoon/issues/101) sit upstream.

Two items, and the first is a decision rather than a gap.

1. **Where the four derived metrics live.** *R*<sub>θ</sub>, mass, fin efficiency and the score
   are arithmetic on quantities the solve already returns. The temptation is to write
   `lab.heatsink2d` wrapping `dolfinx.heat2d` so the metrics arrive through `metrics` like the
   other three — and that would be **the first time the lab wrote a solver that adds no
   physics**, which is precisely what [ADR-014](../architecture-decisions.md#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first),
   [ADR-018](../architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force)
   and [ADR-019](../architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)
   all refused: *a solver of the lab's own only when the physics a metric needs is missing, never
   to demonstrate the adapter contract.*

   So the first thing to establish when building is whether a page can present a derived metric
   beside a declared one without an adapter in between, and what it costs at the run table if it
   can. **If it cannot, that is an upstream finding worth reporting rather than a reason to write
   the wrapper** — the same conclusion the truss reached about network geometry, arrived at from
   the other side.

2. **The correlation needs a citation, not a reconstruction.** §2.1 names the families; the
   coefficients and their validity range must come from a source that can be cited on the page.
   This is the one piece of the exercise that cannot be finished from inside the repository.

---

## 12. Order, and an honest estimate

Smaller than everything built so far, because the solver is already written and already
verified. What has to be built is a page, a parametric geometry that emits `regions2d`, four
lines of arithmetic, the correlation, and the sweep that turns §10 into a curve.

The risk is not technical. It is that the correlation gets treated as a detail and the page ships
with constant `h` — at which point the exercise is upstream's demo with a lab logo on it, and the
question on the home page card still has no answer.
