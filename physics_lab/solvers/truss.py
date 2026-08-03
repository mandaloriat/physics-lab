"""The direct stiffness method for a planar pin-jointed truss. Arrays in, arrays out.

No Fenix Spoon import, by the same rule ``panel.py`` and ``magnetics.py`` are written under:
the physics has to be testable against a closed form without a job, a server or a result
envelope. What this module knows is bars, joints and equilibrium.

## The model

Every member is a straight bar carrying **axial force only** — a pin at each joint, so a bar
cannot take moment and a joint cannot transmit one. For a member between joints *i* and *j*
of length *L* and direction ``(c, s)``, that gives the 4x4 element stiffness

    k = (EA/L) · [ c², cs, −c², −cs ;  cs, s², −cs, −s² ; … ]

assembled into a global ``K``, restrained, and solved once. There is nothing iterative here
and nothing to converge: with the joints pinned the discretisation *is* the structure, so a
"mesh convergence" study has no meaning on this page and none is offered. That is the one
respect in which this solver is unlike every other one in the lab, and it is worth saying
out loud rather than leaving a visitor to wonder why the numerical panel is so short.

## What it refuses

Two structures cannot be answered and are refused rather than reported:

* a **mechanism** — a lattice that folds without stretching any bar. The reduced stiffness
  matrix is singular, and the honest answer is not a large displacement but no displacement
  at all: the equations have no solution. :func:`solve` names how many independent ways it
  folds and which joints move most in the first of them, because "add a diagonal" is only
  useful advice if you know where.
* a **load with nowhere to go** — a force at a joint no member reaches. Applying it would
  silently drop it and answer a lighter problem, which is the failure mode upstream's load
  cases were designed to make impossible (see ``fenixspoon.core.conditions``).

Both are raised by the caller: this module reports the condition, :mod:`physics_lab.solvers.bridge`
turns it into a message.
"""

from dataclasses import dataclass

import numpy as np

#: Relative eigenvalue below which a restrained stiffness matrix counts as singular.
#:
#: Relative to the largest eigenvalue, because ``K`` is scaled by EA/L: a stiffness in
#: newtons per metre is 10⁷ for a steel bar and 10⁻¹ for a rubber band, and an absolute
#: threshold would call one of them a mechanism. A true mechanism produces an eigenvalue at
#: machine zero — 10⁻¹⁶ of the largest — so nine decades of margin costs nothing and leaves
#: a merely floppy structure to be answered and warned about rather than refused.
SINGULAR_TOLERANCE = 1e-9

#: Standard gravity, m/s². Only self-weight uses it.
GRAVITY = 9.80665


class Mechanism(ValueError):
    """The lattice folds: the restrained stiffness matrix is singular.

    Carries the count and the worst-moving joints so the caller can say where to put the
    next diagonal instead of only that something is wrong.
    """

    def __init__(self, count: int, joints: list[int]) -> None:
        self.count = count
        self.joints = joints
        super().__init__(f"the lattice is a mechanism in {count} independent way(s)")


@dataclass(frozen=True)
class Geometry:
    """Joint coordinates and the pairs of joints the bars connect, both as arrays.

    ``length`` and ``direction`` are computed once here because everything downstream needs
    them and recomputing a direction cosine in three places is how two of them come to
    disagree about which way a bar points.
    """

    nodes: np.ndarray  # (n, 2), metres
    members: np.ndarray  # (m, 2), indices into nodes
    length: np.ndarray  # (m,), metres
    direction: np.ndarray  # (m, 2), unit vectors from the first joint to the second

    @property
    def node_count(self) -> int:
        return int(self.nodes.shape[0])

    @property
    def member_count(self) -> int:
        return int(self.members.shape[0])

    @property
    def attached(self) -> np.ndarray:
        """Which joints a bar actually reaches, as a boolean mask over joints.

        A joint nothing reaches has no stiffness at all, so leaving it in the system would
        make every lattice with a stray point look like a mechanism. It is dropped from the
        degrees of freedom instead, and the caller says so.
        """
        mask = np.zeros(self.node_count, dtype=bool)
        mask[self.members.ravel()] = True
        return mask


def build(nodes, members) -> Geometry:
    """Validate a lattice and derive its lengths and directions.

    Every refusal here is about a lattice that cannot mean anything, rather than one that
    performs badly: an index that names no joint, a bar of zero length, the same pair of
    joints connected twice (which would double a stiffness and halve a stress with nothing
    on the result to say so).
    """
    points = np.asarray(nodes, dtype=float).reshape(-1, 2)
    bars = np.asarray(members, dtype=int).reshape(-1, 2)

    if points.shape[0] < 2:
        raise ValueError("a truss needs at least two joints")
    if not np.isfinite(points).all():
        raise ValueError("joint coordinates must all be finite")
    if bars.shape[0] < 1:
        raise ValueError("a truss needs at least one member; joints alone carry nothing")
    if bars.min() < 0 or bars.max() >= points.shape[0]:
        raise ValueError(
            f"a member names a joint outside this lattice, which has {points.shape[0]} of "
            f"them (0 to {points.shape[0] - 1})"
        )
    if (bars[:, 0] == bars[:, 1]).any():
        raise ValueError("a member joins a joint to itself")

    ordered = np.sort(bars, axis=1)
    unique = {(int(a), int(b)) for a, b in ordered}
    if len(unique) != len(ordered):
        raise ValueError(
            "two members join the same pair of joints; one bar of twice the area is what "
            "that means structurally, and stating it that way is the only version this "
            "solver can report a stress for"
        )

    delta = points[bars[:, 1]] - points[bars[:, 0]]
    length = np.linalg.norm(delta, axis=1)
    if (length <= 0).any():
        raise ValueError("a member has zero length")

    return Geometry(
        nodes=points,
        members=bars,
        length=length,
        direction=delta / length[:, None],
    )


def stiffness(geometry: Geometry, axial_stiffness: np.ndarray) -> np.ndarray:
    """The global stiffness matrix, `(2n, 2n)`, in N/m.

    ``axial_stiffness`` is EA per member, so a lattice of mixed sections is one array rather
    than a special case. Dense on purpose: the largest lattice this capability admits is a
    few hundred degrees of freedom, where a dense factorisation is microseconds and a sparse
    one is a dependency.
    """
    n = geometry.node_count
    k = np.zeros((2 * n, 2 * n))
    ea_over_l = axial_stiffness / geometry.length

    for index, (start, end) in enumerate(geometry.members):
        c, s = geometry.direction[index]
        # The outer product of the direction with itself: a bar resists only the component
        # of a joint's motion along its own axis, which is the whole content of the model.
        block = ea_over_l[index] * np.array(
            [[c * c, c * s], [c * s, s * s]],
        )
        i, j = 2 * start, 2 * end
        k[i : i + 2, i : i + 2] += block
        k[j : j + 2, j : j + 2] += block
        k[i : i + 2, j : j + 2] -= block
        k[j : j + 2, i : i + 2] -= block
    return k


@dataclass(frozen=True)
class Solution:
    """One equilibrium: joint displacements, member forces, and the reactions holding it up."""

    displacement: np.ndarray  # (n, 2), metres
    force: np.ndarray  # (m,), newtons; positive is tension
    reaction: np.ndarray  # (n, 2), newtons, zero where nothing was restrained
    free: np.ndarray  # (2n,) boolean, which degrees of freedom were solved for
    residual: float  # relative residual of the linear solve


def solve(
    geometry: Geometry,
    axial_stiffness: np.ndarray,
    load: np.ndarray,
    restrained: np.ndarray,
) -> Solution:
    """Solve `K u = f` on the free degrees of freedom, and read the forces off the answer.

    ``restrained`` is a `(n, 2)` boolean: True where a joint is held. ``load`` is `(n, 2)` in
    newtons, already assembled — this function does not know about deck loads or self-weight,
    only about the vector they add up to.

    Sign convention on the member force: **positive is tension**, which is the convention an
    engineer states a truss result in, and the one that makes the buckling check read as a
    check on the negative numbers.
    """
    n = geometry.node_count
    free = (geometry.attached[:, None] & ~np.asarray(restrained, dtype=bool)).ravel()
    if not free.any():
        raise ValueError("every joint is restrained; there is nothing to solve for")

    dropped = np.asarray(load, dtype=float).reshape(-1, 2)[~geometry.attached]
    if np.any(dropped != 0.0):
        stray = np.flatnonzero(~geometry.attached & (np.abs(load).sum(axis=1) > 0))
        raise ValueError(
            f"joint {stray[0]} carries a load and no member reaches it, so the load has "
            "nowhere to go; connect it or take the load off"
        )

    k = stiffness(geometry, axial_stiffness)
    kff = k[np.ix_(free, free)]
    ff = np.asarray(load, dtype=float).reshape(-1, 2).ravel()[free]

    _refuse_if_singular(kff, free, n)

    uf = np.linalg.solve(kff, ff)
    scale = np.linalg.norm(ff)
    residual = float(np.linalg.norm(kff @ uf - ff) / scale) if scale > 0 else 0.0

    u = np.zeros(2 * n)
    u[free] = uf
    displacement = u.reshape(n, 2)

    # The reaction is what the supports had to supply: everything the assembled structure
    # demands at a restrained degree of freedom that the applied load did not provide.
    reaction = (k @ u - np.asarray(load, dtype=float).ravel()).reshape(n, 2)
    reaction[~np.asarray(restrained, dtype=bool)] = 0.0

    return Solution(
        displacement=displacement,
        force=member_forces(geometry, axial_stiffness, displacement),
        reaction=reaction,
        free=free,
        residual=residual,
    )


def _refuse_if_singular(kff: np.ndarray, free: np.ndarray, node_count: int) -> None:
    """Raise :class:`Mechanism` when the restrained lattice folds, naming where.

    The eigen-decomposition costs no more than the solve at this size and buys the mode
    shape, which is the difference between "this does not stand up" and "these two joints
    swing". Only the softest mode is reported: a lattice with four mechanisms usually has
    one obvious missing diagonal, and listing every joint in every mode is a wall of numbers
    nobody acts on.
    """
    values, vectors = np.linalg.eigh(kff)
    largest = float(values.max())
    if largest <= 0:
        raise Mechanism(int(kff.shape[0]), [])
    count = int(np.count_nonzero(values < SINGULAR_TOLERANCE * largest))
    if count == 0:
        return

    motion = np.zeros(2 * node_count)
    motion[free] = vectors[:, 0]
    amplitude = np.linalg.norm(motion.reshape(node_count, 2), axis=1)
    worst = [int(index) for index in np.argsort(amplitude)[::-1][:3] if amplitude[index] > 1e-6]
    raise Mechanism(count, worst)


def member_forces(
    geometry: Geometry, axial_stiffness: np.ndarray, displacement: np.ndarray
) -> np.ndarray:
    """Axial force per member, positive in tension.

    The elongation of a bar is the *relative* displacement of its ends projected on its own
    axis — the same projection the element stiffness is built from, which is why this and the
    assembly cannot disagree about a member's direction.
    """
    ends = np.asarray(displacement, dtype=float)[geometry.members]  # (m, 2, 2)
    relative = ends[:, 1, :] - ends[:, 0, :]
    elongation = np.einsum("ij,ij->i", relative, geometry.direction)
    return axial_stiffness / geometry.length * elongation


def joint_residual(geometry: Geometry, force: np.ndarray, load: np.ndarray) -> np.ndarray:
    """What is left over at every joint when the member forces are added to the load.

    The method of joints, vectorised: at each joint the axial forces of the bars meeting
    there and the force applied there must sum to zero. Computed from the **member forces and
    the geometry alone**, so it never touches the displacements or the stiffness matrix and
    is therefore an independent check on both — statics, with no material in it.

    Returns the `(n, 2)` imbalance in newtons. At a restrained joint the reaction is missing
    from it by construction, so a caller compares only the free ones.
    """
    out = np.zeros_like(geometry.nodes)
    contribution = geometry.direction * force[:, None]
    # A bar in tension pulls each of its joints *towards* the other one: away from the first
    # joint along the direction, and back towards the second.
    np.add.at(out, geometry.members[:, 0], contribution)
    np.add.at(out, geometry.members[:, 1], -contribution)
    return out + np.asarray(load, dtype=float).reshape(-1, 2)


def strain_energy(geometry: Geometry, axial_stiffness: np.ndarray, force: np.ndarray) -> float:
    """Energy stored in the bars, ``Σ N²L / 2EA`` — the member-force route."""
    return float(np.sum(force**2 * geometry.length / (2.0 * axial_stiffness)))


def external_work(load: np.ndarray, displacement: np.ndarray) -> float:
    """Work done by the applied load, ``½ fᵀu`` — the displacement route.

    Equal to the strain energy for a linear structure (Clapeyron's theorem). The two routes
    share no arithmetic — one is a sum over bars of a force squared, the other a sum over
    joints of a force times a displacement — so their difference is a real check on the
    assembly rather than a restatement of the solve.
    """
    forces = np.asarray(load, dtype=float)
    motion = np.asarray(displacement, dtype=float)
    return 0.5 * float(np.sum(forces * motion))


def buckling_load(
    axial_stiffness: np.ndarray, area: np.ndarray, length: np.ndarray
) -> np.ndarray:
    """Euler's critical load for each bar, pinned at both ends, in newtons.

    The second moment of area is not a free parameter here: a bar is taken to be a **solid
    circular section** of the stated area, so ``I = A²/4π`` and

        P_cr = π²EI / L² = π E A² / (4 L²)

    That assumption is declared rather than hidden, and it is the conservative end of the
    range — a tube of the same area has a much larger *I* and buckles at a much higher load.
    An exercise that let the section shape float would be an exercise where a compression
    member could be made safe by asserting a better section, which is not a design decision
    a student should be able to make by accident.
    """
    modulus = axial_stiffness / area  # E, recovered rather than passed twice
    return np.pi * modulus * area**2 / (4.0 * length**2)


def self_weight(geometry: Geometry, area: np.ndarray, density: float) -> np.ndarray:
    """Each bar's weight, lumped half onto each of its joints. `(n, 2)` newtons, downward.

    Lumping is exact for the *resultant* and approximate for nothing else that matters here:
    a pin-jointed bar carries no bending, so a distributed weight along it and two half
    weights at its ends produce the same joint equilibrium and the same axial force.
    """
    weight = density * area * geometry.length * GRAVITY
    out = np.zeros_like(geometry.nodes)
    np.add.at(out[:, 1], geometry.members[:, 0], -0.5 * weight)
    np.add.at(out[:, 1], geometry.members[:, 1], -0.5 * weight)
    return out


def mass(geometry: Geometry, area: np.ndarray, density: float) -> float:
    """Total mass of the bars, in kilograms. The budget the mission is set against."""
    return float(np.sum(density * area * geometry.length))
