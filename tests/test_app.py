"""The lab's own behaviour: health, the protocol seam, and the maintenance switch."""

import json

import pytest


def test_health_reports_what_the_deployment_is_made_of(client):
    body = client.get("/health").json()

    assert body["status"] == "ok"
    assert body["app"]["name"]
    # The pin is surfaced at runtime so a deployed container can be asked what it is,
    # rather than being inferred from an image tag someone may have overridden.
    assert len(body["fenixspoon"]["pinned_commit"]) == 40
    assert body["jobs_enabled"] is True
    assert body["solvers"], "a lab with no solvers cannot run an experiment"


def test_solver_catalogue_is_not_empty_and_covers_the_airfoil(client):
    solvers = client.get("/api/v1/solvers").json()

    assert solvers
    usable = [s for s in solvers if "domain2d" in s["geometry_types"]]
    assert usable, "the airfoil experiment needs at least one domain2d solver"
    # The front-end builds its parameter form from this schema, so its absence is a
    # broken page rather than a cosmetic problem.
    assert all(s["params_schema"]["properties"] for s in usable)


def test_solver_catalogue_covers_the_magnetics_experiment(client):
    """The solenoid page asks for ``regions2d`` and builds its form from the schema it gets.

    Its two solvers do not agree on their parameters — the mock takes ``resolution`` and
    ``iterations``, the FEniCSx adapter takes ``mesh_size`` — which is precisely why the page
    reads them from here instead of hardcoding either. A solver publishing no properties would
    render an empty parameter panel.
    """
    solvers = client.get("/api/v1/solvers").json()

    usable = [s for s in solvers if "regions2d" in s["geometry_types"]]
    assert usable, "the magnetics experiment needs at least one regions2d solver"
    assert all(s["params_schema"]["properties"] for s in usable)


def test_the_mock_solver_is_always_present(client):
    """The lab must work without FEniCSx.

    Fenix Spoon's mock adapters are pure NumPy and register unconditionally; the FEniCSx
    ones register only where dolfinx imports. A deployment that lost the mock would take
    the public demo down with it whenever the worker image changed.
    """
    names = {s["name"] for s in client.get("/api/v1/solvers").json()}
    assert "mock.laplace2d" in names
    assert "mock.magnetostatics2d" in names


def test_a_mock_job_runs_to_a_result(client, airfoil_geometry):
    """The whole loop, over the wire: submit, stream, fetch, download."""
    submitted = client.post(
        "/api/v1/jobs",
        json={
            "solver": "mock.laplace2d",
            "geometry": airfoil_geometry,
            "params": {"resolution": 48, "iterations": 120},
        },
    )
    assert submitted.status_code == 202, submitted.text
    job_id = submitted.json()["job_id"]

    # The event stream is the supported way to wait: it ends on the terminal event, so
    # this cannot hang on a job that fails, and it needs no polling interval to tune.
    statuses = []
    with client.websocket_connect(f"/api/v1/jobs/{job_id}/events") as socket:
        while True:
            event = json.loads(socket.receive_text())
            if event["type"] == "status":
                statuses.append(event["status"])
                if event["status"] in {"done", "failed", "cancelled"}:
                    break

    assert statuses[-1] == "done", statuses

    result = client.get(f"/api/v1/jobs/{job_id}/result")
    assert result.status_code == 200
    body = result.json()

    # The two kinds do not agree on where their scalars live: `grid2d` has `fields`,
    # `mesh2d` has `point_fields` and no `fields` key at all. Read whichever the kind
    # implies rather than assuming, so this keeps passing if the default output changes.
    assert body["kind"] in {"grid2d", "mesh2d"}
    scalars = body["data"]["fields" if body["kind"] == "grid2d" else "point_fields"]
    assert scalars["speed"], "the page renders `speed` by default"
    # `seconds` is added by the job manager for every solve; the rest is adapter-defined.
    # The experiment page shows whatever is present, so it only needs one to be sure.
    assert body["stats"]["seconds"] >= 0

    artifact = next(a for a in body["artifacts"] if a["name"] == "solution.vtk")
    downloaded = client.get(artifact["url"])
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"# vtk DataFile")


def test_a_magnetostatics_job_returns_the_fields_the_page_reads(client, solenoid_geometry):
    """The magnetics page needs three named fields, and derives a fourth from two of them.

    ``A`` and ``B`` are the physics; ``mu_r`` is what lets the page show where the iron is and
    what lets it compute H = |B| / (μ₀ μᵣ) in the browser. If the adapter stopped publishing
    ``mu_r`` the H option would silently disappear from the page, so its presence is asserted
    here rather than discovered later.
    """
    submitted = client.post(
        "/api/v1/jobs",
        json={
            "solver": "mock.magnetostatics2d",
            "geometry": solenoid_geometry,
            "params": {"resolution": 48, "iterations": 200, "write_vtk": False},
        },
    )
    assert submitted.status_code == 202, submitted.text
    job_id = submitted.json()["job_id"]

    with client.websocket_connect(f"/api/v1/jobs/{job_id}/events") as socket:
        while True:
            event = json.loads(socket.receive_text())
            if event["type"] == "status" and event["status"] in {"done", "failed", "cancelled"}:
                assert event["status"] == "done", event
                break

    body = client.get(f"/api/v1/jobs/{job_id}/result").json()
    scalars = body["data"]["fields" if body["kind"] == "grid2d" else "point_fields"]
    for name in ("A", "B", "mu_r"):
        assert scalars[name], f"the magnetics page renders `{name}`"

    # The iron has to have been rasterised somewhere, or the geometry never reached the solver
    # and the whole picture would be of a coil in empty air.
    assert max(scalars["mu_r"]) > 1.0
    # Current in, flux out: a solved magnetostatic problem with a source cannot be uniformly
    # zero. This is the cheapest assertion that the source term actually did something.
    assert max(abs(value) for value in scalars["B"]) > 0.0


def test_a_partially_overlapping_geometry_is_refused(client, solenoid_geometry):
    """The constraint the page's controls are shaped to respect.

    ``regions2d`` accepts regions that are disjoint or fully nested, and rejects outlines that
    properly cross, because that describes an ambiguous material assignment. The solenoid page
    measures its winding outward from the core precisely so no slider combination can produce
    this — and the refusal is the reason that design is worth the trouble.
    """
    overlapping = {
        **solenoid_geometry,
        "regions": [
            solenoid_geometry["regions"][0],
            {
                "name": "straddles_the_core",
                "shape": {
                    "type": "polygon2d",
                    "points": [[0.0, -0.01], [0.02, -0.01], [0.02, 0.01], [0.0, 0.01]],
                },
                "material": {"current_density": 1.0e6},
            },
        ],
    }

    response = client.post(
        "/api/v1/jobs",
        json={"solver": "mock.magnetostatics2d", "geometry": overlapping, "params": {}},
    )
    assert response.status_code == 422


def test_an_oversized_job_is_refused_with_an_explanation(client, airfoil_geometry, monkeypatch):
    """The cell budget must reach the visitor as prose, not as a bare 422.

    The page prints the server's `detail` straight onto the status line, which is the
    only way someone who has just dragged a slider learns *why* nothing happened. The
    budget is lowered here rather than the request inflated, so the assertion does not
    depend on the largest resolution the solver's schema happens to allow.
    """
    monkeypatch.setenv("FENIXSPOON_MAX_CELLS", "1000")
    from starlette.testclient import TestClient

    from physics_lab.main import create_app

    with TestClient(create_app()) as tight:
        response = tight.post(
            "/api/v1/jobs",
            json={
                "solver": "mock.laplace2d",
                "geometry": airfoil_geometry,
                "params": {"resolution": 512},
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, str), "a budget refusal must be prose a page can print"
    assert "cells" in detail and "limit" in detail


def test_unknown_solver_is_a_404(client, airfoil_geometry):
    response = client.post(
        "/api/v1/jobs",
        json={"solver": "lab.does-not-exist", "geometry": airfoil_geometry, "params": {}},
    )
    assert response.status_code == 404


@pytest.mark.parametrize("value", ["false", "0", "no"])
def test_maintenance_mode_refuses_new_jobs_but_keeps_the_site_up(
    client, airfoil_geometry, monkeypatch, value
):
    """Turning solves off must not turn the lab off.

    This is the operational lever a public demo needs when the box is busy: the site, the
    catalogue and every finished result stay reachable, and only new work is refused.
    """
    monkeypatch.setenv("PHYSICS_LAB_JOBS_ENABLED", value)

    submitted = client.post(
        "/api/v1/jobs",
        json={"solver": "mock.laplace2d", "geometry": airfoil_geometry, "params": {}},
    )
    assert submitted.status_code == 503
    assert "Retry-After" in submitted.headers

    # Everything else still answers, including the front-end's own signal.
    assert client.get("/").status_code == 200
    assert client.get("/api/v1/solvers").status_code == 200
    assert client.get("/health").json()["jobs_enabled"] is False


def test_jobs_enabled_by_default(client, airfoil_geometry):
    response = client.post(
        "/api/v1/jobs",
        json={"solver": "mock.laplace2d", "geometry": airfoil_geometry, "params": {}},
    )
    assert response.status_code == 202
