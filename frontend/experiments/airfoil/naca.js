/**
 * The NACA four-digit family, as the page draws it.
 *
 * Lifted out of `app.js` when the guided path arrived (ADR-021), because its third chapter
 * explains what the four digits mean and has to *show* it. A diagram drawn from its own
 * hand-tuned curve would be a picture of what somebody believed the formula does; drawn from
 * this file it is a picture of what the solver is about to be handed. The two cannot drift,
 * which is the same argument that makes the homepage thumbnails real solves rather than
 * illustrations.
 *
 * The definitions match `physics_lab/solvers/airfoil_geometry.py`. Everything here is on a
 * unit chord and in the profile's own axes: incidence is the free stream's direction, never a
 * rotation of the section (docs/exercises/airfoil.md §5.1).
 */

/** Control points per surface. Six is what a Catmull-Rom through a cosine-spaced outline needs
 *  to stay faithful while staying draggable; `samples` on the editor then decides how many
 *  polygon vertices the solver receives from it. */
export const POINTS_PER_SURFACE = 6;

/** Closed trailing edge: the published −0.1015 leaves a finite base, and the Kutta condition is
 *  applied *at* the trailing edge. Matches `physics_lab/solvers/airfoil_geometry.py`. */
export const TE_CLOSED = 0.1036;

/** Half the thickness distribution at station `x`, for a maximum thickness `t`. */
export function halfThickness(x, t) {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - TE_CLOSED * x ** 4)
  );
}

/** The mean line's height and slope at station `x`, for camber `m` at position `p`. */
export function meanLine(x, m, p) {
  if (m === 0) return { y: 0, slope: 0 };
  if (x < p) {
    return { y: (m / p ** 2) * (2 * p * x - x ** 2), slope: ((2 * m) / p ** 2) * (p - x) };
  }
  return {
    y: (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x ** 2),
    slope: ((2 * m) / (1 - p) ** 2) * (p - x),
  };
}

/** A point on one surface: the mean line, offset perpendicular to itself by the half thickness. */
export function surfacePoint(x, { m, p, t }, sign) {
  const { y, slope } = meanLine(x, m, p);
  const theta = Math.atan(slope);
  const yt = halfThickness(x, t);
  return [x - sign * yt * Math.sin(theta), y + sign * yt * Math.cos(theta)];
}

/** Cosine-spaced stations on a unit chord, clustered towards the leading edge where the
 *  curvature is. `count` stations, the first at 0 and the last at 1. */
export function stations(count) {
  const out = [];
  for (let i = 0; i <= count; i += 1) out.push(0.5 * (1 - Math.cos((Math.PI * i) / count)));
  return out;
}

/**
 * Control points for a four-digit profile, ordered around the outline on a unit chord.
 *
 * No rotation: incidence is the free stream's direction, not the profile's (§5.1). The trailing
 * edge is a single point, because two coincident points are a zero-length panel and a
 * `duplicate consecutive points` rejection from the protocol's validator.
 */
export function controlPoints(shape) {
  const xs = stations(POINTS_PER_SURFACE).slice(1);
  const points = [[1, 0]]; // trailing edge, once
  for (let i = xs.length - 2; i >= 0; i -= 1) points.push(surfacePoint(xs[i], shape, -1)); // lower
  points.push([0, 0]); // leading edge
  for (let i = 0; i < xs.length - 1; i += 1) points.push(surfacePoint(xs[i], shape, +1)); // upper
  return points;
}

/**
 * A smooth closed outline, for drawing rather than for solving.
 *
 * Same two formulae as `controlPoints`, sampled far more finely: a diagram wants a curve, and
 * the six control points per surface exist to be *dragged*, which is a different job.
 */
export function outline(shape, count = 60) {
  const xs = stations(count);
  const upper = xs.map((x) => surfacePoint(x, shape, +1));
  const lower = xs.map((x) => surfacePoint(x, shape, -1)).reverse();
  return [...lower, ...upper.slice(1)];
}
