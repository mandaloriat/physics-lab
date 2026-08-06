/**
 * Every word the lab says in English.
 *
 * This file is the wording's home: the pages carry `data-i18n` hooks and the modules call
 * `t('some.key')`, so a sentence is changed here once rather than in the markup, the script and
 * the test that reads it. `strings/it.js` mirrors it key for key — a key present here and
 * missing there falls back to this text and says so in the console (see `shared/i18n.js`).
 *
 * The keys are grouped the way the lab is: shared chrome first, then the shared renderers, then
 * one block per exercise. A value may carry `{placeholders}` and, where the key is read through
 * `data-i18n-html`, inline markup — nothing here is ever built from anything a visitor typed.
 *
 * **Not here, on purpose.** Two kinds of user-visible text come from the server and are shown
 * as it wrote them: the validity warnings inside `report.json`, and the title and description of
 * each capability from `GET /api/v1/solvers`. Translating those means teaching the solvers a
 * language, not the page — ADR-020 says why that was left for later, and where it would go.
 */

export default {
  // The two names are endonyms and live in `shared/i18n.js` beside the codes they belong to:
  // a language is called what its own speakers call it, in both directions.
  lang: {
    label: 'Language',
  },

  brand: {
    name: 'Spoon Physics',
    tagline: 'Interactive problems. Computed fields. Checkable answers.',
  },

  nav: {
    label: 'Lab sections',
    experiments: 'Experiments',
    how: 'How it works',
    code: 'Code',
  },

  footer: {
    builtWith: 'Built with ',
    and: ' and ',
    notAffiliated: '. Not affiliated with the FEniCS Project.',
    source: 'Source on GitHub',
    licence: ' · MIT',
  },

  stats: {
    seconds: 'duration',
    cells: 'cells',
    dofs: 'degrees of freedom',
    iterations: 'iterations',
    elements: 'elements',
    grid: 'grid',
  },

  /* ------------------------------------------------------------------ what a server can do */

  solver: {
    mock: {
      label: 'Fast preview',
      summary:
        'A Cartesian grid solved in NumPy. Answers in an instant — ideal while you reshape the geometry.',
      caveat: 'It is an approximation: a regular grid, with no mesh fitted to the body.',
    },
    fenicsx: {
      label: 'FEniCSx computation',
      summary:
        'An unstructured Gmsh mesh solved with finite elements. Slower, and more faithful near the boundary.',
      caveat: 'Requires a worker with dolfinx installed.',
    },
    panel: {
      label: 'Panel method',
      summary:
        'Source and vortex sheets on the body itself, closed by the Kutta condition. The boundary is exact rather than meshed, and the far field is satisfied analytically.',
      caveat: 'Milliseconds of arithmetic — not a preview of something better.',
    },
    missing: 'Not available on this server: {modes}.',
  },

  /* ---------------------------------------------------------------- the shared page shell */

  experiment: {
    pageTitle: '{title} — Spoon Physics',
    notSet: 'not set',
    submitting: 'Submitting…',
    solving: 'Solving…',
    cancelled: 'Cancelled.',
    done: 'Done.',
    iteration: 'iteration {index}',
    iterationOf: 'iteration {index} of {total}',
    residual: ' — residual {value}',
    download: 'Download: ',
    maintenanceStatus: 'Simulations are paused for maintenance.',
    unreachable: 'Cannot reach the server — {detail}',
    kept: '{count} of {capacity} kept, in this browser only.',
    evicted: '{count} oldest dropped to make room.',
    loaded: 'Loaded the inputs of the {label} run. Press Run to recompute it.',
  },

  /* ------------------------------------------------------------------ the shared renderers */

  exercise: {
    notRunYet: 'not run yet',
    notReported: 'this run does not report it',
    reading: 'this run: {value}',
    metButOutside: 'The numbers are right, but the model is outside its domain of validity. ',
    outside: 'This run is outside the model’s domain of validity. ',
    limitCrossedOne: 'The limit crossed is',
    limitCrossedMany: 'The limits crossed are',
    limitCrossedTail:
      ' listed under “How far to trust it”, and a run that crosses one cannot meet the target however good its numbers look.',
    didNotVerify: 'This run did not verify. ',
    verificationGap:
      'The two independent routes to the answer differ by {value} %, above the {limit} % this exercise asks for. Refine the discretisation and run again.',
    targetMet: 'Target met. ',
    tryAnother: 'Keep the run, then try to meet it another way — {next} — and compare the two.',
    tryAnotherPlain: 'Keep the run, then try to meet it another way and compare the two.',
    notApplicable: 'not applicable',
    needs: 'needs {key}',
    everySolve: 'Runs with every solve.',
    everyRun: 'Checked on every run.',
    notRun: 'not run',
    inside: 'Inside the stated domain of validity. ',
    insideTail:
      'Every limit this model declares was checked against this run and none was crossed.',
  },

  runs: {
    none: 'No runs kept yet. Solve something and press Keep run — a kept run records every input, so it can be recomputed and compared.',
    select: 'Select this run for comparison',
    load: 'Load',
    delete: 'Delete',
    yes: 'yes',
    no: 'no',
    selectTwo: 'Select two or more runs to compare them.',
    field: 'Field',
    run: 'Run {index}',
    differOne: '{differ} field differs; {same} are identical and hidden.',
    differMany: '{differ} fields differ; {same} are identical and hidden.',
    blocks: {
      exercise: 'Exercise',
      solver: 'Solver',
      model: 'Model',
      geometry: 'Geometry',
      physical: 'Conditions',
      numerics: 'Numerics',
      dimensionless: 'Dimensionless',
      metrics: 'Answer',
      sweep: 'Sweep',
      verification: 'Verification',
      validity: 'Validity',
      cost: 'Cost',
    },
  },

  curve: {
    empty: 'Nothing to plot yet.',
    aria: '{y} against {x}',
  },

  workspace: {
    density: 'Density',
    unavailable: 'Unavailable.',
    clear: 'clear',
    at: 'at ({x}, {y})',
    scaleAria: 'Colour scale for {field}, {min} to {max}',
    fixed: 'fixed',
    noRun: 'Run the solve first.',
    pan: { label: 'Pan', title: 'Drag to move the view' },
    probe: {
      label: 'Probe',
      title: 'Click to pin the value and coordinates at a point',
      why: 'Probing needs a computed field. Run the solve first.',
    },
    edit: { label: 'Edit shape', title: 'Show and drag the geometry’s control points' },
    zoomOut: { label: 'Zoom out', why: 'Already fitted.' },
    zoomIn: {
      label: 'Zoom in',
      why: 'At the limit: past this the picture is the sampling grid, magnified.',
    },
    fit: { label: 'Fit body', why: 'Nothing to frame until the geometry is known.' },
    reset: { label: 'Reset view' },
    vectors: {
      label: 'Vectors',
      title: 'Arrow glyphs of the velocity field',
      whyBuild: 'This build of the viewer draws no vector glyphs.',
      whyField: 'This result publishes no vector field, so there is nothing to draw.',
    },
    streamlines: {
      label: 'Streamlines',
      title: 'Curves integrated from the velocity field',
      whyField:
        'This result publishes no velocity field. A streamline is an integral of one, so there is nothing to integrate.',
      whyMesh:
        'Integration here samples the regular grid. Choose the grid result kind, or use vector glyphs on the mesh.',
    },
    lockScale: {
      label: 'Lock scale',
      title: 'Hold the colour range fixed while comparing runs',
      why: 'The viewer computes its colour range from the data and exposes no way to set one, so a locked scale would disagree with the picture.',
    },
    export: {
      label: 'Export image',
      title: 'Download the current view as a PNG',
      why: 'Available once a field has been drawn.',
    },
  },

  /* ------------------------------------------------------------------------- the home page */

  home: {
    title: 'Spoon Physics',
    description:
      'Play with the physics, then find out why it works. An interactive laboratory: a short lesson you can skip, a real solver that computes the field, the engineering numbers that answer the question, and a statement on every run of how far to trust them.',
    heroHeading: 'Play with the physics.<br>Then find out why it works.',
    lede: 'Every experiment opens with a question you can follow knowing nothing at all, explains just enough to make the controls mean something, and hands you a real solver: it computes the field, gives you the engineering numbers, and says on every run how far those numbers can be trusted.',
    experiments: 'Experiments',
    badgeExercise: 'Exercise',
    badgePlanned: 'In preparation',
    /* Folded on every card. The quantities are the honesty of the page and none of them is
       deleted — they are one click behind the invitation instead of in front of it. */
    numbersSummary: 'The numbers behind it',
    target: 'Target',
    wouldTarget: 'Would target',
    constraint: 'Constraint',
    youSet: 'You set',
    checkedBy: 'Checked by',
    status: 'Status',
    airfoil: {
      name: 'Airfoil design',
      /* The heading of the card, because it is the thing a visitor can want the answer to
         without already knowing the subject. The subject goes underneath, in `topic`. */
      question: 'Why does a wing stay up?',
      topic: 'Aerodynamics — the wing section',
      level: 'no physics needed · ~5 min',
      problem:
        'Tilt a wing section into the wind and watch the air do the work. Then go after the real thing: <strong>800 N of lift per metre of span</strong>, without a pitching moment a tail could not trim out.',
      target: 'L′ = 800 N/m ± 2 %',
      constraint: '|C_m,c/4| < 0.08',
      checked: 'lift computed two independent ways',
      cta: 'Design an airfoil →',
    },
    solenoid: {
      name: 'The magnetic circuit',
      question: 'Why does iron guide a magnetic field?',
      topic: 'Magnetostatics — the iron circuit',
      level: 'some physics helps · ~8 min',
      problem:
        'Carry a required flux through an iron core on a fixed ampere-turn budget, without letting it leak away into the air.',
      target: '4.5 mWb/m at ≤ 3600 A',
      youSet: 'core, gap, winding, length, μᵣ, current density',
      checked: 'an energy balance, Ampère’s law and a mesh study',
      cta: 'Design a magnetic circuit →',
    },
    truss: {
      name: 'The bridge',
      question: 'Which bar gives way first?',
      topic: 'Statics — the pin-jointed lattice',
      level: 'you draw this one · ~10 min',
      problem:
        'Build a lattice across a 24 m gorge and carry the traffic on a steel budget — the bar that gives way first is almost never the one you expect.',
      target: 'η < 1 on ≤ 2400 kg',
      youSet: 'every joint, every bar, the supports, the loads, the section',
      checked: 'the method of joints, a moment balance and an energy check',
      cta: 'Build a bridge →',
    },
    heatsink: {
      name: 'Heat sink',
      question: 'When do more fins stop helping?',
      topic: 'Heat transfer — the finned body',
      level: 'some physics helps · ~10 min',
      problem:
        'Dissipate a given power below a maximum temperature, using less metal. How many fins actually help, and when do they stop?',
      target: 'T_max < 95 °C on ≤ 170 g',
      youSet: 'fin count, height and thickness, the base, the finish, the cooling',
      checked:
        'an energy balance over both heat paths, and view-factor identities that hold exactly',
      cta: 'Cool a device →',
    },
    disclaimerLabel: 'Note.',
    disclaimer:
      'The simulations are demonstrative and educational. They are not a substitute for professional engineering verification.',
    aboutHeading: 'How it works',
    modesSummary: 'Two ways to compute the same thing',
    modesLead:
      'The same problem can be solved quickly and approximately, or slowly and more faithfully. The lab offers both routes and always tells you which one you are looking at — because the difference between them <em>is</em> part of what there is to learn.',
    modeFast:
      '<strong>Fast preview</strong> — a regular Cartesian grid solved in NumPy. Near-instant, and approximate by construction: the grid does not follow the body’s outline.',
    modeFenics:
      '<strong>FEniCSx computation</strong> — an unstructured triangular mesh generated with Gmsh, solved with P1 finite elements. Slower, more faithful close to the body, and it produces a VTK file that opens in ParaView.',
    modePanel:
      '<strong>Panel method</strong> — for the airfoil, neither of the above: source and vortex sheets on the body itself, so the boundary is exact rather than meshed. It is not a preview of something better; it is the most accurate surface solution here.',
    capabilityChecking: 'Checking what is installed on this server…',
    capabilityBoth: 'Both modes are active on this server.',
    capabilityPreviewOnly:
      'Only the fast preview is active on this server: no FEniCSx solver is installed. The experiments remain fully usable, and the airfoil exercise does not need one.',
    capabilityPaused: 'New simulations are temporarily suspended for maintenance.',
    capabilityUnreachable:
      'The server cannot be reached at the moment; the experiments may be unavailable.',
    madeSummary: 'How it is made',
    madeBody:
      'The lab is an application built on <a href="https://github.com/mandaloriat/fenix-spoon">Fenix Spoon</a>, an open-source toolkit that puts a finite-element solver behind a web page: the protocol, the job handling, the solvers and the browser widgets all come from there. What you find here is the teaching experience built on top — the problems, the explanations, the design and the public deployment.',
    madeLicence:
      'The code for this lab is on <a href="https://github.com/mandaloriat/physics-lab">GitHub</a> under the MIT licence. The real computations are carried out by <a href="https://fenicsproject.org/">FEniCSx</a>, and the fast previews and the panel method by <a href="https://numpy.org/">NumPy</a>.',
  },

  /* ---------------------------------------------------- markup shared by every bench page */

  /* ------------------------------------------- the guided path an exercise page opens with */

  guide: {
    /* The heading of the whole block, for screen readers; the chapters carry the visible ones. */
    heading: 'Before you start',
    chapterOf: 'Chapter {n} of {total}',
    goToChapter: 'Chapter {n}: {title}',
    next: 'Next',
    back: 'Back',
    backWhy: 'This is the first chapter.',
    /* Deliberately the same wording on the skip control and on the last chapter's button: they
       do the same thing, and giving one of them a different name would suggest otherwise. */
    skip: 'Go to the simulator →',
    finish: 'Go to the simulator →',
    reopen: 'Read the explanation again',
    /* Why a preset cannot run at this instant. Never a missing button — ADR-017's rule. */
    presetBusy: 'A solve is already running. It will be ready in a moment.',
    presetNoSolver: 'This server has no solver for this exercise.',
    presetPaused: 'New simulations are suspended for maintenance.',
  },

  bench: {
    mission: 'The mission',
    widgetsMissing:
      'The browser widgets have not been built. Run <code>./scripts/fetch-widgets.sh</code> and reload the page.',
    workspace: 'Workspace',
    visualisationTools: 'Visualisation tools',
    stageAria: 'Computed field. Drag to pan, plus and minus to zoom.',
    field: 'Field',
    fieldShown: 'Field shown',
    configure: 'Configure',
    design: 'Design',
    conditions: 'Conditions',
    whatFollows: 'What follows from these',
    advanced: 'Advanced',
    advancedError:
      'These change the error, not the answer. How much they change it is what the verification panel measures.',
    solverLabel: 'Solver',
    checkingServer: 'Checking what this server can do…',
    run: 'Run',
    cancel: 'Cancel',
    keep: 'Keep result',
    compare: 'Compare',
    answer: 'The answer',
    everyQuantity: 'Every reported quantity',
    trust: 'How far to trust it',
    cost: 'What the solve cost',
    keptRuns: 'Kept runs',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    deleteAll: 'Delete all',
    lesson: 'Understand the model',
    lessonLead:
      'Everything the exercise rests on, in the order it matters. Nothing here has been shortened — it has been moved out of the way of the experiment.',
    maintenance:
      'The lab is not accepting new simulations right now. You can still read the problem, {alternative} and look at any runs you have kept.',
  },

  /* --------------------------------------------------------------------------- the airfoil */

  airfoil: {
    title: 'Airfoil design — Spoon Physics',
    description:
      'An airfoil design exercise: hit a lift target under a pitching-moment constraint, with computed fields, engineering metrics and a verification residual on every run.',
    eyebrow: 'Exercise 1 · ideal flow with a Kutta condition',
    heading: 'Airfoil design',
    editorAria: 'Airfoil profile: draggable control points',
    profile: 'Profile',
    editShape: 'Edit shape',
    doneEditing: 'Done editing',
    resetProfile: 'Reset profile',
    fitProfile: 'Fit profile',
    custom: 'Custom',
    customDragged: 'Custom (dragged)',
    studyHeading: 'Study',
    studyLead:
      'A single incidence, or a sweep. A sweep is the only way to get an aerodynamic centre, and it costs one solve rather than one per angle.',
    advancedNote: 'numerics and study',
    noDrag:
      'No drag and no lift-to-drag ratio: this model is inviscid, so both are zero and a ratio of zeroes is not a metric. The chordwise force that does come out of the pressure integration is in the verification panel, where it belongs — it is an error bar.',
    surfacePressure: 'Surface pressure',
    acrossSweep: 'Across the sweep',
    sweepNote:
      'The aerodynamic centre is the regression slope of the pitching moment against lift, subtracted from the quarter chord. Thin-airfoil theory says 0.25; thickness moves it slightly aft. The fit’s R² is shown because a straight line through a curve is not a point.',
    maintenanceAlternative: 'reshape the profile',
    noSolver: 'This server has no solver that can impose a Kutta condition.',
    noSolverHere:
      'This server has no solver that imposes a Kutta condition, so this exercise cannot be run here.',
    ready: 'Press Run to solve the section as it stands.',
    edited: 'Edited by hand, so the profile menu no longer describes this shape.',
    described: '{label} — camber {camber} %, at {position} % of chord, thickness {thickness} %.',
    readback:
      'The solver read: chord {chord} m, thickness {thickness} %, camber {camber} %, {panels} panels from {vertices} outline vertices.',
    notes: {
      'NACA 0009': 'symmetric, thin',
      'NACA 0012': 'symmetric — the reference section',
      'NACA 1408': 'barely cambered, thin',
      'NACA 1412': 'barely cambered',
      'NACA 2312': 'camber well forward',
      'NACA 2412': 'the classic light-aircraft section',
      'NACA 2415': 'the same mean line, thicker',
      'NACA 2512': 'camber well aft',
      'NACA 4412': 'strongly cambered',
      'NACA 4415': 'strongly cambered, thick',
    },
    shape: {
      camber: 'Camber',
      camberTitle: 'Maximum camber, as a fraction of chord. At 0 the profile is symmetric.',
      position: 'Camber position',
      positionTitle:
        'Where the maximum camber sits along the chord — the third four-digit parameter.',
      thickness: 'Thickness',
      thicknessTitle: 'Maximum thickness, as a fraction of chord.',
      chordUnit: '{value} % chord',
    },
    params: {
      alpha: 'Angle of attack',
      alphaTitle:
        'Direction of the free stream relative to the chord line. The stream tilts; the profile does not.',
      speed: 'Free-stream speed',
      speedTitle: 'Undisturbed speed far upstream, in m/s.',
      kutta: 'Kutta condition',
      kuttaTitle:
        'A model choice. Turn it off and the circulation, and therefore the lift, is zero at every incidence — which is what this page computed before it had one.',
      kuttaEnforced: 'enforced (lifting model)',
      kuttaNone: 'none (no circulation)',
      panels: 'Panels',
      panelsHint: 'Its only legitimate effect is on the verification residuals.',
      trailingEdge: 'Trailing edge',
      trailingEdgeHint: 'An open base makes the Kutta condition depend on how it is closed.',
      trailingEdgeClosed: 'closed',
      trailingEdgeAsDrawn: 'as drawn',
      resolution: 'Field resolution',
      resolutionHint: 'Affects the picture and no reported number.',
      convergence: 'Check convergence',
      convergenceHint: 'Also solve at twice the panels, and report how far the lift moved.',
      sweepFrom: 'Sweep from',
      sweepFromHint: 'Leave empty for a single incidence.',
      sweepTo: 'Sweep to',
      sweepToHint: 'End of the sweep.',
      sweepStep: 'Sweep step',
      sweepStepHint: 'Every extra angle costs one back-substitution, not one solve.',
    },
    metrics: {
      cl: 'Lift coefficient',
      clHint: 'From the circulation, via Kutta–Joukowski.',
      lift: 'Lift per metre of span',
      liftShort: 'Lift per metre',
      liftHint: 'The dimensional answer the target is set in.',
      moment: 'Pitching moment',
      momentHint: 'About the quarter chord, nose-up positive.',
      centre: 'Centre of pressure',
      centreHint: 'Not applicable when the normal force is too small to place it.',
      centreAbsent: 'not defined here',
      peak: 'Suction peak',
      peakHint: 'How hard this shape pulls. A real boundary layer may not survive a deep one.',
      peakStation: 'Peak position',
      circulation: 'Circulation',
      incidence: 'Incidence, as read',
      incidenceHint:
        'Derived from the outline’s own chord line, which is why it can differ slightly from the value requested.',
      aerodynamicCentre: 'Aerodynamic centre',
      aerodynamicCentreAbsent: 'needs a sweep',
      aerodynamicCentreHint: 'A property of several incidences, so one solve cannot produce it.',
    },
    checks: {
      liftTwoWays: 'Lift two ways',
      liftTwoWaysDescribe: 'Circulation against integrated pressure.',
      dalembert: 'd’Alembert residual',
      dalembertDescribe: 'The chordwise force, which must vanish. An error bar, not a drag.',
      convergence: 'Panel convergence',
      convergenceDescribe: 'Change in the lift coefficient when the panel count is doubled.',
    },
    fields: {
      cp: 'Pressure coefficient, C_p',
      cpHint:
        'Blue is suction, red compression, and C_p = 1 marks the stagnation point. With the Kutta condition imposed the suction over the upper surface no longer cancels — that is the lift. The thin white curves are contours of C_p, not streamlines: switch Streamlines on to see the flow itself, integrated from the velocity field.',
      speed: 'Speed',
      speedHint: 'Velocity magnitude. Bright is fast.',
    },
    overlays: {
      profile: 'Profile',
      chord: 'Chord & c/4',
      chordTitle: 'The chord line, and the quarter chord the moment is taken about',
      stream: 'Free stream',
      streamTitle: 'Direction and speed of the undisturbed flow',
      centre: 'Centre of pressure',
      centreWhy:
        'The normal force is too small to place a centre of pressure: it genuinely runs off to infinity here.',
      resultant: 'Resultant',
      resultantWhy: 'Drawn at the centre of pressure, which this run does not have.',
      resultantTitle: 'The aerodynamic force, acting at the centre of pressure',
      peak: 'Suction peak',
      ac: 'Aerodynamic centre',
      acWhy:
        'The aerodynamic centre is a property of several incidences. Run a sweep under Advanced.',
    },
    plots: {
      upper: 'upper surface',
      lower: 'lower surface',
      cpAxis: 'C_p',
      stationAxis: 'x / c',
      liftTrace: 'lift coefficient',
      momentTrace: 'pitching moment',
      alphaAxis: 'angle of attack, degrees',
      coefficientAxis: 'coefficient',
      liftSlope: 'Lift-curve slope',
      slopeMultiple: 'as a multiple of 2π',
      zeroLift: 'Zero-lift incidence',
      aerodynamicCentre: 'Aerodynamic centre',
      fit: 'Fit R²',
    },
    air: {
      atmosphere: 'Atmosphere',
      atmosphereTitle:
        'Altitude sets temperature, pressure, density, viscosity and the speed of sound together, because they are one decision and not five.',
      isa: 'ISA altitude',
      manual: 'Enter the air properties',
      altitude: 'Altitude',
      density: 'Density',
      viscosity: 'Viscosity',
      soundSpeed: 'Speed of sound',
      chord: 'Chord',
      temperature: 'Temperature',
      pressure: 'Pressure',
      dynamicPressure: 'Dynamic pressure',
      reynolds: 'Reynolds number',
      mach: 'Mach number',
    },
    columns: {
      profile: 'Profile',
      alpha: 'α °',
      panels: 'panels',
      consistency: 'consistency',
    },
  },

  /* -------------------------------------------------------------------- the magnetic circuit */

  solenoid: {
    title: 'The magnetic circuit — Spoon Physics',
    description:
      'A magnetics design exercise: carry a required flux through an iron core on an ampere-turn budget, with computed fields, engineering metrics and a verification residual on every run.',
    eyebrow: 'Exercise 3 · linear magnetostatics of a cross-section',
    heading: 'The magnetic circuit',
    schematicTitle: 'Solenoid cross-section: iron core between two windings',
    legendCore: 'iron core',
    legendWinding: 'winding',
    legendAir: 'air',
    resetGeometry: 'Reset geometry',
    fitMagnet: 'Fit magnet',
    advancedNote: 'numerics',
    noStudy:
      'There is no study group here, because no metric this exercise reports needs more than one solve. The gap force would — and it is not reported, for a reason that has nothing to do with studies: this cross-section is symmetric, so its net force is exactly zero.',
    noPeak:
      'No peak flux density: the core’s corners are singularities of the exact solution, so a pointwise maximum climbs with every refinement instead of converging. Everything above is an integral — a flux, a section average, an energy — which a singularity carries no weight in. No gap force either: a symmetric bar core feels exactly zero.',
    midPlane: 'Along the core’s mid-plane',
    maintenanceAlternative: 'change the cross-section',
    noSolver: 'This server has no solver that reports magnetic metrics.',
    noSolverHere:
      'This server has no solver that reports magnetic metrics, so this exercise cannot be run here.',
    ready: 'Press Run to solve the cross-section as it stands.',
    described:
      'Core {core} mm across in a {bore} mm bore, {winding} mm of winding, {length} mm long. μᵣ = {permeability}, and {turns} ampere-turns per side. Solved in a {window} mm window, which is too large to draw here.',
    shapeLabel: '{core}×{length} core, {winding} mm winding at {gap} mm',
    design: {
      coreHalfWidth: 'Core half-width',
      coreHalfWidthTitle:
        'Half the thickness of the iron bar down the middle. It sets the area the flux has to fit through, so it moves the flux density more than the flux.',
      gap: 'Air gap',
      gapTitle:
        'Clearance between the core and the winding — the space insulation and formers take. It is what leakage is bought with: a tight gap keeps the copper’s field in the iron.',
      winding: 'Winding thickness',
      windingTitle: 'How far the copper extends outward. Thicker winding, more ampere-turns.',
      halfHeight: 'Half-height',
      halfHeightTitle:
        'Half the length of the core and the coil, along the axis. It buys ampere-turns and shortens the return path relative to the magnet, which is usually the most effective thing on this page.',
      permeability: 'Core permeability μᵣ',
      permeabilityTitle:
        'How much more easily the core carries flux than air. 1 means no core; iron is 10³–10⁴. Past about 1000 it stops helping, because the flux still has to return through air.',
      currentDensity: 'Current density',
      currentDensityTitle:
        'Current per unit area of copper. Around 5 A/mm² is a conventionally cooled winding. The model is linear, so this scales every field exactly.',
    },
    params: {
      cells: 'Cells across the magnet',
      cellsHint:
        'Across the regions, not the window — so widening the window does not coarsen the iron.',
      convergence: 'Check convergence',
      convergenceHint:
        'Also solve at twice the resolution, and report how far the flux density moved.',
      growth: 'Far-field growth',
      growthHint: 'How fast cells grow out in the air. 1.0 is a uniform grid, and a costly one.',
      iterations: 'Iteration ceiling',
      iterationsHint:
        'A four-decade permeability contrast needs the room. Raise it if a solve stops short.',
      resolution: 'Field resolution',
      resolutionHint: 'Affects the picture and no reported number.',
      output: 'Result kind',
      outputHint: 'The mesh shows the interface-fitted cells; the grid is a resampling of them.',
      outputGrid: 'regular grid',
      outputMesh: 'the solver’s own cells',
    },
    metrics: {
      flux: 'Core flux',
      fluxHint:
        'Per metre of depth, across the core’s mid-plane. Negative because it crosses downward — the sign is the winding sense, and the mission is set on the magnitude.',
      fluxAbsHint:
        'The magnitude, which is what the mission is set on. The signed value is in the table.',
      meanDensity: 'Mean flux density',
      meanDensityHint: 'The core flux divided by the core’s width, at the mid-plane.',
      busiest: 'Busiest section',
      busiestHint:
        'The same quantity at every height along the core, maximised. This is what saturates, and it is a section average rather than a peak on purpose.',
      leakage: 'Leakage',
      leakageHint:
        'The share of the flux crossing the mid-plane that misses the iron, measured against the whole bundle.',
      ampereTurns: 'Ampere-turns',
      ampereTurnsHint:
        'Through one side of the winding. Exact — a property of the geometry, needing no solve.',
      energy: 'Stored energy',
      energyHint:
        'Inside the modelled window, per metre of depth. Bounded by the window rather than by space.',
      permeance: 'Permeance',
      permeanceHint:
        'The magnetic circuit’s own figure of merit. Multiply by turns squared and by the real depth for an inductance.',
      bundle: 'Whole flux bundle',
      bundleHint:
        'Everything crossing the mid-plane in one direction, core and air together. The leakage is measured against this.',
      netCurrent: 'Net current',
      netCurrentHint:
        'Zero for a coil. Anything else is a wire, whose far field the modelled window cannot hold.',
      noCore: 'no core in this geometry',
    },
    checks: {
      energy: 'Energy two ways',
      energyDescribe:
        'Energy from the field against energy from the sources. Equal for a linear medium.',
      flux: 'Core flux two ways',
      fluxDescribe:
        'The drop in A_z across the core against the integral of B along the same line.',
      ampere: 'Ampère’s law',
      ampereDescribe: 'H·dl round a contour in the air against the current it encloses.',
      mesh: 'Mesh convergence',
      meshDescribe: 'Change in the mean flux density when the resolution is doubled.',
      linear: 'Linear solve',
      linearDescribe: 'How far the conjugate-gradient solve got, against what it was asked for.',
    },
    fields: {
      b: 'Flux density, |B|',
      bHint:
        'Flux density, in tesla — what a Hall probe or a Gauss meter measures. Bright is where the flux is concentrated. Switch to A to see the field lines it runs along, or turn on Streamlines: this solver publishes B as a vector, so they are integrated rather than drawn.',
      a: 'Vector potential, A_z (field lines)',
      aHint:
        'Vector potential A_z, the quantity actually solved for. Its contour lines are the magnetic field lines: closely spaced lines mean strong B, and the flux between any two of them is the same everywhere along their length. Every flux this page reports is a difference of this field between two points.',
      h: 'Field strength, H',
      hHint:
        'Field strength, H = |B| / (μ₀ μᵣ), derived here rather than solved. Compare it with |B| inside the core: B is large there and H is small, which is what a high permeability means.',
      mu: 'Material map, μᵣ',
      muHint:
        'Not a result but a check: where the solver placed the iron. Every material boundary is a cell face rather than a staircase, which is what makes the core exactly as wide as drawn.',
    },
    overlays: {
      regions: 'Core & windings',
      axis: 'Axis',
      plane: 'Flux surface',
      planeWhy: 'This geometry has no core, so there is no surface to measure across.',
      planeTitle: 'The core’s mid-plane: the surface the core flux is measured across',
      bundle: 'Flux bundle',
      bundleWhy: 'This run reports no bundle, so the leakage is not defined.',
      bundleTitle:
        'Where B_y changes sign — the ends of the bundle the leakage is measured against',
      contour: 'Ampère contour',
      contourTitle: 'The closed path H·dl is integrated around, and the winding it encloses',
    },
    derived: {
      ampereTurns: 'Ampere-turns per side',
      coreWidth: 'Core width',
      copper: 'Copper section',
      window: 'Modelled window',
      windowValue: '{size} mm square, {ratio}× the magnet',
      permeability: 'Core permeability',
    },
    plots: {
      xAxis: 'x, mm',
      fluxAxis: 'B_y, T',
      potentialAxis: 'A_z, Wb/m',
      core: 'core',
      bundle: 'bundle',
      leakageShare: 'Leakage is one minus their ratio — {value} % on this run.',
      noBundle:
        'No flux crosses this plane in either direction on this run, so there is no bundle for the core flux to be a share of, and no leakage is reported.',
      note: 'The inner pair of marks is the core, the outer pair is where B_y changes sign. The drop in A_z across the inner pair is the core flux; across the outer pair, the whole bundle. {share} The outer marks sit where B_y crosses zero, which is what makes that surface — and therefore the leakage — insensitive to exactly where it is placed. Shown out to ±{limit} mm; the solve runs to ±{window} mm, where A_z reaches the zero the boundary condition imposes.',
      noCoreNote:
        'Nothing in this geometry is magnetic, so there is no core flux to mark and no leakage to measure. The curves are still the field along the same line.',
    },
    columns: {
      section: 'Cross-section',
      leakage: 'leakage',
      cells: 'cells/magnet',
      energy: 'energy check',
    },
  },

  /* ---------------------------------------------------------------------------- the bridge */

  truss: {
    title: 'The bridge — Spoon Physics',
    description:
      'A structures exercise: build a truss across a gorge, load it at the joints or along the deck, and carry the traffic within a mass budget without buckling a member — with computed forces, engineering metrics and a verification residual on every run.',
    eyebrow: 'Exercise 4 · statics of a pin-jointed lattice',
    heading: 'The bridge',
    buildTools: 'Build tools',
    stageAria: 'The lattice and what it carries. Drag to pan, plus and minus to zoom.',
    builderAria: 'Bridge builder. Add joints and bars, place supports and loads.',
    designLead:
      'Press <strong>Build</strong> above the site to lay out the lattice: add joints, join them with bars, and put supports where the ground can take a reaction.',
    startFrom: 'Start from',
    startingLattice: 'Starting lattice',
    undo: 'Undo',
    resetLattice: 'Reset lattice',
    advancedNote: 'presentation',
    advancedLead:
      'There is no mesh size here, no tolerance and no iteration count, so there is no convergence study either. A pin-jointed lattice <em>is</em> its own discretisation: one element per bar, solved once. The only setting left is how wide the bars are drawn.',
    noBending:
      'No bending moment and no joint stress: every joint here is a frictionless pin, so a bar carries force along itself and nothing else. A real gusset carries some moment, which stiffens the truss and puts bending into the chords — a different model, and not this one.',
    memberByMember: 'Member by member',
    fitBridge: 'Fit the bridge',
    build: 'Build',
    buildTitle: 'Lay out the lattice: joints, bars, supports and loads',
    maintenanceAlternative: 'build a lattice',
    noSolver: 'This server has no solver that answers a truss.',
    noSolverHere:
      'This server has no solver that answers a truss, so this exercise cannot be run here.',
    ready: 'Press Run to solve the lattice as it stands.',
    presets: {
      'warren-8': 'Warren, 8 panels, 3 m deep',
      'warren-10': 'Warren, 10 panels, 3 m deep',
      'warren-6-deep': 'Warren, 6 panels, 4.5 m deep',
      'pratt-8': 'Pratt, 8 panels, 3 m deep',
      deck: 'The deck alone (it folds)',
      empty: 'Nothing — start from bare ground',
    },
    loads: {
      deck: 'Traffic on the deck',
      deckTitle:
        'A load per unit length along the carriageway, carried by every bar with both ends at deck level and lumped half to each end. This is the mission’s load; the targets are set against it.',
      point: 'A dropped load',
      pointTitle:
        'How heavy each load you place with the Load tool is. Placed at a joint, it becomes a vertical force on a boundary naming that joint alone.',
      wind: 'Side load on the trusswork',
      windTitle:
        'A horizontal total, shared equally between every joint above the deck. It has to reach the abutments through the lattice, which is a different journey from the vertical one.',
    },
    params: {
      area: 'Bar section',
      areaHint:
        'Every bar, in m². The buckling load goes with its square, so this is the strongest lever on the page — and the most expensive.',
      selfWeight: 'Carry its own weight',
      selfWeightHint:
        'Each bar’s weight, half at each end. Leaving it out flatters exactly the designs that add material.',
      safety: 'Safety factor',
      safetyHint:
        'Capacity is divided by this before a utilisation is taken. 1.0 reports the bare failure ratio.',
      yield: 'Yield strength',
      yieldHint:
        '250 MPa is ordinary structural steel. It sets the tension capacity; compression is usually decided by buckling instead.',
      modulus: 'Elastic modulus',
      modulusHint:
        '210 GPa for steel. It sets the deflection and the buckling load, and not a single member force in a determinate truss.',
      density: 'Density',
      densityHint: '7850 kg/m³ for steel. It decides the mass, which is what the budget is set on.',
      barWidth: 'Drawn bar width',
      barWidthHint:
        'How wide the bars are drawn, in metres. Zero derives one from the site. A real 2600 mm² bar is 58 mm across, which on a 24 m span is invisible.',
    },
    metrics: {
      worst: 'Worst member',
      worstHint:
        'Force over capacity for the busiest bar: yield in tension, the lesser of yield and Euler buckling in compression, both divided by the safety factor. One is the edge.',
      spanRatio: 'Deflection over span',
      spanRatioHint:
        'The largest joint movement divided by the distance between the supports — the form a serviceability limit is written in.',
      deflection: 'Largest deflection',
      deflectionShort: 'Deflection',
      deflectionHint:
        'The furthest any joint moves. Where it moves is drawn on the field by the Deflected shape layer.',
      deflectionAbsent: 'it does not move',
      mass: 'Steel used',
      massHint:
        'Density times area times length, summed over every bar. The budget the mission is set against.',
      carried: 'Carried per kilogram',
      carriedShort: 'Carried per kg',
      carriedHint:
        'The imposed load divided by the mass of steel. Self-weight is not in the numerator: a bridge is not paid to carry itself.',
      buckling: 'Buckling margin',
      bucklingHint:
        'Euler’s critical load over the force carried, for the worst member in compression. Below one it has gone. Absent when nothing is in compression.',
      bucklingAbsent: 'nothing is in compression',
      compression: 'Largest compression',
      compressionHint:
        'As a positive number. Read it beside the buckling margin rather than beside the tension.',
      tension: 'Largest tension',
      tensionHint:
        'The largest pull in any bar. Tension is the cheap direction: it does not buckle.',
      stress: 'Peak axial stress',
      stressHint:
        'The largest stress magnitude anywhere, tension or compression. Compare it with the yield strength.',
      reaction: 'Largest reaction',
      reactionHint:
        'What the busiest abutment has to be built for. The bridge is only as good as the ground under it.',
    },
    checks: {
      joints: 'The method of joints',
      jointsDescribe:
        'At every free joint, the bar forces and the applied load must sum to zero. Computed from the member forces and the geometry alone — it never touches the stiffness matrix.',
      force: 'Force balance',
      forceDescribe: 'Everything applied plus everything the supports pushed back with is zero.',
      moment: 'Moment balance',
      momentDescribe:
        'The same about the origin — which catches a reaction of the right size in the wrong place, where the force balance cannot.',
      energy: 'Energy two ways',
      energyDescribe:
        'Strain energy summed over the bars against the work done by the load at the joints. Equal for a linear structure, by two routes that share no arithmetic.',
      linear: 'The linear solve',
      linearDescribe: 'How far the direct solve of K u = f actually got.',
    },
    fields: {
      utilisation: 'Utilisation, η',
      utilisationHint:
        'Force over capacity, bar by bar. Anything reaching 1 has run out — in compression that is usually Euler buckling rather than yield, which is why a long diagonal lights up long before a short one carrying the same force.',
      force: 'Axial force, N',
      forceHint:
        'Positive is tension, negative is compression. Follow the sign along the chords: in a simply supported truss the bottom is pulled and the top is pushed, and the diagonals alternate as they carry the shear out to the supports.',
      stress: 'Axial stress, MPa',
      stressHint:
        'The same forces divided by the section, in megapascals, so they can be compared with the yield strength directly. Note how rarely it is the number that decides anything: compression members are lost to buckling at a fraction of yield.',
    },
    tools: {
      move: 'Move',
      moveHint: 'Drag a joint. Everything attached follows it.',
      joint: 'Joint',
      jointHint: 'Click anywhere to add a joint.',
      bar: 'Bar',
      barHint: 'Click one joint, then another, to join them with a bar.',
      support: 'Support',
      supportHint:
        'Click a joint to cycle it: pin, roller, free. A pin holds both ways; a roller only holds it up.',
      load: 'Load',
      loadHint: 'Click a joint to drop the load on it, or to take it off again.',
      erase: 'Erase',
      eraseHint: 'Click a joint or a bar to remove it.',
      pressBuild: 'Press Build to lay out the lattice.',
      outsideBuild:
        'The lattice is shown over the field in Build mode, where the pointer belongs to the builder rather than to the view.',
    },
    overlays: {
      lattice: 'The lattice',
      deformed: 'Deflected shape',
      deformedScaled: 'Deflected shape ×{factor}',
      deformedTitle: 'Where every joint went, magnified until the largest movement can be seen',
      worst: 'Worst member',
      worstTitle: 'The bar the mission is decided by',
      loads: 'Loads & supports',
    },
    site: {
      keepClear: 'keep clear',
      ground: 'ground',
    },
    readiness: {
      nothingBuilt: 'Nothing is built yet. Add some bars.',
      nothingHolds: 'Nothing holds it up. Put a support on a joint the bars reach.',
      noDeck:
        'The traffic load runs along the deck, and no bar has both ends on it. Build the carriageway, or set the deck load to zero.',
      strayLoad: 'A load sits on joint {index}, which no bar reaches, so it has nowhere to go.',
      noLoad: 'Nothing is loading it. Add a deck load, or drop a load on a joint.',
    },
    lattice: {
      counts: '{joints} joints, {bars} bars.',
      supports: '{pinned} pinned, {rollers} on rollers.',
      dropped: '{count} joint load(s) placed.',
      stray: '{count} joint(s) reached by no bar — they are left out of the solve.',
    },
    derived: {
      totalLength: 'Total bar length',
      longest: 'Longest bar',
      steel: 'Steel, before the solve',
      imposed: 'Vertical load imposed',
      euler: 'Euler load of the longest bar',
    },
    boundaries: {
      deck: 'The carriageway: every joint at deck level, and the bars between them.',
      support: 'The ground under joint {index}.',
      load: 'Joint {index}, where a load has been placed.',
      aboveDeck: 'Everything the wind can reach: every joint above the carriageway.',
    },
    members: {
      bar: 'bar',
      force: 'force kN',
      length: 'length m',
      utilisation: 'utilisation',
      limitedBy: 'limited by',
      yield: 'yield',
      buckling: 'buckling',
      ladderTrace: 'η',
      ladderX: 'members, worst first',
      ladderY: 'utilisation η',
      capacity: 'capacity',
      note: 'The eight busiest bars. Bar {index} is the one the mission is decided by, and it is marked on the field by the Worst member layer. A bar limited by buckling is one whose Euler load is below its squash load — shortening it helps by the square of the length, where thickening it helps by the square of the area.',
    },
    shapeLabel: '{bars} bars, {depth} m deep',
    loadedRun: 'Loaded the {label} run. Press Run to recompute it.',
    columns: {
      lattice: 'Lattice',
      mass: 'mass kg',
      area: 'A m²',
      deck: 'deck kN/m',
      joint: 'joint check',
    },
  },
  heatsink: {
    title: 'The heat sink — Spoon Physics',
    description:
      'A thermal design exercise: keep a power device below its rating on a mass budget, with conduction, convection taken from the channel between the fins and radiation exchanged through it — and find the fin count where adding more starts making it worse.',
    eyebrow: 'Exercise 5 · steady conduction with convection and radiation',
    heading: 'The heat sink',
    schematicTitle: 'Heat sink cross-section: a finned base with the device footprint underneath',
    legendMetal: 'aluminium',
    legendAir: 'air',
    legendFootprint: 'device footprint',
    resetGeometry: 'Reset geometry',
    advancedNote: 'numerics, and two model switches',
    switchesNote:
      'The last two are different: they change the model rather than the error. Turning radiation off, or pinning the convection coefficient, is how you see what the simpler model would have told you — and every run that uses one says so.',
    twoPaths:
      'The radiative fraction and the view factor to the room are reported together on purpose. The first is how much radiation is worth here; the second is why. Pack the fins and watch both fall — the fins added to help convection have hidden the metal from the room.',
    sweepHeading: 'Where the fins stop helping',
    sweepLead:
      'The same sink at every fin count, everything else held. Resistance falls while added surface wins, flattens, and climbs once the channels are too narrow for the air and the fins have started shading each other from the room.',
    runSweep: 'Sweep the fin count',
    sweepIdle: 'Nothing swept yet. One solve cannot show a turning point.',
    sweepNote:
      'Best at {best} fins — {value} K/W, against {worst} K/W at the crowded end. Both heat paths weaken as the channel narrows, and the curve turns where their loss overtakes the area gained.',
    sweepEdge:
      'The minimum sits at the edge of the range swept, so the turning point is outside it. Change the fin height or thickness and sweep again.',
    shapeNote: 'Channel {channel} mm · about {mass} g of aluminium.',
    shapeOverlap:
      '{count} fins of this thickness do not fit across the 60 mm base — they would overlap. Thin the fins or use fewer.',
    ready: 'Ready. Press Run.',
    noSolver: 'No heat-sink solver is available on this server.',
    noSolverHere: 'This server has no heat-sink solver, so nothing can be run here.',
    maintenanceAlternative: 'the specification, which carries the model and every check in full',
    design: {
      finCount: 'Fins',
      finCountTitle:
        'How many fins across the base. The one control with a best value rather than a direction.',
      finHeight: 'Fin height',
      finHeightTitle:
        'Taller fins add surface, and lose efficiency as the metal struggles to keep the tip as warm as the root.',
      finThickness: 'Fin thickness',
      finThicknessTitle:
        'Thicker fins conduct better and are heavier, and they eat the channel the air has to pass through.',
      baseThickness: 'Base thickness',
      baseThicknessTitle:
        'Spreads the device heat sideways before it reaches the fins. Cheap in resistance, expensive in mass.',
      power: 'Device power',
      powerTitle: 'What the device dissipates, spread evenly along the extrusion.',
      ambient: 'Ambient',
      ambientTitle: 'Air temperature, and the temperature of the room the sink radiates to.',
      footprint: 'Device footprint',
      footprintTitle:
        'Contact width on the underside of the base. A smaller device concentrates the flux.',
      finish: 'Surface finish',
      finishHint:
        'Sets the emissivity. Sixteen-fold from mill to black anodised, for no metal at all — but worth much less on a tightly finned sink, where the fins have hidden the surface from the room.',
      cooling: 'Cooling',
      coolingHint:
        'Still air, or a fan along the extrusion. The best fin count is not the same one.',
      velocity: 'Air speed',
      velocityTitle: 'Face velocity along the channels.',
      flush: 'Mounted flush',
      flushHint:
        'With the underside blocked by the mounting, it loses nothing. Unticked, the base cools from below as well.',
    },
    finish: {
      mill: 'Mill finish (ε ≈ 0.05)',
      clear_anodised: 'Clear anodised (ε ≈ 0.6)',
      black_anodised: 'Black anodised (ε ≈ 0.8)',
    },
    cooling: {
      natural: 'Natural convection',
      forced: 'Forced — a fan',
    },
    derived: {
      channel: 'Channel between fins',
      area: 'Exposed surface',
      mass: 'Aluminium',
      flux: 'Flux under the device',
    },
    params: {
      cellSize: 'Mesh cell',
      radiation: 'Radiation on',
      hOverride: 'Pin the coefficient',
    },
    metrics: {
      tMax: 'Peak temperature',
      tRise: 'Rise above ambient',
      resistance: 'Thermal resistance',
      mass: 'Mass',
      score: 'Resistance × mass',
      efficiency: 'Fin efficiency',
      radiative: 'Radiative share',
      viewFactor: 'View factor to room',
      h: 'Convection coefficient',
      flux: 'Peak conductive flux',
    },
    checks: {
      energy: 'Energy balance',
      energyTitle:
        'What the device put in, against convection plus radiation out over the whole exposed boundary. Radiation lost into a badly formed enclosure would leave through this number too.',
    },
    fields: {
      temperature: 'Temperature',
      temperatureHint:
        'The metal only. The air was never solved, and is masked out rather than drawn at some sentinel value.',
      flux: 'Conductive flux',
      fluxHint:
        'k|grad T| inside the metal — where it crowds is where the metal is working, which is where a fin is worth thickening.',
    },
    fitProfile: 'Fit profile',
    columns: {
      profile: 'profile',
      mass: 'mass kg',
      radiative: 'rad. share',
      energy: 'energy',
    },
    shapeLabel: '{fins} fins · {height} mm tall · {thickness} mm thick · {base} mm base',
    plots: {
      finCount: 'fins',
      resistance: 'R_θ (K/W)',
      radiative: 'radiative share',
      best: 'best',
    },
  },
};
