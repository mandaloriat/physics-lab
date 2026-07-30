"""Turning an outline into panels, and reading the profile back out of it.

The solver receives a polygon, not a set of parameters — a dragged shape has no parameters,
and giving the catalogue profiles their own code path would mean the interesting case is the
one that is never exercised. So everything the metrics need (chord, incidence, camber line,
thickness) is *derived from the outline*, and the derivation is the same for a NACA profile
and for something a visitor dragged into being. See ``docs/exercises/airfoil.md`` §4.3.

The NACA generator here exists for the same reason in reverse: the catalogue is generated in
the browser, but the verification suite must build profiles without a browser, and both have
to agree on what "NACA 2412" means.
"""

from dataclasses import dataclass

import numpy as np

#: Closed-trailing-edge coefficient. The published four-digit polynomial ends in −0.1015,
#: which leaves about 0.25 % of chord of thickness at x = 1; −0.10360 closes it. Which one
#: is right depends on what the geometry is *for*, and here it is for a Kutta condition
#: applied at a trailing edge, so closed is the default (§4.2).
_TE_CLOSED = 0.10360
_TE_OPEN = 0.1015


def naca4_thickness(x: np.ndarray, t: float, closed: bool = True) -> np.ndarray:
    """Half-thickness distribution of a four-digit profile, on a unit chord."""
    last = _TE_CLOSED if closed else _TE_OPEN
    return (
        5.0 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 - last * x**4)
    )


def naca4_camber(x: np.ndarray, m: float, p: float) -> tuple[np.ndarray, np.ndarray]:
    """Mean line and its slope. Two polynomials, joined at the position of maximum camber.

    ``p`` is a real input, not the 0.4 the lab's first implementation hard-coded — which is
    why a NACA 2312 could not be expressed at all before (§4.1).
    """
    x = np.asarray(x, dtype=float)
    if m == 0.0:
        return np.zeros_like(x), np.zeros_like(x)
    if not 0.0 < p < 1.0:
        raise ValueError(f"maximum-camber position must lie strictly inside the chord: {p}")
    fore = x < p
    y = np.where(
        fore,
        (m / p**2) * (2 * p * x - x**2),
        (m / (1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x**2),
    )
    slope = np.where(fore, (2 * m / p**2) * (p - x), (2 * m / (1 - p) ** 2) * (p - x))
    return y, slope


def naca4_outline(
    m: float, p: float, t: float, per_surface: int = 120, closed_te: bool = True
) -> np.ndarray:
    """A four-digit profile as a closed, clockwise outline on a unit chord.

    Ordered the way :mod:`physics_lab.solvers.panel` needs it: from the trailing edge along
    the lower surface to the leading edge, then along the upper surface back to the trailing
    edge, with the first node repeated at the end.
    """
    beta = np.linspace(0.0, np.pi, per_surface + 1)
    x = 0.5 * (1.0 - np.cos(beta))  # cosine spacing: dense where the curvature is
    yc, slope = naca4_camber(x, m, p)
    theta = np.arctan(slope)
    yt = naca4_thickness(x, t, closed_te)

    upper = np.column_stack([x - yt * np.sin(theta), yc + yt * np.cos(theta)])
    lower = np.column_stack([x + yt * np.sin(theta), yc - yt * np.cos(theta)])
    return _close(lower, upper, closed_te)


def _close(lower: np.ndarray, upper: np.ndarray, closed_te: bool) -> np.ndarray:
    """Assemble two surfaces into one closed clockwise outline: TE → lower → LE → upper → TE.

    The two cases differ by one vertex, and getting it wrong is not a rounding error. With a
    **closed** trailing edge the two surfaces end at the same point, so that point appears
    *once* as the first node and the outline closes back onto it — emitting it twice would
    leave a zero-length panel, which is a singular row in the influence matrix and a
    ``duplicate consecutive points`` rejection from the protocol's polygon validator. With an
    **open** trailing edge the two ends are distinct, and the closing edge is the base panel
    the Kutta condition then has to straddle (§4.2).
    """
    if closed_te:
        tail = 0.5 * (lower[-1:] + upper[-1:])
        nodes = np.vstack([tail, lower[::-1][1:], upper[1:-1]])
    else:
        nodes = np.vstack([lower[::-1], upper[1:]])
    return np.vstack([nodes, nodes[:1]])


@dataclass(frozen=True)
class Profile:
    """An outline read as an airfoil: where its chord is, and what its section looks like."""

    outline: np.ndarray  #: as given, closed and clockwise
    chord_frame: (
        np.ndarray
    )  #: the same outline with the leading edge at the origin and the chord along +x
    chord: float  #: metres
    chord_angle: float  #: radians, the chord line's angle in the submitted frame
    leading_edge: np.ndarray
    trailing_edge: np.ndarray
    te_gap: float  #: trailing-edge thickness, in metres
    station: np.ndarray  #: (M+1,) x/c, cosine-spaced
    camber: np.ndarray  #: (M+1,) camber line, in fractions of chord
    thickness: np.ndarray  #: (M+1,) thickness, in fractions of chord
    single_valued: bool  #: whether both surfaces are functions of x/c, so the section is readable


def _sharpness(outline: np.ndarray, index: int, span: float) -> float:
    """The included angle at a vertex, measured over a finite span of the outline.

    Measured over a span rather than between neighbouring vertices because neighbouring
    vertices of a finely sampled spline say almost nothing about the shape of a corner.
    """
    poly = outline[:-1]
    n = len(poly)
    length = np.hypot(*np.diff(np.vstack([poly, poly[:1]]), axis=0).T)
    step = max(1, int(round(span / max(length.mean(), 1e-12))))
    before = poly[(index - step) % n] - poly[index % n]
    after = poly[(index + step) % n] - poly[index % n]
    cosine = np.dot(before, after) / (np.linalg.norm(before) * np.linalg.norm(after) + 1e-30)
    return float(np.arccos(np.clip(cosine, -1.0, 1.0)))


def read_profile(outline: np.ndarray, stations: int = 60) -> Profile:
    """Read chord, incidence reference and section shape out of an outline.

    The chord is the outline's own longest diagonal, which for anything wing-shaped is the
    leading-edge-to-trailing-edge line. Of its two ends, the trailing edge is the **sharper**
    one — a frame-independent test, and the physically right one, since a trailing edge is a
    corner and a leading edge is a nose. Falling back to "furthest downstream" would assume
    the visitor left the profile pointing the way it was found.
    """
    xy = np.asarray(outline, dtype=float)
    if not np.allclose(xy[0], xy[-1]):
        xy = np.vstack([xy, xy[:1]])
    poly = xy[:-1]

    # Longest diagonal. O(V^2) on a few hundred vertices is microseconds, and an approximate
    # diameter would put the chord in the wrong place on a profile with a blunt base.
    gaps = np.linalg.norm(poly[:, None, :] - poly[None, :, :], axis=-1)
    # Converted to plain ints at the boundary: `unravel_index` hands back NumPy integers, and
    # everything downstream — the sharpness comparison, the chain slicing — is written against
    # Python indices.
    i, j = (int(index) for index in np.unravel_index(int(np.argmax(gaps)), gaps.shape))
    chord = float(gaps[i, j])

    span = 0.03 * chord
    te_index, le_index = (i, j) if _sharpness(xy, i, span) < _sharpness(xy, j, span) else (j, i)
    trailing, leading = poly[te_index], poly[le_index]

    chord_angle = float(np.arctan2(*(trailing - leading)[::-1]))
    rotation = np.array(
        [
            [np.cos(-chord_angle), -np.sin(-chord_angle)],
            [np.sin(-chord_angle), np.cos(-chord_angle)],
        ]
    )
    framed = (xy - leading) @ rotation.T

    # Split at the two ends into the two surfaces, then read the section off them.
    first, second = sorted([te_index, le_index])
    chain_a = framed[first : second + 1]
    chain_b = np.vstack([framed[second:-1], framed[: first + 1]])
    upper, lower = (
        (chain_a, chain_b) if chain_a[:, 1].mean() > chain_b[:, 1].mean() else (chain_b, chain_a)
    )

    beta = np.linspace(0.0, np.pi, stations + 1)
    station = 0.5 * (1.0 - np.cos(beta))
    y_up, ok_up = _surface_at(upper, station * chord)
    y_low, ok_low = _surface_at(lower, station * chord)

    camber = 0.5 * (y_up + y_low) / chord
    thickness = (y_up - y_low) / chord
    te_gap = float(abs(framed[0, 1] - framed[-2, 1])) if len(framed) > 2 else 0.0

    return Profile(
        outline=xy,
        chord_frame=framed,
        chord=chord,
        chord_angle=chord_angle,
        leading_edge=leading,
        trailing_edge=trailing,
        station=station,
        camber=camber,
        thickness=thickness,
        te_gap=min(te_gap, chord),
        single_valued=bool(ok_up and ok_low),
    )


def _surface_at(surface: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, bool]:
    """Interpolate one surface at the requested chordwise stations.

    Reports whether the surface really was a function of ``x``. An outline dragged into an
    overhang is not, and the honest response is to say the section cannot be read rather
    than to interpolate through a fold and report a thickness that is not there.
    """
    step = np.diff(surface[:, 0])
    single_valued = bool(np.all(step >= -1e-12) or np.all(step <= 1e-12))

    order = np.argsort(surface[:, 0])
    xs, ys = surface[order, 0], surface[order, 1]
    keep = np.concatenate([[True], np.diff(xs) > 1e-12])
    return np.interp(x, xs[keep], ys[keep]), single_valued


def resample(profile: Profile, panels: int, closed_te: bool = True) -> np.ndarray:
    """Panel nodes in the **chord frame**: cosine-clustered, clockwise, closed.

    Resampling rather than panelling the outline as given is what makes the panel count a
    numerical setting the visitor controls (§7.1) instead of a property of however densely
    the geometry widget happened to sample its spline. Solving in the chord frame is what
    makes incidence the free stream's angle to the chord, which is what it means.
    """
    if panels < 8:
        raise ValueError(f"at least 8 panels are needed, asked for {panels}")
    per_surface = max(4, panels // 2)
    beta = np.linspace(0.0, np.pi, per_surface + 1)
    x = 0.5 * (1.0 - np.cos(beta)) * profile.chord

    half = np.interp(x, profile.station * profile.chord, 0.5 * profile.thickness * profile.chord)
    mean = np.interp(x, profile.station * profile.chord, profile.camber * profile.chord)
    upper = np.column_stack([x, mean + half])
    lower = np.column_stack([x, mean - half])
    if closed_te:
        upper[-1, 1] = lower[-1, 1] = mean[-1]
    return _close(lower, upper, closed_te)
