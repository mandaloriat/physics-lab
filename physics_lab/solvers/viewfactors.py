"""Two-dimensional view factors by Hottel's crossed-strings construction.

``docs/exercises/heat-sink.md`` §2.2. The heat sink radiates from surfaces that also see *each
other*: two fin flanks facing across a channel exchange radiation directly, and as the channel
narrows they see each other instead of the room. That is one of the two mechanisms which make
§10's curve turn, so the exchange has to be computed rather than approximated by a single
surface-to-ambient coefficient.

**Why this file is exact and short.** In three dimensions a view factor is a double surface
integral, evaluated by quadrature or by ray casting, and it carries a sampling error that has to
be converged like a mesh. In two dimensions it is *algebra*: for two surfaces in a plane with no
obstruction between them, Hottel's construction gives

    F(A -> B) = (crossed strings - uncrossed strings) / (2 |A|)

where the four "strings" are the straight-line distances between the endpoints. No integral, no
quadrature, no sampling. The cross-section of an extrusion is genuinely two-dimensional
(§2 of the exercise), so this is the exact answer rather than a cheap approximation to one.

**Which pair of strings is the crossed one** is the only subtlety, and the robust answer is
algebraic rather than geometric: **the crossed pairing is always the longer one.** That is not a
convenient heuristic — it is forced, because a view factor cannot be negative and
``F = (crossed - uncrossed) / 2|A|``, so the crossed sum is the larger sum by construction.

Deciding it by *geometry* instead — asking which pair of connecting segments intersects — looks
more principled and is wrong at exactly the place this exercise needs it most. A fin flank and
the base strip it stands on share a corner, so their "crossed" strings meet at that corner
rather than properly crossing, and an intersection test rejects both pairings and returns zero
exchange between two surfaces that plainly see each other. The perpendicular-corner case in the
tests is that bug, pinned down.

Collinear surfaces make the two pairings exactly equal, which falls out as ``F = 0`` — correct,
since a flat surface sees nothing of another surface on its own line.

**The obstruction caveat, stated because it is the one way to misuse this module.** The
construction above assumes *B* is fully visible from *A*. Inside one fin channel — a rectangle
bounded by two flanks, the base strip and the open mouth — that holds for every pair, because
the enclosure is convex. Use this across a *non*-convex arrangement, where a fin stands between
two surfaces, and it will silently return the unobstructed answer. :func:`enclosure_residuals`
is the guard: an enclosure whose rows do not sum to one is telling you either that the geometry
is not convex or that a surface is missing from the list.
"""

from dataclasses import dataclass

import numpy as np

#: Surfaces shorter than this (metres) are treated as degenerate and exchange nothing. The one
#: case that produces them is a channel of zero width — a sink whose fins have closed the gap —
#: where the enclosure still gets built but has no mouth left to speak of. Dividing by such a
#: length would return noise scaled by 1e12 rather than the zero the geometry means.
_MIN_LENGTH = 1e-12


@dataclass(frozen=True)
class Surface:
    """One straight boundary element, with the emissivity of the face it belongs to.

    Endpoint order carries no meaning: :func:`view_factor` picks the crossed pairing by string
    length, so a caller may list the ends either way round.
    """

    x1: float
    y1: float
    x2: float
    y2: float
    emissivity: float = 1.0
    #: Free-form tag, so a caller can pull "the left flank" back out of a result array.
    name: str = ""

    @property
    def length(self) -> float:
        return float(np.hypot(self.x2 - self.x1, self.y2 - self.y1))

    @property
    def midpoint(self) -> tuple[float, float]:
        return (0.5 * (self.x1 + self.x2), 0.5 * (self.y1 + self.y2))


def _distance(p: tuple[float, float], q: tuple[float, float]) -> float:
    return float(np.hypot(q[0] - p[0], q[1] - p[1]))


def view_factor(a: Surface, b: Surface) -> float:
    """``F(a -> b)``: the fraction of what leaves *a* diffusely that lands on *b*.

    Assumes an unobstructed line of sight, which is what the convex enclosure of a fin channel
    guarantees. See the module docstring.
    """
    length_a = a.length
    if length_a <= _MIN_LENGTH or b.length <= _MIN_LENGTH:
        return 0.0

    a1, a2 = (a.x1, a.y1), (a.x2, a.y2)
    b1, b2 = (b.x1, b.y1), (b.x2, b.y2)

    pairing_one = _distance(a1, b1) + _distance(a2, b2)
    pairing_two = _distance(a1, b2) + _distance(a2, b1)

    # The crossed pairing is the longer one, necessarily — see the module docstring. Collinear
    # surfaces make the two equal and the difference is zero, which is the right answer rather
    # than a special case.
    crossed = max(pairing_one, pairing_two)
    uncrossed = min(pairing_one, pairing_two)

    return (crossed - uncrossed) / (2.0 * length_a)


def view_factor_matrix(surfaces: list[Surface]) -> np.ndarray:
    """``F[i, j] = F(surfaces[i] -> surfaces[j])``, with a zero diagonal.

    The diagonal is zero by construction rather than by computation: a flat surface cannot see
    itself, and :func:`view_factor` would return zero for it anyway.
    """
    n = len(surfaces)
    matrix = np.zeros((n, n), dtype=float)
    for i, source in enumerate(surfaces):
        for j, target in enumerate(surfaces):
            if i != j:
                matrix[i, j] = view_factor(source, target)
    return matrix


def enclosure_residuals(surfaces: list[Surface], matrix: np.ndarray) -> dict[str, float]:
    """The two algebraic identities every view-factor matrix of a closed enclosure obeys.

    ``docs/exercises/heat-sink.md`` §8 leans on these harder than on any other check in the
    exercise, because they need no reference solution: a matrix that fails either one is wrong,
    and it is wrong at machine precision rather than within a tolerance somebody chose.

    * **Summation** — everything leaving a surface lands somewhere: ``sum_j F[i, j] = 1``.
      A closed enclosure is what makes this true, which is why the channel is closed by a
      fictitious surface across its mouth (§2.2) rather than left open.
    * **Reciprocity** — ``A[i] F[i, j] = A[j] F[j, i]``. In two dimensions the "area" is the
      length, per unit depth.

    Returns the worst absolute residual of each, so a test can assert on a number rather than
    re-derive the identity.
    """
    lengths = np.array([s.length for s in surfaces], dtype=float)
    summation = float(np.max(np.abs(matrix.sum(axis=1) - 1.0))) if len(surfaces) else 0.0
    reciprocity_matrix = lengths[:, None] * matrix - (lengths[:, None] * matrix).T
    reciprocity = float(np.max(np.abs(reciprocity_matrix))) if len(surfaces) else 0.0
    return {"summation": summation, "reciprocity": reciprocity}
