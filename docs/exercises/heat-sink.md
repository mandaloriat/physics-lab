# Exercise — the heat sink

**State:** specification. Not built.
**Solver:** `lab.heatsink2d` — conduction on the upstream footing, plus the radiative boundary
condition upstream declares it does not have. `dolfinx.heat2d` and `mock.heat2d` remain the
cross-check for the conduction-and-convection core. §11 explains why the lab writes a solver
here, and §8 says exactly which part of the page the inherited check still covers.
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

on the **cross-section of the extrusion**, with **two** heat paths off every exposed face —
convection into the air, and radiation through it. §2.1 and §2.2 take them in turn, and the
exercise needs both: in still air near ambient they are the same size.

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
3. It stays an *input*. The `convection_coefficient` assumption upstream declares remains
   exactly true — the page has simply stopped pretending the coefficient is independent of the
   geometry it sits on.

**Why the fluid is not solved, stated as a choice rather than a limitation.** Conjugate natural
convection — Navier–Stokes with a buoyancy term, coupled to the conduction — would make `h` an
output instead of an input, and it is the physically complete answer. It is not what this
exercise does, for two reasons. Nothing upstream solves a fluid at all: the gallery records
incompressible Navier–Stokes as *"the obvious fourth example"* with the wire protocol ready
since 1.1 and *"what remains is the solve"*. And a coupled buoyant solve costs minutes per run,
which would kill §10 — the whole exercise is a sweep of fifteen or twenty configurations, and a
page that cannot sweep cannot show the optimum. **The correlation is not a stand-in for CFD; it
is how sinks are actually sized, and CFD is what verifies it afterwards.**

### 2.2 Radiation, which in still air carries about half the heat

Omitting it would be a straight error at the nominal case, and upstream says so in the
assumption this exercise has to break with:

> `no_radiation` — *"Negligible for a fan-cooled sink near ambient; **not negligible for a hot
> surface in still air, where radiation can carry a comparable share of the load and this model
> would over-predict the rise**."*

The nominal case is still air with 60 K of rise. Linearised, *h*<sub>rad</sub> ≈ 4εσ*T*<sub>m</sub>³,
which at *T*<sub>m</sub> ≈ 328 K is about 8ε W/m²·K:

| Finish | ε | *h*<sub>rad</sub> | against natural convection at 5–8 W/m²·K |
|---|---|---|---|
| bare aluminium | ≈ 0.05 | 0.4 | negligible |
| **black anodised** | ≈ 0.8 | **6.4** | **comparable — about half the heat** |

**That table is for a surface that can see the room, and the built solver says so.** On an
unfinned plate at ε = 0.8 the radiative fraction comes out at **0.46** — the "about half" above,
confirmed. On the *nominal finned* sink it is **0.14**, because the channels are 5 mm wide and
25 mm deep and the view factor from a flank to the room has collapsed to 0.09. Radiation has not
become unimportant there: switching it off still over-predicts the temperature rise by **12%**
at the optimum, by 26% at four fins and by 57% at eighteen. But the honest headline is that
**adding fins suppresses radiation**, which is the point §2.2 is really making and is not
visible from the coefficient table alone.

**The air is transparent, and that is what makes this affordable.** Nitrogen and oxygen are
homonuclear diatomics with no dipole moment, so they neither absorb nor emit in the infrared:
air is a *non-participating* medium at these temperatures over these path lengths. There is
therefore **no volumetric radiative term and nothing to solve in the fluid region** — the sink
does not exchange radiation *with* the air, it radiates *through* it. Radiation is entirely a
boundary phenomenon, which is exactly why it can be added without going anywhere near a fluid
solve.

**The model: grey-diffuse surfaces, in an enclosure closed by a fictitious opening.**

Each fin channel is treated as an enclosure bounded by the two facing fin flanks, the strip of
base between them, and a **fictitious surface across the channel mouth**, held at
*T*<sub>∞</sub> with ε = 1 — a black window onto the room. That closes the enclosure, so the
standard radiosity system applies:

  *J*<sub>i</sub> = ε<sub>i</sub> σ*T*<sub>i</sub>⁴ + (1 − ε<sub>i</sub>) Σ<sub>j</sub> *F*<sub>ij</sub> *J*<sub>j</sub>,
  and the net flux off surface *i* is *q*<sub>i</sub> = *J*<sub>i</sub> − Σ<sub>j</sub> *F*<sub>ij</sub> *J*<sub>j</sub>

Outer flanks of the end fins and the exposed top of the base see the room directly, *F* = 1.

**View factors are exact in two dimensions**, by Hottel's crossed-strings construction — no ray
tracing, no numerical quadrature, no sampling error. This is the second place where being
genuinely 2-D pays rather than costs.

**Two consequences that change the exercise, not just the numbers.**

1. **Radiation gets an optimum of its own, for a different reason than convection.** As the
   channel narrows, a fin flank sees mostly *the other fin* — at nearly its own temperature —
   instead of the room. The view factor to the mouth collapses, and the net radiative loss
   collapses with it. So there are now **two independent mechanisms** driving §10's curve back
   up, and they are not the same mechanism wearing two hats: one is the air failing to move, the
   other is the fins hiding each other from the room.
2. **Surface finish becomes a design variable, and *how much* it is worth depends on the fins.**
   Bare to anodised is a factor of sixteen on ε. On an unfinned plate that is worth **36% off
   the temperature rise**; on the tightly finned nominal sink, **8%** — because the fins have
   hidden each other and there is less room left to radiate at. The two mechanisms interact
   rather than adding up, and the page should show that rather than quote the flattering number.
   Past the optimum, anodising still beats adding fins — which by then make the sink *worse* —
   but it beats them by single digits, not by a factor.

**What this costs in the solve.** The radiative flux goes as *T*⁴, so the problem becomes
mildly nonlinear and needs a Picard or Newton loop — a handful of iterations from a
convection-only initial guess. The radiosity system is small: it lives on the boundary, not the
domain, and one channel's enclosure is a few dozen surface elements.

**Declared, and still not modelled:** the flow field, buoyancy, spectral or specular surface
behaviour (grey-diffuse is an assumption and gets stated), and the spreading resistance of a
device smaller than the base — a real effect, and the natural second version of this page.

---

## 3. Boundary conditions

| Boundary | Condition |
|---|---|
| Base, under the device footprint | heat flux *q*″ = *Q* / (footprint × depth), or a fixed base temperature at model level 2 |
| Base, outside the footprint | convection **and** radiation, or adiabatic if the sink is mounted flush — a choice the page exposes, because the two differ more than a visitor expects |
| Fin flanks, tips and exposed base | *h*(*T* − *T*<sub>∞</sub>) + *q*<sub>rad</sub>, with `h` from §2.1 and *q*<sub>rad</sub> the radiosity net flux from §2.2. **One combined flux, two mechanisms**, and §7 reports the split |
| Channel mouth | not a solid boundary: the fictitious black surface at *T*<sub>∞</sub> that closes the radiative enclosure. It carries no conduction condition |
| Lateral symmetry planes | adiabatic for conduction, and **mirrored for radiation** — a symmetry plane reflects, so a channel solved once must not lose the radiation that would have come from its neighbour |

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
so that *k* is visibly not the whole story), and **surface finish**, which sets ε: mill finish
(≈ 0.05), clear anodised (≈ 0.6), black anodised (≈ 0.8). The finish sits in *Design* rather
than *Advanced* deliberately — §10's second lesson is that it competes with fin count, and a
parameter buried behind a disclosure triangle cannot compete with anything.

**Conditions** — dissipated power *Q*, ambient temperature *T*<sub>∞</sub>, the surrounding
surface temperature if the page lets it differ from the air (it usually should not, and saying
why is worth a line), and the cooling mode: natural, or forced with a face velocity.

**Advanced** — mesh size; whether `h` is taken from the correlation or overridden by hand; and
**a switch that turns radiation off**. Both overrides exist for the same reason: so a visitor
can see what the simpler model would have told them, and by how much it was wrong.

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
| **radiative fraction** *Q*<sub>rad</sub>/*Q* | 1 | derived, from the radiosity solve |
| **view factor to the room**, channel-averaged | 1 | derived, from the view-factor matrix |

The last two exist because §2.2 introduced a mechanism the visitor cannot see in the temperature
field. The radiative fraction is the number that makes the finish argument concrete — it moves
from a few percent to nearly half as the sink is anodised — and the view factor to the room is
what falls as the channels narrow, which is *why* radiation stops paying. Reporting the second
turns §10's curve from a result into an explanation.

---

## 8. Verification

| Check | What it compares | Expected |
|---|---|---|
| **Analytic — fin theory** | η against the straight-fin result η = tanh(*mL*<sub>c</sub>)/(*mL*<sub>c</sub>), *m* = √(2*h*/*k t*), *L*<sub>c</sub> = *H* + *t*/2 | agreement within a few percent at nominal, where the fins are short and stubby (η ≈ 0.96) and 1-D fin theory is at its best. **The check earns its keep at the other end**: tall thin fins drive η down, and that is where a 2-D solve and 1-D theory should start to separate — the page should show where they do |
| **Limiting case** | a bare plate, *N* = 1 | *R*<sub>θ</sub> = 1/(*hA*) exactly, since there is no fin left to be inefficient |
| **Energy balance** | *Q* in against convective **plus** radiative flux out, integrated over the whole exposed boundary | closes below 1%. With §2.2 in, this row now checks the radiosity solve as well, and a view-factor bug shows up here as a leak |
| **Analytic — radiation, two limits** | a tall narrow channel against the infinite-parallel-plate result *q* = σ(*T*₁⁴ − *T*₂⁴)/(1/ε₁ + 1/ε₂ − 1); and a single flat plate against εσ(*T*⁴ − *T*<sub>∞</sub>⁴) | both exact, and they bracket the model — one where the fins see only each other, the other where a surface sees only the room |
| **View factors — algebraic identities** | the summation rule Σ<sub>j</sub>*F*<sub>ij</sub> = 1 on every surface, and reciprocity *A*<sub>i</sub>*F*<sub>ij</sub> = *A*<sub>j</sub>*F*<sub>ji</sub> | **machine precision**, and free. No reference solution is needed: a crossed-strings matrix that fails either identity is wrong, full stop. This is the cheapest verification row in the lab |
| **Limiting case — radiation off** | ε → 0 against the convection-only solve | identical to solver tolerance, which is what the *Advanced* switch in §5 exposes to the visitor as well |
| **Cross-adapter** | `mock.heat2d` against `dolfinx.heat2d` | upstream already cross-validates these two. **§2.2 costs part of this row**: the check now covers the conduction-and-convection core, not the radiative boundary, since neither upstream adapter has one. Saying which part of a page is covered by an inherited check is the point of the row |
| **Convergence** | mesh size halved, and the boundary discretisation of the radiosity enclosure refined | change in *T*<sub>max</sub> below the tolerance the page declares. The second is separate: the radiosity system has its own resolution, and it converges at a different rate from the volume mesh |

**Two rows here are worth more than they cost.** The view-factor identities are exact algebra
with no reference solution required, which makes them the strongest cheap check in the lab. And
the cross-adapter row is now *partial* — which is a better outcome than it sounds, because a
verification section that quietly claims coverage it lost is the failure mode §8 exists to
prevent.

---

## 9. Save result

The run row per [§5 of the contract](../exercise-contract.md#5-the-run-table). `geometry.source`
is `parametric`; `physical` carries the six design parameters, the power, the ambient and the
cooling mode; `numerics` carries the mesh size and the radiosity discretisation. **`physical`
must also record the `h` the correlation produced and which correlation produced it, ε and the
finish it came from, and whether radiation was on** — a run is not reproducible from the
geometry alone once a correlation stands between the geometry and the boundary condition, and a
run with radiation switched off is a different physical model rather than a different setting.

---

## 10. The number this exercise exists to produce

**The fin count at which the sink stops improving**, and the visitor finding that it is a
number rather than a direction.

Sweep *N* at fixed mass and the curve turns: thermal resistance falls while added surface wins,
flattens, and rises once the channels are too narrow. The minimum is the answer, and it moves —
to higher *N* under forced convection, to lower *N* as the fins get taller.

**It turns for two separate reasons, and the page should let the visitor take them apart.** The
air stops moving through a narrow channel, so `h` falls; and the fins start seeing each other
instead of the room, so the radiative loss falls too. They are different mechanisms with
different remedies, and the *Advanced* switches isolate each: pin `h` constant and one cause
goes away, turn radiation off and the other does. Run the sweep three times and the visitor has
decomposed their own design problem — which is more than the optimum itself is worth.

**The second result is the one worth remembering, and it only exists because of §2.2.** Take a
sink past its optimum fin count and ask what to do next. Adding fins now makes it *worse*.
Anodising it makes it better and costs no metal at all — so past the optimum the finish is the
only lever left, which almost nobody expects.

**And the built solver sharpened that lesson into a better one.** The finish is worth 36% of the
temperature rise on an unfinned plate and 8% on the tightly finned sink, because the fins that
were added to help convection have simultaneously hidden the surface from the room. *The two
mechanisms are not independent, and improving one degrades the other* — which is a more useful
thing to have learned than either curve alone, and it is what the three overlaid sweeps show.

---

## 11. What this needs that does not exist yet

**Still nothing that has to be waited for**, which is why this remains the right exercise to
build while [#100](https://github.com/mandaloriat/fenix-spoon/issues/100) and
[#101](https://github.com/mandaloriat/fenix-spoon/issues/101) sit upstream. But §2.2 changed
what has to be *written*, and the change is worth stating plainly rather than leaving as a
surprise for whoever builds it.

1. **Radiation means the lab writes a solver after all — `lab.heatsink2d`.** An earlier draft of
   this specification called the heat sink the first exercise needing no solver of its own.
   **That is no longer true, and the reason it stopped being true is a good one.** Upstream's
   heat adapters declare `no_radiation` and take `h` as a plain coefficient; a radiative
   boundary condition with a radiosity enclosure and a *T*⁴ nonlinearity is physics they do not
   have and do not claim to.

   That satisfies the test [ADR-014](../architecture-decisions.md#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first),
   [ADR-018](../architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force)
   and [ADR-019](../architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)
   set — *a solver of the lab's own only when the physics a metric needs is missing, never to
   demonstrate the adapter contract* — and it satisfies it on the first clause rather than by
   argument. It also dissolves the question the earlier draft left open: the four derived
   metrics can now ride in the lab solver's own `metrics` because there is a lab solver for
   honest reasons, not because one was invented to carry them.

   **The cost is real and should not be waved through.** The exercise loses the cross-adapter
   verification row for its radiative half (§8 says so), and it gains a nonlinear solve to
   maintain. Whether upstream would want a radiative boundary condition in `dolfinx.heat2d` is
   a reasonable question to raise *after* this works — same sequence as the plate element in
   [the modal proposal](../proposals/mindlin-plate-and-modes.md): build it where its benchmark
   is, offer it afterwards with evidence attached.

2. **The convection correlation needs a citation, not a reconstruction.** §2.1 names the
   families; the coefficients and their validity range must come from a source that can be cited
   on the page.

3. **Emissivities need one too.** The ε values in §2.2 are the right order and are good enough
   to specify against, but a page that lets a visitor choose a finish is quoting material data
   and should say where it came from. Anodised aluminium in particular varies with coating
   thickness far more than the single number in §5 suggests.

Items 2 and 3 are the only parts of this exercise that cannot be finished from inside the
repository.

---

## 12. Order, and an honest estimate

**Bigger than the earlier draft claimed, and still the smallest thing on the board.** That draft
had the conduction solve arriving free from upstream and the lab writing only a page. §2.2 adds
a solver: a radiosity system on the channel enclosure, crossed-strings view factors, and a
Picard loop around the conduction solve. None of it is research — the view factors are a closed
formula in two dimensions and the enclosure is a few dozen elements — but it is a few hundred
lines with tests, where before it was none.

Set against the mirror's plate element, it is still much the cheaper piece of work, and unlike
the plate it is blocked on nothing.

Build order within the exercise: **the view-factor matrix first**, because §8's summation and
reciprocity identities verify it at machine precision before any heat is solved. A radiosity
bug found after the temperature field looks plausible is expensive; found against an algebraic
identity, it is free.

**Two risks, both of the same kind — a shortcut that leaves the page looking finished.**

- The correlation gets treated as a detail and the page ships with constant `h`. Then §10's
  curve never turns and the question on the home page card still has no answer.
- Radiation gets deferred "for version two". Then the nominal case over-predicts the temperature
  rise by tens of percent, the finish control has nothing to do, and the exercise teaches that
  fin count is the only lever — which is the specific wrong lesson §2.2 exists to prevent.
