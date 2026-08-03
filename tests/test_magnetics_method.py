"""Is the magnetostatics right? Grid, operator, interface, reconstruction, metrics.

The companion to ``test_panel_method.py``, and the same division of labour: this file asks
whether the physics is correct, and ``test_magnetics_solver.py`` asks whether the capability
is honest about it. Nothing here imports Fenix Spoon — the method takes arrays and returns
arrays, which is what makes it testable against a closed form.

The two that carry the most weight:

* ``test_a_manufactured_solution_across_a_material_interface`` solves a problem whose exact
  answer is known *and* which has a permeability jump in the middle of it. It is the only
  test here that could fail because the harmonic mean is wrong, and the whole reason for
  fitting the grid to the interface is that this is the case a magnet is made of.
* ``test_the_section_average_converges_where_the_pointwise_peak_does_not`` is the measurement
  that decided which quantity the saturation warning is read from. It is written as an
  assertion in both directions on purpose: if the peak ever starts converging, the reason
  ``docs/exercises/solenoid.md`` gives for withholding it has gone away and the test should
  say so by failing.
"""

import numpy as np
import pytest

from physics_lab.solvers import solenoid as exercise
from physics_lab.solvers.magnetics import (
    MU0,
    Grid,
    Materials,
    axis_lines,
    build_grid,
    flux_density,
    is_axis_aligned_rectangle,
    rasterise,
    sample_uniform,
    solve_potential,
)

MM = 1.0e-3


def rectangle(x0, y0, x1, y1) -> np.ndarray:
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=float)


def solenoid(
    window: float = 60 * MM,
    core: float = 10 * MM,
    gap: float = 5 * MM,
    winding: float = 10 * MM,
    half_height: float = 30 * MM,
    mu_r: float = 1000.0,
    current: float = 5.0e6,
):
    """The page's cross-section as plain arrays: outlines, materials, background, bounds."""
    bore = core + gap
    outer = bore + winding
    outlines = [
        rectangle(-core, -half_height, core, half_height),
        rectangle(-outer, -half_height, -bore, half_height),
        rectangle(bore, -half_height, outer, half_height),
    ]
    materials = [
        {"mu_r": mu_r},
        {"current_density": -current},
        {"current_density": current},
    ]
    return (-window, -window, window, window), outlines, materials, {"mu_r": 1.0}


def run(
    resolution: int,
    tolerance: float = 1e-11,
    prefer: str | None = None,
    growth: float = 1.0,
    **kwargs,
):
    """Solve one cross-section and reduce it, the way the adapter does."""
    bounds, outlines, materials, background = solenoid(**kwargs)
    grid = build_grid(bounds, outlines, resolution, growth)
    cells = rasterise(grid, outlines, materials, background)
    solution = solve_potential(grid, cells, tolerance=tolerance, max_iterations=80000)
    field = flux_density(grid, cells, solution.a)
    magnet = exercise.locate(grid, cells, ["core", "winding_left", "winding_right"], prefer)
    metrics, integrals = exercise.measure(grid, cells, solution.a, field, magnet)
    return grid, cells, solution, field, magnet, metrics, integrals


# ------------------------------------------------------------------------------------ the grid


def test_the_grid_lands_a_line_on_every_region_edge():
    """The whole reason this discretisation exists, so it is asserted before anything else."""
    bounds, outlines, _, _ = solenoid()
    grid = build_grid(bounds, outlines, 60)

    for outline in outlines:
        for x in np.unique(outline[:, 0]):
            assert np.isclose(grid.x_edges, x).any(), f"no grid line at x = {x}"
        for y in np.unique(outline[:, 1]):
            assert np.isclose(grid.y_edges, y).any(), f"no grid line at y = {y}"


def test_the_core_is_exactly_as_wide_as_it_was_drawn_at_every_resolution():
    """A staircase gets this wrong by a cell, and by a different cell at every resolution."""
    for resolution in (20, 31, 64, 100):
        _, _, _, _, magnet, _, _ = run(resolution, tolerance=1e-6)
        assert magnet.core_width == pytest.approx(20 * MM, abs=1e-12)


def test_the_mid_plane_of_a_region_is_a_row_of_the_grid():
    """Because that is where the flux is measured; half a cell off is an avoidable error."""
    bounds, outlines, _, _ = solenoid()
    for resolution in (20, 31, 64):
        grid = build_grid(bounds, outlines, resolution)
        assert np.isclose(grid.y, 0.0).any()


def test_a_finer_resolution_is_never_a_coarser_grid():
    bounds, outlines, _, _ = solenoid()
    previous = 0
    for resolution in (12, 24, 48, 96):
        cells = build_grid(bounds, outlines, resolution).cells
        assert cells > previous
        previous = cells


def test_the_resolution_counts_cells_across_the_regions_not_across_the_window():
    """The definition that lets the window be widened without coarsening the magnet.

    Counting across the *window* couples the two, and it was measured doing real damage: at a
    window eight times the magnet, a resolution that had been ample gave two cells across the
    core and an energy balance out by 11 %. Here the same magnet in a window four times larger
    keeps the same cell size on the iron.
    """
    sizes = []
    for window in (60 * MM, 240 * MM):
        bounds, outlines, _, _ = solenoid(window=window)
        grid = build_grid(bounds, outlines, 60)
        core = (np.abs(grid.x) < 10 * MM) & (np.abs(grid.x) > 0)
        sizes.append(float(grid.hx[core].max()))
    assert sizes[0] == pytest.approx(sizes[1], rel=1e-9)


def test_grading_makes_a_large_window_affordable():
    """The far field is smooth and mostly empty, and it should not cost what the iron costs."""
    bounds, outlines, _, _ = solenoid(window=240 * MM)
    uniform = build_grid(bounds, outlines, 80, 1.0)
    graded = build_grid(bounds, outlines, 80, 1.2)

    assert graded.cells < uniform.cells / 4
    # And it buys that by coarsening only the air: the cells on the magnet are unchanged.
    inside = np.abs(graded.x) < 25 * MM
    assert graded.hx[inside].max() == pytest.approx(uniform.hx[np.abs(uniform.x) < 25 * MM].max())
    # Smoothly, with no cell more than the stated ratio larger than its neighbour.
    ratios = graded.hx[1:] / graded.hx[:-1]
    assert max(ratios.max(), (1.0 / ratios).max()) < 1.2 + 1e-9


def test_a_graded_grid_still_converges_at_second_order():
    """Grading is only free if it does not cost the order of accuracy, so that is asserted.

    Same manufactured solution as above, on a grid that is fine in the middle and geometrically
    coarser towards both walls. A two-point flux scheme on a non-uniform grid has a first-order
    *truncation* error and a second-order solution — supraconvergence — and it is the solution
    this exercise reports.
    """
    errors = []
    for n in (32, 64, 128):
        grid, materials, exact = manufactured(
            1.0, 1.0e-3, interface=0.4, side=1.0, n=n, subject=(0.2, 0.8), growth=1.15
        )
        solution = solve_potential(grid, materials, tolerance=1e-13, max_iterations=200000)
        errors.append(float(np.linalg.norm(solution.a - exact) / np.linalg.norm(exact)))

    orders = [np.log2(a / b) for a, b in zip(errors[:-1], errors[1:], strict=True)]
    assert min(orders) > 1.7, (errors, orders)


def test_axis_lines_keeps_the_breaks_and_respects_the_target():
    edges = axis_lines(0.0, 1.0, [0.3, 0.7, 0.3], target=0.1)
    for wanted in (0.0, 0.3, 0.7, 1.0):
        assert np.isclose(edges, wanted).any()
    assert np.diff(edges).max() <= 0.1 + 1e-12
    assert (np.diff(edges) > 0).all()


def test_axis_lines_ignores_breaks_outside_the_span():
    edges = axis_lines(0.0, 1.0, [-4.0, 0.5, 9.0], target=0.25)
    assert edges[0] == 0.0 and edges[-1] == 1.0
    assert np.isclose(edges, 0.5).any()


def test_a_rotated_rectangle_is_not_an_axis_aligned_one():
    assert is_axis_aligned_rectangle(rectangle(-1.0, -2.0, 1.0, 2.0))
    diamond = np.array([[0.0, 1.0], [1.0, 0.0], [0.0, -1.0], [-1.0, 0.0]])
    assert not is_axis_aligned_rectangle(diamond)
    assert not is_axis_aligned_rectangle(np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]))


# ------------------------------------------------------------------------ the operator, exactly


def manufactured(
    nu_left: float,
    nu_right: float,
    interface: float,
    side: float,
    n: int,
    subject: tuple[float, float] | None = None,
    growth: float = 1.0,
):
    """An exact solution of the real equation, with a permeability jump down the middle.

    Built from the flux rather than from the potential, which is the only way to have both a
    discontinuous coefficient and a solution that satisfies the interface conditions exactly.
    Take ``q(x) = nu dA/dx`` to be smooth — it is the quantity that is continuous — and
    integrate it back:

        A(x, y) = f(x) sin(pi y / L) ,     f(x) = integral of q / nu ,
        q(x) = cos(pi x / L) + k ,

    with ``k`` chosen so that ``f(L) = 0``, which is what makes the homogeneous Dirichlet
    condition hold on all four sides. The source that produces it follows by differentiating,

        J = [ (pi/L) sin(pi x / L) + nu(x) f(x) (pi/L)^2 ] sin(pi y / L) ,

    and ``f`` has a kink at the interface of exactly the ratio ``nu_left / nu_right``, which
    is the thing being tested.
    """
    grid = Grid(
        x_edges=axis_lines(0.0, side, [interface], side / n, subject, growth),
        y_edges=axis_lines(0.0, side, [], side / n, subject, growth),
    )
    xx, yy = grid.centres()
    k = np.pi / side

    nu = np.where(xx < interface, nu_left, nu_right)
    length_left, length_right = interface, side - interface
    offset = -(np.sin(k * interface) / k) * (1.0 / nu_left - 1.0 / nu_right)
    offset /= length_left / nu_left + length_right / nu_right

    def f(x):
        left = (np.sin(k * x) / k + offset * x) / nu_left
        head = (np.sin(k * interface) / k + offset * interface) / nu_left
        step = np.sin(k * x) / k - np.sin(k * interface) / k + offset * (x - interface)
        return np.where(x < interface, left, head + step / nu_right)

    exact = f(xx) * np.sin(k * yy)
    current = (k * np.sin(k * xx) + nu * f(xx) * k**2) * np.sin(k * yy)
    materials = Materials(
        mu_r=1.0 / (MU0 * nu),
        current=current,
        region=np.where(xx < interface, 0, 1),
        exact=True,
    )
    return grid, materials, exact


def test_a_manufactured_solution_across_a_material_interface():
    """Solve a problem whose answer is known, with a thousandfold permeability jump in it."""
    grid, materials, exact = manufactured(1.0, 1.0e-3, interface=0.4, side=1.0, n=128)
    solution = solve_potential(grid, materials, tolerance=1e-13, max_iterations=100000)

    error = np.linalg.norm(solution.a - exact) / np.linalg.norm(exact)
    assert solution.converged
    assert error < 2e-4, error


def test_the_manufactured_solution_converges_at_second_order():
    """Halving the cell should quarter the error. Anything slower means the interface leaks.

    Asserted asymptotically, which is the only way this is assertable: the observed orders on
    this problem are 1.80 then 1.96, approaching two from below as the coarsest grid's own
    error stops dominating. Demanding two from the first pair would be demanding that a
    second-order method have no higher-order terms.
    """
    errors = []
    for n in (32, 64, 128):
        grid, materials, exact = manufactured(1.0, 1.0e-3, interface=0.4, side=1.0, n=n)
        solution = solve_potential(grid, materials, tolerance=1e-13, max_iterations=100000)
        errors.append(float(np.linalg.norm(solution.a - exact) / np.linalg.norm(exact)))

    orders = [np.log2(a / b) for a, b in zip(errors[:-1], errors[1:], strict=True)]
    assert min(orders) > 1.7, (errors, orders)
    assert orders[-1] > 1.9, (errors, orders)


def test_a_geometry_with_no_current_solves_to_zero_without_iterating():
    """"The coil is off" is a legitimate thing to submit, and its answer is exact."""
    bounds, outlines, _, background = solenoid()
    grid = build_grid(bounds, outlines, 40)
    materials = rasterise(grid, outlines, [{"mu_r": 1000.0}, {}, {}], background)
    solution = solve_potential(grid, materials)

    assert solution.iterations == 0
    assert solution.converged
    assert not solution.a.any()


# --------------------------------------------------------------------- the physics of a magnet


def test_a_symmetric_magnet_has_an_odd_potential():
    """Opposed windings about a symmetric core: A(-x, y) = -A(x, y), to the solver's tolerance."""
    grid, _, solution, _, _, _, _ = run(40, tolerance=1e-12)
    assert grid.shape[1] % 2 == 0 or np.isclose(grid.x, 0.0).any()

    mirrored = solution.a[:, ::-1]
    scale = np.abs(solution.a).max()
    assert np.abs(solution.a + mirrored).max() / scale < 1e-9


def test_the_field_is_linear_in_the_current():
    """Doubling J doubles every field exactly. It is a property of the model, not of iron."""
    _, _, single, _, _, one, _ = run(30, current=5.0e6)
    _, _, double, _, _, two, _ = run(30, current=1.0e7)

    assert np.allclose(double.a, 2.0 * single.a, rtol=1e-8)
    assert two.flux_core == pytest.approx(2.0 * one.flux_core, rel=1e-8)
    assert two.energy == pytest.approx(4.0 * one.energy, rel=1e-8)
    assert two.leakage_ratio == pytest.approx(one.leakage_ratio, rel=1e-8)


def test_the_iron_gathers_the_flux():
    """The page's whole claim, as a number: a core carries far more flux than air does.

    Both runs are measured across the *same* surface — the region called `core`, named
    explicitly so that the one made of air is still where the flux is counted — because a
    comparison that also moved the surface would not be a comparison.
    """
    _, _, _, _, _, air, _ = run(40, mu_r=1.0, prefer="core")
    _, _, _, _, _, iron, _ = run(40, mu_r=1000.0, prefer="core")

    # Not the factor of a thousand the permeability ratio might suggest, and that is the
    # lesson: the flux still has to return through air, so the iron improves the easy half of
    # a series path. Measured at 3.75 on this cross-section.
    assert abs(iron.flux_core) > 3.0 * abs(air.flux_core)
    assert iron.leakage_ratio < 0.1
    assert air.leakage_ratio > 0.4


def test_a_better_core_stops_helping():
    """The lesson the page teaches, asserted: the air return is what limits the flux."""
    _, _, _, _, _, thousand, _ = run(40, mu_r=1000.0)
    _, _, _, _, _, ten_thousand, _ = run(40, mu_r=10000.0)

    gain = abs(ten_thousand.flux_core / thousand.flux_core)
    assert 1.0 < gain < 1.05, gain


def test_the_ampere_turns_need_no_solve():
    """Winding 10 mm by 60 mm at 5 A/mm^2 is 3000 A, and the solver had better agree."""
    _, _, _, _, _, metrics, _ = run(20, tolerance=1e-6)
    assert metrics.ampere_turns == pytest.approx(5.0e6 * (10 * MM) * (60 * MM))
    assert metrics.net_current == pytest.approx(0.0, abs=1e-9)


# -------------------------------------------------------------------------- the checks are real


def test_the_energy_balance_closes_and_closes_further_when_refined():
    """Field energy against source energy: equal for a linear medium, and computed apart.

    The residual is a discretisation error rather than a bug, so the assertion is about both
    its size and its direction of travel — a check that is merely small at one resolution
    could be small by luck.
    """
    residuals = []
    for resolution in (30, 60, 120):
        *_, integrals = run(resolution)
        field, source = integrals.energy_from_field, integrals.energy_from_sources
        residuals.append(abs(field - source) / field)

    assert max(residuals) < 0.01, residuals
    assert residuals[-1] < residuals[0], residuals


def test_ampere_law_holds_on_the_reconstructed_field():
    """A contour of H.dl through the air, against the current it encloses."""
    *_, metrics, integrals = run(60)
    assert integrals.contour is not None
    assert integrals.enclosed_current == pytest.approx(metrics.ampere_turns, rel=1e-9)
    assert integrals.circulation_h == pytest.approx(integrals.enclosed_current, rel=1e-3)


def test_the_two_routes_to_the_core_flux_agree():
    """The potential difference across the core, against the integral of B along it."""
    *_, integrals = run(60)
    assert integrals.flux_from_potential == pytest.approx(integrals.flux_from_field, rel=2e-3)


def test_an_unconverged_solve_says_so_rather_than_looking_finished():
    """The failure mode of a fixed-iteration solver, and the reason a residual is reported."""
    bounds, outlines, materials, background = solenoid()
    grid = build_grid(bounds, outlines, 60)
    cells = rasterise(grid, outlines, materials, background)
    stopped = solve_potential(grid, cells, tolerance=1e-12, max_iterations=30)

    assert not stopped.converged
    assert stopped.residual > 1e-12
    assert stopped.iterations == 30


# ------------------------------------------------------------ which number the warning is read from


def test_the_section_average_converges_where_the_pointwise_peak_does_not():
    """The measurement behind ``b_section_max``, kept as a test so it stays true.

    The section average settles inside a fifth of a per cent over a fourfold refinement; the
    pointwise peak in the same iron grows by more than a third over the same range, because
    the core's corner is a singularity of the exact solution rather than an artefact of the
    grid. If that ever stops being so, this fails and the exercise's stated reason for
    withholding the peak has to be rewritten.
    """
    sections, peaks = [], []
    for resolution in (30, 60, 120):
        *_, metrics, _ = run(resolution, tolerance=1e-11)
        sections.append(metrics.b_section_max)
        peaks.append(metrics.b_max)

    settled = abs(sections[-1] - sections[-2]) / sections[-2]
    assert settled < 0.002, sections
    assert peaks[-1] / peaks[0] > 1.3, peaks


def test_the_leakage_ratio_barely_moves_when_the_window_grows():
    """Why the bundle is measured where B_y changes sign rather than at a chosen surface.

    The core flux itself changes by a fifth between these two windows — the truncation is
    real, and the validity warning is about exactly that — while the *share* of it that misses
    the iron holds to a few per cent, because the surface it is measured against sits where
    the integrand vanishes.
    """
    _, _, _, _, _, tight, _ = run(40, window=60 * MM)
    _, _, _, _, _, roomy, _ = run(40, window=90 * MM)

    assert abs(roomy.flux_core / tight.flux_core) > 1.1
    assert roomy.leakage_ratio == pytest.approx(tight.leakage_ratio, rel=0.05)


def test_a_tight_window_shows_its_energy_against_the_wall():
    """The truncation warning's own quantity, and that widening the window relieves it."""
    _, _, _, _, _, tight, _ = run(40, window=60 * MM)
    _, _, _, _, _, roomy, _ = run(40, window=240 * MM, growth=1.2)

    assert tight.boundary_energy_fraction > exercise.BOUNDARY_ENERGY_LIMIT
    assert roomy.boundary_energy_fraction < exercise.BOUNDARY_ENERGY_LIMIT


# ------------------------------------------------------------------------------- what is reported


def test_a_geometry_with_no_iron_withholds_the_core_metrics():
    """A coil in air is a legitimate solve, and it has no core flux to report."""
    bounds, outlines, materials, background = solenoid(mu_r=1.0)
    grid = build_grid(bounds, outlines, 20)
    cells = rasterise(grid, outlines, materials, background)
    magnet = exercise.locate(grid, cells, ["core", "winding_left", "winding_right"], None)

    assert magnet.core is None
    solution = solve_potential(grid, cells, tolerance=1e-8, max_iterations=20000)
    field = flux_density(grid, cells, solution.a)
    metrics, _ = exercise.measure(grid, cells, solution.a, field, magnet)

    assert metrics.flux_core is None
    assert metrics.b_section_max is None
    assert metrics.leakage_ratio is None
    assert metrics.ampere_turns > 0.0  # still exact, still reported


def test_the_named_region_wins_over_the_most_permeable_one():
    bounds, outlines, materials, background = solenoid()
    grid = build_grid(bounds, outlines, 20)
    cells = rasterise(grid, outlines, materials, background)
    names = ["core", "winding_left", "winding_right"]

    assert exercise.locate(grid, cells, names, None).core_name == "core"
    assert exercise.locate(grid, cells, names, "winding_right").core_name == "winding_right"
    assert exercise.locate(grid, cells, names, "nothing-called-this").core_name == "core"


def test_a_non_rectangular_region_is_reported_as_not_interface_fitted():
    """It is still solved. What changes is that the page is told the boundary is staircased."""
    bounds, outlines, materials, background = solenoid()
    outlines[0] = np.array([[-10 * MM, -30 * MM], [10 * MM, -30 * MM], [0.0, 30 * MM]])
    grid = build_grid(bounds, outlines, 30)
    cells = rasterise(grid, outlines, materials, background)

    assert not cells.exact
    assert (cells.mu_r > 1.0).any()


def test_the_material_map_follows_painters_order():
    """Protocol rule: where two regions nest, the later one wins."""
    bounds = (-1.0, -1.0, 1.0, 1.0)
    outlines = [rectangle(-0.8, -0.8, 0.8, 0.8), rectangle(-0.4, -0.4, 0.4, 0.4)]
    grid = build_grid(bounds, outlines, 40)
    cells = rasterise(grid, outlines, [{"mu_r": 500.0}, {"mu_r": 7.0}], {"mu_r": 1.0})

    xx, yy = grid.centres()
    inner = (np.abs(xx) < 0.4) & (np.abs(yy) < 0.4)
    assert cells.mu_r[inner].max() == 7.0
    assert cells.mu_r[~inner].max() == 500.0


def test_the_saturation_limit_comes_from_the_material_when_it_declares_one():
    assert exercise.saturation_limit([{"mu_r": 1000.0}], 0) == exercise.DEFAULT_SATURATION
    assert exercise.saturation_limit([{"mu_r": 3000.0, "b_sat": 0.4}], 0) == 0.4
    assert exercise.saturation_limit([], None) == exercise.DEFAULT_SATURATION


# -------------------------------------------------------------------------------- the resampling


def test_the_uniform_resampling_never_invents_a_material():
    """Nearest-cell, so every sampled permeability is one that exists in the model."""
    bounds, outlines, materials, background = solenoid()
    grid = build_grid(bounds, outlines, 30)
    cells = rasterise(grid, outlines, materials, background)
    raster = sample_uniform(grid, cells.mu_r, 96, 96)

    assert raster.shape == (96, 96)
    assert set(np.unique(raster)) <= set(np.unique(cells.mu_r))
