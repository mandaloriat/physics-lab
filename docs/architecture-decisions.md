# Architecture decisions

Short records of the choices that would otherwise have to be re-derived from the code —
each one states what was decided, why, and what it costs. Written when the decision was
made, not reconstructed afterwards.

---

## ADR-001 — The lab is a separate repository from Fenix Spoon

**Decision.** `mandaloriat/physics-lab` is its own repository. It is not a fork of
`fenix-spoon`, not a directory inside it, and not a branch of it.

**Why.** The two have different jobs and different audiences. Fenix Spoon is a general
toolkit: a protocol, a simulation server, a job lifecycle, a solver-adapter contract,
browser widgets, an SDK. Its users are people putting *their own* physics behind a web
page. The lab is one such application: it has opinions about pedagogy, a visual identity,
written explanations, a public domain name, and service limits chosen for anonymous
visitors. None of that belongs in a toolkit, and a toolkit that acquired it would be
harder to reuse.

They also change at different rates and for different reasons. A better explanation of
camber is a lab change; a new result kind is a toolkit change. Keeping them apart means
neither release is held up by the other, and the lab's own history reads as the history of
an application rather than of a toolkit with an application stapled to it.

**Cost.** Two repositories to keep in step, and a dependency pin to maintain (ADR-007).

---

## ADR-002 — Fenix Spoon is a dependency, not copied code

**Decision.** Nothing from Fenix Spoon is vendored as source. The Python package is
installed from git at a pinned commit; the container image is built `FROM` the Fenix Spoon
image; the browser widgets are built from the pinned source at image-build time and served
from `frontend/vendor/`, which is generated and gitignored.

**Why.** Copying would work on day one and rot immediately: a bug fixed upstream would
have to be found and re-applied here, and the two copies would diverge in ways nobody
would notice until a result differed. Worse, a copy invites edits — and an edited copy is
a fork, which is the thing ADR-001 exists to avoid.

The concrete rule that follows: **the lab does not modify the installed `fenixspoon`
package.** Where it needs behaviour the toolkit does not have, it adds it to the app object
it owns (`/health`, the static mount, the maintenance middleware — all in
`physics_lab/main.py`) rather than patching the dependency. There is exactly one place
where the lab reaches into the app Fenix Spoon built: `_drop_demo_routes` removes the
`/demo` mount and the `/` redirect that `create_app()` adds when it can see a repository
checkout. That is route configuration on an app this code constructed, not a monkey patch,
and it is a no-op for the pinned install (which has no `examples/` directory) — it exists
so an editable install from a clone does not silently redirect the lab's homepage to the
Fenix Spoon demo index.

**Cost.** The widgets need a build step before the pages work — `./scripts/fetch-widgets.sh`
locally, a Node stage in the image. Accepted: the packages are not published to npm, so
building from the pin is the only reproducible way to get them (ADR-008).

---

## ADR-003 — The front-end and the API share one origin

**Decision.** One hostname, `lab.andolfatto.eu`, serves both the static site and
`/api/v1`. No `api.lab.andolfatto.eu`. The lab's own FastAPI app serves the pages, and
Caddy proxies everything to it.

**Why.** Every request the browser makes is then same-origin, so CORS never has to be
configured — and CORS misconfiguration is one of the two or three most common ways a
deployment like this breaks. It also means the front-end contains no host at all: every
URL is relative, `new FenixSpoonClient('')`, and the same bytes run on a laptop and in
production with no build-time substitution. A test enforces that
(`test_no_hardcoded_host_in_the_front_end`).

The WebSocket benefits most. A cross-origin `wss://` from a page needs the origin allowed,
the certificate right on a second name, and the proxy configured twice; same-origin needs
none of it.

**Cost.** The API and the site scale together — they are one process. For a lab whose
static assets are a few hundred kilobytes, that is not a real constraint. Splitting later
means adding a hostname and a CORS origin, not restructuring anything.

---

## ADR-004 — Caddy is the reverse proxy

**Decision.** Caddy 2, with the `Caddyfile` in this repository.

**Why.** Automatic HTTPS is the whole argument. Certificate issue, renewal and the
HTTP→HTTPS redirect are default behaviour rather than three more things to configure and
then to remember to monitor. WebSocket upgrades need no configuration at all — the nginx
equivalent is four `proxy_set_header` lines that are easy to get subtly wrong, and whose
failure mode is a progress bar that never moves. The resulting config is short enough to
read in one screen, which matters more than it sounds: a proxy config nobody understands is
a proxy config nobody maintains.

It was also already available on the target server, which removes the only real argument
for nginx here (familiarity).

**Cost.** Caddy's rate limiter is a plugin, so per-IP limiting needs a custom image build.
The Caddyfile documents exactly how; see also ADR-010.

---

## ADR-005 — The API and the workers are separate containers in production

**Decision.** Development runs one container that serves and solves. Production runs an
API that dispatches, Redis as the queue, and worker containers that solve — the shape
`FENIXSPOON_REDIS_URL` selects.

**Why.** Three things, in order of how much they matter here.

A per-job memory ceiling becomes expressible. In-process solving runs solves on threads,
and a memory limit is a property of a *process* — `RLIMIT_AS` would apply to all of them at
once, so "cap this job at 2 GB" cannot be said at all. One solve per worker container makes
`memory: 2G` a real ceiling the kernel enforces. On a public demo that is the difference
between a runaway FEniCSx solve killing itself and killing the box.

The API stops competing with the solves. A heavy solve shares the interpreter with the
event loop, so the API gets slower to answer exactly when it is busiest — upstream measured
this, and a pure-Python solver's throughput actually *falls* as concurrency rises.

Capacity becomes a dial. `--scale worker=N`, without touching the API.

**Cost.** More moving parts, a shared volume the API and every worker must genuinely
share, and one honest gap inherited from upstream: nothing heartbeats, so a worker killed
mid-solve leaves its job `running` until the retention sweep removes it.

Note that the API runs the *same* image as the workers, built on the FEniCSx base, even
though it no longer solves. It still has to advertise the catalogue, validate parameters
against each solver's schema and estimate cell counts at submit time, so it needs every
adapter the workers have. A slim API in front of FEniCSx workers answers
`404 unknown solver`.

---

## ADR-006 — The first experiment is potential flow around an airfoil

> **Partly superseded by [ADR-014](#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first).**
> The choice of the airfoil as the first subject stands. The model does not: the exercise
> revision adds a Kutta condition, which is exactly the "most famous thing about a wing"
> this record closes by admitting the model cannot show.

**Decision.** The airfoil, on `mock.laplace2d` and `dolfinx.potential_flow2d`. Not
Navier–Stokes, not the solenoid, not the heat sink.

**Why.** It is the one problem where every capability the lab wants to demonstrate already
exists upstream, end to end: a `domain2d` geometry the visitor can *edit* rather than
merely parameterise, a mock adapter and a FEniCSx adapter that solve the same problem so
the two modes are genuinely comparable, both result kinds, progress streaming, and a VTK
artifact. Writing a new solver to demonstrate a solver would have been the wrong first
move.

It is also the best-explained physics of the three. "Why does the flow go faster over a
curved surface" is a question a curious teenager can hold in their head, and the honest
answer — including everything potential flow gets wrong — is more interesting than the
picture.

The lie this buys has to be stated plainly, and the page does: no viscosity, no boundary
layer, no drag, no separation, no stall, and — because no Kutta condition is imposed — no
circulation and therefore **zero lift at any angle of attack**. What the visitor is looking
at is how the body deflects and accelerates the stream, not how much lift it makes. A
physics lab that let someone leave believing otherwise would have failed at the only thing
it is for.

**Cost.** The most famous thing about a wing is the thing this model cannot show.

---

## ADR-007 — The dependency is pinned to a commit, in four places, checked by a script

**Decision.** Fenix Spoon is pinned to commit `988ad64b8cd25f94e52b985bf2d2456230a9eed3`.
Never `main`, never `latest`.

**What this pin carries, and why the lab moved to it.** Protocol 1.2, and with it the
capability declaration a solver adapter can make: `physics`, `availability`, `requires`,
`metrics`, `artifacts`, `features` and `examples`, plus the three progressive-discovery
operations (`GET /api/v1/capabilities`, `.../capabilities/{name}`, `GET /api/v1/environment`).
The lab needs `MetricSpec` and `ArtifactSpec` to declare what the airfoil exercise reports
before a visitor runs it (ADR-014), and they do not exist in the previous pin. The upgrade was
verified to be purely additive first: between the two commits no shipped solver's `Params`
model changed a field, which is the one thing that would have altered the parameter form the
pages generate from `params_schema`.

Note what the declaration still is at this commit: **declared, not computed.** Upstream says
so plainly — the values are issue #46 — so a metric a solver publishes in `metrics` is a
promise about what it will report, and the result envelope has nowhere to put the number yet.
That is why a lab solver carries its metrics in a declared artifact for now (ADR-015).

**Why a commit and not a release.** There is no release and no tag to use: upstream's
`git ls-remote --tags` is empty. A commit SHA is the strongest pin available, and it is a
complete one — it fixes the server, the solvers, the protocol models and the widget source
together.

**Why the image tags are what they are.** GHCR carries `sha-988ad64` (FEniCSx, dolfinx
v0.11.0, digest `sha256:9066f980…`) and `sha-988ad64-slim` (mock solvers only, digest
`sha256:99230d7e…`). `dolfinx-v0.11.0` is the same image today but is re-pointed on every
push to `main`, so it is not a pin. And `latest` / `latest-slim` **do not exist**, despite
what upstream's README says — the publish workflow tags `latest` only on a `v*` git tag,
and none has been pushed. Anyone debugging a failed pull should know that before they
"fix" it by switching to a tag that has never existed.

**Where the pin lives, and why in four places.** `pyproject.toml` (what pip resolves),
`Dockerfile` build args (what the image is built from), the compose files and `.env.example`
(what a deployment runs), and `physics_lab/settings.py` plus `scripts/fetch-widgets.sh`
(the fallback for a checkout using neither pip's metadata nor Docker). They cannot be
derived from one another because they are read by different tools at different times. A
bump that updates three of four gives a container whose widgets, server and adapters come
from different commits — and that failure is silent. `scripts/check-pins.sh` makes it loud,
and CI runs it.

**How to upgrade.**

1. Read what changed upstream, especially `docs/04-wire-protocol.md` and the solver
   `Params` models — the parameter form is generated from those schemas, so a renamed field
   changes the page.
2. Confirm the images exist for the new commit:
   `curl -s "https://ghcr.io/token?scope=repository:mandaloriat/fenix-spoon:pull&service=ghcr.io"`,
   then a `HEAD` on `…/manifests/sha-<short>`. Not every commit is published.
3. Replace the SHA in `pyproject.toml`, `Dockerfile`, `compose.yaml`,
   `compose.production.yaml`, `.env.example`, `scripts/fetch-widgets.sh` and
   `physics_lab/settings.py`, and the image tags with the new short SHA.
4. `./scripts/check-pins.sh` — it must pass before anything else is tried.
5. `FORCE=1 ./scripts/fetch-widgets.sh && pip install -e ".[dev]" --force-reinstall --no-deps`
   then `pytest`, `npx playwright test`, `./scripts/smoke-test.sh`.
6. Deploy, and roll back on a red smoke test — `./scripts/deploy.sh` does both.

**Known compatibility.** The lab reads only documented, public surface: `create_app()`,
`fenixspoon.solvers.registry.register`, `fenixspoon.solvers.available_solvers`, the
`/api/v1` protocol, and the widgets' documented element APIs. The one undocumented thing it
depends on is that `create_app()` leaves `/` free when there is no repository checkout
beside the package — `_drop_demo_routes` handles the case where it does not.

**Cost.** A bump is a seven-file commit. The check script is what makes that safe rather
than merely tedious.

---

## ADR-008 — The browser widgets are built from source, not installed

**Decision.** `@fenix-spoon/{client,geometry-2d,viewer}` are built from the pinned Fenix
Spoon checkout and vendored into `frontend/vendor/`, which is generated and gitignored.

**Why.** They are not published to npm — upstream says so, and `npm view` confirms it. The
alternatives were to commit someone else's build output (thousands of lines to review on
every bump, and no provenance), or to add Fenix Spoon as a git submodule (a second checkout
to keep in step, for three ES modules). Building from the pin at image-build time keeps the
bytes reproducible and their origin explicit: the vendor directory carries a `COMMIT` file,
and `check-pins.sh` reads it.

**Cost.** A build step. `./scripts/fetch-widgets.sh` for a local checkout; a Node stage in
the Dockerfile otherwise. A checkout that skips it serves a page that does nothing, which
is why both a Python test and the page itself detect and report it.

---

## ADR-009 — No front-end framework, and no bundler

**Decision.** Static HTML, ES modules, an import map, and about 600 lines of plain
JavaScript. No React, no Vue, no Vite, no build step for the lab's own code.

**Why.** The two interactive elements on the page — the geometry editor and the field
viewer — are custom elements. They work identically in any framework and in none, and they
carry their own state. What is left for the lab to write is a parameter form, a status
line, a NACA profile generator and some text rendering. A framework would be more code than
the thing it was framing, and a bundler would exist only to resolve three bare specifiers
that a nine-line import map resolves for free.

There is a real cost to a build step that is easy to underestimate: it makes "edit a file
and reload" stop working, it adds a second thing that can be stale, and it puts a
transformation between the source and what the browser runs when something goes wrong at
2 a.m.

**When to revisit.** A fourth or fifth experiment sharing substantial interactive
behaviour, or the first time the same state has to live in two places on a page. Not
before.

**Cost.** No tree-shaking or minification. Uncompressed, the lab's own JavaScript is a few
tens of kilobytes, and Caddy serves it with zstd.

---

## ADR-010 — Public-demo limits, and what they do not cover

**Decision.** Anonymous access with server-wide quotas, a 24-hour retention TTL, a
maintenance switch, and no accounts.

**Why.** An identity provider for a page whose whole point is that you can try it
immediately would be a poor trade. Fenix Spoon's quotas work without one — in anonymous
mode every caller is the principal `anonymous`, so the quotas apply server-wide, which is
exactly how you put a public demo behind a rate limit without running an identity provider.

The limits in `.env.example` are chosen against measured behaviour rather than guessed:
200,000 cells covers the airfoil at maximum resolution (~175,000) and refuses more; the
90-second timeout is generous for a mock solve (~0.1 s) and adequate for a FEniCSx one; a
24-hour TTL is long enough to share a result with someone and short enough that the lab is
not quietly accumulating a year of strangers' simulations.

**The gap, stated plainly.** Because every visitor is the same principal, *the quotas cap
total load and do nothing against one abusive client*. One script can consume the whole
hourly budget and lock everyone else out without ever tripping a per-user limit. Per-IP
limiting is the missing half, and it belongs in the reverse proxy — the only layer that
sees the client address. The Caddyfile carries the configuration, commented, along with the
`xcaddy` build it needs. It is off by default because it turns a stock image into one this
repository has to rebuild, and the honest starting point for a small demo is the
server-wide cap plus a note about when to turn it on.

Three consequences shaped the front-end rather than the config. The experiment page never
solves automatically — no auto-run on load, no auto-run on drag — because at 100 jobs an
hour shared by everyone, a page that solved on every edit would spend the budget on people
who were only looking. The page reads `jobs_enabled` from `/health` and shows a banner
instead of a Run button that would 503. And the server's own budget refusal is printed
verbatim onto the status line, because "job would use about 4,194,304 cells, over this
server's limit of 200,000" is the only way someone who just moved a slider finds out why
nothing happened.

**Cost.** A determined abuser can still spend the hour's budget. That is a monitoring
question first and a rate-limiting question second, and both are documented rather than
pre-solved.

---

## ADR-011 — English throughout, site included

**Decision.** One language everywhere: the pages, the experiment content, the status
messages, the code, the tests and these records are all in English.

The first draft of the kickstart split them — an Italian site over an English repository,
on the reasoning that `lab.andolfatto.eu` addresses an Italian-speaking audience. That was
reversed before anything was published, and it is worth recording why, because the split
is a tempting default for a project with a national domain.

**Why one language.** The lab's subject matter is not national. Its vocabulary is the
vocabulary of Fenix Spoon and FEniCSx: `mock.laplace2d`, `psi`, `domain2d`, `mesh_size`,
`grid2d`. Those names appear in the solver picker and in the parameter form because they
come from `GET /api/v1/solvers` — the page cannot translate them without inventing a
mapping and then maintaining it. Around English identifiers, Italian prose reads as
translated documentation for an English system, which is what it would have been.

The audience is also wider than the domain suggests. Someone looking for a worked example
of putting FEniCSx behind a web page is exactly the reader this lab serves best, and they
arrive from the Fenix Spoon repository, in English. A visitor who cannot read the
explanations gets a picture and no physics.

And the split had a maintenance cost that only showed up once both halves existed:
assertions in two languages, a CI check grepping for an Italian sentence, and every
message existing twice — once in the page and once in the test that reads it. For a
project with one finished experiment, paying that to serve one audience less well was the
wrong trade.

**Cost.** Italian readers get English. Adding a translation later is now a real
internationalisation project rather than a matter of swapping `content.json`, since the
strings live in the pages and in `app.js` as well. That is the honest price, and it is not
due until a second language is actually wanted — which is also when the seam should be
designed for the languages it will really carry, rather than guessed at now.

---

## ADR-012 — The second experiment shares a page shell, and brings its own geometry controls

**Decision.** The magnetics experiment (solenoid cross-section, `regions2d`) is the second
one on the site. Two things were decided with it.

First, the physics-agnostic half of an experiment page now lives in
`frontend/shared/experiment.js`: the parameter form generated from a solver's
`params_schema`, the solver picker, the run-and-stream loop, the status line, the result and
artifact panels, the field-view application and the lesson renderer. The airfoil was
rewritten onto it in the same change, so there is one implementation rather than two.

Second, the magnetics page has **no geometry editor widget**, and that is a physics decision
rather than a shortcut. `<fs-geometry-2d>` edits `domain2d` — one polygon cut out of a
rectangle — while this experiment is `regions2d`, a filled domain whose material varies by
region. There is nothing for the editor to edit. The controls are the quantities an engineer
would name instead (core half-width, air gap, winding thickness, half-height, μᵣ, current
density) and the cross-section is drawn as its own diagram.

**Why this is not ADR-009 being reversed.** ADR-009 says no framework and no bundler, and
sets the threshold for revisiting at "a fourth or fifth experiment sharing substantial
interactive behaviour". That threshold is about adopting a framework, and none was adopted:
`experiment.js` is a module of functions that take DOM nodes, in the same spirit as
`components.js` and `api.js`, and there is still no build step for the lab's own code. What
would have crossed the line is a component model or a state container. Copying two hundred
lines of schema-driven form code into a second file would have been the worse outcome — the
same bug fixed twice, or fixed once and left broken once.

**Why the geometry controls are measured outward from the core.** `regions2d` accepts
regions that are disjoint or fully nested and refuses outlines that properly cross, because
a partial overlap describes an ambiguous material assignment. A form offering "core width"
and "bore radius" as two free sliders can therefore be dragged into a payload the server
rejects, and the visitor is left reading a validation error about a constraint they were
never shown. Measuring the winding *outward from the core* — core half-width, then a gap,
then a thickness — leaves no ordering to violate: every combination is valid by
construction, and their maxima sum to well inside the window. A browser test walks each
slider to both ends and checks the payload's invariants, which costs no solves.

**Why the cross-section is a separate diagram rather than an overlay on the field.** The
airfoil layers the editor over the viewer, which works because both fill the element. They
do not agree, though: `<fs-viewer>` reserves a strip on the right for its colorbar and
stretches the domain into what is left, while `<fs-geometry-2d>` uses the full width. A new
overlay would have to reproduce the viewer's internal layout constants to stay aligned with
the field, and would silently drift the first time they changed upstream. A diagram that
owns its own box cannot misalign, and it can keep the domain's true aspect ratio. What shows
the regions *inside* a computed result is the `mu_r` field, which the solvers publish for
exactly that purpose.

**Cost.** Two pages now share code, so a change to the shell has to be checked against both
— which is the ordinary cost of not duplicating it, and what the browser suite is for. And
the magnetics page cannot be reshaped by dragging, which is a real loss of directness
compared with the airfoil; the compensation is that its sliders are dimensioned in
millimetres and read as a specification.

---

## ADR-013 — The pages become exercises, not demonstrations

**Decision.** Every page in the lab implements one contract:
problem → model → boundary conditions → (initial conditions, only if transient) → physical
inputs → fields → engineering metrics → verification → saved result. Written down in
[docs/exercise-contract.md](exercise-contract.md), and binding on new pages and on the two
that exist.

**Why.** The lab as shipped is a gallery. Its two pages ask "how does the flow field change
as you increase the camber?" and "what does the iron core actually do?" — questions with no
answer that can be wrong. Nothing can be got wrong, so nothing can be compared, and nothing
can be improved. A visitor who moves every slider has learned to move sliders.

An exercise has a right answer, a wrong answer and a better answer, and the difference
between them is a number the page computes. That single change cascades: a target implies
metrics, metrics imply verification (otherwise the target is met by an unchecked number),
verification implies a stated domain of validity, and a comparable result implies a run
record that carries every input rather than the interesting ones.

**Two separations the contract insists on.**

*Physical inputs are not numerical settings.* `velocity 40 m/s` is the problem;
`mesh size 0.02` is the approximation. In one panel they read as the same kind of quantity,
and they are opposites: changing the first should change the answer, and changing the second
should not — the amount by which it does is the discretisation error, which is the
verification section's subject. So a page has three parameter groups: physical, numerical,
and study.

*The engineering answer is not the cost of the solve.* Fenix Spoon already draws this line —
`stats` is cells and seconds, metrics are lift and temperature rise — and the lab's result
panel now has two tables rather than one.

**Cost.** The two existing pages need rewriting rather than extending, and their prose about
"what to watch" is largely dropped rather than migrated. The page shell grows by a metrics
table, a verification panel, a validity panel, a curve plot, a run table and a challenge
banner — which is the point at which ADR-009's "revisit at a fourth or fifth experiment"
clause should be re-read rather than assumed. It still holds: all of that is functions over
DOM nodes, with no shared mutable state. The run table is the likeliest thing to break it.

---

## ADR-014 — The airfoil exercise ships ideal flow with a Kutta condition first

**Decision.** Two model levels, specified together and shipped apart
([docs/exercises/airfoil.md](exercises/airfoil.md)):

- **Level 1 — ideal flow with the Kutta condition.** Ships first. Produces C_p, C_L, C_m,
  centre of pressure, aerodynamic centre (from a sweep) and sectional lift. Withholds C_D and
  L/D, and says why.
- **Level 2 — viscous performance.** Later, on the same page. Adds Reynolds dependence,
  no-slip, drag, efficiency and a separation indication.

The reference solver is a **panel method in NumPy**, registered in `physics_lab/solvers/`.
Not FEniCSx.

**Why a Kutta condition is not optional.** The current model has none, so its circulation is
zero and its integrated lift is exactly zero at every incidence. Adding a lift coefficient to
that page would print a number the equations cannot produce. The Kutta condition is precisely
the missing physics — the condition that selects the circulation an ideal flow needs to lift
at all — and it is one equation on a model the lab already runs.

**Why level 1 before level 2.** Level 1 is verifiable to the last digit: an exact cylinder
solution, an exact Joukowski solution with a sharp trailing edge, thin-airfoil theory as an
asymptotic band, and — on every single run — the internal consistency of lift from circulation
against lift from integrated pressure. A viscous model has no closed form to check against;
its verification is correlation with experiment, which is a far weaker claim for a lab whose
argument is that the numbers can be checked. Level 1 also fits the public job budget
(ADR-010), where a viscous solve at a useful Reynolds number does not.

**Why a panel method rather than FEniCSx.** Three reasons, and none of them is convenience.
The boundary is represented *exactly* rather than approximated by elements, and the surface
pressure is the quantity the exercise reads. There is no outer boundary, so there is no
domain-truncation error to converge — a mesh solve has to demonstrate that its far field is
far enough. And the influence matrix depends only on the geometry and the panelling, never on
incidence, so an incidence sweep is one job with one factorisation and a back-substitution per
angle — which is what makes the aerodynamic centre affordable on a public server at all. A
FEniCSx variant is specified as a cross-check, recovering circulation by superposing three
linear solves, because cross-validating two independent implementations of the same physics is
upstream's own practice.

**What is kept from the old model.** `kutta: none` reproduces it exactly, as a model selector
rather than a setting, because "turn circulation off and the lift vanishes" is the clearest
demonstration in the lab that circulation *is* lift — and it doubles as a check of d'Alembert's
paradox on the discrete solution.

**Cost.** A solver to write and test, ten catalogue profiles to enter, an ISA atmosphere, a
curve plot the lab does not have, and a page rewritten rather than edited. The old page's
honest disclaimer about zero lift stops being needed, which is the trade.

---

## ADR-015 — The run table lives in the browser, and Fenix Spoon owns the record

**Decision.** Saved runs are `localStorage`, per exercise, with a stated cap and CSV/JSON
export. No server-side store, no accounts, no database in this repository. The row schema is
shaped like upstream's direction — metrics separate from cost, provenance its own block,
verification as data.

**Why not server-side.** Everything a durable run store needs is already being built one
repository away: typed metrics declared (#43, landed) and returned (#46), compact queryable
results (#46), provenance and a content-addressed cache (#47), and a study object for sweeps
and convergence ladders (#48). A second implementation here would be a parallel system to
migrate off, and it would be the *wrong* half — the lab would own persistence, which it has no
business owning, while still lacking the typed metrics that make a row comparable.

**What that costs today.** Protocol 1.2's result envelope has nowhere to put a computed
metric, a warning, or a 1-D curve. So a lab solver returns the field as `grid2d`/`mesh2d`,
restricts `stats` to what the solve cost, and writes one always-present `report.json`
artifact carrying metrics, curves, verification residuals and warnings — declared as an
`ArtifactSpec` so it is discoverable before submitting. It is protocol-legal, it invents no
private convention on top of `stats`, and its content is exactly the payload that becomes
native `metrics` when #46 lands: at that point the page reads the envelope and the artifact
becomes optional.

**Cost.** Runs are lost when the visitor clears their browser, and cannot be shared by URL.
For an anonymous public demo that is the honest state of affairs rather than a limitation to
apologise for — and the export button is the answer for anyone who wants to keep a study.

---

## ADR-016 — The product is called Spoon Physics

**Decision.** The lab is **Spoon Physics** — *Interactive problems. Computed fields.
Checkable answers.* Not the founder's surname, which is what it was called until this record
was written. **Carried out**: the name now reads that way everywhere the product names
itself.

**Why not the old name.** There is a real
[Andolfatto Lab at Columbia](https://andolfattolab.com/), a genetics group. A personal
surname on a physics site that collides with an existing research group is a needless
ambiguity, and the lab's value has nothing to do with whose surname is on it.

**Why this name.** It says what the thing is and where it comes from: the toolkit is Fenix
Spoon, and this is the physics built on it. "Fun Physics Lab" is clear but generic and reads
as a school worksheet. "Spoon Labs" is stronger but taken several times over, including by
[spoonLabs AI](https://spoonlabs.ai/). "Spoon Physics Lab" is the more descriptive variant and
stays available as a fallback if the shorter name proves ambiguous in use.

**What the rename touched.** `settings.site_name()` and its environment default, the page
titles built in `experiment.js` and all three `index.html`s, the homepage masthead and the
favicon's `aria-label`, the README, the `pyproject.toml` and `package.json` project names, and
the assertions in `tests/`, `e2e/` and `scripts/smoke-test.sh` that read the visible name.

**What it deliberately left alone.** `lab.andolfatto.eu` stays as the hostname: a domain is
infrastructure, and it need not be the product's name — what changed is that the pages stop
presenting it as one. The `LICENSE` copyright and the ACME contact address are the author's
and stay the author's. The image labels keep the `eu.andolfatto.lab.*` reverse-DNS namespace,
because that namespace is derived from the domain, which did not change; renaming it would
break label queries on already-published images for no gain.

**Cost.** Any bookmark that remembered the old title is now inconsistent with the page, and
the repository name still reads `physics-lab`. Done before the exercise pages exist, so they
are written under the final name rather than swept afterwards.

---

## ADR-017 — An experiment page is a bench, not a document

**Decision.** Every experiment page is arranged as one path — **mission → configure → run →
explore → check → keep and compare → understand the model** — with the computed field as the
largest thing on it and its own toolbar. The prose is not shortened; it is folded into
*Understand the model*. Shared implementation: `frontend/shared/workspace.js`.

**Why.** The airfoil page had almost every capability this record asks for and showed them all
at once, which is a different failure from missing them. Measured on the page as shipped: 7,664
pixels tall at 1440 wide, a 310-pixel sidebar carrying twelve controls each with a paragraph
under it, the Run button *above* most of the inputs that feed it, three result panels reading
"Nothing computed yet" before anything had been run, and the field — the only thing on the page
that is a measurement — occupying about a ninth of the first screen. A visitor cannot tell what
to do first because everything is offered with equal weight.

Four things follow, and each is a decision rather than a tidy-up.

**The field gets the room, and tools.** It is the instrument; everything else is arranged around
it. That means a stated aspect ratio taken from the domain, roughly three quarters of the bench
on a desktop, and a toolbar rather than a hover readout as the only way in. A tool the current
result cannot support is **disabled with its reason**, never absent: "Vectors — this result
publishes no vector field" is a true statement about the solve, where a missing button is
indistinguishable from a broken page.

**Explore and Edit are different modes.** The geometry editor used to be permanently layered
over the viewer, so its control points were always visible and a drag was always a reshaping.
With pan and zoom on the same surface that is an unresolvable conflict, so the editor is hidden
and inert outside *Edit shape*. This also fixed a real misalignment nobody had noticed:
`<fs-viewer>` reserves 38 px on the right for its colorbar and stretches the domain into what is
left, while `<fs-geometry-2d>` uses the full width — so the draggable outline sat several per
cent to the right of the hole it was supposed to be. Turning the widget's colorbar off and
drawing the scale in the lab's own DOM removes the discrepancy *and* makes the plot area exactly
the element's box, which is what lets an annotation layer align with the field without
reproducing the widget's internal layout constants. That hazard is the one
[ADR-012](#adr-012--the-second-experiment-shares-a-page-shell-and-brings-its-own-geometry-controls)
declined to take on; it is taken on here only because the constant was eliminated rather than
copied.

**Nothing is reported before there is something to report.** The result sections do not exist
until the first solve. An empty panel is worse than no panel: it occupies the position where an
answer will be and teaches the visitor to skip that position.

**The explanations move, and none is deleted.** Each `content.json` section becomes a closed
`<details>` under *Understand the model*, and the long paragraph that used to sit under every
slider becomes that control's tooltip. The rigour is the point of the lab; a wall of it between
a visitor and the experiment is read by nobody, which is the same as not having written it.

**What was *not* built, and why it is a note rather than a gap.** Pan and zoom are laid out
*around* `<fs-viewer>` — a clipping parent scrolls a larger box, and the widget re-renders at
whatever size it is handed — because the pinned viewer has no view transform. Locking the colour
range is genuinely impossible on this pin: the widget computes its range privately and exposes
only a getter, so a locked legend would state a range the canvas does not use. That control is
therefore present, disabled, and says so, and `viewerCapabilities()` feature-detects a settable
range so it turns itself on the day upstream provides one. Streamlines *are* drawn, because the
panel solver publishes `vector_fields.velocity` and a streamline is an integral of exactly that;
where a solver publishes only scalars — the magnetics page — the tool is disabled with that
sentence, and the contours of *A<sub>z</sub>* remain the honest device.

**Why this is still not a framework.** `workspace.js` is functions over DOM nodes plus one
factory that closes over them, in the same spirit as `components.js` and `experiment.js`. No
component model, no reactive store, no build step, so
[ADR-009](#adr-009--no-front-end-framework-and-no-bundler) is untouched — and the thing ADR-009
warns about was checked directly rather than assumed: the workspace owns view state (mode, zoom,
which layers are on) and the page owns physics state, and they meet at two function calls
(`setResult`, `setOverlays`) and one callback (`onDraw`). One bug in this change came from
exactly that seam — an overlay declared with `on: true` stayed off after becoming available,
because "the visitor turned it off" and "it was disabled" were stored as the same thing — and the
fix was to distinguish them, not to adopt a state container. ADR-009's threshold is still the
first time the *same* state has to live in two places, and it has not been crossed.

**Cost.** The two pages share considerably more code than before, so a change to the workspace
has to be checked against both — which is what the browser suite is for, and it grew by fourteen
tests. The stage now scrolls, which is a scroll container inside a scrolling page and needs
`overscroll-behavior: contain` to stay tolerable on a trackpad. And the annotation layer is the
lab's own code drawing on top of upstream's picture: correct today because the projection is
derived rather than copied, and something to delete the day `<fs-viewer>` grows annotations of
its own.

---

## Deferred

Not built, on purpose. Each would have been a plausible use of the kickstart's time; none
would have made the one finished experiment better.

| Deferred | Why, and what would bring it back |
|---|---|
| **The heat-sink experiment** | `mock.heat2d` exists upstream, takes `regions2d`, and carries its convective boundary condition as parameters (`h`, `t_ambient`) rather than needing anything of the geometry schema — so the machinery is ready and what is missing is the didactic half: a fin generator, and the lesson that makes "how many fins actually help" answerable. It would also ship with only the fast preview, since upstream has no FEniCSx heat adapter to pair with it. The homepage lists it as planned rather than pretending. (The solenoid was in this row until ADR-012.) |
| **A lab-specific solver** | `physics_lab/solvers/` is the registered, wired-up place for one, and it is empty. Nothing the airfoil needs is missing from Fenix Spoon, so writing an adapter would have demonstrated the adapter contract rather than any physics. |
| **Accounts, quotas per person, an admin dashboard** | Would need an identity provider, which would defeat "open the page and try it". Fenix Spoon supports API keys and per-principal quotas the day this changes. |
| **Per-IP rate limiting on by default** | Needs a custom Caddy build. Configured and commented in the Caddyfile; see ADR-010. |
| **Publishing the lab image to GHCR** | The server builds from the checkout, which keeps one source of truth while the project is one person and one machine. A published image matters when a second deployment does. |
| **A FEniCSx job in CI** | Would mean pulling a 3 GB image and running a real solve on every push, for a code path this repository does not own — the adapters are upstream's and are tested there in that exact image. CI builds and runs the slim image, which exercises everything the lab actually wrote. |
| **STEP upload, 3D, Navier–Stokes, automatic optimisation** | All need protocol capabilities that do not exist yet: `step3d` geometry, 3D result kinds, vector fields. Upstream's roadmap, not the lab's. |
| **MCP / local agent interface** | Upstream design draft (M2.5), unimplemented there. An application cannot ship a transport its toolkit does not have. |
| **Analytics** | None. A page that reports nothing needs no cookie banner and no privacy policy, and the lab collects no personal data at all. |
