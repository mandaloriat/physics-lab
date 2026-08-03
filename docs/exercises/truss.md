# Exercise 4 — The bridge

The specification of `frontend/experiments/truss/`, and the record of the three definitions
that had to be settled before any number on it could be reported. The architecture decision
behind it — why the lattice is a *parameter* and the site is the geometry — is
[ADR-019](../architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry).

It is the first exercise in the lab whose **geometry is drawn by the visitor rather than
parametrised for them**, and the first whose load is placed rather than typed. Both follow
from the same thing: a truss is a graph, and a graph has no sliders.

---

## 1. The problem

Cross a 24 m gorge with a lattice of steel bars. The deck carries 4 kN per metre of traffic.
A shipping channel under the middle of the crossing must stay clear, so the middle of the
structure cannot be slung below the deck.

| Target | Value | Why that one |
|---|---|---|
| `utilisation_max` | **< 1** | the busiest bar's force over what it may carry. Above one, something has failed |
| `mass` | **< 2400 kg** | the budget. Without it, every failure is fixed by adding steel |
| `span_ratio` | **< 1/800** | deflection over span, the form a serviceability limit is written in |

Disqualified besides — `requires_valid` — is any run that crosses one of the model's stated
limits, and `requires_verified` puts the joint-equilibrium residual below 10⁻⁶. Neither is
decorative: the default lattice fails the first of those two, and would otherwise look like a
run that missed one target out of three.

**The default is a Warren truss of eight panels, 3 m deep, in 2200 mm² bars.** It carries the
load, uses 1704 kg of the 2400 allowed and deflects span/2008 — and its worst diagonal is at
**η = 1.91**, past its Euler load, so the run is disqualified as well as missed. A default that
already passed would leave nothing to do.

A lattice that passes: **ten panels, 3 m deep, 2600 mm² bars** — η = 0.92, 2250 kg,
span/2218, no warnings. It is not the only one, and the run table exists so two can be
compared.

---

## 2. The three definitions

### 2.1 What "loaded along a stretch" means

A point load at a joint is unambiguous. A load *along* a member is not: it is a force per unit
length, and a pin-jointed bar cannot carry the bending a genuinely distributed load produces.

**Settled: lumped to the joints at the ends of each loaded bar, half each.** That is exact for
the joint equilibrium and exact for the axial force, and it says nothing about bending in the
bar because the model has none. The alternative — refusing distributed loads entirely and
making the visitor place a point load at every panel point — would have been defensible and
would have made the deck load, the one load every bridge has, the most tedious thing on the
page.

The rule reaches the wire as `load_x` / `load_y` in N/m on a named boundary, applied to every
member with **both** ends on it. A boundary that spans no whole member is refused: a load per
unit length needs a length to act along.

### 2.2 How capacity is defined in compression

Not by yield, and this is the definition the whole exercise turns on.

A 5 m bar of 2200 mm² solid section has a squash load of 550 kN and an Euler load of **47 kN**.
Measuring its utilisation against yield would report nine per cent on a member that has already
buckled — a number that is arithmetically correct, prominently displayed, and worse than
useless.

**Settled: capacity in compression is the lesser of the squash load and Euler's critical load,
both divided by the safety factor.** In tension it is the squash load alone, because a bar in
tension does not buckle.

Two sub-decisions go with it, and both are restrictions rather than options:

- **The section shape is fixed** at solid circular, so `I = A²/4π` and `P_cr = πEA²/4L²`. It is
  the conservative end of the range — a tube of the same area has a far larger second moment —
  and it is fixed rather than offered so that a compression member cannot be made safe by
  asserting a better section, which is not a design decision a student should be able to make
  by accident.
- **One area for every bar.** A free area per bar turns the exercise into an optimisation with
  a hundred variables and no way to see why an answer is better. One area and a free topology
  is the version where a diagonal added for a reason visibly helps.

The consequence is the lesson: **shortening a compression member helps by the square of the
length, thickening it by the square of the area.** More panels of the same depth is usually
cheaper than more steel, and that is discoverable from the page in two runs.

### 2.3 What the deflection is measured against

The **span between the outermost supports**, not the length of the longest member and not the
width of the site. It is what every bridge code states its serviceability limit in, and it is
what makes a 24 m truss and a 40 m one comparable at all. Where fewer than two joints are
restrained the ratio falls back to the lattice's own width, which is not a serviceability
number — but a zero denominator is worse than a loose one.

---

## 3. Verification: four residuals, and why four

This is the one page in the lab where a convergence study would be meaningless, and saying so
plainly is part of the exercise. With the joints pinned, **one element per bar is the
structure** rather than an approximation of it: there is no mesh to refine, no tolerance to
tighten and no iteration count to raise. Refining is not available because there is nothing to
refine.

So the verification is about equilibrium instead, and the four checks are independent of one
another rather than four views of one calculation:

| Check | What it closes | Independent of |
|---|---|---|
| `joint_equilibrium_rel` | the method of joints at every free joint | the stiffness matrix and the displacements — it uses the member forces and the geometry only |
| `reaction_balance_rel` | everything applied plus everything the supports pushed back with | nothing else in the list |
| `moment_balance_rel` | the same in moment about the origin | catches a reaction of the right size in the *wrong place*, which the force balance cannot see |
| `energy_consistency_rel` | `Σ N²L/2EA` against `½ f·u` | two routes that share no arithmetic |

A fifth number, `linear_residual`, is reported beside them and is not one of the four: it says
the matrix was inverted, not that it was the right matrix.

**All four are at machine precision — around 10⁻¹⁵ on a real lattice — and that is the correct
expectation, not a lucky one.** A residual of 10⁻³ here would not be a coarse mesh. It would be
a bug, and the tolerances (10⁻⁸, and 10⁻⁶ for the energy check) are written to say so.

The method's own closed forms are checked in `tests/test_truss_method.py` rather than per run:
a single bar against `PL/AE`, two bars at 45° against the method of joints worked by hand, and
— the sharpest of them — that doubling every area of a **statically determinate** truss leaves
every member force untouched and halves every displacement. An error in a direction cosine or
in the element matrix shows up there even where it happens to satisfy equilibrium.

---

## 4. Validity, per run

Four limits, each reported with the threshold it crossed and the consequence, per the
contract's §4.

| Limit | Threshold | What it costs |
|---|---|---|
| small displacement | `span_ratio` > 1 % | equilibrium is written on the undeformed lattice, so the forces belong to a bridge that has not moved |
| linear elastic | any \|σ\| > the yield strength | steel redistributes beyond yield; the reported force is one the bar cannot hold |
| Euler buckling | any compression member past `P_cr` | it has gone, and a first-order model has no way to see it go |
| buildability | a member crosses a region the site keeps clear | the structure is not buildable, whatever its stresses say |

A fifth is reported when self-weight is switched off and the bars weigh more than a tenth of
the imposed load: below that, leaving it out simplifies the problem; above it, it changes the
answer.

The buckling limit is the one that fires on the default lattice, and it is the reason
`requires_valid` matters here more than on the other two pages. **A buckled member is not a
near miss.** The solve converges, the numbers are all finite, the deflection looks reasonable —
and the structure has failed in a way the model cannot represent. Reporting that as "one target
missed" would be the exact failure the contract's §2 exists to prevent.

---

## 5. What is refused rather than reported

Two structures have no answer, and both come back as a refusal with a sentence:

- **A mechanism.** A lattice that folds without stretching a bar has a singular reduced
  stiffness matrix, and the honest answer is not a large displacement but no solution. The
  refusal names how many independent ways it folds and which joints move most in the softest
  of them, because "add a diagonal" is advice only if it says where. One preset — *the deck
  alone* — is a mechanism on purpose: meeting the refusal is the fastest way to learn what
  triangulation is for.
- **A load with nowhere to go.** A force at a joint no member reaches would be silently dropped
  and would answer a lighter problem. It is the same failure protocol 1.9's refusals exist to
  prevent, in this model's own terms.

Two more are refused at *submit*, in the params model, so a caller gets a 422 naming the field
rather than a failed job: a member naming a joint that does not exist, and two members joining
the same pair of joints — which would double a stiffness and halve a stress with nothing on the
result to say so.

The page pre-checks the same conditions before offering the Run button, in the same words. That
is not a second implementation of the rule: each check mirrors a refusal the solver actually
makes, and the round trip is the wrong place to learn that a bridge with no supports has none.

---

## 6. What is withheld

- **Bending moment, joint stress, shear.** Every joint is a frictionless pin. A real gusseted
  joint carries moment, which stiffens the truss and puts bending into the chords; for a fully
  triangulated lattice the axial forces are within a few per cent, which is why the model is
  worth using, and for one that is not triangulated the joints are the only thing holding it
  up — which is why that lattice is refused rather than reported.
- **Natural frequency, fatigue, impact.** One load case, applied slowly. A lorry crossing is
  modelled by asking the question again with the load somewhere else, which the Load tool makes
  cheap.
- **Out-of-plane anything.** A real bridge is two trusses with a deck between them, braced
  against each other. The side load on this page is carried in the plane, by the lattice, and
  not by the bracing that would really take it.

All four are named in the report's `withheld` list and in the capability's declared
`assumptions`, where a caller can read them before running anything.

---

## 7. Where the numbers come from

| Number | Source |
|---|---|
| the default lattice's η, mass and deflection | a real solve; `tests/test_truss_solver.py` asserts the shape of the answer and `e2e/truss.spec.mjs` asserts the verdict the page shows |
| 47 kN Euler load for a 5 m, 2200 mm² bar | `πEA²/4L²` at E = 210 GPa, checked against `π²EI/L²` in `test_the_euler_load_matches_the_closed_form_for_a_solid_round_bar` |
| the passing lattice at ten panels | a real solve, and the thumbnail on the homepage is that solve |
| the four residuals' magnitudes | every run; the e2e suite asserts all five checks pass on the default lattice |
