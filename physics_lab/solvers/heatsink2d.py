"""``lab.heatsink2d`` — the heat-sink exercise's adapter, and nothing else.

``docs/exercises/heat-sink.md``. The physics is in :mod:`physics_lab.solvers.heatsink`,
:mod:`physics_lab.solvers.correlations` and :mod:`physics_lab.solvers.viewfactors`, none of
which import Fenix Spoon. This file is the only one that speaks the protocol.

**Why a solver of the lab's own, when upstream ships two heat adapters.** §11.1 of the
exercise. `dolfinx.heat2d` and `mock.heat2d` solve conduction with a convection coefficient on
exposed faces, and they declare `no_radiation` — which their own assumption text says is *"not
negligible for a hot surface in still air"*. That is the nominal case here. A radiative
boundary condition with a radiosity enclosure and a ``T^4`` nonlinearity is physics upstream
does not have and does not claim to, so this passes the test
[ADR-014](../../docs/architecture-decisions.md), ADR-018 and ADR-019 all set: *a solver of the
lab's own only when the physics a metric needs is missing, never to demonstrate the adapter
contract.* An earlier draft of the specification called this the first exercise needing no
solver of its own; adding radiation is what made that stop being true, and it is the right
trade.

**Where the geometry lives, and why it is split.** The same split
[ADR-019](../../docs/architecture-decisions.md) settled for the bridge, for the same reason:

===============================  ==================  ===============================================
What                             Travels as          Why there
===============================  ==================  ===============================================
the **envelope** the sink must   ``regions2d``       it is a region map, which is what the kind is
fit inside                       geometry            for, and it is what a viewer draws
the **profile** — base, fins     ``params``          the correlation needs the *channel width*, and
                                                     recovering that from a polygon list would be
                                                     inferring a quantity from a picture
===============================  ==================  ===============================================

Reading the fin pitch back out of a set of rectangles is exactly the kind of inference ADR 0001
refuses upstream and the lab refuses here. The profile is five numbers; it travels as five
numbers.
"""

import numpy as np
from fenixspoon.geometry import Regions2D
from fenixspoon.solvers.base import (
    Assumption,
    CapabilityExample,
    MetricSpec,
    ProgressEvent,
    Solver,
    SolverContext,
    SolverResult,
)
from fenixspoon.solvers.registry import register
from pydantic import BaseModel, Field, model_validator

from . import heatsink

VERSION = "1.0.0"

#: Emissivity by surface finish. Ordered, because the page shows them as a choice and the
#: order is the argument: sixteen-fold from top to bottom, for no metal at all.
#: Total hemispherical emissivity by surface treatment, for aluminium near 350 K.
#:
#: Nominal values with a source, per the editorial review §12.3: a finish that sets a radiative
#: flux may not carry a remembered number. Real surfaces spread around these — oxide thickness,
#: dye loading, roughness and wavelength all move them, and a mill finish in particular ranges
#: from about 0.03 when freshly rolled to 0.10 once weathered. They are nominal values for a
#: teaching model, not a specification.
#:
#: Sources: Touloukian, Y. S. and DeWitt, D. P. (1970), *Thermophysical Properties of Matter,
#: Vol. 7: Thermal Radiative Properties — Metallic Elements and Alloys*, IFI/Plenum, aluminium
#: entries; and Vol. 8 for anodic coatings, where hard black anodising on aluminium is reported
#: at 0.80–0.88 over 300–400 K. Clear anodising is intermediate and coating-thickness dependent.
FINISHES = {"mill": 0.05, "clear_anodised": 0.6, "black_anodised": 0.8}

HEATSINK_METRICS = [
    MetricSpec(
        name="t_max",
        unit="degC",
        description=(
            "Peak temperature in the metal — the number the device's rating is read against."
        ),
        field="T",
        reduction="max",
    ),
    MetricSpec(
        name="t_rise",
        unit="K",
        description=(
            "Peak temperature above ambient. The design figure, because it is the part of "
            "t_max the geometry controls."
        ),
    ),
    MetricSpec(
        name="flux_max",
        unit="W/m^2",
        description=(
            "Peak conductive flux magnitude, k|grad T|. Where the metal is working hardest, "
            "which is where a fin is worth thickening."
        ),
        field="flux",
        reduction="max",
    ),
    MetricSpec(
        name="thermal_resistance",
        unit="K/W",
        description=(
            "(t_max - t_ambient) / Q. The single number a heat sink is specified by, and the "
            "one to minimise."
        ),
    ),
    MetricSpec(
        name="mass",
        unit="kg",
        description=(
            "Metal in the sink, over the stated extrusion depth. The budget side of the "
            "challenge."
        ),
    ),
    MetricSpec(
        name="score",
        unit="K.kg/W",
        description=(
            "thermal_resistance x mass, the challenge figure. Resistance alone is bought "
            "trivially by adding material, so the score is what stops that being a strategy."
        ),
    ),
    MetricSpec(
        name="fin_efficiency",
        unit="1",
        description=(
            "What the fins actually move, against what they would move if every point of them "
            "sat at their own root temperature. One means the fin is isothermal; well below "
            "one means it is too tall or too thin for the metal to keep up."
        ),
    ),
    MetricSpec(
        name="radiative_fraction",
        unit="1",
        description=(
            "Share of the heat leaving by radiation rather than convection. About half off an "
            "unfinned plate with a black finish; a seventh off a tightly finned sink, because "
            "the fins have hidden the metal from the room. That collapse is half of why an "
            "optimum fin count exists."
        ),
    ),
    MetricSpec(
        name="view_factor_to_room",
        unit="1",
        description=(
            "Area-weighted view factor from the channel surfaces to the open mouth. Falls as "
            "the fins are packed together, and it is *why* radiation stops paying — reported "
            "so the page can show the mechanism rather than only its consequence."
        ),
    ),
    MetricSpec(
        name="h_convective",
        unit="W/m^2.K",
        description=(
            "The convection coefficient the correlation produced for this channel. An input "
            "to the solve and an output of the geometry, which is the whole of §2.1 — held "
            "constant instead, the model says more fins are always better."
        ),
    ),
]

HEATSINK_ASSUMPTIONS = [
    Assumption(
        name="steady_state",
        statement=(
            "No time derivative: every temperature reported is the equilibrium the device "
            "settles at, reached after a time this model cannot tell you. A transient — "
            "warm-up, a duty cycle, a thermal time constant — is a different problem."
        ),
        excludes=["thermal_time_constant", "transient_temperature", "duty_cycle_rise"],
    ),
    Assumption(
        name="two_dimensional_extrusion",
        statement=(
            "The cross-section is solved and everything is reported per unit depth, then "
            "scaled by the extrusion length. **This is exact rather than an idealisation**: "
            "an extruded sink is genuinely prismatic, so there is no third-dimension "
            "conduction to neglect. What it does assume is that the device heats the base "
            "uniformly along that length."
        ),
        excludes=["spreading_resistance", "end_effects"],
    ),
    Assumption(
        name="correlated_convection_coefficient",
        statement=(
            "The fluid is not solved. `h` enters as a coefficient on exposed faces — but "
            "unlike a fixed number, it is evaluated from the channel the fins leave between "
            "them, by a published correlation. So narrowing the channel lowers `h` as it does "
            "in a real sink, and an optimum fin count exists. What is still not modelled is "
            "the flow itself: no velocity field, no buoyancy pattern, and no way for the "
            "correlation to know it has been asked about a geometry it was not fitted over. "
            "The correlation names itself in every result."
        ),
        excludes=["flow_field", "buoyancy", "local_heat_transfer_coefficient"],
    ),
    Assumption(
        name="grey_diffuse_radiation",
        statement=(
            "Surfaces radiate diffusely with one emissivity at all wavelengths and angles, "
            "exchanging within each fin channel through exact two-dimensional view factors "
            "and with the room through the channel mouth. The air between them is treated as "
            "transparent, which it is: nitrogen and oxygen have no dipole moment and neither "
            "absorb nor emit in the infrared. Not modelled: spectral or specular surfaces, "
            "and any dependence of emissivity on temperature or coating thickness."
        ),
        excludes=["spectral_emissivity", "specular_reflection", "participating_medium"],
    ),
    Assumption(
        name="constant_properties",
        statement=(
            "Conductivity is constant and independent of temperature. Good for aluminium and "
            "copper over the range this exercise spans."
        ),
    ),
]


@register
class HeatSink2D(Solver):
    """Steady conduction in an extruded sink, with convection and radiation off every face."""

    name = "lab.heatsink2d"
    title = "Heat sink — conduction with convection and radiation"
    summary = (
        "Steady conduction on the cross-section of an extruded heat sink, with the convection "
        "coefficient evaluated from the channel between the fins and radiation exchanged "
        "through exact two-dimensional view factors. Reports thermal resistance, mass and the "
        "score that trades them off, and — because both heat paths weaken as the fins are "
        "packed together — has an optimum fin count rather than a direction."
    )
    geometry_types = ["regions2d"]
    #: Its own tag. `heat` is what upstream's two conduction adapters declare, and a page
    #: filtering on it would offer a solver with no radiative boundary — which on the nominal
    #: still-air case is not a different picture but a different answer, high by a tenth.
    physics = "heatsink"
    availability = "finite-volume"
    requires = ["numpy"]
    version = VERSION
    #: A deterministic sequence of dense and matrix-free solves, no seeding, no
    #: thread-dependent reduction. An identical resubmission is worth answering from the cache.
    deterministic = True
    metrics = HEATSINK_METRICS
    assumptions = HEATSINK_ASSUMPTIONS
    examples = [
        CapabilityExample(
            title="the nominal sink",
            description=(
                "30 W on a 60 mm black-anodised extrusion in still air. Ten fins, which is "
                "about where the optimum sits for this envelope."
            ),
            params={"fin_count": 10},
        ),
        CapabilityExample(
            title="past the optimum",
            description=(
                "The same sink with eighteen fins. More metal, more surface, and a *worse* "
                "answer — the channels have choked and the fins now shade each other."
            ),
            params={"fin_count": 18},
        ),
        CapabilityExample(
            title="the control case",
            description=(
                "Radiation off and the coefficient pinned: the simpler model, in which "
                "resistance falls with fin count for ever. Run it beside the first two."
            ),
            params={"fin_count": 18, "radiation": False, "h_override": 10.0},
        ),
    ]

    class Params(BaseModel):
        """The profile, what it is asked to do, and the settings that only affect the error.

        Grouped the way ADR-013 turns on: *Design* is the sink, *Conditions* is the duty, and
        *Advanced* holds the two switches that turn the model back into the simpler one.
        """

        # --- Design: the profile
        base_thickness: float = Field(
            0.005, gt=0.0, le=0.05, description="Base slab thickness, m."
        )
        fin_count: int = Field(10, ge=1, le=60, description="Number of fins across the base.")
        fin_thickness: float = Field(
            0.0015, gt=0.0, le=0.02, description="Fin thickness, m."
        )
        fin_height: float = Field(0.025, gt=0.0, le=0.2, description="Fin height, m.")
        conductivity: float = Field(
            201.0, gt=0.0, description="Solid conductivity, W/m.K. Aluminium 6063 is 201."
        )
        density: float = Field(2700.0, gt=0.0, description="Solid density, kg/m^3.")
        finish: str = Field(
            "black_anodised",
            description=(
                "Surface finish, which sets the emissivity: mill (0.05), clear_anodised "
                "(0.6), black_anodised (0.8). In *Design* rather than *Advanced* because it "
                "competes with fin count, and a control behind a disclosure triangle cannot "
                "compete with anything."
            ),
        )

        # --- Conditions: the duty
        power: float = Field(30.0, gt=0.0, description="Dissipated power, W.")
        depth: float = Field(
            0.060, gt=0.0, le=1.0, description="Extrusion length, m — the third dimension."
        )
        t_ambient: float = Field(25.0, description="Ambient air temperature, degC.")
        footprint_width: float = Field(
            0.030, gt=0.0, description="Contact width of the device on the base, m."
        )
        cooling: str = Field(
            "natural", description='"natural" or "forced".'
        )
        face_velocity: float = Field(
            0.0, ge=0.0, le=20.0, description="Air speed along the channels, m/s. Forced only."
        )
        base_mounted_flush: bool = Field(
            True, description="Is the underside blocked by the mounting?"
        )

        # --- Advanced
        cell_size: float = Field(
            0.0008, gt=1e-5, le=0.01, description="Target mesh cell edge, m."
        )
        radiation: bool = Field(
            True,
            description=(
                "Switch radiation off to reproduce the model upstream's heat adapters solve. "
                "It is a *model* change rather than a setting, and the run row records it."
            ),
        )
        h_override: float | None = Field(
            None,
            ge=0.0,
            description=(
                "Pin the convection coefficient instead of taking it from the correlation. "
                "Exists so a visitor can see what a constant coefficient would have told "
                "them — with it set, the optimum fin count disappears."
            ),
        )
        sweep_fin_counts: list[int] = Field(
            default_factory=list,
            max_length=24,
            description=(
                "Fin counts to re-solve at, returned as a curve of thermal resistance. This "
                "is §10: the sweep is where the optimum becomes visible, and one solve cannot "
                "show it. Each entry is a full solve, so the list is capped."
            ),
        )

        @model_validator(mode="after")
        def _check(self) -> "HeatSink2D.Params":
            if self.finish not in FINISHES:
                raise ValueError(
                    f"finish must be one of {sorted(FINISHES)}, not {self.finish!r}"
                )
            if self.cooling not in ("natural", "forced"):
                raise ValueError('cooling must be "natural" or "forced"')
            if self.cooling == "forced" and self.face_velocity <= 0.0:
                raise ValueError(
                    "forced cooling needs a face_velocity above zero — otherwise say natural"
                )
            return self

    def solve(
        self,
        geometry: Regions2D,
        params: "HeatSink2D.Params",
        ctx: SolverContext,
    ) -> SolverResult:
        xmin, _ymin, xmax, _ymax = geometry.bounds
        base_width = float(xmax - xmin)

        profile = heatsink.Profile(
            base_width=base_width,
            base_thickness=params.base_thickness,
            fin_count=params.fin_count,
            fin_thickness=params.fin_thickness,
            fin_height=params.fin_height,
        )
        conditions = self._conditions(params)
        numerics = heatsink.Numerics(cell_size=params.cell_size)

        total = 1 + len(params.sweep_fin_counts)
        ctx.progress(ProgressEvent(iteration=0, total=total, message="meshing the profile"))
        solution = heatsink.solve(profile, conditions, numerics)
        ctx.progress(
            ProgressEvent(
                iteration=1,
                total=total,
                message=(
                    f"converged in {solution.passes} passes, "
                    f"energy closes to {solution.residuals['energy_balance']:.1e}"
                ),
            )
        )

        series = self._sweep(profile, conditions, numerics, params, ctx, total)
        data, cells = _as_grid(solution, geometry)

        metrics = {
            "t_rise": solution.metrics["t_rise_k"],
            "thermal_resistance": solution.metrics["thermal_resistance_k_w"],
            "mass": solution.metrics["mass_kg"],
            "score": solution.metrics["score_k_kg_w"],
            "fin_efficiency": solution.metrics["fin_efficiency"],
            "radiative_fraction": solution.metrics["radiative_fraction"],
            "view_factor_to_room": solution.metrics["view_factor_to_room"],
            "h_convective": solution.metrics["h_convective_w_m2k"],
        }

        return SolverResult(
            kind="grid2d",
            data=data,
            # Cost, never answer — the separation upstream's MetricSpec draws.
            stats={
                "cells": float(cells),
                "dofs": float(int(solution.mask.sum())),
                "picard_passes": float(solution.passes),
                "cg_iterations": float(solution.cg_iterations),
            },
            metrics={k: float(v) for k, v in metrics.items() if np.isfinite(v)},
            series=series,
            converged=solution.passes < numerics.max_passes,
            # The energy balance, which §8 makes the headline check: what went in against
            # convection plus radiation out. A view-factor leak also surfaces here, since
            # radiation lost to a badly formed enclosure leaves through this number.
            residual=solution.residuals["energy_balance"],
            warnings=_warnings(solution, params),
        )

    def _conditions(self, params: "HeatSink2D.Params") -> heatsink.Conditions:
        return heatsink.Conditions(
            power_w=params.power,
            depth=params.depth,
            ambient_c=params.t_ambient,
            emissivity=FINISHES[params.finish],
            conductivity=params.conductivity,
            density=params.density,
            mode=params.cooling,
            face_velocity=params.face_velocity,
            footprint_width=params.footprint_width,
            base_mounted_flush=params.base_mounted_flush,
            radiation=params.radiation,
            h_override=params.h_override,
        )

    def _sweep(
        self,
        profile: heatsink.Profile,
        conditions: heatsink.Conditions,
        numerics: heatsink.Numerics,
        params: "HeatSink2D.Params",
        ctx: SolverContext,
        total: int,
    ) -> list[dict]:
        """§10, as a curve: thermal resistance against fin count.

        A configuration that does not fit — fins wider than the base can hold — is dropped
        from the curve rather than clamped to something adjacent. A point silently moved is a
        point that lies about which design produced it.
        """
        if not params.sweep_fin_counts:
            return []

        counts: list[float] = []
        resistance: list[float] = []
        radiative: list[float] = []
        for index, count in enumerate(sorted(set(params.sweep_fin_counts)), start=1):
            try:
                swept = heatsink.Profile(
                    base_width=profile.base_width,
                    base_thickness=profile.base_thickness,
                    fin_count=count,
                    fin_thickness=profile.fin_thickness,
                    fin_height=profile.fin_height,
                )
            except ValueError:
                continue
            point = heatsink.solve(swept, conditions, numerics)
            counts.append(float(count))
            resistance.append(point.metrics["thermal_resistance_k_w"])
            radiative.append(point.metrics["radiative_fraction"])
            ctx.progress(
                ProgressEvent(
                    iteration=1 + index, total=total, message=f"sweep: {count} fins"
                )
            )

        if not counts:
            return []
        return [
            {
                "name": "resistance_vs_fin_count",
                "title": "Thermal resistance against fin count",
                "x": {"name": "fin_count", "unit": "1", "values": counts},
                "traces": [
                    {
                        "name": "thermal_resistance",
                        "unit": "K/W",
                        "values": resistance,
                    },
                    {
                        "name": "radiative_fraction",
                        "unit": "1",
                        "values": radiative,
                    },
                ],
            }
        ]


def _worst(residuals: dict[str, float], needle: str) -> float:
    """The worst of the per-channel view-factor residuals, or zero when radiation was off."""
    found = [v for k, v in residuals.items() if needle in k]
    return float(max(found)) if found else 0.0


def _warnings(solution: heatsink.Solution, params: "HeatSink2D.Params") -> list[str]:
    """What the caller should know that did not fail the job.

    Three of these say *the model you got is not the model you may think you asked for*, and
    they are warnings rather than refusals because each one is a legitimate thing to want —
    the two switches exist precisely so a visitor can see the simpler answer. What would not
    be legitimate is getting it silently.
    """
    notes: list[str] = []
    coefficient = solution.coefficient

    if coefficient is not None and not coefficient.valid and coefficient.note:
        notes.append(
            f"the {coefficient.correlation} correlation is out of range: {coefficient.note}. "
            "The coefficient is still reported, and it is an extrapolation."
        )
    if not params.radiation:
        notes.append(
            "radiation is switched off, which is a different physical model rather than a "
            "numerical setting. In still air this over-predicts the temperature rise — by "
            "about a tenth at the optimum fin count and more either side of it."
        )
    if params.h_override is not None:
        notes.append(
            "the convection coefficient is pinned, so it no longer depends on the channel "
            "between the fins. With it held constant the model reports that more fins are "
            "always better, which is the result this exercise exists to correct."
        )

    worst_summation = _worst(solution.residuals, "summation")
    if worst_summation > 1e-8:
        notes.append(
            f"view-factor rows sum to within {worst_summation:.2e} of one rather than to "
            "machine precision, which means an enclosure is not closed or not convex"
        )
    return notes


def _as_grid(solution: heatsink.Solution, geometry: Regions2D) -> tuple[dict, int]:
    """``grid2d``, with the fluid masked out.

    The mask is upstream's convention for its own heat adapters and is used the same way here:
    the region set *is* the solid, everything outside it was never solved, and the mask says
    which cells those are rather than leaving a viewer to infer it from a sentinel value.
    """
    ny, nx = solution.mask.shape
    xmin, ymin, _xmax, _ymax = geometry.bounds
    x, y = solution.x_centres, solution.y_centres
    bounds = [
        float(xmin + x[0]),
        float(ymin + y[0]),
        float(xmin + x[-1]),
        float(ymin + y[-1]),
    ]

    temperature = np.nan_to_num(solution.temperature_c, nan=0.0)
    flux = np.nan_to_num(solution.flux_magnitude, nan=0.0)
    return {
        "bounds": bounds,
        "shape": [ny, nx],
        "fields": {
            "T": temperature.ravel().tolist(),
            "flux": flux.ravel().tolist(),
        },
        # 1 marks a cell the solve did not touch, which is every cell of air.
        "mask": (~solution.mask).astype(np.uint8).ravel().tolist(),
    }, ny * nx
