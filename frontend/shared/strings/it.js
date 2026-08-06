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
    tagline: 'Problemi interattivi. Campi calcolati. Risposte verificabili.',
  },

  nav: {
    label: 'Sezioni del laboratorio',
    experiments: 'Esperimenti',
    how: 'Come funziona',
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
    loaded: 'Caricati i dati della prova {label}. Premi Esegui per ricalcolarla.',
  },

  /* -------------------------------------------------------------- i renderer condivisi */

  exercise: {
    notRunYet: 'non ancora calcolato',
    notReported: 'questa prova non lo riporta',
    reading: 'questa prova: {value}',
    metButOutside:
      'I numeri sono quelli giusti, ma il modello è fuori dal proprio campo di validità. ',
    outside: 'Questa prova è fuori dal campo di validità del modello. ',
    limitCrossedOne: 'Il limite superato è',
    limitCrossedMany: 'I limiti superati sono',
    limitCrossedTail:
      ' elencato sotto “Quanto fidarsi”, e una prova che ne supera uno non può centrare l’obiettivo, per quanto buoni sembrino i suoi numeri.',
    didNotVerify: 'Questa prova non ha superato la verifica. ',
    verificationGap:
      'Le due vie indipendenti alla risposta differiscono del {value} %, oltre il {limit} % che questo esercizio richiede. Raffina la discretizzazione ed esegui di nuovo.',
    targetMet: 'Obiettivo centrato. ',
    tryAnother:
      'Salva la prova, poi prova a centrarlo in un altro modo — {next} — e confronta le due.',
    tryAnotherPlain: 'Salva la prova, poi prova a centrarlo in un altro modo e confronta le due.',
    notApplicable: 'non applicabile',
    needs: 'richiede {key}',
    everySolve: 'Calcolato a ogni esecuzione.',
    everyRun: 'Verificato a ogni esecuzione.',
    notRun: 'non eseguito',
    inside: 'Dentro il campo di validità dichiarato. ',
    insideTail:
      'Ogni limite che questo modello dichiara è stato confrontato con questa prova e nessuno è stato superato.',
  },

  runs: {
    none: 'Nessuna prova salvata. Calcola qualcosa e premi Salva risultato — una prova salvata registra ogni dato in ingresso, così può essere ricalcolata e confrontata.',
    select: 'Seleziona questa prova per il confronto',
    load: 'Carica',
    delete: 'Elimina',
    yes: 'sì',
    no: 'no',
    selectTwo: 'Seleziona due o più prove per confrontarle.',
    field: 'Grandezza',
    run: 'Prova {index}',
    differOne: '{differ} grandezza differisce; {same} sono identiche e nascoste.',
    differMany: '{differ} grandezze differiscono; {same} sono identiche e nascoste.',
    blocks: {
      exercise: 'Esercizio',
      solver: 'Solutore',
      model: 'Modello',
      geometry: 'Geometria',
      physical: 'Condizioni',
      numerics: 'Numerica',
      dimensionless: 'Adimensionali',
      metrics: 'Risultato',
      sweep: 'Scansione',
      verification: 'Verifica',
      validity: 'Validità',
      cost: 'Costo',
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
    title: 'Spoon Physics',
    description:
      'Gioca con la fisica, poi scopri perché funziona. Un laboratorio interattivo: una spiegazione breve che puoi saltare, un solutore vero che calcola il campo, i numeri ingegneristici che rispondono alla domanda, e a ogni esecuzione quanto ci si può fidare.',
    heroHeading: 'Gioca con la fisica.<br>Poi scopri perché funziona.',
    lede: 'Ogni esperimento parte da una domanda che si segue senza sapere niente, spiega quel tanto che basta perché i comandi vogliano dire qualcosa, e poi ti mette in mano un solutore vero: calcola il campo, dà i numeri ingegneristici e a ogni esecuzione dice fino a che punto ci si può fidare.',
    experiments: 'Esperimenti',
    badgeExercise: 'Esercizio',
    badgePlanned: 'In preparazione',
    numbersSummary: 'I numeri che ci stanno sotto',
    target: 'Obiettivo',
    wouldTarget: 'Obiettivo previsto',
    constraint: 'Vincolo',
    youSet: 'Scegli tu',
    checkedBy: 'Verificato da',
    status: 'Stato',
    airfoil: {
      name: 'Progetto di un profilo alare',
      question: 'Perché un’ala sta su?',
      topic: 'Aerodinamica — la sezione alare',
      level: 'non serve saper niente · ~5 min',
      problem:
        'Inclina una sezione alare nel vento e guarda l’aria fare il lavoro. Poi vai a prenderti la cosa vera: <strong>800 N di portanza per metro di apertura</strong>, senza un momento di beccheggio che un piano di coda non riuscirebbe a equilibrare.',
      target: 'L′ = 800 N/m ± 2 %',
      constraint: '|C_m,c/4| < 0,08',
      checked: 'portanza calcolata per due vie indipendenti',
      cta: 'Progetta un profilo →',
    },
    solenoid: {
      name: 'Il circuito magnetico',
      question: 'Perché il ferro guida un campo magnetico?',
      topic: 'Magnetostatica — il circuito di ferro',
      level: 'un po’ di fisica aiuta · ~8 min',
      problem:
        'Porta il flusso richiesto attraverso un nucleo di ferro con un budget fisso di amperspire, senza lasciarlo disperdere nell’aria.',
      target: '4,5 mWb/m con ≤ 3600 A',
      youSet: 'nucleo, intercapedine, avvolgimento, lunghezza, μᵣ, densità di corrente',
      checked: 'un bilancio energetico, la legge di Ampère e uno studio di mesh',
      cta: 'Progetta un circuito magnetico →',
    },
    truss: {
      name: 'Il ponte',
      question: 'Quale asta cede per prima?',
      topic: 'Statica — la travatura reticolare',
      level: 'questo lo disegni tu · ~10 min',
      problem:
        'Costruisci una travatura reticolare su una gola di 24 m e porta il traffico entro un budget di acciaio — l’asta che cede per prima non è quasi mai quella che ti aspetti.',
      target: 'η < 1 con ≤ 2400 kg',
      youSet: 'ogni nodo, ogni asta, i vincoli, i carichi, la sezione',
      checked: 'il metodo dei nodi, un equilibrio alla rotazione e un controllo energetico',
      cta: 'Costruisci un ponte →',
    },
    heatsink: {
      name: 'Dissipatore',
      question: 'Quando smettono di servire le alette?',
      topic: 'Trasmissione del calore — il corpo alettato',
      level: 'un po’ di fisica aiuta · ~10 min',
      problem:
        'Smaltisci una potenza data restando sotto una temperatura massima, usando meno metallo. Quante alette servono davvero, e quando smettono di servire?',
      target: 'T_max < 95 °C con ≤ 170 g',
      youSet: 'numero, altezza e spessore delle alette, la base, la finitura, il raffreddamento',
      checked:
        'un bilancio energetico su entrambe le strade del calore, e identità sui fattori di vista che valgono esattamente',
      cta: 'Raffredda un componente →',
    },
    disclaimerLabel: 'Nota.',
    disclaimer:
      'Le simulazioni sono dimostrative e didattiche. Non sostituiscono una verifica ingegneristica professionale.',
    aboutHeading: 'Come funziona',
    modesSummary: 'Due modi di calcolare la stessa cosa',
    modesLead:
      'Lo stesso problema si può risolvere in fretta e per approssimazione, oppure lentamente e più fedelmente. Il laboratorio offre entrambe le strade e dice sempre quale si sta guardando — perché la differenza tra le due <em>fa parte</em> di ciò che c’è da imparare.',
    modeFast:
      '<strong>Anteprima rapida</strong> — una griglia cartesiana regolare risolta in NumPy. Quasi istantanea, e approssimata per costruzione: la griglia non segue il contorno del corpo.',
    modeFenics:
      '<strong>Calcolo FEniCSx</strong> — una mesh triangolare non strutturata generata con Gmsh, risolta con elementi finiti P1. Più lenta, più fedele vicino al corpo, e produce un file VTK che si apre in ParaView.',
    modePanel:
      '<strong>Metodo a pannelli</strong> — per il profilo alare, nessuno dei due: sorgenti e vortici distribuiti sul corpo stesso, così il contorno è esatto invece che discretizzato. Non è l’anteprima di qualcosa di meglio: è la soluzione di superficie più accurata che c’è qui.',
    capabilityChecking: 'Verifica di che cosa è installato su questo server…',
    capabilityBoth: 'Entrambe le modalità sono attive su questo server.',
    capabilityPreviewOnly:
      'Su questo server è attiva solo l’anteprima rapida: non è installato alcun solutore FEniCSx. Gli esperimenti restano pienamente utilizzabili, e l’esercizio sul profilo alare non ne ha bisogno.',
    capabilityPaused: 'Le nuove simulazioni sono temporaneamente sospese per manutenzione.',
    capabilityUnreachable:
      'Al momento il server non è raggiungibile; gli esperimenti potrebbero non essere disponibili.',
    madeSummary: 'Com’è fatto',
    madeBody:
      'Il laboratorio è un’applicazione costruita su <a href="https://github.com/mandaloriat/fenix-spoon">Fenix Spoon</a>, un toolkit open source che mette un solutore agli elementi finiti dietro una pagina web: il protocollo, la gestione dei job, i solutori e i widget del browser vengono tutti da lì. Quello che trovi qui è l’esperienza didattica costruita sopra — i problemi, le spiegazioni, il design e il deployment pubblico.',
    madeLicence:
      'Il codice di questo laboratorio è su <a href="https://github.com/mandaloriat/physics-lab">GitHub</a> con licenza MIT. I calcoli veri sono svolti da <a href="https://fenicsproject.org/">FEniCSx</a>, e le anteprime rapide e il metodo a pannelli da <a href="https://numpy.org/">NumPy</a>.',
  },

  /* ----------------------------------------------------- il guscio comune alle pagine banco */

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
    mission: 'La missione',
    widgetsMissing:
      'I widget del browser non sono stati costruiti. Esegui <code>./scripts/fetch-widgets.sh</code> e ricarica la pagina.',
    workspace: 'Banco di lavoro',
    visualisationTools: 'Strumenti di visualizzazione',
    stageAria: 'Campo calcolato. Trascina per spostare, più e meno per ingrandire.',
    field: 'Campo',
    fieldShown: 'Campo mostrato',
    configure: 'Configura',
    design: 'Progetto',
    conditions: 'Condizioni',
    whatFollows: 'Che cosa ne consegue',
    advanced: 'Avanzate',
    advancedError:
      'Queste cambiano l’errore, non la risposta. Di quanto la cambiano è ciò che misura il pannello di verifica.',
    solverLabel: 'Solutore',
    checkingServer: 'Verifica di che cosa sa fare questo server…',
    run: 'Esegui',
    cancel: 'Annulla',
    keep: 'Salva risultato',
    compare: 'Confronta',
    answer: 'Il risultato',
    everyQuantity: 'Tutte le grandezze riportate',
    trust: 'Quanto fidarsi',
    cost: 'Quanto è costato il calcolo',
    keptRuns: 'Prove salvate',
    exportCsv: 'Esporta CSV',
    exportJson: 'Esporta JSON',
    deleteAll: 'Elimina tutto',
    lesson: 'Capire il modello',
    lessonLead:
      'Tutto ciò su cui l’esercizio si regge, nell’ordine in cui conta. Nulla di ciò che segue è stato accorciato — è stato tolto di mezzo all’esperimento.',
    maintenance:
      'Il laboratorio non accetta nuove simulazioni in questo momento. Puoi comunque leggere il problema, {alternative} e guardare le prove che hai salvato.',
  },

  /* -------------------------------------------------------------------- il profilo alare */

  airfoil: {
    title: 'Progetto di un profilo alare — Spoon Physics',
    description:
      'Un esercizio di progetto di un profilo alare: centra un obiettivo di portanza sotto un vincolo sul momento di beccheggio, con campi calcolati, grandezze ingegneristiche e un residuo di verifica a ogni esecuzione.',
    eyebrow: 'Esercizio 1 · flusso ideale con condizione di Kutta',
    heading: 'Progetto di un profilo alare',
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
    ready: 'Premi Esegui per risolvere la sezione così com’è.',
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
    title: 'Il circuito magnetico — Spoon Physics',
    description:
      'Un esercizio di progetto magnetico: porta il flusso richiesto attraverso un nucleo di ferro con un budget di amperspire, con campi calcolati, grandezze ingegneristiche e un residuo di verifica a ogni esecuzione.',
    eyebrow: 'Esercizio 3 · magnetostatica lineare di una sezione',
    heading: 'Il circuito magnetico',
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
    ready: 'Premi Esegui per risolvere la sezione così com’è.',
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
    title: 'Il ponte — Spoon Physics',
    description:
      'Un esercizio di strutture: costruisci una travatura reticolare su una gola, caricala sui nodi o lungo l’impalcato, e porta il traffico entro un budget di massa senza che un’asta si instabilizzi — con forze calcolate, grandezze ingegneristiche e un residuo di verifica a ogni esecuzione.',
    eyebrow: 'Esercizio 4 · statica di una travatura reticolare',
    heading: 'Il ponte',
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
    ready: 'Premi Esegui per risolvere la travatura così com’è.',
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
    loadedRun: 'Caricata la prova {label}. Premi Esegui per ricalcolarla.',
    columns: {
      lattice: 'Travatura',
      mass: 'massa kg',
      area: 'A m²',
      deck: 'impalcato kN/m',
      joint: 'controllo nodi',
    },
  },
  heatsink: {
    title: 'Il dissipatore — Spoon Physics',
    description:
      'Un esercizio di progetto termico: tieni un componente di potenza sotto la sua temperatura limite con un budget di massa, fra conduzione, convezione ricavata dal canale fra le alette e irraggiamento scambiato attraverso di esso — e trova il numero di alette oltre il quale aggiungerne peggiora le cose.',
    eyebrow: 'Esercizio 5 · conduzione stazionaria con convezione e irraggiamento',
    heading: 'Il dissipatore',
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
    ready: 'Pronto. Premi Esegui.',
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
