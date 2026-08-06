/**
 * The workspace: the field, the tools that interrogate it, and the annotations over it.
 *
 * This is the part of the redesign that changes what a page *is*. Before it, an experiment
 * page was a document with a picture in it: the picture had a fixed size, no tools, and no way
 * to ask it anything except by hovering. A laboratory instrument is the other way round — the
 * measurement is the centre of the bench and everything else is arranged around it.
 *
 * **What belongs to Fenix Spoon and what belongs here.** `<fs-viewer>` draws the field,
 * probes it, samples vector glyphs and exports its canvas; those are used, never
 * reimplemented. What the pin has no API for is a *view transform* (pan and zoom), a
 * *locked colour range*, *streamlines*, and *annotations in domain coordinates*. Three of
 * those four are supplied here in a way that cannot drift from the widget:
 *
 * - **pan and zoom** are laid out around the element rather than inside it. The viewer is
 *   given a larger box and a clipping parent scrolls it. The widget re-renders at whatever
 *   size it is handed, so zooming in re-rasterises rather than magnifying pixels, `probe()`
 *   keeps working because the widget computes from its own bounding rect, and the day the
 *   viewer gains a real view transform this layer is deleted rather than migrated.
 * - **the colorbar is drawn here**, from the viewer's own `range` and upstream's own
 *   `sampleColormap` / `colorbarTicks`. That is not duplication for its own sake: turning the
 *   widget's colorbar off (`colorbar="off"`) is what makes the plot area *exactly* the
 *   element's box, and therefore what lets an overlay align with the field without
 *   reproducing the widget's internal layout constants — the hazard
 *   [ADR-012](../../docs/architecture-decisions.md#adr-012) names. It also fixes a real
 *   misalignment: with the bar on, the widget stretches the domain into `width - 38px` while
 *   `<fs-geometry-2d>` uses the full width, so the draggable outline sat several per cent to
 *   the right of the hole it was supposed to be.
 * - **streamlines** are integrated from the vector field the solver publishes, and are
 *   offered *only* when it does. A curve that is not an integral of the velocity is not a
 *   streamline and this module will not draw one.
 *
 * **Locking the colour range is not possible on this pin** and is therefore offered as a
 * disabled tool that says so. `<fs-viewer>` computes its range privately from the data and
 * exposes only a getter; a legend claiming a range the canvas does not use would be a lie
 * about the picture. {@link viewerCapabilities} feature-detects a settable range so that the
 * control turns itself on when a future pin provides one.
 *
 * Still functions over DOM nodes: no component model, no reactive store, no build step. See
 * ADR-009 and ADR-017.
 */

import {
  colorbarTicks,
  normalise,
  resultMask,
  resultVectorValues,
  sampleColormap,
} from '@fenix-spoon/viewer';

import { el } from '/shared/components.js';
import { t } from '/shared/i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Zoom stops. Multiplicative, so each press is the same visual step. */
const ZOOM_STEP = 1.5;
const ZOOM_MIN = 1;
const ZOOM_MAX = 12;

/* ------------------------------------------------------------------ upstream capabilities */

/**
 * What the *pinned* viewer can do, asked of the widget rather than assumed from its version.
 *
 * Every answer here decides whether a tool is offered, and each is a property test rather
 * than a version check: the lab has no way to know which pin it is running against at
 * runtime, and `scripts/check-pins.sh` guarantees agreement between files, not between this
 * page and the bytes the browser loaded. A tool gated on a property appears the moment the
 * property does.
 */
export function viewerCapabilities(viewer) {
  const prototype = viewer ? Object.getPrototypeOf(viewer) : null;
  const range = prototype ? Object.getOwnPropertyDescriptor(prototype, 'range') : null;
  return {
    probe: typeof viewer?.probe === 'function',
    vectors: prototype ? 'vectors' in prototype : false,
    exportImage: typeof viewer?.toDataURL === 'function',
    /**
     * A settable scalar range. False on 988ad64, where `range` was a getter and nothing else;
     * true from 4e7c296, which added the setter and `autoRange` beside it. The probe is what
     * made that bump a feature rather than a lie — the tool was disabled with a reason, and it
     * enabled itself when the property arrived.
     */
    lockRange: Boolean(range?.set),
    /** Sampling along a section. */
    section: typeof viewer?.sample === 'function',
  };
}

/* ------------------------------------------------------------------------ the workspace */

/**
 * Wire a workspace into a page that already carries its markup.
 *
 * @param {object} spec
 * @param {HTMLElement} spec.root the `.workspace` element
 * @param {HTMLElement} spec.viewer the `<fs-viewer>`
 * @param {HTMLElement|null} spec.editor the `<fs-geometry-2d>`, where the page has one
 * @param {Array<object>} spec.overlays overlay layer descriptors (see {@link setOverlays})
 * @param {(context: object) => void} spec.onDraw called to paint the annotation layer
 * @param {string} spec.fitLabel wording for the "frame the body" action, e.g. `Fit profile`
 * @param {string} [spec.editLabel] wording for the edit mode, e.g. `Build`; the editor is
 *   whatever the page hands over, so only the page can name what editing it means
 * @param {string} [spec.editTitle] the tooltip that goes with it
 * @param {() => ([number, number, number, number]|null)} [spec.subject] the bounding box the
 *   fit action frames, in domain coordinates — the profile, the magnet, whatever the page is
 *   actually about
 * @param {boolean} [spec.streamlines] start with streamlines on, for a page whose subject
 *   *is* the flow. Per page rather than global on purpose: a solver that publishes no vector
 *   field cannot draw one, so a global default of `true` would be a claim about every page
 *   that only one of them can keep. Asking for them here is a wish, not a promise — the tool
 *   still refuses, with its reason, until a result arrives that can support it.
 */
export function createWorkspace(spec) {
  const { root, viewer, editor = null } = spec;
  const stage = root.querySelector('.workspace__stage');
  const zoomBox = root.querySelector('.workspace__zoom');
  const overlay = root.querySelector('.workspace__overlay');
  const toolbar = root.querySelector('.workspace__toolbar');
  const scale = root.querySelector('.workspace__scale');
  const readout = root.querySelector('.workspace__readout');

  const capabilities = viewerCapabilities(viewer);
  const state = {
    mode: 'pan',
    zoom: 1,
    density: 24,
    vectors: false,
    /**
     * Whether the visitor wants streamlines — which is a different question from whether any
     * can be drawn, and keeping the two apart is the whole trick. ADR-017 records the bug
     * that came of conflating them: a layer asked for while unavailable stayed off after
     * becoming available, because "turned off" and "impossible" were one flag. Here the wish
     * lives in this field and the possibility lives in the tool's `available()`, so a page
     * that opens asking for streamlines gets them the moment a result can support them, and a
     * visitor who switches them off keeps them off across every solve after.
     */
    streamlines: spec.streamlines === true,
    /** Overlay layers the page declared, by id, and whether each is on. */
    layers: new Map(),
    pinned: null,
    /**
     * The colour range held fixed across results, or null while it follows the data.
     *
     * Deliberately outlives `setResult`: two solves are only comparable by eye if the second
     * one is drawn on the first one's scale, so a lock the next result silently released would
     * be a lock that does the one thing it exists to prevent.
     */
    locked: null,
  };

  // The viewer draws no colorbar of its own: this workspace draws one, and the plot area
  // being exactly the element's box is what the annotation layer's alignment rests on.
  viewer.setAttribute('colorbar', 'off');

  /* ------------------------------------------------------------------ projection */

  /** Domain bounds of whatever is currently on screen. */
  function bounds() {
    const data = viewer.result?.data;
    if (data?.bounds) return data.bounds;
    if (editor?.bounds) return editor.bounds;
    return [0, 0, 1, 1];
  }

  /**
   * Domain coordinates to overlay pixels.
   *
   * The overlay's viewBox is the stage in CSS pixels, not the domain, so a stroke width is a
   * stroke width and a label is not stretched by the domain's aspect ratio. What makes this
   * exact rather than approximate is that the viewer's own projection, with the colorbar off,
   * is the same linear map onto the same box — `element.js` computes
   * `((x - xmin) / (xmax - xmin)) * width` and flips y, and so does this.
   */
  function project([x, y]) {
    const [xmin, ymin, xmax, ymax] = bounds();
    const { width, height } = zoomBox.getBoundingClientRect();
    return [
      ((x - xmin) / (xmax - xmin || 1)) * width,
      height - ((y - ymin) / (ymax - ymin || 1)) * height,
    ];
  }

  /** Overlay pixels back to domain coordinates — what a click has to be read as. */
  function unproject([px, py]) {
    const [xmin, ymin, xmax, ymax] = bounds();
    const { width, height } = zoomBox.getBoundingClientRect();
    return [
      xmin + (px / (width || 1)) * (xmax - xmin),
      ymin + (1 - py / (height || 1)) * (ymax - ymin),
    ];
  }

  /* ---------------------------------------------------------------------- the tools */

  /**
   * Every tool, with the condition under which it is usable and the sentence shown when it
   * is not.
   *
   * A tool that cannot work is **disabled and explained**, never silently missing: "Vectors
   * — this result carries no vector field" tells a visitor something true about the solve,
   * where an absent button tells them the page is broken. The one exception is a tool whose
   * page has no subject for it at all (no geometry editor), which is hidden.
   */
  const TOOLS = [
    {
      id: 'pan',
      group: 'mode',
      label: t('workspace.pan.label'),
      title: t('workspace.pan.title'),
      icon: '✥',
      available: () => true,
    },
    {
      id: 'probe',
      group: 'mode',
      label: t('workspace.probe.label'),
      title: t('workspace.probe.title'),
      icon: '⌖',
      available: () =>
        capabilities.probe && viewer.result
          ? { ok: true }
          : { ok: false, why: t('workspace.probe.why') },
    },
    {
      id: 'edit',
      group: 'mode',
      // Wording, because "the profile's control points" is a statement about *an* experiment
      // and this file holds none. The airfoil drags a spline and the bridge lays out a
      // lattice; both are the mode in which the editor owns the pointer, and the button has
      // to say which one it is. Same rule as `fitLabel` above it — and the page hands over a
      // translated string, because only the page knows which exercise it is.
      label: spec.editLabel ?? t('workspace.edit.label'),
      title: spec.editTitle ?? t('workspace.edit.title'),
      icon: '✎',
      hidden: () => !editor,
      available: () => true,
    },
    {
      id: 'zoom-out',
      group: 'view',
      label: t('workspace.zoomOut.label'),
      icon: '−',
      action: () => setZoom(state.zoom / ZOOM_STEP),
      available: () =>
        state.zoom > ZOOM_MIN ? { ok: true } : { ok: false, why: t('workspace.zoomOut.why') },
    },
    {
      id: 'zoom-in',
      group: 'view',
      label: t('workspace.zoomIn.label'),
      icon: '+',
      action: () => setZoom(state.zoom * ZOOM_STEP),
      available: () =>
        state.zoom < ZOOM_MAX ? { ok: true } : { ok: false, why: t('workspace.zoomIn.why') },
    },
    {
      id: 'fit',
      group: 'view',
      label: spec.fitLabel ?? t('workspace.fit.label'),
      icon: '⤢',
      action: fitSubject,
      available: () =>
        spec.subject?.() ? { ok: true } : { ok: false, why: t('workspace.fit.why') },
    },
    {
      id: 'reset',
      group: 'view',
      label: t('workspace.reset.label'),
      icon: '⟲',
      action: resetView,
      available: () => true,
    },
    {
      id: 'vectors',
      group: 'field',
      label: t('workspace.vectors.label'),
      title: t('workspace.vectors.title'),
      icon: '➜',
      toggle: true,
      on: () => state.vectors,
      action: () => {
        state.vectors = !state.vectors;
        applyVectors();
      },
      available: () => {
        if (!capabilities.vectors) {
          return { ok: false, why: t('workspace.vectors.whyBuild') };
        }
        if (!viewer.result) return { ok: false, why: t('workspace.noRun') };
        return (viewer.vectorFields ?? []).length
          ? { ok: true }
          : { ok: false, why: t('workspace.vectors.whyField') };
      },
    },
    {
      id: 'streamlines',
      group: 'field',
      label: t('workspace.streamlines.label'),
      title: t('workspace.streamlines.title'),
      icon: '≈',
      toggle: true,
      on: () => state.streamlines,
      action: () => {
        state.streamlines = !state.streamlines;
        draw();
      },
      available: () => {
        if (!viewer.result) return { ok: false, why: t('workspace.noRun') };
        if (!(viewer.vectorFields ?? []).length) {
          // Said precisely, because "unavailable" invites the guess that the page is
          // incomplete. What is missing is the *data*: a streamline is an integral curve of
          // the velocity, and a solver that publishes only scalars has not published one.
          return { ok: false, why: t('workspace.streamlines.whyField') };
        }
        return viewer.result.kind === 'grid2d'
          ? { ok: true }
          : { ok: false, why: t('workspace.streamlines.whyMesh') };
      },
    },
    {
      id: 'lock-scale',
      group: 'field',
      label: t('workspace.lockScale.label'),
      title: t('workspace.lockScale.title'),
      icon: '🔒',
      toggle: true,
      on: () => state.locked !== null,
      /**
       * Pin the colour range to what this result happens to span, or let it float again.
       *
       * Pinned from `autoRange` rather than from a range the page invents: the point is to
       * compare the *next* solve against this one, so the scale that has to survive is the one
       * currently on screen. The viewer's own `range` is what the canvas colours by, so the
       * strip this workspace draws and the picture cannot disagree — `drawScale` reads the
       * same property.
       */
      action: () => {
        state.locked = state.locked ? null : (viewer.autoRange ?? null);
        viewer.range = state.locked;
        draw();
      },
      available: () =>
        capabilities.lockRange
          ? { ok: true }
          : // Upstream gap on an older pin, named rather than worked around. Faking it by
            // rescaling the legend alone would put a range on the bar the canvas does not use.
            { ok: false, why: t('workspace.lockScale.why') },
    },
    {
      id: 'export',
      group: 'field',
      label: t('workspace.export.label'),
      title: t('workspace.export.title'),
      icon: '⤓',
      action: exportImage,
      available: () =>
        capabilities.exportImage && viewer.result
          ? { ok: true }
          : { ok: false, why: t('workspace.export.why') },
    },
  ];

  /* ------------------------------------------------------------------ tool rendering */

  function renderToolbar() {
    const groups = new Map();
    for (const tool of TOOLS) {
      if (tool.hidden?.()) continue;
      if (!groups.has(tool.group)) groups.set(tool.group, []);
      groups.get(tool.group).push(tool);
    }

    const nodes = [];
    for (const [name, tools] of groups) {
      nodes.push(
        el(
          'div',
          { class: 'toolgroup', role: name === 'mode' ? 'radiogroup' : 'group' },
          ...tools.map(renderTool),
        ),
      );
    }
    // The layer switches are a group of their own: they say what is *drawn over* the field,
    // which is a different question from what the pointer does.
    if (state.layers.size) {
      nodes.push(
        el(
          'div',
          { class: 'toolgroup toolgroup--layers' },
          ...[...state.layers.values()].map(renderLayerToggle),
        ),
      );
    }
    nodes.push(renderDensity());
    toolbar.replaceChildren(...nodes);
  }

  function renderTool(tool) {
    const verdict = normaliseVerdict(tool.available());
    const active = tool.group === 'mode' ? state.mode === tool.id : Boolean(tool.on?.());
    const button = el('button', {
      type: 'button',
      class: `tool${active ? ' is-active' : ''}`,
      'data-tool': tool.id,
      title: verdict.ok ? (tool.title ?? tool.label) : verdict.why,
      'aria-label': tool.label,
      role: tool.group === 'mode' ? 'radio' : null,
      'aria-checked': tool.group === 'mode' ? String(active) : null,
      'aria-pressed': tool.toggle ? String(active) : null,
    });
    button.disabled = !verdict.ok;
    button.append(
      el('span', { class: 'tool__icon', text: tool.icon, 'aria-hidden': 'true' }),
      el('span', { class: 'tool__label', text: tool.label }),
    );
    button.addEventListener('click', () => {
      if (tool.group === 'mode') setMode(tool.id);
      else tool.action?.();
      renderToolbar();
    });
    return button;
  }

  function renderLayerToggle(layer) {
    const button = el('button', {
      type: 'button',
      class: `tool tool--layer${layer.on ? ' is-active' : ''}`,
      'data-layer': layer.id,
      'aria-pressed': String(layer.on),
      title: layer.title ?? layer.label,
    });
    button.disabled = !layer.enabled;
    if (!layer.enabled && layer.why) button.title = layer.why;
    button.append(
      el('span', { class: 'tool__swatch', style: `--swatch: ${layer.colour ?? 'currentColor'}` }),
      el('span', { class: 'tool__label', text: layer.label }),
    );
    button.addEventListener('click', () => {
      layer.on = !layer.on;
      draw();
      renderToolbar();
    });
    return button;
  }

  function renderDensity() {
    const input = el('input', {
      type: 'range',
      id: 'workspace-density',
      min: 8,
      max: 48,
      step: 4,
      value: state.density,
      class: 'tool__density',
    });
    input.addEventListener('input', () => {
      // Density is a property of the picture, not of the solve, so this never resubmits: the
      // glyph lattice and the streamline seeding are both computed from the result already in
      // the browser.
      state.density = Number(input.value);
      applyVectors();
      draw();
    });
    return el(
      'label',
      { class: 'toolgroup toolgroup--density', for: 'workspace-density' },
      el('span', { class: 'tool__label', text: t('workspace.density') }),
      input,
    );
  }

  function normaliseVerdict(verdict) {
    if (verdict === true || verdict === undefined) return { ok: true };
    if (verdict === false) return { ok: false, why: t('workspace.unavailable') };
    return verdict;
  }

  /* ------------------------------------------------------------------------ modes */

  function setMode(mode) {
    state.mode = mode;
    // Edit shape is the *only* state in which the control points exist. Everywhere else the
    // editor is inert and invisible, so a drag is a pan and never an accidental reshaping —
    // which is the conflict this separation exists to remove.
    if (editor) {
      const editing = mode === 'edit';
      editor.hidden = !editing;
      editor.readOnly = !editing;
      editor.style.pointerEvents = editing ? 'auto' : 'none';
    }
    stage.dataset.mode = mode;
    spec.onModeChange?.(mode);
    renderToolbar();
  }

  /* ------------------------------------------------------------------------ zooming */

  function setZoom(next) {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    // Keep the centre of the viewport where it was, which is what makes repeated zooming feel
    // like a magnifier rather than a jump back to the top-left corner.
    const factor = clamped / state.zoom;
    const centreX = stage.scrollLeft + stage.clientWidth / 2;
    const centreY = stage.scrollTop + stage.clientHeight / 2;
    state.zoom = clamped;
    applyZoom();
    stage.scrollLeft = centreX * factor - stage.clientWidth / 2;
    stage.scrollTop = centreY * factor - stage.clientHeight / 2;
    renderToolbar();
  }

  function applyZoom() {
    zoomBox.style.width = `${state.zoom * 100}%`;
    zoomBox.style.height = `${state.zoom * 100}%`;
    stage.classList.toggle('is-zoomed', state.zoom > 1);
    // The widget re-reads its own box on render, so this is a genuine redraw at the new size
    // and not a magnified raster.
    viewer.render?.();
    draw();
  }

  function resetView() {
    state.zoom = 1;
    applyZoom();
    stage.scrollTo({ left: 0, top: 0 });
    renderToolbar();
  }

  /** Frame the page's subject — the profile, the magnet — with a little air around it. */
  function fitSubject() {
    const box = spec.subject?.();
    if (!box) return;
    const [xmin, ymin, xmax, ymax] = bounds();
    const width = (box[2] - box[0]) / (xmax - xmin || 1);
    const height = (box[3] - box[1]) / (ymax - ymin || 1);
    if (!(width > 0) || !(height > 0)) return;

    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, 0.8 / Math.max(width, height)));
    applyZoom();
    const centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const [px, py] = project(centre);
    stage.scrollTo({ left: px - stage.clientWidth / 2, top: py - stage.clientHeight / 2 });
    renderToolbar();
  }

  /* ------------------------------------------------------------------ pointer handling */

  let dragging = null;

  stage.addEventListener('pointerdown', (event) => {
    if (state.mode === 'edit') return; // the editor owns the pointer in that mode
    if (state.mode === 'probe') return; // handled on click, so a drag does not pin
    dragging = {
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
      id: event.pointerId,
    };
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    stage.scrollLeft = dragging.left - (event.clientX - dragging.x);
    stage.scrollTop = dragging.top - (event.clientY - dragging.y);
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    stage.addEventListener(type, (event) => {
      if (dragging?.id === event.pointerId) {
        stage.releasePointerCapture?.(event.pointerId);
        dragging = null;
        stage.classList.remove('is-dragging');
      }
    });
  }

  stage.addEventListener('click', (event) => {
    if (state.mode !== 'probe' || !viewer.result) return;
    const rect = zoomBox.getBoundingClientRect();
    const at = unproject([event.clientX - rect.left, event.clientY - rect.top]);
    const value = viewer.probe?.(at);
    state.pinned = value === undefined ? null : { at, value, field: viewer.field };
    showReadout();
    draw();
  });

  // Keyboard is a first-class route to every one of these, not an afterthought: the stage is
  // focusable, arrows pan, +/- zoom, and 0 resets.
  stage.tabIndex = 0;
  stage.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 120 : 40;
    const moves = {
      ArrowLeft: () => (stage.scrollLeft -= step),
      ArrowRight: () => (stage.scrollLeft += step),
      ArrowUp: () => (stage.scrollTop -= step),
      ArrowDown: () => (stage.scrollTop += step),
      '+': () => setZoom(state.zoom * ZOOM_STEP),
      '=': () => setZoom(state.zoom * ZOOM_STEP),
      '-': () => setZoom(state.zoom / ZOOM_STEP),
      0: resetView,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  });

  function showReadout() {
    readout.replaceChildren();
    if (!state.pinned) {
      readout.hidden = true;
      return;
    }
    const { at, value, field } = state.pinned;
    readout.hidden = false;
    readout.append(
      el('span', { class: 'readout__field', text: field ?? '' }),
      el('span', { class: 'num', text: formatValue(value) }),
      el('span', {
        class: 'readout__at',
        text: t('workspace.at', { x: at[0].toPrecision(3), y: at[1].toPrecision(3) }),
      }),
    );
    const clear = el('button', { type: 'button', class: 'link', text: t('workspace.clear') });
    clear.addEventListener('click', () => {
      state.pinned = null;
      showReadout();
      draw();
    });
    readout.append(clear);
  }

  /* ---------------------------------------------------------------------- the colorbar */

  /**
   * The colour scale, drawn here because the widget's own is off (see the module note).
   *
   * Built from upstream's `sampleColormap` and `colorbarTicks` against the widget's own
   * `range`, so the strip and the picture cannot disagree about what a colour means.
   */
  function drawScale() {
    scale.replaceChildren();
    const range = viewer.range;
    if (!range || !viewer.result) {
      scale.hidden = true;
      return;
    }
    scale.hidden = false;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 200');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'scale__bar');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      t('workspace.scaleAria', {
        field: viewer.field,
        min: range.min.toPrecision(3),
        max: range.max.toPrecision(3),
      }),
    );

    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    const id = `scale-${viewer.colormap}`;
    gradient.setAttribute('id', id);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '1');
    gradient.setAttribute('x2', '0');
    gradient.setAttribute('y2', '0');
    for (let i = 0; i <= 20; i += 1) {
      const [r, g, b] = sampleColormap(viewer.colormap, i / 20);
      const stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('offset', String(i / 20));
      stop.setAttribute('stop-color', `rgb(${r},${g},${b})`);
      gradient.append(stop);
    }
    defs.append(gradient);
    svg.append(defs);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '14');
    rect.setAttribute('height', '200');
    rect.setAttribute('fill', `url(#${id})`);
    svg.append(rect);
    scale.append(svg);

    scale.append(
      el(
        'ul',
        { class: 'scale__ticks' },
        ...colorbarTicks(range, 5).map((tick) =>
          el('li', {
            class: 'num',
            style: `--at: ${(100 * (1 - normalise(tick.value, range))).toFixed(2)}%`,
            text: tick.label,
          }),
        ),
      ),
    );
    // A pinned scale says so. Silence would leave a bar whose numbers do not move with the
    // field looking like a field that did not move.
    const units = viewer.getAttribute('units') ?? '';
    scale.append(
      el('span', {
        class: 'scale__caption',
        text: state.locked ? `${units} ${t('workspace.fixed')}`.trim() : units,
      }),
    );
  }

  /* ------------------------------------------------------------------ the overlay layer */

  /**
   * Declare the annotation layers this page can draw over the field.
   *
   * Each is a switch in the toolbar, and each says for itself whether it has the data it
   * needs. A layer whose data is missing is disabled with its reason, never quietly skipped —
   * "Centre of pressure" greyed out with *not defined when the normal force vanishes* is the
   * physics, and hiding it would lose that.
   *
   * @param {Array<{id: string, label: string, colour?: string, on?: boolean,
   *   enabled?: boolean, why?: string, title?: string}>} layers
   */
  function setOverlays(layers) {
    const previous = state.layers;
    const next = new Map();
    for (const layer of layers) {
      const was = previous.get(layer.id);
      const enabled = layer.enabled !== false;
      // A visitor's choice survives a re-declaration, so re-running or switching field does not
      // silently turn their overlays off. But a layer that was *disabled* had no choice to
      // make: when its data finally arrives it takes its declared default, which is why the
      // centre of pressure appears on the first run rather than staying off because it was
      // unavailable a moment earlier.
      const on = enabled ? (was?.enabled ? was.on : (layer.on ?? false)) : false;
      next.set(layer.id, { ...layer, enabled, on });
    }
    state.layers = next;
    renderToolbar();
    draw();
  }

  /** Whether a declared layer is currently switched on. */
  function layerOn(id) {
    const layer = state.layers.get(id);
    return Boolean(layer?.on && layer.enabled !== false);
  }

  /** Repaint the annotation layer. Cheap, and called on every resize, zoom and result. */
  function draw() {
    const { width, height } = zoomBox.getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
    overlay.replaceChildren();

    if (state.streamlines && viewer.result) drawStreamlines();
    spec.onDraw?.({ svg: overlay, project, unproject, bounds: bounds(), layerOn, width, height });
    if (state.pinned) drawPin(state.pinned);
    drawScale();
  }

  function drawPin({ at }) {
    const [px, py] = project(at);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'overlay__pin');
    for (const [x1, y1, x2, y2] of [
      [px - 9, py, px + 9, py],
      [px, py - 9, px, py + 9],
    ]) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      group.append(line);
    }
    overlay.append(group);
  }

  /* --------------------------------------------------------------------- streamlines */

  /**
   * Integral curves of the published velocity field.
   *
   * Second-order Runge–Kutta on the bilinearly interpolated grid, forwards and backwards from
   * each seed, stopping at the domain edge, inside the masked body, or where the speed falls
   * to nothing. The step is a fraction of a cell, so refining the solver's sampling grid
   * refines these too rather than changing what they mean.
   *
   * The seeds are a column at the inflow edge plus a column just ahead of the body: seeding
   * only at the edge leaves the interesting region — where the flow divides around the nose —
   * with whichever lines happen to arrive there.
   */
  function drawStreamlines() {
    const result = viewer.result;
    const name = (viewer.vectorFields ?? [])[0];
    if (!name || result.kind !== 'grid2d') return;
    const vectors = resultVectorValues(result, name);
    if (!vectors) return;

    const [ny, nx] = result.data.shape;
    const [xmin, ymin, xmax, ymax] = result.data.bounds;
    const mask = resultMask(result);
    const dx = (xmax - xmin) / (nx - 1);
    const dy = (ymax - ymin) / (ny - 1);

    const sample = ([x, y]) => {
      const fx = (x - xmin) / dx;
      const fy = (y - ymin) / dy;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= nx - 1 || iy >= ny - 1) return null;
      const tx = fx - ix;
      const ty = fy - iy;
      let vx = 0;
      let vy = 0;
      for (const [ox, oy, weight] of [
        [0, 0, (1 - tx) * (1 - ty)],
        [1, 0, tx * (1 - ty)],
        [0, 1, (1 - tx) * ty],
        [1, 1, tx * ty],
      ]) {
        const index = (iy + oy) * nx + (ix + ox);
        if (mask?.[index]) return null; // a corner inside the body: stop rather than average
        vx += weight * vectors[index][0];
        vy += weight * vectors[index][1];
      }
      return Math.hypot(vx, vy) > 1e-9 ? [vx, vy] : null;
    };

    const step = 0.6 * Math.min(dx, dy);
    const trace = (seed, sign) => {
      const points = [seed];
      let point = seed;
      for (let i = 0; i < 1200; i += 1) {
        const v = sample(point);
        if (!v) break;
        const speed = Math.hypot(v[0], v[1]);
        const half = [
          point[0] + (sign * step * v[0]) / speed / 2,
          point[1] + (sign * step * v[1]) / speed / 2,
        ];
        const w = sample(half);
        if (!w) break;
        const mid = Math.hypot(w[0], w[1]);
        point = [point[0] + (sign * step * w[0]) / mid, point[1] + (sign * step * w[1]) / mid];
        if (point[0] < xmin || point[0] > xmax || point[1] < ymin || point[1] > ymax) break;
        points.push(point);
      }
      return points;
    };

    const count = Math.max(6, Math.round(state.density * 0.9));
    const seeds = [];
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      seeds.push([xmin + 0.02 * (xmax - xmin), ymin + t * (ymax - ymin)]);
      seeds.push([xmin + 0.28 * (xmax - xmin), ymin + t * (ymax - ymin)]);
    }

    const shapes = [];
    for (const seed of seeds) {
      if (!sample(seed)) continue;
      const line = [...trace(seed, -1).reverse(), ...trace(seed, +1).slice(1)];
      if (line.length < 8) continue;
      shapes.push(
        line
          .map((point, index) => {
            const [px, py] = project(point);
            return `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
          })
          .join(' '),
      );
    }

    // Drawn twice: a dark halo under a coloured core.
    //
    // Not decoration. `<fs-viewer>` draws iso-contours of the *displayed scalar* as thin white
    // lines, and iso-lines of C_p are perfectly meaningful curves that are emphatically **not**
    // streamlines. Two families of white curves over one field is an invitation to read one as
    // the other — the same trap the magnetics page avoids by giving contours only to A_z, whose
    // level sets really are the field lines. So a streamline is a distinct colour, and it is the
    // colour of the free-stream arrow, because both are statements about the velocity field.
    for (const [index, className] of [
      'overlay__streamlines--halo',
      'overlay__streamlines',
    ].entries()) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', `overlay__streamlines ${className}`);
      group.dataset.layer = String(index);
      for (const d of shapes) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        group.append(path);
      }
      overlay.append(group);
    }
  }

  /* -------------------------------------------------------------------- image export */

  /**
   * The current view as a PNG: the field, the annotations, and the scale.
   *
   * The field comes from the widget's own `toDataURL`; the annotations are the overlay
   * serialised and rasterised. Composing rather than exporting the canvas alone matters
   * because the annotations are half of what the picture says — a *C<sub>p</sub>* field with
   * no centre of pressure marked is a different claim.
   *
   * Falls back to the field alone if the overlay cannot be rasterised, rather than failing:
   * an export that loses the markers is better than a button that does nothing.
   */
  async function exportImage() {
    const field = viewer.toDataURL?.();
    if (!field) return;

    const rect = zoomBox.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.drawImage(await loadImage(field), 0, 0, width, height);
      const markers = await overlayImage(width, height);
      if (markers) ctx.drawImage(markers, 0, 0);
      download(canvas.toDataURL('image/png'));
    } catch {
      download(field);
    }
  }

  /**
   * Everything the annotation layer is styled with, to be inlined before export.
   *
   * A serialised SVG carries no stylesheet, so whatever is not copied onto the element falls
   * back to the SVG defaults — and those defaults are not neutral. `fill` defaults to *black*,
   * so an unstyled `<path>` that the page draws as a hairline outline exports as a filled
   * silhouette; unstyled text loses the halo that makes a label readable over a dark field, and
   * takes on the serif default at whatever size the renderer picks. Both make the exported PNG
   * a different picture from the one on screen, which is the one thing an export must not be.
   */
  const EXPORTED_STYLE = [
    'stroke',
    'fill',
    'stroke-width',
    'stroke-dasharray',
    'stroke-linejoin',
    'stroke-linecap',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'paint-order',
    'text-anchor',
  ];

  /** Serialise the overlay with its computed style inlined, so it rasterises standalone. */
  async function overlayImage(width, height) {
    if (!overlay.childNodes.length) return null;
    const clone = overlay.cloneNode(true);
    const originals = overlay.querySelectorAll('*');
    const copies = clone.querySelectorAll('*');
    for (const [index, node] of copies.entries()) {
      const computed = getComputedStyle(originals[index]);
      for (const property of EXPORTED_STYLE) {
        const value = computed.getPropertyValue(property);
        // `none` is copied like any other value, and deliberately: `fill: none` is what keeps
        // an outline an outline. Skipping it was leaving the SVG default of black behind.
        if (value) node.setAttribute(property, value);
      }
      node.removeAttribute('class');
    }
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const source = new XMLSerializer().serializeToString(clone);
    return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  function download(dataUrl) {
    const link = el('a', { href: dataUrl, download: `${spec.exportName ?? 'field'}.png` });
    document.body.append(link);
    link.click();
    link.remove();
  }

  /* --------------------------------------------------------------------- vector glyphs */

  function applyVectors() {
    const names = viewer.vectorFields ?? [];
    if (state.vectors && names.length) {
      viewer.setAttribute('vectors', names[0]);
      viewer.setAttribute('glyphs', String(state.density));
    } else {
      viewer.removeAttribute('vectors');
    }
  }

  /* ------------------------------------------------------------------------ lifecycle */

  /** Point the workspace at a new result. Everything conditional is re-decided here. */
  function setResult(result) {
    viewer.result = result;
    const [xmin, ymin, xmax, ymax] = bounds();
    // The stage takes the domain's aspect ratio, so the body is drawn in proportion rather
    // than stretched into whatever box the layout happened to give it. Published as a custom
    // property rather than assigned to `aspect-ratio` directly: an inline value would beat the
    // narrow-screen rule, and a 2.2:1 stage on a phone is a letterbox.
    const aspect = (xmax - xmin) / (ymax - ymin || 1);
    if (Number.isFinite(aspect) && aspect > 0) {
      stage.style.setProperty('--domain-aspect', String(aspect));
    }
    applyVectors();
    renderToolbar();
    draw();
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => draw()).observe(stage);
  }

  setMode('pan');
  applyZoom();
  renderToolbar();
  draw();

  return {
    setResult,
    setOverlays,
    setMode,
    draw,
    resetView,
    fit: fitSubject,
    capabilities,
    get mode() {
      return state.mode;
    },
    get zoom() {
      return state.zoom;
    },
  };
}

function formatValue(value) {
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude >= 1e4 || magnitude < 1e-3)
    ? value.toExponential(3)
    : value.toPrecision(4);
}

/* ----------------------------------------------------------------- overlay primitives */

/** `svgNode('circle', {cx, cy, r})` — the overlay's equivalent of `el`. */
export function svgNode(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  node.append(...children.filter(Boolean));
  return node;
}

/** A labelled marker at a domain point: a ring, a leader and a caption. */
export function marker([px, py], label, className) {
  return svgNode(
    'g',
    { class: `overlay__marker ${className}` },
    svgNode('circle', { cx: px, cy: py, r: 5 }),
    svgNode('circle', { cx: px, cy: py, r: 1.5, class: 'overlay__dot' }),
    label ? svgNode('text', { x: px + 9, y: py - 8 }, document.createTextNode(label)) : null,
  );
}

/** A polyline through already-projected pixel points. */
export function polyline(points, className) {
  return svgNode('path', {
    class: className,
    d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
  });
}
