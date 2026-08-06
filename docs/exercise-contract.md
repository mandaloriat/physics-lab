# The exercise contract

Every page in this lab is an **exercise**: a quantitative objective under constraints, a
model whose assumptions are written down, a result that can be judged right, wrong or
improvable, and a verification number that says how much the result can be trusted.

That is a change of kind, not of degree. The lab's first two pages asked *"what changes in the
field?"* (airfoil) and *"what does the core do?"* (solenoid) — guided demonstrations, in which
there is nothing a visitor can get wrong, so there is nothing to compare and nothing to improve.
This document defines the shape an exercise page has instead. Three pages are built to it —
the airfoil, the magnetic circuit and the bridge — and §7 lists what the remaining ones would
need.

Nothing here changes the architecture. It changes what a page *is for*, which then decides
what `content.json` carries, what the parameter panels are allowed to mix, and what a solver
has to return.

---

## 1. The nine sections

Each exercise page presents these, in this order. A section that does not apply is **absent**,
not invented.

| # | Section | What it must contain | What it must not do |
|---|---|---|---|
| 1 | **Problem** | A quantitative objective and its constraints, with numbers and units. A pass/fail condition. | Ask an open question with no answer ("how does the field change?"). |
| 2 | **Model** | Governing equations, domain, material laws, units, and the assumptions in force. | Leave an assumption implicit, or claim a quantity the equations cannot produce. |
| 3 | **Boundary conditions** | Every boundary of the domain, named, stated as an equation, and marked on a diagram. | Show a domain with unlabelled edges. |
| 4 | **Initial conditions** | Only for a transient problem: the state at *t* = 0. | Exist at all in a steady problem. A steady solve has no initial condition, and inventing one to fill the section is a lie about the model. |
| 5 | **Physical inputs** | The quantities that describe the physical situation, in SI, with ranges. | Contain a mesh size, a tolerance, an iteration count or a panel count. |
| 6 | **Fields** | The visual result: what to look at and how to read it. | Be presented as the answer. |
| 7 | **Engineering metrics** | The answer: named scalars with symbols, units and definitions. | Mix in what the solve *cost*. |
| 8 | **Verification** | At least one independent check, reported as a *number*: analytic solution, conservation balance, convergence study, or published benchmark. | Assert correctness without a residual. |
| 9 | **Save result** | One comparable, reproducible row in the run table. | Save only the numbers that happen to be on screen. |

### Why 5 is separate from the numerics

`velocity 40 m/s` is a fact about the problem. `mesh size 0.02` is a choice about how to
approximate it. Putting them in one panel teaches that they are the same kind of thing, and
they are not: change the first and the answer *should* change; change the second and the
answer should *not* — and if it does, that is the convergence error, which is section 8's
business.

So an exercise page has **three** parameter groups, visually and structurally separate:

- **Physical inputs** — the problem statement (§5).
- **Numerical settings** — discretisation, iteration limits, tolerances, domain truncation.
  Every one of them is a knob whose only correct effect is on the error.
- **Study** — what to run: a single point, a sweep, a convergence ladder. Some metrics are
  only definable over a study (an aerodynamic centre needs more than one incidence), so this
  group decides which metrics are available at all.

### Why 7 is separate from `stats`

Fenix Spoon already draws this line, and the lab should not blur it: `stats` is what the
solve cost (`cells`, `dofs`, `iterations`, `seconds`), and metrics are the engineering
answer. Upstream's `MetricSpec` says it in as many words — *"an operator reads `stats` to
size a machine, an engineer reads metrics to make a decision, and a caller that has to guess
which is which cannot do either"*. The lab's result panel therefore has two tables, not one:
**Answer** and **Cost**.

---

## 2. The challenge, and how a page knows you met it

Section 1 is machine-checkable. `content.json` carries the objective as data, so the page can
say *target met* or *not met* instead of leaving the visitor to compare two numbers by eye:

```json
{
  "challenge": {
    "statement": "Pick a NACA profile and an incidence that generate 800 N/m of sectional lift, keeping |C_m,c/4| below 0.08, without leaving the model's domain of validity.",
    "targets": [
      { "metric": "l_prime", "comparator": "==", "value": 800, "unit": "N/m", "tolerance": 0.02, "tolerance_kind": "relative" },
      { "metric": "c_m_c4", "comparator": "<", "value": 0.08, "unit": "1", "absolute": true }
    ],
    "requires_valid": true,
    "requires_verified": { "metric": "cl_consistency_rel", "below": 0.02 },
    "next_step": "a different profile at a different incidence"
  }
}
```

Three rules make this honest rather than a game:

1. **`requires_valid`** — a run that raised a validity warning cannot pass, however good its
   numbers look. Hitting the target with a model that does not apply is the failure mode the
   lab exists to prevent.
2. **`requires_verified`** — a run whose verification residual is above the stated threshold
   cannot pass either. A converged wrong answer is still wrong.
3. The page reports *met / not met / not applicable* per target, and never rewrites the
   target. There is no partial credit and no encouragement.

`absolute: true` compares the magnitude, and it has to be asked for. Inferring it from the
comparator is how `|C_m| < 0.08` silently becomes `C_m < 0.08`, which every nose-down profile
passes however large its moment — a bug this contract had until a real run walked into it.

`next_step` names the second route to the same target in the exercise's own terms — it is the
one clause of the met-target banner that cannot be shared, because "a different profile at a
different incidence" is nonsense advice on a magnetic circuit. The renderer holds no exercise
vocabulary of its own: an exercise that omits the field gets the banner one clause shorter,
never another exercise's wording.

A target's verdict is about its own number, and whether the *run* counts is a separate
question answered once: a satisfied target still reads as satisfied on a disqualified run, and
the disqualification is stated on its own line. Marking a good number with a cross because
something else was wrong tells the visitor the wrong thing.

### The rest of `content.json`

Sections keep the existing shape (`id`, `heading`, `body`, `steps`, `caution`), so
`renderLesson` needs no rework, and gain the section ids the contract names: `problem`,
`model`, `boundary-conditions`, `initial-conditions` (transient only), `inputs`, `fields`,
`metrics`, `verification`, `limits`. The `question` / `what-to-change` / `what-to-watch`
sections of the two existing pages map onto `problem` / `inputs` / `fields`; the prose that
merely narrates a field is dropped rather than migrated.

---

## 3. Verification is a number

An exercise ships at least one of these, and reports it as a quantity with a stated
tolerance:

| Kind | What it looks like | Example |
|---|---|---|
| **Analytic solution** | Solve a case with a closed form and report the relative error. | Flow past a circular cylinder: *C<sub>p</sub>* = 1 − 4 sin²θ. |
| **Balance** | A conservation law the discrete solution should satisfy; report the imbalance. | Heat in = heat out across every boundary. |
| **Convergence** | Same problem at two or more discretisations; report the change in the metric. | *C<sub>L</sub>* at *N* and 2*N* panels. |
| **Benchmark** | A published value for the same configuration; report the difference. | Thin-airfoil *α*<sub>L=0</sub> for a NACA 4-digit camber line. |
| **Consistency** | Two independent routes to the same metric inside one solve; report the gap. | Lift from circulation vs lift from integrated pressure. |

A convergence check alone is the weakest of the five — it shows the discretisation settled,
not that it settled on the right answer — so an exercise that has an analytic case available
must ship it, and the convergence check is additional.

Verification numbers live in the run row (§5). An exercise whose verification residual is
not in its result payload has not implemented section 8.

---

## 4. Validity, stated per run

Every model has a domain of validity, and every exercise computes, per run, whether this run
is inside it. A warning is a first-class output: it appears next to the metrics, it is stored
in the run row, and it blocks the challenge.

The rule is that a warning names the *threshold that was crossed* and the *consequence*, not
a vague caution. "Mach 0.42 exceeds the 0.3 limit of the incompressible assumption:
compressibility would change these pressures" is a warning. "Results are approximate" is
not.

Upstream has no per-run warning channel yet — the result envelope carries `stats`
(`dict[str, float]`), `artifacts` and nothing textual, and formalising warnings is part of
issue #46. Until then the lab's own solvers carry warnings in their result artifact (§6), and
the page derives the rest from the inputs it already has.

---

## 5. The run table

The Save button does not save the screen. It saves a row from which the run can be
**recomputed**, and against which another row can be **compared**.

```jsonc
{
  "schema": 1,                        // run-record schema version
  "saved_at": "2026-07-30T09:12:44Z",
  "exercise": { "id": "airfoil", "version": "1.0.0" },
  "solver": {
    "name": "lab.airfoil_panel2d",
    "version": "1.0.0",
    "fenixspoon": { "version": "0.4.0", "commit": "7c89be3…" },
    "dolfinx": null                   // when the run used a FEniCSx solver
  },
  "geometry": {
    "source": "catalog",              // catalog | parametric | custom
    "label": "NACA 2412",
    "params": { "m": 0.02, "p": 0.4, "t": 0.12 },
    "hash": "sha256:1f3c…",           // canonical hash of the outline as submitted
    "vertices": 208
  },
  "physical": { "…": "every physical input, in SI, no exceptions" },
  "numerics": { "…": "every numerical setting, including the ones left at their default" },
  "dimensionless": { "Re": 2.74e6, "Mach": 0.117 },
  "metrics": { "…": "the engineering answer" },
  "verification": { "…": "one entry per check, each a number" },
  "validity": { "warnings": [] },
  "cost": { "cells": null, "panels": 160, "dofs": 161, "seconds": 0.21 },
  "provenance": { "job_id": "j-8f2a…", "page": "1.0.0", "cached": false }
}
```

Rules:

- **Every input, not the interesting ones.** A row missing a default is not reproducible,
  because the default can change.
- **SI everywhere, converted at the boundary.** A row that stores degrees in one field and
  radians in another is a comparison bug waiting to happen. Angles are the one exception,
  stored in degrees *and* named `_deg`.
- **Geometry by hash.** A dragged outline cannot be described by parameters, so it is stored
  by a canonical hash plus the vertex list, and `Load` restores it exactly.
- **Dimensionless groups are computed, not typed.** Re and Mach are how two rows with
  different chords and speeds become comparable at all.

Actions: `Keep run`, `Load`, `Compare` (two or more rows side by side, differences
highlighted), `Delete`, `Export CSV`, `Export JSON`. Import is not offered — a row from an
older schema would need migration, and this is the wrong place to own that.

### Where it lives, and where it does not

**In the browser: `localStorage`, keyed per exercise, with a stated cap** (oldest evicted,
and the page says so). No server-side store, no accounts, no database.

That is a deliberate boundary. Everything a durable run table needs is already being built
upstream, and building a second one here would be building the wrong half of it:

| What a run table needs | Upstream | Status |
|---|---|---|
| Typed engineering metrics, declared and returned | [#43](https://github.com/mandaloriat/fenix-spoon/issues/43) declares them, [#46](https://github.com/mandaloriat/fenix-spoon/issues/46) returns them | #43 landed; #46 open |
| Compact, queryable results instead of full fields | [#46](https://github.com/mandaloriat/fenix-spoon/issues/46) | open |
| Provenance and a content-addressed cache | [#47](https://github.com/mandaloriat/fenix-spoon/issues/47) | open |
| A study object for sweeps and convergence ladders | [#48](https://github.com/mandaloriat/fenix-spoon/issues/48) | open |

So the lab's row schema is deliberately shaped like where upstream is going — metrics
separate from cost, provenance as its own block, verification as data — and when #46 and #47
land, the browser table becomes a cache in front of them rather than a thing to migrate off.
The lab's job is the exercise; the toolkit's job is the record.

---

## 6. What a solver has to return

The pin is at protocol **1.9**, and the envelope carries the answer. Every field this section
used to route around is now a field, and the `report.json` workaround is retired for anything
written from here.

`ResultEnvelope`, as a client receives it:

| Field | Carries |
|---|---|
| `kind` | `grid2d`, `mesh2d` or `series1d` — a sweep whose answer *is* the curve is a result kind, not an artifact |
| `data` | the field arrays; this is what `<fs-viewer>` draws |
| `stats` | what the solve cost, and only that |
| `metrics` | the engineering answer, declared before the run and filled after it |
| `diagnostics` | `stats`, convergence, residual and warnings — this is where a validity warning lives |
| `provenance` | solver version, environment fingerprint, `cache_key` and `cached` |
| `series` | the curves the solve produced, beside the field rather than instead of it |
| `artifacts` | files by reference, each optionally stamped with an instant `t` |

A solver fills less than that. `SolverResult` — what `solve()` returns — carries `kind`,
`data`, `stats`, `metrics`, `converged`, `residual`, `warnings` and `series`. The server folds
convergence, residual and warnings into `diagnostics` and writes `provenance` itself, because
neither the cache key nor the environment fingerprint is something a solver can know about
itself.

So a lab solver returns:

1. **the field**, as `grid2d` or `mesh2d` — or `series1d` as the result *kind*, when the sweep
   is the whole answer and there is no field to go with it;
2. **`stats`**, still restricted to what the solve cost. `metrics` existing does not make
   `stats` a second metrics bag; the separation is the point of having both;
3. **`metrics`**, the engineering scalars, *declared* as `MetricSpec` on the class so a caller
   learns what a run reports before submitting it, and returned by name;
4. **`series`**, one `Series1DData` per curve, each with its own axis and traces;
5. **`warnings`**, the validity prose, which reaches the client inside `diagnostics`;
6. **artifacts only for what is genuinely a file** — a mesh, a frame, a full time history.

### Two limits, checked rather than advised

| Limit | Value | What it means for an exercise |
|---|---|---|
| `MAX_SERIES_POINTS` | 4096 | a curve is bounded by construction, so a 10⁵-point time history is an artifact and not a series |
| `MAX_FRAMES` | 512 | the number of time-stamped artifacts one result may carry |

### Frames are derived, never declared

A transient result indexes its instants by stamping each artifact with `t`, and `frames_of()`
builds the ordered index from the artifact list. There is no second list to keep in step, and
a frame pointing at a file this result does not serve is unrepresentable rather than a bug to
guard against.

What the index does *not* do is carry the history: the field in the envelope is one instant,
and a peak-over-time quantity is computed in the adapter and returned as a metric rather than
declared as a reduction of a field.

### The default answer omits the arrays

A result is read at seven levels — `status`, `metrics`, `diagnostics`, `provenance`, `series`,
`fields`, `artifacts` — and levels are a list on one request rather than seven round trips.
The default omits `fields` **and** `series`, so a caller that asks for nothing gets an answer
it can read, and the arrays are reached deliberately. A page that wants the picture asks for
`fields`; a convergence script asks for `metrics` and stops.

### What is left of `report.json`

The workaround and the reasoning behind it are recorded in
[ADR-015](architecture-decisions.md#adr-015--the-run-table-lives-in-the-browser-and-fenix-spoon-owns-the-record),
which is a decision record and stays as written.

The three built exercises — airfoil, solenoid, bridge — still write the artifact and their
pages still read it. That is migration work rather than a contract question: each one is a
solver that fills `metrics` and `series` natively plus a page that reads the envelope instead
of fetching a second file, and it is worth doing one exercise at a time. **What a new solver
should not do is add a fourth `report.json` to migrate.**

The field lists above are read off the pinned checkout rather than off a changelog, and
`scripts/check-pins.sh` is what keeps that pin honest.

---

## 7. The exercises

**The number a page shows is its row in this table.** The airfoil's eyebrow reads *Exercise 1*,
the magnetic circuit's *Exercise 3*, the bridge's *Exercise 4* and the heat sink's *Exercise 5*
— which is why the sequence has a gap at 2 rather than a page missing. Stated because it was not
written down anywhere and had to be inferred from three pages agreeing, and because **the two
`P45` specifications number themselves independently**: `capacitive-sensor.md` calls itself
Exercise 5 and `adaptive-mirror.md` calls itself Exercise 6, while their rows here are 7 and 8.
Those two numbers are a pair of cross-references between two documents that were drafted
together, and they are left alone deliberately — renumbering them would touch a dozen citations
to fix a collision that only exists if you assume one numbering governs both places. It does
not. **This table governs what a page displays; nothing else does.**

| Exercise | Challenge | Metrics | Verification | State |
|---|---|---|---|---|
| **Airfoil design** | Hit a target sectional lift by choosing profile and incidence | *C<sub>p</sub>*, *C<sub>L</sub>*, *C<sub>m</sub>*, centre of pressure, aerodynamic centre; *C<sub>D</sub>* and *L*/*D* only at model level 2 | Thin-airfoil theory, exact Kármán–Trefftz and cylinder solutions, circulation-vs-pressure consistency, panel convergence | **built**: [`exercises/airfoil.md`](exercises/airfoil.md) |
| **Lightweight bracket** | Remove mass while keeping stress and deflection admissible | displacement, von Mises, reactions, mass, compliance, safety factor | Euler–Bernoulli beam, hole stress-concentration factor *K<sub>t</sub>*, reaction balance, mesh convergence | not specified. Upstream now ships `mock.elasticity2d` and `dolfinx.elasticity2d`, so this row's solver exists — it is a *continuum* problem, and deliberately not the bridge |
| **The magnetic circuit** | Reach a required flux density in the core at the fewest ampere-turns, without saturating and without losing it to leakage | core flux, mean and worst-section flux density, leakage ratio, ampere-turns, stored energy, permeance | energy balance, two-route flux consistency, Ampere's law on a stated contour, refinement study | **built**: [`exercises/solenoid.md`](exercises/solenoid.md). Was *Electromagnet gap*; the challenge changed because a symmetric bar core feels no net force, see [ADR-018](architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force) |
| **The bridge** | Carry a deck load across a fixed span within a mass budget, with no member past its capacity | utilisation against yield *and* Euler buckling, deflection over span, mass, load carried per kilogram, reactions | the method of joints, a reaction balance, a moment balance, an energy check — all at machine precision, since there is no mesh | **built**: [`exercises/truss.md`](exercises/truss.md). The first exercise whose geometry is *drawn*, and the one that found the protocol has no network geometry ([ADR-019](architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)) |
| **Heat-sink challenge** | Dissipate a given power below a maximum temperature, with less material | *T*, heat flux, *T*<sub>max</sub>, *R*<sub>θ</sub>, mass, fin efficiency | energy balance, 1-D fin theory, two exact radiation limits, the view-factor summation and reciprocity identities at machine precision, a bare-plate limiting case, and `mock.heat2d` against `dolfinx.heat2d` for the conduction core | **solver built, page not**: [`exercises/heat-sink.md`](exercises/heat-sink.md), solved by `lab.heatsink2d` and verified against fin theory, two exact radiation limits and the view-factor identities. The only exercise blocked on nothing upstream. Two modelling decisions carry it: *h* is a function of channel spacing, and radiation is in — with *h* constant the solve says more fins are always better, and without radiation the nominal still-air case over-predicts the rise by tens of percent. Both mechanisms turn the same curve, for different reasons |
| **Room modes** | Place source and listener avoiding nodes and resonances | acoustic pressure, phase, SPL, modal frequencies, uniformity | analytic modes of a rectangular room | not specified; needs complex harmonic fields and a frequency sweep |
| **The capacitive sensor** | Characterise the annular sensor at its nominal gap: sensitivity, the linear half-stroke, and the tilt cross-sensitivity | *C*<sub>0</sub>, d*C*/d*z*, linear half-stroke, tilt coefficient, tilt-induced displacement error, fringe excess | the parallel-plate analytic value, the published *C*(*z*) and *C*(γ) fit, energy-vs-charge consistency, mesh and truncation convergence | **specified**: [`exercises/capacitive-sensor.md`](exercises/capacitive-sensor.md) |
| **The adaptive mirror** | Reach a commanded shape inside a residual and a settling time, without saturating the actuators or exciting the high modes | settled RMS residual, peak residual, settling time, peak and RMS actuator force, control effort, spillover fraction, sensor-induced error | the published 50-mode table, three rigid-body modes, energy balance, Δ*t* convergence, the damping stability boundary, regression against the P45 archive | **specified**: [`exercises/adaptive-mirror.md`](exercises/adaptive-mirror.md) |

The first four available rows are one coherent product. Acoustics is the ambitious fifth, and it is the one
that needs protocol capabilities the lab does not have yet (complex-valued fields, a swept
study, a curve result kind).

One row has changed its challenge since this table was written, and the change is worth
reading as a caution about the rest of it. *Electromagnet gap* asked for a force across a
working air gap, and the cross-section the magnetics page submits has no working gap — a
symmetric bar core between opposed windings feels exactly zero net force, so the target could
not have been met or missed, only mis-reported. A challenge is a claim about what a model can
be asked, and it is not settled until the model exists to be asked it.

Two of the metric columns above cannot be produced by the model the corresponding page runs
today — that is not a gap in the table but the substance of the airfoil specification, which
deals with it explicitly and refuses to display a lift coefficient a circulation-free model
cannot produce.

---

## 7a. The order a page presents them in

The nine sections are what a page must *contain*. They are not the order in which a visitor
meets them, and conflating the two produced a page that had everything and showed it all at
once. Since [ADR-017](architecture-decisions.md#adr-017--an-experiment-page-is-a-bench-not-a-document)
every page is arranged as one path:

| Step | Carries |
|---|---|
| **1 Mission** | §1 — the objective, the targets with their tolerances, the constraints, pass/fail per target, and — separately — why a run does not count when the numbers are right but the model is not |
| **2 Configure** | §5, in two visible groups (*Design*, *Conditions*) plus *Advanced*, closed, holding the numerical settings and the study |
| **3 Run** | a stable action bar: Run, Cancel while solving, Keep result afterwards, Compare once rows exist |
| **4 Explore** | §6 — the field, with the tools to interrogate it rather than only look at it |
| **5 Check** | §7 as a few headline tiles before any table, then §8 and the domain of validity, then the cost of the solve |
| **6 Keep and compare** | §9 |
| **7 Understand the model** | §2, §3, §4 and the reasoning behind §5–§8, in collapsible blocks |

Two rules the arrangement adds to the contract:

- **Nothing internal reaches the screen.** A target is stated in the metric's *symbol* — `L′`,
  `C_m,c/4` — not in the key the report stores it under. The keys stay in the export, where they
  are read by a program.
- **A section with nothing in it does not exist yet.** Before the first run the reporting
  sections are absent, not empty. A panel reading "Nothing computed yet" occupies the position
  where an answer will be and teaches the visitor to skip it.

---

## 8. What the page shell needs

`frontend/shared/experiment.js` covers the solver picker, the schema-driven parameter form,
the run-and-stream loop, the status line, the stats table, the artifact links and the lesson
renderer. The contract adds:

- **grouped parameter panels** — the same schema-driven form, rendered into three labelled
  groups from a per-exercise classification of each parameter as physical, numerical or
  study. The classification lives in the exercise's `app.js` beside `PARAM_UI`, because only
  the exercise knows which of its solver's parameters is which.
- **a metrics table** — name, symbol, value, unit, and a definition on hover; separate from
  the cost table.
- **a verification panel** — each check with its residual, its tolerance and a pass mark.
- **a validity panel** — warnings, or an explicit "inside the stated domain of validity".
- **a curve plot** — an SVG line chart for surface distributions, sweeps and convergence
  histories. No charting library: one file, an axis pair, an inverted-*y* option for
  *C<sub>p</sub>*, and a hover readout.
- **a run table** — the store, the row renderer, compare and export.
- **a challenge banner** — the objective, and per-target met / not met.

- **a workspace** — the computed field as the page's largest element, with a toolbar: pan, zoom,
  reset, fit, probe, vector glyphs, streamlines, annotation layers in domain coordinates, image
  export, and a colour scale. Every tool declares the condition under which it works and is
  **disabled with that reason** when it does not, because "this result publishes no vector
  field" is a statement about the solve and a missing button is a statement about nothing.
- **an edit mode kept apart from an explore mode**, where the page has geometry to edit at all.

All of it now exists: the grouped panels in `exercise.js` alongside the headline tiles, the
metrics, verification and validity renderers and the challenge banner, the plot in `curve.js`,
the store and its table in `runs.js`, the atmosphere in `atmosphere.js`, and the workspace in
`workspace.js`.

That is a real amount of shared code, and it is the point at which
[ADR-009](architecture-decisions.md#adr-009--no-front-end-framework-and-no-bundler)'s
"revisit at a fourth or fifth experiment" clause should be *re-read* rather than assumed still to
hold. The judgement stands: none of it needed a component model or a reactive store, and all of
it is functions over DOM nodes. One thing found while building it is worth recording, because it
is exactly the failure a framework is usually adopted to prevent — the page kept its parameter
values in a *copy* of the object the generated controls mutate, so every control silently stopped
having any effect. It looked right, and only moving a slider and watching the result not change
revealed it. The fix was to stop copying, not to adopt a state container. The first time two of
these panels genuinely have to share mutable state is the moment to revisit, and the run table is
still the likeliest trigger.
