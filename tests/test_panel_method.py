"""Verification of the airfoil exercise's physics — ``docs/exercises/airfoil.md`` §8 and §12.

These tests are the exercise's claim to be believed. Two of them compare against *exact*
solutions, one against an asymptotic theory, and the rest are internal consistency and
convergence. None of them needs a server, a job, a browser or FEniCSx.

The tolerances are the ones the specification states. Where a number here differs from the
specification, the specification is wrong and should be corrected — not this file.
"""

import numpy as np
import pytest

from physics_lab.solvers.airfoil import Conditions, coefficients, sweep, verify
from physics_lab.solvers.airfoil_geometry import naca4_outline, read_profile, resample
from physics_lab.solvers.analytic import cylinder_cp, joukowski, thin_airfoil
from physics_lab.solvers.panel import panel_geometry, solve, solve_sweep

U_INF = 40.0
RHO = 1.225


def circle(panels: int, radius: float = 1.0) -> np.ndarray:
    """A polygonal circle, clockwise, closed."""
    theta = -np.linspace(0.0, 2.0 * np.pi, panels + 1)
    return np.column_stack([radius * np.cos(theta), radius * np.sin(theta)])


# --------------------------------------------------------------- §8.1 circular cylinder


def test_cylinder_without_circulation_matches_the_exact_pressure():
    """C_p = 1 - 4 sin^2(theta), to within 1 % in the infinity norm."""
    nodes = circle(200)
    solution = solve(nodes, U_INF, 0.0, circulation=0.0)
    theta = np.arctan2(solution.geometry.control[:, 1], solution.geometry.control[:, 0])

    exact = cylinder_cp(theta, U_INF, 1.0, 0.0)
    assert np.max(np.abs(solution.cp - exact)) < 0.01


def test_cylinder_without_circulation_carries_no_force():
    """d'Alembert's paradox, on the discrete solution: both components vanish."""
    solution = solve(circle(200), U_INF, 0.0, circulation=0.0)
    geo = solution.geometry
    force = -(solution.cp * geo.length)[:, None] * geo.normal
    assert np.allclose(force.sum(axis=0), 0.0, atol=1e-3)


@pytest.mark.parametrize("gamma", [8.0, -5.0])
def test_cylinder_with_circulation_obeys_kutta_joukowski(gamma):
    """Lift from the integrated pressure equals rho * U * Gamma to 0.5 %."""
    solution = solve(circle(300), U_INF, 0.0, circulation=gamma)
    geo = solution.geometry

    assert solution.circulation == pytest.approx(gamma, rel=1e-12)  # prescribed exactly

    force = -(0.5 * RHO * U_INF**2 * solution.cp * geo.length)[:, None] * geo.normal
    lift = force.sum(axis=0)[1]
    assert lift == pytest.approx(RHO * U_INF * gamma, rel=0.005)


def test_cylinder_with_circulation_matches_the_exact_pressure():
    solution = solve(circle(300), U_INF, 0.0, circulation=8.0)
    theta = np.arctan2(solution.geometry.control[:, 1], solution.geometry.control[:, 0])
    exact = cylinder_cp(theta, U_INF, 1.0, 8.0)
    assert np.max(np.abs(solution.cp - exact)) < 0.01


# ------------------------------------------------- §8.2 Kármán–Trefftz and Joukowski, exact


@pytest.mark.parametrize("alpha_deg", [0.0, 5.0, 10.0])
@pytest.mark.parametrize(
    ("eps", "delta"),
    [(0.08, 0.0), (0.08, 0.05), (0.12, 0.08)],
    ids=["symmetric", "cambered", "thick-cambered"],
)
def test_karman_trefftz_lift_is_exact_to_half_a_percent(alpha_deg, eps, delta):
    """The strongest check in the lab: an exact solution for a *lifting* body.

    A finite trailing-edge angle, because that is what the profiles the exercise offers have —
    about 16° for a 12 %-thick four-digit section.
    """
    shape = joukowski(eps=eps, delta=delta, te_angle=16.0)
    profile = read_profile(shape.outline, stations=160)
    alpha = np.radians(alpha_deg)

    solution = solve(resample(profile, 200), 1.0, alpha - profile.chord_angle)
    c_l = 2.0 * solution.circulation / profile.chord
    exact = shape.lift_coefficient(alpha)

    # Absolute floor as well as a relative tolerance: at zero incidence a cambered profile's
    # C_L is small, and a relative tolerance alone would be stricter there than anywhere else
    # for no physical reason.
    assert abs(c_l - exact) < max(0.005 * abs(exact), 0.005)


def test_the_joukowski_cusp_converges_but_only_slowly():
    """The deliberately unfavourable case, pinned so its cost is known rather than surprising.

    A Joukowski trailing edge is a cusp: the two surfaces arrive parallel, and straight panels
    resolve that at first order. The error must fall as panels are added — that is the claim —
    but it does not reach the tolerance the finite-angle case meets, and the specification says
    so rather than quietly testing only the favourable geometry.
    """
    shape = joukowski(te_angle=0.0)
    profile = read_profile(shape.outline, stations=200)
    alpha = np.radians(5.0)
    exact = shape.lift_coefficient(alpha)

    errors = []
    for panels in (100, 200, 400):
        solution = solve(resample(profile, panels), 1.0, alpha - profile.chord_angle)
        c_l = 2.0 * solution.circulation / profile.chord
        errors.append(abs(c_l - exact) / abs(exact))

    assert errors[0] > errors[1] > errors[2], "the cusp must at least converge"
    assert errors[2] < 0.02, "and be within 2 % by 400 panels"
    assert errors[1] > 0.005, "if this now passes at 0.5 %, the cusp caveat can be dropped"


# --------------------------------------------------------------- §8.3 thin-airfoil theory


@pytest.mark.parametrize(
    ("digits", "m", "p", "alpha_l0_deg", "cm_c4"),
    [
        ("0012", 0.00, 0.4, 0.000, 0.0000),
        ("1412", 0.01, 0.4, -1.039, -0.0266),
        ("2412", 0.02, 0.4, -2.077, -0.0531),
        ("2312", 0.02, 0.3, -1.918, -0.0447),
        ("4412", 0.04, 0.4, -4.154, -0.1062),
    ],
)
def test_thin_airfoil_reference_from_an_extracted_camber_line(digits, m, p, alpha_l0_deg, cm_c4):
    """The reference values in the specification's catalogue table, recomputed from an outline.

    Extracted from the *polygon*, not from the generating formula, because that is how a
    dragged shape has to be handled and the catalogue must not get an easier path (§4.3).
    """
    profile = read_profile(naca4_outline(m, p, 0.12), stations=100)
    reference = thin_airfoil(profile.station, profile.camber)

    assert np.degrees(reference.alpha_l0) == pytest.approx(alpha_l0_deg, abs=0.15)
    assert reference.cm_c4 == pytest.approx(cm_c4, abs=0.005)


def test_naca2412_lift_slope_and_zero_lift_angle_sit_where_theory_says():
    """Thin-airfoil theory as a *band*, because it neglects the thickness a panel method has."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=100)
    study = sweep(
        profile, 240, U_INF, RHO, np.arange(-4.0, 9.0, 1.0) - np.degrees(profile.chord_angle)
    )

    assert 2 * np.pi <= study.lift_slope <= 1.15 * 2 * np.pi
    assert study.alpha_l0_deg == pytest.approx(-2.08, abs=0.5)

    solution = solve(resample(profile, 240), U_INF, -profile.chord_angle)
    coeff = coefficients(solution, profile.chord, RHO)
    assert coeff.c_m_c4 == pytest.approx(-0.053, abs=0.02)


def test_a_symmetric_profile_at_zero_incidence_has_no_lift_and_no_moment():
    """Symmetry, which the discretisation must not break."""
    profile = read_profile(naca4_outline(0.0, 0.4, 0.12), stations=100)
    solution = solve(resample(profile, 200), U_INF, -profile.chord_angle)
    coeff = coefficients(solution, profile.chord, RHO)

    assert abs(coeff.c_l) < 1e-6
    assert abs(coeff.c_m_c4) < 1e-6
    # No normal force, so no centre of pressure — reported as absent rather than as a number
    # the formula would happily produce from two quantities that are both zero.
    assert coeff.x_cp_over_c is None


# ------------------------------------------------------ §8.4-8.6 consistency and convergence


@pytest.mark.parametrize("alpha_deg", [0.0, 4.0, 8.0])
def test_the_two_routes_to_lift_agree(alpha_deg):
    """Circulation against integrated pressure: the check that runs on every solve."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=100)
    solution = solve(resample(profile, 240), U_INF, np.radians(alpha_deg) - profile.chord_angle)
    coeff = coefficients(solution, profile.chord, RHO)
    reference = thin_airfoil(profile.station, profile.camber)

    checks = verify(coeff, solution, reference)
    assert checks.cl_consistency_rel < checks.cl_consistency_tolerance
    assert checks.cd_pressure_spurious < checks.cd_pressure_tolerance
    assert checks.passed


def test_the_consistency_residual_falls_as_panels_are_added():
    """It has to *converge*, not merely be small at one panel count."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=120)
    residuals = []
    for panels in (80, 160, 320):
        solution = solve(resample(profile, panels), U_INF, np.radians(4.0) - profile.chord_angle)
        coeff = coefficients(solution, profile.chord, RHO)
        residuals.append(abs(coeff.c_l - coeff.c_l_pressure) / abs(coeff.c_l))
    assert residuals[0] > residuals[1] > residuals[2]


def test_lift_is_converged_at_the_default_panel_count():
    """C_L must move by less than 0.5 % between 240 panels and 480."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=120)
    alpha = np.radians(5.0) - profile.chord_angle

    coarse = solve(resample(profile, 240), U_INF, alpha)
    fine = solve(resample(profile, 480), U_INF, alpha)
    c_l = [2 * s.circulation / (U_INF * profile.chord) for s in (coarse, fine)]
    assert abs(c_l[1] - c_l[0]) / abs(c_l[0]) < 0.005


def test_the_aerodynamic_centre_comes_out_near_the_quarter_chord():
    """Thin-airfoil theory puts it at 0.25; thickness moves it slightly aft."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=120)
    study = sweep(
        profile, 240, U_INF, RHO, np.arange(-4.0, 9.0, 2.0) - np.degrees(profile.chord_angle)
    )

    assert study.x_ac_over_c == pytest.approx(0.25, abs=0.02)
    assert study.x_ac_fit_r2 > 0.99


# ------------------------------------------------------------------- the no-circulation model


def test_without_a_kutta_condition_there_is_no_lift():
    """The model the lab shipped before, kept as a limit case and as the reason for the change."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=100)
    for alpha_deg in (0.0, 5.0, 10.0):
        solution = solve(
            resample(profile, 200),
            U_INF,
            np.radians(alpha_deg) - profile.chord_angle,
            circulation=0.0,
        )
        coeff = coefficients(solution, profile.chord, RHO)
        assert coeff.circulation == 0.0
        assert abs(coeff.c_l) < 1e-12


def test_without_a_kutta_condition_the_trailing_edge_velocity_diverges():
    """And this is *why*: the flow has to turn a sharp corner, so its speed is unbounded.

    Pinned as a test because it is the exercise's central teaching point, and because it is
    also why the no-circulation model's own d'Alembert residual does not converge.
    """
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=120)
    alpha = np.radians(5.0) - profile.chord_angle

    peaks = []
    for panels in (80, 160, 320):
        solution = solve(resample(profile, panels), U_INF, alpha, circulation=0.0)
        peaks.append(abs(solution.cp[0]))
    assert peaks[0] < peaks[1] < peaks[2], "the peak must deepen without limit"
    assert peaks[2] > 4 * peaks[0]

    with_kutta = solve(resample(profile, 320), U_INF, alpha)
    assert abs(with_kutta.cp[0]) < 1.0, "and imposing the Kutta condition must remove it"


# ------------------------------------------------------------------------- the sweep machinery


def test_a_sweep_is_one_factorisation_and_gives_the_same_answers():
    """The property the exercise's cost model rests on (§7.3)."""
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=80)
    nodes = resample(profile, 160)
    angles = np.radians(np.arange(-4.0, 9.0, 1.0))

    together = solve_sweep(nodes, U_INF, angles)
    apart = [solve(nodes, U_INF, angle) for angle in angles]

    assert len(together) == len(angles)
    for a, b in zip(together, apart, strict=True):
        assert a.circulation == pytest.approx(b.circulation, rel=1e-12)
        assert np.allclose(a.cp, b.cp)


# ------------------------------------------------------------------------------- the geometry


def test_the_profile_is_read_the_same_way_whatever_frame_it_arrives_in():
    """A dragged shape has no canonical orientation, so nothing may depend on one (§4.3)."""
    outline = naca4_outline(0.02, 0.4, 0.12)
    straight = read_profile(outline, stations=80)

    angle = np.radians(-30.0)
    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    tilted = read_profile(outline @ rotation.T + np.array([3.0, -1.0]), stations=80)

    assert tilted.chord == pytest.approx(straight.chord, rel=1e-9)
    assert np.degrees(tilted.chord_angle - straight.chord_angle) == pytest.approx(-30.0, abs=0.01)
    assert tilted.thickness.max() == pytest.approx(straight.thickness.max(), rel=1e-6)
    assert tilted.camber.max() == pytest.approx(straight.camber.max(), rel=1e-6)


def test_a_closed_trailing_edge_is_one_vertex_and_never_a_zero_length_panel():
    """A duplicated trailing-edge vertex is a singular matrix row and a protocol rejection."""
    for closed in (True, False):
        outline = naca4_outline(0.02, 0.4, 0.12, per_surface=40, closed_te=closed)
        geometry = panel_geometry(outline)
        assert geometry.length.min() > 0.0
        assert not np.any(np.all(np.isclose(np.diff(outline, axis=0), 0.0), axis=1))


def test_the_panel_count_is_what_was_asked_for():
    profile = read_profile(naca4_outline(0.02, 0.4, 0.12), stations=80)
    for panels in (40, 160, 240, 400):
        assert panel_geometry(resample(profile, panels)).count == panels


def test_reynolds_and_mach_are_derived_not_assumed():
    conditions = Conditions(u_inf=40.0, rho=1.225, mu=1.789e-5, sound_speed=340.29, chord=1.0)
    assert conditions.reynolds == pytest.approx(2.739e6, rel=1e-3)
    assert conditions.mach == pytest.approx(0.1175, rel=1e-3)
    assert conditions.dynamic_pressure == pytest.approx(980.0, rel=1e-3)
