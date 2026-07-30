/**
 * The parts of a page that make it an exercise rather than a demonstration.
 *
 * `experiment.js` holds what every page needs to *solve* — the solver picker, the parameter
 * form, the run-and-stream loop, the status line, the field view. This holds what every page
 * needs to give an **answer**: the challenge and whether it was met, the engineering metrics
 * kept apart from the cost of the solve, the verification residuals, and the stated domain of
 * validity. `docs/exercise-contract.md` §1 and §8.
 *
 * Still functions over DOM nodes, still no component model and no build step — see ADR-009 and
 * the note in ADR-013 about when that judgement should be re-read.
 */

import { el } from '/shared/components.js';

/* --------------------------------------------------------------- grouped parameter panels */

/**
 * Split a parameter list into the contract's three groups, in the order given.
 *
 * The classification belongs to the exercise, not here: only the exercise knows that
 * `mesh_size` is numerical and `u_inf` is physical. What this enforces is that every offered
 * parameter is classified — an unclassified one would land in whichever panel came last, which
 * is how a mesh size ends up looking like a fact about the air.
 *
 * @param {Array<{name: string, group: 'physical'|'numerical'|'study'}>} ui
 */
export function groupParameters(ui) {
  const groups = { physical: [], numerical: [], study: [] };
  for (const config of ui) {
    const group = groups[config.group];
    if (!group) throw new Error(`parameter ${config.name} has no group`);
    group.push(config);
  }
  return groups;
}

/* ------------------------------------------------------------------------- the challenge */

/**
 * Render the objective, and per target whether this run met it.
 *
 * Three rules keep this honest rather than a game (`docs/exercise-contract.md` §2):
 * a run with a validity warning cannot pass, whatever its numbers; a run whose verification
 * residual is above the stated threshold cannot pass either; and the target is never rewritten.
 *
 * @param {HTMLElement} container
 * @param {object} challenge from `content.json`
 * @param {{metrics: object, verification: object, validity: object}|null} report
 */
export function renderChallenge(container, challenge, report) {
  container.replaceChildren();
  if (!challenge) return;

  container.append(el('p', { class: 'challenge__statement', text: challenge.statement }));

  const rows = (challenge.targets ?? []).map((target) => {
    const value = report?.metrics?.[target.metric];
    const state = judge(target, value, report);
    return el(
      'li',
      { class: `challenge__target is-${state.state}` },
      el('span', { class: 'challenge__mark', text: state.mark, 'aria-hidden': 'true' }),
      el('span', {}, el('strong', { text: describeTarget(target) }), ` — ${state.detail}`),
    );
  });
  container.append(el('ul', { class: 'challenge__targets' }, ...rows));

  if (!report) return;
  const blocked = blockers(report, challenge);
  const allMet = rows.length > 0 && rows.every((row) => row.classList.contains('is-met'));
  if (blocked.length) {
    container.append(
      el(
        'p',
        { class: 'challenge__blocked' },
        el('strong', {
          // Every target can now read as met while the run itself is disqualified, so the two
          // are said separately: the numbers are one question, whether they count is another.
          text: allMet ? 'The numbers are there, but this run does not count: ' : 'Not met: ',
        }),
        blocked.join(' '),
      ),
    );
  } else if (allMet) {
    container.append(
      el(
        'p',
        { class: 'challenge__done' },
        el('strong', { text: 'Target met. ' }),
        'Keep the run, then try to meet it another way — a different profile at a different incidence, and compare.',
      ),
    );
  }
}

function describeTarget(target) {
  const unit = target.unit && target.unit !== '1' ? ` ${target.unit}` : '';
  const name = target.absolute ? `|${target.metric}|` : target.metric;
  if (target.comparator === '==') {
    const tolerance = target.tolerance
      ? ` ± ${target.tolerance_kind === 'relative' ? `${100 * target.tolerance} %` : target.tolerance}`
      : '';
    return `${name} = ${target.value}${unit}${tolerance}`;
  }
  return `${name} ${target.comparator} ${target.value}${unit}`;
}

function judge(target, value, report) {
  if (!report) return { state: 'pending', mark: '·', detail: 'not run yet' };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { state: 'pending', mark: '·', detail: 'this run does not report it' };
  }
  // A target is met or it is not, and that verdict is about the number alone. Whether the *run*
  // counts is a separate question, answered once by `blockers` below — marking a satisfied
  // target with a cross because the run was disqualified elsewhere tells the visitor their
  // number was wrong when it was not.
  const met = meets(target, value);
  return {
    state: met ? 'met' : 'missed',
    mark: met ? '✓' : '✕',
    detail: `this run: ${round(target.absolute ? Math.abs(value) : value)}`,
  };
}

/**
 * Whether one target is satisfied.
 *
 * `absolute: true` compares the magnitude, and it has to be asked for explicitly. Inferring it
 * from the comparator is how "|C_m| < 0.08" silently becomes "C_m < 0.08", which every
 * nose-down profile passes however large its moment.
 */
function meets(target, value) {
  const measured = target.absolute ? Math.abs(value) : value;
  switch (target.comparator) {
    case '<':
      return measured < target.value;
    case '<=':
      return measured <= target.value;
    case '>':
      return measured > target.value;
    case '>=':
      return measured >= target.value;
    case '==': {
      const tolerance =
        target.tolerance_kind === 'relative'
          ? Math.abs(target.value) * (target.tolerance ?? 0)
          : (target.tolerance ?? 0);
      return Math.abs(measured - target.value) <= tolerance;
    }
    default:
      return false;
  }
}

/** Why a run cannot pass even though its numbers do. */
function blockers(report, challenge) {
  const out = [];
  if (challenge.requires_valid && (report.validity?.warnings ?? []).length) {
    out.push(
      'this run is outside the model’s stated domain of validity, so its numbers do not count.',
    );
  }
  const required = challenge.requires_verified;
  if (required) {
    const residual = report.verification?.[required.metric];
    if (typeof residual === 'number' && residual > required.below) {
      out.push(
        `the verification residual ${required.metric} is ${round(residual)}, above the ${required.below} this exercise asks for.`,
      );
    }
  }
  return out;
}

function round(value) {
  if (typeof value !== 'number') return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return value.toExponential(2);
  return String(Number(value.toPrecision(magnitude < 1 ? 3 : 5)));
}

/* --------------------------------------------------------------------------- the answer */

/**
 * The metrics table: name, symbol, value, unit — and nothing about what the solve cost.
 *
 * A metric the model cannot produce is **absent**, and a metric that needs a study says so
 * instead of showing a number from one solve.
 *
 * @param {Array<{key: string, label: string, symbol?: string, unit?: string, digits?: number,
 *   hint?: string, requires?: string}>} spec
 */
export function renderMetrics(container, spec, report) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: 'Nothing computed yet.' }));
    return;
  }

  const rows = spec.map((metric) => {
    const value = report.metrics?.[metric.key];
    const missing = metric.requires && !report[metric.requires];
    const text = missing
      ? `needs ${metric.requires === 'sweep' ? 'an incidence sweep' : metric.requires}`
      : value === null || value === undefined
        ? 'not applicable'
        : typeof value === 'number'
          ? value.toFixed(metric.digits ?? 4)
          : String(value);

    return el(
      'tr',
      { class: missing || value === null ? 'is-absent' : null },
      el(
        'th',
        { scope: 'row', title: metric.hint ?? null },
        el('span', { text: metric.label }),
        metric.symbol ? el('span', { class: 'metrics__symbol', text: metric.symbol }) : null,
      ),
      el('td', { class: 'num', text: text }),
      el('td', {
        class: 'metrics__unit',
        text: metric.unit && metric.unit !== '1' ? metric.unit : '',
      }),
    );
  });

  container.append(el('table', { class: 'metrics' }, el('tbody', {}, ...rows)));
}

/**
 * The verification panel: every check as a residual against its tolerance.
 *
 * @param {Array<{key: string, label: string, tolerance: string, describe?: string}>} spec
 */
export function renderVerification(container, spec, report) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: 'Runs with every solve.' }));
    return;
  }

  const rows = spec.map((check) => {
    const value = report.verification?.[check.key];
    const limit = report.verification?.[check.tolerance];
    const known = typeof value === 'number' && typeof limit === 'number';
    const passed = known && value <= limit;
    return el(
      'tr',
      { class: known ? (passed ? 'is-met' : 'is-missed') : 'is-absent' },
      el('th', { scope: 'row', title: check.describe ?? null, text: check.label }),
      el('td', { class: 'num', text: known ? format(value) : 'not run' }),
      el('td', { class: 'num metrics__unit', text: known ? `≤ ${format(limit)}` : '' }),
      el('td', { text: known ? (passed ? '✓' : '✕') : '·' }),
    );
  });

  container.append(el('table', { class: 'metrics metrics--checks' }, el('tbody', {}, ...rows)));
}

function format(value) {
  if (value === 0) return '0';
  return Math.abs(value) < 1e-3 ? value.toExponential(1) : value.toPrecision(3);
}

/**
 * The validity panel. Warnings, or an explicit statement that the run is inside the model.
 *
 * Silence is not the same as validity, so the "inside" case is written out rather than left as
 * an empty box a visitor has to interpret.
 */
export function renderValidity(container, report) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: 'Checked on every run.' }));
    return;
  }
  const warnings = report.validity?.warnings ?? [];
  if (!warnings.length) {
    container.append(
      el(
        'p',
        { class: 'validity validity--ok' },
        el('strong', { text: 'Inside the stated domain of validity. ' }),
        'Every limit this model declares was checked against this run and none was crossed.',
      ),
    );
    return;
  }
  container.append(
    el('ul', { class: 'validity validity--warn' }, ...warnings.map((text) => el('li', { text }))),
  );
}
