# Exercise 3 — The magnetic circuit

**Status:** *built.* `lab.magnetics2d` computes and checks every metric this document's §1
asked for, and the page at `frontend/experiments/solenoid/` is an exercise: a challenge with
three targets, headline tiles, a metrics table, five verification residuals, per-run validity,
the mid-plane curves, the measurement surfaces as annotation layers, and a run table. §6 lists
what is left, which is the C-core and the force that needs it.
**Implements:** [the exercise contract](../exercise-contract.md).
**Contract row:** *Electromagnet gap*, [§7](../exercise-contract.md#7-the-five-exercises) —
and see §5 below, which is why that row's challenge has changed.
**Decision record:** [ADR-018](../architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force).

---

## 0. What changed, and why this document was rewritten

The previous version of this file was a refusal. It said that every metric a magnetic design
is judged on has a definition that is unambiguous in three dimensions and *needs a decision*
in a two-dimensional slice, that none had been made, and that a page printing "core flux
3.2 mWb" without having made them would be inventing a number the model does not produce.

That was the right call and it has now been discharged: the decisions are made, they are
below with the measurements behind them, and a solver computes them. One of them came out the
opposite way from what §1 predicted, which is recorded here rather than quietly corrected —
it is the most useful thing in the document.

---

## 1. The metrics, as settled

Each row states what is reported, the definition that was verified, and what the decision
turned on. Every one is in `report.json` on every run.

| Metric | Symbol | Unit | Definition | What was decided |
|---|---|---|---|---|
| Core flux | Φ′ | Wb/m | The drop in *A<sub>z</sub>* across the core's mid-plane, taken between the core's own two faces | Per unit *depth*, because a 2-D slice has no length. Computed twice — once from the potential, once by integrating the reconstructed **B** along the same surface — and the gap is a reported residual. |
| Mean flux density | *B̄* | T | Φ′ divided by the core's width | Trivial once Φ′ is settled, and it is the number a magnetic circuit is sized against. |
| Worst section | *B*<sub>sec</sub> | T | Flux density averaged across a section of the core, maximised over every section along it | **The saturation number**, and not a peak. See §2 — this is the row where the specification was wrong. |
| Leakage ratio | — | 1 | 1 − Φ′<sub>core</sub> / Φ′<sub>bundle</sub>, where the bundle runs between the two points on the mid-plane at which *B<sub>y</sub>* changes sign | §3. Neither of the two candidate surfaces the old version weighed; a third that is stationary in its own placement. |
| Ampere-turns | *NI*′ | A | ∫ *J<sub>z</sub>* d*A* over the positive winding | Exact, and needs no solve — as the old version said. It is reported now because the rest are. |
| Stored energy | *W*′ | J/m | ½ ∫ **B**·**H** d*A* over the window | Reported *with* the share of itself that lies against the outer boundary, which is the number that says whether the window is big enough for it (§4). |
| Permeance | Φ′/*NI*′ | H/m | Core flux per ampere-turn | The magnetic circuit's own figure of merit: multiply by turns squared and by depth to get an inductance. |
| Peak flux density | — | T | — | **Withheld.** §2. |
| Gap force | — | N/m | — | **Withheld.** §5. |

## 2. The peak that does not converge

The old §1 said this about the peak flux density: it is *"already computed upstream as the
declared metric `b_max` — but over the whole domain, including the winding corners, where the
mock solver's staircased regions produce a grid artefact rather than a physical peak.
Restricting it to the core, and showing that the restricted value converges, is the work."*

The restriction was made and the value does not converge. On a grid fitted to the interfaces,
with no staircase anywhere, the peak inside the iron reads:

| Cell size | Peak in the iron | Worst section |
|---|---|---|
| *h* | 0.148 T | 0.12852 T |
| *h*/2 | 0.185 T | 0.12831 T |
| *h*/4 | 0.230 T | 0.12821 T |
| *h*/8 | 0.290 T | 0.12818 T |

The peak climbs by a steady factor of about 1.25 per halving of the cell. That is not a
discretisation error being resolved away; it is a corner singularity of the *exact* solution,
and a finer mesh simply gets closer to it. The staircase was never the reason.

Nor can restricting the search to the iron help, and the reason is the reverse of what the
specification assumed. Tangential **H** is continuous across the iron's surface, so **B** just
inside the corner is *μ*<sub>r</sub> times **B** just outside it: the peak flux density in this
model is *always* in the iron, whatever the geometry. There is nowhere to move the restriction
to.

So the pointwise peak is withheld — named in the report's `withheld` list, so its absence is a
statement — and the saturation warning is read from the worst *section*, which is an integral
of the field rather than a sample of it. The singularity has no weight in an integral, and the
section average settles to four figures over the same refinements. It is also the physically
right question: iron saturates when a whole section of it runs out of flux-carrying capacity,
not when one corner does.

`test_the_section_average_converges_where_the_pointwise_peak_does_not` asserts both halves,
deliberately. If the peak ever starts converging, the stated reason for withholding it has
gone away and the test should fail.

## 3. Where the leakage is measured against

The old §1: *"Needs a stated pair of surfaces. Two reasonable choices differ by ~10 % on the
default geometry, so the definition must be fixed and drawn on the diagram before a number is
shown."*

Both were right about the ambiguity and both are avoidable. Walk along the mid-plane and watch
*A<sub>z</sub>*: it falls while the flux is crossing upward, turns over where *B<sub>y</sub>*
changes sign, and rises back to zero at the wall. The flux between its maximum and its minimum
is therefore the entire bundle crossing that plane in one direction, and the surface it is
measured over ends exactly where the integrand vanishes — so moving the surface changes the
answer at *second* order, where a surface placed anywhere else changes it at first.

That is why this definition does not have to be defended and the other two do. The number it
produces is also stable where the quantity it is a share of is not: widening the window from
60 mm to 480 mm moves the core flux by 27 % and the leakage ratio by 2 % (1.72 % to 1.68 %).

Both ends of the bundle are in the report as `validity.bundle_x`, so the page can draw them on
the diagram — which the old version asked for and was right to.

## 4. Validity, per run

Every warning names the threshold crossed and the consequence.

- **Saturation.** The worst section past the material's saturation flux density. Read from the
  core region's own `b_sat` material key when it declares one — a ferrite saturates near 0.4 T
  and a cobalt-iron near 2.3 T — and 1.5 T otherwise. The protocol's material dict is an open
  bag of scalars precisely so a solver can read one more key, and a solver that does not know
  it ignores it.
- **Window truncation.** The share of the stored energy lying in the outer twentieth of the
  window, warned above 1 %. Calibrated rather than guessed, on the default cross-section:

  | Half-window | Energy against the wall | Core flux | Cells |
  |---|---|---|---|
  | 60 mm | 7.55 % | −2.567 mWb/m | 10 379 |
  | 90 mm | 4.11 % | −3.055 mWb/m | 11 639 |
  | 120 mm | 2.53 % | −3.250 mWb/m | 12 519 |
  | 180 mm | 1.22 % | −3.398 mWb/m | 13 899 |
  | **240 mm** | **0.72 %** | **−3.452 mWb/m** | **14 859** |
  | 480 mm | 0.19 % | −3.505 mWb/m | 16 875 |

  At 0.7 % the flux is within 1.5 % of its value in a window twice as large; at 7.6 % it is
  27 % adrift. The page sizes its window at **eight times the magnet's half-extent** — the
  bolded row for the default cross-section — which clears the threshold in every configuration
  the sliders can reach.

  Read the last column too, because it is why this was affordable at all. Widening the window
  eightfold costs **43 % more cells**, not sixty-four times as many, and that is two decisions
  in `magnetics.py` rather than good luck: the cell count is set *across the regions* rather
  than across the window, and the cells grow geometrically out in the air. Without the second,
  the 240 mm window would be 413 445 cells instead of 14 859 — twice the public server's whole
  budget for one solve.
- **A wire rather than a coil.** A net current out of the plane has a field that falls off as
  1/*r* instead of closing, and the *A<sub>z</sub>* = 0 boundary is then doing the work the far
  field should.
- **A region that is not a rectangle.** Still solved; the material boundary is staircased onto
  the cells rather than falling on them, and any number read near it inherits that.
- **An unfinished solve.** The linear residual against the tolerance asked for. This is the
  failure mode a fixed-iteration solver cannot report at all, which is half the reason the
  exercise has a solver of its own.

## 5. The gap force, and why the challenge changed

The contract's §7 sets this exercise's challenge as *"produce a required gap force at minimum
current"*. This cross-section cannot pose that problem, and the reason is not numerical: a
straight bar core between two opposed windings is symmetric, so the net force on it is exactly
zero. Any number reported for it would be rounding error dressed as an answer.

A gap force needs two things this increment has neither of: a **C-core and an armature**, so
that there is a working gap to pull across, and — to obtain it by differencing the stored
energy at neighbouring gaps — the **study object** upstream's
[#48](https://github.com/mandaloriat/fenix-spoon/issues/48) provides. (Maxwell stress on a
contour would give the force from a single solve, and it would still give zero here, because
zero is the right answer for a symmetric body.)

So the challenge this exercise poses is the one this cross-section genuinely does pose, and
the one a transformer or actuator designer meets first:

> Reach a required flux density in the core using the fewest ampere-turns, without saturating
> the iron and without letting the leakage take over.

Every metric it needs is computed and verified. The contract's §7 row is revised to match, and
[ADR-018](../architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force)
records why rather than letting the table quietly change.

## 6. What remains

| Piece | State |
|---|---|
| `lab.magnetics2d`: interface-fitted graded grid, metrics, five verification residuals, six validity warnings, `report.json` | **built** — `physics_lab/solvers/magnetics.py`, `solenoid.py`, `magnetics2d.py` |
| Proof it is right: manufactured solution across a permeability jump, second-order convergence on a uniform *and* a graded grid, Ampère's law, energy balance, linearity, symmetry | **built** — `tests/test_magnetics_method.py`, `tests/test_magnetics_solver.py` |
| A window sized from the magnet, and a grid that makes it affordable | **built** — §4, and `WINDOW_RATIO` in the page's `app.js` |
| `content.json` with a `challenge`, and the `METRICS` / `KPIS` / `CHECKS` tables the shared renderers read | **built** — the same data structures the airfoil supplies |
| The mid-plane curves through `shared/curve.js`; the flux surface, the bundle edges and the Ampère contour as annotation layers | **built** — every reported number has its surface drawable |
| `Keep result`, the run row, compare and export | **built** — `shared/runs.js`, as the airfoil uses it |
| Gap force, and the C-core cross-section that would make it meaningful | **not built**, §5 |
| A study group — none of the metrics needs one, and the page says so rather than leaving an empty panel | **not applicable**, §5 |

## 7. Where the numbers come from

Same answer as the airfoil, and for the same reason: protocol 1.2's envelope has nowhere to
put a computed metric, so a lab solver returns the field, restricts `stats` to cost, and writes
a declared `report.json`
([contract §6](../exercise-contract.md#6-what-a-solver-has-to-return-on-protocol-12),
[ADR-015](../architecture-decisions.md#adr-015--the-run-table-lives-in-the-browser-and-fenix-spoon-owns-the-record)).

The old version of this document predicted that these metrics could not be computed in the
browser from what `mock.magnetostatics2d` returns, because a line integral of **B** across the
core's mid-plane would be wrong in exactly the place it matters — at the iron/air interface,
which the mock staircases. That was right, and it turned out to understate the case: the mock
never sees the core at its drawn width at all (20.339 mm, then 20.168, then 20.084 for a 20.000
mm core), and at high resolution it exhausts its iteration ceiling and returns a flux 26 %
adrift with no residual to say so. The honest route was a lab adapter that integrates on its
own discretisation, and that is what was built.
