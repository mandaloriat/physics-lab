"""The worker entrypoint: registers the lab's own solver adapters before arq starts.

    arq physics_lab.worker.WorkerSettings

``fenixspoon.worker.WorkerSettings`` is unchanged below except for one thing: the import
of ``physics_lab.solvers`` happens first. The worker command used to point arq straight
at ``fenixspoon.worker.WorkerSettings``, which never imports this package at all — so
``lab.airfoil_panel2d`` (and any adapter added later) was registered in the API process
and nowhere else. Every job submitted for it reached the worker and failed with "this
worker has no solver named 'lab.airfoil_panel2d'", because arq's own import chain has no
reason to know this package exists.
"""

from . import solvers as lab_solvers  # noqa: F401  - importing registers lab adapters
from fenixspoon.worker import WorkerSettings  # noqa: F401
