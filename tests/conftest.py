"""Test fixtures.

Fenix Spoon's own suite already proves the protocol, the job lifecycle, the store and the
solvers — it is a dependency, and re-testing it here would be duplicated maintenance with
no extra coverage. What these tests cover is the seam: that the lab's app really is a
Fenix Spoon app, that the site is served from the same origin as the API, and that the
lab's own additions (``/health``, the maintenance switch) behave.
"""

import os
import tempfile

import pytest


@pytest.fixture
def client(monkeypatch):
    """A TestClient over the lab app, with a throwaway data directory.

    The app is built inside the fixture rather than imported at module scope so each test
    gets a fresh job store, and so environment variables set by a test are read by the
    app that test uses. ``TestClient`` as a context manager runs the lifespan, which is
    what starts the retention sweep and reconciles the store — a solve submitted without
    it would never be reaped.
    """
    from starlette.testclient import TestClient

    with tempfile.TemporaryDirectory() as data_dir:
        monkeypatch.setenv("FENIXSPOON_DATA_DIR", data_dir)
        monkeypatch.setenv("FENIXSPOON_STORE", "sqlite")
        # Keep the suite honest about budgets without making it slow.
        monkeypatch.setenv("FENIXSPOON_MAX_CELLS", "200000")
        monkeypatch.setenv("FENIXSPOON_JOB_TIMEOUT", "90")
        os.environ.pop("FENIXSPOON_REDIS_URL", None)

        from physics_lab.main import create_app

        with TestClient(create_app()) as test_client:
            yield test_client


@pytest.fixture
def airfoil_geometry():
    """A small, valid ``domain2d`` payload: a blunt wedge in a rectangular domain.

    Deliberately not the page's NACA profile. A test that had to agree with the
    front-end's geometry generator would fail whenever the profile was retuned, which is
    not what any of these tests are about.
    """
    return {
        "type": "domain2d",
        "bounds": [-1.0, -1.0, 2.0, 1.0],
        "obstacle": {
            "type": "polygon2d",
            "points": [[0.0, 0.0], [0.6, 0.08], [1.0, 0.0], [0.6, -0.08]],
        },
    }
