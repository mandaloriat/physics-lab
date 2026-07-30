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

import json
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


def colormaps() -> dict[str, list[list[int]]]:
    """The viewer's own colour stops, parsed out of the vendored module.

    Reading them rather than copying them is the point: a card that coloured `Cp` with a
    different diverging map than the page would teach the visitor to distrust both.
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


# -------------------------------------------------------------------------------- the solves


def solve(name: str, geometry: dict, params: dict):
    """Run one registered capability in-process, exactly as a worker would."""
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
    context = SolverContext(progress_cb=lambda _event: None, artifact_dir=artifacts)
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
    """The default cross-section of the magnetics page, at its default excitation."""

    def rect(x0, y0, x1, y1):
        return {
            "type": "polygon2d",
            "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        }

    result = solve(
        "mock.magnetostatics2d",
        {
            "type": "regions2d",
            "bounds": [-0.06, -0.06, 0.06, 0.06],
            "background": {"mu_r": 1.0},
            "regions": [
                {
                    "name": "core",
                    "shape": rect(-0.010, -0.030, 0.010, 0.030),
                    "material": {"mu_r": 1000.0},
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
        {"resolution": WIDTH // 2, "iterations": 1200},
    )
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


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for label, build in [("airfoil", airfoil), ("solenoid", solenoid), ("heatsink", heatsink)]:
        try:
            build()
            made.append(label)
        except Exception as error:  # noqa: BLE001 - one card failing must not lose the others
            print(f"  skipped {label}: {error}", file=sys.stderr)
    manifest = OUT / "MANIFEST.json"
    manifest.write_text(
        json.dumps(
            {
                "generated_by": "scripts/make-thumbnails.py",
                "note": "Real solves. Re-run the script to reproduce these bytes.",
                "thumbnails": made,
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(made)} thumbnails to {OUT.relative_to(ROOT)}: {', '.join(made)}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
