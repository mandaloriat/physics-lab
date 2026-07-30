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
 * **No internal identifiers reach the screen.** A target names a metric by the key the report
 * uses — `l_prime`, `c_m_c4` — and printing that key was telling a visitor about the lab's
 * variable names rather than about aerodynamics. The `labels` table maps each key to the name,
 * symbol and unit a person reads, and a key with no entry falls back to the key, so a new
 * metric is visibly unlabelled rather than silently mislabelled.
 *
 * @param {HTMLElement} container
 * @param {object} challenge from `content.json`
 * @param {{metrics: object, verification: object, validity: object}|null} report
 * @param {Record<string, {label: string, symbol?: string, unit?: string}>} [labels]
 */
export function renderChallenge(container, challenge, report, labels = {}) {
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
      el(
        'span',
        { class: 'challenge__wording' },
        el('strong', { text: describeTarget(target, labels) }),
        el('span', { class: 'challenge__reading', text: state.detail }),
      ),
    );
  });
  container.append(el('ul', { class: 'challenge__targets' }, ...rows));

  if (!report) return;
  const allMet = rows.length > 0 && rows.every((row) => row.classList.contains('is-met'));

  // Two disqualifications, said separately and never merged. "Outside the model" and "the
  // solve did not verify" are different facts about a run, and a visitor who reads one
  // sentence containing both cannot tell which of their choices to change.
  const outside = challenge.requires_valid ? (report.validity?.warnings ?? []) : [];
  const unverified = verificationBlocker(report, challenge);

  if (outside.length) {
    container.append(
      el(
        'p',
        { class: 'challenge__blocked challenge__blocked--validity' },
        el('strong', {
          text: allMet
            ? 'The numbers are right, but the model is outside its domain of validity. '
            : 'This run is outside the model’s domain of validity. ',
        }),
        `${outside.length === 1 ? 'The limit crossed is' : 'The limits crossed are'} listed under “How far to trust it”, and a run that crosses one cannot meet the target however good its numbers look.`,
      ),
    );
  }
  if (unverified) {
    container.append(
      el(
        'p',
        { class: 'challenge__blocked challenge__blocked--verification' },
        el('strong', { text: 'This run did not verify. ' }),
        unverified,
      ),
    );
  }
  if (!outside.length && !unverified && allMet) {
    container.append(
      el(
        'p',
        { class: 'challenge__done' },
        el('strong', { text: 'Target met. ' }),
        'Keep the run, then try to meet it another way — a different profile at a different incidence — and compare the two.',
      ),
    );
  }
}

/** A target as a person reads it: `|C_m,c/4| < 0.08`, not `|c_m_c4| < 0.08`. */
function describeTarget(target, labels = {}) {
  const entry = labels[target.metric] ?? {};
  const unitOf = entry.unit ?? target.unit;
  const unit = unitOf && unitOf !== '1' ? ` ${unitOf}` : '';
  const symbol = entry.symbol ?? entry.label ?? target.metric;
  const name = target.absolute ? `|${symbol}|` : symbol;
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

/**
 * The verification disqualification, as a sentence, or null.
 *
 * Deliberately does not name the residual's key: the visitor is told what disagreed and by
 * how much, which is the actionable half, and the key is in the verification table beside its
 * own explanation.
 */
function verificationBlocker(report, challenge) {
  const required = challenge.requires_verified;
  if (!required) return null;
  const residual = report.verification?.[required.metric];
  if (typeof residual !== 'number' || residual <= required.below) return null;
  return (
    `The two independent routes to the answer differ by ${round(100 * residual)} %, ` +
    `above the ${round(100 * required.below)} % this exercise asks for. Add panels and run again.`
  );
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
/**
 * The headline answer: a handful of numbers, large, before any table.
 *
 * The contract's §7 says the metrics *are* the answer, and a table of ten rows does not read
 * as one — the eye has to search it for the two numbers the challenge is about. So the same
 * data is shown twice on purpose: a short row of tiles that answers the question, and the full
 * table underneath for everything else.
 *
 * A tile whose value is missing is drawn showing *why* rather than omitted, because "the
 * aerodynamic centre needs a sweep" is itself part of the physics being taught.
 *
 * @param {Array<{key: string, label: string, symbol?: string, unit?: string, digits?: number,
 *   from?: (report: object) => number|null|undefined, requires?: string,
 *   absent?: string}>} spec
 */
export function renderKpis(container, spec, report) {
  container.replaceChildren();
  if (!report) return;

  container.append(
    ...spec.map((kpi) => {
      const value = kpi.from ? kpi.from(report) : report.metrics?.[kpi.key];
      const known = typeof value === 'number' && Number.isFinite(value);
      return el(
        'div',
        { class: `kpi${known ? '' : ' is-absent'}`, title: kpi.hint ?? null },
        el(
          'span',
          { class: 'kpi__name' },
          el('span', { text: kpi.label }),
          kpi.symbol ? el('span', { class: 'kpi__symbol', text: kpi.symbol }) : null,
        ),
        el('span', {
          class: known ? 'kpi__value num' : 'kpi__value kpi__value--absent',
          text: known ? value.toFixed(kpi.digits ?? 3) : (kpi.absent ?? 'not applicable'),
        }),
        el('span', {
          class: 'kpi__unit',
          text: known && kpi.unit && kpi.unit !== '1' ? kpi.unit : '',
        }),
      );
    }),
  );
}

export function renderMetrics(container, spec, report) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: 'Runs with every solve.' }));
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
