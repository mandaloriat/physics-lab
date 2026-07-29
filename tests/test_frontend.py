"""The static site, as served by the app.

These are not browser tests — ``e2e/smoke.spec.mjs`` is. What they cover is the wiring
that a browser test would only report as a mysterious blank page: that the pages are
reachable at the paths the links use, that the vendored widgets are where the import map
says, and that nothing in the front-end points at a host that only exists on a laptop.
"""

import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

PAGES = ["/", "/experiments/airfoil/"]


@pytest.mark.parametrize("path", PAGES)
def test_pages_are_served(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_homepage_names_the_experiments_and_carries_the_disclaimer(client):
    # Collapsed, because a line break inside a paragraph is formatting, not content —
    # asserting on the raw source would fail the next time the file is re-wrapped.
    body = re.sub(r"\s+", " ", client.get("/").text)

    assert "Andolfatto Physics Lab" in body
    assert "/experiments/airfoil/" in body
    # The two planned experiments are listed honestly rather than linked to nothing.
    assert "In preparazione" in body
    assert "Laboratorio magnetico" in body
    assert "Dissipatore termico" in body
    assert "Non sostituiscono una verifica ingegneristica professionale" in body
    assert "fenix-spoon" in body


def test_the_airfoil_page_uses_the_fenix_spoon_widgets(client):
    body = client.get("/experiments/airfoil/").text

    assert "<fs-geometry-2d" in body
    assert "<fs-viewer" in body
    assert '"@fenix-spoon/client"' in body


@pytest.mark.parametrize(
    "path",
    [
        "/vendor/fenix-spoon/client/index.js",
        "/vendor/fenix-spoon/geometry-2d/index.js",
        "/vendor/fenix-spoon/viewer/index.js",
        "/shared/lab.css",
        "/shared/api.js",
        "/shared/components.js",
        "/experiments/airfoil/app.js",
        "/experiments/airfoil/content.json",
    ],
)
def test_static_assets_the_pages_reference_are_reachable(client, path):
    """Every path the import map and the pages name must actually resolve.

    The widgets are vendored by ``scripts/fetch-widgets.sh``; a checkout that skipped it
    serves a page whose only symptom is that nothing happens, which is exactly the
    failure this catches early.
    """
    response = client.get(path)
    assert response.status_code == 200, f"{path} is referenced by the site but not served"


def test_the_import_map_matches_what_is_vendored(client):
    """The import map's targets and the vendor tree must not drift apart."""
    body = client.get("/experiments/airfoil/").text
    targets = re.findall(r'"(/vendor/fenix-spoon/[^"]+)"', body)
    assert targets, "the airfoil page must resolve the widget packages through an import map"
    for target in targets:
        assert client.get(target).status_code == 200


def test_the_vendored_widgets_record_their_source_commit():
    """Vendored bytes without a provenance marker are unreproducible bytes."""
    commit_file = FRONTEND / "vendor" / "fenix-spoon" / "COMMIT"
    assert commit_file.is_file(), "run ./scripts/fetch-widgets.sh"
    assert len(commit_file.read_text().strip()) == 40


def test_no_hardcoded_host_in_the_front_end():
    """The pages must work unchanged on localhost and on lab.andolfatto.eu.

    Every request the site makes is relative, which is what lets one Caddy site serve the
    front-end and proxy the API without CORS. A hardcoded `http://localhost:8000` would
    work in development and break in production — the classic way this goes wrong.
    """
    offenders = []
    for path in sorted(FRONTEND.rglob("*")):
        if not path.is_file() or path.suffix not in {".js", ".html", ".css", ".json"}:
            continue
        if "vendor" in path.parts:
            continue  # third-party build output, checked by its own suite upstream
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)[:/\w.-]*", text):
            offenders.append(f"{path.relative_to(FRONTEND)}: {match.group(0)}")
    assert not offenders, "hardcoded local URLs in the front-end: " + ", ".join(offenders)
