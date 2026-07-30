"""The airfoil adapter's seam with Fenix Spoon: schema, envelope, artifact, warnings.

Where ``test_panel_method.py`` asks whether the physics is right, this asks whether the
capability is honest about it — that the declared metrics are the ones actually reported, that
the report artifact carries its verification, and that a run outside the model's stated domain
says so.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from fenixspoon.geometry import Domain2D, Polygon2D
from fenixspoon.protocol import ResultEnvelope
from fenixspoon.solvers import available_solvers
from fenixspoon.solvers.base import SolverContext

from physics_lab.solvers.airfoil_geometry import naca4_outline
from physics_lab.solvers.airfoil_panel2d import REPORT_ARTIFACT, AirfoilPanel2D

SOLVER = "lab.airfoil_panel2d"


def domain(m: float = 0.02, p: float = 0.4, t: float = 0.12, per_surface: int = 60) -> Domain2D:
    """The geometry the page submits: a profile as ``domain2d``, on a unit chord."""
    outline = naca4_outline(m, p, t, per_surface=per_surface)[:-1]
    return Domain2D(
        bounds=(-1.5, -1.25, 2.5, 1.25),
        obstacle=Polygon2D(points=[(float(x), float(y)) for x, y in outline]),
    )


def run(tmp_path: Path, **params):
    """Solve, and hand back both the envelope and the parsed report."""
    solver = AirfoilPanel2D()
    ctx = SolverContext(lambda event: None, artifact_dir=tmp_path)
    result = solver.solve(domain(), solver.Params(**params), ctx)
    report = json.loads((tmp_path / REPORT_ARTIFACT.name).read_text(encoding="utf-8"))
    return result, report


# ------------------------------------------------------------------------------ the catalogue


def test_the_adapter_registers_itself():
    """Importing ``physics_lab.solvers`` must be enough — that is the whole wiring contract."""
    catalogue = {info.name: info for info in available_solvers()}
    assert SOLVER in catalogue
    assert catalogue[SOLVER].geometry_types == ["domain2d"]


def test_the_parameter_schema_publishes_bounds_and_descriptions():
    """The page generates its form from this and invents nothing, so it has to be complete."""
    schema = AirfoilPanel2D.info().params_schema["properties"]
    for name in ("alpha_deg", "u_inf", "panels", "resolution", "kutta", "sweep_from_deg"):
        assert name in schema, name

    assert schema["alpha_deg"]["minimum"] == -20.0
    assert schema["panels"]["maximum"] == 400
    assert all(
        "description" in spec or "anyOf" in spec or "allOf" in spec for spec in schema.values()
    )


def test_every_declared_metric_is_actually_reported(tmp_path):
    """A declaration nothing fulfils is worse than no declaration (upstream #43)."""
    _, report = run(tmp_path)
    for spec in AirfoilPanel2D.metrics:
        assert spec.name in report["metrics"], spec.name


def test_the_declared_artifact_is_the_one_written(tmp_path):
    solver = AirfoilPanel2D()
    ctx = SolverContext(lambda event: None, artifact_dir=tmp_path)
    solver.solve(domain(), solver.Params(), ctx)

    assert [entry["name"] for entry in ctx.artifacts] == [REPORT_ARTIFACT.name]
    assert ctx.artifacts[0]["content_type"] == "application/json"
    assert REPORT_ARTIFACT.when is None, "the report is not optional"


# --------------------------------------------------------------------------------- the result


def test_the_result_validates_against_the_protocol(tmp_path):
    result, _ = run(tmp_path)
    ResultEnvelope(job_id="j-test", kind=result.kind, data=result.data, stats=result.stats)


def test_the_mesh_output_validates_too(tmp_path):
    result, _ = run(tmp_path, output="mesh2d", resolution=64)
    ResultEnvelope(job_id="j-test", kind=result.kind, data=result.data, stats=result.stats)
    assert result.kind == "mesh2d"
    assert len(result.data["triangles"]) > 0


def test_stats_carry_cost_and_nothing_else(tmp_path):
    """`stats` is what the solve cost; the engineering answer lives apart from it (ADR-013)."""
    result, report = run(tmp_path)
    assert set(result.stats) == {"cells", "panels", "dofs"}
    assert not set(result.stats) & set(report["metrics"])


def test_the_fields_are_the_ones_the_page_offers(tmp_path):
    result, _ = run(tmp_path)
    assert set(result.data["fields"]) == {"speed", "Cp"}
    assert set(result.data["vector_fields"]) == {"velocity"}
    # No streamfunction: a source sheet's is multivalued, and a seam per panel is worse than
    # its absence (docs/exercises/airfoil.md §10.1).
    assert "psi" not in result.data["fields"]


def test_the_masked_interior_carries_no_flow(tmp_path):
    result, _ = run(tmp_path)
    mask = np.array(result.data["mask"], dtype=bool)
    speed = np.array(result.data["fields"]["speed"])
    assert mask.any(), "the profile has to appear in the mask at all"
    assert np.all(speed[mask] == 0.0)


def test_the_cost_estimate_matches_the_grid_it_returns(tmp_path):
    solver = AirfoilPanel2D()
    params = solver.Params(resolution=96)
    result, _ = run(tmp_path, resolution=96)
    assert solver.estimate_cells(domain(), params) == result.stats["cells"]


# ------------------------------------------------------------------------------- the exercise


def test_the_report_answers_the_challenge(tmp_path):
    """The numbers the exercise's target is stated in, at the condition it is stated at."""
    _, report = run(tmp_path, alpha_deg=4.6, u_inf=40.0, rho=1.225)
    metrics = report["metrics"]

    assert metrics["l_prime"] == pytest.approx(800.0, rel=0.05)
    assert abs(metrics["c_m_c4"]) < 0.08
    assert report["validity"]["warnings"] == []
    assert report["verification"]["cl_consistency_rel"] < 0.02


def test_the_report_withholds_what_the_model_cannot_produce(tmp_path):
    """Drag, efficiency and stall are absent *and* named as absent (§2)."""
    _, report = run(tmp_path)
    assert set(report["model"]["withheld"]) == {"c_d", "l_over_d", "c_l_max", "alpha_stall"}
    for absent in ("c_d", "l_over_d", "efficiency"):
        assert absent not in report["metrics"]


def test_a_sweep_is_needed_before_the_aerodynamic_centre_appears(tmp_path):
    """x_ac is a property of several solves, so one solve must not offer it (§7.3)."""
    _, single = run(tmp_path)
    assert single["sweep"] is None

    _, swept = run(tmp_path, sweep_from_deg=-4.0, sweep_to_deg=8.0, sweep_step_deg=2.0)
    assert swept["sweep"]["x_ac_over_c"] == pytest.approx(0.25, abs=0.02)
    assert swept["sweep"]["x_ac_fit_r2"] > 0.99
    assert min(swept["sweep"]["alpha_deg"]) < 0 < max(swept["sweep"]["alpha_deg"])


def test_the_requested_incidence_is_always_in_the_sweep(tmp_path):
    """Otherwise the field picture and the sweep curve would describe different solves."""
    _, report = run(tmp_path, alpha_deg=3.7, sweep_from_deg=-4.0, sweep_to_deg=8.0)
    offset = report["geometry"]["chord_angle_deg"]
    assert any(abs(a - (3.7 - offset)) < 1e-6 for a in report["sweep"]["alpha_deg"])


def test_the_surface_curve_covers_both_surfaces_and_the_whole_chord(tmp_path):
    _, report = run(tmp_path)
    for name in ("cp_upper", "cp_lower"):
        curve = np.array(report["curves"][name])
        assert curve[:, 0].min() < 0.05 and curve[:, 0].max() > 0.95
    upper = np.array(report["curves"]["cp_upper"])
    lower = np.array(report["curves"]["cp_lower"])
    # Lift means suction over the top: the upper surface must be the lower-pressure one.
    assert upper[:, 1].min() < lower[:, 1].min()


def test_the_report_records_the_incidence_it_derived_and_the_one_it_was_asked_for(tmp_path):
    """Both, because they differ for a shape whose chord line is not the submitted x axis."""
    _, report = run(tmp_path, alpha_deg=4.0)
    assert report["conditions"]["alpha_requested_deg"] == 4.0
    assert "chord_angle_deg" in report["geometry"]
    assert report["metrics"]["alpha_deg"] == pytest.approx(
        4.0 - report["geometry"]["chord_angle_deg"], abs=1e-6
    )


# -------------------------------------------------------------------------------- the warnings


def test_a_compressible_run_is_warned_about(tmp_path):
    _, report = run(tmp_path, u_inf=150.0, sound_speed=340.29)
    warnings = " ".join(report["validity"]["warnings"])
    assert "Mach" in warnings and "incompressible" in warnings


def test_an_incidence_far_past_the_linear_range_is_warned_about(tmp_path):
    _, report = run(tmp_path, alpha_deg=15.0)
    warnings = " ".join(report["validity"]["warnings"])
    assert "separated" in warnings and "no stall" in warnings


def test_the_no_circulation_model_says_what_it_is(tmp_path):
    _, report = run(tmp_path, kutta="none", alpha_deg=5.0)
    warnings = " ".join(report["validity"]["warnings"])

    assert report["metrics"]["c_l"] == 0.0
    assert "zero by construction" in warnings
    assert "unbounded" in warnings, "and why the Kutta condition exists"


def test_a_valid_run_says_so_by_saying_nothing(tmp_path):
    _, report = run(tmp_path, alpha_deg=4.0, u_inf=40.0)
    assert report["validity"]["warnings"] == []


def test_a_low_reynolds_run_is_reported_not_hidden(tmp_path):
    _, report = run(tmp_path, u_inf=1.0)
    warnings = " ".join(report["validity"]["warnings"])
    assert "Reynolds" in warnings


# ------------------------------------------------------------------------------ reproducibility


def test_the_report_carries_everything_a_run_needs_to_be_repeated(tmp_path):
    """A row that cannot be recomputed is not a result (ADR-013 §5)."""
    _, report = run(tmp_path, alpha_deg=4.0, panels=160)

    assert report["schema"] == 1
    assert report["solver"]["name"] == SOLVER and report["solver"]["version"]
    assert report["model"] == {
        "level": 1,
        "kutta": "enforced",
        "trailing_edge": "closed",
        "withheld": ["c_d", "l_over_d", "c_l_max", "alpha_stall"],
    }
    for key in ("u_inf", "rho", "mu", "sound_speed", "alpha_requested_deg"):
        assert key in report["conditions"], key
    for key in ("chord_m", "panels", "vertices", "te_gap_over_c", "camber_line"):
        assert key in report["geometry"], key
    assert report["geometry"]["panels"] == 160
    assert set(report["dimensionless"]) == {"reynolds", "mach"}


def test_the_same_inputs_give_the_same_numbers(tmp_path):
    """No randomness, no thread-count dependence: two runs must agree exactly."""
    _, first = run(tmp_path, alpha_deg=4.0)
    _, second = run(tmp_path, alpha_deg=4.0)
    assert first["metrics"] == second["metrics"]
    assert first["verification"] == second["verification"]


def test_the_report_is_small_enough_to_keep(tmp_path):
    """It is saved per run in a browser store, so its size is a design constraint."""
    _, report = run(tmp_path, sweep_from_deg=-4.0, sweep_to_deg=8.0, sweep_step_deg=1.0)
    assert len(json.dumps(report)) < 64 * 1024
