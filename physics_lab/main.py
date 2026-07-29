"""The lab application: Fenix Spoon's app, plus a static site and a health endpoint.

    uvicorn physics_lab.main:app

Three things are added to the app Fenix Spoon builds, and nothing is taken away:

1. ``GET /health`` — Fenix Spoon has no health endpoint, and a reverse proxy and a smoke
   test both need one.
2. The static lab site at ``/`` — served by this process so the browser talks to one
   origin and CORS never enters the picture.
3. A maintenance switch that refuses new job submissions while leaving the rest of the
   API and the whole site online.

The ``/api/v1`` protocol is untouched: no route is wrapped, no response is rewritten, no
model is subclassed. Everything above is additive, so upgrading the pin is a version bump
rather than a merge.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fenixspoon import __version__ as fenixspoon_version
from fenixspoon.main import create_app as create_fenixspoon_app
from fenixspoon.solvers import available_solvers

from . import __version__, settings
from . import solvers as lab_solvers  # noqa: F401  - importing registers lab adapters

log = logging.getLogger(__name__)

#: The one route the maintenance switch guards. Cancelling, polling, reading results and
#: downloading artifacts stay available, so a job already running still finishes cleanly.
_SUBMIT_PATH = "/api/v1/jobs"


def _drop_demo_routes(app: FastAPI) -> None:
    """Free up ``/`` when Fenix Spoon has claimed it.

    ``fenixspoon.main.create_app`` mounts its own ``examples/`` at ``/demo`` and
    redirects ``/`` to it, but only when it can see a repository checkout two levels
    above the package. A pinned install from git has no such checkout, so normally there
    is nothing here to remove. Editable installs from a clone do, and the failure mode —
    the lab homepage silently redirecting to the Fenix Spoon demo index — is confusing
    enough to be worth four lines of defence.

    This edits the app object this function owns, not the installed package.
    """
    keep = []
    for route in app.router.routes:
        path = getattr(route, "path", None)
        if path == "/" or getattr(route, "name", None) == "demo":
            log.info("removing Fenix Spoon demo route %r; the lab serves this path", path)
            continue
        keep.append(route)
    app.router.routes[:] = keep


def create_app() -> FastAPI:
    app = create_fenixspoon_app()
    app.title = settings.site_name()
    app.description = (
        "Interactive physics laboratory built on Fenix Spoon. "
        "Simulations are demonstrative and educational."
    )

    @app.middleware("http")
    async def maintenance_gate(request: Request, call_next):
        """Refuse new solves when the lab is in maintenance mode.

        A middleware rather than a replacement route: the protocol's own handler stays
        exactly as Fenix Spoon wrote it, and turning the switch back on removes this
        from the path entirely.
        """
        if (
            request.method == "POST"
            and request.url.path.rstrip("/") == _SUBMIT_PATH
            and not settings.jobs_enabled()
        ):
            return JSONResponse(
                status_code=503,
                content={
                    "detail": (
                        "the lab is not accepting new simulations right now. "
                        "Existing results stay available."
                    )
                },
                headers={"Retry-After": "600"},
            )
        return await call_next(request)

    @app.get("/health", include_in_schema=False)
    def health() -> dict:
        """What this deployment is made of, and whether it can currently solve.

        Used by the container health check, by Caddy, by the smoke test and by the
        front-end — which reads ``jobs_enabled`` to decide whether to show a maintenance
        banner instead of a Run button that would 503.
        """
        return {
            "status": "ok",
            "app": {"name": settings.site_name(), "version": __version__},
            "fenixspoon": {
                "version": fenixspoon_version,
                "pinned_commit": settings.fenix_spoon_commit(),
                "dolfinx": settings.dolfinx_version(),
            },
            "jobs_enabled": settings.jobs_enabled(),
            "solvers": sorted(info.name for info in available_solvers()),
        }

    _drop_demo_routes(app)

    frontend = settings.frontend_dir()
    if frontend.is_dir():
        # Mounted last, at the root, so it catches only what the API did not. `html=True`
        # serves index.html for directory paths, which is what /experiments/airfoil/ needs.
        app.mount("/", StaticFiles(directory=frontend, html=True), name="lab")
    else:  # pragma: no cover - a deployment error, not a supported configuration
        log.warning("frontend directory %s not found; serving the API only", frontend)

    return app


app = create_app()
