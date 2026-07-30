"""The worker entrypoint: arq's own worker, with the lab's solver adapters registered.

    arq physics_lab.worker.WorkerSettings

``WorkerSettings`` below *is* ``fenixspoon.worker.WorkerSettings`` — re-exported, not
subclassed, so what the worker does stays whatever the pin says it does. The only thing this
module adds is the import of ``physics_lab.solvers``, which is what registers
``lab.airfoil_panel2d`` (and every adapter added after it) in the process arq is about to run.

The worker command used to point arq straight at ``fenixspoon.worker.WorkerSettings``, which
never imports this package at all — so the lab's adapters were registered in the API process
and nowhere else. Every job submitted for one was accepted, dispatched, and then failed with
"this worker has no solver named 'lab.airfoil_panel2d'", because arq's import chain has no
reason to know this package exists.

Import order is not what makes this work, which is why the two imports below can be sorted the
way ruff wants them: ``fenixspoon.worker`` looks a solver up by name when a job arrives, not
when it is imported. All that matters is that both imports happen before arq starts.
"""

from fenixspoon.worker import WorkerSettings

from . import solvers as lab_solvers  # noqa: F401  - importing registers the lab's adapters

#: The name arq resolves in ``arq physics_lab.worker.WorkerSettings``. Naming it here is also
#: what tells ruff the re-export is deliberate rather than an unused import.
__all__: list[str] = ["WorkerSettings"]
