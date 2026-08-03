"""The bridge exercise: what a truss is judged on, and how far to trust it.

Everything between "a stiffness solve finished" and "here is the engineering answer". Kept
out of :mod:`physics_lab.solvers.truss2d` so it can be tested without a job, a server or a
protocol, and out of :mod:`physics_lab.solvers.truss` because a utilisation ratio is a
designer's idea, not the direct stiffness method's.

Specification: ``docs/exercises/truss.md``.

Three definitions had to be settled before any of it could be reported, and each is the kind
of choice that looks arbitrary until the alternative is tried:

**What "loaded" means on a stretch rather than at a joint.** A point load at a joint is
unambiguous. A load *along* a member is not: it is a force per unit length, and a pin-jointed
bar cannot carry the bending that a genuinely distributed load would produce. So a stretch
load here is **lumped to the joints at its ends**, half each, which is exact for the joint
equilibrium and exact for the axial force, and says nothing about the bending in the bar
because the model has none. A deck that must be checked for bending is a beam problem and a
different exercise; what this one answers is where the load goes once it reaches the joints.

**How capacity is defined in compression.** Not by yield. A slender steel bar buckles at a
fraction of its squash load — a 4 m bar of 1000 mm² solid section goes at about 10 kN against
a 250 kN yield — so a utilisation measured against yield would report 4 % on a member that has
already failed. Capacity in compression is therefore the *lesser* of yield and the Euler load,
and the exercise's headline number is the ratio to that. It is the single reason a long
diagonal is a bad idea, and reporting it any other way hides the most important thing a truss
teaches.

**What the deflection is measured against.** The span between the supports, not the length of
the longest member and not the site width. `span_ratio` is deflection over that span, which is
the form every bridge code states its serviceability limit in, and it is what makes two
lattices of different sizes comparable at all.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .truss import (
    GRAVITY,
    Geometry,
    Solution,
    buckling_load,
    external_work,
    joint_residual,
    mass,
    self_weight,
    strain_energy,
)

#: Condition keys this exercise reads from a load case. Declared to the protocol by the
#: adapter; kept here because the meaning of each is the exercise's, not the protocol's.
CONDITION_KEYS = ("fixed_x", "fixed_y", "force_x", "force_y", "load_x", "load_y")

#: Fraction of the span past which the small-displacement assumption is worth a warning.
#:
#: One per cent, and chosen rather than inherited. First-order truss theory writes equilibrium
#: on the *undeformed* geometry; the error in doing so grows with the square of the rotation,
#: so at a span/100 deflection the direction cosines are wrong in the fourth digit and at a
#: span/10 they are wrong in the second. A bridge deflecting a hundredth of its span is also
#: far outside anything a code would accept, so the number is a modelling limit and a
#: serviceability one at the same time.
LARGE_DISPLACEMENT_RATIO = 0.01

#: Share of the applied load above which switching self-weight off is worth saying out loud.
SELF_WEIGHT_SHARE = 0.1


@dataclass(frozen=True)
class Section:
    """What every bar is made of and shaped like. One section for the whole lattice.

    Deliberately not per member. Letting each bar carry its own area turns the exercise into
    an optimisation with a hundred variables and no way to reason about the answer; one
    section and a free topology is the version where a visitor can see *why* a diagonal
    helped. The area is still a design variable — it is simply one, not a hundred.
    """

    area: float  # m²
    modulus: float  # Pa
    density: float  # kg/m³
    yield_strength: float  # Pa
    safety_factor: float

    def axial_stiffness(self, count: int) -> np.ndarray:
        """EA per member, as the array :mod:`physics_lab.solvers.truss` wants."""
        return np.full(count, self.modulus * self.area)

    def areas(self, count: int) -> np.ndarray:
        return np.full(count, self.area)


@dataclass(frozen=True)
class Selection:
    """One named boundary, already resolved against the joints.

    The protocol's half of this — turning `{"type": "box", …}` into a mask — is
    :func:`fenixspoon.boundaries.predicate`, and it happens in the adapter. What arrives here
    is the mask and the scalars in force on it, so nothing in this module knows what a
    selector is.
    """

    name: str
    joints: np.ndarray  # (n,) boolean over the lattice's joints
    values: dict[str, float]


@dataclass(frozen=True)
class Applied:
    """The load vector and the restraints, plus what each named boundary actually caught."""

    load: np.ndarray  # (n, 2) newtons
    restrained: np.ndarray  # (n, 2) boolean
    weight: np.ndarray  # (n, 2) newtons, the self-weight part of `load`
    resolved: dict  # boundary name -> {"joints": [...], "members": [...], "values": {...}}

    @property
    def imposed(self) -> np.ndarray:
        """The load without its self-weight: what the exercise says the bridge must carry."""
        return self.load - self.weight


def assemble(
    geometry: Geometry,
    section: Section,
    selections: list[Selection],
    include_self_weight: bool,
) -> Applied:
    """Turn named boundaries into a load vector and a restraint mask.

    Every refusal here is a boundary that would have been applied to nothing. That is the
    whole reason upstream made an unread condition an error where an unread material key is
    not: a clamp that lands on no joint leaves the structure free, the solve still converges,
    and it answers a different problem with no symptom on the result. A traction that lands on
    no member is the same failure with the load missing instead of the restraint.
    """
    count = geometry.node_count
    load = np.zeros((count, 2))
    restrained = np.zeros((count, 2), dtype=bool)
    resolved: dict = {}

    for entry in selections:
        joints = np.asarray(entry.joints, dtype=bool)
        # A joint no member reaches cannot be restrained or loaded meaningfully, and counting
        # it as "caught" would let a boundary that only ever touches strays look satisfied.
        joints = joints & geometry.attached
        chosen = np.flatnonzero(joints)
        members = np.flatnonzero(joints[geometry.members[:, 0]] & joints[geometry.members[:, 1]])
        resolved[entry.name] = {
            "joints": chosen.tolist(),
            "members": members.tolist(),
            "values": dict(entry.values),
        }

        if not chosen.size:
            raise ValueError(
                f"the load case sets {', '.join(sorted(entry.values))} on boundary "
                f"{entry.name!r}, and no joint of this lattice lies on it"
            )

        for key, value in entry.values.items():
            if key in ("fixed_x", "fixed_y") and value:
                restrained[chosen, 0 if key == "fixed_x" else 1] = True
            elif key in ("force_x", "force_y"):
                # The *total* on this boundary, shared equally. Stated rather than inferred:
                # a per-joint reading would make the same load case mean a different total
                # every time a joint was added to the stretch it names, which is the one thing
                # a reusable load case must not do.
                load[chosen, 0 if key == "force_x" else 1] += value / chosen.size
            elif key in ("load_x", "load_y") and value:
                if not members.size:
                    raise ValueError(
                        f"the load case puts a distributed load on boundary {entry.name!r}, "
                        "and no member of this lattice has both ends on it — a load per unit "
                        "length needs a length to act along"
                    )
                axis = 0 if key == "load_x" else 1
                share = 0.5 * value * geometry.length[members]
                np.add.at(load[:, axis], geometry.members[members, 0], share)
                np.add.at(load[:, axis], geometry.members[members, 1], share)

    weight = (
        self_weight(geometry, section.areas(geometry.member_count), section.density)
        if include_self_weight
        else np.zeros((count, 2))
    )
    return Applied(load=load + weight, restrained=restrained, weight=weight, resolved=resolved)


@dataclass
class Metrics:
    """The engineering answer. Every one of these is a decision a designer makes on."""

    utilisation_max: float
    stress_max: float
    tension_max: float
    compression_max: float
    deflection_max: float
    span_ratio: float
    mass: float
    reaction_max: float
    carried_per_mass: float
    buckling_margin_min: float | None


@dataclass
class Members:
    """The per-member table, which is what makes a verdict actionable rather than a score."""

    force: list[float]
    stress: list[float]
    utilisation: list[float]
    length: list[float]
    critical_load: list[float]
    #: True where the bar is in compression, which is where the Euler load is the capacity.
    compressed: list[bool]

    @property
    def worst(self) -> int:
        return int(np.argmax(self.utilisation)) if self.utilisation else -1


def capacity(
    section: Section, geometry: Geometry, force: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Each bar's admissible force, and the Euler load beside it. Both in newtons.

    In tension it is the squash load over the safety factor. In compression it is the lesser
    of that and Euler's critical load over the same factor — see the module note for why the
    lesser rather than the first.
    """
    areas = section.areas(geometry.member_count)
    critical = buckling_load(section.axial_stiffness(geometry.member_count), areas, geometry.length)
    squash = section.yield_strength * areas
    admissible = np.where(force < 0, np.minimum(squash, critical), squash) / section.safety_factor
    return admissible, critical


def measure(
    geometry: Geometry,
    section: Section,
    applied: Applied,
    solution: Solution,
) -> tuple[Metrics, Members]:
    """Every reported number, from one solve."""
    areas = section.areas(geometry.member_count)
    force = solution.force
    stress = force / areas
    admissible, critical = capacity(section, geometry, force)
    utilisation = np.abs(force) / admissible

    deflection = float(np.linalg.norm(solution.displacement, axis=1).max())
    total_mass = mass(geometry, areas, section.density)
    carried = float(np.linalg.norm(applied.imposed.sum(axis=0)))

    compressed = force < 0
    margin = (
        float(np.min(critical[compressed] / np.abs(force[compressed])))
        if compressed.any() and np.all(force[compressed] != 0)
        else None
    )

    metrics = Metrics(
        utilisation_max=float(utilisation.max()),
        stress_max=float(np.abs(stress).max()),
        tension_max=float(max(force.max(), 0.0)),
        compression_max=float(max(-force.min(), 0.0)),
        deflection_max=deflection,
        span_ratio=deflection / span(geometry, applied),
        mass=total_mass,
        reaction_max=float(np.linalg.norm(solution.reaction, axis=1).max()),
        carried_per_mass=carried / total_mass if total_mass > 0 else 0.0,
        buckling_margin_min=margin,
    )
    table = Members(
        force=force.tolist(),
        stress=stress.tolist(),
        utilisation=utilisation.tolist(),
        length=geometry.length.tolist(),
        critical_load=critical.tolist(),
        compressed=compressed.tolist(),
    )
    return metrics, table


def span(geometry: Geometry, applied: Applied) -> float:
    """The distance the bridge spans: between the outermost restrained joints.

    Falls back to the lattice's own width when nothing is restrained horizontally apart, which
    can only happen on a structure held at a single point — where the ratio is not a
    serviceability number anyway, and a zero denominator would be worse than a loose one.
    """
    held = np.flatnonzero(applied.restrained.any(axis=1))
    if held.size >= 2:
        reach = float(np.ptp(geometry.nodes[held, 0]))
        if reach > 0:
            return reach
    reach = float(np.ptp(geometry.nodes[:, 0]))
    return reach if reach > 0 else 1.0


@dataclass
class Verification:
    """Four independent checks, each a residual against a stated tolerance.

    Independent is the operative word, and it is why there are four rather than one. The
    linear residual says the matrix was inverted; it says nothing about whether the matrix was
    the right one. The joint balance is computed from the member forces and the geometry
    alone, so it never touches the stiffness matrix. The reaction and moment balances close
    the structure against the outside world. The energy check reaches the same scalar by two
    routes that share no arithmetic.
    """

    joint_equilibrium_rel: float
    joint_equilibrium_tolerance: float
    reaction_balance_rel: float
    reaction_balance_tolerance: float
    moment_balance_rel: float
    moment_balance_tolerance: float
    energy_consistency_rel: float
    energy_consistency_tolerance: float
    linear_residual: float
    linear_residual_tolerance: float


def verify(
    geometry: Geometry,
    section: Section,
    applied: Applied,
    solution: Solution,
) -> Verification:
    """Close the answer against statics, twice, and against energy once."""
    scale = float(np.abs(applied.load).sum()) or 1.0

    # 1. The method of joints, at every joint the solve was free to move. A restrained joint is
    #    excluded because its reaction is deliberately not in the residual.
    imbalance = joint_residual(geometry, solution.force, applied.load)
    free_joints = geometry.attached & ~applied.restrained.any(axis=1)
    joint = float(np.abs(imbalance[free_joints]).max()) / scale if free_joints.any() else 0.0

    # 2. The whole structure against the outside world: everything applied, plus everything the
    #    supports pushed back with, is zero.
    balance = float(np.linalg.norm(applied.load.sum(axis=0) + solution.reaction.sum(axis=0)))

    # 3. And the same in moment, about the origin — the check that catches a reaction of the
    #    right size in the wrong place, which the force balance alone cannot see.
    arm = geometry.nodes
    total = applied.load + solution.reaction
    # The *sum* of the moments, and then its magnitude — not the sum of the magnitudes, which
    # is a different quantity that never vanishes and which this check reported for exactly as
    # long as it took to run it on a real truss.
    moment = abs(float(np.sum(arm[:, 0] * total[:, 1] - arm[:, 1] * total[:, 0])))
    lever = float(np.abs(arm).max()) or 1.0

    # 4. Energy two ways: a sum over bars of N²L/2EA against a sum over joints of ½fu.
    stored = strain_energy(geometry, section.axial_stiffness(geometry.member_count), solution.force)
    work = external_work(applied.load, solution.displacement)
    reference = max(abs(stored), abs(work))

    return Verification(
        joint_equilibrium_rel=joint,
        joint_equilibrium_tolerance=1e-8,
        reaction_balance_rel=balance / scale,
        reaction_balance_tolerance=1e-8,
        moment_balance_rel=moment / (scale * lever),
        moment_balance_tolerance=1e-8,
        energy_consistency_rel=abs(stored - work) / reference if reference > 0 else 0.0,
        energy_consistency_tolerance=1e-6,
        linear_residual=solution.residual,
        linear_residual_tolerance=1e-8,
    )


def validity(
    geometry: Geometry,
    section: Section,
    applied: Applied,
    solution: Solution,
    metrics: Metrics,
    table: Members,
    *,
    include_self_weight: bool,
    fouled: list[int],
) -> list[str]:
    """Which of this model's stated limits this run crossed, and what it costs.

    Every entry names the threshold and the consequence, per the contract's §4. "Results are
    approximate" is not a warning and does not appear.
    """
    warnings: list[str] = []

    if metrics.span_ratio > LARGE_DISPLACEMENT_RATIO:
        warnings.append(
            f"The lattice deflects {1000 * metrics.deflection_max:.0f} mm, "
            f"{100 * metrics.span_ratio:.1f} % of the span, past the "
            f"{100 * LARGE_DISPLACEMENT_RATIO:.0f} % where first-order theory holds: "
            "equilibrium here is written on the undeformed shape, so these forces belong to a "
            "bridge that has not moved."
        )

    yielded = [
        index
        for index, value in enumerate(table.stress)
        if abs(value) > section.yield_strength
    ]
    if yielded:
        worst = max(yielded, key=lambda index: abs(table.stress[index]))
        warnings.append(
            f"Member {worst} carries {abs(table.stress[worst]) / 1e6:.0f} MPa, past the "
            f"{section.yield_strength / 1e6:.0f} MPa yield of the material: steel redistributes "
            "beyond it, and a linear-elastic model reports a force the bar cannot hold."
        )

    buckled = [
        index
        for index, compressed in enumerate(table.compressed)
        if compressed and abs(table.force[index]) > table.critical_load[index]
    ]
    if buckled:
        worst = max(buckled, key=lambda index: abs(table.force[index]) / table.critical_load[index])
        warnings.append(
            f"Member {worst} is {abs(table.force[worst]) / 1000:.1f} kN in compression against "
            f"an Euler critical load of {table.critical_load[worst] / 1000:.1f} kN: it buckles, "
            "and a first-order model has no way to see it go."
        )

    if fouled:
        warnings.append(
            f"{len(fouled)} member(s) pass through ground the site keeps clear "
            f"({', '.join(str(index) for index in fouled[:5])}"
            f"{'…' if len(fouled) > 5 else ''}): the structure is not buildable, whatever its "
            "stresses say."
        )

    if not include_self_weight:
        bars = mass(geometry, section.areas(geometry.member_count), section.density) * GRAVITY
        imposed = float(np.abs(applied.imposed).sum())
        if imposed > 0 and bars > SELF_WEIGHT_SHARE * imposed:
            warnings.append(
                f"Self-weight is switched off and the bars weigh {bars / 1000:.1f} kN, "
                f"{100 * bars / imposed:.0f} % of the load being carried — above the "
                f"{100 * SELF_WEIGHT_SHARE:.0f} % at which leaving it out changes the answer "
                "rather than simplifying it."
            )

    return warnings


def fouled_members(geometry: Geometry, keep_clear: list[np.ndarray]) -> list[int]:
    """Members that enter a region the site keeps clear. Indices, in order.

    A member counts as fouling when either end is inside the region or when it crosses an edge
    of it — which between them cover the two ways a bar can be where it must not be, without
    needing a polygon library.
    """
    if not keep_clear:
        return []
    fouled: list[int] = []
    starts = geometry.nodes[geometry.members[:, 0]]
    ends = geometry.nodes[geometry.members[:, 1]]
    for index, (start, end) in enumerate(zip(starts, ends, strict=True)):
        for polygon in keep_clear:
            if _inside(polygon, start) or _inside(polygon, end) or _crosses(polygon, start, end):
                fouled.append(index)
                break
    return fouled


def _inside(polygon: np.ndarray, point: np.ndarray) -> bool:
    """Ray casting, the textbook version. Polygons here are a handful of vertices."""
    x, y = float(point[0]), float(point[1])
    inside = False
    count = len(polygon)
    for i in range(count):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % count]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) / (y2 - y1) * (x2 - x1):
            inside = not inside
    return inside


def _crosses(polygon: np.ndarray, start: np.ndarray, end: np.ndarray) -> bool:
    count = len(polygon)
    return any(
        _segments_cross(start, end, polygon[i], polygon[(i + 1) % count]) for i in range(count)
    )


def _segments_cross(p1, p2, p3, p4) -> bool:
    def orient(a, b, c) -> float:
        return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))

    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def as_mesh(
    geometry: Geometry,
    solution: Solution,
    table: Members,
    bounds: tuple[float, float, float, float],
    width: float,
) -> dict:
    """The lattice as a `mesh2d` payload: every bar a quad, every quad two triangles.

    **The width is a display width, not the bar's diameter**, and saying so is not a
    formality. A 1000 mm² solid bar is 36 mm across; drawn to scale on a 24 m span it is a
    third of a pixel, and a field nobody can see is not a field. The model is a line element
    with an area, and the picture is a ribbon along that line coloured by what the line
    carries — which is why every value is constant across a bar's four corners rather than
    interpolated between them. Interpolating would draw a gradient along a quantity the model
    holds constant, which is a picture of an assumption nobody made.

    Corners are not shared between members, deliberately: two bars meeting at a joint carry
    different forces, and a shared node would have to average them.
    """
    nodes = geometry.nodes
    starts, ends = nodes[geometry.members[:, 0]], nodes[geometry.members[:, 1]]
    normal = np.column_stack([-geometry.direction[:, 1], geometry.direction[:, 0]]) * (width / 2)

    points = np.concatenate(
        [starts + normal, ends + normal, ends - normal, starts - normal], axis=1
    ).reshape(-1, 2)

    base = 4 * np.arange(geometry.member_count)
    triangles = np.concatenate(
        [
            np.column_stack([base, base + 1, base + 2]),
            np.column_stack([base, base + 2, base + 3]),
        ]
    )

    def per_corner(values: list[float]) -> list[float]:
        return np.repeat(np.asarray(values, dtype=float), 4).tolist()

    # The two corners at a bar's own end move with that end, which is what makes the vector
    # field a picture of the deformation rather than of the bar's average motion.
    ends_of_corner = geometry.members[:, [0, 1, 1, 0]].ravel()
    displacement = solution.displacement[ends_of_corner]

    return {
        "bounds": list(bounds),
        "points": points.tolist(),
        "triangles": triangles.tolist(),
        "point_fields": {
            "utilisation": per_corner(table.utilisation),
            "axial_force": per_corner(table.force),
            "axial_stress": per_corner([value / 1e6 for value in table.stress]),
        },
        "point_vector_fields": {"displacement": displacement.tolist()},
    }


@dataclass
class Report:
    """The whole answer, as the ``report.json`` artifact carries it.

    The same shape as the airfoil's and the magnetics' reports, so the page's renderers are
    the same code, with one block of its own: ``members``. A truss's answer is *per bar* in a
    way a field's is not — "which one is overloaded" is the question a designer asks next —
    and a table of a few hundred rows is small enough to travel whole.
    """

    schema: int = 1
    solver: dict = field(default_factory=dict)
    model: dict = field(default_factory=dict)
    geometry: dict = field(default_factory=dict)
    conditions: dict = field(default_factory=dict)
    numerics: dict = field(default_factory=dict)
    dimensionless: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    members: dict = field(default_factory=dict)
    displacement: list = field(default_factory=list)
    verification: dict = field(default_factory=dict)
    validity: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


__all__ = [
    "CONDITION_KEYS",
    "LARGE_DISPLACEMENT_RATIO",
    "Applied",
    "Members",
    "Metrics",
    "Report",
    "Section",
    "Selection",
    "Verification",
    "as_mesh",
    "assemble",
    "capacity",
    "fouled_members",
    "measure",
    "span",
    "validity",
    "verify",
]
