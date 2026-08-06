"""``lab.airfoil_panel2d`` — the airfoil exercise as a Fenix Spoon capability.

Thin on purpose. The physics is in :mod:`~physics_lab.solvers.panel`, the geometry in
:mod:`~physics_lab.solvers.airfoil_geometry`, the references in
:mod:`~physics_lab.solvers.analytic` and the exercise in :mod:`~physics_lab.solvers.airfoil`;
what is left here is the protocol: a params model, a result envelope, a declared artifact and
the cost estimate the server's cell budget reads.

Nothing in this file is lab-specific to the point of being unportable. It implements the
public ``Solver`` contract and only that, so it could move upstream unchanged the day a panel
method belongs in the toolkit — which is the test ``physics_lab/solvers/__init__.py`` asks any
adapter written here to pass.
"""

import json
from typing import Literal

import numpy as np
from fenixspoon.geometry import Domain2D
from fenixspoon.solvers.base import (
    ArtifactSpec,
    CapabilityExample,
    MetricSpec,
    ProgressEvent,
    Solver,
    SolverContext,
    SolverResult,
)
from fenixspoon.solvers.registry import register
from pydantic import BaseModel, Field

from . import airfoil as exercise
from .airfoil_geometry import read_profile, resample
from .analytic import thin_airfoil
from .panel import inside, solve, velocity_at

#: What the exercise reports, declared so a caller knows before submitting (upstream #43).
#: The values themselves travel in the report artifact until upstream #46 gives the envelope
#: somewhere to put them — see ADR-015.
AIRFOIL_METRICS = [
    MetricSpec(
        name="c_l",
        unit="1",
        description=(
            "Sectional lift coefficient, from the circulation the Kutta condition selects. "
            "Cross-checked against the integrated surface pressure on every run."
        ),
    ),
    MetricSpec(
        name="c_m_c4",
        unit="1",
        description=(
            "Moment coefficient about the quarter chord, nose-up positive. Nearly independent "
            "of incidence, which is what makes the quarter chord a useful reference."
        ),
    ),
    MetricSpec(
        name="l_prime",
        unit="N/m",
        description="Lift per unit span — the dimensional answer a design target is set in.",
    ),
    MetricSpec(
        name="circulation",
        unit="m^2/s",
        description="Bound circulation, clockwise-positive. Zero without a Kutta condition.",
    ),
    MetricSpec(
        name="cp_min",
        unit="1",
        description=(
            "Minimum surface pressure coefficient: the suction peak, and the first thing a "
            "profile change is judged on."
        ),
        field="Cp",
        reduction="min",
    ),
    MetricSpec(
        name="x_cp_over_c",
        unit="1",
        description=(
            "Centre of pressure, in chords from the leading edge. Not reported when the normal "
            "force is too small to place it."
        ),
    ),
]

REPORT_ARTIFACT = ArtifactSpec(
    name="report.json",
    content_type="application/json",
    description=(
        "The engineering answer: metrics, the surface pressure distribution, the incidence "
        "sweep when one was asked for, every verification residual and every validity warning. "
        "Written on every run, because a result without its verification is not a result."
    ),
)


@register
class AirfoilPanel2D(Solver):
    name = "lab.airfoil_panel2d"
    title = "Airfoil, ideal flow with a Kutta condition (panel method)"
    description = (
        "Hess-Smith panel method: constant-strength source panels plus one vortex strength, "
        "closed by the Kutta condition at the trailing edge. Reports C_p, C_L, C_m, the centre "
        "of pressure and — from an incidence sweep — the aerodynamic centre, each with a "
        "verification residual. Inviscid, so it reports no drag and predicts no stall, and says "
        "so rather than printing a number the equations do not support."
    )
    physics = "potential-flow"
    availability = "panel-method"
    requires = ["numpy"]
    metrics = AIRFOIL_METRICS
    artifacts = [REPORT_ARTIFACT]
    examples = [
        CapabilityExample(
            title="the exercise's target condition",
            description="NACA-shaped outline at 40 m/s and sea level: what the page submits.",
            params={"alpha_deg": 5.4, "u_inf": 40.0, "panels": 240},
        ),
        CapabilityExample(
            title="incidence sweep for the aerodynamic centre",
            description=(
                "One job, one factorisation: the influence matrix does not depend on incidence, "
                "so thirteen angles cost thirteen back-substitutions."
            ),
            params={"sweep_from_deg": -4.0, "sweep_to_deg": 8.0, "sweep_step_deg": 1.0},
        ),
        CapabilityExample(
            title="no circulation, for comparison",
            description=(
                "The model this page ran before it had a Kutta condition. Lift comes out zero at "
                "every incidence, and the trailing-edge velocity is unbounded."
            ),
            params={"kutta": "none", "alpha_deg": 5.0},
        ),
    ]

    class Params(BaseModel):
        """Grouped by what each parameter *is*, which is the distinction ADR-013 turns on.

        The page renders these in three separate panels, and it can only do that because the
        grouping is real: a physical input changes the answer, a numerical setting changes the
        error, and a study setting changes how many answers there are. Every bound and every
        description here is what the form is generated from, so this schema is the interface.
        """

        # --- physical: the problem itself (§5)
        alpha_deg: float = Field(
            default=4.0,
            ge=-20.0,
            le=20.0,
            description="Angle of attack of the free stream, degrees",
        )
        u_inf: float = Field(default=40.0, gt=0.0, le=200.0, description="Free-stream speed, m/s")
        rho: float = Field(
            default=1.225,
            gt=0.0,
            le=2.0,
            description="Air density, kg/m^3. The page resolves it from the ISA altitude.",
        )
        mu: float = Field(
            default=1.789e-5,
            gt=0.0,
            le=5e-5,
            description=(
                "Dynamic viscosity, Pa.s. Nothing in this model depends on it: it is carried so "
                "the Reynolds number can be reported, and so a run can be compared with one."
            ),
        )
        sound_speed: float = Field(
            default=340.29,
            gt=0.0,
            le=500.0,
            description="Speed of sound, m/s, which is what makes the Mach warning possible.",
        )
        kutta: Literal["enforced", "none"] = Field(
            default="enforced",
            description=(
                "Impose the Kutta condition, or solve with no circulation. A model choice, not a "
                "numerical one: with no circulation the lift is exactly zero at every incidence."
            ),
        )
        # --- numerical: how well it is approximated, and nothing else (§7)
        #
        # The two defaults were raised together (ADR-021) once the page became something a
        # visitor plays with rather than reads, and they were chosen by measuring rather than
        # by taste, because they cost in different currencies. On a NACA 2412 at 5.4°, in the
        # 2.6 x 1.2-chord window the page submits:
        #
        #     panels 240 -> 320, resolution fixed   +0.19 s   +0.01 MB
        #     panels 400, resolution fixed          +0.36 s   +0.01 MB
        #     resolution 192 -> 256, panels fixed   +0.35 s   +1.08 MB
        #     resolution 192 -> 320, panels fixed   +0.92 s   +2.50 MB
        #
        # Panels are nearly free: the influence matrix is (N+1)^2 of arithmetic and the
        # convergence check's refinement is bounded by PANEL_CEILING. Resolution is not, and
        # the currency that matters is not seconds but *bytes* — every grid point ships a
        # speed, a C_p and two velocity components as JSON, so the field is the response.
        # 320 x 320 would have been 1.6 s and 3.9 MB per solve, which is a poor trade on a
        # page whose invitation is "press these six buttons". 320 panels and 256 points is
        # 1.0 s and 2.5 MB: a visibly denser field and better streamlines, at a cost a game
        # can pay. The ceiling is unchanged, so anyone who wants 512 can still ask for it.
        panels: int = Field(
            default=320,
            ge=40,
            le=400,
            description="Panels around the outline. Its only legitimate effect is on the error.",
        )
        trailing_edge: Literal["closed", "as_drawn"] = Field(
            default="closed",
            description=(
                "Close the trailing edge, or keep the gap the outline has. A gap makes the Kutta "
                "condition depend on how the base is closed."
            ),
        )
        resolution: int = Field(
            default=256,
            ge=16,
            le=512,
            description="Sampling grid for the field picture, along the longer edge of the domain.",
        )
        convergence_check: bool = Field(
            default=True,
            description="Also solve at half the panels, and report how much C_L moved.",
        )
        # --- study: what to run (§7.3)
        sweep_from_deg: float | None = Field(
            default=None,
            ge=-20.0,
            le=20.0,
            description="Start of an incidence sweep. Null for a single solve.",
        )
        sweep_to_deg: float | None = Field(
            default=None, ge=-20.0, le=20.0, description="End of the incidence sweep."
        )
        sweep_step_deg: float = Field(
            default=2.0, gt=0.0, le=10.0, description="Incidence step within the sweep."
        )
        # --- output
        output: Literal["grid2d", "mesh2d"] = Field(
            default="grid2d", description="Result kind: the sampling grid, or its triangulation."
        )

    @classmethod
    def estimate_cells(cls, geometry: Domain2D, params: "AirfoilPanel2D.Params") -> int:
        """The sampling grid, which is what the memory actually goes on.

        The linear system is ``(N+1)²`` and trivial beside it: 240 panels is a 58k-entry
        matrix, while a 192-point grid is 27k points each of which sums over every panel. The
        server's budget is expressed in cells, so cells is what is reported.
        """
        ny, nx = _grid_shape(geometry.bounds, params.resolution)
        return ny * nx

    def solve(
        self, geometry: Domain2D, params: "AirfoilPanel2D.Params", ctx: SolverContext
    ) -> SolverResult:
        ctx.progress(ProgressEvent(iteration=0, total=4, message="reading the profile"))
        outline = np.asarray(geometry.obstacle.points, dtype=float)
        closed_te = params.trailing_edge == "closed"
        profile = read_profile(np.vstack([outline, outline[:1]]))
        conditions = exercise.Conditions(
            u_inf=params.u_inf,
            rho=params.rho,
            mu=params.mu,
            sound_speed=params.sound_speed,
            chord=profile.chord,
        )
        reference = thin_airfoil(profile.station, profile.camber)

        # Incidence is measured from the chord line the outline itself defines, so a dragged
        # shape has a meaningful one and a catalogue profile's can be checked (§4.3, §5.1).
        alpha = np.radians(params.alpha_deg) - profile.chord_angle
        circulation = None if params.kutta == "enforced" else 0.0
        nodes = resample(profile, params.panels, closed_te=closed_te)

        ctx.progress(ProgressEvent(iteration=1, total=4, message=f"solving {params.panels} panels"))
        primary = solve(nodes, params.u_inf, alpha, circulation)
        coeff = exercise.coefficients(primary, profile.chord, params.rho)

        refined = None
        if params.convergence_check:
            # Solved at *twice* the panels, not half. The question a convergence check answers is
            # "would refining this change the answer?", and halving answers a different and much
            # harsher one: the step from 120 to 240 panels is 1.4 %, the step from 240 to 480 is
            # 0.15 %, and reporting the first against a 0.5 % tolerance would put a warning on
            # every run made at the default settings.
            finer = min(2 * params.panels, PANEL_CEILING)
            solution = solve(
                resample(profile, finer, closed_te=closed_te), params.u_inf, alpha, circulation
            )
            refined = exercise.coefficients(solution, profile.chord, params.rho)

        checks = exercise.verify(coeff, primary, reference, refined)
        warnings = exercise.validity(
            coeff,
            conditions,
            profile,
            reference,
            checks,
            lifting=params.kutta == "enforced",
            te_as_drawn=not closed_te,
        )

        study = None
        if params.sweep_from_deg is not None and params.sweep_to_deg is not None:
            ctx.progress(ProgressEvent(iteration=2, total=4, message="sweeping"))
            angles = _sweep_angles(params)
            study = exercise.sweep(
                profile,
                params.panels,
                params.u_inf,
                params.rho,
                angles - np.degrees(profile.chord_angle),
            )

        ctx.progress(ProgressEvent(iteration=3, total=4, message="sampling the field"))
        data, cells = _sample_field(geometry, params, primary, profile, nodes)

        report = exercise.Report(
            solver={"name": self.name, "version": VERSION},
            model={
                "level": 1,
                "kutta": params.kutta,
                "trailing_edge": params.trailing_edge,
                "withheld": ["c_d", "l_over_d", "c_l_max", "alpha_stall"],
            },
            geometry={
                "chord_m": profile.chord,
                "chord_angle_deg": float(np.degrees(profile.chord_angle)),
                "te_gap_over_c": profile.te_gap / profile.chord,
                "thickness_over_c": float(profile.thickness.max()),
                "camber_over_c": float(profile.camber.max()),
                "vertices": int(len(outline)),
                "panels": int(primary.geometry.count),
                "section_readable": profile.single_valued,
                "camber_line": np.column_stack([profile.station, profile.camber]).tolist(),
                "thickness_line": np.column_stack([profile.station, profile.thickness]).tolist(),
            },
            conditions={
                "u_inf": params.u_inf,
                "rho": params.rho,
                "mu": params.mu,
                "sound_speed": params.sound_speed,
                "alpha_requested_deg": params.alpha_deg,
                "dynamic_pressure": conditions.dynamic_pressure,
            },
            dimensionless={"reynolds": conditions.reynolds, "mach": conditions.mach},
            metrics={k: v for k, v in vars(coeff).items()},
            curves=exercise.surface_curves(primary, profile.chord),
            sweep=None if study is None else vars(study),
            verification=vars(checks),
            validity={"warnings": warnings},
        )

        path = ctx.artifact(REPORT_ARTIFACT.name, REPORT_ARTIFACT.content_type)
        path.write_text(json.dumps(report.to_dict(), indent=1, allow_nan=False), encoding="utf-8")

        return SolverResult(
            kind=params.output,
            data=data,
            # Cost only. The engineering answer is in the artifact, never in `stats` — the
            # distinction upstream's MetricSpec draws, and the one ADR-013 keeps.
            stats={
                "cells": float(cells),
                "panels": float(primary.geometry.count),
                "dofs": float(primary.geometry.count + 1),
            },
        )


VERSION = "1.0.0"

#: The convergence check may not refine past this. Twice 400 panels is 800, whose matrix is
#: still trivial; the cap exists so the ceiling is a stated number rather than a consequence.
PANEL_CEILING = 800


def _sweep_angles(params: "AirfoilPanel2D.Params") -> np.ndarray:
    """Sweep stations: both ends, the requested step between them, and the primary incidence.

    "Both ends" has to be arranged rather than assumed. Stepping from the start stops short
    whenever the span is not a whole number of steps — from −4° to 8° in steps of 5° gives
    −4, 1, 6 and never reaches 8 — so the far end is appended explicitly. The alternative,
    stretching the step to divide the span, would silently answer a question the visitor did
    not ask.

    The step is *not* adjusted, so the last interval can be shorter than the rest. That is
    harmless here: every derived quantity is a least-squares fit over the stations, which does
    not require them to be evenly spaced.

    Deduplicated to a thousandth of a degree, because two stations closer together than that
    are one station — the requested incidence usually *is* one of the sweep's own stations, and
    asking the solver for it twice would add a duplicate right-hand side and a duplicate point
    in every fit.
    """
    if params.sweep_from_deg is None or params.sweep_to_deg is None:
        raise ValueError("a sweep needs both ends")
    start, stop = sorted([float(params.sweep_from_deg), float(params.sweep_to_deg)])
    step = max(abs(params.sweep_step_deg), 1e-3)

    # The tolerance stops a station that lands on `stop` to within rounding from being counted
    # out by a floating-point hair — otherwise the number of stations depends on whether
    # (stop - start) / step comes out as 5.999999999 or 6.0.
    count = int(np.floor((stop - start) / step + 1e-9)) + 1
    angles = start + step * np.arange(max(count, 1))
    return np.unique(np.round(np.append(angles, [stop, params.alpha_deg]), 3))


def _grid_shape(bounds, resolution: int) -> tuple[int, int]:
    """Grid shape (ny, nx) for a resolution along the longer edge.

    Deliberately the same rule as upstream's ``mock.laplace2d``, so a visitor comparing this
    page's field with that solver's is comparing the physics and not two griddings.
    """
    xmin, ymin, xmax, ymax = bounds
    lx, ly = xmax - xmin, ymax - ymin
    if lx >= ly:
        return max(8, round(resolution * ly / lx)), resolution
    return resolution, max(8, round(resolution * lx / ly))


def _sample_field(geometry, params, solution, profile, nodes) -> tuple[dict, int]:
    """Sample velocity, speed and C_p onto a grid, in the frame the geometry arrived in.

    The solve happens in the chord frame; the picture has to be in the visitor's frame, so
    the sampling points are rotated in and the velocity vectors rotated back out. There is no
    streamfunction field: the streamfunction of a source sheet is multivalued, so evaluating
    it panel by panel would lay a visible seam along every panel's line. The velocity field
    carries the same information without that hazard, and the viewer draws it directly
    (``docs/exercises/airfoil.md`` §10.1).
    """
    xmin, ymin, xmax, ymax = geometry.bounds
    ny, nx = _grid_shape(geometry.bounds, params.resolution)
    x = np.linspace(xmin, xmax, nx)
    y = np.linspace(ymin, ymax, ny)
    xx, yy = np.meshgrid(x, y)
    points = np.column_stack([xx.ravel(), yy.ravel()])

    # Into the chord frame, and the velocities back out of it. The leading edge is the one
    # point the two frames agree on, so it is the origin of the transform.
    angle = -profile.chord_angle
    rotate = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    local = (points - profile.leading_edge) @ rotate.T
    velocity = velocity_at(local, solution) @ rotate
    mask = inside(local, nodes)

    velocity[mask] = 0.0
    speed = np.hypot(velocity[:, 0], velocity[:, 1])
    cp = np.where(mask, 0.0, 1.0 - (speed / params.u_inf) ** 2)

    if params.output == "mesh2d":
        return _as_mesh(x, y, mask.reshape(ny, nx), velocity, speed, cp, geometry.bounds), ny * nx

    return {
        "bounds": [xmin, ymin, xmax, ymax],
        "shape": [ny, nx],
        "fields": {"speed": speed.tolist(), "Cp": cp.tolist()},
        "vector_fields": {"velocity": velocity.tolist()},
        "mask": mask.astype(np.uint8).tolist(),
    }, ny * nx


def _as_mesh(x, y, mask, velocity, speed, cp, bounds) -> dict:
    """Triangulate the unmasked part of the grid, the way upstream's adapters do."""
    ny, nx = mask.shape
    keep = ~mask
    ident = -np.ones((ny, nx), dtype=np.int64)
    ident[keep] = np.arange(int(keep.sum()))
    rows, cols = np.nonzero(keep)
    points = np.column_stack([x[cols], y[rows]])

    c00, c01 = ident[:-1, :-1], ident[:-1, 1:]
    c10, c11 = ident[1:, :-1], ident[1:, 1:]
    full = (c00 >= 0) & (c01 >= 0) & (c10 >= 0) & (c11 >= 0)
    a, b, c, d = c00[full], c01[full], c10[full], c11[full]
    triangles = np.concatenate([np.column_stack([a, b, d]), np.column_stack([a, d, c])])

    flat = keep.ravel()
    return {
        "bounds": list(bounds),
        "points": points.tolist(),
        "triangles": triangles.tolist(),
        "point_fields": {"speed": speed[flat].tolist(), "Cp": cp[flat].tolist()},
        "point_vector_fields": {"velocity": velocity[flat].tolist()},
    }
