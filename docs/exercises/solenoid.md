# Exercise 3 — Electromagnet gap (specification in progress)

**Status:** *not built.* The page at `frontend/experiments/solenoid/` is a **demonstration** and
says so on itself. It has the exercise shell — workspace, toolbar, progressive controls, folded
didactics — and none of the exercise, because an exercise needs metrics and this document is
where the metrics have to be settled first.
**Implements (eventually):** [the exercise contract](../exercise-contract.md).
**Contract row:** *Electromagnet gap*, [§7](../exercise-contract.md#7-the-five-exercises).

---

## 0. Why this page is not an exercise yet

The contract's §1 is explicit: a section that does not apply is **absent**, not invented. An
exercise is a quantitative target under constraints, and a target has to be set in a metric.
The magnetics page currently reports the field and what the solve cost, and that is everything
it can stand behind.

It would be easy, and wrong, to ship a target now. Every candidate metric below has a
definition that is unambiguous in three dimensions and *needs a decision* in a
two-dimensional slice, and a page that printed "core flux 3.2 mWb" without having made that
decision would be inventing a number the model does not produce. The airfoil exercise refused
to print a lift coefficient until the model had a Kutta condition
([ADR-014](../architecture-decisions.md#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first));
this is the same refusal.

What the redesign did instead: brought the page into the same shell, marked the extension
points, and wrote this down.

---

## 1. The metrics an exercise here would need

Each row states the quantity, the definition that would have to be verified, and what makes it
non-obvious in 2-D. **None of these is implemented, and none should be until its row is
resolved.**

| Metric | Symbol | Unit | Definition to verify | What is not yet settled |
|---|---|---|---|---|
| Core flux | Φ′ | Wb/m | ∫ **B**·**n** d*s* across the core's mid-plane, per unit depth | The 2-D solve is per unit depth, so this is a flux *per metre*, not a flux. With *A<sub>z</sub>* = 0 on the outer boundary, Φ′ between two points equals *A<sub>z</sub>*(1) − *A<sub>z</sub>*(2) exactly — which is a clean definition and needs checking against a direct integration of **B** on the discrete field. |
| Mean flux density in the core | *B̄* | T | Φ′ divided by the core's width | Trivial once Φ′ is settled, and only meaningful if the flux is confined to the core, which is exactly what the exercise would be about. |
| Peak flux density | *B*<sub>max</sub> | T | max \|**B**\| over the iron | Already computed upstream as the declared metric `b_max` — but over the **whole domain**, including the winding corners, where the mock solver's staircased regions produce a grid artefact rather than a physical peak. Restricting it to the core, and showing that the restricted value converges, is the work. |
| Leakage ratio | — | 1 | 1 − (flux through the core mid-plane) / (flux through the winding's own aperture) | Needs a stated pair of surfaces. Two reasonable choices differ by ~10 % on the default geometry, so the definition must be fixed *and drawn on the diagram* before a number is shown. |
| Ampere-turns | *NI*′ | A | ∫ *J<sub>z</sub>* d*A* over one winding | The one metric that is already exact and needs no solve at all — the page computes it in the browser today for its own caption. It becomes a *reported* metric the moment the others do, not before, because a metrics table with one entry teaches that the rest are unavailable rather than unbuilt. |
| Stored magnetic energy | *W*′ | J/m | ½ ∫ **B**·**H** d*A* over the domain | Depends on the truncation: *A<sub>z</sub>* = 0 at the boundary confines the field, so the integral is over the *window* and not over space. It converges as the window grows, and the exercise would have to report that convergence rather than a single number. This is the one that most needs a study, and it is the one a gap-force exercise ultimately rests on. |
| Gap force | *F*′ | N/m | −∂*W*′/∂*g* at constant current | Requires two solves at neighbouring gaps, i.e. the study object the contract's §5 describes and upstream's [#48](https://github.com/mandaloriat/fenix-spoon/issues/48) provides. The contract's §7 row for this exercise is *"produce a required gap force at minimum current"*, so this is the metric the challenge would be set in — and it is the furthest from being available. |

### The verification each would need

Per [the contract §3](../exercise-contract.md#3-verification-is-a-number), an exercise ships at
least one check reported as a number. The two available here:

- **Magnetic-circuit estimate.** ℛ = Σ *l*/(*μA*) around the core-and-air loop gives Φ′ in
  closed form for a long, thin, high-permeability core. Report the relative difference. It is a
  *band* rather than an equality — the estimate ignores fringing entirely — and the tolerance
  has to be stated asymmetrically, the way the airfoil's thin-airfoil comparison is
  ([airfoil.md §8.3](airfoil.md)).
- **Energy balance.** ½∫**B**·**H** d*A* computed from the field against ½∫**A**·**J** d*A*
  computed from the sources. The two are equal for a linear medium and share the solution but
  not the arithmetic, which is the same structure as the airfoil's circulation-versus-pressure
  check and the reason that one is the headline residual there.

### The validity warnings it would need

- **Saturation.** Above roughly 1.5 T for common steels a linear μᵣ stops describing iron. The
  page says this in prose today; an exercise has to say it *per run*, naming the threshold and
  the consequence, and must block the challenge when it fires.
- **Window truncation.** *A<sub>z</sub>* = 0 confines the flux. If a stated fraction of the
  energy lies near the boundary, the window is too small for the number being reported.
- **Non-linearity of the source.** Doubling the current density doubles every field exactly;
  that is a property of the model and not of iron, and an exercise that asks for a force at a
  given current has to say so where the current is set.

---

## 2. What already exists, and what the shell is waiting on

| Piece | State |
|---|---|
| Geometry, controls, cross-section diagram | built, and unchanged by the redesign |
| Workspace, toolbar, probe, zoom, export, region overlay | built (shared with the airfoil) |
| Solver filter by declared `physics` | built — this is what stopped a heat-sink solver appearing in the magnetics menu |
| `Keep result` button | present and **disabled**, with its reason, in the action bar |
| Metrics table, verification panel, validity panel, challenge banner | shared code exists (`shared/exercise.js`) and is not wired here |
| Result panel | reports the cost of the solve only, plus a sentence saying why there is no more |

The shell is deliberately complete and the physics deliberately absent, so that building the
exercise is a matter of supplying `content.json` with a `challenge`, a `METRICS` table and a
`CHECKS` table — the same three data structures the airfoil supplies — plus a solver that
returns them.

## 3. Where the numbers would have to come from

Same answer as the airfoil, and for the same reason: protocol 1.2's envelope has nowhere to put
a computed metric, so a lab solver returns the field, restricts `stats` to cost, and writes a
declared `report.json`
([contract §6](../exercise-contract.md#6-what-a-solver-has-to-return-on-protocol-12),
[ADR-015](../architecture-decisions.md#adr-015--the-run-table-lives-in-the-browser-and-fenix-spoon-owns-the-record)).

That has a consequence worth stating: the metrics above cannot be computed in the browser from
what `mock.magnetostatics2d` returns. A line integral of **B** across the core's mid-plane could
be approximated from the sampled grid, and it would be wrong in exactly the place it matters —
at the iron/air interface, which the mock solver staircases. The honest route is a lab adapter
(`lab.magnetics2d`) that integrates on its own discretisation and reports the result, the way
`lab.airfoil_panel2d` does. That is the next increment, and §1 is its acceptance criteria.
