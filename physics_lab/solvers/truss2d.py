"""``lab.truss2d`` — the bridge exercise as a Fenix Spoon capability.

Thin on purpose. The method is in :mod:`physics_lab.solvers.truss` and the exercise in
:mod:`physics_lab.solvers.bridge`; what is left here is the protocol — a params model, the
load case, a result envelope, a declared artifact and the cost estimate.

The third lab solver, and the first whose reason is not that upstream's physics is *wrong*
for the question but that upstream has no physics for it at all. ``mock.elasticity2d`` and
``dolfinx.elasticity2d`` solve a continuum: a body filling a region, meshed, with a stress
field through it. A truss is not a body. It is a graph — joints and bars, with an axial force
in each bar and nothing in between them — and the two are not the same problem discretised
differently. Meshing a lattice of 40 mm bars over a 24 m span as a continuum would need cells
finer than the bars across an area a thousand times larger, which is not a budget question but
a modelling one: the answer a designer wants is *the force in member 14*, and a continuum
solve does not have members.

## The geometry is the site, and the lattice is a parameter

This capability accepts ``regions2d``, and what it reads from it is the **site**: the bounds
the bridge is built in, the ground regions, and — through protocol 1.8 — the named places a
load case can refer to. The lattice itself travels in ``params``.

That split is not where it would be if the protocol had a line geometry, and it is worth
recording as a finding rather than hiding as a convention. ``Geometry`` is
``Domain2D | Regions2D``: one polygon cut out of a rectangle, or a rectangle filled with
material regions. **A bar network is neither.** It cannot be regions — bars meet at joints, so
their outlines properly cross, and partially overlapping regions are refused (correctly: for
a material assignment they *are* ambiguous). It cannot be a ``domain2d`` obstacle either,
since a truss's voids are many holes and that geometry has one. So the third geometry kind
the protocol will eventually want is a network — nodes, edges, and a property per edge — and
this exercise is the evidence for it. Until then the honest arrangement is the one here:
the geometry carries what it *can* say about the site, and the lattice is params, where its
revision is still hashed into the cache key and still recorded in a run row.

## What the load case does

Protocol 1.9, and the reason this exercise exists in the shape it does. A bridge is loaded
**at joints or along stretches**, and both are a statement about *where*: a lorry axle at the
third panel point, a deck load along the whole carriageway, a wind load on the windward chord.
The geometry names those places (a box around a joint, a band along the deck), the load case
says what happens there, and the same lattice can then be asked three different questions
without being redescribed once.

Six condition keys, and the split between them is the exercise's, not the protocol's:
``fixed_x``/``fixed_y`` restrain, ``force_x``/``force_y`` put a total force on the joints a
boundary catches, and ``load_x``/``load_y`` put a force per unit length on the members whose
*both* ends it catches. The last pair is the one that makes "loaded along a stretch" mean
something exact; :mod:`physics_lab.solvers.bridge` documents why it is lumped to the ends.

The parameter shorthand — ``fixed_joints``, ``roller_joints``, ``point_loads`` — is kept for a
caller with no named boundaries in hand, and **a load case replaces it entirely** rather than
adding to it. That precedence is upstream's rule for the elasticity pair and it is the right
one for the same reason: a caller who named every support explicitly must not inherit an
invisible pin from a default they never set.
"""

import json

import numpy as np
from fenixspoon.boundaries import predicate
from fenixspoon.geometry import Regions2D
from fenixspoon.solvers.base import (
    ArtifactSpec,
    Assumption,
    CapabilityExample,
    ConditionSpec,
    MetricSpec,
    ProgressEvent,
    Solver,
    SolverContext,
    SolverResult,
)
from fenixspoon.solvers.registry import register
from pydantic import BaseModel, Field, model_validator

from . import bridge, truss

VERSION = "1.0.0"

#: A two-panel Warren truss over a 4 m span, so the capability is runnable from the API with
#: no lattice authored at all. The exercise page never sends this: it sends what was drawn.
DEFAULT_NODES = [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0), (1.0, 1.0), (3.0, 1.0)]
DEFAULT_MEMBERS = [(0, 1), (1, 2), (0, 3), (3, 1), (1, 4), (4, 2), (3, 4)]

#: Material region key this capability reads: nonzero means no member may pass through the
#: region. Everything else in a region's material dict is ignored, which is the protocol's own
#: convention for an open bag of scalars.
KEEP_CLEAR = "keep_clear"

TRUSS_METRICS = [
    MetricSpec(
        name="utilisation_max",
        unit="1",
        description=(
            "The worst member's force as a fraction of what it may carry: yield over the "
            "safety factor in tension, and the lesser of that and the Euler buckling load in "
            "compression. One is the edge of the design; above one a member has failed."
        ),
        field="utilisation",
        reduction="max",
    ),
    MetricSpec(
        name="stress_max",
        unit="Pa",
        description="Largest axial stress magnitude in any bar, tension or compression.",
    ),
    MetricSpec(
        name="tension_max",
        unit="N",
        description="Largest tensile force in any bar. Zero when nothing is in tension.",
    ),
    MetricSpec(
        name="compression_max",
        unit="N",
        description=(
            "Largest compressive force, as a positive number. The one to read beside "
            "`buckling_margin_min`, since compression is where slenderness bites."
        ),
    ),
    MetricSpec(
        name="deflection_max",
        unit="m",
        description="Largest joint displacement magnitude anywhere in the lattice.",
    ),
    MetricSpec(
        name="span_ratio",
        unit="1",
        description=(
            "That deflection over the span between the outermost supports — the form a "
            "serviceability limit is stated in, and what makes two bridges of different sizes "
            "comparable."
        ),
    ),
    MetricSpec(
        name="mass",
        unit="kg",
        description="Total mass of the bars: density times area times length, summed.",
    ),
    MetricSpec(
        name="reaction_max",
        unit="N",
        description="Largest support reaction. What the abutment has to be built for.",
    ),
    MetricSpec(
        name="carried_per_mass",
        unit="N/kg",
        description=(
            "The imposed load carried per kilogram of steel — the structure's own figure of "
            "merit, and the number that improves when a lattice gets cleverer rather than "
            "heavier. Self-weight is excluded from the numerator: a bridge is not paid to "
            "carry itself."
        ),
    ),
    MetricSpec(
        name="buckling_margin_min",
        unit="1",
        description=(
            "Euler critical load over the force actually carried, minimised over the members "
            "in compression. Below one, a member has buckled. Absent when nothing is in "
            "compression, which is a statement about the lattice rather than a missing number."
        ),
    ),
]

TRUSS_CONDITIONS = [
    ConditionSpec(
        name="fixed_x",
        unit="1",
        description=(
            "Nonzero holds every joint on this boundary against moving along x. A pin is this "
            "and `fixed_y` together; this alone is a roller free to slide vertically."
        ),
        kind="dirichlet",
    ),
    ConditionSpec(
        name="fixed_y",
        unit="1",
        description=(
            "Nonzero holds every joint on this boundary against moving along y — the other "
            "roller, and half of a pin."
        ),
        kind="dirichlet",
    ),
    ConditionSpec(
        name="force_x",
        unit="N",
        description=(
            "A force along x applied to the joints this boundary catches. It is the **total**, "
            "shared equally among them, so a boundary naming one joint carries all of it and "
            "the same load case means the same load however finely the stretch is panelled."
        ),
        kind="neumann",
    ),
    ConditionSpec(
        name="force_y",
        unit="N",
        description="The same along y, positive upwards. A downward load is negative.",
        kind="neumann",
    ),
    ConditionSpec(
        name="load_x",
        unit="N/m",
        description=(
            "A uniform load per unit length along x, carried by every member with **both** "
            "ends on this boundary and lumped half to each end. Refused when the boundary "
            "spans no whole member: a load per unit length needs a length to act along."
        ),
        kind="neumann",
    ),
    ConditionSpec(
        name="load_y",
        unit="N/m",
        description="The same along y, positive upwards — a deck load is negative.",
        kind="neumann",
    ),
]

TRUSS_ASSUMPTIONS = [
    Assumption(
        name="pin-jointed",
        statement=(
            "Every joint is a frictionless pin, so a bar carries axial force only. Real "
            "gusseted joints carry some moment, which stiffens the truss and puts bending into "
            "the chords; for a triangulated lattice the axial forces are within a few per cent "
            "of these, and for an untriangulated one they are the only thing holding it up, "
            "which is why this model refuses that lattice rather than reporting it."
        ),
        excludes=["bending_moment", "joint_stress", "shear"],
    ),
    Assumption(
        name="small-displacement",
        statement=(
            "Equilibrium is written on the undeformed lattice. It stops being true when the "
            "deflection is a noticeable fraction of the span, where the geometry that carries "
            "the load is no longer the geometry it was computed on."
        ),
        quantity="span_ratio",
        limit=bridge.LARGE_DISPLACEMENT_RATIO,
        comparator="<",
    ),
    Assumption(
        name="linear-elastic",
        statement=(
            "The material is linear to any stress. Past yield a steel bar redistributes force "
            "instead of carrying more, so a run reporting a stress above the declared yield is "
            "describing a structure that no longer exists."
        ),
        quantity="stress_max",
        limit=250e6,
        comparator="<",
    ),
    Assumption(
        name="solid-circular-section",
        statement=(
            "The buckling check takes each bar to be a solid circular section of the stated "
            "area, so I = A²/4π. It is the conservative end of the range — a tube of the same "
            "area has a far larger second moment and buckles at a much higher load — and it is "
            "fixed rather than offered so that a compression member cannot be made safe by "
            "asserting a better section."
        ),
        excludes=["local_buckling", "torsional_buckling"],
    ),
    Assumption(
        name="static",
        statement=(
            "One load case, applied slowly. No dynamics, no fatigue, no moving load: a lorry "
            "crossing is modelled by asking the question again with the load somewhere else."
        ),
        excludes=["natural_frequency", "fatigue_life", "impact_factor"],
    ),
]

REPORT_ARTIFACT = ArtifactSpec(
    name="report.json",
    content_type="application/json",
    description=(
        "The engineering answer: metrics, the per-member table of force, stress, utilisation "
        "and buckling load, the joint displacements, which joints and members each named "
        "boundary caught, every verification residual and every validity warning. Written on "
        "every run, because a result without its verification is not a result."
    ),
)


@register
class Truss2D(Solver):
    name = "lab.truss2d"
    title = "Planar pin-jointed truss (direct stiffness)"
    description = (
        "A lattice of bars carrying axial force only, solved once by the direct stiffness "
        "method — no iteration and nothing to converge, because with the joints pinned the "
        "lattice is the discretisation. Loads and supports come from a load case on the "
        "boundaries the site names: a total force on the joints a boundary catches, or a load "
        "per unit length along the members it spans. Reports the worst member's utilisation "
        "against yield and Euler buckling, the deflection over the span, the mass and the load "
        "carried per kilogram, each with a residual: the method of joints, a reaction balance, "
        "a moment balance and an energy check. A lattice that folds is refused rather than "
        "reported, with the joints that fold named."
    )
    geometry_types = ["regions2d"]
    #: Its own tag, and not `elasticity`, which upstream's two continuum adapters declare.
    #: Load-bearing on the front-end: `mock.elasticity2d` also accepts `regions2d`, so a page
    #: filtering on geometry and `elasticity` would offer a solver that has no members to
    #: report a force in — the same trap the magnetics page fell into with `mock.heat2d`.
    physics = "truss"
    availability = "direct-stiffness"
    requires = ["numpy"]
    version = VERSION
    #: One direct solve of a dense system, with no random seeding and no thread-dependent
    #: reduction. Identical inputs give identical bits, so an identical resubmission is worth
    #: answering from the cache (upstream #47).
    deterministic = True
    metrics = TRUSS_METRICS
    conditions = TRUSS_CONDITIONS
    assumptions = TRUSS_ASSUMPTIONS
    artifacts = [REPORT_ARTIFACT]
    examples = [
        CapabilityExample(
            title="the default two-panel truss",
            description="Runnable with no lattice authored: 10 kN at midspan of a 4 m Warren.",
            params={"point_loads": [[1, 0.0, -10000.0]], "fixed_joints": [0], "roller_joints": [2]},
        ),
        CapabilityExample(
            title="a heavier section",
            description=(
                "The same lattice in 4400 mm² bars. Four times the buckling capacity, since "
                "the Euler load goes with the square of the area at fixed length, and twice "
                "the mass."
            ),
            params={"area": 4.4e-3, "point_loads": [[1, 0.0, -10000.0]]},
        ),
    ]

    class Params(BaseModel):
        """The lattice, the section it is built from, and the shorthand load.

        Grouped by what each parameter *is*, which is the distinction ADR-013 turns on. There
        is no numerical group worth the name, and that is a property of the physics rather
        than an omission: a pin-jointed lattice has no mesh, no tolerance and no iteration
        count, so the only settings left are the design and what is done to it. The page says
        so where a visitor would otherwise look for the missing panel.
        """

        # --- the lattice: what was drawn
        nodes: list[tuple[float, float]] = Field(
            default=DEFAULT_NODES,
            min_length=2,
            max_length=160,
            description=(
                "Joint coordinates in metres, as [x, y] pairs. The order is the identity: a "
                "member, a support and a load all name a joint by its index here."
            ),
        )
        members: list[tuple[int, int]] = Field(
            default=DEFAULT_MEMBERS,
            min_length=1,
            max_length=400,
            description=(
                "Bars, as pairs of indices into `nodes`. Undirected — [i, j] and [j, i] are "
                "the same bar, and giving both is refused rather than doubled."
            ),
        )
        # --- physical: the problem statement
        area: float = Field(
            default=2.2e-3,
            gt=0.0,
            le=0.05,
            description=(
                "Cross-sectional area of every bar, in m². 2.2e-3 is 2200 mm², an ordinary "
                "structural section. One area for the whole lattice on purpose: a free area "
                "per bar turns the exercise into an optimisation with no way to see why an "
                "answer is better."
            ),
        )
        youngs_modulus: float = Field(
            default=210e9,
            gt=0.0,
            description="Elastic modulus in Pa. 210 GPa is structural steel.",
        )
        density: float = Field(
            default=7850.0,
            ge=0.0,
            description="Density in kg/m³, used for the mass and the self-weight.",
        )
        yield_strength: float = Field(
            default=250e6,
            gt=0.0,
            description="Yield stress in Pa. 250 MPa is S275 mild steel at its design value.",
        )
        safety_factor: float = Field(
            default=1.5,
            ge=1.0,
            le=5.0,
            description=(
                "Capacity is divided by this before a utilisation is taken, in tension and in "
                "compression alike. 1.0 reports the bare failure ratio."
            ),
        )
        self_weight: bool = Field(
            default=True,
            description=(
                "Add each bar's own weight as half at each of its joints. On by default: a "
                "long-span truss carries a real fraction of its own mass, and leaving it out "
                "flatters exactly the designs that add material."
            ),
        )
        # --- the shorthand, consulted only when no load case is supplied
        fixed_joints: list[int] = Field(
            default=[],
            max_length=160,
            description=(
                "Joints pinned in both directions. Ignored entirely when a load case is "
                "supplied — see the module docstring on why the precedence is total."
            ),
        )
        roller_joints: list[int] = Field(
            default=[],
            max_length=160,
            description="Joints held vertically and free to slide. Same precedence.",
        )
        point_loads: list[tuple[int, float, float]] = Field(
            default=[],
            max_length=160,
            description=(
                "Forces at joints, as [joint, Fx, Fy] in newtons, positive upwards. Same "
                "precedence."
            ),
        )
        # --- presentation: affects the picture and no reported number
        bar_width: float = Field(
            default=0.0,
            ge=0.0,
            le=2.0,
            description=(
                "Width the bars are *drawn* at in the result, in metres. Zero derives one from "
                "the site. This is a display width and never the bar's real diameter: a "
                "1000 mm² bar is 36 mm across, which on a 24 m span is a third of a pixel."
            ),
        )

        @model_validator(mode="after")
        def _check_lattice(self) -> "Truss2D.Params":
            """Refuse a lattice that cannot mean anything, at submit rather than mid-solve.

            The same checks :func:`physics_lab.solvers.truss.build` makes, hoisted here so a
            caller gets a 422 naming the field instead of a failed job. Kept in both places
            deliberately: the method module is tested without a protocol, and an invariant
            enforced only at the edge is an invariant the unit tests cannot rely on.
            """
            count = len(self.nodes)
            for first, second in self.members:
                if not (0 <= first < count and 0 <= second < count):
                    raise ValueError(
                        f"member [{first}, {second}] names a joint outside the {count} this "
                        "lattice has"
                    )
                if first == second:
                    raise ValueError(f"member [{first}, {second}] joins a joint to itself")
            pairs = {tuple(sorted(member)) for member in self.members}
            if len(pairs) != len(self.members):
                raise ValueError("two members join the same pair of joints")
            supports = ((self.fixed_joints, "fixed_joints"), (self.roller_joints, "roller_joints"))
            for group, label in supports:
                for index in group:
                    if not 0 <= index < count:
                        raise ValueError(f"{label} names joint {index}, which does not exist")
            for index, _, _ in self.point_loads:
                if not 0 <= index < count:
                    raise ValueError(f"point_loads names joint {index}, which does not exist")
            return self

    @classmethod
    def estimate_cells(cls, geometry: Regions2D, params: "Truss2D.Params") -> int:
        """Two triangles per bar, which is the whole result payload.

        The real count rather than an estimate, and it is small: the largest lattice the params
        admit draws 800 triangles. The cell budget is therefore never the binding limit on this
        capability — the list lengths are, which is where the ceiling belongs, since a truss of
        400 bars is a fine structure and an unusable exercise long before it is an expensive
        solve. The solve itself factorises a dense matrix of at most 320 degrees of freedom.
        """
        return 2 * len(params.members)

    def solve(
        self, geometry: Regions2D, params: "Truss2D.Params", ctx: SolverContext
    ) -> SolverResult:
        ctx.progress(ProgressEvent(iteration=0, total=3, message="reading the lattice"))
        lattice = truss.build(params.nodes, params.members)
        section = bridge.Section(
            area=params.area,
            modulus=params.youngs_modulus,
            density=params.density,
            yield_strength=params.yield_strength,
            safety_factor=params.safety_factor,
        )

        ctx.progress(ProgressEvent(iteration=1, total=3, message="placing supports and loads"))
        selections = (
            _from_load_case(geometry, lattice, ctx.conditions)
            if ctx.conditions
            else _from_shorthand(params, lattice)
        )
        applied = bridge.assemble(lattice, section, selections, params.self_weight)

        ctx.check_cancelled()
        ctx.progress(ProgressEvent(iteration=2, total=3, message="solving the joint equilibrium"))
        try:
            solution = truss.solve(
                lattice,
                section.axial_stiffness(lattice.member_count),
                applied.load,
                applied.restrained,
            )
        except truss.Mechanism as folding:
            # Re-raised as a plain ValueError so the server answers with the sentence rather
            # than with a class name — and with the joints in it, because "add a diagonal" is
            # only advice if it says where.
            raise ValueError(_folds(folding)) from folding

        metrics, table = bridge.measure(lattice, section, applied, solution)
        checks = bridge.verify(lattice, section, applied, solution)
        fouled = bridge.fouled_members(lattice, _keep_clear(geometry))
        warnings = bridge.validity(
            lattice,
            section,
            applied,
            solution,
            metrics,
            table,
            include_self_weight=params.self_weight,
            fouled=fouled,
        )

        ctx.progress(ProgressEvent(iteration=3, total=3, message="drawing the lattice"))
        width = params.bar_width or _display_width(geometry.bounds)
        data = bridge.as_mesh(lattice, solution, table, tuple(geometry.bounds), width)

        report = bridge.Report(
            solver={"name": self.name, "version": VERSION},
            model={
                "equation": "K u = f, with every member carrying axial force only",
                "joints": "pinned",
                "discretisation": "one element per member; nothing to refine",
                "buckling": "Euler, pinned-pinned, solid circular section (I = A^2/4pi)",
                "withheld": ["bending_moment", "joint_stress", "natural_frequency", "fatigue"],
            },
            geometry={
                "bounds": list(geometry.bounds),
                "nodes": lattice.nodes.tolist(),
                "members": lattice.members.tolist(),
                "length": lattice.length.tolist(),
                "span": bridge.span(lattice, applied),
                "member_count": lattice.member_count,
                "joint_count": lattice.node_count,
                "ignored_joints": np.flatnonzero(~lattice.attached).tolist(),
                "fouled_members": fouled,
                "bar_width": width,
            },
            conditions={
                "source": "load_case" if ctx.conditions else "parameters",
                "boundaries": applied.resolved,
                "restrained": np.argwhere(applied.restrained).tolist(),
                "imposed_resultant": applied.imposed.sum(axis=0).tolist(),
                "self_weight_resultant": applied.weight.sum(axis=0).tolist(),
            },
            numerics=params.model_dump(exclude={"nodes", "members"}),
            dimensionless={
                "span_ratio": metrics.span_ratio,
                "utilisation_max": metrics.utilisation_max,
                "slenderness_max": _slenderness(lattice, section),
            },
            metrics=vars(metrics),
            members=vars(table),
            displacement=solution.displacement.tolist(),
            verification=vars(checks),
            validity={"warnings": warnings, "fouled_members": fouled},
        )
        path = ctx.artifact(REPORT_ARTIFACT.name, REPORT_ARTIFACT.content_type)
        path.write_text(json.dumps(report.to_dict(), indent=1, allow_nan=False), encoding="utf-8")

        return SolverResult(
            kind="mesh2d",
            data=data,
            # Cost only. The engineering answer is in the artifact, never in `stats`.
            stats={
                "cells": float(2 * lattice.member_count),
                "dofs": float(int(solution.free.sum())),
            },
            converged=None,
            residual=solution.residual,
            warnings=warnings,
        )


# ----------------------------------------------------------------------------- the machinery


def _from_load_case(geometry: Regions2D, lattice: truss.Geometry, conditions: dict):
    """Resolve every named boundary against the joints, once, here.

    This is the only place in the exercise that knows what a selector is. Upstream turns a
    name into `f(x) -> bool` over points shaped `(2, N)` — the signature
    ``locate_entities_boundary`` takes — so the same resolution serves a FEniCSx adapter and
    this one, and a box drawn round a joint means the same thing to both.
    """
    coordinates = lattice.nodes.T  # (2, n), the shape the predicate expects
    return [
        bridge.Selection(
            name=name,
            joints=np.asarray(predicate(geometry, name)(coordinates), dtype=bool),
            values=values,
        )
        for name, values in conditions.items()
    ]


def _from_shorthand(params: "Truss2D.Params", lattice: truss.Geometry):
    """The parameter route: supports and point loads by joint index, with no geometry involved.

    Each becomes a `Selection` over a one-hot mask, so :func:`bridge.assemble` has one code
    path rather than two — and so the "this boundary caught nothing" refusal applies to a
    shorthand naming a joint no member reaches, exactly as it would to a named box.
    """
    selections = []
    for index in params.fixed_joints:
        selections.append(_at(lattice, f"fixed:{index}", index, {"fixed_x": 1.0, "fixed_y": 1.0}))
    for index in params.roller_joints:
        selections.append(_at(lattice, f"roller:{index}", index, {"fixed_y": 1.0}))
    for index, fx, fy in params.point_loads:
        selections.append(_at(lattice, f"load:{index}", index, {"force_x": fx, "force_y": fy}))
    return selections


def _at(lattice: truss.Geometry, name: str, index: int, values: dict) -> bridge.Selection:
    mask = np.zeros(lattice.node_count, dtype=bool)
    mask[index] = True
    return bridge.Selection(name=name, joints=mask, values=values)


def _keep_clear(geometry: Regions2D) -> list[np.ndarray]:
    """Region outlines the site keeps clear, as arrays. Empty when none is declared."""
    return [
        np.asarray(region.shape.points, dtype=float)
        for region in geometry.regions
        if region.material.get(KEEP_CLEAR, 0.0)
    ]


def _display_width(bounds) -> float:
    """A bar width proportional to the site, so a picture of one reads like a picture of another.

    A hundred-and-fiftieth of the wider side: thick enough to carry a colour at a glance, thin
    enough that two bars meeting at 30° are still two bars.
    """
    xmin, ymin, xmax, ymax = bounds
    return max(xmax - xmin, ymax - ymin) / 150.0


def _slenderness(lattice: truss.Geometry, section: bridge.Section) -> float:
    """The worst bar's length over its radius of gyration — why buckling bites, as one number.

    For the solid circular section the buckling check assumes, the radius of gyration is
    ``r/2 = sqrt(A/pi)/2``. Reported because it is the quantity a designer recognises: above
    about 200 a steel strut is worth nothing in compression whatever its area.
    """
    gyration = np.sqrt(section.area / np.pi) / 2.0
    return float(lattice.length.max() / gyration)


def _folds(folding: truss.Mechanism) -> str:
    where = (
        f" The joints that move most are {', '.join(str(index) for index in folding.joints)}."
        if folding.joints
        else ""
    )
    return (
        f"This lattice is a mechanism in {folding.count} independent way(s): it folds without "
        "stretching a single bar, so there is no equilibrium to report rather than a large "
        f"deflection to report.{where} Triangulate it, or hold another joint."
    )
