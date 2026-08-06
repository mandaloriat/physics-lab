/**
 * The diagrams the guided path's first three chapters are built around (ADR-021).
 *
 * Inline SVG, drawn with the same helpers the field overlay uses, for the same reason the
 * homepage thumbnails are real solves: a picture that was drawn by hand is a picture of what
 * somebody believed, and one generated from `naca.js` is a picture of the section the solver
 * is about to be handed. There is no illustration asset in this repository and this is how it
 * stays that way.
 *
 * The labels are translated like everything else a visitor reads (ADR-020) and live in the
 * string catalogue rather than here, so `scripts/check-i18n.mjs` can see them — hardcoded
 * English inside a drawing is exactly the kind of leak that checker exists to catch, and it
 * shipped in the first draft of this file.
 *
 * Every figure is `aria-hidden` at the call site, because each one illustrates a paragraph
 * sitting directly beside it — a screen reader that announced both would say the same thing
 * twice. Colours come from the stylesheet's tokens rather than being written in here, so dark
 * mode is handled by the same rules as everything else, and none of them encodes a magnitude:
 * they say which thing a line *is*, which is the rule the overlay palette already follows.
 */

import { t } from '/shared/i18n.js';
import { svgNode } from '/shared/workspace.js';
import { meanLine, outline, stations, surfacePoint } from './naca.js';

/** The section the diagrams describe. The page's own default, so the chapters and the bench
 *  open on the same shape and chapter 3 can name its digits. */
const SUBJECT = { m: 0.02, p: 0.4, t: 0.12 };

/**
 * A figure's frame: a `viewBox` in chord units, so every path below can be written in the
 * profile's own coordinates and never in pixels.
 */
function frame(host, viewBox, label) {
  const svg = svgNode('svg', {
    class: 'figure',
    viewBox,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
  });
  host.replaceChildren(svg);
  return svg;
}

function path(d, className) {
  return svgNode('path', { d, class: className });
}

/** A polyline through points already in figure coordinates. */
function line(points, className) {
  return path(
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)},${y.toFixed(4)}`).join(' '),
    className,
  );
}

/** The section itself, closed, in chord units with y already flipped for screen axes. */
function sectionPath(shape, className = 'figure__section') {
  const points = outline(shape).map(([x, y]) => [x, -y]);
  return path(
    `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)},${y.toFixed(4)}`).join(' ')} Z`,
    className,
  );
}

/**
 * A label, sized in the figure's own units.
 *
 * The size has to be passed rather than set in the stylesheet: these `viewBox`es are measured
 * in chord lengths and differ in width by more than two to one, so one CSS `font-size` renders
 * as a caption in the widest figure and as a headline in the narrowest. Anchoring is a
 * parameter for the same reason — a centred label is right above a symmetric thing and wrong
 * beside a leading edge.
 */
function text(x, y, content, className, size = 0.055, anchor = 'middle') {
  return svgNode(
    'text',
    { x, y, class: className, 'font-size': size, 'text-anchor': anchor },
    content,
  );
}

/* ------------------------------------------------------ 1. where the lift comes from */

/**
 * Streamlines parting around the section, crowding over its upper surface.
 *
 * **Schematic, and constructed rather than solved.** The real streamlines are one screen down,
 * integrated by the workspace from `vector_fields.velocity`; this figure exists to say what to
 * look for in them. But schematic is not the same as arbitrary, and the first draft of this
 * drawing ran its streamlines straight *through* the section, which is the precise opposite of
 * the thing the chapter beside it is explaining.
 *
 * So each line is displaced by the body instead of being drawn past it. A line whose
 * undisturbed height is `h` above the chord is lifted by the upper surface's own height at
 * that station, decaying with `h`:
 *
 *     y(x) = h + surface(x) · exp(−h / REACH)
 *
 * Three things fall out of that, and all three are the chapter's content rather than
 * decoration. At `h = 0` the line *is* the surface, so nothing crosses the body. Neighbouring
 * lines are pushed by slightly different amounts, so they **crowd** where the body is thickest
 * — which is the visual the words "the air speeds up over the top" refer to. And the lower
 * family is displaced by a smaller surface, so it crowds less, which is why the two sides are
 * not mirror images.
 *
 * The picture shows level air and a nose-up section, which is the image the chapter's own
 * opening asks for — a hand tilted out of a car window. The *solver* does the opposite and
 * tilts the stream instead, keeping the section in its own axes (docs/exercises/airfoil.md
 * §5.1); the two differ by a rotation, and a rotation cannot change which side the air is
 * squeezed on. The geometry below is built in the solver's convention and rotated at the end,
 * so the two never disagree about anything but the frame they are drawn in.
 */
export function drawFlowFigure(host) {
  const svg = frame(host, '-0.35 -0.44 1.85 0.88', t('airfoil.figures.flowAria'));
  const shape = { ...SUBJECT, m: 0.03 };
  /** Angle of attack for the picture, radians. */
  const ALPHA = 0.13;
  /** How far from the surface the body is still felt. */
  const REACH = 0.3;

  /** The surface's distance from the chord line at station `x`, positive on both sides. */
  const surfaceAt = (x, sign) => (x <= 0 || x >= 1 ? 0 : surfacePoint(x, shape, sign)[1] * sign);

  // In section axes the stream arrives at +ALPHA (that is what a positive incidence *means*:
  // the air comes from slightly below). Rotating the scene by −ALPHA in physical orientation
  // lays that stream flat and leaves the section nose-up. SVG measures its rotations on a
  // flipped y-axis, so a physical −ALPHA is written here as a positive angle; getting this
  // sign wrong draws a wing at negative incidence with the lift labels of a positive one.
  const flow = svgNode('g', {
    transform: `rotate(${((ALPHA * 180) / Math.PI).toFixed(3)} 0.4 0)`,
  });

  // One family per side. Both start at h = 0, so the dividing streamline is drawn twice — once
  // along each surface — which is what the stagnation point at the nose actually looks like.
  for (const sign of [+1, -1]) {
    for (let k = 0; k <= 5; k += 1) {
      const h = k * 0.075;
      const points = [];
      for (let i = 0; i <= 90; i += 1) {
        const x = -0.35 + (i / 90) * 1.85;
        // Undisturbed height: tilted, and less tilted far from the section, so the picture
        // does not run out of frame at its corners.
        const far = sign * h + ALPHA * x;
        // The body's own displacement, dying away with distance from it. At h = 0 this puts
        // the line exactly on the surface, so nothing ever crosses the section.
        const push = sign * surfaceAt(x, sign) * Math.exp(-h / REACH);
        points.push([x, -(far + push)]);
      }
      flow.append(line(points, `figure__stream${k <= 1 ? ' figure__stream--near' : ''}`));
    }
  }

  flow.append(sectionPath(shape));
  svg.append(flow);

  // Faster above, slower below — as words, because an arrow labelled "faster" is a claim the
  // reader can check against the streamline spacing right beside it.
  svg.append(text(0.42, -0.33, t('airfoil.figures.faster'), 'figure__note figure__note--low'));
  svg.append(text(0.42, 0.39, t('airfoil.figures.slower'), 'figure__note figure__note--high'));
  return svg;
}

/* ------------------------------------------------------------- 2. a slice of a wing */

/** A wing in perspective, the plane that cuts it, and the outline that falls out. */
export function drawSliceFigure(host) {
  const svg = frame(host, '0 0 2.4 1.0', t('airfoil.figures.sliceAria'));

  // A wing, in the crudest possible perspective: two chords joined at the tips.
  const root = [
    [0.12, 0.72],
    [0.95, 0.72],
    [0.86, 0.62],
    [0.2, 0.62],
  ];
  const tip = [
    [0.5, 0.2],
    [0.95, 0.2],
    [0.9, 0.14],
    [0.55, 0.14],
  ];
  svg.append(
    path(`M${root.map((p) => p.join(',')).join(' L')} Z`, 'figure__wing'),
    path(`M${tip.map((p) => p.join(',')).join(' L')} Z`, 'figure__wing'),
    path('M0.12,0.72 L0.5,0.2 M0.95,0.72 L0.95,0.2 M0.2,0.62 L0.55,0.14', 'figure__wing-edge'),
  );

  // The cutting plane, and where it lands.
  svg.append(
    path('M0.28,0.86 L0.66,0.06 L0.78,0.06 L0.4,0.86 Z', 'figure__plane'),
    text(0.53, 0.97, t('airfoil.figures.oneSlice'), 'figure__note'),
  );

  // The section it leaves, drawn from the formula rather than sketched.
  const group = svgNode('g', { transform: 'translate(1.28 0.46) scale(1.0)' });
  group.append(sectionPath(SUBJECT));
  group.append(path('M0,0 L1,0', 'figure__chord'));
  svg.append(group);
  svg.append(text(1.78, 0.72, t('airfoil.figures.perMetre'), 'figure__note'));
  svg.append(
    svgNode('path', {
      d: 'M0.86,0.46 L1.2,0.46',
      class: 'figure__arrow',
      'marker-end': 'url(#figure-arrow)',
    }),
  );
  return svg;
}

/* ------------------------------------------------------------ 3. the four digits */

/**
 * The anatomy of a four-digit section: the chord, the mean line, and the two measurements the
 * digits are.
 *
 * A section is only about 12 % as tall as it is long, so a figure drawn to scale is a sliver
 * with no room for a label. The `viewBox` is therefore much taller than the shape, and every
 * label is tied to the thing it names by a leader — the alternative, floating captions near
 * the right area, is what the first version of this drawing did, and it left "12 % thick"
 * sitting under the nose pointing at nothing.
 */
export function drawNacaFigure(host) {
  const svg = frame(host, '-0.16 -0.4 1.36 0.86', t('airfoil.figures.nacaAria'));
  const shape = SUBJECT;
  const SIZE = 0.052;
  /** Where the four-digit thickness distribution peaks — always 30 % of the chord. */
  const THICKEST = 0.3;

  svg.append(sectionPath(shape, 'figure__section figure__section--open'));

  // The chord: nose to tail in a straight line, and what every percentage is a fraction of.
  svg.append(path('M0,0 L1,0', 'figure__chord'));
  svg.append(text(0.68, 0.075, t('airfoil.figures.chord'), 'figure__note', SIZE * 0.92));

  // The mean line, from the same function the solver's geometry reader recovers from an outline.
  svg.append(
    line(
      stations(60).map((x) => [x, -meanLine(x, shape.m, shape.p).y]),
      'figure__mean',
    ),
  );

  // First digit: how high the mean line climbs. Second: where it does it. The leader turns
  // right and the label runs from there, so it clears the thickness label above rather than
  // being stacked on top of it — the two used to collide.
  const peakY = -meanLine(shape.p, shape.m, shape.p).y;
  svg.append(
    path(`M${shape.p},0.115 L${shape.p},${(peakY + 0.012).toFixed(4)}`, 'figure__tick'),
    text(shape.p, 0.175, t('airfoil.figures.secondDigit'), 'figure__note', SIZE * 0.92),
    path(
      `M${shape.p},${peakY.toFixed(4)} L${shape.p},-0.17 L${shape.p + 0.09},-0.17`,
      'figure__tick figure__tick--mean',
    ),
    text(
      shape.p + 0.11,
      -0.152,
      t('airfoil.figures.firstDigit'),
      'figure__note figure__note--mean',
      SIZE,
      'start',
    ),
  );

  // Last two digits: the greatest thickness, measured across the section where it is thickest.
  const upper = surfacePoint(THICKEST, shape, +1);
  const lower = surfacePoint(THICKEST, shape, -1);
  svg.append(
    path(
      `M${upper[0].toFixed(4)},${(-upper[1]).toFixed(4)} L${lower[0].toFixed(4)},${(-lower[1]).toFixed(4)}`,
      'figure__tick figure__tick--thick',
    ),
    path(`M${THICKEST},${(-upper[1]).toFixed(4)} L${THICKEST - 0.03},-0.29`, 'figure__tick'),
    text(
      THICKEST + 0.02,
      -0.315,
      t('airfoil.figures.lastTwo'),
      'figure__note figure__note--thick',
      SIZE,
      'middle',
    ),
  );

  svg.append(
    text(-0.02, 0.02, t('airfoil.figures.nose'), 'figure__note', SIZE * 0.92, 'end'),
    text(1.03, 0.02, t('airfoil.figures.tail'), 'figure__note', SIZE * 0.92, 'start'),
  );
  return svg;
}

/**
 * The one shared SVG definition the figures need: an arrowhead.
 *
 * `marker-end` refers to it by id, so it has to exist in the document once. Kept here rather
 * than in the markup so a page gains it by importing the figures, and a page that never draws
 * one never carries it.
 */
export function mountFigureDefs(root) {
  if (root.querySelector('#figure-defs')) return;
  const svg = svgNode('svg', { id: 'figure-defs', width: '0', height: '0', 'aria-hidden': 'true' });
  const marker = svgNode('marker', {
    id: 'figure-arrow',
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '5',
    markerHeight: '5',
    orient: 'auto-start-reverse',
  });
  marker.append(svgNode('path', { d: 'M0,0 L10,5 L0,10 Z', class: 'figure__arrowhead' }));
  svg.append(svgNode('defs', {}, marker));
  root.prepend(svg);
}
