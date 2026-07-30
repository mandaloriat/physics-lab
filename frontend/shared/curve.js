/**
 * A line plot, in SVG, in one file.
 *
 * Four of the five planned exercises need one: a surface pressure distribution, an incidence
 * sweep, a convergence history, a frequency response. The protocol has no result kind for a
 * curve (filed upstream as fenix-spoon#69) and `<fs-viewer>` draws fields rather than lines, so
 * the lab draws its own.
 *
 * This is not a charting library and should not become one. It draws axes, traces, an optional
 * inverted y axis and a hover readout, from plain arrays of `[x, y]` pairs. Anything more
 * belongs in a dependency, and the moment that is true is the moment to reconsider ADR-009.
 */

import { el } from '/shared/components.js';

const SVG = 'http://www.w3.org/2000/svg';
const PAD = { left: 46, right: 10, top: 10, bottom: 30 };

function node(name, attrs = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  return element;
}

/** Round a range outwards to a readable step, so the axis labels are not 0.7333. */
function niceRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.5 };
  if (max - min < 1e-12) return { min: min - 0.5, max: max + 0.5, step: 0.5 };
  const raw = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

function ticks({ min, max, step }) {
  const out = [];
  // Accumulate by index rather than by repeated addition: 0.1 + 0.1 + 0.1 does not land on 0.3,
  // and an axis labelled 0.30000000000000004 is its own bug report.
  for (let i = 0; min + i * step <= max + step * 1e-6; i += 1) out.push(min + i * step);
  return out;
}

function format(value, step) {
  const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step)) + (step < 1 ? 1 : 0)));
  return value.toFixed(digits);
}

/**
 * Draw a plot into `container`, replacing whatever was there.
 *
 * @param {HTMLElement} container
 * @param {{traces: Array<{name: string, points: number[][], dashed?: boolean}>,
 *   xLabel: string, yLabel: string, invertY?: boolean, height?: number,
 *   marks?: Array<{y?: number, x?: number, label?: string}>}} spec
 */
export function drawCurve(container, spec) {
  const { traces = [], xLabel = '', yLabel = '', invertY = false, height = 260, marks = [] } = spec;
  const points = traces.flatMap((trace) => trace.points).filter((p) => Number.isFinite(p[1]));
  container.replaceChildren();
  if (!points.length) {
    container.append(el('p', { class: 'field__hint', text: 'Nothing to plot yet.' }));
    return;
  }

  const width = Math.max(container.clientWidth || 520, 320);
  const xs = niceRange(Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0])));
  const ys = niceRange(Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1])));

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const toX = (v) => PAD.left + ((v - xs.min) / (xs.max - xs.min)) * plotW;
  const toY = (v) => {
    const t = (v - ys.min) / (ys.max - ys.min);
    // Inverted means *up is more negative*, which is the aeronautical convention for Cp and
    // the reason this option exists at all: a Cp plot drawn the other way up reads as wrong to
    // anyone who has seen one before.
    return invertY ? PAD.top + t * plotH : PAD.top + (1 - t) * plotH;
  };

  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'curve',
    role: 'img',
    'aria-label': `${yLabel} against ${xLabel}`,
  });

  for (const value of ticks(ys)) {
    svg.append(
      node('line', {
        class: 'curve__grid',
        x1: PAD.left,
        x2: width - PAD.right,
        y1: toY(value),
        y2: toY(value),
      }),
    );
    const label = node('text', {
      class: 'curve__tick',
      x: PAD.left - 6,
      y: toY(value) + 3.5,
      'text-anchor': 'end',
    });
    label.textContent = format(value, ys.step);
    svg.append(label);
  }
  for (const value of ticks(xs)) {
    const label = node('text', {
      class: 'curve__tick',
      x: toX(value),
      y: height - PAD.bottom + 16,
      'text-anchor': 'middle',
    });
    label.textContent = format(value, xs.step);
    svg.append(label);
  }

  for (const mark of marks) {
    if (mark.y !== undefined) {
      svg.append(
        node('line', {
          class: 'curve__mark',
          x1: PAD.left,
          x2: width - PAD.right,
          y1: toY(mark.y),
          y2: toY(mark.y),
        }),
      );
    }
    if (mark.x !== undefined) {
      svg.append(
        node('line', {
          class: 'curve__mark',
          x1: toX(mark.x),
          x2: toX(mark.x),
          y1: PAD.top,
          y2: height - PAD.bottom,
        }),
      );
    }
  }

  traces.forEach((trace, index) => {
    const usable = trace.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!usable.length) return;
    const path = usable.map(
      (p, i) => `${i ? 'L' : 'M'}${toX(p[0]).toFixed(2)},${toY(p[1]).toFixed(2)}`,
    );
    svg.append(
      node('path', {
        class: `curve__trace curve__trace--${index}`,
        d: path.join(' '),
        'stroke-dasharray': trace.dashed ? '4 3' : null,
      }),
    );
  });

  const xTitle = node('text', {
    class: 'curve__axis',
    x: PAD.left + plotW / 2,
    y: height - 2,
    'text-anchor': 'middle',
  });
  xTitle.textContent = xLabel;
  const yTitle = node('text', {
    class: 'curve__axis',
    x: 10,
    y: PAD.top + plotH / 2,
    'text-anchor': 'middle',
    transform: `rotate(-90 10 ${PAD.top + plotH / 2})`,
  });
  yTitle.textContent = yLabel;
  svg.append(xTitle, yTitle);

  container.append(svg);

  if (traces.length > 1) {
    container.append(
      el(
        'ul',
        { class: 'curve-legend' },
        ...traces.map((trace, index) =>
          el(
            'li',
            {},
            el('span', { class: `swatch swatch--trace-${index}` }),
            el('span', { text: trace.name }),
          ),
        ),
      ),
    );
  }
}
