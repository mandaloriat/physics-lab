# The Mindlin plate and the modal solve — a business case

**Status:** proposal. Nothing is decided here, and there is no ADR yet: an ADR records a
decision taken, and this document exists to ask for one.
**Occasion:** [Exercise 6, the adaptive mirror](../exercises/adaptive-mirror.md) is specified
and blocked, and its §11 names the plate element as *"the exercise's real technical risk"*.
This is the case for retiring that risk before anyone writes the exercise around it.
**Related:** [fenix-spoon#100](https://github.com/mandaloriat/fenix-spoon/issues/100), the
same argument made for `axisymmetric2d` and [Exercise 5](../exercises/capacitive-sensor.md).

---

## 1. It is two asks, not one, and they have different owners

The natural way to state this is *"the lab needs a Mindlin plate and its modes"*. Stated that
way it is one large request to one place, and it is wrong on both counts. Separated:

| | The ask | Kind of thing | Belongs to |
|---|---|---|---|
| **A** | an **eigenvalue solve** — the toolkit can answer *"where does it resonate?"* | a question kind | **Fenix Spoon** |
| **B** | a **Mindlin plate element** — bending of a thin shear-deformable plate | physics | **the lab**, and offered upstream afterwards |

The separation is worth insisting on because A is much the stronger case, is much the smaller
piece of work, and is useful to physics the toolkit *already* ships. Bundling it behind a plate
element hides a good argument behind a hard one.

---

## 2. Ask A — the modal solve, and why it is upstream's

Four pieces of evidence, all of them from Fenix Spoon's own source rather than from what the
lab would like.

**The protocol already describes the answer.** The `series1d` module docstring lists what a
curve is for, and the fourth row of its table is:

> | Where does it resonate? | a frequency sweep, or a list of modal frequencies |

— `server/fenixspoon/series.py`, repeated verbatim in `docs/04-wire-protocol.md`. The result
shape shipped in protocol 1.5. **Nothing on the server can produce one.** A wire format with no
producer is the clearest possible statement that a capability was anticipated and not built.

**The vocabulary already has the word.** `declarations.py` gives the static elasticity solvers
this assumption:

> `static` — *"No inertia and no time: the answer is the equilibrium reached under a load
> applied slowly. Natural frequencies, impact and any dynamic amplification are outside it."*
> `excludes=["natural_frequency", "transient_response", "dynamic_amplification"]`

`natural_frequency` is a name the toolkit already uses — to tell a caller what it cannot have.
Of the three things that assumption excludes, `transient_response` has a solver
(`dolfinx.transient_heat2d`) and `natural_frequency` has none.

**It is a question kind, and question kinds have always been upstream's.** Every registered
adapter — poisson, laplace, heat, transient heat, magnetostatics, elasticity, aerodynamics —
is a *forward* solve, steady or marched in time. An eigenproblem is a third kind of question,
in the same way M5's optimisation loop is a fourth. That is the axis the toolkit grows along,
and it is not the axis a lab adapter grows along.

**There is a second consumer, from different physics.** The contract's *Room modes* row wants
the analytic modes of a rectangular room — acoustics, not structures, and the same question.
Two independent cases is the bar [#100](https://github.com/mandaloriat/fenix-spoon/issues/100)
just used, and it is met here without counting the mirror twice.

**What it would cost the protocol: possibly nothing.** Frequencies are a `series1d`. Mode
shapes are fields of the kinds the viewer already draws. `frames` (protocol 1.7) already orders
a list of artifacts, and a mode index is an ordering — whether a mode number may travel in a
slot whose field is named `t` is the one real question, and it is a smaller one than a new
result kind.

---

## 3. Ask B — the plate element, and why the lab writes it first

Upstream ships `mock.elasticity2d` and `dolfinx.elasticity2d`, and they are plane continuum.
The toolkit says so itself, in the assumption those solvers declare:

> `plane_idealisation` — *"…**Neither is a thin bending plate**, and the two differ by terms of
> order nu in every stress — picking the wrong one is a quiet error, not a refusal."*
> `excludes=["plate_bending", "out_of_plane_load"]`

So the gap is not something the lab discovered. It is named in the toolkit's own prose, and
excluded by name, twice.

**And yet the recommendation is that the lab writes it.** By the test
[ADR-019](../architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)
settled — *a solver of the lab's own only when the physics a metric needs is missing, never to
demonstrate the adapter contract* — this qualifies, exactly as the panel method and the truss
did. The honest counter-argument should be stated rather than skipped: a Mindlin plate is a
*standard element*, general in a way `panel.py` and `truss2d.py` are not, and the lab writing
one is the first time it would be building something whose natural home is a toolkit.

The resolution is a sequence rather than a verdict:

1. the lab writes the element and runs it against the fifty published frequencies;
2. **then** it is offered upstream, with the benchmark attached.

A plate element carrying fifty externally published numbers is a contribution someone can
accept in an afternoon. The same element as a proposal is a conversation. Doing it in this
order also puts the element where its benchmark already lives, and costs nothing if the answer
upstream is eventually no.

---

## 4. The risk, and the spike that retires it

The risk has a name: **shear locking**. At 1.61 mm of Zerodur over a 163 mm annular width this
plate is thin enough that an un-stabilised Mindlin element returns frequencies that are too
high and entirely plausible. It is the failure mode that does not announce itself — which is
precisely why the exercise should not be built first and checked afterwards.

**The spike, in one sentence:** assemble **K** and **M** for the free annular plate with its 45
point masses and magnet stiffnesses, solve the generalised eigenproblem, and compare.

| What it must produce | Expected |
|---|---|
| rigid-body modes | **exactly three** at zero — piston and two tilts |
| first elastic mode | **112.8 Hz**, and it is a degenerate pair |
| the sequence | 182.3, 276.6, 276.7, 417.2, 417.3, 485.1, 485.2 … |
| the fiftieth | **2640.9 Hz** |

Getting the first three to be zero and the fourth to be 112.8 Hz means the element, the
concentrated masses and the magnet stiffness are all right at once — §8 of the exercise says
so, and it is why this check is worth more than its cost.

**What the spike needs: nothing that is currently blocked.**

- Not `axisymmetric2d` — this is a plane annular domain, and the two P45 exercises are blocked
  on different things. The two workstreams are genuinely parallel.
- Not the protocol, not a job, not a server, not a page. The lab already splits every adapter so
  that only the last file knows about Fenix Spoon (`solvers/__init__.py`), which makes the spike
  one NumPy/SciPy module and one test file — the shape `panel.py` and `truss.py` already have.
- **Not the `P45` archive.** The fifty frequencies are published and are quoted in
  [§8 of the exercise](../exercises/adaptive-mirror.md#8-verification). The archive is needed for
  the *time-history* regression, which belongs to solve B and is not on this path.
- Not Exercise 5. The sensor model enters at the control loop, not at the plant.

That last cluster is the actual argument for doing this now: of everything Exercise 6 needs, the
plate's modal benchmark is the one piece that depends on nothing else and settles the most.

---

## 5. What it costs, stated honestly

For calibration, the bridge — the most recent comparable exercise — is 358 lines of method and
441 of test before any protocol adapter. A shear-deformable plate with its locking treatment
(MITC-style tying, reduced integration, or a stabilised formulation — the choice is part of the
spike) plus a generalised eigensolve will be **the largest single piece of physics the lab has
written**. The spike itself is much smaller than the exercise: it stops at the frequencies, and
it either matches the table or it does not.

The control loop, by contrast, is a few hundred lines of NumPy and has already been written
twice in `P45`. It is not where the risk is, and it is not what this proposal is about.

---

## 6. What is being asked for

1. ~~**Open an issue upstream for the modal solve**~~ — **done**:
   [fenix-spoon#101](https://github.com/mandaloriat/fenix-spoon/issues/101), on the pattern of
   [#100](https://github.com/mandaloriat/fenix-spoon/issues/100). It carries the room-modes row
   and the mirror as the two consumers, the `series.py` table and the `static` assumption as the
   evidence that the toolkit has already half-agreed, and it keeps the plate element explicitly
   out of scope. It also names the two things that bite in the solve itself: a *generalised*
   eigenproblem, and free-free structures — the mirror's singular **K** and its three zero modes
   are a correctness check, not a nuisance to be filtered away.
2. **Approve the plate spike in the lab** — the element and the eigen-check against the fifty
   frequencies, and nothing downstream of them.
3. **Defer the ownership question on the element** until the spike passes, then offer it
   upstream with its benchmark.

**If the answer upstream is no on the modal solve**, the lab computes its own frequencies inside
`lab.mirror_plate2d` and returns them as `series1d`, which works and is protocol-legal. The cost
of that outcome should be named now rather than discovered later: it would be the **second**
local workaround on the P45 thread, after the axisymmetric convention #100 already accepts one
of. §11 of the sensor exercise authorises that kind of thing *once and explicitly not twice*,
and two of them is the point at which the lab has quietly forked the toolkit's job.
