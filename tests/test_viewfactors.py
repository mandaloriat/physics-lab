"""The view-factor matrix, checked against algebra rather than against a reference solution.

``docs/exercises/heat-sink.md`` §8. These are the cheapest checks in the lab: the summation and
reciprocity identities hold at machine precision for any closed convex enclosure, so a
crossed-strings implementation that fails either one is wrong outright — no tolerance to argue
about, no reference data to trust. §12 says to build this matrix first for exactly that reason.
"""

import numpy as np
import pytest

from physics_lab.solvers.viewfactors import (
    Surface,
    enclosure_residuals,
    view_factor,
    view_factor_matrix,
)


def channel_enclosure(width: float, height: float, elements_per_side: int = 6) -> list[Surface]:
    """One fin channel as a closed enclosure: two flanks, the base strip, and the open mouth.

    The mouth is the fictitious black surface of §2.2 — the window onto the room that closes the
    enclosure. Without it the rows do not sum to one, which is the point the tests below make.
    """
    surfaces: list[Surface] = []

    def subdivide(x1, y1, x2, y2, name, count):
        for i in range(count):
            f0, f1 = i / count, (i + 1) / count
            surfaces.append(
                Surface(
                    x1 + (x2 - x1) * f0,
                    y1 + (y2 - y1) * f0,
                    x1 + (x2 - x1) * f1,
                    y1 + (y2 - y1) * f1,
                    name=name,
                )
            )

    subdivide(0.0, 0.0, 0.0, height, "left_flank", elements_per_side)
    subdivide(width, 0.0, width, height, "right_flank", elements_per_side)
    subdivide(0.0, 0.0, width, 0.0, "base", elements_per_side)
    subdivide(0.0, height, width, height, "mouth", elements_per_side)
    return surfaces


class TestIdentities:
    """Summation and reciprocity, which no correct matrix can miss."""

    @pytest.mark.parametrize(
        ("width", "height"),
        [(0.006, 0.025), (0.001, 0.040), (0.020, 0.005), (0.010, 0.010)],
    )
    def test_closed_channel_obeys_both_identities(self, width, height):
        surfaces = channel_enclosure(width, height)
        residuals = enclosure_residuals(surfaces, view_factor_matrix(surfaces))

        # Machine precision, not a tolerance: these are exact algebra for a convex enclosure.
        assert residuals["summation"] < 1e-12
        assert residuals["reciprocity"] < 1e-15

    def test_an_open_enclosure_fails_summation(self):
        """The mouth is not decoration — leave it out and the identity reports the hole.

        This is the test that gives the summation check its teeth. If it passed with the mouth
        removed, the check would be incapable of noticing a missing surface, which is precisely
        the mistake it exists to catch.
        """
        surfaces = [s for s in channel_enclosure(0.006, 0.025) if s.name != "mouth"]
        residuals = enclosure_residuals(surfaces, view_factor_matrix(surfaces))

        assert residuals["summation"] > 0.1
        # Reciprocity still holds: it is a property of each pair, not of the set being closed.
        assert residuals["reciprocity"] < 1e-15


class TestAgainstClosedForms:
    """Cases where the answer is known independently of this implementation."""

    def test_two_infinite_parallel_strips(self):
        """Hottel's own worked case: two equal parallel strips of width w, gap h.

        F = sqrt(1 + (h/w)^2) - h/w, the standard closed form for directly opposed strips. Note
        which way up the ratio goes: it is the *gap* over the width, so a wide pair close
        together exchanges almost everything and a narrow pair far apart exchanges almost
        nothing. Writing it upside down gives a plausible number that is wrong everywhere except
        h = w, which is the sort of error a single test case would miss.
        """
        for width, gap in [(0.02, 0.01), (0.005, 0.05), (0.03, 0.03)]:
            a = Surface(0.0, 0.0, width, 0.0)
            b = Surface(0.0, gap, width, gap)
            ratio = gap / width
            expected = np.sqrt(1.0 + ratio**2) - ratio
            assert view_factor(a, b) == pytest.approx(expected, rel=1e-12)

    def test_perpendicular_strips_sharing_an_edge(self):
        """Two equal perpendicular strips meeting at a corner: F = (2 - sqrt(2)) / 2.

        The corner case matters on its own account — a fin flank meets the base strip exactly
        like this, and it is where the endpoint-pairing logic is most likely to go wrong.
        """
        side = 0.01
        a = Surface(0.0, 0.0, side, 0.0)
        b = Surface(0.0, 0.0, 0.0, side)
        assert view_factor(a, b) == pytest.approx((2.0 - np.sqrt(2.0)) / 2.0, rel=1e-12)

    def test_a_tall_narrow_channel_sends_almost_everything_across(self):
        """The limit §2.2 leans on: narrow the channel and a flank sees only the other flank.

        This is the mechanism, in one assertion. As the gap closes, the view factor from one
        flank to the facing flank approaches one, so nearly nothing escapes to the mouth — which
        is why radiation stops paying as fins are packed together.
        """
        tall = 0.050
        wide_gap = view_factor(
            Surface(0.0, 0.0, 0.0, tall), Surface(0.020, 0.0, 0.020, tall)
        )
        narrow_gap = view_factor(
            Surface(0.0, 0.0, 0.0, tall), Surface(0.001, 0.0, 0.001, tall)
        )
        assert narrow_gap > 0.95
        assert wide_gap < narrow_gap


class TestDegenerateGeometry:
    """The cases that would otherwise return noise."""

    def test_collinear_surfaces_see_nothing(self):
        """Zero to round-off, and deliberately not asserted as exactly zero.

        For collinear surfaces the two string pairings are equal *in exact arithmetic*, so the
        difference is pure floating-point noise — around 1e-16 here. The implementation could
        snap that to zero with a threshold, and does not: a magic epsilon in the view factor
        would sit permanently between the caller and any genuinely small exchange, to hide a
        quantity that is already fifteen orders below anything that matters. The identities in
        :class:`TestIdentities` still close at 1e-12 with the noise left in, which is the
        evidence that leaving it alone costs nothing. Every element along one fin flank is
        collinear with every other, so this is the common case, not a corner.
        """
        a = Surface(0.0, 0.0, 0.01, 0.0)
        b = Surface(0.02, 0.0, 0.03, 0.0)
        assert abs(view_factor(a, b)) < 1e-15

    def test_a_surface_does_not_see_itself(self):
        surfaces = channel_enclosure(0.006, 0.025, elements_per_side=3)
        matrix = view_factor_matrix(surfaces)
        assert np.all(np.diag(matrix) == 0.0)

    def test_every_view_factor_is_a_fraction(self):
        surfaces = channel_enclosure(0.006, 0.025)
        matrix = view_factor_matrix(surfaces)
        assert matrix.min() >= 0.0
        assert matrix.max() <= 1.0

    def test_a_zero_length_surface_is_inert(self):
        """Guards the N = 1 degenerate case, where a channel has no width at all."""
        point = Surface(0.0, 0.0, 0.0, 0.0)
        real = Surface(0.0, 0.01, 0.01, 0.01)
        assert view_factor(point, real) == 0.0
        assert view_factor(real, point) == 0.0


class TestRefinementIsExact:
    """Subdividing a surface must not change what it exchanges — there is no discretisation
    error to converge here, and a test that pins that down stops anyone adding one later."""

    def test_subdivision_leaves_the_total_unchanged(self):
        coarse = view_factor(
            Surface(0.0, 0.0, 0.02, 0.0), Surface(0.0, 0.01, 0.02, 0.01)
        )

        # The same exchange, with the source split into ten pieces and recombined by length.
        pieces = [Surface(i * 0.002, 0.0, (i + 1) * 0.002, 0.0) for i in range(10)]
        target = Surface(0.0, 0.01, 0.02, 0.01)
        weighted = sum(p.length * view_factor(p, target) for p in pieces)
        fine = weighted / sum(p.length for p in pieces)

        assert fine == pytest.approx(coarse, rel=1e-12)
