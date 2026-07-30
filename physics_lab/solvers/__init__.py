"""Lab-specific solver adapters.

One adapter lives here so far: the airfoil exercise's panel method. It is registered by
importing it, and importing this package is wired into ``physics_lab.main`` before the app is
created, so it appears in ``GET /api/v1/solvers``, in the capability catalogue and in the
front-end's solver picker with no further wiring. The worker needs the same import — see
``physics_lab.worker``, which is why arq is pointed at that module rather than at
``fenixspoon.worker.WorkerSettings`` directly.

Why a solver of the lab's own, when the point of the first release was to write none
-------------------------------------------------------------------------------------

Because the exercise needs physics Fenix Spoon does not have. Upstream's potential-flow
adapters impose no Kutta condition, so their circulation is zero and their integrated lift is
exactly zero at every incidence — which is fine for showing how a body deflects a stream, and
useless for an exercise whose target is a lift. See ADR-014, and the upstream issue that
records the gap: https://github.com/mandaloriat/fenix-spoon/issues/68.

The airfoil adapter is deliberately split so that only the last file knows about the protocol:

* ``panel.py`` — the Hess-Smith method. Arrays in, arrays out, no Fenix Spoon import.
* ``airfoil_geometry.py`` — NACA profiles, and reading chord, incidence and section out of an
  arbitrary outline.
* ``analytic.py`` — the closed-form solutions the answer is checked against.
* ``airfoil.py`` — the exercise: coefficients, sweeps, verification residuals, validity.
* ``airfoil_panel2d.py`` — the ``Solver`` adapter, and nothing else.

Adding another
--------------

An adapter is a class implementing Fenix Spoon's public ``Solver`` contract (see
``docs/start-write-a-solver.md`` in the pinned Fenix Spoon checkout). Nothing about it is
lab-specific — a solver written here could move upstream unchanged, and one written upstream
needs no adaptation to run here::

    # physics_lab/solvers/heat_sink.py
    from fenixspoon.solvers.base import Solver
    from fenixspoon.solvers.registry import register

    @register
    class HeatSink2D(Solver):
        name = "lab.heatsink2d"
        geometry_types = ["regions2d"]
        ...

then add ``from . import heat_sink  # noqa: F401`` below.

Guard a heavy dependency the way Fenix Spoon guards dolfinx — import it in a ``try`` block and
let the adapter be absent rather than the server be broken. The catalogue is what clients read,
so "not installed" is a complete and honest answer. The panel method needs nothing but NumPy,
which is why the airfoil exercise works on the slim image too.

Planned, in rough order: the structural bracket, the electromagnet, the heat sink, acoustics —
each an exercise page plus, where Fenix Spoon has no solver for it, an adapter here.
"""

from . import airfoil_panel2d  # noqa: F401  - importing registers the adapter

__all__: list[str] = ["airfoil_panel2d"]
