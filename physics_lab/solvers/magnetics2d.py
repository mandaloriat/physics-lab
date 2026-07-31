"""``lab.magnetics2d`` — the magnetics exercise as a Fenix Spoon capability.

Thin on purpose. The discretisation is in :mod:`~physics_lab.solvers.magnetics` and the
exercise in :mod:`~physics_lab.solvers.solenoid`; what is left here is the protocol: a params
model, a result envelope, a declared artifact and the cost estimate the server's cell budget
reads.

The second lab solver, and it exists for the same reason the first one did. Upstream's
``mock.magnetostatics2d`` solves the right equation on the wrong grid for this purpose, and
two measurements say so. It rasterises the material onto a uniform mesh, so a 20.000 mm core
comes out **20.339, 20.168 and 20.084 mm** wide at 60, 120 and 240 cells across — refining the
mesh moves the geometry as well as the answer, and there is no refinement path along which the
magnet stays the same magnet. And it takes a fixed number of Jacobi sweeps and reports no
residual, so at 480 cells it exhausts its own iteration ceiling and returns a flux **26 %
adrift** with nothing on the result to say it stopped short.

Both are fine for the picture it was written to draw and fatal for a number, which is why
``docs/exercises/solenoid.md`` refused to print one until this existed. Here the grid carries a
line on every material boundary — every region the page submits is an axis-aligned rectangle,
so the fit is exact — and the conjugate-gradient solve reports the residual it actually reached.
See ADR-018.

Nothing in this file is lab-specific to the point of being unportable: it implements the
public ``Solver`` contract and only that.
"""

import json
from typing import Literal

import numpy as np
from fenixspoon.geometry import Regions2D
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

from . import solenoid as exercise
from .magnetics import build_grid, flux_density, rasterise, sample_uniform, solve_potential

VERSION = "1.0.0"

#: What the exercise reports, declared so a caller knows before submitting (upstream #43).
#: The values themselves travel in the report artifact until upstream #46 gives the envelope
#: somewhere to put them — see ADR-015.
#:
#: ``b_max`` and ``a_max`` keep upstream's names and meanings deliberately. A caller that
#: swaps ``mock.magnetostatics2d`` for this one is asking the same physics a sharper question,
#: and it should not have to learn a second vocabulary to do it; the metrics this adds are
#: added, not substituted.
MAGNETICS_METRICS = [
    MetricSpec(
        name="flux_core",
        unit="Wb/m",
        description=(
            "Flux per unit depth across the core's mid-plane, from the drop in A_z across it. "
            "Per metre of depth, because a 2-D slice has no length: this is a flux density in "
            "the third dimension, not a flux."
        ),
    ),
    MetricSpec(
        name="b_mean_core",
        unit="T",
        description=(
            "Mean flux density over the core's mid-plane section: the core flux divided by the "
            "core's width. The number a magnetic circuit is sized against."
        ),
    ),
    MetricSpec(
        name="b_section_max",
        unit="T",
        description=(
            "The busiest section of the core: flux density averaged across the iron, "
            "maximised over every section along it. This is the saturation number, and it is "
            "a section average rather than a peak because the pointwise peak sits at a corner "
            "singularity and climbs with every refinement instead of converging."
        ),
    ),
    MetricSpec(
        name="leakage_ratio",
        unit="1",
        description=(
            "Share of the flux crossing the mid-plane that misses the core, measured against "
            "the whole up-going bundle — the surface where B_y changes sign."
        ),
    ),
    MetricSpec(
        name="ampere_turns",
        unit="A",
        description=(
            "Current through one sense of the winding, integrated over its section. Exact: it "
            "is a property of the geometry and needs no solve."
        ),
    ),
    MetricSpec(
        name="energy",
        unit="J/m",
        description=(
            "Magnetic energy stored in the modelled window, per unit depth. Bounded by the "
            "window rather than by space, so the truncation warning applies to it first."
        ),
    ),
    MetricSpec(
        name="inductance_index",
        unit="H/m",
        description=(
            "Core flux per ampere-turn: the permeance the winding sees through the iron. "
            "Multiply by turns squared and by depth for an inductance."
        ),
    ),
    MetricSpec(
        name="b_max",
        unit="T",
        description=(
            "Peak flux density in the published field, upstream's metric of the same name and "
            "a reduction of exactly that raster. It is not the saturation number and must not "
            "be read as one: the true peak is at a corner singularity, so this value rises "
            "with resolution rather than converging. `b_section_max` is the one to size iron "
            "against."
        ),
        field="B",
        reduction="max",
    ),
    MetricSpec(
        name="a_max",
        unit="Wb/m",
        description=(
            "Peak vector potential. With A_z = 0 on the outer boundary this is the flux per "
            "unit depth between the peak and that boundary."
        ),
        field="A",
        reduction="max",
    ),
]

REPORT_ARTIFACT = ArtifactSpec(
    name="report.json",
    content_type="application/json",
    description=(
        "The engineering answer: metrics, A_z and B_y along the core's mid-plane, every "
        "verification residual and every validity warning. Written on every run, because a "
        "result without its verification is not a result."
    ),
)


@register
class Magnetics2D(Solver):
    name = "lab.magnetics2d"
    title = "Magnetostatics on an interface-fitted grid (finite volume)"
    description = (
        "Vector potential for out-of-plane currents, solved by finite volumes on a grid with "
        "a line on every material boundary, so the iron/air interface is a face and not a "
        "staircase. Reports the core flux, its mean and worst-section flux density, the "
        "leakage against the whole flux bundle, the stored energy and the ampere-turns, each "
        "with a verification residual: an energy balance, a two-route flux consistency, "
        "Ampere's law "
        "around the winding and a refinement study. Linear material, so it says when a run "
        "has left the domain where that is true rather than printing a number past it."
    )
    geometry_types = ["regions2d"]
    physics = "magnetostatics"
    availability = "finite-volume"
    requires = ["numpy"]
    metrics = MAGNETICS_METRICS
    artifacts = [REPORT_ARTIFACT]
    examples = [
        CapabilityExample(
            title="the exercise's default cross-section",
            description="What the page submits: enough resolution to measure, not only to see.",
            params={"cells_across": 80, "convergence_check": True},
        ),
        CapabilityExample(
            title="fast look",
            description=(
                "Coarse, and with the refinement study off. Every metric is still reported and "
                "the convergence residual is not, which is the honest trade."
            ),
            params={"cells_across": 40, "convergence_check": False},
        ),
        CapabilityExample(
            title="resolved, for a number worth quoting",
            description=(
                "Four times the cells of the default, with the refinement study off — because "
                "the study is five times the cells, and this many of them with it on is past "
                "the public server's budget. The interface is exact at every resolution, so "
                "refining moves the answer rather than moving the geometry."
            ),
            params={"cells_across": 200, "tolerance": 1e-11, "convergence_check": False},
        ),
    ]

    class Params(BaseModel):
        """Grouped by what each parameter *is*, which is the distinction ADR-013 turns on.

        One thing is different here from the airfoil, and worth saying rather than leaving to
        be noticed: **there are almost no physical parameters**, because ``regions2d`` carries
        the physics in the geometry. The permeability, the current density and every dimension
        are region properties; what is left for the params model is the numerics, plus one
        modelling declaration. The page's *Design* and *Conditions* groups therefore build the
        geometry, and *Advanced* is generated from this schema — which is exactly the split
        the contract's §5 asks for, arrived at from the other side.
        """

        # --- modelling: a declaration about the problem, not a knob on the answer
        core_region: str | None = Field(
            default=None,
            description=(
                "Which region is the magnetic circuit. Null resolves it to the region of "
                "greatest permeability, which is what 'the core' means."
            ),
        )
        # --- numerical: how well it is approximated, and nothing else
        cells_across: int = Field(
            default=80,
            ge=12,
            le=320,
            description=(
                "Cells across the regions — the magnet, not the window. A lower bound rather "
                "than a target: every material boundary gets a grid line, so intervals are only "
                "ever divided finer. Counting across the window instead would mean that "
                "widening the window to control the truncation coarsened the magnet."
            ),
        )
        far_field_growth: float = Field(
            default=1.2,
            ge=1.0,
            le=1.5,
            description=(
                "Cell-to-cell growth ratio out in the air beyond the regions. This is what "
                "makes a window many times the magnet affordable. 1.0 gives a uniform grid, "
                "and a window worth having with it."
            ),
        )
        resolution: int = Field(
            default=256,
            ge=32,
            le=512,
            description=(
                "Sampling grid for the field picture, along the longer edge of the window. "
                "Affects the picture and no reported number."
            ),
        )
        tolerance: float = Field(
            default=1e-10,
            gt=0.0,
            le=1e-4,
            description="Relative residual the conjugate-gradient solve stops at.",
        )
        max_iterations: int = Field(
            default=20000,
            ge=50,
            le=200000,
            description="Iteration ceiling. A four-decade permeability contrast needs the room.",
        )
        convergence_check: bool = Field(
            default=True,
            description=(
                "Also solve at twice the resolution, and report how much the mean flux density "
                "moved. Four times the cells, and the only check that measures the mesh."
            ),
        )
        # --- output
        output: Literal["grid2d", "mesh2d"] = Field(
            default="grid2d",
            description=(
                "A uniform raster of the solution, or the interface-fitted cells themselves. "
                "The mesh is the discretisation; the grid is a resampling of it."
            ),
        )

    @classmethod
    def estimate_cells(cls, geometry: Regions2D, params: "Magnetics2D.Params") -> int:
        """The real count, not an estimate: the grid is cheap to build and expensive to solve.

        Two things are counted, because the job pays for both. The refinement study is four
        more cells for every one, and it is included when it was asked for. The field raster is
        a separate array of its own size, and it is what the *memory* goes on — the airfoil
        adapter counts only that, and here the solve is the larger half.
        """
        cells = _grid_for(geometry, params.cells_across, params.far_field_growth).cells
        solve = cells * 5 if params.convergence_check else cells
        ny, nx = _raster_shape(geometry.bounds, params.resolution)
        return solve + ny * nx

    def solve(
        self, geometry: Regions2D, params: "Magnetics2D.Params", ctx: SolverContext
    ) -> SolverResult:
        ctx.progress(ProgressEvent(iteration=0, total=3, message="fitting the grid to the regions"))
        names = [region.name for region in geometry.regions]
        materials_list = [dict(region.material) for region in geometry.regions]

        primary = _run(geometry, params, params.cells_across, ctx, stage=1)
        metrics, integrals = primary.answer

        refined_metrics = None
        if params.convergence_check:
            ctx.progress(ProgressEvent(iteration=2, total=3, message="refining, for the study"))
            refined_metrics = _run(
                geometry, params, 2 * params.cells_across, ctx, stage=2
            ).answer[0]

        checks = exercise.verify(
            integrals,
            metrics,
            linear_residual=primary.solution.residual,
            linear_tolerance=params.tolerance,
            refined=refined_metrics,
        )
        saturation = exercise.saturation_limit(materials_list, primary.magnet.core)
        warnings = exercise.validity(metrics, primary.magnet, primary.materials, checks, saturation)

        ctx.progress(ProgressEvent(iteration=3, total=3, message="sampling the field"))
        data, cells = _emit(primary, params)

        report = exercise.Report(
            solver={"name": self.name, "version": VERSION},
            model={
                "equation": "-div(nu grad A_z) = J_z, A_z = 0 on the outer boundary",
                "material": "linear",
                "discretisation": "cell-centred finite volume on an interface-fitted graded grid",
                "core_region": primary.magnet.core_name,
                "saturation_flux_density": saturation,
                "withheld": ["b_peak_iron", "gap_force", "losses", "b_h_curve"],
            },
            geometry={
                "bounds": list(geometry.bounds),
                "regions": [
                    {
                        "name": name,
                        "mu_r": float(material.get("mu_r", 1.0)),
                        "current_density": float(material.get("current_density", 0.0)),
                    }
                    for name, material in zip(names, materials_list, strict=True)
                ],
                "core_width": primary.magnet.core_width,
                "mid_plane_y": primary.magnet.plane_y,
                "interface_fitted": primary.materials.exact,
                "cells": int(primary.grid.cells),
            },
            # Dumped from the validated model, so it carries the resolved value of every
            # parameter — including the ones the caller never mentioned.
            numerics=params.model_dump(),
            conditions={
                "ampere_turns": metrics.ampere_turns,
                "net_current": metrics.net_current,
                "mu_r_max": float(primary.materials.mu_r.max()),
            },
            dimensionless={
                "leakage_ratio": metrics.leakage_ratio,
                "saturation_margin": (
                    None if metrics.b_section_max is None else metrics.b_section_max / saturation
                ),
            },
            metrics=vars(metrics),
            curves=exercise.mid_plane_curve(
                primary.grid, primary.solution.a, primary.field, primary.magnet
            ),
            verification=vars(checks),
            validity={
                "warnings": warnings,
                "ampere_contour": list(integrals.contour) if integrals.contour else None,
                "bundle_x": list(metrics.bundle_x) if metrics.bundle_x else None,
            },
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
                "dofs": float(primary.grid.cells),
                "iterations": float(primary.solution.iterations),
            },
        )


# ----------------------------------------------------------------------------- the machinery


class _Run:
    """One solve at one resolution, with everything derived from it."""

    __slots__ = ("grid", "materials", "solution", "field", "magnet", "answer")

    def __init__(self, grid, materials, solution, field_, magnet, answer):
        self.grid = grid
        self.materials = materials
        self.solution = solution
        self.field = field_
        self.magnet = magnet
        self.answer = answer


def _outlines(geometry: Regions2D) -> list[np.ndarray]:
    return [np.asarray(region.shape.points, dtype=float) for region in geometry.regions]


def _grid_for(geometry: Regions2D, cells_across: int, growth: float):
    return build_grid(geometry.bounds, _outlines(geometry), cells_across, growth)


def _run(
    geometry: Regions2D,
    params: "Magnetics2D.Params",
    cells_across: int,
    ctx: SolverContext,
    stage: int,
) -> _Run:
    """Grid, materials, solve, field, metrics — at one resolution."""
    grid = _grid_for(geometry, cells_across, params.far_field_growth)
    materials = rasterise(
        grid,
        _outlines(geometry),
        [dict(region.material) for region in geometry.regions],
        dict(geometry.background),
    )

    def tick(iteration: int, residual: float) -> None:
        ctx.check_cancelled()
        ctx.progress(
            ProgressEvent(
                iteration=stage,
                total=3,
                residual=residual,
                message=f"{grid.cells} cells, {iteration} iterations",
            )
        )

    solution = solve_potential(
        grid,
        materials,
        tolerance=params.tolerance,
        max_iterations=params.max_iterations,
        on_iteration=tick,
    )
    field_ = flux_density(grid, materials, solution.a)
    names = [region.name for region in geometry.regions]
    magnet = exercise.locate(grid, materials, names, params.core_region)
    return _Run(grid, materials, solution, field_, magnet, exercise.measure(
        grid, materials, solution.a, field_, magnet
    ))


def _raster_shape(bounds, resolution: int) -> tuple[int, int]:
    """Raster shape (ny, nx) for a resolution along the longer edge.

    Deliberately the same rule as upstream's ``mock.laplace2d``, so a visitor comparing this
    solver's picture with the preview's is comparing two solves and not two rasters.
    """
    xmin, ymin, xmax, ymax = bounds
    lx, ly = xmax - xmin, ymax - ymin
    if lx >= ly:
        return max(8, round(resolution * ly / lx)), resolution
    return resolution, max(8, round(resolution * lx / ly))


def _emit(run: _Run, params: "Magnetics2D.Params") -> tuple[dict, int]:
    """The result envelope's ``data``, in whichever kind was asked for.

    Field names follow ``mock.magnetostatics2d`` — ``A``, ``B``, ``mu_r`` — so a page can show
    either solver without a translation table. What is new is the vector field: this solver
    publishes **B** as a vector, which is what lets the workspace draw glyphs and integrate
    streamlines instead of disabling both tools with "this result publishes no vector field".
    """
    grid, materials, field_ = run.grid, run.materials, run.field
    magnitude = field_.magnitude

    if params.output == "mesh2d":
        return _as_mesh(grid, materials, run.solution.a, field_), grid.cells

    ny, nx = _raster_shape(grid.bounds, params.resolution)
    take = lambda values: sample_uniform(grid, values, nx, ny).ravel()  # noqa: E731
    vectors = np.column_stack([take(field_.bx), take(field_.by)])
    return {
        "bounds": list(grid.bounds),
        "shape": [ny, nx],
        "fields": {
            "A": take(run.solution.a).tolist(),
            "B": take(magnitude).tolist(),
            "mu_r": take(materials.mu_r).tolist(),
        },
        "vector_fields": {"flux_density": vectors.tolist()},
        "mask": np.zeros(ny * nx, dtype=np.uint8).tolist(),
    }, ny * nx


def _as_mesh(grid, materials, potential, field_) -> dict:
    """Triangulate the cell centres, which is the discretisation the answer was computed on.

    Not the cells as quadrilaterals: ``mesh2d`` carries triangles with one value per node, and
    the values here live at cell centres, so the centres are the nodes. The picture is then
    the honest one — a graded mesh, fine where the regions made it fine.
    """
    ny, nx = grid.shape
    xx, yy = grid.centres()
    ident = np.arange(ny * nx).reshape(ny, nx)
    a, b = ident[:-1, :-1], ident[:-1, 1:]
    c, d = ident[1:, :-1], ident[1:, 1:]
    triangles = np.concatenate(
        [
            np.column_stack([a.ravel(), b.ravel(), d.ravel()]),
            np.column_stack([a.ravel(), d.ravel(), c.ravel()]),
        ]
    )
    return {
        "bounds": list(grid.bounds),
        "points": np.column_stack([xx.ravel(), yy.ravel()]).tolist(),
        "triangles": triangles.tolist(),
        "point_fields": {
            "A": potential.ravel().tolist(),
            "B": field_.magnitude.ravel().tolist(),
            "mu_r": materials.mu_r.ravel().tolist(),
        },
        "point_vector_fields": {
            "flux_density": np.column_stack([field_.bx.ravel(), field_.by.ravel()]).tolist()
        },
    }
