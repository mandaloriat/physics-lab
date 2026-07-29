"""Lab-specific solver adapters.

**There are none yet, and that is the point of this kickstart.** The airfoil experiment
runs on solvers Fenix Spoon already ships — ``mock.laplace2d`` and, where dolfinx is
installed, ``dolfinx.potential_flow2d``. Writing a solver to demonstrate a solver was not
worth the first release; using the ones that exist proves the integration instead.

What this package is, is the place the next ones go. Importing it is wired into
``physics_lab.main`` before the app is created, so an adapter registered here appears in
``GET /api/v1/solvers`` and in the front-end's solver picker with no further wiring — in
the API process and in every worker container alike, because both import the same module.

Adding one
----------

An adapter is a class implementing Fenix Spoon's public ``Solver`` contract (see
``docs/start-write-a-solver.md`` in the pinned Fenix Spoon checkout). Nothing about it is
lab-specific — a solver written here could move upstream unchanged, and one written
upstream needs no adaptation to run here::

    # physics_lab/solvers/heat_sink.py
    from fenixspoon.geometry import Regions2D
    from fenixspoon.solvers.base import ProgressEvent, Solver, SolverContext, SolverResult
    from fenixspoon.solvers.registry import register

    @register
    class HeatSink2D(Solver):
        name = "lab.heatsink2d"
        title = "Heat sink (conduction + convection)"
        geometry_types = ["regions2d"]
        ...

then add ``from . import heat_sink  # noqa: F401`` below.

Guard a heavy dependency the way Fenix Spoon guards dolfinx — import it in a ``try``
block and let the adapter be absent rather than the server be broken. The catalogue is
what clients read, so "not installed" is a complete and honest answer.

Planned, in rough order: heat-sink conduction and convection, structural response,
waves, acoustics, diffusion, vibration control. Each one is an experiment page plus,
where Fenix Spoon has no solver for it, an adapter here.
"""

__all__: list[str] = []
