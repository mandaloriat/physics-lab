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

#: Every experiment's directory. A page added here without its assets being reachable is the
#: failure this module exists to catch.
EXPERIMENTS = ["airfoil", "solenoid"]

PAGES = ["/", *(f"/experiments/{name}/" for name in EXPERIMENTS)]


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
    # Every available experiment is linked from the homepage; an experiment that ships
    # without a way in has not shipped.
    for name in EXPERIMENTS:
        assert f"/experiments/{name}/" in body
    assert "Magnetics lab" in body
    # What is still planned is listed honestly rather than linked to nothing.
    assert "In preparation" in body
    assert "Heat sink" in body
    assert "not a substitute for professional engineering verification" in body
    assert "fenix-spoon" in body


def test_the_airfoil_page_uses_the_fenix_spoon_widgets(client):
    body = client.get("/experiments/airfoil/").text

    assert "<fs-geometry-2d" in body
    assert "<fs-viewer" in body
    assert '"@fenix-spoon/client"' in body


def test_the_solenoid_page_renders_the_field_and_draws_its_own_cross_section(client):
    """The magnetics page uses the viewer, and its own diagram in place of the editor.

    ``<fs-geometry-2d>`` edits a ``domain2d`` outline — one polygon cut out of a rectangle —
    so it has nothing to offer a geometry made of nested material regions. Asserting it is
    *absent* is the point: importing it here would ship a widget bundle the page cannot use.
    """
    body = client.get("/experiments/solenoid/").text
    # Comments stripped first: the page *explains* why the editor widget is absent, and prose
    # naming a tag is not the same claim as markup using it.
    markup = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)

    assert "<fs-viewer" in markup
    assert '"@fenix-spoon/client"' in markup
    assert "<fs-geometry-2d" not in markup
    assert '"@fenix-spoon/geometry-2d"' not in markup
    # The cross-section diagram, which is what tells the visitor what will be solved.
    assert 'id="schematic"' in markup
    # Collapsed, because the disclaimer is line-wrapped in the source and a line break is
    # formatting rather than content.
    assert "not a substitute for professional engineering verification" in re.sub(
        r"\s+", " ", markup
    )


@pytest.mark.parametrize(
    "path",
    [
        "/vendor/fenix-spoon/client/index.js",
        "/vendor/fenix-spoon/geometry-2d/index.js",
        "/vendor/fenix-spoon/viewer/index.js",
        "/shared/lab.css",
        "/shared/api.js",
        "/shared/components.js",
        "/shared/experiment.js",
        *(f"/experiments/{name}/app.js" for name in EXPERIMENTS),
        *(f"/experiments/{name}/content.json" for name in EXPERIMENTS),
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


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_the_import_map_matches_what_is_vendored(client, name):
    """Every experiment's import map targets must resolve, and they need not be the same set.

    The airfoil resolves three packages, the solenoid two — it has no geometry to edit with
    the editor widget. What must hold for both is that whatever the page declares is actually
    served, because a bare specifier that resolves to a 404 is a page that does nothing.
    """
    body = client.get(f"/experiments/{name}/").text
    targets = re.findall(r'"(/vendor/fenix-spoon/[^"]+)"', body)
    assert targets, f"the {name} page must resolve the widget packages through an import map"
    for target in targets:
        assert client.get(target).status_code == 200


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_experiment_has_didactic_content_with_the_sections_the_page_renders(client, name):
    """The lesson is data, and the page renders whatever shape it finds.

    ``renderLesson`` reads ``intro``, ``title`` and ``sections[]`` with ``id`` and ``heading``.
    A content file missing one of those produces a page with a blank panel and no error, which
    is the kind of failure that survives review — so the contract is asserted here instead.
    """
    content = client.get(f"/experiments/{name}/content.json").json()

    assert content["title"]
    assert content["intro"]
    assert content["sections"], "an experiment page with no lesson is a demo, not a lab"
    for section in content["sections"]:
        assert section["id"] and section["heading"]
        assert section.get("body") or section.get("steps"), section["id"]

    # Every experiment states the limits of its own model. This one is not a style rule: the
    # whole claim of the lab is that it teaches, and a simulation presented without its
    # assumptions teaches something false.
    limits = next((s for s in content["sections"] if s["id"] == "limits"), None)
    assert limits, f"{name} must document the limits of its model"
    assert limits.get("caution") is True


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
