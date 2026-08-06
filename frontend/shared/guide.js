/**
 * The guided path: the short lesson an exercise page opens with, and the way out of it.
 *
 * ADR-017 settled that an experiment page is a bench rather than a document, and it was right
 * about the failure it was fixing — a page that showed twelve controls, three empty result
 * panels and a paragraph under every slider, with the instrument occupying a ninth of the
 * first screen. What it did not settle is how somebody who has never heard of a wing section
 * gets *in*. The bench answers "what do I do now?" for a reader who already knows what the
 * page is about, and answers nothing at all for anybody else.
 *
 * So a page may open with a few chapters, and this module is all of them: a progress row, one
 * chapter at a time, a way back, and — in the same place on every chapter, because a way out
 * that moves is not a way out — a control that skips the whole thing and goes to the
 * instrument. See ADR-021.
 *
 * Three rules the implementation exists to keep.
 *
 * **The bench is never hidden.** The guide is a block *above* the instrument, not a modal over
 * it: no overlay, no focus trap, no scroll lock. A visitor who ignores it entirely can scroll
 * straight past, and one who skips it never sees it again.
 *
 * **Skipping is remembered, and refusing to remember is survivable.** The choice goes to
 * `localStorage` under the key the page names. Every access is wrapped, because a browser that
 * refuses storage must degrade to "show the chapters", which is the worst acceptable state,
 * and never to a page that throws.
 *
 * **A control that cannot act says why.** The preset buttons in the last chapter run a solve,
 * and while one is running they are disabled *with their reason in the tooltip* rather than
 * removed — the rule ADR-017 set for the workspace toolbar, which is not a workspace rule but
 * a lab rule.
 *
 * Functions over DOM nodes and one factory that closes over them, in the same spirit as
 * `workspace.js` and `components.js`. ADR-009's threshold — the first time the *same* state
 * has to live in two places — is not crossed here: the guide owns which chapter is open and
 * nothing else, the page owns the physics, and they meet at one callback (`onPreset`) and one
 * setter (`setPresetsAvailable`).
 */

import { el } from '/shared/components.js';
import { richText } from '/shared/experiment.js';
import { t } from '/shared/i18n.js';

/** What a visitor has decided about the lesson. Absent means "has not decided". */
const SEEN = ['skipped', 'done'];

/**
 * Read the stored decision, treating every failure as "no decision".
 *
 * A blocked store, a quota error, private browsing, a value written by an older release —
 * all of them mean the same thing here, and all of them must leave the page working.
 */
function recall(key) {
  try {
    const value = window.localStorage?.getItem(key);
    return SEEN.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // The visitor will meet the chapters again next time. That is a small cost, and much
    // smaller than a page that fails to render because storage said no.
  }
}

/**
 * Mount a guided path into a container the page already provides.
 *
 * @param {object} spec
 * @param {HTMLElement} spec.root the element to fill; it is emptied
 * @param {Array<{id: string, heading: string, body?: string[], figure?: string,
 *   presets?: Array<{alpha: number, note: string}>}>} spec.chapters the lesson, in order,
 *   as it arrives from `content.json` — prose is content, never markup
 * @param {string} spec.storageKey where the skip decision lives
 * @param {Record<string, (host: HTMLElement) => void>} [spec.figures] drawing functions by
 *   `figure` name. The page supplies these because only the page can draw its own physics
 *   from the same code the solver runs on
 * @param {(alpha: number) => void} [spec.onPreset] run this incidence
 * @param {() => void} [spec.onSkip] called when the visitor leaves for the instrument, so the
 *   page can scroll it into view — the guide does not know where the bench is
 * @param {string} [spec.presetUnit] what a preset value is measured in, for its label
 * @returns {{folded: boolean, setPresetsAvailable: (state: {ok: boolean, why?: string}) => void}}
 */
export function createGuide(spec) {
  const { root, chapters, storageKey, figures = {}, onPreset, onSkip } = spec;
  const total = chapters.length;

  let index = 0;
  let folded = recall(storageKey) !== null;
  /** The last thing said about whether a preset may run, so a redraw does not forget it. */
  let presetState = { ok: true };
  let presetButtons = [];

  /* ------------------------------------------------------------------------ the chapters */

  function figureFor(chapter) {
    const draw = chapter.figure ? figures[chapter.figure] : null;
    if (!draw) return null;
    // `aria-hidden`, because every one of these diagrams illustrates prose that is right
    // beside it. A screen reader that announced the SVG would read the same thing twice, and
    // an alternative text saying "a wing section with streamlines" tells a listener nothing
    // the paragraph has not already said better.
    const host = el('div', { class: 'guide__figure', 'aria-hidden': 'true' });
    draw(host);
    return host;
  }

  function presetsFor(chapter) {
    presetButtons = [];
    if (!chapter.presets?.length || !onPreset) return null;

    const buttons = chapter.presets.map((preset) => {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'guide__preset',
          'data-alpha': String(preset.alpha),
          onclick: () => onPreset(preset.alpha),
        },
        el('span', { class: 'guide__preset-value num', text: formatAngle(preset.alpha) }),
        el('span', { class: 'guide__preset-note', text: preset.note }),
      );
      presetButtons.push(button);
      return button;
    });

    return el('div', { class: 'guide__presets' }, ...buttons);
  }

  /** A signed angle the way a person writes one: a real minus sign, and a degree mark. */
  function formatAngle(value) {
    const sign = value < 0 ? '−' : '';
    return `${sign}${Math.abs(value)}°`;
  }

  function applyPresetState() {
    for (const button of presetButtons) {
      button.disabled = !presetState.ok;
      if (presetState.ok) button.removeAttribute('title');
      else button.title = presetState.why ?? '';
    }
  }

  /* --------------------------------------------------------------------------- rendering */

  function progressRow() {
    const dots = chapters.map((chapter, at) =>
      el(
        'li',
        {},
        el('button', {
          type: 'button',
          class: `guide__dot${at === index ? ' is-current' : ''}${at < index ? ' is-done' : ''}`,
          'aria-label': t('guide.goToChapter', { n: at + 1, title: chapter.heading }),
          'aria-current': at === index ? 'step' : null,
          onclick: () => show(at),
        }),
      ),
    );

    return el(
      'div',
      { class: 'guide__bar' },
      el('ol', { class: 'guide__progress' }, ...dots),
      el('p', { class: 'guide__count', text: t('guide.chapterOf', { n: index + 1, total }) }),
      // The way out, in the same place on every chapter. A skip control that moves between
      // chapters is one a visitor has to look for each time, which is not a way out.
      el('button', {
        type: 'button',
        class: 'guide__skip',
        text: t('guide.skip'),
        onclick: () => leave('skipped'),
      }),
    );
  }

  function chapterBlock() {
    const chapter = chapters[index];
    const last = index === total - 1;
    const headingId = `guide-chapter-${chapter.id}`;

    const body = el(
      'div',
      { class: 'guide__body' },
      ...(chapter.body ?? []).map((paragraph) => el('p', {}, richText(paragraph))),
    );

    const nav = el(
      'div',
      { class: 'guide__nav' },
      el('button', {
        type: 'button',
        class: 'guide__back',
        text: t('guide.back'),
        disabled: index === 0,
        // Disabled things say why here too, even when the why is this obvious.
        title: index === 0 ? t('guide.backWhy') : null,
        onclick: () => show(index - 1),
      }),
      el('button', {
        type: 'button',
        class: 'primary',
        text: last ? t('guide.finish') : t('guide.next'),
        onclick: () => (last ? leave('done') : show(index + 1)),
      }),
    );

    return el(
      'article',
      { class: 'guide__chapter' },
      el(
        'div',
        { class: 'guide__head' },
        el('p', { class: 'guide__number', 'aria-hidden': 'true', text: String(index + 1) }),
        // Focusable but not tabbable: moving focus here on every chapter change is what tells
        // a screen-reader user that the content under them has been replaced. Without it the
        // Next button stays focused and nothing is announced at all.
        el('h3', { id: headingId, class: 'guide__heading', tabindex: '-1', text: chapter.heading }),
      ),
      figureFor(chapter),
      body,
      presetsFor(chapter),
      nav,
    );
  }

  function foldedBlock() {
    return el(
      'p',
      { class: 'guide__folded' },
      el('button', {
        type: 'button',
        class: 'guide__reopen',
        text: t('guide.reopen'),
        onclick: () => {
          folded = false;
          index = 0;
          draw();
          focusHeading();
        },
      }),
    );
  }

  function draw() {
    root.classList.toggle('guide--folded', folded);
    root.replaceChildren(...(folded ? [foldedBlock()] : [progressRow(), chapterBlock()]));
    if (!folded) applyPresetState();
  }

  function focusHeading() {
    root.querySelector('.guide__heading')?.focus();
  }

  function show(at) {
    if (at < 0 || at >= total) return;
    index = at;
    draw();
    focusHeading();
  }

  /** Leave for the instrument, and record that this visitor has made that choice. */
  function leave(reason) {
    remember(storageKey, reason);
    folded = true;
    draw();
    onSkip?.();
  }

  draw();

  return {
    get folded() {
      return folded;
    },
    /**
     * Say whether a preset may run right now, and why not when it may not.
     *
     * Held rather than applied-and-forgotten, because the chapter is re-rendered on every
     * navigation and a state that lived only in the DOM would be lost each time.
     */
    setPresetsAvailable(state) {
      presetState = state ?? { ok: true };
      applyPresetState();
    },
  };
}
