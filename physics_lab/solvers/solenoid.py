"""The magnetics exercise: what a magnetic design is judged on, and how far to trust it.

Everything between "a magnetostatics solve finished" and "here is the engineering answer".
Kept out of :mod:`physics_lab.solvers.magnetics2d` so it can be tested without a job, a
server or a protocol, and out of :mod:`physics_lab.solvers.magnetics` because a leakage ratio
is a magnet's idea, not a finite-volume method's.

Specification: ``docs/exercises/solenoid.md``. Section numbers in the comments refer to it,
and every metric below exists because §1 named a definition that had to be settled first. The
three that were genuinely ambiguous, and what was decided:

**Where the flux is measured.** On the *mid-plane of the core* — the horizontal line through
the core's centre — because that is where the flux in a solenoid is greatest and where a
designer would place a search coil. The surface spans exactly the core's width, and the flux
across it is computed twice, once from the potential difference between its ends and once by
integrating the reconstructed ``B``. §3's `flux_consistency_rel` is the gap between them.

**Which surface the leakage is measured against.** §1 recorded that two reasonable choices
for the second surface differ by about 10 % on the default geometry, and it was right; the
answer is to use neither. The flux crossing the mid-plane upward is largest at the point
where ``B_y`` changes sign, because past that point the return flux starts cancelling it —
so the outer surface runs to *that* point, and the total is the drop in ``A`` between the two
turning points along the mid-plane, signed the same way as the core flux so the ratio of the
two is a share rather than an accident of which way the coil was wound. Placing the surface
where the integrand vanishes makes the number stationary: move the surface and the answer
changes at second order, which is why this choice does not have to be defended and the other
two do.

**How the saturation number is read.** Not as a peak, and this is where §1's plan did not
survive being run. It expected the peak flux density in the iron to converge once it was
restricted to the core, the whole-domain maximum having been an artefact of the mock solver's
staircase. It does not, and the staircase was never the reason. Refining the interface-fitted
grid gives 0.148, 0.185, 0.230 and 0.290 T for the same magnet at 60, 120, 240 and 480 cells
across, climbing by a steady factor of about 1.25 per halving of the cell — a corner
singularity of the exact solution, not a discretisation error, and the restriction to the
iron does not help because the peak is *always* in the iron: tangential ``H`` is continuous
across the surface, so ``B`` just inside a corner is ``mu_r`` times ``B`` just outside it.

So the pointwise peak is withheld, and the saturation number is ``b_section_max``: the
greatest flux density averaged over a *section* of the core, taken over every section along
it. That is an integral of the field rather than a sample of it, so the singularity has no
weight in it, and it converges — 0.12852, 0.12831, 0.12821, 0.12818 T over the same four
refinements. It is also the quantity a magnetic circuit is actually sized with: iron
saturates when a whole section of it runs out of flux-carrying capacity, not when one corner
does.

What is *not* here is the gap force, and the reason is not that it is hard. The contract's
§7 sets this exercise's challenge in a force across a working air gap, and the cross-section
this page submits has no working gap: a straight bar core between two opposed windings is
symmetric, so the net force on it is exactly zero, and reporting a number for it would be
reporting rounding error. It needs a C-core and an armature — a different cross-section, and
the next increment. See ADR-018.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .magnetics import Field, Grid, Materials

#: Above this flux density in the iron, a constant relative permeability stops describing
#: common soft magnetic steels: the real curve bends over and the incremental permeability
#: collapses towards that of air. Overridable per region through the material key ``b_sat``,
#: because a ferrite saturates nearer 0.4 T and a cobalt-iron nearer 2.3 T, and the protocol's
#: material dict is an open bag of scalars precisely so a solver can read one more key.
DEFAULT_SATURATION = 1.5

#: The outer band of the window whose share of the stored energy says whether the truncation
#: is doing the confining. A twentieth of the shorter edge, on every side.
BOUNDARY_BAND = 0.05

#: Fraction of the stored energy allowed to sit in that band before the window is too small.
BOUNDARY_ENERGY_LIMIT = 0.01


@dataclass(frozen=True)
class Magnet:
    """Which region is the magnetic circuit, and where the exercise measures it.

    Resolved from the geometry rather than declared by the page, so a hand-written payload
    gets the same treatment as the one the sliders build.
    """

    core: int | None  #: index into the region list, or None when nothing is magnetic
    core_name: str | None
    plane_row: int  #: the cell row the reference plane runs along
    plane_y: float
    core_columns: tuple[int, int] | None  #: first and last core cell in that row
    core_width: float


def locate(grid: Grid, materials: Materials, names: list[str], prefer: str | None) -> Magnet:
    """Find the core and the plane the flux is measured on.

    The core is the named region if the caller named one, and otherwise the region with the
    greatest relative permeability — which is what "the core" means, and which stays right
    when the page renames its regions. A geometry with nothing magnetic in it is a coil in
    air; that is a legitimate thing to solve, so it resolves to ``core=None`` and the core
    metrics are withheld rather than computed against the background.
    """
    per_region = []
    for index in range(len(names)):
        cells = materials.region == index
        per_region.append(float(materials.mu_r[cells].max()) if cells.any() else 0.0)

    core: int | None = None
    if prefer is not None and prefer in names:
        core = names.index(prefer)
    elif per_region and max(per_region) > 1.0:
        core = int(np.argmax(per_region))

    if core is None:
        middle = grid.shape[0] // 2
        return Magnet(None, None, middle, float(grid.y[middle]), None, 0.0)

    rows, _ = np.nonzero(materials.region == core)
    centre_y = 0.5 * (grid.y[rows.min()] + grid.y[rows.max()])
    row = int(np.argmin(np.abs(grid.y - centre_y)))

    columns = np.nonzero(materials.region[row] == core)[0]
    if not len(columns):  # pragma: no cover - the plane runs through the core by construction
        return Magnet(core, names[core], row, float(grid.y[row]), None, 0.0)

    first, last = int(columns[0]), int(columns[-1])
    width = float(grid.x_edges[last + 1] - grid.x_edges[first])
    return Magnet(core, names[core], row, float(grid.y[row]), (first, last), width)


@dataclass(frozen=True)
class Metrics:
    """The engineering answer (§1). SI throughout, and per unit depth where 2-D demands it."""

    flux_core: float | None  #: Wb/m, across the core's mid-plane
    #: Wb/m, the whole bundle crossing that plane in one direction, signed like `flux_core`
    flux_total: float | None
    b_mean_core: float | None  #: T, flux_core divided by the core's width
    b_section_max: float | None  #: T, the worst section anywhere along the core
    leakage_ratio: float | None  #: 1, the share of the bundle that misses the iron
    ampere_turns: float  #: A, the current in one sense of the winding
    net_current: float  #: A, which is zero for a coil and not for a wire
    energy: float  #: J/m, stored in the modelled window
    inductance_index: float | None  #: H/m, flux_core / ampere_turns - the circuit's permeance
    b_max: float  #: T, peak |B| in the field — a reduction of it, not the saturation number
    a_max: float  #: Wb/m
    #: m, the two points on the mid-plane where B_y changes sign
    bundle_x: tuple[float, float] | None
    boundary_energy_fraction: float  #: 1, the share of the energy against the outer band


@dataclass(frozen=True)
class Integrals:
    """The intermediate quantities two of the checks compare. Not shown; kept for the report."""

    flux_from_potential: float | None
    flux_from_field: float | None
    energy_from_field: float
    energy_from_sources: float
    circulation_h: float | None  #: A, the contour integral of H.dl
    enclosed_current: float | None  #: A, what Ampere's law says it should equal
    contour: tuple[float, float, float, float] | None


def measure(
    grid: Grid, materials: Materials, solution_a: np.ndarray, field_: Field, magnet: Magnet
) -> tuple[Metrics, Integrals]:
    """Reduce one solve to the metrics and the integrals the checks are made of."""
    area = grid.area
    current = materials.current

    # --- what the winding carries. Exact: no solve is involved, only the geometry (§1).
    ampere_turns = float(np.sum(np.where(current > 0.0, current, 0.0) * area))
    net_current = float(np.sum(current * area))

    # --- energy, both ways round. Equal for a linear medium, and they share the solution and
    # nothing else, which is what makes their gap the headline residual (§3).
    density = field_.bx * field_.hx + field_.by * field_.hy
    energy_field = 0.5 * float(np.sum(density * area))
    energy_source = 0.5 * float(np.sum(solution_a * current * area))

    xmin, ymin, xmax, ymax = grid.bounds
    band = BOUNDARY_BAND * min(xmax - xmin, ymax - ymin)
    xx, yy = grid.centres()
    outer = (
        (xx - xmin < band) | (xmax - xx < band) | (yy - ymin < band) | (ymax - yy < band)
    )
    boundary_fraction = (
        0.5 * float(np.sum((density * area)[outer])) / energy_field if energy_field > 0 else 0.0
    )

    # --- the flux across the core's mid-plane, twice.
    flux_potential: float | None = None
    flux_integrated: float | None = None
    flux_total: float | None = None
    leakage: float | None = None
    bundle: tuple[float, float] | None = None
    b_mean: float | None = None
    b_section: float | None = None

    row = magnet.plane_row
    profile = solution_a[row]
    if magnet.core is not None and magnet.core_columns is not None:
        first, last = magnet.core_columns
        by = field_.by[row]
        # Both routes span exactly the core's width. The potential route walks out to the
        # core's two faces from the end cells' centres, using the reconstructed gradient over
        # the half cell (dA/dx = -B_y); the field route is the midpoint rule over the same
        # interval. Second order each, sharing the solve and nothing else.
        flux_potential = float(
            profile[first]
            - profile[last]
            + 0.5 * grid.hx[first] * by[first]
            + 0.5 * grid.hx[last] * by[last]
        )
        flux_integrated = float(np.sum(by[first : last + 1] * grid.hx[first : last + 1]))

        # The whole flux bundle crossing the plane in one direction: between the maximum of A
        # along it and the minimum, which are the two points where B_y changes sign. Stationary
        # in the surface's position, which is why this and not one of §1's two candidates.
        #
        # Signed the same way as the core flux — left end minus right end — so the ratio of the
        # two is a share and not an accident of which way the current was wound. Taking
        # magnitudes instead would report a leakage of 200 % as -100 %, or the reverse.
        low, high = int(np.argmin(profile)), int(np.argmax(profile))
        left, right = min(low, high), max(low, high)
        bundle = (float(grid.x[left]), float(grid.x[right]))
        flux_total = float(profile[left] - profile[right])
        if flux_total != 0.0 and flux_potential is not None:
            leakage = 1.0 - flux_potential / flux_total

        b_mean = flux_potential / magnet.core_width if magnet.core_width > 0 else None
        b_section = _worst_section(grid, materials, field_, magnet)

    circulation, enclosed, contour = _ampere_check(grid, materials, field_)

    metrics = Metrics(
        flux_core=flux_potential,
        flux_total=flux_total,
        b_mean_core=b_mean,
        b_section_max=b_section,
        leakage_ratio=leakage,
        ampere_turns=ampere_turns,
        net_current=net_current,
        energy=energy_field,
        inductance_index=(
            abs(flux_potential) / ampere_turns
            if flux_potential is not None and ampere_turns > 0
            else None
        ),
        b_max=float(field_.magnitude.max()),
        a_max=float(solution_a.max()),
        bundle_x=bundle,
        boundary_energy_fraction=boundary_fraction,
    )
    integrals = Integrals(
        flux_from_potential=flux_potential,
        flux_from_field=flux_integrated,
        energy_from_field=energy_field,
        energy_from_sources=energy_source,
        circulation_h=circulation,
        enclosed_current=enclosed,
        contour=contour,
    )
    return metrics, integrals


def _worst_section(grid: Grid, materials: Materials, field_: Field, magnet: Magnet) -> float | None:
    """The greatest flux density averaged across a section of the core, over every section.

    One number per row of core cells: the flux crossing that row's section of the core,
    divided by the section's width. The maximum over the rows is where the iron is working
    hardest, and it is where the saturation warning is read — not at the pointwise peak, which
    sits at a corner where the exact field is singular and no refinement settles (see the
    module docstring).

    Rows are taken one at a time rather than assuming a rectangular core, so a stepped or
    tapered core is measured at its own narrowest section rather than at the widest one's
    average.
    """
    in_core = materials.region == magnet.core
    rows = np.nonzero(in_core.any(axis=1))[0]
    best: float | None = None
    for row in rows:
        columns = np.nonzero(in_core[row])[0]
        width = float(grid.x_edges[columns[-1] + 1] - grid.x_edges[columns[0]])
        if width <= 0.0:  # pragma: no cover - a row of core cells always has a width
            continue
        flux = float(np.sum(field_.by[row, columns] * grid.hx[columns]))
        best = max(best, abs(flux) / width) if best is not None else abs(flux) / width
    return best


def _ampere_check(
    grid: Grid, materials: Materials, field_: Field
) -> tuple[float | None, float | None, tuple[float, float, float, float] | None]:
    """Integrate ``H.dl`` around one winding and hand back what it should have been.

    This is §3's conservation balance, and it is a real check rather than an identity because
    of *where* the contour is put. On cell faces the finite-volume equations telescope and the
    balance holds to the linear solver's residual and no further — it would be measuring the
    CG tolerance twice. Run along cell-*centre* lines through the air instead and it measures
    the reconstruction and the quadrature, which is what a caller wants to know.

    The contour is placed halfway between the winding and whatever is nearest it on each side,
    which keeps it in current-free air; the enclosed current is then unambiguous even though
    the contour passes through the middle of a ring of cells.
    """
    positive = materials.current > 0.0
    if not positive.any():
        return None, None, None

    rows, columns = np.nonzero(positive)
    lo_i, hi_i = int(columns.min()), int(columns.max())
    lo_j, hi_j = int(rows.min()), int(rows.max())

    # Halfway out to the nearest other material or the domain edge, in cells. Everything the
    # contour must avoid carries current, so "nearest other material" is measured against the
    # rest of the current map; the core is left inside or outside as the geometry has it,
    # which is fine — iron carries no current and Ampere's law does not care about it.
    others = materials.current != 0.0
    others[positive] = False

    def clearance(axis: int, forward: bool) -> int:
        span = materials.current.shape[axis]
        edge = (hi_i if forward else lo_i) if axis == 1 else (hi_j if forward else lo_j)
        free = span - 1 - edge if forward else edge
        blocked = np.nonzero(others.any(axis=1 - axis))[0]
        if len(blocked):
            beyond = blocked[blocked > edge] if forward else blocked[blocked < edge]
            if len(beyond):
                free = min(free, int(abs((beyond.min() if forward else beyond.max()) - edge)) - 1)
        return max(0, free // 2)

    left, right = lo_i - clearance(1, False), hi_i + clearance(1, True)
    bottom, top = lo_j - clearance(0, False), hi_j + clearance(0, True)
    if right <= left or top <= bottom:  # pragma: no cover - needs a winding touching the wall
        return None, None, None

    x, y = grid.x, grid.y
    xs, ys = x[left : right + 1], y[bottom : top + 1]
    lower = np.trapezoid(field_.hx[bottom, left : right + 1], xs)
    upper = np.trapezoid(field_.hx[top, left : right + 1], xs)
    east = np.trapezoid(field_.hy[bottom : top + 1, right], ys)
    west = np.trapezoid(field_.hy[bottom : top + 1, left], ys)
    circulation = float(lower + east - upper - west)

    inside = np.zeros(materials.current.shape, dtype=bool)
    inside[bottom : top + 1, left : right + 1] = True
    enclosed = float(np.sum((materials.current * grid.area)[inside]))
    contour = (float(x[left]), float(y[bottom]), float(x[right]), float(y[top]))
    return circulation, enclosed, contour


@dataclass
class Verification:
    """Every check, as a number with the tolerance it is read against (§3)."""

    energy_balance_rel: float
    energy_balance_tolerance: float = 0.02
    flux_consistency_rel: float | None = None
    flux_consistency_tolerance: float = 0.02
    ampere_law_rel: float | None = None
    ampere_law_tolerance: float = 0.05
    linear_residual: float = 0.0
    linear_residual_tolerance: float = 1e-9
    flux_convergence_rel: float | None = None
    flux_convergence_tolerance: float = 0.02

    @property
    def passed(self) -> bool:
        checks = [
            self.energy_balance_rel <= self.energy_balance_tolerance,
            self.flux_consistency_rel is None
            or self.flux_consistency_rel <= self.flux_consistency_tolerance,
            self.ampere_law_rel is None or self.ampere_law_rel <= self.ampere_law_tolerance,
            self.linear_residual <= self.linear_residual_tolerance,
            self.flux_convergence_rel is None
            or self.flux_convergence_rel <= self.flux_convergence_tolerance,
        ]
        return all(checks)


def verify(
    integrals: Integrals,
    metrics: Metrics,
    linear_residual: float,
    linear_tolerance: float,
    refined: Metrics | None = None,
) -> Verification:
    """Assemble the residuals.

    ``refined`` is the same problem solved at twice the resolution, when the convergence check
    was asked for. Twice and not half, for the reason the airfoil adapter records: the
    question is whether refining would move the answer, and coarsening asks a harsher one that
    would put a warning on every run made at the defaults.
    """

    def relative(a: float | None, b: float | None, floor: float) -> float | None:
        if a is None or b is None:
            return None
        return abs(a - b) / max(abs(a), floor)

    energy = integrals.energy_from_field
    return Verification(
        energy_balance_rel=(
            abs(energy - integrals.energy_from_sources) / max(abs(energy), 1e-30)
            if energy or integrals.energy_from_sources
            else 0.0
        ),
        flux_consistency_rel=relative(
            integrals.flux_from_potential, integrals.flux_from_field, 1e-12
        ),
        ampere_law_rel=relative(integrals.circulation_h, integrals.enclosed_current, 1e-9),
        linear_residual=linear_residual,
        linear_residual_tolerance=linear_tolerance,
        flux_convergence_rel=(
            None if refined is None else relative(metrics.b_mean_core, refined.b_mean_core, 1e-9)
        ),
    )


def validity(
    metrics: Metrics,
    magnet: Magnet,
    materials: Materials,
    checks: Verification,
    saturation: float,
) -> list[str]:
    """Which stated limits this run crossed, and what crossing each one means (§1).

    Every warning names the threshold and the consequence. "Results are approximate" is not a
    warning; "the core is at 2.1 T, past the 1.5 T where this steel's permeability collapses,
    so the real magnet would carry less flux than this and not more" is.
    """
    out: list[str] = []

    if metrics.b_section_max is not None and metrics.b_section_max > saturation:
        out.append(
            f"The busiest section of the core carries {metrics.b_section_max:.2f} T, past the "
            f"{saturation:.2f} T where this material's permeability collapses towards that of "
            "air. A linear solve keeps returning flux in proportion to the current past that "
            "point and a real core does not, so every number here is an overestimate rather "
            "than an approximation."
        )
    if metrics.boundary_energy_fraction > BOUNDARY_ENERGY_LIMIT:
        out.append(
            f"{100 * metrics.boundary_energy_fraction:.1f} % of the stored energy lies in the "
            f"outer {100 * BOUNDARY_BAND:.0f} % of the window, past the "
            f"{100 * BOUNDARY_ENERGY_LIMIT:.0f} % this exercise allows. A_z = 0 on the outer "
            "edge confines the flux, so a window this tight is holding the field in: the "
            "energy and the leakage are set by the box as much as by the magnet."
        )
    if abs(metrics.net_current) > 1e-6 * max(metrics.ampere_turns, 1.0):
        out.append(
            f"The winding carries a net {metrics.net_current:.1f} A out of the plane. That is "
            "a wire rather than a coil: its field falls off as 1/r instead of closing, and "
            "the A_z = 0 boundary is then doing the work the far field should."
        )
    if not materials.exact:
        out.append(
            "At least one region is not an axis-aligned rectangle, so its boundary is "
            "staircased onto the cells rather than falling on them. The peak flux density in "
            "the iron is a property of that staircase here and will move when the resolution "
            "changes."
        )
    if magnet.core is None:
        out.append(
            "Nothing in this geometry has a relative permeability above 1, so there is no "
            "core: the flux, the mean flux density and the leakage are not reported, because "
            "there is no iron for them to be about. The energy and the ampere-turns still are."
        )
    elif metrics.leakage_ratio is not None and metrics.leakage_ratio > 0.5:
        out.append(
            f"{100 * metrics.leakage_ratio:.0f} % of the flux crossing the mid-plane misses "
            "the core. The iron is not the magnetic circuit at this geometry — it is one path "
            "among several — so the core flux describes less and less of the magnet."
        )
    if not checks.passed:
        if checks.linear_residual > checks.linear_residual_tolerance:
            out.append(
                f"The linear solve stopped at a relative residual of {checks.linear_residual:.1e}, "
                f"short of the {checks.linear_residual_tolerance:.0e} asked for. Raise the "
                "iteration limit: this is an unfinished solve, not a coarse one."
            )
        if checks.energy_balance_rel > checks.energy_balance_tolerance:
            out.append(
                f"The energy computed from the field and the energy computed from the sources "
                f"disagree by {100 * checks.energy_balance_rel:.1f} %. They are equal for a "
                "linear medium and share only the solution, so this is a suspect solve."
            )
        if (
            checks.flux_convergence_rel is not None
            and checks.flux_convergence_rel > checks.flux_convergence_tolerance
        ):
            out.append(
                f"The mean flux density in the core moved "
                f"{100 * checks.flux_convergence_rel:.1f} % when the resolution doubled, past "
                f"the {100 * checks.flux_convergence_tolerance:.0f} % this exercise asks for. "
                "Refine before believing the number."
            )
    return out


def saturation_limit(materials_list: list[dict], core: int | None) -> float:
    """The core's saturation flux density: its own ``b_sat`` if it declares one.

    Read from the geometry rather than taken as a parameter because it is a property of the
    material, and ``regions2d`` already carries material properties. Solvers that do not know
    the key ignore it, which is what the protocol's open material dict is for.
    """
    if core is None or core >= len(materials_list):
        return DEFAULT_SATURATION
    return float(materials_list[core].get("b_sat", DEFAULT_SATURATION))


def mid_plane_curve(grid: Grid, solution_a: np.ndarray, field_: Field, magnet: Magnet) -> dict:
    """A_z and B_y along the reference plane, for the page to plot.

    This one curve carries the whole argument the exercise is about: where A turns over is
    where the flux stops going up, the drop across the core is the core flux, and the drop
    across the whole bundle is what it is being compared with.
    """
    row = magnet.plane_row
    return {
        "a_z": np.column_stack([grid.x, solution_a[row]]).tolist(),
        "b_y": np.column_stack([grid.x, field_.by[row]]).tolist(),
    }


@dataclass
class Report:
    """The whole answer, as the ``report.json`` artifact carries it.

    Shaped like where Fenix Spoon is going rather than like what it can carry today: metrics
    apart from cost, verification as data, validity as its own block. When upstream's issue
    #46 returns metrics natively this becomes the envelope and the artifact goes away
    (ADR-015). Deliberately the same shape as the airfoil's report, so the page's renderers
    are the same code.
    """

    schema: int = 1
    solver: dict = field(default_factory=dict)
    model: dict = field(default_factory=dict)
    geometry: dict = field(default_factory=dict)
    conditions: dict = field(default_factory=dict)
    dimensionless: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    curves: dict = field(default_factory=dict)
    sweep: dict | None = None
    verification: dict = field(default_factory=dict)
    validity: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


__all__ = [
    "BOUNDARY_BAND",
    "BOUNDARY_ENERGY_LIMIT",
    "DEFAULT_SATURATION",
    "Integrals",
    "Magnet",
    "Metrics",
    "Report",
    "Verification",
    "locate",
    "measure",
    "mid_plane_curve",
    "saturation_limit",
    "validity",
    "verify",
]
