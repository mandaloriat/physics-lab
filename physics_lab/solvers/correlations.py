"""Where the convection coefficient comes from.

``docs/exercises/heat-sink.md`` §2.1. The finite-volume solve takes ``h`` as an input, which is
right and is what upstream's ``convection_coefficient`` assumption declares. What this module
adds is *where the number comes from*: ``h`` evaluated from the channel the fins leave between
them, so that packing fins closer chokes the flow the way it does in a real sink.

**Why this exists at all.** Held constant, ``h`` makes surface area the only thing that matters,
so thermal resistance falls monotonically with fin count and the model says more fins are always
better — right down to fins of zero thickness. The home page asks *when do they stop?*, and with
a constant coefficient the honest answer is "never", which is false. This module is what makes
the question answerable without solving the fluid (§2.1 records why the fluid is not solved).

**Where each correlation comes from.** Every expression below is a published one and is cited
here, which is where a citation belongs — beside the coefficients rather than in prose a reader
has to take on trust. The editorial review §12.3 made this binding: a page may not state a
correlation as fact and admit in the next paragraph that its source is remembered.

- ``natural_convection`` — Bar-Cohen, A. and Rohsenow, W. M. (1984), "Thermally Optimum Spacing
  of Vertical, Natural Convection Cooled, Parallel Plates", *Journal of Heat Transfer* **106**(1),
  116–123. The composite relation, eq. (11), for isothermal symmetric plates. Its narrow-channel
  limit is Elenbaas, W. (1942), "Heat dissipation of parallel plates by free convection",
  *Physica* **9**(1), 1–28.
- ``isolated_plate`` — the laminar McAdams constant for a vertical plate,
  ``Nu = 0.59 Ra^(1/4)`` over ``1e4 < Ra < 1e9``: McAdams, W. H. (1954), *Heat Transmission*,
  3rd ed., McGraw-Hill, ch. 7. Churchill, S. W. and Chu, H. H. S. (1975), *Int. J. Heat Mass
  Transfer* **18**(11), 1323–1329, is the wider-range alternative and agrees with this one to a
  few per cent across the band used here.
- ``flat_plate_forced`` — the Blasius/Pohlhausen laminar similarity result,
  ``Nu_L = 0.664 Re_L^(1/2) Pr^(1/3)``, standard and given in Incropera, F. P. and DeWitt, D. P.,
  *Fundamentals of Heat and Mass Transfer*, ch. 7.
- ``forced_convection`` — the laminar duct limit with a Nusselt number constant in ``Re``; see
  Shah, R. K. and London, A. L. (1978), *Laminar Flow Forced Convection in Ducts*, ch. VI.

What does **not** depend on the coefficients is the shape of the answer — that `h` falls as the
channel narrows, and therefore that an optimum exists — and that is what the exercise teaches.

Every correlation here reports its own validity, so the page can show the range beside the
number rather than in a footnote nobody opens.
"""

from dataclasses import dataclass

import numpy as np

#: Standard gravity, m/s^2.
GRAVITY = 9.80665


@dataclass(frozen=True)
class AirProperties:
    """Dry air at the film temperature, which is where these are all evaluated.

    Held as a small table rather than as fitted polynomials: over the 25-100 degC range this
    exercise spans, linear interpolation of these is well inside the uncertainty of the
    correlations that consume them, and a polynomial would imply a precision that is not there.
    """

    conductivity: float  #: W/m.K
    kinematic_viscosity: float  #: m^2/s
    prandtl: float  #: 1
    expansion: float  #: 1/K, the ideal-gas value 1/T_film


def air_at(film_temperature_k: float) -> AirProperties:
    """Air properties at a film temperature in kelvin."""
    # Anchors at 300 K and 400 K, linearly interpolated. Beyond that range the correlations
    # below have left their own validity anyway, so extrapolation accuracy is moot.
    t = float(np.clip(film_temperature_k, 250.0, 450.0))
    fraction = (t - 300.0) / 100.0
    return AirProperties(
        conductivity=0.0263 + fraction * (0.0338 - 0.0263),
        kinematic_viscosity=1.589e-5 + fraction * (2.641e-5 - 1.589e-5),
        prandtl=0.707 + fraction * (0.690 - 0.707),
        expansion=1.0 / t,
    )


@dataclass(frozen=True)
class Coefficient:
    """A convection coefficient, with enough context to be shown honestly."""

    value: float  #: W/m^2.K
    correlation: str  #: which correlation produced it, recorded in the run row per §9
    valid: bool  #: is the governing parameter inside the correlation's stated range?
    note: str  #: what to say when it is not


def isolated_plate(height: float, surface_excess_k: float, ambient_k: float) -> Coefficient:
    """A single vertical surface with no neighbour close enough to interfere.

        Nu_L = 0.59 Ra_L^(1/4),   h = Nu_L * k_air / L

    the laminar McAdams result. This is the *other end* of the channel problem and it has to be
    here for one specific case: a sink with a single fin has no channel at all, so a
    channel correlation divides by a zero gap and reports no cooling whatsoever. That case is
    not hypothetical — it is the bare-plate limit §8 verifies against, and the exercise would
    have shipped with its own control case broken.
    """
    if height <= 0.0:
        return Coefficient(0.0, "mcadams-plate", False, "no surface")

    excess = max(surface_excess_k, 1e-6)
    air = air_at(ambient_k + 0.5 * excess)
    rayleigh = (
        GRAVITY * air.expansion * excess * height**3 / air.kinematic_viscosity**2
    ) * air.prandtl
    if rayleigh <= 1e-12:
        return Coefficient(0.0, "mcadams-plate", False, "Rayleigh number underflows")

    nusselt = 0.59 * rayleigh**0.25
    valid = 1.0e4 < rayleigh < 1.0e9
    return Coefficient(
        value=float(nusselt * air.conductivity / height),
        correlation="mcadams-plate",
        valid=valid,
        note=""
        if valid
        else f"plate Rayleigh number {rayleigh:.3g} is outside the laminar band this "
        "correlation was fitted over",
    )


def natural_convection(
    channel_width: float,
    fin_height: float,
    surface_excess_k: float,
    ambient_k: float,
) -> Coefficient:
    """Vertical parallel plates, by the Bar-Cohen and Rohsenow composite relation.

        Nu_s = [576 / Ra_s^2  +  2.873 / sqrt(Ra_s)]^(-1/2),   h = Nu_s * k_air / s

    on the *channel* Rayleigh number ``Ra_s = Gr_s * Pr * (s / L)``, built on the spacing.

    **This single expression is the whole mechanism of §2.1**, and the composite form is used
    rather than bare Elenbaas because it is right at both ends. As the channel narrows, the
    first term dominates, ``Nu -> Ra_s / 24``, and ``h`` falls faster than the added fin area
    grows — that crossover is the optimum the exercise exists to find. As it widens, the second
    term dominates and ``Nu -> 0.59 Ra_s^(1/4)``, which is :func:`isolated_plate`: each wall
    stops knowing the other is there. Elenbaas alone has no such ceiling and keeps raising ``h``
    with the gap, which would flatter every widely spaced design on the page.

    ``surface_excess_k`` is the surface-to-ambient temperature difference. It makes the
    coefficient depend on the answer, so the caller iterates — :mod:`physics_lab.solvers.heatsink`
    folds this into the same Picard loop that carries the radiation.
    """
    if fin_height <= 0.0:
        return Coefficient(0.0, "bar-cohen-rohsenow", False, "no fin")
    if channel_width <= 0.0:
        # No channel at all: one fin, or fins thick enough to close the gap. The surfaces are
        # still there and still convecting, so hand off to the isolated-plate limit rather than
        # reporting that a sink with no channel cannot cool itself.
        return isolated_plate(fin_height, surface_excess_k, ambient_k)

    excess = max(surface_excess_k, 1e-6)
    film_k = ambient_k + 0.5 * excess
    air = air_at(film_k)

    grashof = (
        GRAVITY
        * air.expansion
        * excess
        * channel_width**3
        / air.kinematic_viscosity**2
    )
    rayleigh_channel = grashof * air.prandtl * (channel_width / fin_height)

    if rayleigh_channel <= 1e-12:
        return Coefficient(
            0.0, "bar-cohen-rohsenow", False, "channel Rayleigh number underflows"
        )

    nusselt = (
        576.0 / rayleigh_channel**2 + 2.873 / np.sqrt(rayleigh_channel)
    ) ** -0.5

    # A laminar result. Past about 1e5 on the channel Rayleigh number the flow is no longer
    # what it describes, and the page must say so rather than keep quoting a number.
    valid = rayleigh_channel < 1.0e5
    return Coefficient(
        value=float(nusselt * air.conductivity / channel_width),
        correlation="bar-cohen-rohsenow",
        valid=valid,
        note=(
            ""
            if valid
            else f"channel Rayleigh number {rayleigh_channel:.3g} is past the laminar range "
            "this correlation was fitted over"
        ),
    )


def flat_plate_forced(
    flow_length: float,
    face_velocity: float,
    surface_excess_k: float,
    ambient_k: float,
) -> Coefficient:
    """External laminar flow over a flat plate: ``Nu_L = 0.664 Re_L^(1/2) Pr^(1/3)``.

    The forced-convection counterpart to :func:`isolated_plate`, and it exists for the same
    reason: **a sink with no channel is still being blown on.** Handing a duct correlation a zero
    gap returns ``h = 0``, and because :mod:`physics_lab.solvers.heatsink` applies one
    coefficient to every exposed face, that would switch convection off across the whole sink
    and report temperatures with nothing but radiation to hold them down. A single-finned sink
    in forced mode is a perfectly ordinary thing to ask the page for.
    """
    if flow_length <= 0.0 or face_velocity <= 0.0:
        return Coefficient(0.0, "blasius-plate", False, "no flow")

    air = air_at(ambient_k + 0.5 * max(surface_excess_k, 0.0))
    reynolds = face_velocity * flow_length / air.kinematic_viscosity
    nusselt = 0.664 * np.sqrt(reynolds) * air.prandtl ** (1.0 / 3.0)

    valid = reynolds < 5.0e5
    return Coefficient(
        value=float(nusselt * air.conductivity / flow_length),
        correlation="blasius-plate",
        valid=valid,
        note=""
        if valid
        else f"plate Reynolds number {reynolds:.3g} is past laminar-turbulent transition",
    )


def forced_convection(
    channel_width: float,
    flow_length: float,
    face_velocity: float,
    surface_excess_k: float,
    ambient_k: float,
) -> Coefficient:
    """Flow forced along the channel, as a duct between parallel plates.

    ``flow_length`` is the distance the air travels *along* the channel, which for an extrusion
    with a fan behind it is the extrusion **depth** — not the fin height. The two are different
    lengths in different directions and the distinction is not cosmetic: buoyancy climbs the
    fins, so :func:`natural_convection` is right to use the fin height, while a fan pushes along
    the axis. Passing the wrong one gives a plausible coefficient for a problem nobody posed.

    Fully developed laminar flow between two isothermal plates gives ``Nu = 7.54`` on the
    hydraulic diameter ``D_h = 2s``, and the entrance region is richer than that, so the
    Hausen-style entrance term is carried:

        Nu = 7.54 + 0.03 (D_h / L) Re Pr / [1 + 0.016 ((D_h / L) Re Pr)^(2/3)]

    **Note what does and does not change from the natural-convection case.** ``h`` still falls
    as the channel narrows — ``D_h`` shrinks with *s* — but far less steeply than Elenbaas,
    because a fan does not care about buoyancy. So the optimum fin count moves *up* under
    forced convection, which is the second half of §10's result and the reason the page offers
    both modes rather than one.
    """
    if flow_length <= 0.0:
        return Coefficient(0.0, "laminar-duct", False, "no flow path")
    if face_velocity <= 0.0:
        return Coefficient(0.0, "laminar-duct", False, "no flow")
    if channel_width <= 0.0:
        # No channel at all: one fin, or fins thick enough to close the gap. The exposed
        # surfaces are still in the airstream, so this is external flow over a plate rather
        # than nothing at all.
        return flat_plate_forced(flow_length, face_velocity, surface_excess_k, ambient_k)

    film_k = ambient_k + 0.5 * max(surface_excess_k, 0.0)
    air = air_at(film_k)

    hydraulic_diameter = 2.0 * channel_width
    reynolds = face_velocity * hydraulic_diameter / air.kinematic_viscosity
    graetz = (hydraulic_diameter / flow_length) * reynolds * air.prandtl

    nusselt = 7.54 + (0.03 * graetz) / (1.0 + 0.016 * graetz ** (2.0 / 3.0))

    # Above roughly Re = 2300 the duct is transitional and a laminar correlation is the wrong
    # tool. Reported rather than silently extrapolated.
    valid = reynolds < 2300.0
    return Coefficient(
        value=float(nusselt * air.conductivity / hydraulic_diameter),
        correlation="laminar-duct-with-entrance",
        valid=valid,
        note=(
            ""
            if valid
            else f"channel Reynolds number {reynolds:.3g} is transitional or turbulent, "
            "outside a laminar duct correlation"
        ),
    )
