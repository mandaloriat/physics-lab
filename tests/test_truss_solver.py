"""Is ``lab.truss2d`` honest about the truss? The load case, the answer, the refusals.

The companion to ``test_truss_method.py``: that one asks whether the physics is right, this
one asks whether the capability says so correctly — whether the load case lands where it was
aimed, whether the metrics are the numbers the page claims, whether every declared check runs,
and whether the things that cannot be answered are refused rather than reported.

Two groups carry most of the weight.

``test_a_load_case_replaces_the_parameter_shorthand`` is the one that would fail silently in
production. A merge of the two routes would leave a caller who named every support with an
extra pin from a default they never set — a stiffer bridge than the one they described, with
nothing anywhere to say so. Upstream chose total precedence for the elasticity pair for this
reason and this file asserts the lab's adapter kept it.

The ``refused`` group is the load-case design working: a boundary that catches no joint, a
distributed load with no member to act along, and a lattice that folds are all refusals with
a sentence, not results with a caveat.
"""

import json

import numpy as np
import pytest
from fenixspoon.geometry import Regions2D
from fenixspoon.solvers.base import SolverContext

from physics_lab.solvers import bridge
from physics_lab.solvers.truss2d import Truss2D

SPAN = 24.0
DECK_LOAD = -4000.0  # N/m


def rect(x0, y0, x1, y1):
    return {"type": "polygon2d", "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


@pytest.fixture
def site():
    """The gorge: two banks, a shipping channel that must stay clear, three named places.

    Deliberately not the page's own site — a test that had to agree with the front-end's
    geometry builder would fail whenever the mission was retuned. What it shares with the page
    is the shape of the payload: named boundaries a load case can refer to, which is the
    protocol 1.8 half this exercise is built on.
    """
    return Regions2D(
        bounds=(-4.0, -8.0, 28.0, 12.0),
        regions=[
            {"name": "left_bank", "shape": rect(-3.9, -7.9, 0.0, 0.0), "material": {}},
            {"name": "right_bank", "shape": rect(24.0, -7.9, 27.9, 0.0), "material": {}},
            {
                "name": "channel",
                "shape": rect(6.0, -5.0, 18.0, -0.4),
                "material": {"keep_clear": 1.0},
            },
        ],
        boundaries=[
            {"name": "left_abutment", "select": {"type": "box", "bounds": [-0.3, -0.3, 0.3, 0.3]}},
            {
                "name": "right_abutment",
                "select": {"type": "box", "bounds": [23.7, -0.3, 24.3, 0.3]},
            },
            {"name": "deck", "select": {"type": "near", "axis": "y", "value": 0.0, "tol": 0.05}},
            {"name": "midspan", "select": {"type": "box", "bounds": [11.7, -0.3, 12.3, 0.3]}},
            {"name": "nowhere", "select": {"type": "box", "bounds": [-3.5, 8.0, -3.0, 9.0]}},
        ],
    )


def warren(panels=8, depth=3.0):
    """A Warren truss over the gorge: joints on the deck, apexes above it."""
    step = SPAN / panels
    nodes = [(step * i, 0.0) for i in range(panels + 1)]
    nodes += [(step * (i + 0.5), depth) for i in range(panels)]
    members = [(i, i + 1) for i in range(panels)]
    members += [(panels + 1 + i, panels + 2 + i) for i in range(panels - 1)]
    for i in range(panels):
        members += [(i, panels + 1 + i), (panels + 1 + i, i + 1)]
    return nodes, members


SUPPORTS = {
    "left_abutment": {"fixed_x": 1.0, "fixed_y": 1.0},
    "right_abutment": {"fixed_y": 1.0},
}


def run(site, conditions=None, tmp_path=None, **params):
    """Solve one lattice through the adapter and return its result and its report."""
    nodes, members = warren()
    payload = {"nodes": nodes, "members": members, "area": 2.6e-3}
    payload.update(params)
    context = SolverContext(lambda event: None, artifact_dir=tmp_path, conditions=conditions)
    result = Truss2D().solve(site, Truss2D.Params(**payload), context)
    report = json.loads((tmp_path / "report.json").read_text())
    return result, report


@pytest.fixture
def loaded(site, tmp_path):
    """The reference run: the default Warren, pinned and rollered, under a deck load."""
    return run(site, {**SUPPORTS, "deck": {"load_y": DECK_LOAD}}, tmp_path)


# ------------------------------------------------------------------------ the declaration


def test_the_capability_declares_what_the_page_reads():
    """Every metric the exercise page names, and the artifact it fetches them from."""
    declared = {spec.name for spec in Truss2D.metrics}
    assert {
        "utilisation_max",
        "span_ratio",
        "mass",
        "deflection_max",
        "carried_per_mass",
        "buckling_margin_min",
    } <= declared
    assert [artifact.name for artifact in Truss2D.artifacts] == ["report.json"]


def test_the_capability_declares_every_condition_key_the_exercise_reads():
    """The declaration is what the server refuses an unknown key against.

    A key the exercise reads and does not declare is refused at submit and never reaches the
    solver; a key declared and not read is a load a caller can set with no effect. Both are
    the failure protocol 1.9 exists to prevent, so the two lists are asserted equal rather
    than one being a subset of the other.
    """
    assert {spec.name for spec in Truss2D.conditions} == set(bridge.CONDITION_KEYS)


def test_the_capability_declares_its_assumptions_and_what_they_exclude():
    """An exercise that reports a number must say what its model cannot produce."""
    assumptions = {entry.name: entry for entry in Truss2D.assumptions}
    assert "pin-jointed" in assumptions
    assert "bending_moment" in assumptions["pin-jointed"].excludes
    assert assumptions["small-displacement"].limit == bridge.LARGE_DISPLACEMENT_RATIO


def test_the_cost_estimate_is_two_triangles_a_bar():
    nodes, members = warren(panels=4)
    params = Truss2D.Params(nodes=nodes, members=members)
    assert Truss2D.estimate_cells(None, params) == 2 * len(members)


# ------------------------------------------------------------------------ the load case


def test_a_load_case_puts_the_deck_load_where_it_was_aimed(loaded):
    """A load per unit length along the deck adds up to the length times the load."""
    _, report = loaded
    deck = report["conditions"]["boundaries"]["deck"]
    assert len(deck["joints"]) == 9  # every joint at y = 0
    assert len(deck["members"]) == 8  # the eight bottom-chord bars, and nothing else
    assert report["conditions"]["imposed_resultant"][1] == pytest.approx(DECK_LOAD * SPAN)
    assert report["conditions"]["source"] == "load_case"


def test_a_total_force_is_shared_between_the_joints_a_boundary_catches(site, tmp_path):
    """`force_y` is the total on the stretch, not a value repeated at each joint.

    Asserted against the same load applied through a boundary catching one joint: the
    resultant must be identical, which is what makes a load case reusable on a lattice
    panelled differently.
    """
    _, one = run(site, {**SUPPORTS, "midspan": {"force_y": -30000.0}}, tmp_path)
    _, many = run(site, {**SUPPORTS, "deck": {"force_y": -30000.0}}, tmp_path)

    assert one["conditions"]["imposed_resultant"][1] == pytest.approx(-30000.0)
    assert many["conditions"]["imposed_resultant"][1] == pytest.approx(-30000.0)
    assert len(many["conditions"]["boundaries"]["deck"]["joints"]) == 9


def test_a_load_case_replaces_the_parameter_shorthand(site, tmp_path):
    """Total precedence, never a merge — the rule upstream set for the elasticity pair.

    The shorthand here pins two joints in the middle of the deck, which the load case says
    nothing about. A merge would show up as two extra restraints the caller never asked for — a
    stiffer bridge, propped where nothing was built, and nothing anywhere to say why.
    """
    _, report = run(
        site,
        {**SUPPORTS, "deck": {"load_y": DECK_LOAD}},
        tmp_path,
        fixed_joints=[3, 5],
        point_loads=[[4, 0.0, -50000.0]],
    )
    restrained = {tuple(entry) for entry in report["conditions"]["restrained"]}
    assert restrained == {(0, 0), (0, 1), (8, 1)}  # pin at joint 0, roller at joint 8
    # And the shorthand's 50 kN is nowhere in the resultant, which is the deck load alone.
    assert report["conditions"]["imposed_resultant"][1] == pytest.approx(DECK_LOAD * SPAN)


def test_the_shorthand_is_used_when_no_load_case_is_supplied(site, tmp_path):
    """Because a caller with no named boundaries should not have to author a geometry."""
    _, report = run(
        site,
        None,
        tmp_path,
        fixed_joints=[0],
        roller_joints=[8],
        point_loads=[[4, 0.0, -50000.0]],
    )
    assert report["conditions"]["source"] == "parameters"
    assert report["conditions"]["imposed_resultant"][1] == pytest.approx(-50000.0)


# ------------------------------------------------------------------------- the refusals


def test_a_boundary_that_catches_no_joint_is_refused(site, tmp_path):
    """A restraint on nothing solves happily and answers a different problem."""
    with pytest.raises(ValueError, match="no joint of this lattice lies on it"):
        run(site, {**SUPPORTS, "nowhere": {"fixed_x": 1.0}}, tmp_path)


def test_a_distributed_load_with_no_member_to_act_along_is_refused(site, tmp_path):
    """`load_y` needs a length. A boundary catching one joint has none."""
    with pytest.raises(ValueError, match="needs a length to act along"):
        run(site, {**SUPPORTS, "midspan": {"load_y": DECK_LOAD}}, tmp_path)


def test_a_lattice_that_folds_is_refused_with_the_joints_that_fold(site, tmp_path):
    """The deck on its own is a chain of collinear bars: it swings, so it has no answer."""
    with pytest.raises(ValueError, match="mechanism"):
        Truss2D().solve(
            site,
            Truss2D.Params(
                nodes=[(3.0 * i, 0.0) for i in range(9)],
                members=[(i, i + 1) for i in range(8)],
            ),
            SolverContext(
                lambda event: None,
                artifact_dir=tmp_path,
                conditions={**SUPPORTS, "deck": {"load_y": DECK_LOAD}},
            ),
        )


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"members": [[0, 99]]}, "outside the"),
        ({"members": [[0, 1], [1, 0]]}, "same pair of joints"),
        ({"members": [[2, 2]]}, "joins a joint to itself"),
        ({"fixed_joints": [99]}, "does not exist"),
        ({"point_loads": [[99, 0.0, -1.0]]}, "does not exist"),
    ],
)
def test_a_lattice_that_cannot_mean_anything_is_refused_at_submit(params, message):
    """In the params model, so a caller gets a 422 naming the field rather than a failed job."""
    nodes, members = warren(panels=2)
    payload = {"nodes": nodes, "members": members}
    payload.update(params)
    with pytest.raises(ValueError, match=message):
        Truss2D.Params(**payload)


# --------------------------------------------------------------------------- the answer


def test_every_declared_verification_runs_and_passes_on_a_real_lattice(loaded):
    """Four independent residuals, each against the tolerance the report states beside it."""
    _, report = loaded
    checks = report["verification"]
    for name in (
        "joint_equilibrium",
        "reaction_balance",
        "moment_balance",
        "energy_consistency",
    ):
        assert checks[f"{name}_rel"] <= checks[f"{name}_tolerance"], name
    assert checks["linear_residual"] <= checks["linear_residual_tolerance"]


def test_the_headline_metric_is_the_maximum_of_the_field_it_declares(loaded):
    """`utilisation_max` is declared as a reduction of `utilisation`, so it must be one.

    Upstream computes a declared reduction generically when an adapter does not supply it, and
    this adapter supplies it — a declaration that disagreed with the field would give two
    different numbers for one name depending on which route a caller took.
    """
    result, report = loaded
    published = result.data["point_fields"]["utilisation"]
    assert report["metrics"]["utilisation_max"] == pytest.approx(max(published))


def test_the_metrics_are_the_engineering_answer_and_the_stats_are_the_cost(loaded):
    """The contract's §7 line, asserted rather than trusted."""
    result, report = loaded
    assert set(result.stats) == {"cells", "dofs"}
    assert report["metrics"]["mass"] > 0
    assert report["metrics"]["span_ratio"] == pytest.approx(
        report["metrics"]["deflection_max"] / report["geometry"]["span"]
    )
    assert report["geometry"]["span"] == pytest.approx(SPAN)


def test_capacity_in_compression_is_the_lesser_of_yield_and_buckling(loaded):
    """The definition the exercise turns on, read back off the per-member table."""
    _, report = loaded
    members = report["members"]
    compressed = [index for index, flag in enumerate(members["compressed"]) if flag]
    assert compressed, "a simply supported truss has members in compression"

    worst = max(compressed, key=lambda index: members["utilisation"][index])
    critical = members["critical_load"][worst]
    squash = 250e6 * 2.6e-3
    assert critical < squash, "a 3 m bar of this section buckles long before it yields"
    assert members["utilisation"][worst] == pytest.approx(
        abs(members["force"][worst]) / (critical / 1.5), rel=1e-9
    )


def test_a_lattice_of_slender_bars_is_warned_about_buckling(site, tmp_path):
    """The warning names the threshold and the consequence, per the contract's §4."""
    _, report = run(site, {**SUPPORTS, "deck": {"load_y": DECK_LOAD}}, tmp_path, area=1.2e-3)
    warnings = report["validity"]["warnings"]
    assert any("Euler critical load" in text for text in warnings)
    assert report["metrics"]["buckling_margin_min"] < 1.0


def test_a_lattice_inside_every_limit_is_warned_about_nothing(loaded):
    """Silence has to be earned: this run crosses none of the four declared limits."""
    _, report = loaded
    assert report["validity"]["warnings"] == []


def test_a_member_through_the_shipping_channel_is_reported_as_unbuildable(site, tmp_path):
    """The one region property this capability reads, and what it costs to ignore it."""
    nodes, members = warren()
    nodes = list(nodes) + [(12.0, -3.0)]
    members = list(members) + [(2, len(nodes) - 1), (len(nodes) - 1, 4)]
    _, report = run(
        site, {**SUPPORTS, "deck": {"load_y": DECK_LOAD}}, tmp_path, nodes=nodes, members=members
    )
    assert report["geometry"]["fouled_members"]
    assert any("keeps clear" in text for text in report["validity"]["warnings"])


# ---------------------------------------------------------------------------- the picture


def test_the_result_draws_every_bar_as_a_quad_the_page_can_colour(loaded):
    """Four corners and two triangles a bar, with the value constant across each.

    Constant rather than interpolated, and asserted: a pin-jointed bar carries one force along
    its whole length, so a gradient down a member would be a picture of an assumption nobody
    made.
    """
    result, report = loaded
    count = report["geometry"]["member_count"]
    assert result.kind == "mesh2d"
    assert len(result.data["points"]) == 4 * count
    assert len(result.data["triangles"]) == 2 * count

    stress = np.asarray(result.data["point_fields"]["axial_stress"]).reshape(count, 4)
    assert np.allclose(stress, stress[:, :1])
    assert result.data["bounds"] == list(loaded[1]["geometry"]["bounds"])
    # The displacement travels as a vector field, which is what lets the workspace draw glyphs.
    assert len(result.data["point_vector_fields"]["displacement"]) == 4 * count


def test_the_bars_are_drawn_at_a_display_width_and_the_report_says_which(loaded):
    """Because a 2600 mm² bar is 58 mm across and the site is 32 m wide."""
    _, report = loaded
    assert report["geometry"]["bar_width"] == pytest.approx(32.0 / 150.0)


# ------------------------------------------------------------------------------ the wire


def test_the_exercise_runs_end_to_end_over_the_api(client, tmp_path):
    """The whole loop the page uses: submit with a load case, stream, fetch, read the report."""
    nodes, members = warren(panels=4)
    submitted = client.post(
        "/api/v1/jobs",
        json={
            "solver": "lab.truss2d",
            "geometry": {
                "type": "regions2d",
                "bounds": [-4.0, -8.0, 28.0, 12.0],
                "regions": [{"name": "left_bank", "shape": rect(-3.9, -7.9, 0.0, 0.0)}],
                "boundaries": [
                    {"name": "left", "select": {"type": "box", "bounds": [-0.3, -0.3, 0.3, 0.3]}},
                    {"name": "right", "select": {"type": "box", "bounds": [23.7, -0.3, 24.3, 0.3]}},
                    {"name": "deck", "select": {"type": "near", "axis": "y", "value": 0.0}},
                ],
            },
            "params": {"nodes": nodes, "members": members, "area": 3e-3},
            "conditions": {
                "left": {"fixed_x": 1, "fixed_y": 1},
                "right": {"fixed_y": 1},
                "deck": {"load_y": DECK_LOAD},
            },
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
    assert body["kind"] == "mesh2d"
    assert body["data"]["point_fields"]["utilisation"]

    artifact = next(entry for entry in body["artifacts"] if entry["name"] == "report.json")
    report = client.get(artifact["url"]).json()
    assert report["metrics"]["utilisation_max"] > 0
    assert report["conditions"]["source"] == "load_case"


def test_a_condition_key_the_capability_does_not_read_is_refused_at_submit(client):
    """Protocol 1.9's refusal, on this capability: a mistyped load must not be ignored."""
    nodes, members = warren(panels=2)
    submitted = client.post(
        "/api/v1/jobs",
        json={
            "solver": "lab.truss2d",
            "geometry": {
                "type": "regions2d",
                "bounds": [-4.0, -8.0, 28.0, 12.0],
                "regions": [{"name": "bank", "shape": rect(-3.9, -7.9, 0.0, 0.0)}],
                "boundaries": [
                    {"name": "left", "select": {"type": "box", "bounds": [-0.3, -0.3, 0.3, 0.3]}}
                ],
            },
            "params": {"nodes": nodes, "members": members},
            "conditions": {"left": {"traction_x": 1.0e6}},
        },
    )
    assert submitted.status_code == 422, submitted.text
    assert "traction_x" in submitted.text
