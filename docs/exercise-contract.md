# The exercise contract

Every page in this lab is an **exercise**: a quantitative objective under constraints, a
model whose assumptions are written down, a result that can be judged right, wrong or
improvable, and a verification number that says how much the result can be trusted.

That is a change of kind, not of degree. The two pages shipped so far ask *"what changes in
the field?"* (airfoil) and *"what does the core do?"* (solenoid). Both are guided
demonstrations: there is nothing a visitor can get wrong, so there is nothing to compare and
nothing to improve. This document defines the shape every exercise page has instead, and it
is the contract the five planned exercises implement.

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
      { "metric": "L_prime", "comparator": "==", "value": 800, "unit": "N/m", "tolerance": 0.02, "tolerance_kind": "relative" },
      { "metric": "abs_C_m_c4", "comparator": "<", "value": 0.08, "unit": "1" }
    ],
    "requires_valid": true,
    "requires_verified": { "metric": "cl_consistency_rel", "below": 0.02 }
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

## 6. What a solver has to return, on protocol 1.2

Today's `ResultEnvelope` carries `kind`, `data`, `stats: dict[str, float]` and `artifacts`.
There is no field for computed metrics, none for a warning, and no result kind for a 1-D
curve — so a *C<sub>p</sub>*(*x*/*c*) distribution, a modal frequency list or a convergence
history has nowhere to go.

Until #46 lands, a lab solver returns:

1. **the field**, as `grid2d` or `mesh2d`, exactly as now — this is what `<fs-viewer>` draws;
2. **`stats`**, restricted to what the solve cost;
3. **one always-written JSON artifact** (`report.json`) carrying the metrics, the surface
   curves, the verification residuals and the warnings, declared via `ArtifactSpec` so it is
   discoverable before submitting.

The artifact is a workaround with two virtues: it is protocol-legal without inventing a
private convention on top of `stats`, and its content is exactly the payload that becomes
native `metrics` when #46 lands — at which point the page reads the envelope and the artifact
becomes optional. Solvers also declare their metric names through `Solver.metrics` (#43), so
a caller learns what a run will report before running it.

---

## 7. The five exercises

| Exercise | Challenge | Metrics | Verification | State |
|---|---|---|---|---|
| **Airfoil design** | Hit a target sectional lift by choosing profile and incidence | *C<sub>p</sub>*, *C<sub>L</sub>*, *C<sub>m</sub>*, centre of pressure, aerodynamic centre; *C<sub>D</sub>* and *L*/*D* only at model level 2 | Thin-airfoil theory, exact Joukowski and cylinder solutions, circulation-vs-pressure consistency, panel convergence | specified: [`exercises/airfoil.md`](exercises/airfoil.md) |
| **Lightweight bracket** | Remove mass while keeping stress and deflection admissible | displacement, von Mises, reactions, mass, compliance, safety factor | Euler–Bernoulli beam, hole stress-concentration factor *K<sub>t</sub>*, reaction balance, mesh convergence | not specified |
| **Electromagnet gap** | Produce a required gap force at minimum current | **B**, **H**, flux, force, losses, saturation margin | magnetic-circuit estimate, energy balance | not specified; reworks the existing solenoid page |
| **Heat-sink challenge** | Dissipate a given power below a maximum temperature, with less material | *T*, heat flux, *T*<sub>max</sub>, *R*<sub>θ</sub>, mass, fin efficiency | energy balance, 1-D fin theory | not specified |
| **Room modes** | Place source and listener avoiding nodes and resonances | acoustic pressure, phase, SPL, modal frequencies, uniformity | analytic modes of a rectangular room | not specified; needs complex harmonic fields and a frequency sweep |

The first four are one coherent product. Acoustics is the ambitious fifth, and it is the one
that needs protocol capabilities the lab does not have yet (complex-valued fields, a swept
study, a curve result kind).

Two of the metric columns above cannot be produced by the model the corresponding page runs
today — that is not a gap in the table but the substance of the airfoil specification, which
deals with it explicitly and refuses to display a lift coefficient a circulation-free model
cannot produce.

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

That is a real amount of shared code, and it is the point at which
[ADR-009](architecture-decisions.md#adr-009--no-front-end-framework-and-no-bundler)'s
"revisit at a fourth or fifth experiment" clause should be *re-read* rather than assumed
still to hold. The judgement stands for now: none of the above needs a component model or a
reactive store, and all of it is functions over DOM nodes. The first time two of these panels
have to share mutable state is the moment to revisit, and the run table is the likeliest
trigger.
