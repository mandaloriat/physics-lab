"""Verification of the heat-sink exercise's physics — ``docs/exercises/heat-sink.md`` §8.

Arrays in, arrays out: no job, no server, no envelope. Every check here is either a closed form,
an exact algebraic identity, or a limit in which the answer is known independently of this
implementation.

Two of them are load-bearing for the exercise rather than for the code, and are marked where
they appear: the sweep that shows an optimum fin count *exists*, and the constant-coefficient
control that shows it disappears when the model is simplified. If those two ever fail, the page
has stopped teaching what it claims to teach even if every temperature is still right.
"""

import numpy as np
import pytest

from physics_lab.solvers.correlations import isolated_plate, natural_convection
from physics_lab.solvers.heatsink import (
    KELVIN,
    SIGMA,
    Conditions,
    Numerics,
    Profile,
    solve,
)

#: Coarse enough to keep the suite quick, fine enough that the convergence test below shows the
#: answer has stopped moving by here.
COARSE = Numerics(cell_size=0.0010)


@pytest.fixture(scope="module")
def nominal():
    return solve(Profile(), Conditions(), COARSE)


class TestEnergyIsConserved:
    """The first thing to check and the last thing to trust: does what goes in come out?"""

    def test_energy_balance_closes(self, nominal):
        # §8 asks for better than 1%. It closes far tighter than that, and the margin is worth
        # keeping: this residual is also what would catch a view-factor leak, since radiation
        # that vanishes into a badly formed enclosure leaves through this number.
        assert nominal.residuals["energy_balance"] < 1e-3

    @pytest.mark.parametrize("fin_count", [1, 2, 10, 18])
    def test_energy_balance_closes_at_every_fin_count(self, fin_count):
        solution = solve(Profile(fin_count=fin_count), Conditions(), COARSE)
        assert solution.residuals["energy_balance"] < 1e-3

    def test_the_view_factor_identities_hold_in_every_channel(self, nominal):
        summation = [v for k, v in nominal.residuals.items() if "summation" in k]
        reciprocity = [v for k, v in nominal.residuals.items() if "reciprocity" in k]
        assert summation and reciprocity  # the enclosures were actually built
        assert max(summation) < 1e-10
        assert max(reciprocity) < 1e-15


class TestAgainstFinTheory:
    """One-dimensional fin theory, which is exact for a straight fin with a uniform coefficient."""

    def test_fin_efficiency_matches_the_closed_form(self, nominal):
        """eta = tanh(m L_c) / (m L_c), m = sqrt(2h / k t), L_c = H + t/2.

        The comparison has to be made against the *total* coefficient, convection plus the
        equivalent radiative one, because fin theory does not care which mechanism removes the
        heat — only how much leaves per unit area per kelvin. Reconstructing that total from the
        reported radiative fraction is the honest way to do it, and it is why the fraction is a
        published metric rather than an internal.
        """
        profile, conditions = Profile(), Conditions()
        metrics = nominal.metrics

        h_convective = metrics["h_convective_w_m2k"]
        radiative_share = metrics["radiative_fraction"]
        h_total = h_convective / (1.0 - radiative_share)

        m = np.sqrt(2.0 * h_total / (conditions.conductivity * profile.fin_thickness))
        corrected_length = profile.fin_height + 0.5 * profile.fin_thickness
        expected = np.tanh(m * corrected_length) / (m * corrected_length)

        # These fins are short and stubby, which is where 1-D theory is at its best.
        assert metrics["fin_efficiency"] == pytest.approx(expected, rel=0.02)

    def test_tall_thin_fins_are_less_efficient(self):
        """The direction fin theory predicts, checked where the check earns its keep.

        Efficiency near unity is easy to reproduce by accident — a solver that ignored the
        temperature drop along a fin entirely would also report about 0.98 on the nominal
        geometry. Driving the fins tall and thin separates the two: the analytic efficiency
        falls a long way, and the solve has to follow it down.
        """
        stubby = solve(
            Profile(fin_count=6, fin_height=0.010, fin_thickness=0.003), Conditions(), COARSE
        )
        lanky = solve(
            Profile(fin_count=6, fin_height=0.060, fin_thickness=0.0006), Conditions(), COARSE
        )
        assert lanky.metrics["fin_efficiency"] < stubby.metrics["fin_efficiency"]
        assert lanky.metrics["fin_efficiency"] < 0.95


class TestRadiationLimits:
    """Radiation, against answers that do not depend on the radiosity implementation."""

    def test_an_unobstructed_surface_matches_stefan_boltzmann(self):
        """A single fin has no channel, so every radiating face sees only the room.

        Then the net flux is eps sigma (T^4 - T_inf^4) by definition, the view factor to the
        room is exactly one, and the radiative fraction is whatever that is worth against the
        convection — no enclosure, no radiosity system, nothing to get wrong. Any disagreement
        here is in the plumbing rather than in the physics.
        """
        conditions = Conditions(emissivity=0.8)
        solution = solve(Profile(fin_count=1), conditions, COARSE)

        assert solution.metrics["view_factor_to_room"] == pytest.approx(1.0)

        peak_k = solution.metrics["t_max_c"] + KELVIN
        # The sink is nearly isothermal — aluminium, and a modest heat flux — so the peak stands
        # in for the whole surface to within the tolerance below.
        expected_h_rad = (
            conditions.emissivity
            * SIGMA
            * (peak_k**4 - conditions.ambient_k**4)
            / (peak_k - conditions.ambient_k)
        )
        implied_h_rad = solution.metrics["h_convective_w_m2k"] * (
            solution.metrics["radiative_fraction"]
            / (1.0 - solution.metrics["radiative_fraction"])
        )
        assert implied_h_rad == pytest.approx(expected_h_rad, rel=0.15)

    def test_switching_radiation_off_reproduces_the_simpler_model(self, nominal):
        """The Advanced switch is a model change, and it must move the answer one way only.

        Removing a heat path can only make the sink hotter. That it does so by double digits at
        the nominal case is the quantitative form of the argument for §2.2 existing at all.
        """
        without = solve(Profile(), Conditions(radiation=False), COARSE)
        assert without.metrics["t_rise_k"] > nominal.metrics["t_rise_k"]
        assert without.metrics["radiative_fraction"] == 0.0
        over_prediction = (
            without.metrics["t_rise_k"] / nominal.metrics["t_rise_k"] - 1.0
        )
        assert over_prediction > 0.05

    def test_a_black_surface_beats_a_bare_one(self):
        polished = solve(Profile(), Conditions(emissivity=0.05), COARSE)
        anodised = solve(Profile(), Conditions(emissivity=0.8), COARSE)
        assert anodised.metrics["t_rise_k"] < polished.metrics["t_rise_k"]

    def test_the_finish_pays_most_where_the_fins_are_sparse(self):
        """The interaction between §2.2's two mechanisms, and the reason §10 is careful about it.

        Anodising a *flat* surface is worth a great deal, because every square millimetre of it
        sees the room. Anodising a tightly finned sink is worth much less — not because the
        emissivity stopped mattering, but because the fins have hidden each other and there is
        no longer much room to radiate *at*. Reporting the second number as though it were the
        first would oversell the finish, which is exactly what an earlier draft of the
        specification did.
        """

        def gain(fin_count: int) -> float:
            bare = solve(Profile(fin_count=fin_count), Conditions(emissivity=0.05), COARSE)
            black = solve(Profile(fin_count=fin_count), Conditions(emissivity=0.8), COARSE)
            return bare.metrics["t_rise_k"] / black.metrics["t_rise_k"] - 1.0

        assert gain(1) > gain(10)
        assert gain(1) > 0.3  # a bare plate: worth a third of its temperature rise
        assert gain(10) < 0.2  # tightly finned: real, but nothing like as much


class TestTheOptimumExists:
    """The exercise's whole claim, in two tests. ``docs/exercises/heat-sink.md`` §10."""

    def test_thermal_resistance_has_a_minimum_in_fin_count(self):
        """Sweep the fin count and the curve must *turn*.

        This is the assertion the page's headline result rests on. If it ever fails, the answer
        to "how many fins actually help, and when do they stop?" has gone back to "never", and
        no amount of correct temperature fields would make the page honest.
        """
        counts = [2, 4, 6, 8, 10, 12, 14, 18, 24]
        resistance = [
            solve(Profile(fin_count=n), Conditions(), COARSE).metrics[
                "thermal_resistance_k_w"
            ]
            for n in counts
        ]
        best = int(np.argmin(resistance))

        assert 0 < best < len(counts) - 1, "the optimum must be interior, not at an end"
        assert resistance[0] > resistance[best]
        assert resistance[-1] > resistance[best]
        # And it must be a real minimum, not numerical noise on a flat curve.
        assert resistance[-1] > 2.0 * resistance[best]

    def test_a_constant_coefficient_destroys_the_optimum(self):
        """The control case, and the reason §2.1 exists.

        Pin ``h`` and switch radiation off — the model upstream's demo runs — and thermal
        resistance falls monotonically with fin count for ever. More fins are always better,
        right down to fins of zero thickness. That is a false lesson, and this test is what
        stops it being shipped by accident.
        """
        counts = [4, 10, 18, 24]
        resistance = [
            solve(
                Profile(fin_count=n),
                Conditions(h_override=10.0, radiation=False),
                COARSE,
            ).metrics["thermal_resistance_k_w"]
            for n in counts
        ]
        assert resistance == sorted(resistance, reverse=True), (
            "with a constant coefficient the curve must not turn — if it does, this control "
            "case is no longer controlling anything"
        )

    def test_both_mechanisms_weaken_as_the_channel_narrows(self):
        """The two independent reasons the curve turns, each isolated.

        Convection falls because the air cannot get through; radiation falls because a fin
        flank sees the facing fin instead of the room. They are different mechanisms and the
        page lets a visitor take them apart, so the solve has to report both.
        """
        sparse = solve(Profile(fin_count=4), Conditions(), COARSE).metrics
        packed = solve(Profile(fin_count=18), Conditions(), COARSE).metrics

        assert packed["h_convective_w_m2k"] < sparse["h_convective_w_m2k"]
        assert packed["view_factor_to_room"] < sparse["view_factor_to_room"]


class TestConvergence:
    """The answer must stop moving when the mesh is refined."""

    def test_refining_the_mesh_does_not_move_the_answer(self):
        coarse = solve(Profile(), Conditions(), Numerics(cell_size=0.0016))
        fine = solve(Profile(), Conditions(), Numerics(cell_size=0.0004))
        assert fine.metrics["t_max_c"] == pytest.approx(
            coarse.metrics["t_max_c"], rel=2e-3
        )
        assert fine.metrics["fin_efficiency"] == pytest.approx(
            coarse.metrics["fin_efficiency"], rel=2e-3
        )

    def test_the_picard_loop_converges_rather_than_running_out(self, nominal):
        assert nominal.passes < Numerics().max_passes

    def test_it_still_converges_when_radiation_dominates(self):
        """The case that exposed the need for under-relaxation.

        A single fin with a black finish removes most of its heat by radiation, where the
        coefficient goes as T^3. Undamped, the iteration oscillated and reported a 1.5 K rise
        against a true answer in the hundreds. The guard is that the loop both terminates early
        *and* closes its energy balance — either alone would have passed while the solve was
        wrong.
        """
        solution = solve(Profile(fin_count=1), Conditions(emissivity=0.8), COARSE)
        assert solution.passes < Numerics().max_passes
        assert solution.residuals["energy_balance"] < 1e-3


class TestCorrelations:
    """The convection coefficient, at both ends of its range."""

    def test_the_channel_correlation_falls_towards_a_closed_gap(self):
        wide = natural_convection(0.020, 0.025, 50.0, 298.15).value
        narrow = natural_convection(0.001, 0.025, 50.0, 298.15).value
        assert narrow < 0.25 * wide

    def test_a_wide_channel_tends_to_the_isolated_plate(self):
        """The composite form's whole purpose: it must have a ceiling.

        Bare Elenbaas keeps raising ``h`` as the gap opens, without limit, which would flatter
        every widely spaced design on the page. The composite relation saturates at the
        isolated-plate value instead, and this pins that down.
        """
        plate = isolated_plate(0.025, 50.0, 298.15).value
        very_wide = natural_convection(0.5, 0.025, 50.0, 298.15).value
        assert very_wide == pytest.approx(plate, rel=0.1)

    def test_a_closed_gap_falls_back_to_the_plate_rather_than_to_zero(self):
        """A sink with one fin has no channel, and must not report that it cannot cool itself.

        This is the bug the bare-plate limiting case of §8 found: a channel correlation given a
        zero gap returned ``h = 0``, so the control case the exercise verifies against was the
        one configuration the solver could not do.
        """
        assert natural_convection(0.0, 0.025, 50.0, 298.15).value > 1.0

    def test_out_of_range_is_reported_rather_than_extrapolated(self):
        hot_and_wide = natural_convection(0.05, 0.025, 300.0, 298.15)
        assert not hot_and_wide.valid
        assert hot_and_wide.note


class TestGeometryIsRefused:
    """What the solver declines to answer, rather than answering wrongly."""

    def test_overlapping_fins_are_refused(self):
        with pytest.raises(ValueError, match="overlap"):
            Profile(base_width=0.010, fin_count=20, fin_thickness=0.001)

    def test_no_fins_at_all_is_refused(self):
        with pytest.raises(ValueError, match="at least"):
            Profile(fin_count=0)

    def test_channel_width_matches_the_published_formula(self):
        """s = (W - N t) / (N - 1), which is what §2.1 feeds to the correlation."""
        profile = Profile(base_width=0.060, fin_count=10, fin_thickness=0.0015)
        expected = (0.060 - 10 * 0.0015) / 9
        assert profile.channel_width == pytest.approx(expected)


class TestReportedFields:
    """The arrays the page draws."""

    def test_the_mask_marks_metal_and_only_metal(self, nominal):
        assert np.all(np.isnan(nominal.temperature_c[~nominal.mask]))
        assert not np.any(np.isnan(nominal.temperature_c[nominal.mask]))

    def test_the_hottest_metal_is_at_the_base(self, nominal):
        """Heat enters underneath and leaves from the fins, so the peak sits at the footprint.

        Worth pinning: an orientation slip in the boundary conditions would invert this while
        leaving every scalar metric looking plausible.
        """
        rows = np.where(nominal.mask.any(axis=1))[0]
        hottest_row = int(np.nanargmax(np.nanmax(nominal.temperature_c, axis=1)))
        assert hottest_row < rows.mean()

    def test_mass_matches_the_geometry(self, nominal):
        profile, conditions = Profile(), Conditions()
        expected = conditions.density * profile.solid_area * conditions.depth
        assert nominal.metrics["mass_kg"] == pytest.approx(expected)
