"""Closed-form aerodynamics: the answers the panel method is checked against.

Shipped rather than kept in the test suite, because one of them is shown on the page. Thin
airfoil theory is computed on every run and reported beside the solved coefficients, so a
visitor sees the reference and the result side by side (``docs/exercises/airfoil.md`` §8.3).
The Joukowski solution is the suite's, and it is the strongest check in the lab: it is the
only exact solution for a *lifting* body with a sharp trailing edge, so it validates the
Kutta condition itself and not merely the Laplace solve (§8.2).
"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ThinAirfoil:
    """The asymptotic reference for a camber line, in the limit of vanishing thickness."""

    alpha_l0: float  #: zero-lift incidence, radians
    cm_c4: float  #: moment coefficient about the quarter chord, nose-up positive
    lift_slope: float = 2.0 * np.pi  #: per radian, exactly 2*pi in this theory

    def lift_coefficient(self, alpha: float) -> float:
        return self.lift_slope * (alpha - self.alpha_l0)


def thin_airfoil(station: np.ndarray, camber: np.ndarray) -> ThinAirfoil:
    """Thin-airfoil theory for an arbitrary camber line.

    ``station`` is x/c and ``camber`` is the mean line in fractions of chord — the pair
    :func:`physics_lab.solvers.airfoil_geometry.read_profile` extracts from an outline, so
    this works for a shape a visitor dragged as well as for a catalogue profile.

    With x/c = (1 - cos θ)/2,

        α_L0   = -(1/π) ∫ (dz/dx)(cos θ - 1) dθ
        A_n    =  (2/π) ∫ (dz/dx) cos nθ dθ
        C_m,c4 =  (π/4) (A_2 - A_1)

    The slope is taken from the sampled camber line rather than assumed analytic. Noise in
    it near the leading edge — where an extracted mean line is least reliable, because both
    surfaces are steep there — is suppressed in α_L0 by its own weight, which vanishes at
    θ = 0.
    """
    x = np.asarray(station, dtype=float)
    z = np.asarray(camber, dtype=float)
    if x.shape != z.shape or len(x) < 8:
        raise ValueError("station and camber must be the same shape, with enough points")

    theta = np.arccos(np.clip(1.0 - 2.0 * x, -1.0, 1.0))
    slope = np.gradient(z, x)

    alpha_l0 = -np.trapezoid(slope * (np.cos(theta) - 1.0), theta) / np.pi
    a1 = 2.0 * np.trapezoid(slope * np.cos(theta), theta) / np.pi
    a2 = 2.0 * np.trapezoid(slope * np.cos(2.0 * theta), theta) / np.pi
    return ThinAirfoil(alpha_l0=float(alpha_l0), cm_c4=float(np.pi / 4.0 * (a2 - a1)))


@dataclass(frozen=True)
class Joukowski:
    """A conformally mapped profile and its exact lifting solution.

    The Joukowski map ``z = ζ + b²/ζ`` takes a circle of radius ``R`` centred at ``ζ0`` and
    passing through ``ζ = b`` to a profile with a sharp trailing edge at ``z = 2b``. The
    Kutta condition is the statement that ``ζ = b`` is a stagnation point, which fixes the
    circulation in closed form.

    ``tau`` generalises it to **Kármán–Trefftz**, whose trailing edge closes at a finite
    included angle instead of a cusp:

        (z - k b)/(z + k b) = ((ζ - b)/(ζ + b))^k,    k = 2 - tau/pi

    That generalisation is nearly free — the flow around the circle is unchanged, so the
    circulation is the same closed form and only the map differs — and it matters for
    verification. A Joukowski cusp is the *hardest* trailing edge a panel method can be asked
    to resolve: the two surfaces arrive parallel, and straight panels converge on it only at
    first order. Every profile the exercise actually offers has a finite wedge angle (about
    16° for a 12 %-thick four-digit section), so a Kármán–Trefftz case with ``tau`` set to
    match is both an exact solution *and* representative of the geometry in use. The cusp is
    kept as the deliberately unfavourable case.
    """

    b: float
    centre: complex
    radius: float
    outline: np.ndarray  #: closed, clockwise, in the z plane
    chord: float
    trailing_edge: complex
    tau: float = 0.0  #: trailing-edge included angle, radians; 0 is the Joukowski cusp

    @property
    def beta(self) -> float:
        """The camber angle: minus the argument of the trailing edge's preimage."""
        return -float(np.angle(self.b - self.centre))

    def circulation(self, u_inf: float, alpha: float) -> float:
        """Clockwise-positive circulation, ``4 π U R sin(α + β)``."""
        return 4.0 * np.pi * u_inf * self.radius * np.sin(alpha + self.beta)

    def lift_coefficient(self, alpha: float) -> float:
        """``C_L = 2Γ/(U c)`` — Kutta–Joukowski, with the chord measured on the profile."""
        return 2.0 * self.circulation(1.0, alpha) / self.chord

    def map_to_z(self, zeta: np.ndarray) -> np.ndarray:
        """The conformal map, Joukowski when ``tau`` is zero and Kármán–Trefftz otherwise."""
        if self.tau == 0.0:
            return zeta + self.b**2 / zeta
        k = 2.0 - self.tau / np.pi
        w = ((zeta - self.b) / (zeta + self.b)) ** k
        return k * self.b * (1.0 + w) / (1.0 - w)

    def _dz_dzeta(self, zeta: np.ndarray) -> np.ndarray:
        if self.tau == 0.0:
            return 1.0 - self.b**2 / zeta**2
        k = 2.0 - self.tau / np.pi
        w = ((zeta - self.b) / (zeta + self.b)) ** k
        return 4.0 * k**2 * self.b**2 * w / ((1.0 - w) ** 2 * (zeta**2 - self.b**2))

    def surface_cp(self, alpha: float, samples: int = 400) -> tuple[np.ndarray, np.ndarray]:
        """``(z, C_p)`` around the profile, skipping the trailing edge.

        The trailing edge is skipped because ``dz/dζ`` vanishes there — it is the map's
        critical point, which is exactly what makes the corner — so the exact solution is a
        finite 0/0 limit that says nothing about the panel method's accuracy anywhere else.
        """
        theta = np.linspace(0.0, 2.0 * np.pi, samples, endpoint=False)
        zeta = self.centre + self.radius * np.exp(1j * theta)
        zeta = zeta[np.abs(zeta - self.b) > 1e-3 * self.radius]

        gamma_ccw = -self.circulation(1.0, alpha)
        dw = (
            np.exp(-1j * alpha)
            - np.exp(1j * alpha) * self.radius**2 / (zeta - self.centre) ** 2
            - 1j * gamma_ccw / (2.0 * np.pi * (zeta - self.centre))
        )
        speed = np.abs(dw / self._dz_dzeta(zeta))
        return self.map_to_z(zeta), 1.0 - speed**2


def joukowski(
    b: float = 0.25,
    eps: float = 0.08,
    delta: float = 0.05,
    samples: int = 720,
    te_angle: float = 0.0,
) -> Joukowski:
    """Build a mapped profile. ``eps`` sets thickness, ``delta`` camber, ``te_angle`` the wedge.

    ``te_angle`` is in degrees, for the same reason every angle at an interface in this
    repository is: nobody specifies a trailing edge in radians.
    """
    centre = complex(-eps * b, delta * b)
    radius = float(abs(b - centre))
    tau = np.radians(te_angle)

    # Clockwise in z: the map is conformal and orientation-preserving, so traverse the circle
    # clockwise too.
    theta = -np.linspace(0.0, 2.0 * np.pi, samples + 1)
    zeta = centre + radius * np.exp(1j * theta)

    shape = Joukowski(b, centre, radius, np.empty((0, 2)), 0.0, complex(0.0), tau)
    z = shape.map_to_z(zeta)
    outline = np.column_stack([z.real, z.imag])
    outline[-1] = outline[0]

    trailing = complex(z[0])
    chord = float(np.max(np.abs(z - trailing)))
    return Joukowski(b, centre, radius, outline, chord, trailing, tau)


def cylinder_cp(theta: np.ndarray, u_inf: float, radius: float, circulation: float) -> np.ndarray:
    """Exact surface pressure on a circular cylinder with clockwise circulation.

    ``C_p = 1 - (2 sin θ + Γ/(2πa U))²``, the textbook result, written with the same
    clockwise-positive circulation convention the panel solver uses.
    """
    speed = 2.0 * u_inf * np.sin(theta) + circulation / (2.0 * np.pi * radius)
    return 1.0 - (speed / u_inf) ** 2
