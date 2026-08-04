# Exercise 5 — The capacitive sensor

**Status:** *specified, not built.*
**Implements:** [the exercise contract](../exercise-contract.md).
**Contract row:** new. It is not one of the six rows in
[§7](../exercise-contract.md#7-the-exercises), and it should be added there.
**Sources:** the `P45` archive (`mandaloriat/P45`, `control/actuators.py`) and the thesis it
came from — M. Andolfatto, *Accoppiamenti magnetici nell'analisi servoelastica di uno specchio
adattivo*, Politecnico di Milano, 2015,
[POLITesi 10589/109051](https://www.politesi.polimi.it/handle/10589/109051) — chapter
*Attuatori e sensori*. Design data for the M4 control unit was provided to that work by
Microgate.

---

## 0. What an adaptive mirror is, and why the capacitor is the whole problem

A ground-based telescope's resolution is set by its aperture in theory and by the atmosphere
in practice. Adaptive optics closes that gap by deforming one mirror in the optical train
fast enough to cancel the wavefront distortion as it happens. The loop has four stages: a
wavefront sensor measures the incoming distortion, an optical controller converts it into a
commanded *shape*, that shape is sent to the deformable mirror, and the mirror's **own**
control loop makes the surface actually take it.

This exercise and [Exercise 6](adaptive-mirror.md) are about the fourth stage only. The first
three are optics; the fourth is servoelasticity, and it is the one with a finite-element
problem inside it.

The deformable element is a thin shell suspended above a rigid **reference body**. The only
mechanical connection between them is a central membrane support, stiff in-plane and
deliberately soft transversally, so the shell is to all practical purposes *floating*: it is
held in position by nothing but the control forces. The gap between shell and reference body
is of the order of 10⁻⁴ m.

Each control unit is a contactless voice-coil actuator with an annular metal electrode around
it. That electrode is one plate of a capacitor; the other plate is a gold coating on the back
of the mirror itself. Actuator and sensor are therefore **co-located by construction**, which
is the configuration a decentralised controller wants.

For the ELT's M4 the current published figures are 2.4 m across, six 60° petals of Zerodur
1.95 mm thick, more than 5000 voice-coil actuators with ±50 µm of stroke, corrected at up to
1 kHz ([ESO](https://elt.eso.org/mirror/M4/)). The 2015 thesis this exercise draws on states
2.6 m, which is worth keeping in the page as written rather than silently updating: the
design moved, and a lab that teaches modelling should show that specifications do too.

**Why the capacitor decides everything.** The mirror's controller has no other way of knowing
where the surface is. Whatever error the capacitance-to-displacement conversion carries enters
the feedback loop as if it were real motion. So the sensor's calibration curve is not an
accessory to the control problem; it is one of its inputs, and it is the input this exercise
produces for the next one.

---

## 1. The problem

**Challenge.** Given the electrode annulus and the nominal gap, establish the sensor's
calibration over the working stroke: state its sensitivity, the stroke over which a linear
reading stays inside a declared error, and how much a relative tilt of the two plates corrupts
the displacement reading.

Draft targets, to be fixed once the solver runs:

```json
{
  "challenge": {
    "statement": "Characterise the annular capacitive sensor at its nominal 90 µm gap: report sensitivity, the half-stroke over which a linear calibration stays within 1%, and the tilt cross-sensitivity.",
    "targets": [
      { "metric": "dC_dz", "comparator": ">", "value": 0.30, "unit": "nF/mm", "absolute": true },
      { "metric": "linear_halfstroke_1pct", "comparator": ">", "value": 10, "unit": "um" },
      { "metric": "fringe_excess", "comparator": "<", "value": 0.25, "unit": "1" }
    ],
    "requires_valid": true,
    "requires_verified": { "metric": "energy_charge_consistency_rel", "below": 0.01 },
    "next_step": "a different chamfer, at the same gap"
  }
}
```

---

## 2. The model

Electrostatics, no free charge, linear dielectric:

  ∇·(ε ∇V) = 0

solved on an **axisymmetric (r, z) half-section** of one sensor unit. The axisymmetric form
carries the radial weight explicitly, which is the only difference from the plane 2-D solvers
the lab already runs:

  ∫ ε (∂V/∂r ∂v/∂r + ∂V/∂z ∂v/∂z) **r** dr dz = 0

Capacitance from stored energy, C = 2W/V², with W = ½∫ε|∇V|² r dr dz · 2π.

**The hybrid method, taken from the thesis and worth stating on the page.** A full 3-D solve
of the deformed unit was tried and rejected: at a 90 µm gap the geometry cannot be perturbed
far enough to resolve the capacitance change against discretisation error, especially for
relative tilt. What worked instead was axisymmetric-2D per configuration, with one plate
translated by *w* or rotated by *γ*, giving an infinitesimal contribution d*C*(*w*, *γ*) that
is then integrated around the annulus for the configuration of interest. Cheap enough to
repeat for dozens of configurations, which is what produced a calibration *curve* rather than
a single number.

That is the same argument the lab makes on every page — a 2-D model chosen because it
answers the question, not because 3-D was unavailable — and here it comes with the receipt of
a 3-D attempt that did not.

**Assumptions in force:** rigid electrodes (the shell's own local curvature under the plate is
neglected, and the thesis names this as the next-order effect it did not analyse); perfect
conductors; vacuum permittivity in the gap; no space charge; the guard/chamfer modelled as
geometry rather than as a driven guard electrode.

---

## 3. Boundary conditions

| Boundary | Condition |
|---|---|
| Reference-body electrode (annulus + chamfer) | *V* = *V*₀ |
| Shell coating, facing surface | *V* = 0 |
| Symmetry axis *r* = 0 | natural; excluded from the domain if the section does not reach it |
| Outer truncation | *V* = 0 at a stated distance, and the sensitivity of *C* to that distance is a numerical setting, not a physical one |

The truncation distance belongs in *Advanced* with the mesh size. It is a knob whose only
correct effect is on the error, and §8 measures it.

---

## 4. Initial conditions

**Absent.** The problem is steady.

---

## 5. Physical inputs

| Input | Nominal | Range | Note |
|---|---|---|---|
| Electrode inner radius | 11 mm | 5–20 mm | |
| Electrode outer radius | 14.5 mm | 8–25 mm | |
| Nominal gap | 90 µm | 40–200 µm | |
| Chamfer width | 1.5 mm | 0–3 mm | the *svaso*, and the reason *C* is not a parallel plate |
| Chamfer height | 1.5 mm | 0–3 mm | |
| Excitation voltage | 1 V | — | *C* is voltage-independent; the value only scales *W* |
| Plate excursion *w* | 0 | ±50 µm | the ELT actuator stroke |
| Relative tilt *γ* | 0 | ±2 mrad | |

The thesis table lists "raggio interno 14.5 mm, raggio esterno 11 mm", which is transposed.
The page should carry the corrected values and say so, since a reader who checks the source
will find the discrepancy.

Electrodes are gold coating of about 1 µm, which matters for resistance and not for this
solve.

---

## 6. Fields

*V* and |**E**| on the (r, z) section. The thing to look at is the field at the chamfer: it
is where the departure from a parallel plate lives, and where the 15.7% excess of §8 comes
from.

**One renderer note.** The workspace draws a plane 2-D domain. Here the horizontal axis is
*r*, not *x*, and the field shown is a meridian section of a body of revolution. The axis must
be labelled *r* and the page must say what it is showing, or it teaches the wrong picture.

---

## 7. Engineering metrics

| Metric | Symbol | Unit | Definition |
|---|---|---|---|
| Capacitance at nominal gap | *C*₀ | nF | 2*W*/*V*² at *w* = 0, *γ* = 0 |
| Sensitivity | d*C*/d*z* | nF/mm | tangent of *C*(*z*) at the nominal gap |
| Linear half-stroke | — | µm | largest \|*w*\| for which \|*C*(*z*) − (*C*₀ + *w* d*C*/d*z*)\| / *C* stays below 1% |
| Tilt coefficient | *c*<sub>γ</sub> | nF/rad² | quadratic coefficient of *C*(*γ*) at fixed gap |
| Tilt-induced displacement error | — | nm | *c*<sub>γ</sub>γ² divided by d*C*/d*z*, i.e. the phantom motion a tilt reports |
| Fringe excess | — | 1 | *C*₀/*C*<sub>plate</sub> − 1, against ε₀*A*/*d* on the annular area |
| Charge-route capacitance | — | nF | *C* from the integrated surface charge, for §8 |

---

## 8. Verification

| Check | What it compares | Expected |
|---|---|---|
| **Analytic** | *C*₀ against the parallel-plate value ε₀π(*r*<sub>o</sub>²−*r*<sub>i</sub>²)/*d* = **0.02758 nF** | The solve should land **about 15.7% above** it. The thesis fit gives *C*₀ = 0.031904 nF, and the whole excess is fringe and chamfer. A solver reproducing the parallel-plate number exactly has lost the geometry it exists to resolve. |
| **Benchmark** | the published fit, *C*(*z*) = (−298.8*z*² + 369.6*z* + 0.5)⁻¹ nF with *z* the gap in mm, and *C*(γ) = 0.09γ² + 0.0319 nF | Relative error over the sampled configurations. |
| **Consistency** | *C* from stored energy vs *C* from integrated surface charge | Gap below 1%. |
| **Convergence** | mesh size and outer truncation distance, halved | Change in *C*₀ below the tolerance the page declares. |

The benchmark row is the unusual one and it is the reason this exercise is worth building
first: the answer was computed once, in 2015, by a different code on a different formulation,
and published. That makes it a genuine external check rather than a self-consistency test.

---

## 9. Save result

The run row per [§5 of the contract](../exercise-contract.md#5-the-run-table). `geometry.source`
is `parametric`; `physical` carries the four radii and gaps and the two perturbations;
`numerics` carries mesh size and truncation distance.

---

## 10. The number this exercise exists to produce

`P45`'s time-domain code does not use a curve. It uses a linearisation:

```python
def disp2cap(w, tx, ty):
    cap_z  = 310.e-9                    # F/m  = 0.310 nF/mm
    cap_a1 = 9.008809214779535e-11      # F/rad^2 = 0.0900881 nF/rad^2
    c0     = 3.188993986668676e-11      # F = 0.0319 nF
    return cap_z*w + cap_a1*(tx**2+ty**2) + c0
```

Three things are true about it, and each one is a page section:

**It is the tangent of the published curve, and not quite.** The analytic derivative of the
thesis fit at a 90 µm gap is **0.3215 nF/mm**; the code carries **0.310 nF/mm**, 3.6% lower.
The difference is consistent with a slope fitted over a range rather than taken at the point.
The exercise should state which of the two it reports and why.

**Its tilt coefficient matches exactly** — 0.0900881 against the thesis's 0.09 — so the
quadratic term was transcribed, and only the linear one was refitted.

**It is excellent near the operating point and useless at full stroke.** Computed from the
thesis fit:

| Excursion | Exact *C* | Linear *C* | Relative error |
|---|---|---|---|
| ±1 µm | 0.031586 / 0.032229 | 0.031583 / 0.032226 | 0.01% |
| ±5 µm | 0.030381 / 0.033605 | 0.030297 / 0.033512 | 0.28% |
| ±10 µm | 0.029009 / 0.035517 | 0.028690 / 0.035119 | 1.1% |
| ±20 µm | 0.026638 / 0.040148 | 0.025475 / 0.038334 | 4.4% |
| ±30 µm | 0.024661 / 0.046296 | 0.022260 / 0.041548 | 10.0% |
| ±50 µm | 0.021558 / 0.067541 | 0.015831 / 0.047978 | 27.8% |

(nF; the two values per cell are gap-increasing / gap-decreasing.)

So the linearisation is sound for a mirror correcting a few microns of atmospheric wavefront,
and wrong by a quarter at the ±50 µm stroke the ELT actuators are specified for. That is a
concrete, checkable statement about a domain of validity, produced by the model, and it is
exactly what [§4 of the contract](../exercise-contract.md#4-validity-stated-per-run) means by
a warning that names the threshold and the consequence.

It is also the hand-off to [Exercise 6](adaptive-mirror.md), which runs a control loop through
this sensor and can now do it with the curve instead of the tangent.

---

## 11. What this needs that does not exist yet

The solver is a **lab adapter**, `lab.capacitor_axi2d`, registered in
`physics_lab/solvers/` beside `lab.magnetics2d`.

**Protocol note.** An earlier draft of this section assumed protocol 1.2 and a `report.json`
workaround, following §6 of the exercise contract. That is stale: Fenix Spoon is at **1.9**,
`metrics` and `diagnostics` landed in 1.3, `provenance` in 1.4, and `series1d` plus the
`series` list beside a field in 1.5. This exercise returns everything natively.

1. **The `axisymmetric2d` geometry kind.** The weak form itself is one *r* factor in the
   integrand and lives in the adapter. What is missing is upstream and already *planned*:
   `axisymmetric2d` is listed among the planned geometry kinds in the wire-protocol reference,
   and the roadmap deferred the axisymmetric A-φ formulation out of the magnetics work with
   the note that axisymmetry belongs with that dedicated kind. **This exercise is the case
   that asks for it.** A caller has to be able to tell a meridian section from a plane slice.
   The lab can ship against `domain2d` plus a local convention in the interim; it should not
   do that twice.
2. **Nothing for the curves.** *C*(*z*) over a swept gap goes back as a `series1d` result
   when the sweep is the answer, or in the `series` list beside a field result when it
   accompanies one. Both exist ([#46](https://github.com/mandaloriat/fenix-spoon/issues/46),
   closed).
3. **Nothing else.** Steady, linear, scalar, small domain. This is the cheapest exercise the
   lab has specified, and it is the one with a published answer to check against.
