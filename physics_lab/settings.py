"""Lab-level configuration.

Everything that governs *simulation* — job timeouts, cell budgets, quotas, the store,
Redis — is Fenix Spoon's own configuration and is read by Fenix Spoon from the
``FENIXSPOON_*`` environment variables. None of it is re-declared here; duplicating a
default is how the two drift apart.

What lives here is only what the *lab* adds on top: which commit of Fenix Spoon this
deployment is pinned to, where the static site lives, and the one operational switch the
public demo needs (turning job submission off while keeping the site up).
"""

import os
from pathlib import Path

#: The Fenix Spoon commit this lab is built and tested against. Set by the Docker image;
#: falls back to the pin recorded in ``pyproject.toml`` for a local checkout. Surfaced by
#: ``/health`` so a running deployment can be asked what it is actually made of.
#: Keep in step with pyproject.toml, .env.example and the Dockerfile — enforced by
#: scripts/check-pins.sh.
DEFAULT_FENIX_SPOON_COMMIT = "7c89be3d9641c382017931be407e5d6ba8ca9826"

#: dolfinx release the pinned FEniCSx image carries. Informational; reported by /health.
DEFAULT_DOLFINX_VERSION = "v0.11.0"

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def fenix_spoon_commit() -> str:
    return os.environ.get("FENIX_SPOON_COMMIT") or DEFAULT_FENIX_SPOON_COMMIT


def dolfinx_version() -> str:
    return os.environ.get("FENIX_SPOON_DOLFINX_VERSION") or DEFAULT_DOLFINX_VERSION


def jobs_enabled() -> bool:
    """Whether the lab accepts new solves.

    Set ``PHYSICS_LAB_JOBS_ENABLED=false`` to keep the site, the catalogue and every
    finished result online while refusing new work — the maintenance mode a public demo
    needs when the box is busy or a solver is misbehaving. Read per request rather than
    cached, so flipping it is a container restart at worst and a live env change at best.
    """
    return _flag("PHYSICS_LAB_JOBS_ENABLED", True)


def frontend_dir() -> Path:
    """Where the static site is served from. Overridable for tests and odd layouts."""
    configured = os.environ.get("PHYSICS_LAB_FRONTEND_DIR")
    return Path(configured) if configured else FRONTEND_DIR


def site_name() -> str:
    return os.environ.get("PHYSICS_LAB_SITE_NAME", "Andolfatto Physics Lab")


def public_url() -> str:
    return os.environ.get("PHYSICS_LAB_PUBLIC_URL", "https://lab.andolfatto.eu")
