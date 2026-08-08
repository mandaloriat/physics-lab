/**
 * The loop the exercises are played in: predict, try, improve, compare.
 *
 * Everything else on a bench page answers "what happened". This module holds the two pieces
 * that make the page an experiment rather than a calculator: a **prediction** asked before the
 * first solve, and a **path** across the top that says where in the loop the visitor is.
 *
 * Three rules the implementation exists to keep.
 *
 * **The prediction never gates anything.** It does not block the solve, it does not change a
 * single input, and "not sure yet" is a first-class answer rather than a way of dismissing the
 * question. A page whose Compute button waits for an opinion is a quiz, and a student who has
 * no opinion yet is exactly the one the exercise is for.
 *
 * **Nothing here is scored.** A prediction is compared with what happened and never marked. The
 * path lights up steps that have been taken and does not withhold anything from a step that has
 * not — skipping straight to the instrument is a supported way of using the page.
 *
 * **It is a radio group, not a row of buttons.** Arrow keys move between the options, the label
 * is the question, and the chosen answer is announced. Keeping the native semantics is what
 * makes the prediction usable from a keyboard without this file owning a roving tabindex.
 *
 * State goes to `localStorage`, wrapped, under a key the page names — a browser that refuses
 * storage degrades to a prediction that is asked again, never to a page that throws. The stored
 * shape is deliberately the one `runs.js` carries onto a saved attempt, so the answer travels
 * into the comparison with it.
 *
 * Functions over DOM nodes, in the same spirit as `components.js` and `guide.js`. No component
 * model and no build step — ADR-009.
 */

import { el } from '/shared/components.js';
import { t } from '/shared/i18n.js';

/** The four steps, in order. The page marks them; this module only draws them. */
export const STEPS = ['predict', 'attempt', 'improve', 'compare'];

const PREDICTION_KEY = (exercise) => `spoon-physics:prediction:${exercise}`;
const PATH_KEY = (exercise) => `spoon-physics:path:${exercise}`;

/* ------------------------------------------------------------------------ the prediction */

/**
 * Read the stored prediction for an exercise, or `null`.
 *
 * Never throws and never half-reads: a stored answer whose question no longer matches the one
 * in `content.json` is discarded rather than shown, because a prediction displayed beside a
 * different question is worse than no prediction at all.
 */
export function loadPrediction(exercise, question = null) {
  try {
    const raw = window.localStorage.getItem(PREDICTION_KEY(exercise));
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored || typeof stored.choice !== 'string') return null;
    if (question && stored.question !== question) return null;
    return stored;
  } catch {
    return null;
  }
}

function savePrediction(exercise, entry) {
  try {
    window.localStorage.setItem(PREDICTION_KEY(exercise), JSON.stringify(entry));
  } catch {
    // A blocked store loses the answer on reload. The page still works; nothing else is owed.
  }
}

/**
 * The prediction card: one question, a few observable answers, and a way to say "not yet".
 *
 * @param {HTMLElement} container
 * @param {object} options
 * @param {string} options.exercise storage namespace, the exercise id
 * @param {{question: string, options: Array<{id: string, label: string}>,
 *   allow_unknown?: boolean, follow_up?: object}} options.prediction from `content.json`
 * @param {() => boolean} [options.hasSolved] whether a solve has already happened, so the card
 *   can record that this answer came *after* the evidence rather than before it
 * @param {(entry: object) => void} [options.onAnswer]
 * @returns {{answer: () => object|null, refresh: () => void}}
 */
export function mountPrediction(container, { exercise, prediction, hasSolved, onAnswer }) {
  if (!container || !prediction?.question) return { answer: () => null, refresh: () => {} };

  let stored = loadPrediction(exercise, prediction.question);

  const choose = (option, which) => {
    const entry = {
      question: prediction.question,
      choice: option.id,
      label: option.label,
      // Whether the opinion was formed before the evidence is the only thing about a
      // prediction worth recording beyond the answer itself, and it cannot be recovered later.
      before_first_attempt: stored?.before_first_attempt ?? !hasSolved?.(),
      unknown: option.id === 'unknown',
      follow_up: which === 'follow_up' ? option.id : (stored?.follow_up ?? null),
      follow_up_label: which === 'follow_up' ? option.label : (stored?.follow_up_label ?? null),
    };
    if (which === 'follow_up') {
      entry.choice = stored?.choice ?? entry.choice;
      entry.label = stored?.label ?? entry.label;
      entry.unknown = stored?.unknown ?? false;
    }
    stored = entry;
    savePrediction(exercise, entry);
    onAnswer?.(entry);
    draw();
  };

  function questionBlock(spec, which, name) {
    const chosen = which === 'follow_up' ? stored?.follow_up : stored?.choice;
    const options = [...(spec.options ?? [])];
    if (spec.allow_unknown !== false && !options.some((option) => option.id === 'unknown')) {
      options.push({ id: 'unknown', label: t('prediction.unknown') });
    }

    return el(
      'fieldset',
      { class: 'prediction__set' },
      el('legend', { class: 'prediction__question', text: spec.question }),
      el(
        'div',
        { class: 'prediction__options' },
        ...options.map((option) => {
          const id = `prediction-${which}-${option.id}`;
          const input = el('input', {
            type: 'radio',
            name: `${name}`,
            id,
            value: option.id,
            checked: chosen === option.id,
            onchange: () => choose(option, which),
          });
          return el(
            'label',
            { class: `prediction__option${chosen === option.id ? ' is-chosen' : ''}`, for: id },
            input,
            el('span', { text: option.label }),
          );
        }),
      ),
    );
  }

  function draw() {
    container.replaceChildren();
    container.append(questionBlock(prediction, 'main', `prediction-${exercise}`));

    // The second question is a refinement of the first and is meaningless without it, so it
    // appears only once the first has an answer — §8.5's rule, kept here rather than in each page.
    if (prediction.follow_up?.question && stored?.choice) {
      container.append(
        questionBlock(prediction.follow_up, 'follow_up', `prediction-${exercise}-follow-up`),
      );
    }

    container.append(el('p', { class: 'prediction__note', text: t('prediction.note') }));
  }

  draw();
  return { answer: () => stored, refresh: draw };
}

/**
 * The prediction as it reads back beside a result: the question, and what was answered.
 *
 * Never a verdict. The comparison between what was expected and what happened is the thing the
 * exercise is for, and a page that stamped it right or wrong would be teaching the student to
 * guess well rather than to revise.
 */
export function renderPredictionRecall(container, entry) {
  if (!container) return;
  container.replaceChildren();
  if (!entry?.choice) return;
  container.append(
    el(
      'p',
      { class: 'prediction__recall' },
      el('span', { class: 'prediction__recall-label', text: t('prediction.youSaid') }),
      el('strong', { text: entry.unknown ? t('prediction.unknown') : entry.label }),
    ),
  );
}

/* ------------------------------------------------------------------------------ the path */

function loadPath(exercise) {
  try {
    const raw = window.localStorage.getItem(PATH_KEY(exercise));
    const stored = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(stored) ? stored.filter((step) => STEPS.includes(step)) : []);
  } catch {
    return new Set();
  }
}

/**
 * The path across the top of a bench page: four steps, lit as they are taken.
 *
 * Not a wizard. Every step stays reachable at all times, nothing is disabled, and a visitor who
 * goes straight to the instrument and computes something has simply skipped a step — which the
 * bar records by lighting the second and leaving the first alone.
 *
 * @param {HTMLElement} container
 * @param {{exercise: string}} options
 * @returns {{mark: (step: string) => void, taken: () => Set<string>}}
 */
export function mountPath(container, { exercise }) {
  if (!container) return { mark: () => {}, taken: () => new Set() };
  const taken = loadPath(exercise);

  function draw() {
    container.replaceChildren(
      el(
        'ol',
        { class: 'path__steps' },
        ...STEPS.map((step, index) =>
          el(
            'li',
            { class: `path__step${taken.has(step) ? ' is-taken' : ''}` },
            el('span', { class: 'path__index', text: `${index + 1}`, 'aria-hidden': 'true' }),
            el('span', { class: 'path__label', text: t(`path.${step}`) }),
            // The state is said, not only coloured — the rule §13.9 sets for every indicator
            // on these pages, and the one a colour-only progress bar always breaks.
            taken.has(step)
              ? el('span', { class: 'visually-hidden', text: ` — ${t('path.done')}` })
              : null,
          ),
        ),
      ),
    );
  }

  draw();
  return {
    mark(step) {
      if (!STEPS.includes(step) || taken.has(step)) return;
      taken.add(step);
      try {
        window.localStorage.setItem(PATH_KEY(exercise), JSON.stringify([...taken]));
      } catch {
        // Unremembered progress is a cosmetic loss; the exercise is unaffected.
      }
      draw();
    },
    taken: () => new Set(taken),
  };
}

/**
 * Whether a later attempt changed something physical about the design, rather than the view.
 *
 * This is what separates "improve" from "try again": re-running the same configuration with a
 * finer grid is a numerical experiment and a worthwhile one, but it is not a second design, and
 * lighting the third step for it would tell the visitor they had done something they had not.
 *
 * Compares the two attempts' `physical` and `geometry` blocks, which `runs.js` already keeps
 * apart from the numerical settings for exactly this reason.
 */
export function changedTheDesign(previous, current) {
  if (!previous || !current) return false;
  for (const block of ['geometry', 'physical']) {
    const before = previous[block] ?? {};
    const after = current[block] ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return true;
    }
  }
  return false;
}
