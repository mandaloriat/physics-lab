"""The airfoil exercise: coefficients, sweeps, verification and validity.

Everything between "a panel solve finished" and "here is the engineering answer, and how far
to trust it". Kept out of the Fenix Spoon adapter so that it can be tested without a job, a
server or a protocol, and kept out of :mod:`physics_lab.solvers.panel` because a moment about
the quarter chord is an airfoil's idea, not a panel method's.

Specification: ``docs/exercises/airfoil.md``. Section numbers in the comments refer to it.
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from .airfoil_geometry import Profile, resample
from .analytic import ThinAirfoil
from .panel import PanelSolution, solve_sweep

#: Below this normal-force coefficient the centre of pressure is not reported at all. It is
#: not a numerical tolerance but a fact about the quantity: x_cp = 0.25 - C_m/C_N runs off to
#: infinity as the normal force vanishes, so near zero lift the honest answer is that the
#: profile has no centre of pressure rather than one a long way behind the tail (§10.3).
CN_FLOOR = 0.05

#: Thin-airfoil theory predicts a lift-curve slope of exactly 2*pi. A panel method finds a
#: few per cent more, because thickness raises it and thin-airfoil theory has none. The band
#: is what the page compares against, and a result outside it is a warning about the
#: *comparison* rather than a failed solve (§8.3).
SLOPE_BAND = (2.0 * np.pi, 1.15 * 2.0 * np.pi)


@dataclass(frozen=True)
class Coefficients:
    """The engineering answer for one incidence. Every value dimensionless unless named."""

    alpha_deg: float  #: incidence of the free stream to the chord line, as derived (§4.3)
    c_l: float  #: from the circulation, via Kutta-Joukowski
    c_l_pressure: float  #: from integrating the surface pressure — the independent route
    c_m_c4: float  #: about the quarter chord, nose-up positive
    c_n: float  #: chord-normal force
    c_a_spurious: float  #: chordwise force, which is zero in exact potential flow (§8.5)
    circulation: float  #: m^2/s, clockwise-positive
    l_prime: float  #: N/m, sectional lift
    cp_min: float
    cp_min_station: float  #: x/c where the suction peak sits
    x_cp_over_c: float | None  #: None when the normal force is too small to define it


def coefficients(solution: PanelSolution, chord: float, rho: float) -> Coefficients:
    """Integrate one solve into coefficients, in the chord frame it was solved in.

    Two independent routes to the lift are computed and both are kept: the circulation route
    (Kutta–Joukowski) and the pressure route (integrating ``-p n`` around the surface). They
    share the solution and nothing else, so their agreement is the verification residual that
    costs nothing and catches most of what can go wrong (§8.4).
    """
    geo = solution.geometry
    q_inf = 0.5 * rho * solution.u_inf**2

    # Force per unit span, divided by q_inf: -sum(Cp * n * ds).
    load = -(solution.cp * geo.length)[:, None] * geo.normal
    force = load.sum(axis=0)

    alpha = solution.alpha
    lift_axis = np.array([-np.sin(alpha), np.cos(alpha)])
    drag_axis = np.array([np.cos(alpha), np.sin(alpha)])

    # Moment about the quarter chord. Positive nose-up is *clockwise* in a frame with x aft
    # and y up — a counterclockwise rotation lifts the tail — so the conventional coefficient
    # is minus the z component of the cross product.
    arm = geo.control - np.array([0.25 * chord, 0.0])
    moment_ccw = float(np.sum(arm[:, 0] * load[:, 1] - arm[:, 1] * load[:, 0]))

    c_l = 2.0 * solution.circulation / (solution.u_inf * chord)
    c_n = float(force[1]) / chord
    c_m_c4 = -moment_ccw / chord**2
    peak = int(np.argmin(solution.cp))

    return Coefficients(
        alpha_deg=float(np.degrees(alpha)),
        c_l=float(c_l),
        c_l_pressure=float(force @ lift_axis / chord),
        c_m_c4=float(c_m_c4),
        c_n=c_n,
        c_a_spurious=float(force @ drag_axis / chord),
        circulation=float(solution.circulation),
        l_prime=float(c_l * q_inf * chord),
        cp_min=float(solution.cp[peak]),
        cp_min_station=float(geo.control[peak, 0] / chord),
        x_cp_over_c=(0.25 - c_m_c4 / c_n) if abs(c_n) >= CN_FLOOR else None,
    )


def surface_curves(solution: PanelSolution, chord: float) -> dict[str, list[list[float]]]:
    """``C_p`` against x/c, split into the two surfaces.

    Split at the leading edge — the node of least x — rather than at a panel index the
    outline assembly happens to produce, so that the split survives a change of panelling.
    """
    geo = solution.geometry
    station = geo.control[:, 0] / chord
    le = int(np.argmin(geo.nodes[:-1, 0]))
    lower = slice(0, le)
    upper = slice(le, geo.count)
    return {
        "cp_lower": np.column_stack([station[lower], solution.cp[lower]])[::-1].tolist(),
        "cp_upper": np.column_stack([station[upper], solution.cp[upper]]).tolist(),
    }


@dataclass(frozen=True)
class Sweep:
    """What several incidences say that one cannot."""

    alpha_deg: list[float]
    c_l: list[float]
    c_m_c4: list[float]
    x_cp_over_c: list[float | None]
    lift_slope: float  #: dC_L/dalpha, per radian
    alpha_l0_deg: float  #: the sweep's own zero-lift incidence
    x_ac_over_c: float  #: 0.25 - dC_m/dC_L
    x_ac_fit_r2: float  #: how straight the C_m against C_L line was


def sweep(profile: Profile, panels: int, u_inf: float, rho: float, alphas_deg, **kwargs) -> Sweep:
    """Solve an incidence sweep and reduce it to the quantities that need one.

    The aerodynamic centre is the point about which the moment does not change with
    incidence, so it is a property of *several* solves and the page must not offer it after
    one (§7.3). It comes from the regression of ``C_m,c/4`` against ``C_L``, and the fit's
    R^2 is reported beside it because a fit through a curve is not a point.
    """
    angles = np.radians(np.asarray(alphas_deg, dtype=float))
    solutions = solve_sweep(resample(profile, panels, **kwargs), u_inf, angles, **{})
    rows = [coefficients(s, profile.chord, rho) for s in solutions]

    c_l = np.array([r.c_l for r in rows])
    c_m = np.array([r.c_m_c4 for r in rows])
    slope, intercept = np.polyfit(angles, c_l, 1)
    moment_slope, moment_intercept = np.polyfit(c_l, c_m, 1)

    predicted = moment_slope * c_l + moment_intercept
    spread = float(np.sum((c_m - c_m.mean()) ** 2))
    r2 = 1.0 - float(np.sum((c_m - predicted) ** 2)) / spread if spread > 0 else 1.0

    return Sweep(
        alpha_deg=[r.alpha_deg for r in rows],
        c_l=c_l.tolist(),
        c_m_c4=c_m.tolist(),
        x_cp_over_c=[r.x_cp_over_c for r in rows],
        lift_slope=float(slope),
        alpha_l0_deg=float(np.degrees(-intercept / slope)) if slope != 0 else float("nan"),
        x_ac_over_c=float(0.25 - moment_slope),
        x_ac_fit_r2=r2,
    )


@dataclass
class Verification:
    """Every check, as a number with the tolerance it is read against (§8)."""

    cl_consistency_rel: float
    cl_consistency_tolerance: float = 0.02
    circulation_consistency_rel: float = 0.0
    cd_pressure_spurious: float = 0.0
    cd_pressure_tolerance: float = 0.002
    cl_convergence_rel: float | None = None
    cl_convergence_tolerance: float = 0.005
    thin_airfoil_alpha_l0_deg: float = 0.0
    thin_airfoil_cm_c4: float = 0.0
    lift_slope_band: tuple[float, float] = SLOPE_BAND

    @property
    def passed(self) -> bool:
        checks = [
            self.cl_consistency_rel <= self.cl_consistency_tolerance,
            self.cd_pressure_spurious <= self.cd_pressure_tolerance,
            self.cl_convergence_rel is None
            or self.cl_convergence_rel <= self.cl_convergence_tolerance,
        ]
        return all(checks)


def verify(
    coeff: Coefficients,
    solution: PanelSolution,
    reference: ThinAirfoil,
    coarse: Coefficients | None = None,
) -> Verification:
    """Assemble the residuals. ``coarse`` is the same case at half the panels, if it was run."""
    scale = max(abs(coeff.c_l), CN_FLOOR)
    circulation_scale = max(abs(solution.circulation), 1e-9)
    return Verification(
        cl_consistency_rel=abs(coeff.c_l - coeff.c_l_pressure) / scale,
        circulation_consistency_rel=abs(solution.circulation - solution.circulation_surface)
        / circulation_scale,
        cd_pressure_spurious=abs(coeff.c_a_spurious),
        cl_convergence_rel=None if coarse is None else abs(coeff.c_l - coarse.c_l) / scale,
        thin_airfoil_alpha_l0_deg=float(np.degrees(reference.alpha_l0)),
        thin_airfoil_cm_c4=reference.cm_c4,
    )


@dataclass(frozen=True)
class Conditions:
    """The physical situation, as the page resolved it before submitting (§5)."""

    u_inf: float
    rho: float
    mu: float
    sound_speed: float
    chord: float

    @property
    def reynolds(self) -> float:
        return self.rho * self.u_inf * self.chord / self.mu

    @property
    def mach(self) -> float:
        return self.u_inf / self.sound_speed

    @property
    def dynamic_pressure(self) -> float:
        return 0.5 * self.rho * self.u_inf**2


def validity(
    coeff: Coefficients,
    conditions: Conditions,
    profile: Profile,
    reference: ThinAirfoil,
    checks: Verification,
    lifting: bool,
    te_as_drawn: bool,
) -> list[str]:
    """Which stated limits this run crossed, and what crossing each one means (§9).

    Every warning names the threshold and the consequence. "Results are approximate" is not a
    warning; "Mach 0.42 is past the 0.3 limit of the incompressible assumption, so real
    pressures would differ by more than the numbers on screen" is.
    """
    out: list[str] = []
    mach = conditions.mach

    if mach > 0.3:
        out.append(
            f"Mach {mach:.2f} is past the 0.3 limit of the incompressible assumption: real "
            "pressures would differ from these by more than the difference between profiles."
        )
    local = mach * np.sqrt(max(1.0 - coeff.cp_min, 0.0))
    if local > 0.7:
        out.append(
            f"The suction peak implies a local Mach of about {local:.2f}. Estimated from the "
            "incompressible speed, so it is an indication, not a prediction — but past 0.7 a "
            "real section is heading for a shock this model cannot represent."
        )
    if lifting:
        margin = abs(coeff.alpha_deg - np.degrees(reference.alpha_l0))
        if margin > 10.0 or coeff.c_l > 1.4:
            out.append(
                f"{margin:.1f}° past the zero-lift incidence, C_L = {coeff.c_l:.2f}: a real "
                "section here would very likely be separated. This model has no stall and "
                "will keep producing orderly lift as far as you push it."
            )
    else:
        out.append(
            "The Kutta condition is off, so there is no circulation and the lift is zero by "
            "construction. That is the model, not a fault — it is what this page computed "
            "before the exercise had one."
        )
        if abs(coeff.alpha_deg) > 0.5:
            # Worth naming rather than leaving as a large residual: without the Kutta
            # condition the flow turns the sharp trailing edge, so the velocity there is
            # *infinite*. The peak deepens without limit as panels are added, which is why the
            # d'Alembert residual for this model does not converge either. It is also the
            # clearest possible answer to "why impose a Kutta condition at all".
            out.append(
                f"With no circulation the flow has to turn the sharp trailing edge, so the "
                f"velocity there is unbounded: the suction peak of C_p = {coeff.cp_min:.0f} at "
                "the trailing edge is not converging to anything, and neither is the residual "
                "below. Turning the Kutta condition on is what removes it."
            )
    if te_as_drawn and profile.te_gap / profile.chord > 0.002:
        out.append(
            f"The trailing edge is open by {100 * profile.te_gap / profile.chord:.2f} % of "
            "chord. The Kutta condition then depends on how the base is closed, so C_L "
            "carries an extra uncertainty that closing the profile removes."
        )
    if checks.cl_convergence_rel is not None and (
        checks.cl_convergence_rel > checks.cl_convergence_tolerance
    ):
        out.append(
            f"C_L moved {100 * checks.cl_convergence_rel:.1f} % when the panel count doubled, "
            "past the 0.5 % the exercise asks for. Add panels before believing this number."
        )
    if checks.cl_consistency_rel > checks.cl_consistency_tolerance:
        out.append(
            f"Lift from the circulation and lift from the integrated pressure disagree by "
            f"{100 * checks.cl_consistency_rel:.1f} %. That is a suspect solve rather than a "
            "coarse one: the two routes share the solution and nothing else."
        )
    if profile.thickness.max() > 0.25:
        out.append(
            f"The section is {100 * profile.thickness.max():.0f} % thick. Thin-airfoil theory "
            "is not a useful comparison here, and the panelling is poorly conditioned."
        )
    if not profile.single_valued:
        out.append(
            "One surface folds back on itself, so the camber line and thickness could not be "
            "read and the thin-airfoil comparison is unavailable. The panel solve is still "
            "valid: it needs the outline, not the section."
        )
    if conditions.reynolds < 1e5:
        out.append(
            f"Reynolds number {conditions.reynolds:.2e}. Nothing in this model depends on it — "
            "which is the point: a real section this low behaves qualitatively differently, "
            "and the model cannot tell you so."
        )
    return out


@dataclass
class Report:
    """The whole answer, as the ``report.json`` artifact carries it (§11).

    Shaped like where Fenix Spoon is going rather than like what it can carry today: metrics
    apart from cost, verification as data, validity as its own block. When upstream's issue
    #46 returns metrics natively, this becomes the envelope and the artifact goes away
    (ADR-015).
    """

    schema: int = 1
    solver: dict = field(default_factory=dict)
    model: dict = field(default_factory=dict)
    geometry: dict = field(default_factory=dict)
    conditions: dict = field(default_factory=dict)
    dimensionless: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    curves: dict = field(default_factory=dict)
    sweep: dict | None = None
    verification: dict = field(default_factory=dict)
    validity: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)
