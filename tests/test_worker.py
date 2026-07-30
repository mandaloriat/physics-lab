"""The worker entrypoint, and the deployment's agreement with it.

The bug this module exists to prevent was invisible to every other test here: the API
registered ``lab.airfoil_panel2d``, published it in the catalogue and accepted jobs for it,
while the worker containers — pointed at ``fenixspoon.worker.WorkerSettings``, which never
imports this package — had never heard of it. Nothing failed until a real job was dispatched
in production, and then it failed with "this worker has no solver named
``'lab.airfoil_panel2d'``".

Two halves have to agree for that not to happen again, and this checks both: that importing
the lab's solver package is what registers its adapters, and that the compose files really do
run a worker module of this package's own, one that performs that import.

The compose command is not executed here, and the worker module is not imported here either:
``fenixspoon.worker`` pulls in ``redis`` and ``arq``, which come from Fenix Spoon's ``redis``
extra and are installed in the deployed image rather than in this suite's environment. So the
module's import is read rather than run — a static check, which is enough to catch the entry
point drifting away from the package again.
"""

import ast
from pathlib import Path

import pytest
import yaml
from fenixspoon.solvers import get_solver

REPO = Path(__file__).resolve().parent.parent

#: Every compose file that runs a worker container. The development stack has none — the API
#: solves in its own process there — so a file without a ``worker`` service is skipped rather
#: than treated as a failure.
COMPOSE_FILES = ["compose.production.yaml", "compose.host-caddy.yaml"]

#: The adapter the lab ships today. Named explicitly because the point of the test is that
#: *this* solver is reachable from a worker, not that some solver is.
LAB_SOLVER = "lab.airfoil_panel2d"


def worker_command(compose_file: str) -> list[str]:
    spec = yaml.safe_load((REPO / compose_file).read_text(encoding="utf-8"))
    worker = spec.get("services", {}).get("worker")
    if worker is None or "command" not in worker:
        pytest.skip(f"{compose_file} defines no worker command")
    return worker["command"]


def imports_solver_package(source: str, package: str) -> bool:
    """Does this module import ``<package>.solvers``, by any of the spellings that work?"""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            # `from . import solvers`, `from physics_lab import solvers`
            if node.module in (None, package) and any(a.name == "solvers" for a in node.names):
                return True
            # `from .solvers import …`, `from physics_lab.solvers import …`
            if node.module in ("solvers", f"{package}.solvers"):
                return True
        elif isinstance(node, ast.Import):
            if any(a.name == f"{package}.solvers" for a in node.names):
                return True
    return False


def test_importing_the_solver_package_is_what_registers_the_adapter():
    """The mechanism the whole arrangement rests on: import, and the registry has it.

    ``tests/conftest.py`` builds the app, which imports this package, so by the time any test
    runs the adapter is registered — that is precisely why this is worth asserting rather than
    assuming, and why the two tests below care *which* module the worker runs.
    """
    import physics_lab.solvers  # noqa: F401  - the import under test

    assert get_solver(LAB_SOLVER) is not None


@pytest.mark.parametrize("compose_file", COMPOSE_FILES)
def test_the_worker_runs_an_entrypoint_of_this_package(compose_file):
    command = worker_command(compose_file)

    assert command[0] == "arq", f"{compose_file}: the worker drains the queue with arq"
    module, _, attribute = command[1].rpartition(".")
    assert attribute == "WorkerSettings", f"{compose_file}: arq needs a settings class"
    # The heart of it. `fenixspoon.worker.WorkerSettings` is a working arq entry point and a
    # broken lab worker: it starts, it drains the queue, and it has no lab adapters.
    assert module.startswith("physics_lab."), (
        f"{compose_file}: arq is pointed at {module!r}, which is outside this package and so "
        f"cannot have registered {LAB_SOLVER!r}"
    )


@pytest.mark.parametrize("compose_file", COMPOSE_FILES)
def test_that_entrypoint_imports_the_solver_package(compose_file):
    module = worker_command(compose_file)[1].rpartition(".")[0]
    package, _, tail = module.partition(".")
    source_file = REPO.joinpath(package, *tail.split(".")).with_suffix(".py")

    assert source_file.is_file(), (
        f"{compose_file}: arq is pointed at {module!r}, which is not a module in this repository"
    )
    assert imports_solver_package(source_file.read_text(encoding="utf-8"), package), (
        f"{module} does not import {package}.solvers, so a worker running it would reject "
        f"every {LAB_SOLVER!r} job with 'this worker has no solver named …'"
    )
