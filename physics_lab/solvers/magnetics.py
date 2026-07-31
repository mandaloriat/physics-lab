"""The magnetostatics method: an edge-aligned finite-volume solve of the vector potential.

Arrays in, arrays out. Nothing here imports Fenix Spoon, knows what a job is, or has an
opinion about what a magnetic design should be judged on — that is
:mod:`physics_lab.solvers.solenoid`'s business, and the protocol is
:mod:`physics_lab.solvers.magnetics2d`'s.

The equation is the usual one for an out-of-plane current density:

    -div( nu grad A_z ) = J_z ,     nu = 1 / (mu_0 mu_r) ,     B = ( dA_z/dy , -dA_z/dx )

with ``A_z = 0`` on the outer boundary.

Why a second magnetostatics discretisation, when upstream ships one
-------------------------------------------------------------------

``mock.magnetostatics2d`` samples the material onto a *uniform* grid, so an iron/air
interface lands wherever the raster puts it — a staircase whose steps move when the
resolution changes. That is fine for a picture of where the flux goes, and it is fatal for a
number: the peak flux density in the core is dominated by the staircase's inside corners, and
it does not converge, because each refinement builds a different set of corners.

The regions this exercise submits are axis-aligned rectangles, so the fix is available and
cheap: **put a grid line on every region edge**. Every cell is then wholly inside one
material, the interface is a face rather than a step, and the refinement path is one that
keeps the geometry fixed while the cells shrink. `docs/exercises/solenoid.md` §1 asks for a
peak flux density in the iron that converges; this is what makes one exist.

Two more things follow from the finite-volume form, and both are used as verification numbers
rather than assumed:

* Face coefficients are the **harmonic mean weighted by the two half-cell widths**, which is
  the discretisation that conserves the normal component of ``B`` across an interface.
* The reconstruction of ``B`` at cell centres averages the *face* quantity ``nu dA/dn``, which
  is the component of ``H`` that is continuous there. Averaging ``dA/dn`` instead would
  average across a genuine jump and put a smear the width of two cells along every interface.

The linear system is symmetric positive definite, and it is solved by matrix-free conjugate
gradients with Jacobi preconditioning: no SciPy, no assembled matrix, and a residual that is
reported rather than hoped for. A 200x200 grid is 40 000 unknowns, which is nothing for CG
and would be a 12 GB dense matrix.
"""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

#: Permeability of free space, H/m. The same constant upstream's solvers and the page use.
MU0 = 4.0e-7 * np.pi

#: Grid lines closer together than this fraction of the shorter domain edge are one line.
#: Region edges that very nearly coincide would otherwise produce a sliver cell whose
#: aspect ratio wrecks the conditioning for no gain in fidelity.
_LINE_TOLERANCE = 1e-9


@dataclass(frozen=True)
class Grid:
    """A tensor-product grid, stored by its cell edges.

    Non-uniform by construction: the edges are whatever it took to land a grid line on every
    material boundary. Everything downstream therefore has to carry cell widths around rather
    than assume a single ``dx``, which is the price of the interfaces being exact.
    """

    x_edges: np.ndarray  #: (nx + 1,) ascending
    y_edges: np.ndarray  #: (ny + 1,) ascending

    @property
    def hx(self) -> np.ndarray:
        return np.diff(self.x_edges)

    @property
    def hy(self) -> np.ndarray:
        return np.diff(self.y_edges)

    @property
    def x(self) -> np.ndarray:
        """Cell-centre abscissae."""
        return 0.5 * (self.x_edges[:-1] + self.x_edges[1:])

    @property
    def y(self) -> np.ndarray:
        return 0.5 * (self.y_edges[:-1] + self.y_edges[1:])

    @property
    def shape(self) -> tuple[int, int]:
        return len(self.y_edges) - 1, len(self.x_edges) - 1

    @property
    def cells(self) -> int:
        ny, nx = self.shape
        return ny * nx

    @property
    def area(self) -> np.ndarray:
        """(ny, nx) cell areas, per unit depth."""
        return np.outer(self.hy, self.hx)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return (
            float(self.x_edges[0]),
            float(self.y_edges[0]),
            float(self.x_edges[-1]),
            float(self.y_edges[-1]),
        )

    def centres(self) -> tuple[np.ndarray, np.ndarray]:
        """Meshgrid of cell centres, ``(xx, yy)``, both (ny, nx)."""
        return np.meshgrid(self.x, self.y)


def graded_widths(length: float, first: float, growth: float) -> np.ndarray:
    """Cell widths spanning ``length`` exactly, starting near ``first`` and growing by ``growth``.

    A geometric progression, then rescaled so the sum is exactly ``length`` — which is the only
    way to have both a whole number of cells and an interval that ends where it was told to.
    The rescaling shrinks the widths slightly, so the first cell is at worst ``first`` and the
    realised ratio is at worst ``growth``: both bounds are one-sided in the safe direction.
    """
    if not np.isfinite(length) or length <= 0:
        return np.zeros(0)
    if growth <= 1.0 + 1e-12 or length <= first:
        count = max(1, int(np.ceil(length / first - 1e-9)))
        return np.full(count, length / count)

    # Smallest n whose geometric sum reaches `length`.
    count = max(1, int(np.ceil(np.log1p(length * (growth - 1.0) / first) / np.log(growth) - 1e-9)))
    widths = first * growth ** np.arange(count)
    return widths * (length / widths.sum())


def axis_lines(
    lo: float,
    hi: float,
    breaks,
    target: float,
    subject: tuple[float, float] | None = None,
    growth: float = 1.0,
) -> np.ndarray:
    """Cell edges from ``lo`` to ``hi`` through every break, none coarser than ``target``.

    Each interval between consecutive breaks is divided into a whole number of cells, so the
    breaks survive exactly and the cell size is at worst ``target`` — never the other way
    round. Making the *cell size* exact instead would put the last cell of each interval
    wherever the arithmetic left it, and the material boundary with it.

    Inside ``subject`` — the span the regions occupy — the count is rounded up to an *odd*
    number. That costs at most one cell per interval and buys something the exercise needs: the
    midpoint of every interval is then a cell centre, so a region's own mid-plane is a row of
    the grid rather than half a cell away from one. That is where the flux is measured
    (``docs/exercises/solenoid.md`` §1), and measuring it on a plane the grid does not have
    would put an avoidable half-cell offset into every number derived from it.

    **Outside** ``subject`` the cells grow geometrically, away from it. That is what makes a
    window eight times the size of the magnet affordable: the far field is smooth and mostly
    empty, and spending the same cell size on it as on the iron/air interface would be spending
    ninety per cent of the grid where nothing happens. With ``growth = 1.2`` the 210 mm of air
    beyond the default magnet costs 23 cells instead of 280. Pass ``growth = 1.0``, or no
    ``subject``, for a uniform grid.
    """
    span = hi - lo
    if span <= 0:
        raise ValueError("axis bounds must be increasing")
    inner = _LINE_TOLERANCE * span
    keep = sorted({float(b) for b in breaks if lo + inner < b < hi - inner})
    low, high = subject if subject is not None else (lo, hi)

    edges: list[np.ndarray] = []
    stations = [lo, *keep, hi]
    for left, right in zip(stations[:-1], stations[1:], strict=False):
        if right <= low + inner:  # out in the air, fine end on the right
            widths = graded_widths(right - left, target, growth)[::-1]
        elif left >= high - inner:  # out in the air, fine end on the left
            widths = graded_widths(right - left, target, growth)
        else:  # across the magnet: uniform, and an odd count so the midpoint is a cell centre
            count = max(1, int(np.ceil((right - left) / target - 1e-9)))
            count += count % 2 == 0
            widths = np.full(count, (right - left) / count)
        edges.append(left + np.concatenate([[0.0], np.cumsum(widths)])[:-1])
    return np.append(np.concatenate(edges), hi)


def build_grid(bounds, outlines, resolution: int, growth: float = 1.0) -> Grid:
    """A grid whose lines include every vertex coordinate of every region.

    ``resolution`` counts cells across the **regions**, not across the window: it is the longer
    edge of their common bounding box that is divided that many ways. That is the definition
    that means what a caller wants it to mean — the magnet is what has to be resolved, and the
    window around it is a truncation whose size should not change how finely the iron is
    modelled. Counting across the window instead (which is what ``mock.magnetostatics2d`` does,
    and what this solver did first) couples the two, so widening the window to control the
    truncation silently coarsens the magnet. It was measured doing exactly that: at a window
    eight times the magnet, a resolution that had been ample gave two cells across the core and
    an energy balance out by 11 %.

    Taking every vertex coordinate rather than only rectangle edges means a non-rectangular
    region still gets grid lines at its extremes; it does not make such a region exact, and
    :func:`rasterise` reports that separately so the page can say so.
    """
    xmin, ymin, xmax, ymax = (float(v) for v in bounds)
    xs = [float(p[0]) for outline in outlines for p in outline]
    ys = [float(p[1]) for outline in outlines for p in outline]
    if not xs or not ys:
        # No regions: nothing to resolve but the window itself, and nothing to grade away from.
        target = max(xmax - xmin, ymax - ymin) / max(int(resolution), 1)
        return Grid(
            x_edges=axis_lines(xmin, xmax, [], target),
            y_edges=axis_lines(ymin, ymax, [], target),
        )

    subject_x = (min(xs), max(xs))
    subject_y = (min(ys), max(ys))
    target = max(subject_x[1] - subject_x[0], subject_y[1] - subject_y[0]) / max(
        int(resolution), 1
    )
    return Grid(
        x_edges=axis_lines(xmin, xmax, xs, target, subject_x, growth),
        y_edges=axis_lines(ymin, ymax, ys, target, subject_y, growth),
    )


def polygon_mask(outline: np.ndarray, xx: np.ndarray, yy: np.ndarray) -> np.ndarray:
    """Even-odd point-in-polygon over a meshgrid, vectorised.

    Cell *centres* are tested, and the grid was built so that no centre lies on a region
    edge — every edge is a cell face — so the classic on-the-boundary ambiguity of this test
    cannot arise for the axis-aligned regions this exercise submits.
    """
    points = outline.astype(float)
    inside = np.zeros(xx.shape, dtype=bool)
    x0, y0 = points[:, 0], points[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    for ax, ay, bx, by in zip(x0, y0, x1, y1, strict=True):
        if ay == by:
            continue
        straddles = (ay > yy) != (by > yy)
        crossing = ax + (yy - ay) * (bx - ax) / (by - ay)
        inside ^= straddles & (xx < crossing)
    return inside


def is_axis_aligned_rectangle(outline: np.ndarray) -> bool:
    """True when an outline is a rectangle with sides parallel to the axes.

    Which is the case the grid resolves exactly. Anything else is still solved, and still
    staircased at the cell centres, and the difference is worth a warning rather than
    silence.
    """
    points = np.asarray(outline, dtype=float)
    if len(points) != 4:
        return False
    xs, ys = np.unique(points[:, 0]), np.unique(points[:, 1])
    return len(xs) == 2 and len(ys) == 2


@dataclass(frozen=True)
class Materials:
    """What each cell is made of, and what it carries."""

    mu_r: np.ndarray  #: (ny, nx) relative permeability
    current: np.ndarray  #: (ny, nx) J_z, A/m^2
    region: np.ndarray  #: (ny, nx) index into the region list, -1 for the background
    exact: bool  #: every region was an axis-aligned rectangle, so no cell straddles a material

    @property
    def nu(self) -> np.ndarray:
        """Reluctivity, 1/(mu_0 mu_r)."""
        return 1.0 / (MU0 * np.maximum(self.mu_r, 1e-12))


def rasterise(grid: Grid, outlines, materials, background: dict) -> Materials:
    """Assign a material to every cell, later regions winning where they nest.

    Painter's order is the protocol's rule for ``regions2d`` — "later entries in the list
    win" — so an iron core listed after the coil that surrounds it comes out as iron.
    """
    xx, yy = grid.centres()
    mu_r = np.full(grid.shape, float(background.get("mu_r", 1.0)))
    current = np.full(grid.shape, float(background.get("current_density", 0.0)))
    region = np.full(grid.shape, -1, dtype=np.int64)
    exact = True

    for index, (outline, material) in enumerate(zip(outlines, materials, strict=True)):
        points = np.asarray(outline, dtype=float)
        exact = exact and is_axis_aligned_rectangle(points)
        mask = polygon_mask(points, xx, yy)
        mu_r[mask] = float(material.get("mu_r", 1.0))
        current[mask] = float(material.get("current_density", 0.0))
        region[mask] = index

    return Materials(mu_r=mu_r, current=current, region=region, exact=exact)


def face_conductance(grid: Grid, nu: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Face coefficients, ``(cx, cy)``, shaped (ny, nx+1) and (ny+1, nx).

    ``cx[j, i]`` is the coefficient of the face on the *west* side of cell ``(j, i)``, so
    column ``0`` and column ``nx`` are the boundary faces. The interior coefficient is the
    series combination of the two half-cells,

        c = L / ( h_W / (2 nu_W) + h_E / (2 nu_E) ) ,

    which is the harmonic mean weighted by the half-widths rather than the plain harmonic
    mean — the two agree only on a uniform grid, and this grid is not uniform anywhere near
    a material boundary, which is precisely where the difference matters.

    The boundary faces see a half-cell of the interior material against ``A = 0``, which is
    the Dirichlet condition written as a face rather than as a row of ghost cells.
    """
    hx, hy = grid.hx, grid.hy
    ny, nx = grid.shape

    resist_x = hx[None, :] / (2.0 * nu)  # half-cell reluctance per unit face length
    cx = np.empty((ny, nx + 1))
    cx[:, 1:-1] = hy[:, None] / (resist_x[:, :-1] + resist_x[:, 1:])
    cx[:, 0] = hy / resist_x[:, 0]
    cx[:, -1] = hy / resist_x[:, -1]

    resist_y = hy[:, None] / (2.0 * nu)
    cy = np.empty((ny + 1, nx))
    cy[1:-1, :] = hx[None, :] / (resist_y[:-1, :] + resist_y[1:, :])
    cy[0, :] = hx / resist_y[0, :]
    cy[-1, :] = hx / resist_y[-1, :]

    return cx, cy


@dataclass(frozen=True)
class Solution:
    """One converged (or not) solve, and the numbers that say which."""

    a: np.ndarray  #: (ny, nx) vector potential at cell centres, Wb/m
    iterations: int
    residual: float  #: ||K a - b|| / ||b||, the number the tolerance is read against
    converged: bool


def solve_potential(
    grid: Grid,
    materials: Materials,
    tolerance: float = 1e-10,
    max_iterations: int = 20000,
    on_iteration: Callable[[int, float], None] | None = None,
) -> Solution:
    """Preconditioned conjugate gradients on the finite-volume system.

    The operator is symmetric and positive definite — it is a weighted graph Laplacian with a
    Dirichlet boundary — so CG is the right method and needs no assembled matrix: one
    application is four shifted multiplies. Jacobi preconditioning is worth its cost here
    because the diagonal spans the permeability contrast, four decades of it in the cases
    this page runs.

    ``on_iteration`` is called every few sweeps with ``(iteration, relative residual)``; it is
    where the adapter hangs progress reporting and cancellation, so it may raise.
    """
    cx, cy = face_conductance(grid, materials.nu)
    diag = cx[:, :-1] + cx[:, 1:] + cy[:-1, :] + cy[1:, :]
    rhs = materials.current * grid.area

    def apply(field: np.ndarray) -> np.ndarray:
        out = diag * field
        out[:, 1:] -= cx[:, 1:-1] * field[:, :-1]
        out[:, :-1] -= cx[:, 1:-1] * field[:, 1:]
        out[1:, :] -= cy[1:-1, :] * field[:-1, :]
        out[:-1, :] -= cy[1:-1, :] * field[1:, :]
        return out

    scale = float(np.linalg.norm(rhs))
    a = np.zeros(grid.shape)
    if scale == 0.0:
        # No current anywhere: A = 0 solves it exactly, and CG would divide by zero proving
        # so. Worth handling rather than guarding against, because "the coil is off" is a
        # legitimate thing to submit.
        return Solution(a=a, iterations=0, residual=0.0, converged=True)

    r = rhs.copy()
    z = r / diag
    p = z.copy()
    rz = float(np.sum(r * z))
    residual = 1.0
    iteration = 0

    for iteration in range(1, max_iterations + 1):
        ap = apply(p)
        curvature = float(np.sum(p * ap))
        if curvature <= 0.0:  # pragma: no cover - SPD, so unreachable without a bug above
            break
        alpha = rz / curvature
        a += alpha * p
        r -= alpha * ap
        residual = float(np.linalg.norm(r)) / scale
        if on_iteration is not None and iteration % 25 == 0:
            on_iteration(iteration, residual)
        if residual <= tolerance:
            break
        z = r / diag
        rz_next = float(np.sum(r * z))
        p = z + (rz_next / rz) * p
        rz = rz_next

    return Solution(a=a, iterations=iteration, residual=residual, converged=residual <= tolerance)


@dataclass(frozen=True)
class Field:
    """The reconstructed field at cell centres, in both of its forms."""

    bx: np.ndarray
    by: np.ndarray
    hx: np.ndarray  #: H_x, A/m
    hy: np.ndarray

    @property
    def magnitude(self) -> np.ndarray:
        return np.hypot(self.bx, self.by)


def flux_density(grid: Grid, materials: Materials, a: np.ndarray) -> Field:
    """Reconstruct ``B`` and ``H`` at cell centres from the face fluxes.

    ``H`` is averaged, not ``B``, and that is the whole point of doing this by hand rather
    than calling ``np.gradient``. Across a vertical iron/air face the tangential field
    strength ``H_y`` is continuous while ``B_y`` jumps by the permeability ratio; averaging
    ``B`` across such a face produces a value that belongs to neither material and smears the
    interface over two cells. Averaging ``H`` and multiplying by the cell's own permeability
    keeps each cell's value inside its own material.

    The face quantity CG already has is ``c (A_P - A_N)``, which is ``nu dA/dn`` times the
    face length, so dividing by the face length recovers exactly the continuous component.
    """
    cx, cy = face_conductance(grid, materials.nu)
    ny, nx = grid.shape

    # q_x = nu dA/dx = -H_y on the vertical faces; the boundary faces see A = 0 outside.
    qx = np.empty((ny, nx + 1))
    qx[:, 1:-1] = cx[:, 1:-1] * (a[:, 1:] - a[:, :-1]) / grid.hy[:, None]
    qx[:, 0] = cx[:, 0] * (a[:, 0] - 0.0) / grid.hy
    qx[:, -1] = cx[:, -1] * (0.0 - a[:, -1]) / grid.hy

    # q_y = nu dA/dy = H_x on the horizontal faces.
    qy = np.empty((ny + 1, nx))
    qy[1:-1, :] = cy[1:-1, :] * (a[1:, :] - a[:-1, :]) / grid.hx[None, :]
    qy[0, :] = cy[0, :] * (a[0, :] - 0.0) / grid.hx
    qy[-1, :] = cy[-1, :] * (0.0 - a[-1, :]) / grid.hx

    h_x = 0.5 * (qy[:-1, :] + qy[1:, :])
    h_y = -0.5 * (qx[:, :-1] + qx[:, 1:])
    nu = materials.nu
    return Field(bx=h_x / nu, by=h_y / nu, hx=h_x, hy=h_y)


def sample_uniform(grid: Grid, values: np.ndarray, nx: int, ny: int) -> np.ndarray:
    """Nearest-cell resampling of a cell field onto a uniform ``ny x nx`` raster.

    Nearest rather than interpolated, deliberately: the raster is what the viewer draws, and
    a bilinear resampling of the material map would invent permeabilities between 1 and 1000
    along every interface — the exact artefact this discretisation exists to avoid. Piecewise
    constant shows the cells the answer was actually computed on.
    """
    xmin, ymin, xmax, ymax = grid.bounds
    xs = np.linspace(xmin, xmax, nx)
    ys = np.linspace(ymin, ymax, ny)
    ix = np.clip(np.searchsorted(grid.x_edges, xs, side="right") - 1, 0, grid.shape[1] - 1)
    iy = np.clip(np.searchsorted(grid.y_edges, ys, side="right") - 1, 0, grid.shape[0] - 1)
    return values[np.ix_(iy, ix)]
