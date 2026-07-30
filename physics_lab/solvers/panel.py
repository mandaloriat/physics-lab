"""Hess–Smith panel method: the numerical core of the airfoil exercise.

Constant-strength source panels plus one vortex strength shared by every panel, closed by
the Kutta condition at the trailing edge. That is the classical formulation whose unknown
count is exactly ``N + 1`` and whose closing equation is the one piece of physics the lab's
previous potential-flow model was missing — see
``docs/exercises/airfoil.md`` §6.1 and ADR-014.

Nothing here imports Fenix Spoon. This module is arrays in, arrays out, so the verification
suite can drive it with a circle or a Joukowski profile — geometries the exercise itself
never offers — and so the same functions can be reused by a viscous level later.

Conventions, stated once because every sign in the file depends on them:

* Nodes go **clockwise** around the outline, first point repeated as the last. With that
  ordering the panel normal ``n = (-t_y, t_x)`` points *out* of the body, into the fluid.
* Panel-local coordinates are ``p`` along the panel tangent from its first node and ``q``
  along that outward normal.
* Every influence coefficient is evaluated as the limit **from outside** the sheet, which is
  what makes ``beta`` exactly ``pi`` on the diagonal.
* ``circulation`` is measured *along the traversal direction*, i.e. clockwise. In that sign
  Kutta–Joukowski reads ``L' = rho * u_inf * circulation`` with no minus sign, and a lifting
  profile at positive incidence has positive circulation.
"""

from dataclasses import dataclass

import numpy as np

TWO_PI = 2.0 * np.pi


@dataclass(frozen=True)
class PanelGeometry:
    """A panelled outline: the nodes, and everything derived from them once."""

    nodes: np.ndarray  #: (N+1, 2), clockwise, closed
    control: np.ndarray  #: (N, 2) panel midpoints
    tangent: np.ndarray  #: (N, 2) unit tangents, traversal direction
    normal: np.ndarray  #: (N, 2) unit normals, outward
    length: np.ndarray  #: (N,) panel lengths

    @property
    def count(self) -> int:
        return len(self.length)

    @property
    def perimeter(self) -> float:
        return float(self.length.sum())


@dataclass(frozen=True)
class PanelSolution:
    """What one solve produced, in the frame the geometry was given in."""

    geometry: PanelGeometry
    u_inf: float
    alpha: float  #: radians, free-stream direction relative to the +x axis
    source: np.ndarray  #: (N,) constant source strength per panel
    vortex: float  #: the one vortex strength shared by every panel
    surface_speed: np.ndarray  #: (N,) tangential velocity at each control point
    cp: np.ndarray  #: (N,) pressure coefficient at each control point
    circulation: float
    """Clockwise-positive circulation, taken from the vortex strength: ``-gamma * perimeter``.

    That is the *exact* circulation of the discrete solution, because a source sheet carries
    none and the vortex sheet carries all of it, so any circuit enclosing the body sees
    exactly the total vortex strength. Integrating the surface velocity instead
    (:attr:`circulation_surface`) approximates the same number with the midpoint rule, and on
    a cusped trailing edge it is measurably worse. Both are kept: their agreement is one of
    the verification residuals the page reports.
    """
    circulation_surface: float  #: the same quantity as ``sum(u_t * ds)`` around the outline

    @property
    def free_stream(self) -> np.ndarray:
        return self.u_inf * np.array([np.cos(self.alpha), np.sin(self.alpha)])


def panel_geometry(nodes: np.ndarray) -> PanelGeometry:
    """Derive the panel frame from a closed, clockwise outline.

    Raises rather than repairing: an outline that is not closed, or that has a zero-length
    panel, is a bug in whatever produced it, and a solver that quietly fixes its input is a
    solver whose answer cannot be traced back to a geometry.
    """
    xy = np.asarray(nodes, dtype=float)
    if xy.ndim != 2 or xy.shape[1] != 2 or len(xy) < 4:
        raise ValueError(f"expected a closed outline of at least 3 panels, got {xy.shape}")
    if not np.allclose(xy[0], xy[-1]):
        raise ValueError("outline is not closed: the last node must repeat the first")

    delta = np.diff(xy, axis=0)
    length = np.hypot(delta[:, 0], delta[:, 1])
    if np.any(length <= 0.0):
        raise ValueError(f"panel {int(np.argmin(length))} has zero length")

    tangent = delta / length[:, None]
    normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
    control = 0.5 * (xy[:-1] + xy[1:])
    return PanelGeometry(xy, control, tangent, normal, length)


def _local_coordinates(
    points: np.ndarray, geo: PanelGeometry
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """``(log(r1/r2), beta, ...)`` for every (point, panel) pair.

    ``beta`` is the angle the panel subtends at the point, signed by which side of the panel
    the point is on. Computed as one ``arctan2`` of the cross and dot products of the two
    node-to-point vectors, which stays continuous as a point crosses the panel's line
    outside the panel itself — the pairwise ``arctan2`` difference does not.
    """
    rel = points[:, None, :] - geo.nodes[None, :-1, :]
    p = rel[..., 0] * geo.tangent[None, :, 0] + rel[..., 1] * geo.tangent[None, :, 1]
    q = rel[..., 0] * geo.normal[None, :, 0] + rel[..., 1] * geo.normal[None, :, 1]
    s = geo.length[None, :]

    r1 = np.hypot(p, q)
    r2 = np.hypot(p - s, q)
    with np.errstate(divide="ignore", invalid="ignore"):
        ln = np.log(np.where(r2 > 0, r1 / np.where(r2 > 0, r2, 1.0), 1.0))
    beta = np.arctan2(q * s, p * (p - s) + q * q)
    return ln, beta, q


def _influence(
    points: np.ndarray, geo: PanelGeometry, on_surface: bool
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Velocity at ``points`` per unit source strength and per unit vortex strength.

    Returns ``(source_x, source_y, vortex_x, vortex_y)``, each ``(len(points), N)``.

    The potentials are the textbook ones for a straight sheet of constant strength; both are
    written from the same two integrals so the pair cannot drift apart:

        source:  u_p = ln(r1/r2) / 2pi ,  u_q =  beta / 2pi
        vortex:  u_p =    -beta   / 2pi ,  u_q =  ln(r1/r2) / 2pi

    ``on_surface`` says the points *are* the control points, in which case the diagonal is
    the sheet's own singular contribution and is set to its outside limit exactly:
    ``beta = pi`` (so a source sheet induces ``+sigma/2`` outward and a vortex sheet
    ``-gamma/2`` along the traversal direction). Left to floating point, a ``q`` that came
    out as ``-0.0`` would flip that ``pi`` to ``-pi`` and silently invert the body's own
    boundary condition.
    """
    ln, beta, _ = _local_coordinates(points, geo)
    if on_surface:
        if ln.shape[0] != ln.shape[1]:
            raise ValueError("on_surface influence needs one point per panel")
        np.fill_diagonal(ln, 0.0)
        np.fill_diagonal(beta, np.pi)

    tx, ty = geo.tangent[:, 0][None, :], geo.tangent[:, 1][None, :]
    nx, ny = geo.normal[:, 0][None, :], geo.normal[:, 1][None, :]

    source_x = (ln * tx + beta * nx) / TWO_PI
    source_y = (ln * ty + beta * ny) / TWO_PI
    vortex_x = (-beta * tx + ln * nx) / TWO_PI
    vortex_y = (-beta * ty + ln * ny) / TWO_PI
    return source_x, source_y, vortex_x, vortex_y


def solve(
    nodes: np.ndarray,
    u_inf: float,
    alpha: float,
    circulation: float | None = None,
) -> PanelSolution:
    """Solve one incidence. See :func:`solve_sweep` for the arguments' meaning."""
    return solve_sweep(nodes, u_inf, [alpha], circulation)[0]


def solve_sweep(
    nodes: np.ndarray,
    u_inf: float,
    alphas: "list[float] | np.ndarray",
    circulation: float | None = None,
) -> list[PanelSolution]:
    """Solve several incidences on one geometry, assembling and factorising **once**.

    This is the property the exercise is built on. The influence matrix depends on the
    geometry and the panelling and on nothing else — incidence enters only through the
    right-hand side — so a fifteen-point incidence sweep costs one factorisation and fifteen
    back-substitutions. That is why an aerodynamic centre, which cannot be had from a single
    solve, still costs a single job on a server with an hourly quota
    (``docs/exercises/airfoil.md`` §7.3, ADR-010).

    ``circulation`` selects the model rather than a numerical detail, which is why it is a
    physical argument here and a model selector on the page (ADR-014):

    * ``None`` — free, determined by the **Kutta condition**: equal tangential speed at the
      control points of the two panels meeting at the trailing edge, which in traversal
      coordinates reads ``u_t(first) = -u_t(last)``. This is the lifting model.
    * ``0.0`` — no circulation. Reproduces exactly the model the lab shipped before, whose
      lift is zero at every incidence, and which is kept as a demonstration of why.
    * any other value — prescribed clockwise circulation. No trailing edge is needed, so a
      circular cylinder with known circulation becomes a testable case.

    The system is dense and its size is ``N + 1``; at the exercise's default of 160 panels a
    factorisation is microseconds.
    """
    geo = panel_geometry(nodes)
    n = geo.count
    angles = np.atleast_1d(np.asarray(alphas, dtype=float))

    sx, sy, vx, vy = _influence(geo.control, geo, on_surface=True)
    # Project onto each control point's own normal and tangent.
    an = sx * geo.normal[:, 0][:, None] + sy * geo.normal[:, 1][:, None]
    at = sx * geo.tangent[:, 0][:, None] + sy * geo.tangent[:, 1][:, None]
    bn = (vx * geo.normal[:, 0][:, None] + vy * geo.normal[:, 1][:, None]).sum(axis=1)
    bt = (vx * geo.tangent[:, 0][:, None] + vy * geo.tangent[:, 1][:, None]).sum(axis=1)

    stream = u_inf * np.column_stack([np.cos(angles), np.sin(angles)])  # (M, 2)
    stream_n = stream @ geo.normal.T  # (M, N)
    stream_t = stream @ geo.tangent.T

    if circulation is None:
        matrix = np.zeros((n + 1, n + 1))
        matrix[:n, :n] = an
        matrix[:n, n] = bn
        # The Kutta condition, and the only equation in the system that is not tangency.
        matrix[n, :n] = at[0, :] + at[-1, :]
        matrix[n, n] = bt[0] + bt[-1]

        rhs = np.zeros((n + 1, len(angles)))
        rhs[:n, :] = -stream_n.T
        rhs[n, :] = -(stream_t[:, 0] + stream_t[:, -1])
        unknowns = np.linalg.solve(matrix, rhs)  # one factorisation, M right-hand sides
        source, vortex = unknowns[:n, :].T, unknowns[n, :]
    else:
        # A vortex sheet of uniform strength carries total vortex strength gamma * perimeter,
        # and a source sheet carries none, so prescribing the circulation prescribes gamma
        # directly. The sign follows the outside limit above: u_t = -gamma/2 along the
        # traversal direction, so clockwise-positive circulation needs a negative gamma.
        vortex = np.full(len(angles), -float(circulation) / geo.perimeter)
        source = np.linalg.solve(an, -(stream_n + np.outer(vortex, bn)).T).T

    speed = stream_t + source @ at.T + np.outer(vortex, bt)
    return [
        PanelSolution(
            geometry=geo,
            u_inf=float(u_inf),
            alpha=float(angle),
            source=source[k],
            vortex=float(vortex[k]),
            surface_speed=speed[k],
            cp=1.0 - (speed[k] / u_inf) ** 2,
            circulation=float(-vortex[k] * geo.perimeter),
            circulation_surface=float(np.sum(speed[k] * geo.length)),
        )
        for k, angle in enumerate(angles)
    ]


#: Field points evaluated per pass. The influence arrays are (points × panels), so a 192²
#: sampling grid against 240 panels would allocate about 340 MB in one go — on a worker with
#: a 2 GB ceiling (ADR-005) that is a real risk for no gain, since the sum over panels is
#: exact whatever order it is accumulated in.
_CHUNK = 4096


def velocity_at(points: np.ndarray, solution: PanelSolution) -> np.ndarray:
    """The velocity the solution induces at arbitrary points, free stream included.

    A matrix-free superposition over panels, so sampling a field costs one pass and no second
    solve. Points *on* the outline are not special-cased: a caller sampling a grid masks the
    interior instead, because a point inside the body is not in the flow at all.
    """
    pts = np.atleast_2d(np.asarray(points, dtype=float))
    stream = solution.free_stream
    out = np.empty_like(pts)
    for start in range(0, len(pts), _CHUNK):
        block = pts[start : start + _CHUNK]
        sx, sy, vx, vy = _influence(block, solution.geometry, on_surface=False)
        out[start : start + _CHUNK, 0] = (
            stream[0] + sx @ solution.source + vx.sum(axis=1) * solution.vortex
        )
        out[start : start + _CHUNK, 1] = (
            stream[1] + sy @ solution.source + vy.sum(axis=1) * solution.vortex
        )
    return out


def inside(points: np.ndarray, outline: np.ndarray) -> np.ndarray:
    """Even-odd point-in-polygon test, vectorised over points.

    The same rule as upstream's ``polygon_mask``, kept here because this module must not
    import Fenix Spoon (and because the outline arrives closed, with a repeated last node).
    """
    pts = np.atleast_2d(np.asarray(points, dtype=float))
    poly = np.asarray(outline, dtype=float)
    if np.allclose(poly[0], poly[-1]):
        poly = poly[:-1]
    x, y = pts[:, 0], pts[:, 1]
    result = np.zeros(len(pts), dtype=bool)
    px, py = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        denom = py[j] - py[i]
        if denom == 0.0:
            denom = 1e-30
        crosses = (py[i] > y) != (py[j] > y)
        x_at = (px[j] - px[i]) * (y - py[i]) / denom + px[i]
        result ^= crosses & (x < x_at)
        j = i
    return result
