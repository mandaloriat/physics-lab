# Instant incidence: one solve, every angle

**Status:** proposal. Not built. Written while building the guided path
([ADR-021](../architecture-decisions.md#adr-021--an-exercise-page-opens-with-a-lesson-and-the-lesson-can-be-skipped)),
because the thing it would fix was measured there rather than guessed at.

---

## The problem it would solve

The airfoil page's last chapter offers six angles of attack, and each button is a job: submit,
queue, solve, fetch the artifact, paint. Measured end to end in a browser against a local
deployment, that is **about three seconds**, of which roughly one is the solve and the rest is
the round trip and a **2.5 MB** JSON response — every grid point ships a speed, a *C<sub>p</sub>*
and two velocity components as text.

Three seconds is tolerable for a button. It is not what "play with it" should feel like, and it
rules out the control this page actually wants, which is a slider you drag while the streamlines
move. It also spends the public deployment's budget: `FENIXSPOON_MAX_JOBS_PER_HOUR` is 100,
shared by every visitor at once
([ADR-010](../architecture-decisions.md#adr-010--public-demo-limits-and-what-they-do-not-cover)),
so a page that invites six clicks invites six of them.

## The observation

**The panel method is exactly linear in the incidence.** For a fixed outline, Hess–Smith solves
`A·x = b(α)`, where `A` is the influence matrix — geometry only — and the right-hand side is the
free stream projected onto each panel normal, so it is `b(α) = cos α · b₀ + sin α · b₉₀`. The
Kutta condition is one more linear row, and it does not depend on α either. Therefore

```
x(α)  =  cos α · x(0°)  +  sin α · x(90°)
```

and the same combination carries through everything downstream that is linear in `x`: the
surface velocities, the sampled **velocity field**, the circulation, and therefore
*C<sub>L</sub>* and *C<sub>m</sub>*. *C<sub>p</sub>* = 1 − |**V**|²/U∞² is quadratic in the
velocity, but the velocity it is computed from is linear, so *C<sub>p</sub>* follows exactly
too — it just has to be recomputed rather than blended.

The repository already relies on half of this observation. `docs/exercises/airfoil.md` §7.3 says
a sweep "costs no more than one solve here: the influence matrix does not depend on incidence,
so every extra angle is one more back-substitution", and the solver's `sweep()` does exactly
that. What it does not do is publish anything that lets the *browser* take the last step.

Two solves at any two distinct incidences determine the pair, so nothing exotic has to be
solved at 90°:

```
V(α) = V(α₁) · sin(α₂ − α) / sin(α₂ − α₁)  +  V(α₂) · sin(α − α₁) / sin(α₂ − α₁)
```

## What it would cost to build

- **The solver publishes two basis fields** instead of one sampled field — `velocity` at two
  incidences, or the pair (`b₀`, `b₉₀`) already resolved onto the grid. Payload roughly doubles
  once, and then never again for any number of angles.
- **The page recombines.** Perhaps sixty lines: two multiply-adds per grid point, then
  *C<sub>p</sub>* from the magnitude, then hand the result to `<fs-viewer>` and re-integrate the
  streamlines. At 30,000 points this is well inside a frame.
- **A slider replaces the six buttons**, and the six stay as marks on it.

## Why it is a proposal and not a commit

Because of what it does to §8 of the contract, not because of the arithmetic.

Today every number on the page came from the solver, and the page reports a residual saying how
far to trust it. Under this change the page would show *C<sub>L</sub>*, *C<sub>p</sub>* and a
field it computed **itself**, from a basis the solver published. That is not wrong — it is exact
— but it is a different claim, and in a lab whose whole argument is
*[verification is a number](../exercise-contract.md#3-verification-is-a-number)* the difference
has to be designed rather than absorbed. At minimum it needs:

- a **verification of the recombination**: solve directly at the slider's angle, once, on demand
  or on Keep, and report the difference between the recombined answer and the solved one. It
  should be at machine precision, and saying so with a number is the point;
- an answer to **what gets saved**. A kept run must be reproducible (§9). A run whose numbers
  were interpolated in a browser is reproducible only if the two basis solves are recorded, or
  if Keep triggers a real solve at that angle;
- a rule for **when the basis is stale** — any change of outline, chord, trailing-edge treatment
  or panel count invalidates it, and the page must know that without the visitor learning it.

None of these is hard. All of them are decisions about what the page is claiming, which is
exactly the kind of thing this repository writes down first.

## What would bring it back

A session that wants the airfoil page to have a *continuous* control rather than a ladder, and
is willing to spend that session on the verification story rather than on the interpolation.
The interpolation is an afternoon; the honesty is the work.
