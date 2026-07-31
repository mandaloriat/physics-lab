"""The magnetics adapter's seam with Fenix Spoon: schema, envelope, artifact, warnings.

Where ``test_magnetics_method.py`` asks whether the physics is right, this asks whether the
capability is honest about it — that the declared metrics are the ones actually reported, that
the report artifact carries its verification, that ``stats`` stays about cost, and that a run
outside the model's stated domain says so on itself.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from fenixspoon.geometry import Regions2D
from fenixspoon.protocol import ResultEnvelope
from fenixspoon.solvers import available_solvers
from fenixspoon.solvers.base import SolverContext

from physics_lab.solvers.magnetics2d import REPORT_ARTIFACT, Magnetics2D

SOLVER = "lab.magnetics2d"
MM = 1.0e-3


def rectangle(x0, y0, x1, y1) -> dict:
    return {"type": "polygon2d", "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


def cross_section(
    window: float = 60 * MM,
    core: float = 10 * MM,
    gap: float = 5 * MM,
    winding: float = 10 * MM,
    half_height: float = 30 * MM,
    mu_r: float = 1000.0,
    current: float = 5.0e6,
    core_material: dict | None = None,
) -> Regions2D:
    """The payload the page builds, as ``regions2d``.

    Deliberately assembled here rather than imported from the front-end's generator: a test
    that had to agree with the page's defaults would fail whenever they were retuned, and none
    of these tests is about the defaults.
    """
    bore = core + gap
    outer = bore + winding
    return Regions2D(
        bounds=(-window, -window, window, window),
        background={"mu_r": 1.0},
        regions=[
            {
                "name": "core",
                "shape": rectangle(-core, -half_height, core, half_height),
                "material": core_material if core_material is not None else {"mu_r": mu_r},
            },
            {
                "name": "winding_left",
                "shape": rectangle(-outer, -half_height, -bore, half_height),
                "material": {"current_density": -current},
            },
            {
                "name": "winding_right",
                "shape": rectangle(bore, -half_height, outer, half_height),
                "material": {"current_density": current},
            },
        ],
    )


def run(tmp_path: Path, geometry: Regions2D | None = None, **params):
    """Solve, and hand back both the envelope and the parsed report."""
    solver = Magnetics2D()
    ctx = SolverContext(lambda event: None, artifact_dir=tmp_path)
    settings = {"resolution": 80, "convergence_check": False, **params}
    result = solver.solve(geometry or cross_section(), solver.Params(**settings), ctx)
    report = json.loads((tmp_path / REPORT_ARTIFACT.name).read_text(encoding="utf-8"))
    return result, report


# ------------------------------------------------------------------------------ the catalogue


def test_the_adapter_registers_itself():
    """Importing ``physics_lab.solvers`` must be enough — that is the whole wiring contract."""
    catalogue = {info.name: info for info in available_solvers()}
    assert SOLVER in catalogue
    assert catalogue[SOLVER].geometry_types == ["regions2d"]


def test_it_declares_the_physics_the_page_filters_on():
    """The page picks solvers by declared `physics`; a heat solver also takes `regions2d`."""
    assert Magnetics2D.physics == "magnetostatics"
    assert Magnetics2D.requires == ["numpy"]


def test_the_parameter_schema_publishes_bounds_and_descriptions():
    """The page generates its form from this and invents nothing, so it has to be complete."""
    schema = Magnetics2D.info().params_schema["properties"]
    for name in ("resolution", "tolerance", "max_iterations", "convergence_check", "output"):
        assert name in schema, name

    assert schema["resolution"]["minimum"] == 24
    assert schema["resolution"]["maximum"] == 512
    assert all(
        "description" in spec or "anyOf" in spec or "allOf" in spec for spec in schema.values()
    )


def test_every_declared_metric_is_actually_reported(tmp_path):
    """A declaration nothing fulfils is worse than no declaration (upstream #43)."""
    _, report = run(tmp_path)
    for spec in Magnetics2D.metrics:
        assert spec.name in report["metrics"], spec.name


def test_a_declared_field_reduction_names_a_field_the_solver_emits(tmp_path):
    """`b_max` claims to reduce `B`, so `B` had better be in the payload."""
    result, _ = run(tmp_path)
    for spec in Magnetics2D.metrics:
        if spec.field is not None:
            assert spec.field in result.data["fields"], spec.name


def test_the_declared_artifact_is_the_one_written(tmp_path):
    solver = Magnetics2D()
    ctx = SolverContext(lambda event: None, artifact_dir=tmp_path)
    solver.solve(cross_section(), solver.Params(resolution=40, convergence_check=False), ctx)

    assert [entry["name"] for entry in ctx.artifacts] == [REPORT_ARTIFACT.name]
    assert ctx.artifacts[0]["content_type"] == "application/json"
    assert REPORT_ARTIFACT.when is None, "the report is not optional"


def test_the_examples_are_valid_parameter_sets():
    """A published example a caller cannot submit is worse than none."""
    for example in Magnetics2D.examples:
        Magnetics2D.Params(**example.params)


# --------------------------------------------------------------------------------- the result


def test_the_result_validates_against_the_protocol(tmp_path):
    result, _ = run(tmp_path)
    ResultEnvelope(job_id="j-test", kind=result.kind, data=result.data, stats=result.stats)


def test_the_mesh_output_validates_too(tmp_path):
    result, _ = run(tmp_path, output="mesh2d", resolution=48)
    ResultEnvelope(job_id="j-test", kind=result.kind, data=result.data, stats=result.stats)
    assert result.kind == "mesh2d"
    assert len(result.data["triangles"]) > 0


def test_the_fields_keep_upstreams_names(tmp_path):
    """So one page can show this solver and the preview without a translation table."""
    result, _ = run(tmp_path)
    assert set(result.data["fields"]) == {"A", "B", "mu_r"}


def test_the_field_is_published_as_a_vector_too(tmp_path):
    """Which is what lets the workspace draw glyphs and streamlines instead of disabling them."""
    result, _ = run(tmp_path)
    assert set(result.data["vector_fields"]) == {"flux_density"}

    vectors = np.array(result.data["vector_fields"]["flux_density"])
    magnitude = np.array(result.data["fields"]["B"])
    assert np.allclose(np.hypot(vectors[:, 0], vectors[:, 1]), magnitude)


def test_the_material_map_shows_only_materials_that_exist(tmp_path):
    """The raster is nearest-cell, so no cell reads as a permeability nothing is made of."""
    result, _ = run(tmp_path)
    assert set(np.unique(result.data["fields"]["mu_r"])) == {1.0, 1000.0}


def test_stats_carry_cost_and_nothing_else(tmp_path):
    """`stats` is what the solve cost; the engineering answer lives apart from it (ADR-013)."""
    result, report = run(tmp_path)
    assert set(result.stats) == {"cells", "dofs", "iterations"}
    assert not set(result.stats) & set(report["metrics"])


def test_the_cost_estimate_counts_the_refinement_study(tmp_path):
    """Turning the study on costs four more cells for every one, and the budget should see it."""
    solver = Magnetics2D()
    geometry = cross_section()
    plain = solver.Params(resolution=80, convergence_check=False)
    studied = solver.Params(resolution=80, convergence_check=True)

    assert solver.estimate_cells(geometry, plain) == pytest.approx(
        solver.estimate_cells(geometry, studied) / 5
    )
    result, _ = run(tmp_path, resolution=80)
    assert solver.estimate_cells(geometry, plain) == result.stats["dofs"]


def test_progress_is_reported_and_can_be_cancelled(tmp_path):
    """Cancellation is cooperative, so the iteration loop has to check for it."""
    import threading

    from fenixspoon.solvers.base import JobCancelled

    events = []
    cancel = threading.Event()

    def watch(event):
        events.append(event)
        if event.residual is not None:
            cancel.set()

    solver = Magnetics2D()
    ctx = SolverContext(watch, cancel_event=cancel, artifact_dir=tmp_path)
    with pytest.raises(JobCancelled):
        solver.solve(cross_section(), solver.Params(resolution=200, tolerance=1e-14), ctx)
    assert any(event.message for event in events)


# ------------------------------------------------------------------------------- the exercise


def test_the_report_carries_the_answer_and_how_far_to_trust_it(tmp_path):
    _, report = run(tmp_path, resolution=120, convergence_check=True)
    metrics, checks = report["metrics"], report["verification"]

    assert metrics["ampere_turns"] == pytest.approx(3000.0)
    assert metrics["b_section_max"] == pytest.approx(0.128, abs=0.01)
    assert 0.0 < metrics["leakage_ratio"] < 0.1
    assert checks["energy_balance_rel"] < checks["energy_balance_tolerance"]
    assert checks["flux_consistency_rel"] < checks["flux_consistency_tolerance"]
    assert checks["ampere_law_rel"] < checks["ampere_law_tolerance"]
    assert checks["flux_convergence_rel"] < checks["flux_convergence_tolerance"]


def test_the_refinement_residual_appears_only_when_it_was_asked_for(tmp_path):
    """A check that was not run is absent, not zero — zero would read as a perfect result."""
    _, without = run(tmp_path, convergence_check=False)
    assert without["verification"]["flux_convergence_rel"] is None

    _, with_study = run(tmp_path, convergence_check=True)
    assert with_study["verification"]["flux_convergence_rel"] is not None


def test_the_report_withholds_what_this_cross_section_cannot_produce(tmp_path):
    """Named as absent rather than silently missing, the way the airfoil withholds drag."""
    _, report = run(tmp_path)
    assert set(report["model"]["withheld"]) == {"b_peak_iron", "gap_force", "losses", "b_h_curve"}
    for absent in ("b_peak_iron", "gap_force", "force", "losses"):
        assert absent not in report["metrics"]


def test_the_report_records_which_region_it_treated_as_the_core(tmp_path):
    _, report = run(tmp_path)
    assert report["model"]["core_region"] == "core"
    assert report["geometry"]["core_width"] == pytest.approx(20 * MM)
    assert report["geometry"]["interface_fitted"] is True


def test_the_mid_plane_curve_spans_the_window_and_turns_over(tmp_path):
    """The one curve the exercise argues from: where A turns over, the flux stops going up."""
    _, report = run(tmp_path)
    potential = np.array(report["curves"]["a_z"])
    flux = np.array(report["curves"]["b_y"])

    assert potential[:, 0].min() < -50 * MM and potential[:, 0].max() > 50 * MM
    assert potential[:, 1].min() < 0.0 < potential[:, 1].max()
    # B_y changes sign at the edges of the bundle, which is what makes that surface stationary.
    assert flux[:, 1].min() < 0.0 < flux[:, 1].max()
    left, right = report["validity"]["bundle_x"]
    assert left < 0.0 < right


def test_the_ampere_contour_is_recorded_so_the_page_can_draw_it(tmp_path):
    """A check whose surface is not stated is not a check the reader can audit."""
    _, report = run(tmp_path)
    xmin, ymin, xmax, ymax = report["validity"]["ampere_contour"]
    assert xmin < xmax and ymin < ymax
    # It encloses the right-hand winding and nothing else that carries current.
    assert xmin > 0.0


# -------------------------------------------------------------------------------- the warnings


def test_a_run_inside_the_stated_limits_still_names_the_one_it_crossed(tmp_path):
    """The default 60 mm window is too tight to quote numbers from, and the run says so."""
    _, report = run(tmp_path)
    warnings = report["validity"]["warnings"]
    assert any("window" in w for w in warnings)
    assert any("A_z = 0" in w for w in warnings)


def test_a_roomy_window_clears_the_truncation_warning(tmp_path):
    _, report = run(tmp_path, geometry=cross_section(window=240 * MM), resolution=240)
    assert not any("window" in w for w in report["validity"]["warnings"])


def test_saturation_is_named_with_its_threshold_and_its_consequence(tmp_path):
    """A warning that does not say what was crossed is not a warning (contract §4)."""
    _, report = run(tmp_path, geometry=cross_section(current=1.0e8))
    saturation = [w for w in report["validity"]["warnings"] if "T," in w]

    assert saturation, report["validity"]["warnings"]
    assert "1.50 T" in saturation[0]
    assert "overestimate" in saturation[0]


def test_the_material_can_declare_its_own_saturation(tmp_path):
    """A ferrite saturates near 0.4 T, and the protocol's material dict can carry it."""
    ferrite = cross_section(core_material={"mu_r": 2000.0, "b_sat": 0.4}, current=2.0e7)
    _, report = run(tmp_path, geometry=ferrite)

    assert report["model"]["saturation_flux_density"] == 0.4
    assert any("0.40 T" in w for w in report["validity"]["warnings"])


def test_a_coil_with_no_core_says_which_metrics_it_is_not_reporting(tmp_path):
    _, report = run(tmp_path, geometry=cross_section(mu_r=1.0))

    assert report["metrics"]["flux_core"] is None
    assert report["metrics"]["b_section_max"] is None
    assert report["metrics"]["ampere_turns"] > 0.0
    assert any("no core" in w for w in report["validity"]["warnings"])


def test_a_wire_rather_than_a_coil_is_called_out(tmp_path):
    """Both windings in the same sense is a net current, whose far field the box cannot hold."""
    same_sense = cross_section()
    same_sense.regions[1].material["current_density"] = 5.0e6
    _, report = run(tmp_path, geometry=same_sense)

    assert report["metrics"]["net_current"] != pytest.approx(0.0)
    assert any("wire rather than a coil" in w for w in report["validity"]["warnings"])


def test_a_region_that_is_not_a_rectangle_is_reported_as_staircased(tmp_path):
    """It is still solved; what changes is that the page is told the boundary is approximate."""
    wedge = cross_section()
    wedge.regions[0].shape.points = [(-10 * MM, -30 * MM), (10 * MM, -30 * MM), (0.0, 30 * MM)]
    _, report = run(tmp_path, geometry=wedge)

    assert report["geometry"]["interface_fitted"] is False
    assert any("staircased" in w for w in report["validity"]["warnings"])


def test_an_unfinished_solve_is_a_warning_and_not_a_silent_result(tmp_path):
    """The failure mode of a fixed-iteration solver: it stops, and it looks like it converged."""
    _, report = run(tmp_path, resolution=160, tolerance=1e-14, max_iterations=50)
    checks = report["verification"]

    assert checks["linear_residual"] > checks["linear_residual_tolerance"]
    assert any("unfinished solve" in w for w in report["validity"]["warnings"])
