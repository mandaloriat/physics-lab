#!/usr/bin/env python3
"""Render each experiment's homepage thumbnail by *running its own solver*.

The homepage used to be three paragraphs in three boxes. What a visitor wants to know before
clicking is what the thing looks like when it works, and the honest way to show that is not a
stock illustration but the field the exercise actually computes. So every thumbnail on the
homepage is a real solve, produced by this script and committed as a PNG.

Committed rather than computed in the browser, because the alternative is worse in both
directions: solving on page load would spend the public job budget (ADR-010) on people who are
only looking, and a hand-drawn approximation would be a picture of nothing. A committed PNG is
reproducible — re-run this script and the bytes come back — and it costs one request.

    ./scripts/make-thumbnails.py            # writes frontend/assets/thumbnails/*.png

The colormaps are read out of the vendored viewer so a card and the page it links to colour
the same field the same way; there is no second palette to keep in step. Run
``./scripts/fetch-widgets.sh`` first.

No third-party imaging dependency: a PNG is a zlib stream in a container, and writing one
directly is forty lines against adding Pillow to a project that renders everything else in the
browser.
"""

from __future__ import annotations

import functools
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "assets" / "thumbnails"
COLORMAP_SOURCE = ROOT / "frontend" / "vendor" / "fenix-spoon" / "viewer" / "colormap.js"

#: Thumbnail size. Small on purpose: these are cards, and the field's own sampling grid is
#: coarser than this anyway, so anything larger is interpolation dressed up as detail.
WIDTH = 480


# ------------------------------------------------------------------ colormaps, from upstream


@functools.cache
def colormaps() -> dict[str, list[list[int]]]:
    """The viewer's own colour stops, parsed out of the vendored module.

    Reading them rather than copying them is the point: a card that coloured `Cp` with a
    different diverging map than the page would teach the visitor to distrust both.

    Cached for the process: the file cannot change under a single run, and `render()` calls this
    once per thumbnail, so without the cache the same file is read and re-parsed for every image.
    """
    if not COLORMAP_SOURCE.is_file():
        raise SystemExit("run ./scripts/fetch-widgets.sh first — the viewer is not vendored")
    source = COLORMAP_SOURCE.read_text(encoding="utf-8")
    block = source[source.index("const STOPS = {") : source.index("export const COLORMAP_NAMES")]
    out: dict[str, list[list[int]]] = {}
    for name, body in re.findall(r"(\w+):\s*\[((?:\s*\[[^\]]*\],?)+)\s*\]", block):
        stops = re.findall(r"\[([^\]]*)\]", body)
        out[name] = [[int(v) for v in stop.split(",")] for stop in stops]
    return out


def sample(stops: list[list[int]], t: np.ndarray) -> np.ndarray:
    """Vectorised equivalent of the viewer's `sampleColormap`: linear in sRGB between stops."""
    table = np.asarray(stops, dtype=float)
    scaled = np.clip(t, 0.0, 1.0) * (len(table) - 1)
    index = np.clip(np.floor(scaled).astype(int), 0, len(table) - 2)
    frac = (scaled - index)[..., None]
    return np.round(table[index] + frac * (table[index + 1] - table[index])).astype(np.uint8)


# ------------------------------------------------------------------------------ PNG writing


def write_png(path: Path, rgb: np.ndarray) -> None:
    """An 8-bit RGB PNG, filter type 0 on every row."""
    height, width, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def render(values: np.ndarray, shape, mask, colormap: str, symmetric: bool) -> np.ndarray:
    """Colour a flat field array the way `<fs-viewer>` does, and flip it into image order."""
    ny, nx = shape
    grid = np.asarray(values, dtype=float).reshape(ny, nx)
    holes = None if mask is None else np.asarray(mask).reshape(ny, nx).astype(bool)

    finite = grid[np.isfinite(grid) & (~holes if holes is not None else True)]
    low, high = float(finite.min()), float(finite.max())
    if symmetric:
        extent = max(abs(low), abs(high)) or 1.0
        low, high = -extent, extent
    if high - low < 1e-12:
        high = low + 1.0

    rgb = sample(colormaps()[colormap], (grid - low) / (high - low))
    if holes is not None:
        rgb[holes] = (30, 30, 34)  # the viewer's own masked colour
    # Row 0 of the payload is the bottom of the domain; image rows go down.
    return np.flipud(rgb)


def crop(result, half: float):
    """Keep the part of a `grid2d` result within `half` of the origin, and nothing else.

    The window a solve needs and the frame a picture wants are different sizes, and the honest
    way to have both is to solve the first and show part of it. Returns a new result rather
    than mutating: the caller may want the whole field too.
    """
    ny, nx = result.data["shape"]
    xmin, ymin, xmax, ymax = result.data["bounds"]
    x = np.linspace(xmin, xmax, nx)
    y = np.linspace(ymin, ymax, ny)
    keep_x = np.nonzero(np.abs(x) <= half)[0]
    keep_y = np.nonzero(np.abs(y) <= half)[0]
    if not len(keep_x) or not len(keep_y):
        # Reachable by asking for a crop finer than the raster, which is a mistake in the
        # caller rather than in the solve. Said plainly, because the alternative is an
        # IndexError three lines later that names neither number.
        raise SystemExit(
            f"crop half-width {half} keeps no sample points of a raster spanning "
            f"{result.data['bounds']} at {ny} x {nx}: raise the resolution or the crop"
        )
    take = np.ix_(keep_y, keep_x)

    data = dict(result.data)
    data["shape"] = [len(keep_y), len(keep_x)]
    data["bounds"] = [x[keep_x[0]], y[keep_y[0]], x[keep_x[-1]], y[keep_y[-1]]]
    data["fields"] = {
        name: np.asarray(values, dtype=float).reshape(ny, nx)[take].ravel().tolist()
        for name, values in result.data["fields"].items()
    }
    if result.data.get("mask") is not None:
        data["mask"] = np.asarray(result.data["mask"]).reshape(ny, nx)[take].ravel().tolist()
    return result.model_copy(update={"data": data})


# -------------------------------------------------------------------------------- the solves


def solve(name: str, geometry: dict, params: dict, conditions: dict | None = None):
    """Run one registered capability in-process, exactly as a worker would.

    ``conditions`` is an inline load case (protocol 1.9), for a capability that takes one. It
    goes on the context the way the server puts it there, rather than being folded into the
    params, so a thumbnail is produced by the same code path as a job.
    """
    from fenixspoon.geometry import Geometry
    from fenixspoon.solvers.base import SolverContext
    from fenixspoon.solvers.registry import get_solver
    from pydantic import TypeAdapter

    import physics_lab.solvers  # noqa: F401  - registers lab.* by import

    solver_cls = get_solver(name)
    parsed = TypeAdapter(Geometry).validate_python(geometry)
    # Outside the served tree: these adapters register a report artifact, and a stray
    # report.json under frontend/assets would be published by the static mount.
    artifacts = Path(tempfile.mkdtemp(prefix="spoon-thumbnails-"))
    context = SolverContext(
        progress_cb=lambda _event: None, artifact_dir=artifacts, conditions=conditions
    )
    return solver_cls().solve(parsed, solver_cls.Params(**params), context)


def naca(m: float, p: float, t: float, count: int = 160) -> list[list[float]]:
    """A four-digit outline at the closed-trailing-edge coefficient, as the page submits it."""
    stations = 0.5 * (1 - np.cos(np.linspace(0.0, np.pi, count)))
    yt = (
        5
        * t
        * (
            0.2969 * np.sqrt(stations)
            - 0.126 * stations
            - 0.3516 * stations**2
            + 0.2843 * stations**3
            - 0.1036 * stations**4
        )
    )
    if m == 0:
        camber = np.zeros_like(stations)
        slope = np.zeros_like(stations)
    else:
        fore = stations < p
        camber = np.where(
            fore,
            (m / p**2) * (2 * p * stations - stations**2),
            (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * stations - stations**2),
        )
        slope = np.where(
            fore,
            (2 * m / p**2) * (p - stations),
            (2 * m / (1 - p) ** 2) * (p - stations),
        )
    theta = np.arctan(slope)
    upper = np.column_stack([stations - yt * np.sin(theta), camber + yt * np.cos(theta)])
    lower = np.column_stack([stations + yt * np.sin(theta), camber - yt * np.cos(theta)])
    # Trailing edge once, then the lower surface forward, the nose, and the upper surface aft.
    ring = np.vstack([lower[:0:-1], upper[:-1]])
    return [[float(x), float(y)] for x, y in ring]


def airfoil() -> None:
    """NACA 2412 at the incidence that solves the challenge: the exercise's own answer."""
    result = solve(
        "lab.airfoil_panel2d",
        {
            "type": "domain2d",
            "bounds": [-0.8, -0.6, 1.8, 0.6],
            "obstacle": {"type": "polygon2d", "points": naca(0.02, 0.4, 0.12)},
        },
        {"alpha_deg": 4.6, "u_inf": 40.0, "panels": 240, "resolution": WIDTH // 2},
    )
    write_png(
        OUT / "airfoil.png",
        render(
            result.data["fields"]["Cp"],
            result.data["shape"],
            result.data.get("mask"),
            "coolwarm",
            symmetric=True,
        ),
    )


def solenoid() -> None:
    """The default cross-section of the magnetics page, at its default excitation.

    Solved by `lab.magnetics2d` in the window the page actually submits — eight times the
    magnet's half-extent — and then *cropped* to the magnet before it is coloured. The crop is
    a framing choice and the solve is not: a card showing the whole 480 mm window would show a
    speck, and a card solved in a 120 mm window would be showing a different magnet from the
    one the page computes, whose flux is a quarter lower.
    """

    def rect(x0, y0, x1, y1):
        return {
            "type": "polygon2d",
            "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        }

    window = 8 * 0.030  # WINDOW_RATIO x the magnet's half-extent, as the page sizes it
    result = solve(
        "lab.magnetics2d",
        {
            "type": "regions2d",
            "bounds": [-window, -window, window, window],
            "background": {"mu_r": 1.0},
            "regions": [
                {
                    "name": "core",
                    "shape": rect(-0.010, -0.030, 0.010, 0.030),
                    "material": {"mu_r": 1000.0, "b_sat": 1.5},
                },
                {
                    "name": "winding_left",
                    "shape": rect(-0.025, -0.030, -0.015, 0.030),
                    "material": {"current_density": -5e6},
                },
                {
                    "name": "winding_right",
                    "shape": rect(0.015, -0.030, 0.025, 0.030),
                    "material": {"current_density": 5e6},
                },
            ],
        },
        {"cells_across": 80, "convergence_check": False, "resolution": 512},
    )
    # 96 mm keeps the magnet the subject and still shows the flux closing through air,
    # and it is as wide as the sampling allows: the raster is capped at 512 across the
    # whole window, so a tighter crop would be upscaling more than it is showing.
    result = crop(result, 0.096)
    write_png(
        OUT / "solenoid.png",
        render(
            result.data["fields"]["B"],
            result.data["shape"],
            result.data.get("mask"),
            "viridis",
            symmetric=False,
        ),
    )


def heatsink() -> None:
    """The planned exercise, on the preview solver upstream already ships.

    Worth generating even though the page is not built: the homepage says the solver exists and
    the didactic half does not, and a real field is the proof of the first half of that claim.
    """

    def rect(x0, y0, x1, y1):
        return {"type": "polygon2d", "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}

    fins = [
        {
            "name": f"fin_{i}",
            "shape": rect(-0.045 + i * 0.018, 0.006, -0.037 + i * 0.018, 0.045),
            "material": {"k": 200.0},
        }
        for i in range(6)
    ]
    result = solve(
        "mock.heat2d",
        {
            "type": "regions2d",
            "bounds": [-0.06, -0.02, 0.06, 0.06],
            "background": {"k": 0.6},
            "regions": [
                {
                    "name": "base",
                    "shape": rect(-0.05, -0.008, 0.05, 0.006),
                    "material": {"k": 200.0, "q": 4.0e5},
                },
                *fins,
            ],
        },
        {"resolution": WIDTH // 2, "iterations": 1200},
    )
    write_png(
        OUT / "heatsink.png",
        render(
            result.data["fields"]["T"],
            result.data["shape"],
            result.data.get("mask"),
            "plasma",
            symmetric=False,
        ),
    )


def truss() -> None:
    """A lattice that meets the mission, coloured by how hard each bar is working.

    The only card whose result is a `mesh2d` rather than a raster, and the only one that
    therefore cannot go through `render()`. That is the geometry being honest rather than an
    inconvenience: this exercise's answer is *per bar*, so the picture is bars, and the
    rasteriser below draws exactly what `<fs-viewer>` draws — each member as a ribbon of one
    colour, because one force runs the whole length of it.
    """
    span, panels, depth = 24.0, 10, 3.0
    step = span / panels
    nodes = [[round(i * step, 3), 0.0] for i in range(panels + 1)]
    nodes += [[round((i + 0.5) * step, 3), depth] for i in range(panels)]
    members = [[i, i + 1] for i in range(panels)]
    members += [[panels + 1 + i, panels + 2 + i] for i in range(panels - 1)]
    for i in range(panels):
        members += [[i, panels + 1 + i], [panels + 1 + i, i + 1]]

    def rect(x0, y0, x1, y1):
        return {"type": "polygon2d", "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}

    result = solve(
        "lab.truss2d",
        {
            "type": "regions2d",
            "bounds": [-4.0, -8.0, 28.0, 12.0],
            "regions": [
                {"name": "left_bank", "shape": rect(-3.9, -7.9, 0.0, 0.0)},
                {"name": "right_bank", "shape": rect(24.0, -7.9, 27.9, 0.0)},
                {
                    "name": "channel",
                    "shape": rect(4.0, -5.0, 20.0, -0.6),
                    "material": {"keep_clear": 1},
                },
            ],
            "boundaries": [
                {"name": "support_0", "select": {"type": "box", "bounds": [-0.2, -0.2, 0.2, 0.2]}},
                {
                    "name": f"support_{panels}",
                    "select": {"type": "box", "bounds": [23.8, -0.2, 24.2, 0.2]},
                },
                {
                    "name": "deck",
                    "select": {"type": "near", "axis": "y", "value": 0.0, "tol": 0.05},
                },
            ],
        },
        {"nodes": nodes, "members": members, "area": 2.6e-3},
        conditions={
            "support_0": {"fixed_x": 1.0, "fixed_y": 1.0},
            f"support_{panels}": {"fixed_y": 1.0},
            "deck": {"load_y": -4000.0},
        },
    )
    window = (-1.5, -1.5, 25.5, 5.0)
    write_png(OUT / "truss.png", render_lattice(result, "utilisation", "plasma", window))


def render_lattice(result, field: str, colormap: str, window) -> np.ndarray:
    """Colour a `mesh2d` of one-quad-per-bar the way the viewer does, and rasterise it.

    Each bar contributes four consecutive points — the two corners at one end, then the two at
    the other — so the midline and the drawn half-width come straight back out of them, and a
    pixel belongs to the bar it is within a half-width of. Nearest wins where two bars overlap
    at a joint, which is what the viewer's own painter's order comes to in this geometry.
    """
    points = np.asarray(result.data["points"], dtype=float)
    values = np.asarray(result.data["point_fields"][field], dtype=float)
    bars = len(points) // 4
    corners = points.reshape(bars, 4, 2)
    start = 0.5 * (corners[:, 0] + corners[:, 3])
    end = 0.5 * (corners[:, 1] + corners[:, 2])
    half = 0.5 * np.linalg.norm(corners[:, 0] - corners[:, 3], axis=1)
    per_bar = values.reshape(bars, 4)[:, 0]

    xmin, ymin, xmax, ymax = window
    height = max(1, round(WIDTH * (ymax - ymin) / (xmax - xmin)))
    xs = np.linspace(xmin, xmax, WIDTH)
    ys = np.linspace(ymin, ymax, height)
    gx, gy = np.meshgrid(xs, ys)

    low, high = float(per_bar.min()), float(per_bar.max())
    if high - low < 1e-12:
        high = low + 1.0

    rgb = np.full((height, WIDTH, 3), 30, dtype=np.uint8)
    rgb[..., 2] = 34
    nearest = np.full((height, WIDTH), np.inf)
    for index in range(bars):
        vx, vy = end[index] - start[index]
        length = vx * vx + vy * vy
        t = np.clip(((gx - start[index, 0]) * vx + (gy - start[index, 1]) * vy) / length, 0.0, 1.0)
        distance = np.hypot(start[index, 0] + t * vx - gx, start[index, 1] + t * vy - gy)
        hit = (distance <= half[index]) & (distance < nearest)
        nearest[hit] = distance[hit]
        colour = sample(colormaps()[colormap], np.array([(per_bar[index] - low) / (high - low)]))[0]
        rgb[hit] = colour

    # Row 0 of the arrays is the bottom of the domain; image rows go down.
    return np.flipud(rgb)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for label, build in [
        ("airfoil", airfoil),
        ("solenoid", solenoid),
        ("truss", truss),
        ("heatsink", heatsink),
    ]:
        try:
            build()
            made.append(label)
        except Exception as error:  # noqa: BLE001 - one card failing must not lose the others
            print(f"  skipped {label}: {error}", file=sys.stderr)
    # Provenance beside the bytes, the way `frontend/vendor/` carries its COMMIT file — generated
    # images with no note saying where they came from are unreproducible images (ADR-008 makes
    # the same argument about the vendored widgets).
    #
    # Markdown rather than JSON, and that is not arbitrary: everything under `frontend/` with a
    # `.json` suffix is checked by `npm run lint`, and Prettier reformats short arrays in a way
    # `json.dumps` cannot reproduce — so a JSON manifest would fail CI every time the thumbnails
    # were regenerated. Nothing parses this file; it is here to be read.
    (OUT / "README.md").write_text(
        "# Homepage thumbnails\n\n"
        "Generated by `scripts/make-thumbnails.py`. Each image is a **real solve** by the same\n"
        "capability the corresponding page runs, coloured with the colormap that page uses, read\n"
        "out of the vendored viewer. Do not edit them by hand — re-run the script:\n\n"
        "```bash\n./scripts/make-thumbnails.py\n```\n\n"
        "Present: " + ", ".join(f"`{name}.png`" for name in made) + ".\n",
        encoding="utf-8",
    )
    print(f"wrote {len(made)} thumbnails to {OUT.relative_to(ROOT)}: {', '.join(made)}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
