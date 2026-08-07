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
EXPERIMENTS = ["airfoil", "solenoid", "truss", "heatsink"]

PAGES = ["/", *(f"/experiments/{name}/" for name in EXPERIMENTS)]

#: The languages the site is written in, and the suffix each one's lesson content carries.
#:
#: English has no suffix because it is the source: ``content.json`` is the file the exercise is
#: written in and every other language is a translation of it. See ADR-020.
LANGUAGES = {"en": "", "it": ".it"}


@pytest.mark.parametrize("path", PAGES)
def test_pages_are_served(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


#: The three exercises the homepage presents as challenges.
#:
#: The magnetic circuit is deliberately not among them. It is a working page and it keeps its
#: URL, but its mission is a flux in Wb/m on an ampere-turn budget — no outcome a student can
#: picture and no trade-off they can feel — so it sits on the advanced shelf until the
#: electromagnet that replaces it exists. See ADR-022.
CHALLENGES = ["airfoil", "truss", "heatsink"]


def test_homepage_names_the_experiments_and_carries_the_disclaimer(client):
    # Collapsed, because a line break inside a paragraph is formatting, not content —
    # asserting on the raw source would fail the next time the file is re-wrapped.
    body = re.sub(r"\s+", " ", client.get("/").text)

    assert "Spoon Physics" in body
    # Every experiment is reachable from the homepage; one that ships without a way in has not
    # shipped. That includes the advanced lab, which is listed rather than carded.
    for name in EXPERIMENTS:
        assert f"/experiments/{name}/" in body
    # Each card leads with the question its exercise answers, and says how long it takes.
    # It no longer names the discipline as a bare topic line: "Aerodynamics · 5–8 min" tells a
    # visitor both of the things they are actually choosing between.
    assert "How much tilt does a wing need?" in body
    assert "Which bar gives way first?" in body
    assert "Do more fins always cool better?" in body
    # What is still planned is listed honestly rather than linked to nothing — and *if* nothing
    # is planned, the badge is simply absent. What the page must never do is show a planned card
    # that is also a link.
    planned = re.findall(r'<li class="card card--planned">.*?</li>', body)
    for card in planned:
        assert "In preparation" in card
        # No link at all, rather than no link to an experiment. A planned card pointing
        # somewhere else is the same broken promise wearing a different href.
        assert "<a" not in card
        assert "href" not in card
    # The tagline is the product's claim. ADR-016 fixed the old wording; ADR-022 replaced it,
    # on the ground that the old one described the solver and this one describes what you do.
    assert "Physics challenges. Real computation. Results worth arguing about." in body
    assert "not professional engineering tools" in body
    assert "fenix-spoon" in body
    # Three steps, and the one sentence that justifies two credibility indicators per attempt.
    assert "How to play" in body
    assert "computed well and still describe reality badly" in body


def test_the_homepage_carries_no_formula_in_the_open_part_of_a_card(client):
    """A symbol on a card is a gate in front of a choice, and the choice is which one to open.

    The cards used to fold ``η < 1``, ``|C_m,c/4| < 0.08`` and ``4.5 mWb/m`` into a disclosure
    under every one of them. None of that is deleted — the engineering statement of each target
    is on its challenge page, where the vocabulary to read it is a paragraph away — but a
    visitor deciding between three challenges is not helped by any of it. Editorial review §6.1
    and §14.1.
    """
    body = client.get("/").text
    cards = re.search(r'<ul class="card-grid">(.*?)</ul>', body, re.DOTALL)
    assert cards, "the homepage has no card grid"
    text = re.sub(r"<[^>]+>", " ", cards.group(1))

    for symbol in ["η", "C_m", "mWb", "Wb/m", "±", "μᵣ", "L′", "T_max", "≤", "<"]:
        assert symbol not in text, f"a card shows {symbol} before the visitor has chosen anything"


def test_the_magnetic_circuit_is_not_presented_as_a_fourth_challenge(client):
    """It keeps its URL and loses its card. §9.3, the recommended option.

    Deleting the page would throw away a working solver; leaving it in the grid would tell a
    visitor these four things are the same kind of thing, which is the claim ADR-022 rejects.
    So it is on a shelf that says who it is for, and the page itself says so too.
    """
    body = client.get("/").text
    grid = re.search(r'<ul class="card-grid">(.*?)</ul>', body, re.DOTALL).group(1)
    assert "/experiments/solenoid/" not in grid, "the magnetic circuit is back in the card grid"
    assert len(re.findall(r'<li class="card', grid)) == len(CHALLENGES)

    shelf = re.search(r'<section class="shelf".*?</section>', body, re.DOTALL)
    assert shelf, "the advanced shelf is missing, so the magnetic circuit has no way in"
    assert "/experiments/solenoid/" in shelf.group(0)

    # And the page does not go on calling itself an exercise with a mission like the others.
    content = client.get("/experiments/solenoid/content.json").json()
    assert "Magnetic field in a 2D section" == content["title"]


def test_the_airfoil_page_uses_the_fenix_spoon_widgets(client):
    body = client.get("/experiments/airfoil/").text

    assert "<fs-geometry-2d" in body
    assert "<fs-viewer" in body
    assert '"@fenix-spoon/client"' in body


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_experiment_page_carries_the_workspace(client, name):
    """The instrument, and the markup the shared workspace module wires itself into.

    The redesign made the field the centre of the page rather than an illustration in it
    (ADR-017), and that shape is markup the page owns: a toolbar, a clipping stage, a zoom box,
    an annotation overlay and a colour scale outside the scroll container. A page that lost one
    of them would still load and would silently lose a tool, so the contract is asserted here
    rather than only in the browser suite.
    """
    body = client.get(f"/experiments/{name}/").text
    for hook in [
        'class="workspace__toolbar"',
        'class="workspace__stage"',
        'class="workspace__zoom"',
        'class="workspace__overlay"',
        'class="workspace__scale"',
        'class="actionbar"',
    ]:
        assert hook in body, f"the {name} page is missing {hook}"

    # The viewer draws no colorbar of its own: the workspace draws one, and that is what makes
    # the widget's plot area exactly the element's box — which is what the annotation overlay's
    # alignment depends on. See the note in `frontend/shared/workspace.js`.
    assert 'colorbar="off"' in body


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_the_numerics_are_behind_a_closed_disclosure(client, name):
    """Advanced ships closed, in the markup, so the main path is short before any script runs."""
    markup = re.sub(r"<!--.*?-->", "", client.get(f"/experiments/{name}/").text, flags=re.DOTALL)
    match = re.search(r'<details[^>]*id="advanced"[^>]*>', markup)
    assert match, f"the {name} page must keep its numerics under an Advanced disclosure"
    assert "open" not in match.group(0), "Advanced must not start expanded"


def test_no_internal_identifier_is_written_into_the_markup(client):
    """The pages name quantities the way a person reads them, not the way the report stores them.

    ``l_prime`` and ``c_m_c4`` are keys in ``report.json``; a visitor should never meet either.
    The browser suite checks the rendered text, which is the stronger claim — this checks the
    static markup, which is where such a string is easiest to reintroduce by hand.
    """
    forbidden = ["l_prime", "c_m_c4", "x_cp_over_c", "cp_min_station", "cl_consistency_rel"]
    for name in EXPERIMENTS:
        body = client.get(f"/experiments/{name}/").text
        markup = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
        for key in forbidden:
            assert key not in markup, f"{name}/index.html shows the internal identifier {key}"


def test_the_homepage_shows_a_real_field_for_every_experiment(client):
    """Every card carries a thumbnail that is a solve, not an illustration.

    ``scripts/make-thumbnails.py`` runs each experiment's own solver and writes the field as a
    PNG. A card whose image 404s says nothing at all, and the failure is invisible in the
    Python suite unless the reference is followed — so it is followed.
    """
    body = client.get("/").text
    sources = re.findall(r'src="(/assets/thumbnails/[^"]+)"', body)
    assert len(sources) == len(CHALLENGES), "each challenge card needs its own field thumbnail"
    for source in sources:
        response = client.get(source)
        assert response.status_code == 200, f"{source} is on the homepage but not served"
        assert response.content.startswith(b"\x89PNG"), f"{source} is not a PNG"

    # And a concrete invitation rather than "open the experiment".
    assert "Try a wing" in body
    assert "Build the bridge" in body
    assert "Design the heat sink" in body


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
        "/shared/exercise.js",
        "/shared/workspace.js",
        "/shared/runs.js",
        "/shared/curve.js",
        "/shared/atmosphere.js",
        "/shared/i18n.js",
        "/shared/strings/en.js",
        "/shared/strings/it.js",
        *(f"/experiments/{name}/app.js" for name in EXPERIMENTS),
        *(
            f"/experiments/{name}/content{suffix}.json"
            for name in EXPERIMENTS
            for suffix in LANGUAGES.values()
        ),
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


@pytest.mark.parametrize("suffix", LANGUAGES.values())
@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_experiment_has_didactic_content_with_the_sections_the_page_renders(
    client, name, suffix
):
    """The lesson is data, and the page renders whatever shape it finds.

    ``renderLesson`` reads ``intro``, ``title`` and ``sections[]`` with ``id`` and ``heading``.
    A content file missing one of those produces a page with a blank panel and no error, which
    is the kind of failure that survives review — so the contract is asserted here instead.

    Run against every language, because a translation is a second file with the same contract
    and no second reviewer: ``scripts/check-i18n.mjs`` checks that the two agree with each
    other, and this checks that each is usable on its own.
    """
    content = client.get(f"/experiments/{name}/content{suffix}.json").json()

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


@pytest.mark.parametrize("suffix", LANGUAGES.values())
@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_exercise_asks_a_prediction_before_it_explains_anything(client, name, suffix):
    """The four blocks §13.3 asks the schema to keep apart, present and separate.

    The prediction is the one that carries the design: an exercise that hands over the
    explanation first has taught a student to move a slider until a number agrees, which is a
    search, not an experiment. So the question exists, it offers a way to say "not sure yet",
    and it is phrased about something observable rather than about a formula.
    """
    content = client.get(f"/experiments/{name}/content{suffix}.json").json()

    prediction = content["prediction"]
    assert prediction["question"].endswith("?"), "a prediction is a question"
    assert len(prediction["options"]) >= 2, "an opinion needs something to choose between"
    assert prediction.get("allow_unknown") is True, "not knowing yet must be a real answer"
    for option in prediction["options"]:
        assert option["id"] and option["label"]
        assert option["id"] != "unknown", "the renderer supplies the unknown option"
    # No formula in the question. A prediction a student can only make by evaluating an
    # expression is a calculation they have not been taught yet, not a prediction.
    assert not re.search(r"[=<>]|\bC_[a-z]\b", prediction["question"])

    # At most three cards, one heading each, and short enough to be read after a solve rather
    # than instead of one.
    assert 1 <= len(content["explain"]) <= 3
    for card in content["explain"]:
        assert card["id"] and card["heading"] and card["body"]
        words = sum(len(paragraph.split()) for paragraph in card["body"])
        assert words <= 90, f"{name}/{card['id']} is {words} words; §7.9 allows 40–70"

    teacher = content["teacher"]
    for field in ["objective", "misconception", "discussion", "prerequisites", "duration"]:
        assert teacher[field], f"{name} teacher card has no {field}"


@pytest.mark.parametrize("suffix", LANGUAGES.values())
@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_challenge_is_stated_twice_in_two_registers(client, name, suffix):
    """Meaning first, symbols after — §2.4, the rule the whole review turns on.

    ``plain_statement`` is the mission as a student reads it and is what the page shows;
    ``statement`` is the same mission in the units an engineer would state it in and stays in
    the model details. Both are required, and they may not be the same sentence: a file where
    one was copied into the other has not made the distinction, it has recorded it.
    """
    challenge = client.get(f"/experiments/{name}/content{suffix}.json").json()["challenge"]

    assert challenge["plain_statement"], f"{name} states its mission only in symbols"
    assert challenge["plain_statement"] != challenge["statement"]
    # The plain wording is the one a reader meets first, so it is the one that may not open
    # with notation. `Wb/m` and `η` belong in the engineering statement below it.
    for symbol in ["η", "δ/L", "C_m,c/4", "μᵣ"]:
        assert symbol not in challenge["plain_statement"], f"{name} leads with {symbol}"


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_page_asks_before_it_answers(client, name):
    """The markup hooks the loop needs, in the order the loop happens.

    A page that lost one of these fails quietly: the prediction simply never renders, the
    verdict never appears, the credibility pair silently becomes a panel of residuals again.
    Each is asserted by position as well as by presence, because "present somewhere on the
    page" is not the claim — the prediction has to come before the bench, and the explanation
    after the results.
    """
    markup = re.sub(r"<!--.*?-->", "", client.get(f"/experiments/{name}/").text, flags=re.DOTALL)

    for hook in ['id="path"', 'id="prediction"', 'id="outcome"', 'id="hint"',
                 'id="credibility"', 'id="explain"', 'id="teacher"']:
        assert hook in markup, f"the {name} page is missing {hook}"

    assert markup.index('id="prediction"') < markup.index('class="bench__layout"'), (
        "the prediction must come before the instrument, or it is not a prediction"
    )
    assert markup.index('id="credibility"') < markup.index('id="verification"'), (
        "the two indicators come first; the residuals are the detail behind them"
    )
    assert markup.index('id="explain"') > markup.index('id="kpis"'), (
        "the explanation must follow the result it explains"
    )
    # The residuals and the model limits move behind a disclosure, and it ships closed.
    checks = re.search(r'<details[^>]*id="checks"[^>]*>', markup)
    assert checks and "open" not in checks.group(0)


def test_the_shared_challenge_banner_speaks_no_exercise_s_vocabulary():
    """``exercise.js`` renders every exercise, so it may name none of them.

    The met-target banner used to end "try to meet it another way — a different profile at a
    different incidence", which is sound advice on the aerofoil and nonsense on the magnetic
    circuit, where there is no profile and no incidence. The second route is now
    ``challenge.next_step`` in each ``content.json``; this keeps the wording from creeping
    back into the shared renderer, where it reads correctly on the page it was written for.
    """
    source = (FRONTEND / "shared" / "exercise.js").read_text()
    # Comments may name an exercise — explaining *why* a word does not belong in the renderer
    # takes saying the word. What is asserted is the code, which is what a visitor reads.
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    code = "\n".join(line for line in source.splitlines() if not line.strip().startswith("//"))

    # The wording moved into the string catalogues when the site gained a second language
    # (ADR-020), so checking `exercise.js` alone would now pass by being empty of prose. Its
    # own block in each catalogue is read too — and only that block, because a file holding
    # every exercise's vocabulary is supposed to hold every exercise's vocabulary.
    for catalogue in sorted((FRONTEND / "shared" / "strings").glob("*.js")):
        block = re.search(r"^  exercise: \{$(.*?)^  \},$", catalogue.read_text(), re.M | re.S)
        assert block, f"{catalogue.name} has no `exercise:` block to check"
        code += "\n" + block.group(1)

    for word in ["incidence", "aerofoil", "airfoil", "chord", "ampere-turn", "permeability"]:
        assert word not in code.lower(), f"the shared banner names {word}, which is one exercise's"


@pytest.mark.parametrize("suffix", LANGUAGES.values())
@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_challenge_names_its_own_second_route(client, name, suffix):
    """A met target invites a second solve, in the terms of the exercise that was solved.

    The field is optional in the renderer — an exercise without it gets a shorter sentence
    rather than a wrong one — but every exercise the lab ships states it, so the invitation
    is concrete: there is more than one design that passes, and comparing two is the lesson.
    """
    challenge = client.get(f"/experiments/{name}/content{suffix}.json").json()["challenge"]

    assert challenge["statement"] and challenge["targets"]
    hint = challenge["next_step"]
    assert hint and not hint.endswith("."), "the hint is a clause inside a sentence, not a sentence"


@pytest.mark.parametrize("path", PAGES)
def test_every_page_offers_both_languages(client, path):
    """The switch is rendered by `components.js`, but three things are the page's own.

    A page that lost any of them fails quietly rather than loudly: without the ``hreflang``
    alternates the two versions are one URL to a crawler, without the ``<head>`` snippet an
    Italian reader gets a frame of English before the modules load, and without a single
    ``data-i18n`` hook the markup is a page that can never be translated at all.
    """
    body = client.get(path).text

    for code in LANGUAGES:
        assert f'hreflang="{code}"' in body, f"{path} does not declare its {code} version"
        assert f"lang={code}" in body
    assert "data-lang-pending" in body, f"{path} would paint English at an Italian reader"
    assert "data-i18n" in body, f"{path} carries no translatable markup"


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_the_italian_lesson_is_a_translation_and_not_a_copy(client, name):
    """Every paragraph of the Italian lesson differs from the English it stands for.

    The failure this catches is the boring one and the likely one: a `content.it.json` created
    by copying `content.json` and translating the first two sections. The structure is checked
    against the English by ``scripts/check-i18n.mjs``; what cannot be checked mechanically is
    whether the prose was ever written, so the weakest useful claim is asserted here — that it
    is not the same prose.
    """
    english = client.get(f"/experiments/{name}/content.json").json()
    italian = client.get(f"/experiments/{name}/content.it.json").json()

    assert english["intro"] != italian["intro"]
    assert english["challenge"]["statement"] != italian["challenge"]["statement"]
    for source, translated in zip(english["sections"], italian["sections"], strict=True):
        assert source["heading"] != translated["heading"], source["id"]
        for before, after in zip(source.get("body", []), translated.get("body", []), strict=True):
            assert before != after, f"{name}/{source['id']} is still in English"


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


#: Which capability answers each exercise's mission.
#:
#: Written here rather than derived, because deriving it would mean parsing the page's
#: JavaScript to check the page — and a test that reads its subject's source to decide what to
#: assert can only ever agree with it.
MISSION_SOLVER = {
    "airfoil": "lab.airfoil_panel2d",
    "solenoid": "lab.magnetics2d",
    "truss": "lab.truss2d",
    "heatsink": "lab.heatsink2d",
}


@pytest.mark.parametrize("name", EXPERIMENTS)
def test_every_challenge_target_names_a_metric_its_solver_declares(client, name):
    """A mission can only be met if the numbers it is set on are numbers that get reported.

    The failure this catches is quiet and permanent: a target naming a metric no solver
    publishes renders as "this run does not report it" on every run forever, and reads as a
    page that is merely unlucky. Both halves are declarations — `challenge.targets` in
    `content.json` and `Solver.metrics` in the adapter — so they can simply be compared, which
    is cheaper than the browser test that would otherwise find it.
    """
    from fenixspoon.solvers.registry import get_solver

    import physics_lab.solvers  # noqa: F401  - registers lab.* by import

    declared = {spec.name for spec in get_solver(MISSION_SOLVER[name]).metrics}
    challenge = client.get(f"/experiments/{name}/content.json").json()["challenge"]

    targeted = {target["metric"] for target in challenge["targets"]}
    assert targeted <= declared, f"{name} targets metrics its solver does not declare"

    # The verification gate is the same kind of claim about the same kind of key, and it is not
    # a metric — it names a residual in the report, so it is checked for presence rather than
    # against the metric list.
    required = challenge.get("requires_verified")
    if required:
        assert required["metric"].endswith(("_rel", "_residual"))
        assert required["below"] > 0
