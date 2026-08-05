"""``lab.heatsink2d`` as the protocol sees it — ``docs/exercises/heat-sink.md`` §7 and §9.

The physics is verified in ``test_heatsink_method.py`` against closed forms, with no envelope
in sight. What is checked here is the *adapter*: that the capability declares what the page
reads, that a job produces a well-formed ``grid2d`` with the air masked out, that the two
model switches announce themselves rather than changing the answer quietly, and that §10's
sweep comes back as a curve.
"""

import numpy as np
import pytest
from fenixspoon.geometry import Regions2D
from fenixspoon.solvers.registry import registered_solvers

from physics_lab.solvers.heatsink2d import FINISHES, HeatSink2D

#: A 60 mm envelope, 30 mm tall — what the nominal profile has to fit inside. The kind wants
#: at least one region, and the honest one to give it is the space the sink may occupy: the
#: same "site" role the bridge's geometry plays under ADR-019, with the profile itself in
#: params. Inset by a hair because `polygon2d` vertices must lie strictly inside the bounds.
ENVELOPE = Regions2D(
    type="regions2d",
    bounds=[0.0, 0.0, 0.060, 0.030],
    background={},
    regions=[
        {
            "name": "envelope",
            "shape": {
                "type": "polygon2d",
                "points": [
                    [1e-6, 1e-6],
                    [0.060 - 1e-6, 1e-6],
                    [0.060 - 1e-6, 0.030 - 1e-6],
                    [1e-6, 0.030 - 1e-6],
                ],
            },
            "material": {},
        }
    ],
)

#: Coarse, so the suite stays quick. The convergence test in the method suite is what shows
#: the answer has stopped moving.
COARSE = {"cell_size": 0.0012}


class _Context:
    """The bits of ``SolverContext`` this adapter touches, and a record of what it said."""

    def __init__(self):
        self.events = []

    def progress(self, event):
        self.events.append(event)


def run(**params):
    solver = HeatSink2D()
    ctx = _Context()
    validated = HeatSink2D.Params(**{**COARSE, **params})
    return solver.solve(ENVELOPE, validated, ctx), ctx


class TestTheCapabilityDeclaresWhatThePageReads:
    def test_it_is_registered_under_its_own_name(self):
        names = {getattr(s, "name", None) for s in registered_solvers()}
        assert "lab.heatsink2d" in names

    def test_it_does_not_claim_upstream_heat_physics(self):
        """`physics` is its own tag, deliberately.

        `mock.heat2d` and `dolfinx.heat2d` declare `heat`, and a page filtering on that tag
        would offer a solver with no radiative boundary. On the nominal still-air case that is
        not a different picture but a different answer, high by about a tenth — the same trap
        the magnetics page fell into when `mock.heat2d` matched its geometry filter.
        """
        assert HeatSink2D.physics == "heatsink"

    @pytest.mark.parametrize(
        "metric",
        [
            "t_max",
            "t_rise",
            "thermal_resistance",
            "mass",
            "score",
            "fin_efficiency",
            "radiative_fraction",
            "view_factor_to_room",
            "h_convective",
        ],
    )
    def test_every_headline_metric_is_declared(self, metric):
        assert metric in {m.name for m in HeatSink2D.metrics}

    def test_the_two_reducible_metrics_name_their_field(self):
        """`t_max` and `flux_max` are reductions of fields, so upstream computes them from the
        declaration and the adapter must *not* also send them — that is what keeps the
        computation from being written twice and disagreeing."""
        declared = {m.name: m for m in HeatSink2D.metrics}
        assert declared["t_max"].field == "T"
        assert declared["t_max"].reduction == "max"
        assert declared["flux_max"].field == "flux"

        result, _ = run()
        assert "t_max" not in result.metrics
        assert "flux_max" not in result.metrics

    def test_radiation_is_declared_as_an_assumption_with_its_exclusions(self):
        grey = {a.name: a for a in HeatSink2D.assumptions}["grey_diffuse_radiation"]
        assert "participating_medium" in grey.excludes
        assert "transparent" in grey.statement


class TestTheResultEnvelope:
    def test_a_nominal_run_is_a_well_formed_grid(self):
        result, _ = run()
        assert result.kind == "grid2d"
        ny, nx = result.data["shape"]
        assert len(result.data["fields"]["T"]) == ny * nx
        assert len(result.data["mask"]) == ny * nx
        assert result.converged is True

    def test_the_mask_marks_the_air_and_the_metal_is_hot(self):
        """Upstream's own convention for its heat adapters: the region set is the solid, and
        the mask says which cells were never solved rather than leaving a viewer to infer it
        from a sentinel temperature."""
        result, _ = run()
        ny, nx = result.data["shape"]
        mask = np.array(result.data["mask"]).reshape(ny, nx).astype(bool)
        temperature = np.array(result.data["fields"]["T"]).reshape(ny, nx)

        assert mask.any() and not mask.all()  # some air, some metal
        assert temperature[~mask].min() > 25.0  # every solved cell is above ambient
        assert np.all(temperature[mask] == 0.0)  # and the air carries no answer

    def test_the_energy_balance_travels_as_the_residual(self):
        result, _ = run()
        assert result.residual is not None
        assert result.residual < 1e-3

    def test_stats_carry_cost_and_metrics_carry_the_answer(self):
        """The separation upstream's MetricSpec draws, checked rather than assumed: nothing
        that costs belongs in metrics, and nothing that answers belongs in stats."""
        result, _ = run()
        assert set(result.stats) == {"cells", "dofs", "picard_passes", "cg_iterations"}
        assert "thermal_resistance" in result.metrics
        assert "thermal_resistance" not in result.stats

    def test_it_reports_progress_rather_than_going_quiet(self):
        _, ctx = run()
        assert len(ctx.events) >= 2


class TestTheModelSwitchesAnnounceThemselves:
    """Both switches are legitimate things to want — they are how §10's control cases are run.
    What would not be legitimate is getting the simpler model without being told."""

    def test_radiation_off_warns_that_the_model_changed(self):
        result, _ = run(radiation=False)
        assert any("radiation is switched off" in w for w in result.warnings)
        assert result.metrics["radiative_fraction"] == 0.0

    def test_pinning_the_coefficient_warns_about_the_lesson_it_breaks(self):
        result, _ = run(h_override=10.0)
        assert any("more fins are always better" in w for w in result.warnings)
        assert result.metrics["h_convective"] == pytest.approx(10.0)

    def test_a_clean_run_says_nothing(self):
        result, _ = run()
        assert result.warnings == []

    def test_an_out_of_range_correlation_is_reported_not_hidden(self):
        """Driven far outside the laminar band the coefficient is still returned — with a
        warning naming the correlation and the parameter that left its range."""
        result, _ = run(fin_count=2, power=400.0, fin_height=0.15)
        assert any("out of range" in w for w in result.warnings)


class TestTheSweepIsTheHeadline:
    def test_the_sweep_comes_back_as_a_curve(self):
        result, _ = run(sweep_fin_counts=[4, 8, 12, 18])
        assert len(result.series) == 1
        curve = result.series[0]
        assert curve.x.values == [4.0, 8.0, 12.0, 18.0]
        assert {t.name for t in curve.traces} == {
            "thermal_resistance",
            "radiative_fraction",
        }

    def test_the_curve_turns(self):
        """§10, through the protocol. If this ever goes monotonic the page has stopped
        teaching what it claims to teach, however correct the temperatures are."""
        result, _ = run(sweep_fin_counts=[2, 6, 10, 14, 20])
        resistance = next(
            t.values for t in result.series[0].traces if t.name == "thermal_resistance"
        )
        best = int(np.argmin(resistance))
        assert 0 < best < len(resistance) - 1

    def test_a_profile_that_does_not_fit_is_dropped_rather_than_clamped(self):
        """A point silently moved is a point that lies about which design produced it.

        Sixty fins of 1.5 mm do not fit across a 60 mm base, so that entry leaves the curve
        entirely rather than being nudged to the largest count that does fit.
        """
        result, _ = run(sweep_fin_counts=[4, 60])
        assert result.series[0].x.values == [4.0]

    def test_an_empty_sweep_returns_no_curve(self):
        result, _ = run()
        assert result.series == []


class TestParametersAreRefused:
    def test_an_unknown_finish_is_refused_by_name(self):
        with pytest.raises(ValueError, match="finish must be one of"):
            HeatSink2D.Params(finish="powder_coated")

    def test_forced_cooling_without_a_velocity_is_refused(self):
        """Rather than silently solving still air and calling it forced."""
        with pytest.raises(ValueError, match="face_velocity"):
            HeatSink2D.Params(cooling="forced", face_velocity=0.0)

    def test_fins_that_cannot_fit_are_refused_by_the_profile(self):
        with pytest.raises(ValueError, match="overlap"):
            run(fin_count=50, fin_thickness=0.003)

    def test_every_finish_resolves_to_an_emissivity(self):
        for finish in FINISHES:
            result, _ = run(finish=finish)
            assert result.metrics["thermal_resistance"] > 0.0
