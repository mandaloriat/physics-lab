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
import { richText } from '/shared/experiment.js';
import { num, t } from '/shared/i18n.js';

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
 * Render the challenge: what has to be achieved, and per target whether this attempt got there.
 *
 * Three rules keep this honest rather than a game (`docs/exercise-contract.md` §2):
 * an attempt with a validity warning cannot pass, whatever its numbers; one whose verification
 * residual is above the stated threshold cannot pass either; and the target is never rewritten.
 *
 * **Meaning before symbol.** A target names a metric by the key the report uses — `l_prime`,
 * `c_m_c4` — and printing that key told a visitor about the lab's variable names rather than
 * about aerodynamics. Printing `|C_m,c/4| < 0.08` was the next version of the same mistake: it
 * is correct, and it is unreadable to somebody meeting a pitching moment for the first time. So
 * each label may now carry a `plain` wording, which is what the challenge shows; the symbol
 * moves into the tooltip, where it is available the moment it means something. A key with no
 * entry falls back to the key, so a new metric is visibly unlabelled rather than silently
 * mislabelled.
 *
 * **Nothing here knows which exercise it is rendering.** The wording of what a target *is*
 * belongs to the exercise, and the outcome messages live in {@link renderOutcome}, so what is
 * left in this function is the shape alone.
 *
 * @param {HTMLElement} container
 * @param {object} challenge from `content.json`
 * @param {{metrics: object, verification: object, validity: object}|null} report
 * @param {Record<string, {label: string, plain?: string, symbol?: string, unit?: string}>}
 *   [labels]
 */
export function renderChallenge(container, challenge, report, labels = {}) {
  container.replaceChildren();
  if (!challenge) return;

  // `plain_statement` is the challenge as a student reads it; `statement` is the same mission
  // in the units and symbols an engineer would state it in, and stays available in the model
  // details. A file that has only the old field still reads — one register rather than two.
  container.append(
    el('p', {
      class: 'challenge__statement',
      text: challenge.plain_statement ?? challenge.statement,
    }),
  );

  const rows = (challenge.targets ?? []).map((target) => {
    const value = report?.metrics?.[target.metric];
    const state = judge(target, value, report);
    return el(
      'li',
      { class: `challenge__target is-${state.state}`, title: describeTarget(target, labels) },
      el('span', { class: 'challenge__mark', text: state.mark, 'aria-hidden': 'true' }),
      el(
        'span',
        { class: 'challenge__wording' },
        el('strong', { text: plainTarget(target, labels) }),
        el('span', { class: 'challenge__reading', text: state.detail }),
      ),
    );
  });
  container.append(el('ul', { class: 'challenge__targets' }, ...rows));
}

/**
 * What state an attempt is in, by the priority `docs/exercise-contract.md` and §13.5 of the
 * editorial review both set: a failure to solve outranks a failed numerical check, which
 * outranks a model asked a question outside its own domain, which outranks a missed target.
 *
 * Returned as one word so that the page has a single thing to switch on. An attempt can be in
 * more than one kind of trouble at once and the visitor is told about the first, because a
 * message listing three problems is a message that names none.
 *
 * @returns {'not_run'|'solving'|'failed'|'numeric_unverified'|'model_outside'|'target_missed'
 *   |'target_met'}
 */
export function attemptState(challenge, report, { solving = false, failed = false } = {}) {
  if (failed) return 'failed';
  if (solving) return 'solving';
  if (!report) return 'not_run';
  if (verificationBlocker(report, challenge)) return 'numeric_unverified';
  if (challenge?.requires_valid && (report.validity?.warnings ?? []).length) return 'model_outside';
  const targets = challenge?.targets ?? [];
  const met =
    targets.length > 0 &&
    targets.every((target) => meets(target, report.metrics?.[target.metric] ?? NaN));
  return met ? 'target_met' : 'target_missed';
}

/**
 * How the attempt went, in one short line.
 *
 * The long version of this used to live inside {@link renderChallenge}: three paragraphs that
 * explained which panel below listed the crossed limit and why a disqualified run could not
 * count. That is the page describing its own furniture. What a visitor needs here is the
 * verdict; the reasons are one panel down and one click away, where they were all along.
 *
 * A met target invites a second solve in the exercise's own terms, which is why the second
 * route comes from `challenge.next_step` rather than from a sentence written here — hardcoding
 * one exercise's wording is how the magnetic circuit came to suggest a different aerofoil
 * incidence.
 */
export function renderOutcome(container, state, challenge, report) {
  container.replaceChildren();
  container.hidden = state === 'not_run' || state === 'solving';
  if (container.hidden) return;

  // Outside the model *with every number where it was asked to be* is its own sentence, and
  // has to be: told only "this attempt does not count", a student who has just hit 800 N/m
  // reads it as the page refusing a correct answer.
  const numbersMet =
    state === 'model_outside' &&
    (challenge?.targets ?? []).length > 0 &&
    (challenge?.targets ?? []).every((target) =>
      meets(target, report?.metrics?.[target.metric] ?? NaN),
    );

  const lines = {
    failed: ['exercise.outcome.failedLead', 'exercise.outcome.failedTail'],
    numeric_unverified: ['exercise.outcome.unverifiedLead', 'exercise.outcome.unverifiedTail'],
    model_outside: numbersMet
      ? ['exercise.outcome.outsideMetLead', 'exercise.outcome.outsideMetTail']
      : ['exercise.outcome.outsideLead', 'exercise.outcome.outsideTail'],
    target_missed: ['exercise.outcome.missedLead', 'exercise.outcome.missedTail'],
    target_met: ['exercise.outcome.metLead', null],
  }[state];
  if (!lines) return;

  const tail =
    state === 'target_met'
      ? challenge?.next_step
        ? t('exercise.outcome.metTail', { next: challenge.next_step })
        : t('exercise.outcome.metTailPlain')
      : t(lines[1]);

  container.className = `outcome outcome--${state === 'target_met' ? 'met' : 'missed'}`;
  container.append(el('strong', { text: t(lines[0]) }), ` ${tail}`);
}

/**
 * The two questions that are not the same question: is the arithmetic settled, and does the
 * model apply?
 *
 * A solve can be numerically impeccable and physically beside the point, and the lab has always
 * known the difference — it was buried in a panel of residuals with tolerances beside them,
 * which is the form in which nobody reads it. Two indicators, three states each, and the
 * residuals still one disclosure away.
 *
 * The second indicator is never green on the strength of the first. "Stable" is a claim about
 * the discretisation; "applicable" is a claim about the physics, and no amount of refinement
 * makes an inviscid model see a stall.
 */
export function renderCredibility(container, challenge, report, { checks, detailsId } = {}) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: t('exercise.everyRun') }));
    return;
  }

  const numeric = numericState(report, challenge, checks);
  const warnings = report.validity?.warnings ?? [];
  const physical = !warnings.length ? 'yes' : challenge?.requires_valid ? 'no' : 'caution';

  const indicator = (kind, state, describe) =>
    el(
      'div',
      { class: `credibility credibility--${state}` },
      el(
        'p',
        { class: 'credibility__head' },
        el('strong', { text: t(`exercise.credibility.${kind}`) }),
        // The word, not only the colour: §13.9's rule, and the reason the state is a noun
        // rather than a green dot.
        el('span', { class: 'credibility__verdict', text: t(`exercise.credibility.${state}`) }),
      ),
      el('p', { class: 'credibility__why', text: describe }),
    );

  container.append(
    indicator('numeric', numeric, t('exercise.credibility.numericWhat')),
    indicator('physical', physical, t('exercise.credibility.physicalWhat')),
  );

  if (physical !== 'yes' && warnings.length) {
    container.append(
      el('ul', { class: 'credibility__warnings' }, ...warnings.map((text) => el('li', { text }))),
    );
  }
  if (detailsId) {
    container.append(
      el(
        'p',
        { class: 'credibility__more' },
        el('a', { href: `#${detailsId}`, text: t('exercise.credibility.seeChecks') }),
      ),
    );
  }
}

/**
 * `yes` when every declared check passed, `improve` when one did not, `unchecked` when none ran.
 *
 * The residual-to-tolerance pairing comes from the page's own `CHECKS` spec — the same list
 * {@link renderVerification} renders — rather than from a naming convention. There is no
 * convention to rely on: the reports carry `cl_consistency_tolerance` and `energy_balance_tol`
 * side by side, so a guessed suffix finds nothing, silently skips the check, and reports a
 * settled computation over a residual that is out of bounds. Which is worse than no indicator.
 *
 * Without a spec this answers `unchecked`, because "we did not look" and "we looked and it was
 * fine" are different claims and only one of them is this function's to make.
 */
function numericState(report, challenge, spec) {
  if (verificationBlocker(report, challenge)) return 'improve';
  const pairs = (spec ?? [])
    .map((check) => [report.verification?.[check.key], report.verification?.[check.tolerance]])
    .filter(([value, limit]) => typeof value === 'number' && typeof limit === 'number');
  if (!pairs.length) return 'unchecked';
  return pairs.every(([value, limit]) => value <= limit) ? 'yes' : 'improve';
}

/**
 * A contextual nudge after an attempt that did not pass: one problem, one direction, no answer.
 *
 * The rules that choose the sentence belong to the exercise and are plain data there — §13.7
 * rules out a text generator on purpose, because a suggestion that names the winning value is
 * not a hint, it is the solution with extra steps.
 */
export function renderHint(container, hint) {
  if (!container) return;
  container.replaceChildren();
  container.hidden = !hint;
  if (!hint) return;
  container.append(
    el('span', { class: 'hint__mark', text: '→', 'aria-hidden': 'true' }),
    el('span', { text: hint }),
  );
}

/** A target as a student reads it: "lift within 2 % of 800 N per metre", not `|C_m,c/4| < 0.08`. */
function plainTarget(target, labels = {}) {
  const entry = labels[target.metric] ?? {};
  if (entry.goal) return entry.goal;
  const name = entry.plain ?? entry.label ?? target.metric;
  const unitOf = entry.plainUnit ?? entry.unit ?? target.unit;
  const unit = unitOf && unitOf !== '1' ? ` ${unitOf}` : '';
  if (target.comparator === '==') {
    const tolerance = target.tolerance
      ? t('exercise.within', {
          amount:
            target.tolerance_kind === 'relative'
              ? `${100 * target.tolerance} %`
              : String(target.tolerance),
        })
      : '';
    return `${name}: ${target.value}${unit}${tolerance}`;
  }
  const relation = t(
    target.comparator === '<' || target.comparator === '<='
      ? 'exercise.atMost'
      : 'exercise.atLeast',
  );
  return `${name}: ${relation} ${target.value}${unit}`;
}

/** The same target in the register an engineer states it in. Tooltip and model details only. */
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
  if (!report) return { state: 'pending', mark: '·', detail: t('exercise.notRunYet') };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { state: 'pending', mark: '·', detail: t('exercise.notReported') };
  }
  // A target is met or it is not, and that verdict is about the number alone. Whether the *run*
  // counts is a separate question, answered once by `blockers` below — marking a satisfied
  // target with a cross because the run was disqualified elsewhere tells the visitor their
  // number was wrong when it was not.
  const met = meets(target, value);
  return {
    state: met ? 'met' : 'missed',
    mark: met ? '✓' : '✕',
    detail: t('exercise.reading', { value: round(target.absolute ? Math.abs(value) : value) }),
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
  return t('exercise.verificationGap', {
    value: round(100 * residual),
    limit: round(100 * required.below),
  });
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
 *   hint?: string, requires?: string, absent?: string}>} spec
 */
/**
 * The headline answer: at most three numbers, each against what it has to reach.
 *
 * The contract's §7 says the metrics *are* the answer, and a table of ten rows does not read
 * as one — the eye has to search it for the two numbers the challenge is about. So the same
 * data is shown twice on purpose: a short row of tiles that answers the question, and the full
 * table underneath for everything else.
 *
 * What changed with the editorial review is that a tile is no longer a number with a label. A
 * bare `784` answers nothing on its own: the reading a student needs is **784 of the 800 you
 * were asked for, and 16 short**. So a tile carries four things — a plain name, the reading
 * against its goal, a bar, and one sentence saying where that leaves the attempt — and the
 * technical symbol drops into the tooltip, where it waits until it means something.
 *
 * A tile whose value is missing is drawn showing *why* rather than omitted, because "the
 * aerodynamic centre needs a sweep" is itself part of the physics being taught.
 *
 * @param {Array<{key: string, label: string, symbol?: string, unit?: string, plainUnit?: string,
 *   digits?: number, hint?: string, goal?: {value: number, comparator: string,
 *   tolerance?: number, tolerance_kind?: string, absolute?: boolean},
 *   note?: (value: number, report: object) => string|null,
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
      const unit = kpi.plainUnit ?? (kpi.unit && kpi.unit !== '1' ? kpi.unit : '');
      // The sign is part of the reading and is kept. Only a goal that was written as a
      // magnitude — `|C_m,c/4| < 0.08` — compares the absolute value, and only then is the
      // tile allowed to drop the sign; a suction peak shown as `1.41` instead of `−1.41`
      // is a different number, and the wrong one.
      const shown = known ? (kpi.goal?.absolute ? Math.abs(value) : value) : NaN;
      const state = known && kpi.goal ? (meets(kpi.goal, value) ? 'met' : 'missed') : null;

      return el(
        'div',
        {
          class: `kpi${known ? '' : ' is-absent'}${state ? ` is-${state}` : ''}`,
          title: [kpi.symbol, kpi.hint].filter(Boolean).join(' — ') || null,
        },
        el('span', { class: 'kpi__name' }, el('span', { text: kpi.label })),
        el(
          'span',
          { class: 'kpi__reading' },
          el('span', {
            class: known ? 'kpi__value num' : 'kpi__value kpi__value--absent',
            text: known ? decimal(shown, kpi.digits) : (kpi.absent ?? t('exercise.notApplicable')),
          }),
          known && kpi.goal
            ? el('span', {
                class: 'kpi__goal num',
                text: ` / ${decimal(kpi.goal.value, kpi.digits)}`,
              })
            : null,
          el('span', { class: 'kpi__unit', text: known && unit ? ` ${unit}` : '' }),
        ),
        known && kpi.goal ? bar(shown, kpi.goal) : null,
        known
          ? el('span', {
              class: 'kpi__note',
              text: kpi.note?.(value, report) ?? defaultNote(value, kpi),
            })
          : null,
      );
    }),
  );
}

/**
 * The bar under a tile, as a `<meter>`-shaped `<div>` with its numbers said out loud.
 *
 * Not a `<meter>` element: its low/high/optimum semantics describe a gauge whose good region is
 * a band, which is right for one of these targets and wrong for the other two, and a browser
 * that colours it by its own rule would contradict the verdict beside it. What matters for
 * §13.9 is that the value and the limit are readable without the picture, and that is what the
 * ARIA attributes here carry.
 */
function bar(value, goal) {
  const fraction = goal.value === 0 ? 0 : Math.min(1.15, Math.abs(value / goal.value));
  return el(
    'span',
    {
      class: 'kpi__bar',
      role: 'img',
      'aria-label': t('exercise.tile.barAria', {
        value: decimal(value),
        limit: decimal(goal.value),
      }),
    },
    el('span', {
      class: 'kpi__fill',
      style: `width: ${(100 * Math.min(1, fraction)).toFixed(1)}%`,
    }),
    fraction > 1 ? el('span', { class: 'kpi__over' }) : null,
  );
}

/**
 * Where this reading leaves the attempt, in one clause.
 *
 * Generic on purpose: an exercise that wants its own sentence passes `note`, and this is what
 * every other tile gets rather than a blank line. Two or three significant figures, per §12.5 —
 * a shortfall printed as `15.9999998` is machine precision pretending to be a measurement.
 */
function defaultNote(value, kpi) {
  const goal = kpi.goal;
  if (!goal) return '';
  const measured = goal.absolute ? Math.abs(value) : value;
  const unit = kpi.plainUnit ?? (kpi.unit && kpi.unit !== '1' ? kpi.unit : '');
  const amount = (delta) => `${decimal(Math.abs(delta), kpi.digits)}${unit ? ` ${unit}` : ''}`;

  if (goal.comparator === '==') {
    if (meets(goal, value)) return t('exercise.tile.within');
    return measured < goal.value
      ? t('exercise.tile.short', { delta: amount(goal.value - measured) })
      : t('exercise.tile.over', { delta: amount(measured - goal.value) });
  }
  if (goal.comparator === '<' || goal.comparator === '<=') {
    return meets(goal, value)
      ? t('exercise.tile.spare', { margin: amount(goal.value - measured) })
      : t('exercise.tile.above', { delta: amount(measured - goal.value) });
  }
  return meets(goal, value)
    ? t('exercise.tile.spare', { margin: amount(measured - goal.value) })
    : t('exercise.tile.below', { delta: amount(goal.value - measured) });
}

/** Two or three significant figures, in the reader's own decimal separator. */
function decimal(value, digits) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const places =
    digits ??
    (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : Math.abs(value) >= 1 ? 2 : 3);
  return num(value, { minimumFractionDigits: places, maximumFractionDigits: places });
}

export function renderMetrics(container, spec, report) {
  container.replaceChildren();
  if (!report) {
    container.append(el('p', { class: 'field__hint', text: t('exercise.everySolve') }));
    return;
  }

  const rows = spec.map((metric) => {
    // `from` reads a quantity that does not live in `metrics` — the aerodynamic centre is a
    // property of a *sweep* and the report puts it there. Same escape hatch `renderKpis` has,
    // and it is needed in both places for the same quantity, which is the argument for it.
    const value = metric.from ? metric.from(report) : report.metrics?.[metric.key];
    const missing = metric.requires && !report[metric.requires];
    // `requires` names a key in the report; `absent` names the same prerequisite the way a
    // visitor reads it. The wording belongs to the exercise — "an incidence sweep" is what a
    // missing `sweep` means on the aerofoil and not on anything else — so the fallback prints
    // the bare key rather than one exercise's sentence.
    const text = missing
      ? (metric.absent ?? t('exercise.needs', { key: metric.requires }))
      : value === null || value === undefined
        ? t('exercise.notApplicable')
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
    container.append(el('p', { class: 'field__hint', text: t('exercise.everySolve') }));
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
      el('td', { class: 'num', text: known ? format(value) : t('exercise.notRun') }),
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
    container.append(el('p', { class: 'field__hint', text: t('exercise.everyRun') }));
    return;
  }
  // The warnings themselves are the solver's own sentences, shown as it wrote them: they are
  // computed prose with the crossed threshold interpolated into it, and translating them means
  // translating `physics_lab/solvers/*.py` rather than this file. ADR-020 §"What is not
  // translated" says so on the page's behalf, and is where that work is scoped.
  const warnings = report.validity?.warnings ?? [];
  if (!warnings.length) {
    container.append(
      el(
        'p',
        { class: 'validity validity--ok' },
        el('strong', { text: t('exercise.inside') }),
        t('exercise.insideTail'),
      ),
    );
    return;
  }
  container.append(
    el('ul', { class: 'validity validity--warn' }, ...warnings.map((text) => el('li', { text }))),
  );
}

/* --------------------------------------------------------------------- after the attempt */

/**
 * "Why it happens": at most three short cards, and none of them before the first solve.
 *
 * The withholding is the point rather than a reward. The old pages explained the phenomenon
 * above the controls, which meant a student read the answer, moved a slider until the number
 * matched, and never formed a prediction that could be wrong. §7.9 turns that around: the
 * explanation arrives once there is something of the visitor's own to explain.
 *
 * A card may quote the attempt it is explaining. `facts` fills `{placeholders}` in the prose —
 * "in your attempt, diagonal 7 is in compression and 4.8 m long" is worth more than three
 * paragraphs of the general case, and it can only be written once the numbers exist.
 *
 * @param {HTMLElement} container
 * @param {Array<{id: string, heading: string, body: string[]}>} cards from `content.json`
 * @param {{unlocked: boolean, facts?: Record<string, string|number>}} state
 */
export function renderExplain(container, cards, { unlocked, facts = {} } = {}) {
  if (!container) return;
  container.replaceChildren();
  if (!cards?.length) return;

  if (!unlocked) {
    container.append(el('p', { class: 'field__hint', text: t('exercise.explainLocked') }));
    return;
  }

  const fill = (text) =>
    String(text).replace(/\{(\w+)\}/g, (whole, name) =>
      Object.hasOwn(facts, name) ? String(facts[name]) : whole,
    );

  container.append(
    ...cards.map((card) =>
      el(
        'article',
        { class: 'explain__card' },
        el('h3', { class: 'explain__heading', text: card.heading }),
        ...(card.body ?? []).map((paragraph) => el('p', {}, richText(fill(paragraph)))),
      ),
    ),
  );
}

/**
 * Everything that happens *after* an attempt, in one call.
 *
 * Four renderers in a fixed order, because the order is the hierarchy the review is about:
 * the verdict, then one suggestion, then whether the answer can be believed, then — and only
 * then — why any of it happened. Each page calls this from its own `present()` with its own
 * DOM handles; what it saves is not the lines but the ordering, which four pages would
 * otherwise each be free to get subtly different.
 *
 * @param {{outcome: HTMLElement, hint: HTMLElement, credibility: HTMLElement,
 *   explain: HTMLElement}} dom
 */
export function renderAfterAttempt(
  dom,
  { challenge, explain, report, state, checks, hint = null, facts = {}, detailsId = 'checks' } = {},
) {
  renderOutcome(dom.outcome, state, challenge, report);
  renderHint(dom.hint, hint);
  renderCredibility(dom.credibility, challenge, report, { checks, detailsId });
  renderExplain(dom.explain, explain, { unlocked: Boolean(report), facts });
}

/**
 * The teacher's card: what the exercise is for, and what to ask about it afterwards.
 *
 * Six short fields, closed by default, and addressed to somebody else entirely — which is why
 * it is worth having. The misconception a class arrives with and the question to end on are the
 * two things a teaching page usually leaves the teacher to invent, and neither belongs in the
 * student's path.
 */
export function renderTeacher(container, teacher) {
  if (!container) return;
  container.replaceChildren();
  if (!teacher) return;

  const rows = [
    'objective',
    'prediction',
    'misconception',
    'discussion',
    'prerequisites',
    'duration',
  ]
    .filter((field) => teacher[field])
    .map((field) =>
      el('div', {}, el('dt', { text: t(`teacher.${field}`) }), el('dd', { text: teacher[field] })),
    );
  container.append(el('dl', { class: 'teacher' }, ...rows));
}
