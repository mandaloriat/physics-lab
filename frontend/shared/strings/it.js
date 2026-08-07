/**
 * Ogni parola che il laboratorio dice in italiano.
 *
 * Rispecchia `strings/en.js` chiave per chiave. Una chiave presente là e assente qui non è un
 * errore fatale: `shared/i18n.js` mostra l'inglese e lo segnala in console, perché una frase
 * inglese in mezzo all'italiano è visibilmente da tradurre, mentre uno spazio vuoto no.
 *
 * **Il vocabolario è quello dell'ingegneria italiana, non un calco.** `lift` è *portanza*,
 * `truss` è *travatura reticolare*, `ampere-turns` sono *amperspire*: dove esiste il termine
 * tecnico si usa quello. Restano in inglese i nomi propri del software (`mock.laplace2d`,
 * `mesh`, `Fenix Spoon`) e i simboli, che sono gli stessi in ogni lingua — è la ragione per cui
 * ADR-011 aveva scelto una lingua sola, ed è il motivo per cui la traduzione si ferma dove
 * comincia l'API.
 *
 * **Non è qui, di proposito.** Gli avvisi di validità dentro `report.json` e il titolo di ogni
 * capacità da `GET /api/v1/solvers` arrivano dal server e restano nella lingua in cui il server
 * li ha scritti. ADR-020 spiega perché e dove andrebbero tradotti.
 */

export default {
  lang: {
    label: 'Lingua',
  },

  brand: {
    name: 'Spoon Physics',
    // ADR-016 fissava la vecchia tagline come affermazione non negoziabile del prodotto. La
    // revisione editoriale la sostituisce di proposito: quella descriveva il solutore, questa
    // descrive che cosa ci fai. Vedi ADR-022.
    tagline: 'Sfide di fisica. Calcoli reali. Risultati da discutere.',
  },

  nav: {
    label: 'Sezioni del laboratorio',
    experiments: 'Sfide',
    how: 'Come si gioca',
    code: 'Codice',
  },

  footer: {
    builtWith: 'Costruito con ',
    and: ' e ',
    notAffiliated: '. Non affiliato al FEniCS Project.',
    source: 'Codice sorgente su GitHub',
    licence: ' · MIT',
  },

  stats: {
    seconds: 'durata',
    cells: 'celle',
    dofs: 'gradi di libertà',
    iterations: 'iterazioni',
    elements: 'elementi',
    grid: 'griglia',
  },

  /* ------------------------------------------------------- che cosa sa fare questo server */

  solver: {
    mock: {
      label: 'Anteprima rapida',
      summary:
        'Una griglia cartesiana risolta in NumPy. Risponde all’istante — ideale mentre si modella la geometria.',
      caveat: 'È un’approssimazione: griglia regolare, senza mesh adattata al corpo.',
    },
    fenicsx: {
      label: 'Calcolo FEniCSx',
      summary:
        'Una mesh Gmsh non strutturata risolta agli elementi finiti. Più lenta, e più fedele vicino al contorno.',
      caveat: 'Richiede un worker con dolfinx installato.',
    },
    panel: {
      label: 'Metodo a pannelli',
      summary:
        'Distribuzioni di sorgenti e vortici sul corpo stesso, chiuse dalla condizione di Kutta. Il contorno è esatto invece che discretizzato, e il campo lontano è soddisfatto analiticamente.',
      caveat: 'Millisecondi di aritmetica — non l’anteprima di qualcosa di meglio.',
    },
    missing: 'Non disponibile su questo server: {modes}.',
  },

  /* ------------------------------------------------------------ la struttura delle pagine */

  experiment: {
    pageTitle: '{title} — Spoon Physics',
    notSet: 'non impostato',
    submitting: 'Invio in corso…',
    solving: 'Risoluzione…',
    cancelled: 'Annullato.',
    done: 'Fatto.',
    iteration: 'iterazione {index}',
    iterationOf: 'iterazione {index} di {total}',
    residual: ' — residuo {value}',
    download: 'Scarica: ',
    maintenanceStatus: 'Le simulazioni sono sospese per manutenzione.',
    unreachable: 'Server irraggiungibile — {detail}',
    kept: '{count} prove su {capacity}, solo in questo browser.',
    evicted: '{count} tra le più vecchie eliminate per fare spazio.',
    loaded: 'Caricati i dati del tentativo {label}. Premi Calcola per ricalcolarlo.',
  },

  /* -------------------------------------------------------------- i renderer condivisi */

  exercise: {
    notRunYet: 'non ancora calcolato',
    notReported: 'questo tentativo non lo riporta',
    reading: 'questo tentativo: {value}',
    atMost: 'al massimo',
    atLeast: 'almeno',
    within: ' con uno scarto massimo del {amount}',
    verificationGap:
      'Le due vie indipendenti alla risposta differiscono del {value} %, oltre il {limit} % che questa sfida richiede. Raffina la discretizzazione e riprova.',
    notApplicable: 'non applicabile',
    needs: 'richiede {key}',
    everySolve: 'Calcolato a ogni tentativo.',
    everyRun: 'Verificato a ogni tentativo.',
    notRun: 'non eseguito',
    inside: 'Dentro il campo di validità dichiarato. ',
    insideTail:
      'Ogni limite che questo modello dichiara è stato confrontato con questo tentativo e nessuno è stato superato.',
    explainLocked: 'Disponibile dopo il primo calcolo: prima viene la tua previsione.',

    /* L'esito, in una riga. I motivi stanno un pannello più sotto. */
    outcome: {
      metLead: 'Sfida riuscita.',
      metTail:
        'Salva il tentativo e cerca una soluzione diversa: {next}. Due risultati simili possono nascere da progetti molto diversi.',
      metTailPlain:
        'Salva il tentativo e cerca una soluzione diversa. Due risultati simili possono nascere da progetti molto diversi.',
      missedLead: 'Non ancora.',
      missedTail: 'Guarda quale limite è stato superato e cambia una scelta alla volta.',
      outsideMetLead: 'I numeri centrano l’obiettivo, ma questo tentativo non conta.',
      outsideMetTail: 'Il modello è fuori dal proprio campo di validità.',
      outsideLead: 'Questo tentativo non conta.',
      outsideTail: 'La configurazione è fuori dal campo di validità del modello.',
      unverifiedLead: 'Il tentativo non è ancora giudicabile.',
      unverifiedTail: 'Il controllo numerico non è superato.',
      failedLead: 'Il calcolo non è arrivato in fondo.',
      failedTail: 'Guarda il messaggio qui sopra e riprova.',
    },

    /* I due indicatori che non rispondono alla stessa domanda. */
    credibility: {
      numeric: 'Calcolo stabile',
      physical: 'Modello applicabile',
      yes: 'sì',
      improve: 'da migliorare',
      unchecked: 'non controllato',
      caution: 'con cautela',
      no: 'no',
      numericWhat:
        'Dice se il risultato cambia poco quando il calcolo viene raffinato o confrontato per una seconda via.',
      physicalWhat:
        'Dice se la configurazione resta dentro le ipotesi fisiche dichiarate dal modello.',
      seeChecks: 'Vedi i controlli →',
    },

    /* La frase sotto ogni risultato principale. */
    tile: {
      within: 'Dentro la tolleranza.',
      short: 'Mancano {delta}.',
      over: 'Superi l’obiettivo di {delta}.',
      spare: 'Ti restano {margin}.',
      above: 'Sei oltre il limite di {delta}.',
      below: 'Mancano {delta} al minimo.',
      barAria: '{value} su un limite di {limit}',
    },
  },

  path: {
    label: 'Il percorso della sfida',
    predict: 'Prevedi',
    attempt: 'Prova',
    improve: 'Migliora',
    compare: 'Confronta',
    done: 'fatto',
  },

  prediction: {
    heading: 'Prima di calcolare',
    unknown: 'Non so ancora',
    note: 'La previsione non influisce sul calcolo. Serve soltanto per confrontare ciò che ti aspettavi con ciò che è successo.',
    youSaid: 'Avevi previsto:',
  },

  teacher: {
    summary: 'Per docenti',
    objective: 'Obiettivo',
    prediction: 'Previsione utile',
    misconception: 'Errore comune',
    discussion: 'Discussione finale',
    prerequisites: 'Prerequisiti',
    duration: 'Tempo',
  },

  runs: {
    none: 'Non hai ancora salvato tentativi. Calcola una configurazione, salvala, poi cambiane una scelta e riprova.',
    one: 'Salva un secondo tentativo per vedere che cosa cambia davvero.',
    select: 'Seleziona questo tentativo per il confronto',
    load: 'Carica',
    delete: 'Elimina',
    rename: 'Dai un nome a questo tentativo',
    namePlaceholder: 'per esempio “più curvo”',
    yes: 'sì',
    no: 'no',
    selectTwo: 'Seleziona due o più tentativi per confrontarli.',
    field: 'Grandezza',
    run: 'Tentativo {index}',
    differOne: '{differ} grandezza differisce; {same} sono identiche e nascoste.',
    differMany: '{differ} grandezze differiscono; {same} sono identiche e nascoste.',
    blocks: {
      exercise: 'Sfida',
      solver: 'Calcolo',
      model: 'Modello',
      geometry: 'Geometria',
      physical: 'Le tue scelte',
      numerics: 'Impostazioni del calcolo',
      dimensionless: 'Adimensionali',
      metrics: 'Risultati',
      sweep: 'Scansione',
      verification: 'Controlli numerici',
      validity: 'Limiti del modello',
      cost: 'Calcolo',
    },
  },

  curve: {
    empty: 'Non c’è ancora nulla da tracciare.',
    aria: '{y} in funzione di {x}',
  },

  workspace: {
    density: 'Densità',
    unavailable: 'Non disponibile.',
    clear: 'cancella',
    at: 'in ({x}, {y})',
    scaleAria: 'Scala di colore per {field}, da {min} a {max}',
    fixed: 'bloccata',
    noRun: 'Esegui prima il calcolo.',
    pan: { label: 'Sposta', title: 'Trascina per spostare la vista' },
    probe: {
      label: 'Sonda',
      title: 'Clicca per fissare valore e coordinate in un punto',
      why: 'La sonda ha bisogno di un campo calcolato. Esegui prima il calcolo.',
    },
    edit: {
      label: 'Modifica forma',
      title: 'Mostra e trascina i punti di controllo della geometria',
    },
    zoomOut: { label: 'Riduci', why: 'Già inquadrato.' },
    zoomIn: {
      label: 'Ingrandisci',
      why: 'Al limite: oltre questo si ingrandisce la griglia di campionamento, non il campo.',
    },
    fit: {
      label: 'Inquadra il corpo',
      why: 'Non c’è nulla da inquadrare finché la geometria non è nota.',
    },
    reset: { label: 'Reimposta vista' },
    vectors: {
      label: 'Vettori',
      title: 'Frecce del campo di velocità',
      whyBuild: 'Questa versione del visualizzatore non disegna vettori.',
      whyField: 'Questo risultato non pubblica alcun campo vettoriale: non c’è nulla da disegnare.',
    },
    streamlines: {
      label: 'Linee di corrente',
      title: 'Curve integrate dal campo di velocità',
      whyField:
        'Questo risultato non pubblica alcun campo di velocità. Una linea di corrente è un integrale di quel campo, quindi non c’è nulla da integrare.',
      whyMesh:
        'Qui l’integrazione campiona la griglia regolare. Scegli il risultato su griglia, oppure usa le frecce vettoriali sulla mesh.',
    },
    lockScale: {
      label: 'Blocca scala',
      title: 'Tieni fissa la scala di colore mentre confronti le prove',
      why: 'Il visualizzatore calcola la scala di colore dai dati e non espone alcun modo per imporne una: una scala bloccata sarebbe in disaccordo con l’immagine.',
    },
    export: {
      label: 'Esporta immagine',
      title: 'Scarica la vista corrente come PNG',
      why: 'Disponibile una volta disegnato un campo.',
    },
  },

  /* -------------------------------------------------------------------------- la home page */

  home: {
    title: 'Spoon Physics — sfide di fisica interattiva',
    description:
      'Piccole sfide di fisica interattiva: fai una previsione, cambia il progetto, calcola il risultato e confronta i tentativi con i limiti del modello.',
    heroHeading: 'Fai una previsione. Mettila alla prova.',
    lede: 'Scegli una sfida, cambia pochi parametri e guarda che cosa prevede il modello. Salva i tentativi, confrontali e scopri dove la simulazione smette di essere credibile.',
    experiments: 'Sfide',
    badgeExercise: 'Sfida',
    badgePlanned: 'In preparazione',
    missionSummary: 'La sfida',

    airfoil: {
      name: 'Trova l’assetto dell’ala',
      question: 'Quanta inclinazione serve a un’ala?',
      topic: 'Aerodinamica · 5–8 min',
      problem:
        'Scegli un profilo e regola l’angolo per ottenere la portanza richiesta senza farlo ruotare troppo. Profili diversi possono arrivare allo stesso risultato in modi diversi.',
      mission: 'Sostieni l’equivalente di circa 80 kg per ogni metro di ala.',
      cta: 'Prova con un’ala →',
    },
    truss: {
      name: 'Costruisci un ponte che regga',
      question: 'Quale asta cede per prima?',
      topic: 'Strutture · 8–12 min',
      problem:
        'Disegna un ponte di 24 metri, porta il traffico e resta sotto il budget di acciaio. Prima del calcolo indica l’asta che pensi sia più fragile.',
      mission: 'Circa 10 tonnellate distribuite, con al massimo 2,4 tonnellate di acciaio.',
      cta: 'Costruisci il ponte →',
    },
    heatsink: {
      name: 'Quante alette servono davvero?',
      question: 'Più alette raffreddano sempre meglio?',
      topic: 'Calore · 6–10 min',
      problem:
        'Prova a prevedere quante alette servono, poi lascia che il calcolo esplori le alternative. Troppo poche disperdono poco calore; troppe possono soffocare il passaggio dell’aria.',
      mission: 'Tieni un componente da 30 W sotto 95 °C usando al massimo 170 g di alluminio.',
      cta: 'Progetta il dissipatore →',
    },
    solenoid: {
      name: 'Campo magnetico in una sezione 2D',
      question: 'Campo magnetico in una sezione 2D',
      topic: 'Magnetostatica',
      problem:
        'Porta un flusso richiesto attraverso un nucleo di ferro con un budget di amperspire, e guarda quanto se ne disperde nell’aria.',
      mission: 'Pensato per chi conosce già flusso, campo e circuiti magnetici.',
      cta: 'Apri il laboratorio →',
    },

    howHeading: 'Come si gioca',
    step1Heading: '1. Prevedi',
    step1:
      'Scegli che cosa pensi succederà. Non serve indovinare: la previsione serve per avere qualcosa da confrontare.',
    step2Heading: '2. Calcola',
    step2:
      'Cambia pochi parametri e avvia il calcolo. Il campo e i numeri vengono ricavati dalla configurazione che hai scelto.',
    step3Heading: '3. Confronta',
    step3:
      'Salva almeno due tentativi. Cerca che cosa è cambiato, quale vincolo decide il risultato e dove il modello non basta più.',
    howNote:
      '<strong>Un numero può essere calcolato bene e descrivere male la realtà.</strong> Per questo ogni tentativo distingue la stabilità del calcolo dai limiti del modello.',

    advancedHeading: 'Laboratori avanzati',
    advancedLead:
      'Pagine costruite per chi conosce già il tema. Non sono sfide con una missione da centrare.',

    disclaimerLabel: 'Nota.',
    disclaimer:
      'Questi modelli servono per esplorare idee e confrontare soluzioni. Non sono strumenti di progetto professionale.',

    aboutHeading: 'Come si gioca',
    methodSummary: 'Metodo, codice e dati',
    methodBody:
      'Le risposte non sono animazioni predefinite: vengono calcolate dalla configurazione corrente. Ogni sfida usa il modello più adatto e rende disponibili controlli numerici, grandezze complete ed esportazione dei dati. Il codice del laboratorio è open source.',
    methodAirfoil: '<strong>Ala</strong> — un metodo a pannelli sulla superficie del profilo.',
    methodTruss: '<strong>Ponte</strong> — un elemento di asta per ogni asta, risolto una volta.',
    methodHeatsink:
      '<strong>Dissipatore</strong> — conduzione nel metallo, con convezione e irraggiamento sulle superfici.',
    methodSolenoid: '<strong>Magnetostatica</strong> — il campo in una sezione bidimensionale.',
    capabilityChecking: 'Verifica di che cosa è installato su questo server…',
    capabilityBoth:
      'Su questo server sono attivi sia il calcolo rapido sia quello a elementi finiti.',
    capabilityPreviewOnly:
      'Su questo server è attivo solo il calcolo rapido: non è installato FEniCSx. Le sfide restano utilizzabili, e quella sull’ala non ne ha bisogno.',
    capabilityPaused: 'I nuovi calcoli sono temporaneamente sospesi per manutenzione.',
    capabilityUnreachable:
      'Al momento il server non è raggiungibile; le sfide potrebbero non essere disponibili.',
    madeSummary: 'Com’è fatto',
    madeBody:
      'Il laboratorio è un’applicazione costruita su <a href="https://github.com/mandaloriat/fenix-spoon">Fenix Spoon</a>, un toolkit open source che mette un solutore agli elementi finiti dietro una pagina web. Quello che trovi qui è l’esperienza didattica costruita sopra — i problemi, le spiegazioni, il design e il deployment pubblico.',
    madeLicence:
      'Il codice di questo laboratorio è su <a href="https://github.com/mandaloriat/spoon-physics">GitHub</a> con licenza MIT. I calcoli a elementi finiti sono svolti da <a href="https://fenicsproject.org/">FEniCSx</a>, il resto da <a href="https://numpy.org/">NumPy</a>.',
  },

  guide: {
    heading: 'Prima di cominciare',
    chapterOf: 'Capitolo {n} di {total}',
    goToChapter: 'Capitolo {n}: {title}',
    next: 'Avanti',
    back: 'Indietro',
    backWhy: 'Questo è il primo capitolo.',
    skip: 'Vai al simulatore →',
    finish: 'Vai al simulatore →',
    reopen: 'Rileggi la spiegazione',
    presetBusy: 'Un calcolo è già in corso. Fra un attimo è pronto.',
    presetNoSolver: 'Questo server non ha un solutore per questo esercizio.',
    presetPaused: 'Le nuove simulazioni sono sospese per manutenzione.',
  },

  bench: {
    mission: 'La sfida',
    widgetsMissing:
      'I widget del browser non sono stati costruiti. Esegui <code>./scripts/fetch-widgets.sh</code> e ricarica la pagina.',
    workspace: 'Banco di prova',
    visualisationTools: 'Strumenti di visualizzazione',
    stageAria: 'Campo calcolato. Trascina per spostare, più e meno per ingrandire.',
    field: 'Campo',
    fieldShown: 'Campo mostrato',
    configure: 'Cambia il progetto',
    design: 'Le tue scelte',
    conditions: 'Condizioni della prova',
    whatFollows: 'Valori ricavati',
    advanced: 'Altri controlli',
    advancedError:
      'Queste cambiano l’errore, non la risposta. Di quanto la cambiano è ciò che misura il pannello dei controlli.',
    solverLabel: 'Calcolo',
    checkingServer: 'Verifica di che cosa sa fare questo server…',
    run: 'Calcola',
    cancel: 'Annulla',
    keep: 'Salva tentativo',
    compare: 'Confronta tentativi',
    answer: 'Com’è andata',
    everyQuantity: 'Tutti i risultati',
    trust: 'Il risultato è credibile?',
    checks: 'Controlli numerici e limiti',
    cost: 'Dettagli del calcolo',
    keptRuns: 'I tuoi tentativi',
    exportCsv: 'Esporta CSV',
    exportJson: 'Esporta JSON',
    deleteAll: 'Elimina tutto',
    why: 'Perché succede',
    lesson: 'Dettagli del modello',
    lessonLead:
      'Formule, condizioni al contorno, controlli ed esportazione. Non serve leggerli per giocare: servono quando vuoi sapere come è stato calcolato.',
    maintenance:
      'Il laboratorio non accetta nuove simulazioni in questo momento. Puoi comunque leggere la sfida, {alternative} e guardare i tentativi che hai salvato.',
  },

  /* -------------------------------------------------------------------- il profilo alare */

  airfoil: {
    /* Gli obiettivi come li legge uno studente. §2.4: prima il significato, poi il simbolo. */
    goal: {
      lift: 'Portanza: 800 N per metro, con uno scarto del 2 %',
      twist: 'Tendenza a ruotare: sotto il limite',
    },
    /* I tre risultati principali (§7.5) e i suggerimenti dopo un tentativo fallito (§7.7). */
    headline: {
      lift: 'Portanza',
      perMetre: 'N per metro',
      liftHint: 'Portanza per metro di apertura, dalla pressione integrata su tutta la superficie.',
      twist: 'Tendenza a ruotare',
      twistHint:
        'Momento di beccheggio rispetto al quarto di corda, rispetto al limite della sfida.',
      noseDown: 'Tende a ruotare verso il basso.',
      noseUp: 'Tende a ruotare verso l’alto.',
      suction: 'Pressione più severa',
      suctionNote: 'Non è un obiettivo. Dice quanto sono concentrate le variazioni di pressione.',
      suctionHint: 'Il coefficiente di pressione più basso su tutta la superficie.',
    },
    hint: {
      lowLift: 'La portanza è bassa. Cambia prima l’angolo e lascia fermo il profilo.',
      highLift:
        'La portanza è oltre l’obiettivo. Riduci l’angolo e osserva come cambia la pressione.',
      moment:
        'La portanza va bene, ma il profilo tende a ruotare troppo. Prova una forma meno curva.',
      outside: 'Il calcolo continua, ma a questo angolo un flusso reale potrebbe separarsi.',
    },
    figures: {
      flowAria: 'Una sezione alare con l’aria che le scorre attorno',
      sliceAria: 'Una fetta tagliata da un’ala, che lascia una sezione',
      nacaAria: 'Le parti che un numero NACA a quattro cifre nomina',
      faster: 'più veloce · pressione più bassa',
      slower: 'più lenta · pressione più alta',
      oneSlice: 'una fetta',
      perMetre: 'e tutto è per metro di apertura',
      chord: 'la corda',
      firstDigit: '2 % di curvatura',
      secondDigit: '40 % indietro',
      lastTwo: '12 % di spessore',
      nose: 'naso',
      tail: 'coda',
    },
    title: 'Trova l’assetto dell’ala — Spoon Physics',
    description:
      'Una sfida di fisica: scegli il profilo, regola l’angolo e fai sostenere all’ala la portanza richiesta senza farla ruotare troppo. Prima prevedi, poi calcola e confronta i tentativi.',
    eyebrow: 'Profilo, angolo e distribuzione di pressione',
    heading: 'Trova l’assetto dell’ala',
    editorAria: 'Profilo alare: punti di controllo trascinabili',
    profile: 'Profilo',
    editShape: 'Modifica forma',
    doneEditing: 'Fine modifica',
    resetProfile: 'Reimposta profilo',
    fitProfile: 'Inquadra il profilo',
    custom: 'Personalizzato',
    customDragged: 'Personalizzato (trascinato)',
    studyHeading: 'Studio',
    studyLead:
      'Una sola incidenza, o una scansione. La scansione è l’unico modo per ottenere un centro aerodinamico, e costa una soluzione invece di una per angolo.',
    advancedNote: 'numerica e studio',
    noDrag:
      'Nessuna resistenza e nessuna efficienza: questo modello è non viscoso, quindi entrambe sono nulle e un rapporto fra zeri non è una grandezza. La forza lungo la corda che esce dall’integrazione delle pressioni è nel pannello di verifica, dove le compete — è una barra d’errore.',
    surfacePressure: 'Pressione sulla superficie',
    acrossSweep: 'Lungo la scansione',
    sweepNote:
      'Il centro aerodinamico è la pendenza di regressione del momento di beccheggio rispetto alla portanza, sottratta al quarto di corda. La teoria del profilo sottile dice 0,25; lo spessore lo sposta leggermente all’indietro. L’R² della regressione è mostrato perché una retta attraverso una curva non è un punto.',
    maintenanceAlternative: 'rimodellare il profilo',
    noSolver: 'Questo server non ha alcun solutore capace di imporre una condizione di Kutta.',
    noSolverHere:
      'Questo server non ha alcun solutore che imponga una condizione di Kutta, quindi questo esercizio non può essere eseguito qui.',
    ready: 'Scegli un profilo, fai una previsione e premi Calcola.',
    edited: 'Modificato a mano: il menu dei profili non descrive più questa forma.',
    described:
      '{label} — curvatura {camber} %, al {position} % della corda, spessore {thickness} %.',
    readback:
      'Il solutore ha letto: corda {chord} m, spessore {thickness} %, curvatura {camber} %, {panels} pannelli da {vertices} vertici del contorno.',
    notes: {
      'NACA 0009': 'simmetrico, sottile',
      'NACA 0012': 'simmetrico — la sezione di riferimento',
      'NACA 1408': 'appena curvato, sottile',
      'NACA 1412': 'appena curvato',
      'NACA 2312': 'curvatura molto avanzata',
      'NACA 2412': 'la classica sezione da aviazione generale',
      'NACA 2415': 'stessa linea media, più spesso',
      'NACA 2512': 'curvatura molto arretrata',
      'NACA 4412': 'fortemente curvato',
      'NACA 4415': 'fortemente curvato, spesso',
    },
    shape: {
      camber: 'Curvatura',
      camberTitle: 'Curvatura massima, come frazione della corda. A 0 il profilo è simmetrico.',
      position: 'Posizione della curvatura',
      positionTitle:
        'Dove si trova la curvatura massima lungo la corda — il terzo parametro della serie a quattro cifre.',
      thickness: 'Spessore',
      thicknessTitle: 'Spessore massimo, come frazione della corda.',
      chordUnit: '{value} % della corda',
    },
    params: {
      alpha: 'Angolo d’attacco',
      alphaTitle:
        'Direzione della corrente indisturbata rispetto alla corda. È la corrente a inclinarsi, non il profilo.',
      speed: 'Velocità della corrente',
      speedTitle: 'Velocità indisturbata molto a monte, in m/s.',
      kutta: 'Condizione di Kutta',
      kuttaTitle:
        'Una scelta di modello. Disattivala e la circolazione, e quindi la portanza, è nulla a ogni incidenza — che è ciò che questa pagina calcolava prima di averla.',
      kuttaEnforced: 'imposta (modello portante)',
      kuttaNone: 'nessuna (senza circolazione)',
      panels: 'Pannelli',
      panelsHint: 'Il suo unico effetto legittimo è sui residui di verifica.',
      trailingEdge: 'Bordo d’uscita',
      trailingEdgeHint: 'Una base aperta fa dipendere la condizione di Kutta da come la si chiude.',
      trailingEdgeClosed: 'chiuso',
      trailingEdgeAsDrawn: 'come disegnato',
      resolution: 'Risoluzione del campo',
      resolutionHint: 'Influenza l’immagine e nessun numero riportato.',
      convergence: 'Verifica la convergenza',
      convergenceHint:
        'Risolvi anche col doppio dei pannelli, e riporta di quanto si è spostata la portanza.',
      sweepFrom: 'Scansione da',
      sweepFromHint: 'Lascia vuoto per una sola incidenza.',
      sweepTo: 'Scansione a',
      sweepToHint: 'Fine della scansione.',
      sweepStep: 'Passo della scansione',
      sweepStepHint: 'Ogni angolo in più costa una sostituzione all’indietro, non una soluzione.',
    },
    metrics: {
      cl: 'Coefficiente di portanza',
      clHint: 'Dalla circolazione, via Kutta–Joukowski.',
      lift: 'Portanza per metro di apertura',
      liftShort: 'Portanza per metro',
      liftHint: 'La risposta dimensionale in cui è fissato l’obiettivo.',
      moment: 'Momento di beccheggio',
      momentHint: 'Rispetto al quarto di corda, positivo a cabrare.',
      centre: 'Centro di pressione',
      centreHint: 'Non applicabile quando la forza normale è troppo piccola per collocarlo.',
      centreAbsent: 'qui non è definito',
      peak: 'Picco di depressione',
      peakHint:
        'Quanto forte tira questa forma. Uno strato limite reale potrebbe non sopravvivere a un picco profondo.',
      peakStation: 'Posizione del picco',
      circulation: 'Circolazione',
      incidence: 'Incidenza, come letta',
      incidenceHint:
        'Ricavata dalla corda del contorno stesso, ed è per questo che può differire leggermente dal valore richiesto.',
      aerodynamicCentre: 'Centro aerodinamico',
      aerodynamicCentreAbsent: 'richiede una scansione',
      aerodynamicCentreHint:
        'È una proprietà di più incidenze, quindi una sola soluzione non può produrlo.',
    },
    checks: {
      liftTwoWays: 'Portanza per due vie',
      liftTwoWaysDescribe: 'Circolazione contro pressione integrata.',
      dalembert: 'Residuo di d’Alembert',
      dalembertDescribe:
        'La forza lungo la corda, che deve annullarsi. Una barra d’errore, non una resistenza.',
      convergence: 'Convergenza dei pannelli',
      convergenceDescribe:
        'Variazione del coefficiente di portanza quando si raddoppia il numero di pannelli.',
    },
    fields: {
      cp: 'Coefficiente di pressione, C_p',
      cpHint:
        'Il blu è depressione, il rosso compressione, e C_p = 1 segna il punto di ristagno. Con la condizione di Kutta imposta la depressione sul dorso non si annulla più — quella è la portanza. Le curve bianche sottili sono isolinee di C_p, non linee di corrente: attiva Linee di corrente per vedere il flusso stesso, integrato dal campo di velocità.',
      speed: 'Velocità',
      speedHint: 'Modulo della velocità. Chiaro significa veloce.',
    },
    overlays: {
      profile: 'Profilo',
      chord: 'Corda e c/4',
      chordTitle: 'La corda, e il quarto di corda rispetto a cui si prende il momento',
      stream: 'Corrente indisturbata',
      streamTitle: 'Direzione e velocità del flusso indisturbato',
      centre: 'Centro di pressione',
      centreWhy:
        'La forza normale è troppo piccola per collocare un centro di pressione: qui va davvero all’infinito.',
      resultant: 'Risultante',
      resultantWhy: 'Disegnata nel centro di pressione, che questa prova non ha.',
      resultantTitle: 'La forza aerodinamica, applicata nel centro di pressione',
      peak: 'Picco di depressione',
      ac: 'Centro aerodinamico',
      acWhy:
        'Il centro aerodinamico è una proprietà di più incidenze. Esegui una scansione sotto Avanzate.',
    },
    plots: {
      upper: 'dorso',
      lower: 'ventre',
      cpAxis: 'C_p',
      stationAxis: 'x / c',
      liftTrace: 'coefficiente di portanza',
      momentTrace: 'momento di beccheggio',
      alphaAxis: 'angolo d’attacco, gradi',
      coefficientAxis: 'coefficiente',
      liftSlope: 'Pendenza della curva di portanza',
      slopeMultiple: 'come multiplo di 2π',
      zeroLift: 'Incidenza di portanza nulla',
      aerodynamicCentre: 'Centro aerodinamico',
      fit: 'R² della regressione',
    },
    air: {
      atmosphere: 'Atmosfera',
      atmosphereTitle:
        'La quota fissa insieme temperatura, pressione, densità, viscosità e velocità del suono, perché sono una decisione sola e non cinque.',
      isa: 'Quota ISA',
      manual: 'Inserisci le proprietà dell’aria',
      altitude: 'Quota',
      density: 'Densità',
      viscosity: 'Viscosità',
      soundSpeed: 'Velocità del suono',
      chord: 'Corda',
      temperature: 'Temperatura',
      pressure: 'Pressione',
      dynamicPressure: 'Pressione dinamica',
      reynolds: 'Numero di Reynolds',
      mach: 'Numero di Mach',
    },
    columns: {
      profile: 'Profilo',
      alpha: 'α °',
      panels: 'pannelli',
      consistency: 'coerenza',
    },
  },

  /* ------------------------------------------------------------------ il circuito magnetico */

  solenoid: {
    /* Gli obiettivi come li enuncia chi legge questo laboratorio. */
    goal: {
      flux: 'Flusso: almeno 4,5 mWb per metro',
      drive: 'Amperspire: al massimo 3600',
      leakage: 'Flusso che manca il nucleo: sotto l’1 %',
    },
    /* I tre risultati principali (§7.5) e i suggerimenti dopo un tentativo fallito (§7.7). */
    headline: {
      flux: 'Flusso nel nucleo',
      drive: 'Amperspire',
      driveHint:
        'L’azione magnetomotrice fornita dall’avvolgimento, rispetto al budget di questo laboratorio.',
      leakage: 'Flusso che manca il nucleo',
      leakageHint: 'La quota di flusso che si richiude nell’aria invece che nel ferro.',
    },
    hint: {
      lowFlux:
        'Il flusso è insufficiente e hai ancora margine di amperspire. Guarda quanta parte del percorso è nell’aria.',
      spent:
        'Il budget di amperspire è esaurito. Aggiungere azione magnetomotrice non è più la mossa economica: guarda la geometria.',
      overDrive: 'Il flusso c’è, ma costa più amperspire di quante il budget ne consenta.',
      leakage:
        'Troppa parte del flusso si richiude nell’aria accanto al nucleo invece che attraversarlo.',
      outside: 'Questa configurazione è fuori dai limiti dichiarati dal modello.',
    },
    title: 'Campo magnetico in una sezione 2D — Spoon Physics',
    description:
      'Un laboratorio avanzato: porta il flusso richiesto attraverso un nucleo di ferro con un budget di amperspire, e guarda quanto se ne disperde nell’aria. Pensato per chi conosce già flusso e circuiti magnetici.',
    eyebrow: 'Laboratorio avanzato · flusso, dispersione e percorso nel ferro',
    heading: 'Campo magnetico in una sezione 2D',
    schematicTitle: 'Sezione del solenoide: nucleo di ferro fra due avvolgimenti',
    legendCore: 'nucleo di ferro',
    legendWinding: 'avvolgimento',
    legendAir: 'aria',
    resetGeometry: 'Reimposta geometria',
    fitMagnet: 'Inquadra il magnete',
    advancedNote: 'numerica',
    noStudy:
      'Qui non c’è un gruppo Studio, perché nessuna grandezza riportata da questo esercizio richiede più di una soluzione. La forza al traferro la richiederebbe — e non è riportata per una ragione che con gli studi non c’entra: questa sezione è simmetrica, quindi la sua forza netta è esattamente zero.',
    noPeak:
      'Nessuna densità di flusso di picco: gli spigoli del nucleo sono singolarità della soluzione esatta, quindi un massimo puntuale cresce a ogni raffinamento invece di convergere. Tutto ciò che è qui sopra è un integrale — un flusso, una media di sezione, un’energia — in cui una singolarità non pesa. Nemmeno una forza al traferro: un nucleo a barra simmetrico ne sente esattamente zero.',
    midPlane: 'Lungo il piano mediano del nucleo',
    maintenanceAlternative: 'cambiare la sezione',
    noSolver: 'Questo server non ha alcun solutore che riporti grandezze magnetiche.',
    noSolverHere:
      'Questo server non ha alcun solutore che riporti grandezze magnetiche, quindi questo esercizio non può essere eseguito qui.',
    ready: 'Premi Calcola per risolvere la sezione così com’è.',
    described:
      'Nucleo da {core} mm in un alesaggio da {bore} mm, {winding} mm di avvolgimento, lungo {length} mm. μᵣ = {permeability}, e {turns} amperspire per lato. Risolto in una finestra da {window} mm, troppo grande per essere disegnata qui.',
    shapeLabel: 'nucleo {core}×{length}, avvolgimento {winding} mm a {gap} mm',
    design: {
      coreHalfWidth: 'Semilarghezza del nucleo',
      coreHalfWidthTitle:
        'Metà dello spessore della barra di ferro centrale. Fissa l’area attraverso cui il flusso deve passare, quindi muove la densità di flusso più del flusso.',
      gap: 'Intercapedine d’aria',
      gapTitle:
        'Distanza fra il nucleo e l’avvolgimento — lo spazio che prendono isolanti e supporti. È ciò con cui si paga la dispersione: un’intercapedine stretta tiene il campo del rame dentro il ferro.',
      winding: 'Spessore dell’avvolgimento',
      windingTitle: 'Quanto il rame si estende verso l’esterno. Più avvolgimento, più amperspire.',
      halfHeight: 'Semialtezza',
      halfHeightTitle:
        'Metà della lunghezza del nucleo e della bobina, lungo l’asse. Compra amperspire e accorcia il percorso di ritorno rispetto al magnete, ed è di solito la leva più efficace di questa pagina.',
      permeability: 'Permeabilità del nucleo μᵣ',
      permeabilityTitle:
        'Quanto più facilmente il nucleo porta flusso rispetto all’aria. 1 significa nessun nucleo; il ferro sta fra 10³ e 10⁴. Oltre circa 1000 smette di aiutare, perché il flusso deve comunque tornare attraverso l’aria.',
      currentDensity: 'Densità di corrente',
      currentDensityTitle:
        'Corrente per unità di area di rame. Intorno a 5 A/mm² è un avvolgimento raffreddato in modo convenzionale. Il modello è lineare, quindi questo scala esattamente ogni campo.',
    },
    params: {
      cells: 'Celle attraverso il magnete',
      cellsHint:
        'Attraverso le regioni, non la finestra — così allargare la finestra non infittisce meno il ferro.',
      convergence: 'Verifica la convergenza',
      convergenceHint:
        'Risolvi anche al doppio della risoluzione, e riporta di quanto si è spostata la densità di flusso.',
      growth: 'Crescita nel campo lontano',
      growthHint:
        'Quanto in fretta crescono le celle nell’aria. 1,0 è una griglia uniforme, e costosa.',
      iterations: 'Tetto di iterazioni',
      iterationsHint:
        'Un contrasto di permeabilità di quattro decadi ha bisogno di spazio. Alzalo se un calcolo si ferma prima.',
      resolution: 'Risoluzione del campo',
      resolutionHint: 'Influenza l’immagine e nessun numero riportato.',
      output: 'Tipo di risultato',
      outputHint:
        'La mesh mostra le celle adattate alle interfacce; la griglia è un loro ricampionamento.',
      outputGrid: 'griglia regolare',
      outputMesh: 'le celle del solutore',
    },
    metrics: {
      flux: 'Flusso nel nucleo',
      fluxHint:
        'Per metro di profondità, attraverso il piano mediano del nucleo. Negativo perché lo attraversa verso il basso — il segno è il verso dell’avvolgimento, e la missione è fissata sul modulo.',
      fluxAbsHint: 'Il modulo, su cui è fissata la missione. Il valore con segno è in tabella.',
      meanDensity: 'Densità di flusso media',
      meanDensityHint: 'Il flusso nel nucleo diviso la larghezza del nucleo, al piano mediano.',
      busiest: 'Sezione più impegnata',
      busiestHint:
        'La stessa grandezza a ogni altezza lungo il nucleo, massimizzata. È questa che satura, ed è una media di sezione e non un picco, di proposito.',
      leakage: 'Dispersione',
      leakageHint:
        'La quota del flusso che attraversa il piano mediano mancando il ferro, misurata rispetto all’intero fascio.',
      ampereTurns: 'Amperspire',
      ampereTurnsHint:
        'Attraverso un lato dell’avvolgimento. Esatte — una proprietà della geometria, che non richiede alcun calcolo.',
      energy: 'Energia immagazzinata',
      energyHint:
        'Dentro la finestra modellata, per metro di profondità. Limitata dalla finestra e non dallo spazio.',
      permeance: 'Permeanza',
      permeanceHint:
        'La cifra di merito del circuito magnetico. Moltiplicala per il quadrato delle spire e per la profondità reale per ottenere un’induttanza.',
      bundle: 'Fascio di flusso totale',
      bundleHint:
        'Tutto ciò che attraversa il piano mediano in un verso, nucleo e aria insieme. La dispersione è misurata rispetto a questo.',
      netCurrent: 'Corrente netta',
      netCurrentHint:
        'Zero per una bobina. Qualsiasi altra cosa è un filo, il cui campo lontano la finestra modellata non può contenere.',
      noCore: 'nessun nucleo in questa geometria',
    },
    checks: {
      energy: 'Energia per due vie',
      energyDescribe:
        'Energia dal campo contro energia dalle sorgenti. Uguali per un mezzo lineare.',
      flux: 'Flusso nel nucleo per due vie',
      fluxDescribe:
        'La caduta di A_z attraverso il nucleo contro l’integrale di B lungo la stessa linea.',
      ampere: 'Legge di Ampère',
      ampereDescribe:
        'H·dl lungo un contorno nell’aria contro la corrente che quel contorno racchiude.',
      mesh: 'Convergenza della mesh',
      meshDescribe: 'Variazione della densità di flusso media quando si raddoppia la risoluzione.',
      linear: 'Soluzione lineare',
      linearDescribe:
        'Fin dove è arrivata la soluzione a gradiente coniugato, rispetto a quanto le era stato chiesto.',
    },
    fields: {
      b: 'Densità di flusso, |B|',
      bHint:
        'Densità di flusso, in tesla — ciò che misura una sonda di Hall o un gaussmetro. Il chiaro è dove il flusso è concentrato. Passa ad A per vedere le linee di campo lungo cui corre, oppure attiva Linee di corrente: questo solutore pubblica B come vettore, quindi sono integrate e non disegnate.',
      a: 'Potenziale vettore, A_z (linee di campo)',
      aHint:
        'Potenziale vettore A_z, la grandezza effettivamente risolta. Le sue isolinee sono le linee di campo magnetico: linee fitte significano B intenso, e il flusso fra due qualsiasi di esse è lo stesso lungo tutta la loro estensione. Ogni flusso riportato da questa pagina è una differenza di questo campo fra due punti.',
      h: 'Intensità di campo, H',
      hHint:
        'Intensità di campo, H = |B| / (μ₀ μᵣ), qui derivata e non risolta. Confrontala con |B| dentro il nucleo: lì B è grande e H è piccolo, ed è questo che significa un’alta permeabilità.',
      mu: 'Mappa dei materiali, μᵣ',
      muHint:
        'Non un risultato ma un controllo: dove il solutore ha messo il ferro. Ogni confine fra materiali è una faccia di cella e non una scalinata, ed è questo che rende il nucleo largo esattamente quanto è stato disegnato.',
    },
    overlays: {
      regions: 'Nucleo e avvolgimenti',
      axis: 'Assi',
      plane: 'Superficie di flusso',
      planeWhy: 'Questa geometria non ha nucleo, quindi non c’è alcuna superficie su cui misurare.',
      planeTitle:
        'Il piano mediano del nucleo: la superficie attraverso cui si misura il flusso nel nucleo',
      bundle: 'Fascio di flusso',
      bundleWhy: 'Questa prova non riporta alcun fascio, quindi la dispersione non è definita.',
      bundleTitle:
        'Dove B_y cambia segno — gli estremi del fascio rispetto a cui si misura la dispersione',
      contour: 'Contorno di Ampère',
      contourTitle: 'Il percorso chiuso lungo cui si integra H·dl, e l’avvolgimento che racchiude',
    },
    derived: {
      ampereTurns: 'Amperspire per lato',
      coreWidth: 'Larghezza del nucleo',
      copper: 'Sezione di rame',
      window: 'Finestra modellata',
      windowValue: '{size} mm di lato, {ratio}× il magnete',
      permeability: 'Permeabilità del nucleo',
    },
    plots: {
      xAxis: 'x, mm',
      fluxAxis: 'B_y, T',
      potentialAxis: 'A_z, Wb/m',
      core: 'nucleo',
      bundle: 'fascio',
      leakageShare: 'La dispersione è uno meno il loro rapporto — {value} % in questa prova.',
      noBundle:
        'In questa prova nessun flusso attraversa questo piano in alcun verso, quindi non c’è un fascio di cui il flusso nel nucleo sia una quota, e nessuna dispersione viene riportata.',
      note: 'La coppia interna di riferimenti è il nucleo, quella esterna è dove B_y cambia segno. La caduta di A_z fra i riferimenti interni è il flusso nel nucleo; fra quelli esterni, l’intero fascio. {share} I riferimenti esterni stanno dove B_y passa per zero, ed è questo che rende quella superficie — e quindi la dispersione — insensibile a dove esattamente la si mette. Mostrato fino a ±{limit} mm; il calcolo arriva a ±{window} mm, dove A_z raggiunge lo zero imposto dalla condizione al contorno.',
      noCoreNote:
        'Niente in questa geometria è magnetico, quindi non c’è flusso nel nucleo da segnare né dispersione da misurare. Le curve sono comunque il campo lungo la stessa linea.',
    },
    columns: {
      section: 'Sezione',
      leakage: 'dispersione',
      cells: 'celle/magnete',
      energy: 'controllo energia',
    },
  },

  /* ------------------------------------------------------------------------------ il ponte */

  truss: {
    /* Gli obiettivi come li legge uno studente. §2.4: prima il significato, poi il simbolo. */
    goal: {
      capacity: 'Nessuna asta oltre il 100 % della propria capacità',
      steel: 'Acciaio: al massimo 2400 kg',
      sag: 'Abbassamento: al massimo 30 mm',
    },
    /* I tre risultati principali (§7.5) e i suggerimenti dopo un tentativo fallito (§7.7). */
    headline: {
      worst: 'Asta più impegnata',
      worstHint: 'L’asta più sollecitata, come quota di ciò che quell’asta può portare.',
      steel: 'Acciaio usato',
      steelHint: 'Massa totale del traliccio, peso proprio compreso.',
      sag: 'Abbassamento massimo',
      sagHint: 'Detto anche freccia: lo spostamento verticale massimo di un nodo.',
    },
    hint: {
      compression:
        'La prima asta a cedere è lunga e compressa. Accorciarla può valere più che rendere tutto il ponte più pesante.',
      tension:
        'Questa asta supera la capacità a trazione. Aumenta la sezione o ridistribuisci il percorso del carico.',
      mass: 'Il ponte regge, ma usa {excess} kg di acciaio oltre il budget. Cerca aste poco impegnate.',
      sag: 'Non cede, ma si abbassa troppo. Aumentare l’altezza del traliccio può ridurre le forze nei correnti.',
      outside:
        'O la struttura può muoversi senza allungare le aste, oppure è uscita dal campo dei piccoli spostamenti.',
    },
    title: 'Costruisci un ponte che regga — Spoon Physics',
    description:
      'Una sfida di fisica: disegna un ponte di 24 metri, porta il traffico entro un budget di acciaio e scopri quale asta cede per prima. Provaci a indovinare prima di calcolare.',
    eyebrow: 'Geometria, compressione e uso dell’acciaio',
    heading: 'Costruisci un ponte che regga',
    buildTools: 'Strumenti di costruzione',
    stageAria: 'La travatura e ciò che porta. Trascina per spostare, più e meno per ingrandire.',
    builderAria: 'Costruttore di ponti. Aggiungi nodi e aste, posiziona vincoli e carichi.',
    designLead:
      'Premi <strong>Costruisci</strong> sopra il sito per disporre la travatura: aggiungi nodi, uniscili con aste, e metti i vincoli dove il terreno può reggere una reazione.',
    startFrom: 'Parti da',
    startingLattice: 'Travatura di partenza',
    undo: 'Annulla',
    resetLattice: 'Reimposta travatura',
    advancedNote: 'presentazione',
    advancedLead:
      'Qui non c’è dimensione di mesh, né tolleranza, né numero di iterazioni, quindi non c’è nemmeno uno studio di convergenza. Una travatura a nodi cerniera <em>è</em> la propria discretizzazione: un elemento per asta, risolto una volta sola. L’unica impostazione rimasta è quanto larghe si disegnano le aste.',
    noBending:
      'Nessun momento flettente e nessuna tensione nei nodi: qui ogni nodo è una cerniera priva di attrito, quindi un’asta porta forza lungo sé stessa e nient’altro. Un fazzoletto di nodo reale porta un po’ di momento, che irrigidisce la travatura e mette flessione nei correnti — un modello diverso, e non questo.',
    memberByMember: 'Asta per asta',
    fitBridge: 'Inquadra il ponte',
    build: 'Costruisci',
    buildTitle: 'Disponi la travatura: nodi, aste, vincoli e carichi',
    maintenanceAlternative: 'costruire una travatura',
    noSolver: 'Questo server non ha alcun solutore che risolva una travatura reticolare.',
    noSolverHere:
      'Questo server non ha alcun solutore che risolva una travatura reticolare, quindi questo esercizio non può essere eseguito qui.',
    ready: 'Premi Calcola per risolvere la travatura così com’è.',
    presets: {
      'warren-8': 'Warren, 8 campi, 3 m di altezza',
      'warren-10': 'Warren, 10 campi, 3 m di altezza',
      'warren-6-deep': 'Warren, 6 campi, 4,5 m di altezza',
      'pratt-8': 'Pratt, 8 campi, 3 m di altezza',
      deck: 'Il solo impalcato (crolla)',
      empty: 'Niente — parti dal terreno nudo',
    },
    loads: {
      deck: 'Traffico sull’impalcato',
      deckTitle:
        'Un carico per unità di lunghezza lungo la carreggiata, portato da ogni asta con entrambi gli estremi a livello dell’impalcato e ripartito per metà su ciascun estremo. È il carico della missione; gli obiettivi sono fissati su di esso.',
      point: 'Un carico concentrato',
      pointTitle:
        'Quanto pesa ciascun carico che posizioni con lo strumento Carico. Posto su un nodo, diventa una forza verticale su un contorno che nomina quel solo nodo.',
      wind: 'Carico laterale sulla travatura',
      windTitle:
        'Un totale orizzontale, ripartito in parti uguali fra tutti i nodi sopra l’impalcato. Deve raggiungere le spalle attraverso la travatura, che è un viaggio diverso da quello verticale.',
    },
    params: {
      area: 'Sezione delle aste',
      areaHint:
        'Ogni asta, in m². Il carico critico va col suo quadrato, quindi è la leva più forte della pagina — e la più costosa.',
      selfWeight: 'Porta il proprio peso',
      selfWeightHint:
        'Il peso di ogni asta, metà per estremo. Trascurarlo favorisce proprio i progetti che aggiungono materiale.',
      safety: 'Coefficiente di sicurezza',
      safetyHint:
        'La capacità è divisa per questo prima di calcolare lo sfruttamento. 1,0 riporta il rapporto di rottura nudo.',
      yield: 'Tensione di snervamento',
      yieldHint:
        '250 MPa è il comune acciaio da carpenteria. Fissa la capacità a trazione; a compressione decide di solito l’instabilità.',
      modulus: 'Modulo elastico',
      modulusHint:
        '210 GPa per l’acciaio. Fissa la freccia e il carico critico, e nemmeno una forza d’asta in una travatura isostatica.',
      density: 'Densità',
      densityHint:
        '7850 kg/m³ per l’acciaio. Decide la massa, che è ciò su cui è fissato il budget.',
      barWidth: 'Larghezza di disegno delle aste',
      barWidthHint:
        'Quanto larghe si disegnano le aste, in metri. Zero la ricava dal sito. Un’asta reale da 2600 mm² è larga 58 mm, che su una luce di 24 m è invisibile.',
    },
    metrics: {
      worst: 'Asta più sollecitata',
      worstHint:
        'Forza su capacità per l’asta più impegnata: snervamento a trazione, il minore fra snervamento e instabilità euleriana a compressione, entrambi divisi per il coefficiente di sicurezza. Uno è il limite.',
      spanRatio: 'Freccia sulla luce',
      spanRatioHint:
        'Il massimo spostamento di un nodo diviso la distanza fra i vincoli — la forma in cui è scritto un limite di esercizio.',
      deflection: 'Freccia massima',
      deflectionShort: 'Freccia',
      deflectionHint:
        'Di quanto si sposta il nodo che si sposta di più. Dove si sposta è disegnato sul campo dal livello Deformata.',
      deflectionAbsent: 'non si sposta',
      mass: 'Acciaio impiegato',
      massHint:
        'Densità per area per lunghezza, sommata su ogni asta. Il budget su cui è fissata la missione.',
      carried: 'Portato per chilogrammo',
      carriedShort: 'Portato per kg',
      carriedHint:
        'Il carico imposto diviso la massa di acciaio. Il peso proprio non è al numeratore: un ponte non è pagato per portare sé stesso.',
      buckling: 'Margine di instabilità',
      bucklingHint:
        'Il carico critico euleriano sulla forza effettivamente portata, per l’asta compressa più sollecitata. Sotto uno se n’è andata. Assente quando nulla è compresso.',
      bucklingAbsent: 'nulla è compresso',
      compression: 'Compressione massima',
      compressionHint:
        'Come numero positivo. Leggila accanto al margine di instabilità, non accanto alla trazione.',
      tension: 'Trazione massima',
      tensionHint:
        'Il massimo tiro in un’asta. La trazione è la direzione economica: non si instabilizza.',
      stress: 'Tensione assiale di picco',
      stressHint:
        'Il massimo modulo di tensione ovunque, a trazione o a compressione. Confrontalo con la tensione di snervamento.',
      reaction: 'Reazione massima',
      reactionHint:
        'Per quanto va dimensionata la spalla più impegnata. Il ponte vale quanto il terreno sotto di esso.',
    },
    checks: {
      joints: 'Il metodo dei nodi',
      jointsDescribe:
        'In ogni nodo libero, le forze delle aste e il carico applicato devono sommarsi a zero. Calcolato dalle sole forze d’asta e dalla geometria — non tocca mai la matrice di rigidezza.',
      force: 'Equilibrio alla traslazione',
      forceDescribe:
        'Tutto ciò che è applicato più tutto ciò con cui i vincoli hanno reagito fa zero.',
      moment: 'Equilibrio alla rotazione',
      momentDescribe:
        'Lo stesso rispetto all’origine — che coglie una reazione della giusta intensità nel posto sbagliato, dove l’equilibrio alla traslazione non può.',
      energy: 'Energia per due vie',
      energyDescribe:
        'Energia di deformazione sommata sulle aste contro il lavoro compiuto dal carico sui nodi. Uguali per una struttura lineare, per due vie che non condividono alcun conto.',
      linear: 'La soluzione lineare',
      linearDescribe: 'Fin dove è arrivata davvero la soluzione diretta di K u = f.',
    },
    fields: {
      utilisation: 'Sfruttamento, η',
      utilisationHint:
        'Forza su capacità, asta per asta. Tutto ciò che raggiunge 1 è esaurito — a compressione di solito per instabilità euleriana e non per snervamento, ed è per questo che una diagonale lunga si accende molto prima di una corta che porta la stessa forza.',
      force: 'Forza assiale, N',
      forceHint:
        'Positivo è trazione, negativo compressione. Segui il segno lungo i correnti: in una travatura appoggiata quello inferiore è tirato e quello superiore compresso, e le diagonali si alternano mentre portano il taglio verso i vincoli.',
      stress: 'Tensione assiale, MPa',
      stressHint:
        'Le stesse forze divise per la sezione, in megapascal, così da poterle confrontare direttamente con la tensione di snervamento. Nota quanto di rado è il numero che decide qualcosa: le aste compresse si perdono per instabilità a una frazione dello snervamento.',
    },
    tools: {
      move: 'Sposta',
      moveHint: 'Trascina un nodo. Tutto ciò che vi è attaccato lo segue.',
      joint: 'Nodo',
      jointHint: 'Clicca ovunque per aggiungere un nodo.',
      bar: 'Asta',
      barHint: 'Clicca un nodo, poi un altro, per unirli con un’asta.',
      support: 'Vincolo',
      supportHint:
        'Clicca un nodo per farlo ciclare: cerniera, carrello, libero. La cerniera tiene in entrambe le direzioni; il carrello lo tiene solo su.',
      load: 'Carico',
      loadHint: 'Clicca un nodo per posarvi il carico, o per toglierlo di nuovo.',
      erase: 'Cancella',
      eraseHint: 'Clicca un nodo o un’asta per rimuoverlo.',
      pressBuild: 'Premi Costruisci per disporre la travatura.',
      outsideBuild:
        'La travatura è mostrata sopra il campo in modalità Costruisci, dove il puntatore appartiene al costruttore e non alla vista.',
    },
    overlays: {
      lattice: 'La travatura',
      deformed: 'Deformata',
      deformedScaled: 'Deformata ×{factor}',
      deformedTitle: 'Dove è andato ogni nodo, amplificato finché lo spostamento maggiore si vede',
      worst: 'Asta più sollecitata',
      worstTitle: 'L’asta da cui dipende la missione',
      loads: 'Carichi e vincoli',
    },
    site: {
      keepClear: 'zona libera',
      ground: 'terreno',
    },
    readiness: {
      nothingBuilt: 'Non è ancora costruito niente. Aggiungi qualche asta.',
      nothingHolds: 'Niente lo regge. Metti un vincolo su un nodo che le aste raggiungono.',
      noDeck:
        'Il carico da traffico corre lungo l’impalcato, e nessuna asta ha entrambi gli estremi su di esso. Costruisci la carreggiata, oppure porta a zero il carico sull’impalcato.',
      strayLoad:
        'Un carico sta sul nodo {index}, che nessuna asta raggiunge, quindi non ha dove andare.',
      noLoad: 'Niente lo carica. Aggiungi un carico sull’impalcato, oppure posane uno su un nodo.',
    },
    lattice: {
      counts: '{joints} nodi, {bars} aste.',
      supports: '{pinned} su cerniera, {rollers} su carrello.',
      dropped: '{count} carico/hi concentrato/i posizionato/i.',
      stray: '{count} nodo/i non raggiunto/i da alcuna asta — resta/no fuori dal calcolo.',
    },
    derived: {
      totalLength: 'Lunghezza totale delle aste',
      longest: 'Asta più lunga',
      steel: 'Acciaio, prima del calcolo',
      imposed: 'Carico verticale imposto',
      euler: 'Carico euleriano dell’asta più lunga',
    },
    boundaries: {
      deck: 'La carreggiata: ogni nodo a livello dell’impalcato, e le aste fra di essi.',
      support: 'Il terreno sotto il nodo {index}.',
      load: 'Nodo {index}, dove è stato posto un carico.',
      aboveDeck: 'Tutto ciò che il vento può raggiungere: ogni nodo sopra la carreggiata.',
    },
    members: {
      bar: 'asta',
      force: 'forza kN',
      length: 'lunghezza m',
      utilisation: 'sfruttamento',
      limitedBy: 'limitata da',
      yield: 'snervamento',
      buckling: 'instabilità',
      ladderTrace: 'η',
      ladderX: 'aste, dalla più sollecitata',
      ladderY: 'sfruttamento η',
      capacity: 'capacità',
      note: 'Le otto aste più impegnate. L’asta {index} è quella da cui dipende la missione, ed è segnata sul campo dal livello Asta più sollecitata. Un’asta limitata dall’instabilità è quella il cui carico euleriano sta sotto il suo carico di schiacciamento — accorciarla aiuta col quadrato della lunghezza, dove ispessirla aiuta col quadrato dell’area.',
    },
    shapeLabel: '{bars} aste, {depth} m di altezza',
    loadedRun: 'Caricato il tentativo {label}. Premi Calcola per ricalcolarlo.',
    columns: {
      lattice: 'Travatura',
      mass: 'massa kg',
      area: 'A m²',
      deck: 'impalcato kN/m',
      joint: 'controllo nodi',
    },
  },
  heatsink: {
    /* Gli obiettivi come li legge uno studente. §2.4: prima il significato, poi il simbolo. */
    goal: {
      temperature: 'Temperatura: al massimo 95 °C',
      aluminium: 'Alluminio: al massimo 170 g',
    },
    /* I tre risultati principali (§7.5) e i suggerimenti dopo un tentativo fallito (§7.7). */
    headline: {
      temperature: 'Temperatura massima',
      temperatureHint:
        'Il punto più caldo del metallo — il numero su cui si legge la specifica di un componente.',
      aluminium: 'Alluminio usato',
      aluminiumHint: 'Massa dell’intera estrusione sulla lunghezza dichiarata.',
      channel: 'Spazio fra le alette',
      channelNote: 'Non è un obiettivo. Canali stretti rendono più difficile la salita dell’aria.',
      channelHint:
        'Larghezza libera di un canale, ed è su questa che viene valutata la correlazione di convezione.',
    },
    hint: {
      choked:
        'Hai aggiunto superficie, ma lo spazio per l’aria è sceso a {channel} mm. Prova a togliere qualche aletta.',
      room: 'Hai ancora {margin} g disponibili. Prova ad aumentare una sola dimensione delle alette.',
      hot: 'La temperatura è troppo alta e non resta massa. Deve cambiare qualcosa di diverso da altro metallo.',
      heavy:
        'La temperatura va bene, ma usi {excess} g oltre il budget. Cerca alette che aggiungono massa più rapidamente di quanto riducano la temperatura.',
      outside:
        'La geometria è fuori dall’intervallo su cui è tarata la correlazione di convezione.',
    },
    title: 'Quante alette servono davvero? — Spoon Physics',
    description:
      'Una sfida di fisica: tieni fresco un componente da 30 W con un budget di massa, e trova il numero di alette oltre il quale aggiungerne peggiora le cose. Prova a prevedere dove sta l’ottimo prima di calcolarlo.',
    eyebrow: 'Superficie, passaggio dell’aria e massa',
    heading: 'Quante alette servono davvero?',
    schematicTitle: "Sezione del dissipatore: base alettata con sotto l'impronta del componente",
    legendMetal: 'alluminio',
    legendAir: 'aria',
    legendFootprint: 'impronta del componente',
    resetGeometry: 'Ripristina geometria',
    advancedNote: 'numerica, e due interruttori di modello',
    switchesNote:
      "Gli ultimi due sono diversi: cambiano il modello, non l'errore. Spegnere l'irraggiamento, o fissare il coefficiente di convezione, serve a vedere cosa ti avrebbe detto il modello più semplice — e ogni run che li usa lo dichiara.",
    twoPaths:
      "La quota radiativa e il fattore di vista verso la stanza sono riportati insieme di proposito. Il primo dice quanto vale qui l'irraggiamento; il secondo dice perché. Infittisci le alette e guardali scendere entrambi: le alette aggiunte per aiutare la convezione hanno nascosto il metallo alla stanza.",
    sweepHeading: 'Dove le alette smettono di aiutare',
    sweepLead:
      "Lo stesso dissipatore a ogni numero di alette, tenendo fermo tutto il resto. La resistenza scende finché la superficie aggiunta vince, si appiattisce, e risale quando i canali sono troppo stretti per l'aria e le alette hanno cominciato a farsi ombra a vicenda.",
    runSweep: 'Percorri il numero di alette',
    sweepIdle:
      'Ancora nessuna scansione. Una sola soluzione non può mostrare un punto di inversione.',
    sweepNote:
      "Migliore a {best} alette — {value} K/W, contro {worst} K/W all'estremo affollato. Entrambe le strade del calore si indeboliscono quando il canale si stringe, e la curva gira dove la loro perdita supera l'area guadagnata.",
    sweepEdge:
      "Il minimo cade al bordo dell'intervallo percorso, quindi il punto di inversione è fuori. Cambia altezza o spessore delle alette e riprova.",
    shapeNote: 'Canale {channel} mm · circa {mass} g di alluminio.',
    shapeOverlap:
      '{count} alette di questo spessore non ci stanno sui 60 mm di base — si sovrapporrebbero. Assottigliale o riducine il numero.',
    ready: 'Pronto. Premi Calcola.',
    noSolver: 'Su questo server non è disponibile nessun solutore per dissipatori.',
    noSolverHere:
      'Questo server non ha un solutore per dissipatori, quindi qui non si può eseguire nulla.',
    maintenanceAlternative: 'la specifica, che riporta per intero il modello e ogni verifica',
    design: {
      finCount: 'Alette',
      finCountTitle:
        "Quante alette sulla base. L'unico controllo che ha un valore migliore invece di una direzione.",
      finHeight: 'Altezza aletta',
      finHeightTitle:
        'Alette più alte aggiungono superficie, e perdono efficienza quando il metallo fatica a tenere la punta calda quanto la radice.',
      finThickness: 'Spessore aletta',
      finThicknessTitle:
        "Alette più spesse conducono meglio e pesano di più, e mangiano il canale in cui deve passare l'aria.",
      baseThickness: 'Spessore base',
      baseThicknessTitle:
        'Distribuisce lateralmente il calore del componente prima che raggiunga le alette. Costa poco in resistenza e molto in massa.',
      power: 'Potenza del componente',
      powerTitle: "Quello che il componente dissipa, distribuito uniformemente lungo l'estrusione.",
      ambient: 'Ambiente',
      ambientTitle: "Temperatura dell'aria, e della stanza verso cui il dissipatore irraggia.",
      footprint: 'Impronta del componente',
      footprintTitle:
        'Larghezza di contatto sotto la base. Un componente più piccolo concentra il flusso.',
      finish: 'Finitura superficiale',
      finishHint:
        "Fissa l'emissività. Sedici volte dal grezzo all'anodizzato nero, senza un grammo di metallo — ma vale molto meno su un dissipatore fitto, dove le alette hanno nascosto la superficie alla stanza.",
      cooling: 'Raffreddamento',
      coolingHint:
        "Aria ferma, o una ventola lungo l'estrusione. Il numero di alette migliore non è lo stesso.",
      velocity: "Velocità dell'aria",
      velocityTitle: 'Velocità frontale lungo i canali.',
      flush: 'Montato a contatto',
      flushHint:
        'Con la faccia inferiore bloccata dal montaggio, non perde nulla da lì. Senza spunta, la base raffredda anche di sotto.',
    },
    finish: {
      mill: 'Grezzo di laminazione (ε ≈ 0,05)',
      clear_anodised: 'Anodizzato neutro (ε ≈ 0,6)',
      black_anodised: 'Anodizzato nero (ε ≈ 0,8)',
    },
    cooling: {
      natural: 'Convezione naturale',
      forced: 'Forzata — una ventola',
    },
    derived: {
      channel: 'Canale fra le alette',
      area: 'Superficie esposta',
      mass: 'Alluminio',
      flux: 'Flusso sotto il componente',
    },
    params: {
      cellSize: 'Cella di griglia',
      radiation: 'Irraggiamento attivo',
      hOverride: 'Fissa il coefficiente',
    },
    metrics: {
      tMax: 'Temperatura massima',
      tRise: "Salita sull'ambiente",
      resistance: 'Resistenza termica',
      mass: 'Massa',
      score: 'Resistenza × massa',
      efficiency: "Efficienza d'aletta",
      radiative: 'Quota radiativa',
      viewFactor: 'Fattore di vista verso la stanza',
      h: 'Coefficiente di convezione',
      flux: 'Flusso conduttivo massimo',
    },
    checks: {
      energy: 'Bilancio energetico',
      energyTitle:
        "Quello che il componente ha immesso, contro convezione più irraggiamento in uscita su tutto il bordo esposto. Anche l'irraggiamento disperso in una cavità mal formata uscirebbe da questo numero.",
    },
    fields: {
      temperature: 'Temperatura',
      temperatureHint:
        "Solo il metallo. L'aria non è mai stata risolta, ed è mascherata invece che disegnata a un valore convenzionale.",
      flux: 'Flusso conduttivo',
      fluxHint:
        "k|grad T| dentro il metallo — dove si infittisce è dove il metallo sta lavorando, ed è lì che conviene ispessire un'aletta.",
    },
    fitProfile: 'Inquadra il profilo',
    columns: {
      profile: 'profilo',
      mass: 'massa kg',
      radiative: 'quota rad.',
      energy: 'energia',
    },
    shapeLabel: '{fins} alette · alte {height} mm · spesse {thickness} mm · base {base} mm',
    plots: {
      finCount: 'alette',
      resistance: 'R_θ (K/W)',
      radiative: 'quota radiativa',
      best: 'migliore',
    },
  },
};
