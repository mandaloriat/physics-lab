"""Is the truss right? Bars, joints, equilibrium, buckling — against closed forms.

The companion to ``test_truss_solver.py``, and the same division of labour as the other two
pairs: this file asks whether the physics is correct, and the other asks whether the
capability is honest about it. Nothing here imports Fenix Spoon.

There is one thing worth saying about what a closed form means for this method that does not
apply to the panel method or to the finite-volume magnetostatics. Both of those *approximate*
a continuum, so a closed form is a target they converge towards. The direct stiffness method
does not approximate anything: with the joints pinned, a lattice of bars is exactly the
structure the equations describe, so the closed forms below are matched to **machine
precision** rather than to a tolerance that tightens with refinement. A test here that passes
at 1e-3 and not at 1e-12 is a test that has found a bug, and the tolerances are written that
way on purpose.
"""

import numpy as np
import pytest

from physics_lab.solvers import truss

E = 210e9
A = 1e-3
EA = E * A


def bar(length=3.0):
    """One horizontal bar, pinned at the left, free at the right."""
    return truss.build([(0.0, 0.0), (length, 0.0)], [(0, 1)])


def warren(panels=2, span=4.0, depth=1.0):
    """A Warren truss: a bottom chord, a zig-zag of diagonals, and a top chord.

    Statically determinate for any panel count with one pin and one roller, which is what
    makes it the right shape to check against the method of joints by hand.
    """
    step = span / panels
    nodes = [(step * i, 0.0) for i in range(panels + 1)]
    nodes += [(step * (i + 0.5), depth) for i in range(panels)]
    members = [(i, i + 1) for i in range(panels)]
    members += [(panels + 1 + i, panels + 2 + i) for i in range(panels - 1)]
    for i in range(panels):
        members += [(i, panels + 1 + i), (panels + 1 + i, i + 1)]
    return truss.build(nodes, members)


def solve(lattice, load, restrained, area=A):
    return truss.solve(
        lattice, np.full(lattice.member_count, E * area), np.asarray(load, float), restrained
    )


# --------------------------------------------------------------------------- closed forms


def test_a_single_bar_stretches_by_pl_over_ae():
    """The one closed form nobody can argue with, and the calibration of everything else."""
    length, force = 3.0, 5000.0
    lattice = bar(length)
    restrained = np.array([[True, True], [False, True]])
    solution = solve(lattice, [[0.0, 0.0], [force, 0.0]], restrained)

    assert solution.displacement[1, 0] == pytest.approx(force * length / (A * E), rel=1e-12)
    assert solution.force[0] == pytest.approx(force, rel=1e-12)
    # And the wall pushes back with exactly what was pulled.
    assert solution.reaction[0, 0] == pytest.approx(-force, rel=1e-12)


def test_a_bar_in_compression_is_negative():
    """The sign convention, asserted rather than assumed: positive is tension."""
    lattice = bar()
    restrained = np.array([[True, True], [False, True]])
    solution = solve(lattice, [[0.0, 0.0], [-4000.0, 0.0]], restrained)
    assert solution.force[0] == pytest.approx(-4000.0, rel=1e-12)


def test_a_two_bar_triangle_against_the_method_of_joints():
    """Two bars at 45° carrying a hanging load: the textbook first exercise.

    Joints 0 and 2 are pinned at the same height, 2 m apart; joint 1 hangs 1 m below the
    midpoint. A load *P* down at joint 1 is carried by two bars at 45°, so each takes
    ``P / (2 sin 45°) = P/√2`` in tension. Worked by hand, not by another solve.
    """
    lattice = truss.build([(0.0, 0.0), (1.0, -1.0), (2.0, 0.0)], [(0, 1), (1, 2)])
    restrained = np.array([[True, True], [False, False], [True, True]])
    load = 6000.0
    solution = solve(lattice, [[0.0, 0.0], [0.0, -load], [0.0, 0.0]], restrained)

    assert solution.force[0] == pytest.approx(load / np.sqrt(2), rel=1e-12)
    assert solution.force[1] == pytest.approx(load / np.sqrt(2), rel=1e-12)
    # Symmetric structure, symmetric load: no sideways drift and no sideways reaction.
    assert solution.displacement[1, 0] == pytest.approx(0.0, abs=1e-18)
    assert solution.reaction[0, 0] == pytest.approx(-solution.reaction[2, 0], rel=1e-12)


def test_reactions_of_a_simply_supported_truss_split_a_central_load_in_half():
    """Statics, and nothing but: a central load on a symmetric span is half at each support."""
    lattice = warren(panels=2)
    restrained = np.zeros((lattice.node_count, 2), dtype=bool)
    restrained[0] = True
    restrained[2, 1] = True
    load = np.zeros((lattice.node_count, 2))
    load[1, 1] = -10000.0

    solution = solve(lattice, load, restrained)
    assert solution.reaction[0, 1] == pytest.approx(5000.0, rel=1e-12)
    assert solution.reaction[2, 1] == pytest.approx(5000.0, rel=1e-12)
    assert solution.reaction[0, 0] == pytest.approx(0.0, abs=1e-6)


def test_the_answer_does_not_depend_on_the_stiffness_of_a_determinate_truss():
    """A statically determinate truss's member forces come from statics alone.

    So doubling every area must leave every force untouched and halve every displacement.
    This is the sharpest single check on the assembly: an error in a direction cosine or in
    the element matrix would show up here even where it happens to satisfy equilibrium.
    """
    lattice = warren(panels=3, span=6.0, depth=1.5)
    restrained = np.zeros((lattice.node_count, 2), dtype=bool)
    restrained[0] = True
    restrained[3, 1] = True
    load = np.zeros((lattice.node_count, 2))
    load[2, 1] = -8000.0

    thin = solve(lattice, load, restrained, area=A)
    thick = solve(lattice, load, restrained, area=2 * A)

    assert thick.force == pytest.approx(thin.force, rel=1e-10)
    assert thick.displacement == pytest.approx(thin.displacement / 2, rel=1e-10)


# ------------------------------------------------------------------- the independent checks


def test_the_joint_residual_vanishes_where_the_solve_was_free():
    """The method of joints, as a check rather than as a solution.

    Computed from the member forces and the geometry alone — no stiffness matrix and no
    displacements — so it is an independent statement that the answer is in equilibrium.
    """
    lattice = warren(panels=4, span=8.0, depth=2.0)
    restrained = np.zeros((lattice.node_count, 2), dtype=bool)
    restrained[0] = True
    restrained[4, 1] = True
    load = np.zeros((lattice.node_count, 2))
    load[[1, 2, 3], 1] = -5000.0

    solution = solve(lattice, load, restrained)
    residual = truss.joint_residual(lattice, solution.force, load)
    free = ~restrained.any(axis=1)
    assert np.abs(residual[free]).max() < 1e-6

    # At a restrained joint the reaction is deliberately absent from the residual, so what is
    # left over there is exactly the reaction — with the sign flipped.
    assert residual[0] == pytest.approx(-solution.reaction[0], abs=1e-6)


def test_strain_energy_equals_the_work_done_on_it():
    """Clapeyron, by two routes that share no arithmetic."""
    lattice = warren(panels=3, span=6.0, depth=1.2)
    restrained = np.zeros((lattice.node_count, 2), dtype=bool)
    restrained[0] = True
    restrained[3, 1] = True
    load = np.zeros((lattice.node_count, 2))
    load[1, 1] = -7000.0
    load[2, 0] = 2000.0

    solution = solve(lattice, load, restrained)
    stored = truss.strain_energy(lattice, np.full(lattice.member_count, EA), solution.force)
    work = truss.external_work(load, solution.displacement)
    assert stored == pytest.approx(work, rel=1e-10)
    assert stored > 0


# ----------------------------------------------------------------------------- the refusals


def test_a_lattice_that_folds_is_refused_and_says_where():
    """Four bars in a square with no diagonal: a mechanism, and the classic one.

    The square shears without stretching a bar, so there is no equilibrium to report. The
    refusal has to name the joints that move, because "add a diagonal" is advice only if it
    says where to put it.
    """
    lattice = truss.build(
        [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
        [(0, 1), (1, 2), (2, 3), (3, 0)],
    )
    restrained = np.zeros((4, 2), dtype=bool)
    restrained[0] = True
    restrained[1, 1] = True
    load = np.zeros((4, 2))
    load[2, 1] = -1000.0

    with pytest.raises(truss.Mechanism) as raised:
        solve(lattice, load, restrained)
    assert raised.value.count >= 1
    assert raised.value.joints  # it names somewhere to look


def test_the_same_square_with_a_diagonal_stands_up():
    """The other half of the previous test: triangulation is what fixes it."""
    lattice = truss.build(
        [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
        [(0, 1), (1, 2), (2, 3), (3, 0), (0, 2)],
    )
    restrained = np.zeros((4, 2), dtype=bool)
    restrained[0] = True
    restrained[1, 1] = True
    load = np.zeros((4, 2))
    load[2, 1] = -1000.0

    solution = solve(lattice, load, restrained)
    assert np.isfinite(solution.displacement).all()
    assert abs(solution.force).max() > 0


def test_a_load_on_a_joint_no_member_reaches_is_refused():
    """The failure upstream's load cases exist to prevent, in this model's own terms.

    Applying it would silently drop the force and answer a lighter problem — a wrong answer
    with nothing on the result to say so.
    """
    lattice = truss.build([(0.0, 0.0), (1.0, 0.0), (5.0, 5.0)], [(0, 1)])
    restrained = np.zeros((3, 2), dtype=bool)
    restrained[0] = True
    restrained[1, 1] = True
    load = np.zeros((3, 2))
    load[2, 1] = -1000.0

    with pytest.raises(ValueError, match="nowhere to go"):
        solve(lattice, load, restrained)


def test_a_stray_joint_carrying_nothing_is_simply_ignored():
    """Because a builder leaves them behind, and a stray dot must not read as a mechanism."""
    lattice = truss.build([(0.0, 0.0), (1.0, 0.0), (5.0, 5.0)], [(0, 1)])
    restrained = np.zeros((3, 2), dtype=bool)
    restrained[0] = True
    restrained[1, 1] = True
    load = np.zeros((3, 2))
    load[1, 0] = 1000.0

    solution = solve(lattice, load, restrained)
    assert solution.displacement[2] == pytest.approx([0.0, 0.0])
    assert not solution.free[4:6].any()


@pytest.mark.parametrize(
    ("nodes", "members", "message"),
    [
        ([(0.0, 0.0)], [(0, 0)], "at least two joints"),
        ([(0.0, 0.0), (1.0, 0.0)], [], "at least one member"),
        ([(0.0, 0.0), (1.0, 0.0)], [(0, 2)], "outside this lattice"),
        ([(0.0, 0.0), (1.0, 0.0)], [(1, 1)], "joins a joint to itself"),
        ([(0.0, 0.0), (1.0, 0.0)], [(0, 1), (1, 0)], "same pair of joints"),
        ([(0.0, 0.0), (0.0, 0.0)], [(0, 1)], "zero length"),
    ],
)
def test_a_lattice_that_cannot_mean_anything_is_refused(nodes, members, message):
    with pytest.raises(ValueError, match=message):
        truss.build(nodes, members)


# ------------------------------------------------------------------------------ buckling


def test_the_euler_load_matches_the_closed_form_for_a_solid_round_bar():
    """``P_cr = pi^2 E I / L^2`` with ``I = A^2 / 4pi``, worked independently here."""
    length = np.array([4.0])
    area = np.array([A])
    critical = truss.buckling_load(np.array([EA]), area, length)

    second_moment = A**2 / (4 * np.pi)
    assert critical[0] == pytest.approx(np.pi**2 * E * second_moment / 16.0, rel=1e-12)


def test_the_euler_load_falls_with_the_square_of_the_length():
    """Which is the whole reason a long compression member is a bad idea."""
    critical = truss.buckling_load(np.full(2, EA), np.full(2, A), np.array([2.0, 4.0]))
    assert critical[0] / critical[1] == pytest.approx(4.0, rel=1e-12)


# ------------------------------------------------------------------------- mass and weight


def test_self_weight_is_the_bars_own_mass_split_between_their_ends():
    lattice = warren(panels=2)
    density = 7850.0
    weight = truss.self_weight(lattice, np.full(lattice.member_count, A), density)
    total = truss.mass(lattice, np.full(lattice.member_count, A), density) * truss.GRAVITY

    assert weight[:, 0] == pytest.approx(np.zeros(lattice.node_count))  # gravity is vertical
    assert weight[:, 1].sum() == pytest.approx(-total, rel=1e-12)


def test_mass_is_density_times_area_times_length():
    lattice = bar(3.0)
    assert truss.mass(lattice, np.array([A]), 7850.0) == pytest.approx(7850.0 * A * 3.0, rel=1e-12)
