"""Steady conduction in an extruded heat sink, with convection *and* radiation off every face.

``docs/exercises/heat-sink.md``. Arrays in, arrays out, no Fenix Spoon import — the split every
lab adapter uses, so the physics can be checked against closed forms without a job, a server or
an envelope.

**What is solved.** ``div(k grad T) = 0`` on the cross-section of the extrusion, by finite
volumes on a tensor-product grid whose lines land exactly on every fin edge. The section is
genuinely prismatic, so this is the exact conduction problem rather than a slice through a
three-dimensional one (§2), and everything is per unit depth.

**What leaves the metal, and why there are two of them.** Every exposed face carries

    q = h (T - T_inf)  +  q_rad

with ``h`` from :mod:`physics_lab.solvers.correlations`, evaluated on the channel the fins
leave between them, and ``q_rad`` from a radiosity solve on each channel's enclosure using the
exact two-dimensional view factors of :mod:`physics_lab.solvers.viewfactors`. Omitting either
one gives a sink whose optimum fin count does not exist: constant ``h`` says more fins are
always better, and no radiation over-predicts the temperature rise of the nominal still-air case
by tens of percent while removing surface finish as a design variable altogether.

**Why the air is not solved.** §2.1. Conjugate natural convection would make ``h`` an output,
and it is the physically complete answer; nothing upstream solves a fluid, and a coupled
buoyant solve costs minutes per run where the exercise needs a sweep of twenty configurations.
The air is transparent in the infrared — homonuclear diatomics, no dipole moment — so radiation
needs no volumetric term either: the sink radiates *through* the air, not to it, and the whole
of it lives on the boundary. That is what makes this affordable without a fluid solve.

**Why it iterates.** Both couplings depend on the answer. ``h`` depends on the surface excess
temperature through the film properties and the Rayleigh number; the radiative flux goes as
``T^4`` and, inside a channel, on the temperature of the surface *opposite*. So the conduction
solve runs inside a Picard loop, each pass rebuilding the boundary coefficients from the
temperature the last pass produced. From a convection-only start it converges in a handful of
passes, and :class:`Solution` reports how many it took rather than hiding it.
"""

from dataclasses import dataclass, field

import numpy as np

from physics_lab.solvers.correlations import (
    Coefficient,
    forced_convection,
    natural_convection,
)
from physics_lab.solvers.viewfactors import Surface, view_factor_matrix

#: Stefan-Boltzmann constant, W/m^2.K^4.
SIGMA = 5.670374419e-8

#: Kelvin at zero Celsius. The page talks in Celsius and every radiation law needs kelvin, so
#: the conversion happens once, here, rather than being open-coded at each use.
KELVIN = 273.15

#: Below this excess temperature a face is treated as isothermal with the ambient when forming
#: an equivalent coefficient, to keep ``q / (T - T_inf)`` from dividing by zero on the first
#: pass. The flux itself is still exact; only the linearisation is guarded.
_MIN_EXCESS_K = 1e-3


@dataclass(frozen=True)
class Profile:
    """The parametric cross-section: a base slab with evenly spaced rectangular fins.

    Outer fins sit flush with the ends of the base, which is what an extrusion die produces and
    what makes the channel count ``fin_count - 1``.
    """

    base_width: float = 0.060
    base_thickness: float = 0.005
    fin_count: int = 10
    fin_thickness: float = 0.0015
    fin_height: float = 0.025

    def __post_init__(self) -> None:
        if self.fin_count < 1:
            raise ValueError("fin_count must be at least 1")
        if self.fin_count * self.fin_thickness > self.base_width:
            raise ValueError(
                f"{self.fin_count} fins of {self.fin_thickness * 1e3:.2f} mm do not fit across "
                f"a {self.base_width * 1e3:.1f} mm base: the fins would overlap"
            )

    @property
    def fin_pitch(self) -> float:
        if self.fin_count == 1:
            return 0.0
        return (self.base_width - self.fin_thickness) / (self.fin_count - 1)

    @property
    def channel_width(self) -> float:
        """The gap the air has to get through — the quantity §2.1 turns into ``h``."""
        if self.fin_count < 2:
            return 0.0
        return self.fin_pitch - self.fin_thickness

    @property
    def fin_spans(self) -> list[tuple[float, float]]:
        """``(x_left, x_right)`` of each fin."""
        if self.fin_count == 1:
            centre = 0.5 * (self.base_width - self.fin_thickness)
            return [(centre, centre + self.fin_thickness)]
        return [
            (i * self.fin_pitch, i * self.fin_pitch + self.fin_thickness)
            for i in range(self.fin_count)
        ]

    @property
    def channel_spans(self) -> list[tuple[float, float]]:
        """``(x_left, x_right)`` of each channel between consecutive fins."""
        spans = self.fin_spans
        return [(spans[i][1], spans[i + 1][0]) for i in range(len(spans) - 1)]

    @property
    def total_height(self) -> float:
        return self.base_thickness + self.fin_height

    @property
    def solid_area(self) -> float:
        """Cross-sectional area of metal, m^2 per unit depth."""
        return self.base_width * self.base_thickness + (
            self.fin_count * self.fin_thickness * self.fin_height
        )


@dataclass(frozen=True)
class Conditions:
    """What the sink is asked to do, and what it is made of."""

    power_w: float = 30.0
    depth: float = 0.060  #: extrusion length, m — the third dimension the 2-D solve stands for
    ambient_c: float = 25.0
    emissivity: float = 0.8  #: black anodised by default; mill finish is about 0.05
    conductivity: float = 201.0  #: W/m.K, aluminium 6063
    density: float = 2700.0  #: kg/m^3
    mode: str = "natural"  #: "natural" or "forced"
    face_velocity: float = 0.0  #: m/s, forced mode only
    footprint_width: float = 0.030  #: the device's contact width on the base
    base_mounted_flush: bool = True  #: is the underside blocked by the mounting?
    radiation: bool = True  #: the Advanced switch of §5 — off reproduces the simpler model
    h_override: float | None = None  #: pins ``h``, which is the other Advanced switch

    @property
    def ambient_k(self) -> float:
        return self.ambient_c + KELVIN

    @property
    def line_power(self) -> float:
        """Power per unit depth, W/m — what the 2-D problem actually carries."""
        return self.power_w / self.depth


@dataclass(frozen=True)
class Numerics:
    """Everything whose only correct effect is on the error."""

    cell_size: float = 0.0005  #: target cell edge, m
    max_passes: int = 400
    tolerance_k: float = 1e-4  #: Picard convergence, on the largest temperature change
    cg_tolerance: float = 1e-11
    cg_max_iterations: int = 20000
    #: Under-relaxation on the temperature update. **Not a tuning knob — the loop diverges
    #: without it.** The radiative coefficient goes as T^3, so an undamped pass that overshoots
    #: comes back with a coefficient several times too large and overshoots harder the other
    #: way; the iteration then oscillates instead of converging. It shows up wherever radiation
    #: dominates the heat path, which is exactly the bare-plate case §8 verifies against, and
    #: there it left the solve reporting a 1.5 K rise where the answer is thousands. A half step
    #: converges every configuration the exercise offers.
    relaxation: float = 0.5


@dataclass
class Face:
    """One exposed boundary face of one solid cell.

    The radiosity elements *are* these faces. Tying the two discretisations together means a
    mesh refinement refines the radiation exchange with it, and removes a second resolution
    knob that could be left coarse while the first was refined — a way to get a converged-looking
    temperature field on an unconverged enclosure.
    """

    row: int
    col: int
    area: float  #: face length, m per unit depth
    half_cell: float  #: centre-to-face distance, for the conduction half-step
    x1: float
    y1: float
    x2: float
    y2: float
    kind: str  #: "channel" | "open" | "footprint" | "adiabatic"
    channel: int = -1
    on_fin: bool = False  #: does this face belong to a fin rather than the base?


@dataclass
class Solution:
    """A converged solve, with the numbers §7 reports and the residuals §8 checks."""

    temperature_c: np.ndarray  #: (ny, nx), NaN where the cell is not metal
    mask: np.ndarray  #: (ny, nx) bool, True where solved
    flux_magnitude: np.ndarray  #: (ny, nx) W/m^2, NaN outside the metal
    x_centres: np.ndarray
    y_centres: np.ndarray
    metrics: dict[str, float] = field(default_factory=dict)
    residuals: dict[str, float] = field(default_factory=dict)
    coefficient: Coefficient | None = None
    passes: int = 0
    cg_iterations: int = 0


# ────────────────────────────────────────────────────────────────────────── the grid


def _edges(must_have: list[float], target: float) -> np.ndarray:
    """Grid lines through every value in ``must_have``, subdivided to about ``target``.

    Landing a line on every fin edge is what keeps the metal/air interface exact instead of a
    staircase whose steps move with the resolution — the failure ADR-018 recorded upstream and
    the reason the magnetics solver builds its grid the same way.
    """
    anchors = sorted(set(round(v, 12) for v in must_have))
    lines: list[float] = []
    for left, right in zip(anchors[:-1], anchors[1:], strict=True):
        span = right - left
        count = max(1, int(np.ceil(span / target)))
        lines.extend(left + span * i / count for i in range(count))
    lines.append(anchors[-1])
    return np.array(lines, dtype=float)


def build_grid(profile: Profile, cell_size: float) -> tuple[np.ndarray, np.ndarray]:
    x_anchors = [0.0, profile.base_width]
    for left, right in profile.fin_spans:
        x_anchors.extend((left, right))
    y_anchors = [0.0, profile.base_thickness, profile.total_height]
    return _edges(x_anchors, cell_size), _edges(y_anchors, cell_size)


def solid_mask(
    profile: Profile, x_edges: np.ndarray, y_edges: np.ndarray
) -> np.ndarray:
    """True where the cell is metal. Cell centres decide, and grid lines sit on every edge, so
    no cell is ever partly solid."""
    xc = 0.5 * (x_edges[:-1] + x_edges[1:])
    yc = 0.5 * (y_edges[:-1] + y_edges[1:])
    mask = np.zeros((len(yc), len(xc)), dtype=bool)

    mask[yc < profile.base_thickness, :] = True

    in_fin = np.zeros(len(xc), dtype=bool)
    for left, right in profile.fin_spans:
        in_fin |= (xc > left) & (xc < right)
    above_base = yc >= profile.base_thickness
    mask[np.ix_(above_base, in_fin)] = True
    return mask


def _classify(
    profile: Profile,
    conditions: Conditions,
    x_mid: float,
    y_mid: float,
    normal: str,
) -> tuple[str, int, bool]:
    """What kind of boundary a face is, and which channel enclosure it belongs to."""
    if normal == "down" and y_mid <= 0.0:
        half = 0.5 * conditions.footprint_width
        centre = 0.5 * profile.base_width
        if abs(x_mid - centre) <= half:
            return "footprint", -1, False
        return ("adiabatic" if conditions.base_mounted_flush else "open"), -1, False

    on_fin = y_mid > profile.base_thickness

    # A vertical face between the fins, or the strip of base between them, radiates into that
    # channel's enclosure. Everything else looks straight at the room.
    for index, (left, right) in enumerate(profile.channel_spans):
        if right - left <= 0.0:
            continue
        if normal in ("left", "right") and on_fin:
            if abs(x_mid - left) < 1e-12 or abs(x_mid - right) < 1e-12:
                return "channel", index, True
        if normal == "up" and abs(y_mid - profile.base_thickness) < 1e-12:
            if left < x_mid < right:
                return "channel", index, False
    return "open", -1, on_fin


def exposed_faces(
    profile: Profile,
    conditions: Conditions,
    x_edges: np.ndarray,
    y_edges: np.ndarray,
    mask: np.ndarray,
) -> list[Face]:
    hx = np.diff(x_edges)
    hy = np.diff(y_edges)
    ny, nx = mask.shape
    faces: list[Face] = []

    for row in range(ny):
        for col in range(nx):
            if not mask[row, col]:
                continue
            neighbours = (
                ("left", row, col - 1, hy[row], 0.5 * hx[col]),
                ("right", row, col + 1, hy[row], 0.5 * hx[col]),
                ("down", row - 1, col, hx[col], 0.5 * hy[row]),
                ("up", row + 1, col, hx[col], 0.5 * hy[row]),
            )
            for normal, r, c, area, half in neighbours:
                inside = 0 <= r < ny and 0 <= c < nx
                if inside and mask[r, c]:
                    continue

                if normal == "left":
                    x1 = x2 = x_edges[col]
                    y1, y2 = y_edges[row], y_edges[row + 1]
                elif normal == "right":
                    x1 = x2 = x_edges[col + 1]
                    y1, y2 = y_edges[row], y_edges[row + 1]
                elif normal == "down":
                    y1 = y2 = y_edges[row]
                    x1, x2 = x_edges[col], x_edges[col + 1]
                else:
                    y1 = y2 = y_edges[row + 1]
                    x1, x2 = x_edges[col], x_edges[col + 1]

                kind, channel, on_fin = _classify(
                    profile, conditions, 0.5 * (x1 + x2), 0.5 * (y1 + y2), normal
                )
                faces.append(
                    Face(row, col, area, half, x1, y1, x2, y2, kind, channel, on_fin)
                )
    return faces


# ─────────────────────────────────────────────────────────────────────── radiation


def _mouth_surfaces(
    profile: Profile, x_edges: np.ndarray, left: float, right: float
) -> list[Surface]:
    """The fictitious black window that closes a channel enclosure (§2.2).

    Black and at ambient: it stands for the room, which absorbs everything reaching it and
    returns only what the room emits. Without it the enclosure is open and the view-factor rows
    do not sum to one, which is the failure ``enclosure_residuals`` is built to catch.
    """
    inside = x_edges[(x_edges >= left - 1e-12) & (x_edges <= right + 1e-12)]
    top = profile.total_height
    return [
        Surface(a, top, b, top, emissivity=1.0, name="mouth")
        for a, b in zip(inside[:-1], inside[1:], strict=True)
        if b - a > 1e-12
    ]


class Enclosure:
    """One channel's radiosity problem: its real faces, its mouth, and the exchange between."""

    def __init__(self, faces: list[Face], mouths: list[Surface], emissivity: float):
        self.faces = faces
        surfaces = [
            Surface(f.x1, f.y1, f.x2, f.y2, emissivity=emissivity, name="solid")
            for f in faces
        ] + mouths
        self.n_real = len(faces)
        self.matrix = view_factor_matrix(surfaces)
        self.emissivity = np.array([s.emissivity for s in surfaces], dtype=float)
        self.surfaces = surfaces

    def net_flux(self, wall_temperature_k: np.ndarray, ambient_k: float) -> np.ndarray:
        """Net radiative flux leaving each *real* surface, W/m^2.

        Solves ``J = eps sigma T^4 + (1 - eps) F J`` and returns ``J - F J`` on the real
        surfaces. The mouth sits in the system at ambient with unit emissivity, so what escapes
        the channel is accounted rather than assumed.
        """
        temperatures = np.concatenate(
            [wall_temperature_k, np.full(len(self.surfaces) - self.n_real, ambient_k)]
        )
        emissive_power = SIGMA * temperatures**4
        system = np.eye(len(self.surfaces)) - (
            (1.0 - self.emissivity)[:, None] * self.matrix
        )
        radiosity = np.linalg.solve(system, self.emissivity * emissive_power)
        return (radiosity - self.matrix @ radiosity)[: self.n_real]

    def view_to_room(self) -> np.ndarray:
        """Each real surface's view factor to the mouth — the number that collapses as the
        channel narrows, and therefore *why* radiation stops paying (§7)."""
        return self.matrix[: self.n_real, self.n_real :].sum(axis=1)


# ─────────────────────────────────────────────────────────────────── the linear solve


def _conductances(
    conductivity: float, x_edges: np.ndarray, y_edges: np.ndarray, mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    hx, hy = np.diff(x_edges), np.diff(y_edges)
    both_x = mask[:, :-1] & mask[:, 1:]
    both_y = mask[:-1, :] & mask[1:, :]
    dx = 0.5 * (hx[:-1] + hx[1:])
    dy = 0.5 * (hy[:-1] + hy[1:])
    cx = np.where(both_x, conductivity * hy[:, None] / dx[None, :], 0.0)
    cy = np.where(both_y, conductivity * hx[None, :] / dy[:, None], 0.0)
    return cx, cy


def _apply(t: np.ndarray, diag: np.ndarray, cx: np.ndarray, cy: np.ndarray) -> np.ndarray:
    out = diag * t
    out[:, :-1] -= cx * t[:, 1:]
    out[:, 1:] -= cx * t[:, :-1]
    out[:-1, :] -= cy * t[1:, :]
    out[1:, :] -= cy * t[:-1, :]
    return out


def _solve_cg(
    diag: np.ndarray,
    cx: np.ndarray,
    cy: np.ndarray,
    rhs: np.ndarray,
    mask: np.ndarray,
    guess: np.ndarray,
    tolerance: float,
    max_iterations: int,
) -> tuple[np.ndarray, int]:
    """Jacobi-preconditioned conjugate gradients on the five-point stencil.

    Matrix-free and symmetric positive definite, the same arrangement ``magnetics.py`` uses and
    for the same reason: the operator is four shifted multiplies, and assembling it would be a
    large matrix to store for no gain.
    """
    t = np.where(mask, guess, 0.0)
    residual = np.where(mask, rhs - _apply(t, diag, cx, cy), 0.0)
    inverse_diagonal = np.where(mask & (diag > 0.0), 1.0 / np.where(diag > 0.0, diag, 1.0), 0.0)
    z = residual * inverse_diagonal
    direction = z.copy()
    rz = float(np.sum(residual * z))
    scale = max(float(np.sum(np.abs(rhs))), 1e-30)

    for iteration in range(1, max_iterations + 1):
        if float(np.max(np.abs(residual))) / scale < tolerance:
            return t, iteration
        a_direction = np.where(mask, _apply(direction, diag, cx, cy), 0.0)
        denominator = float(np.sum(direction * a_direction))
        if abs(denominator) < 1e-300:
            break
        step = rz / denominator
        t += step * direction
        residual -= step * a_direction
        z = residual * inverse_diagonal
        rz_next = float(np.sum(residual * z))
        direction = z + (rz_next / rz) * direction
        rz = rz_next
    return t, max_iterations


# ────────────────────────────────────────────────────────────────────────── the solve


def solve(
    profile: Profile,
    conditions: Conditions,
    numerics: Numerics | None = None,
) -> Solution:
    """Run the coupled solve and report the numbers §7 asks for."""
    numerics = numerics or Numerics()
    x_edges, y_edges = build_grid(profile, numerics.cell_size)
    mask = solid_mask(profile, x_edges, y_edges)
    faces = exposed_faces(profile, conditions, x_edges, y_edges, mask)
    cx, cy = _conductances(conditions.conductivity, x_edges, y_edges, mask)

    ambient_k = conditions.ambient_k
    temperature_k = np.where(mask, ambient_k + 20.0, 0.0)

    enclosures: dict[int, Enclosure] = {}
    if conditions.radiation:
        for index, (left, right) in enumerate(profile.channel_spans):
            members = [f for f in faces if f.kind == "channel" and f.channel == index]
            if members:
                enclosures[index] = Enclosure(
                    members,
                    _mouth_surfaces(profile, x_edges, left, right),
                    conditions.emissivity,
                )

    convective = [f for f in faces if f.kind in ("channel", "open")]
    footprint_area = sum(f.area for f in faces if f.kind == "footprint")
    if footprint_area <= 0.0:
        raise ValueError("the device footprint does not touch the base")

    coefficient = Coefficient(0.0, "none", True, "")
    passes = 0
    cg_iterations = 0

    for pass_index in range(1, numerics.max_passes + 1):
        passes = pass_index
        wall_k = np.array([temperature_k[f.row, f.col] for f in convective], dtype=float)
        excess = float(np.mean(wall_k)) - ambient_k

        if conditions.h_override is not None:
            coefficient = Coefficient(
                conditions.h_override, "override", True, "pinned by the visitor"
            )
        elif conditions.mode == "forced":
            coefficient = forced_convection(
                profile.channel_width,
                profile.fin_height,
                conditions.face_velocity,
                excess,
                ambient_k,
            )
        else:
            coefficient = natural_convection(
                profile.channel_width, profile.fin_height, excess, ambient_k
            )

        radiative_h = {id(f): 0.0 for f in convective}
        if conditions.radiation:
            for enclosure in enclosures.values():
                walls = np.array(
                    [temperature_k[f.row, f.col] for f in enclosure.faces], dtype=float
                )
                flux = enclosure.net_flux(walls, ambient_k)
                for face, q, t_wall in zip(enclosure.faces, flux, walls, strict=True):
                    radiative_h[id(face)] = q / max(t_wall - ambient_k, _MIN_EXCESS_K)
            for face in convective:
                if face.kind == "open":
                    t_wall = temperature_k[face.row, face.col]
                    q = conditions.emissivity * SIGMA * (t_wall**4 - ambient_k**4)
                    radiative_h[id(face)] = q / max(t_wall - ambient_k, _MIN_EXCESS_K)

        diag = np.zeros_like(mask, dtype=float)
        rhs = np.zeros_like(mask, dtype=float)
        diag[:, :-1] += cx
        diag[:, 1:] += cx
        diag[:-1, :] += cy
        diag[1:, :] += cy

        for face in faces:
            if face.kind == "footprint":
                rhs[face.row, face.col] += (
                    conditions.line_power / footprint_area
                ) * face.area
            elif face.kind in ("channel", "open"):
                total_h = max(coefficient.value + radiative_h[id(face)], 0.0)
                if total_h <= 0.0:
                    continue
                # The half-cell of conduction between the cell centre and the surface sits in
                # series with the film. It is negligible for aluminium and not for a poor
                # conductor, and including it costs one division.
                effective = 1.0 / (
                    1.0 / total_h + face.half_cell / conditions.conductivity
                )
                diag[face.row, face.col] += effective * face.area
                rhs[face.row, face.col] += effective * face.area * ambient_k

        updated, iterations = _solve_cg(
            diag,
            cx,
            cy,
            rhs,
            mask,
            temperature_k,
            numerics.cg_tolerance,
            numerics.cg_max_iterations,
        )
        cg_iterations += iterations
        relaxed = temperature_k + numerics.relaxation * (updated - temperature_k)
        change = float(np.max(np.abs(relaxed - temperature_k)[mask]))
        temperature_k = np.where(mask, relaxed, 0.0)
        if change < numerics.tolerance_k:
            break

    return _assemble(
        profile,
        conditions,
        numerics,
        x_edges,
        y_edges,
        mask,
        faces,
        enclosures,
        temperature_k,
        coefficient,
        passes,
        cg_iterations,
    )


def _assemble(
    profile: Profile,
    conditions: Conditions,
    numerics: Numerics,
    x_edges: np.ndarray,
    y_edges: np.ndarray,
    mask: np.ndarray,
    faces: list[Face],
    enclosures: dict[int, Enclosure],
    temperature_k: np.ndarray,
    coefficient: Coefficient,
    passes: int,
    cg_iterations: int,
) -> Solution:
    ambient_k = conditions.ambient_k
    xc = 0.5 * (x_edges[:-1] + x_edges[1:])
    yc = 0.5 * (y_edges[:-1] + y_edges[1:])

    convective_out = 0.0
    radiative_out = 0.0
    fin_heat = 0.0
    fin_area = 0.0
    fin_root_excess: list[float] = []
    view_weighted = 0.0
    view_area = 0.0

    radiative_flux: dict[int, float] = {}
    for enclosure in enclosures.values():
        walls = np.array(
            [temperature_k[f.row, f.col] for f in enclosure.faces], dtype=float
        )
        flux = enclosure.net_flux(walls, ambient_k)
        views = enclosure.view_to_room()
        for face, q, view in zip(enclosure.faces, flux, views, strict=True):
            radiative_flux[id(face)] = q
            view_weighted += view * face.area
            view_area += face.area

    for face in faces:
        if face.kind not in ("channel", "open"):
            continue
        t_wall = temperature_k[face.row, face.col]
        excess = t_wall - ambient_k
        convective = coefficient.value * excess * face.area
        if conditions.radiation:
            if face.kind == "open":
                q_rad = conditions.emissivity * SIGMA * (t_wall**4 - ambient_k**4)
            else:
                q_rad = radiative_flux.get(id(face), 0.0)
        else:
            q_rad = 0.0
        radiated = q_rad * face.area
        convective_out += convective
        radiative_out += radiated
        if face.on_fin:
            fin_heat += convective + radiated
            fin_area += face.area
            fin_root_excess.append(
                float(temperature_k[_root_row(y_edges, profile), face.col]) - ambient_k
            )

    total_out = convective_out + radiative_out
    supplied = conditions.line_power
    peak_k = float(np.max(temperature_k[mask]))
    rise = peak_k - ambient_k

    # Fin efficiency: what the fins actually move, against what they would move if every
    # point of them sat at their own root temperature.
    root_excess = float(np.mean(fin_root_excess)) if fin_root_excess else 0.0
    total_h = coefficient.value + (
        (radiative_out / max(sum(f.area for f in faces if f.kind in ("channel", "open")), 1e-30))
        / max(rise, _MIN_EXCESS_K)
        if conditions.radiation
        else 0.0
    )
    ideal = total_h * fin_area * root_excess
    efficiency = float(fin_heat / ideal) if ideal > 0.0 else float("nan")

    metrics = {
        "t_max_c": peak_k - KELVIN,
        "t_rise_k": rise,
        "flux_max_w_m2": conditions.conductivity
        * float(np.nanmax(_flux_magnitude(temperature_k, mask, x_edges, y_edges))),
        "thermal_resistance_k_w": rise / conditions.power_w,
        "mass_per_depth_kg_m": conditions.density * profile.solid_area,
        "mass_kg": conditions.density * profile.solid_area * conditions.depth,
        "fin_efficiency": efficiency,
        "radiative_fraction": float(radiative_out / total_out) if total_out > 0 else 0.0,
        "view_factor_to_room": float(view_weighted / view_area) if view_area > 0 else 1.0,
        "channel_width_mm": profile.channel_width * 1e3,
        "h_convective_w_m2k": coefficient.value,
    }
    metrics["score_k_kg_w"] = (
        metrics["thermal_resistance_k_w"] * metrics["mass_kg"]
    )

    residuals = {
        "energy_balance": abs(total_out - supplied) / max(abs(supplied), 1e-30),
        "picard_passes": float(passes),
    }
    for index, enclosure in enclosures.items():
        from physics_lab.solvers.viewfactors import enclosure_residuals

        worst = enclosure_residuals(enclosure.surfaces, enclosure.matrix)
        residuals[f"view_factor_summation_channel_{index}"] = worst["summation"]
        residuals[f"view_factor_reciprocity_channel_{index}"] = worst["reciprocity"]

    return Solution(
        temperature_c=np.where(mask, temperature_k - KELVIN, np.nan),
        mask=mask,
        flux_magnitude=conditions.conductivity
        * _flux_magnitude(temperature_k, mask, x_edges, y_edges),
        x_centres=xc,
        y_centres=yc,
        metrics=metrics,
        residuals=residuals,
        coefficient=coefficient,
        passes=passes,
        cg_iterations=cg_iterations,
    )


def _root_row(y_edges: np.ndarray, profile: Profile) -> int:
    """The cell row just below the fin roots, where a fin's base temperature is read."""
    yc = 0.5 * (y_edges[:-1] + y_edges[1:])
    below = np.nonzero(yc < profile.base_thickness)[0]
    return int(below[-1]) if len(below) else 0


def _flux_magnitude(
    temperature_k: np.ndarray, mask: np.ndarray, x_edges: np.ndarray, y_edges: np.ndarray
) -> np.ndarray:
    """``|grad T|`` at cell centres, by central differences. Callers scale by ``k``."""
    hx, hy = np.diff(x_edges), np.diff(y_edges)
    t = np.where(mask, temperature_k, np.nan)
    gx = np.full(t.shape, np.nan)
    gy = np.full(t.shape, np.nan)
    gx[:, 1:-1] = (t[:, 2:] - t[:, :-2]) / (hx[1:-1] + 0.5 * (hx[:-2] + hx[2:]))[None, :]
    gy[1:-1, :] = (t[2:, :] - t[:-2, :]) / (hy[1:-1] + 0.5 * (hy[:-2] + hy[2:]))[:, None]
    magnitude = np.sqrt(np.nan_to_num(gx) ** 2 + np.nan_to_num(gy) ** 2)
    return np.where(mask, magnitude, np.nan)
