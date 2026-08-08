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

**Decision.** Fenix Spoon is pinned to commit `4e7c296a7d351575194e25a1d4ebc1c703a6e08f`.
Never `main`, never `latest`.

**What this pin carries, and why the lab moved to it.** Protocol 1.9. The pin before it
(`988ad64`) carried 1.2 and the capability declaration a solver adapter can make — `physics`,
`availability`, `requires`, `metrics`, `artifacts`, `features` and `examples`, plus the three
progressive-discovery operations — which is what the airfoil and magnetics exercises are built
on. Four minors have landed since, and the bridge exercise needs two of them:

- **1.8, a geometry can name pieces of its own boundary.** `boundaries` on `domain2d` and
  `regions2d`, with `part` / `points` / `near` / `box` / `all_of` selectors resolving to a
  predicate over coordinates.
- **1.9, a load case says what happens there.** `conditions` on a job request, keyed by those
  names, refused rather than ignored when a name or a key is one nobody declared.

Together they are the whole of [ADR-019](#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)'s
"loaded at one or more joints or stretches": the geometry says *where*, the load case says
*what*, and neither can be silently dropped. 1.6 (a metric declares what it is taken over) and
1.7 (an artifact knows which instant it holds) come along and are unused here — nothing in the
lab is transient yet.

The upgrade was verified to be purely additive first: between the two commits no shipped
solver's `Params` model changed a field, which is the one thing that would have altered the
parameter form the pages generate from `params_schema`. Every existing test passed unchanged,
and the three committed thumbnails regenerated **byte for byte identical**, which is a
stronger statement than a green suite — no shipped solver's numbers moved.

**One assertion in the browser suite had to be inverted, and it is the good kind.** The
`<fs-viewer>` at the old pin computed its colour range from the data and exposed only a getter,
so the lab's Lock scale tool was drawn *disabled, with the reason*, and a test asserted exactly
that. The new pin adds the setter and `autoRange` beside it. Because `viewerCapabilities`
probes for the **property** rather than checking a version, the tool turned itself on; what
changed in the lab was the four lines that implement the lock and the test that had always been
the one to move.

Note what the metric declaration still is at this commit: **declared, not computed.** Upstream
says so plainly — the values are issue #46 — so a metric a solver publishes in `metrics` is a
promise about what it will report, and the result envelope has nowhere to put the number yet.
That is why a lab solver carries its metrics in a declared artifact for now (ADR-015).

**Why a commit and not a release.** There is no release and no tag to use: upstream's
`git ls-remote --tags` is empty. A commit SHA is the strongest pin available, and it is a
complete one — it fixes the server, the solvers, the protocol models and the widget source
together.

**Why the image tags are what they are.** GHCR carries `sha-4e7c296` (FEniCSx, dolfinx
v0.11.0, digest `sha256:08213ca6…`) and `sha-4e7c296-slim` (mock solvers only, digest
`sha256:8189808c…`). `dolfinx-v0.11.0` is the same image today but is re-pointed on every
push to `main`, so it is not a pin. And `latest` / `latest-slim` **do not exist**, despite
what upstream's README says — the publish workflow tags `latest` only on a `v*` git tag,
and none has been pushed. Anyone debugging a failed pull should know that before they
"fix" it by switching to a tag that has never existed.

**Where the pin lives, and why in four kinds of place.** `pyproject.toml` (what pip resolves),
`Dockerfile` build args (what the image is built from), the compose files, `.env.example` and
`.github/workflows/ci.yml` (what a deployment — or a build — runs), and
`physics_lab/settings.py` plus `scripts/fetch-widgets.sh` (the fallback for a checkout using
neither pip's metadata nor Docker). They cannot be derived from one another because they are
read by different tools at different times. A bump that updates three of four gives a
container whose widgets, server and adapters come from different commits — and that failure is
silent. `scripts/check-pins.sh` makes it loud, and CI runs it.

**The check is only as wide as its file list, and that was found the hard way.** The bump to
`4e7c296` updated every file the script read and one it did not: the CI workflow, which names
the slim image the container job builds `FROM` and which carried a comment claiming it was
checked here. The build then did exactly what this ADR says a partial bump does — vendored the
widgets from the new commit onto a runtime whose `fenixspoon` was the old one — and failed with
`ModuleNotFoundError: No module named 'fenixspoon.boundaries'` three minutes in. The workflow
and `compose.host-caddy.yaml`, which was unread for the same reason, are now both in the
script's lists, and the comment is true. A tripwire that does not cover a file is a tripwire
that says the file is fine.

**How to upgrade.**

1. Read what changed upstream, especially `docs/04-wire-protocol.md` and the solver
   `Params` models — the parameter form is generated from those schemas, so a renamed field
   changes the page.
2. Confirm the images exist for the new commit:
   `curl -s "https://ghcr.io/token?scope=repository:mandaloriat/fenix-spoon:pull&service=ghcr.io"`,
   then a `HEAD` on `…/manifests/sha-<short>`. Not every commit is published.
3. Replace the SHA in `pyproject.toml`, `Dockerfile`, `compose.yaml`,
   `compose.production.yaml`, `compose.host-caddy.yaml`, `.env.example`,
   `scripts/fetch-widgets.sh` and `physics_lab/settings.py`, and the image tags — including
   the one in `.github/workflows/ci.yml` — with the new short SHA. The digests in `README.md`
   and in this file are part of it: `check-pins.sh` reads the commit out of both documents, but
   nothing checks a digest against the registry, so those two lines are the only ones a human
   has to get right unaided.
4. `./scripts/check-pins.sh` — it must pass before anything else is tried. It reads every file
   in the list above; a file it does not read is a file that will drift, so anything that
   learns to name the pin is added to it in the same commit.
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

> **Superseded in part by [ADR-020](#adr-020--the-site-is-bilingual-the-repository-is-not).**
> The site is now English and Italian; the code, the tests and these records stayed English.
> The reasoning below is why the split was refused the first time, and it is still the reasoning
> — what changed is that the second language was actually wanted, which is the condition the
> last paragraph names.

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

## ADR-018 — The magnetics exercise gets its own solver, and its challenge is not a gap force

**Decision.** `lab.magnetics2d` joins `lab.airfoil_panel2d` in `physics_lab/solvers/`: a
cell-centred finite-volume magnetostatics solve on a grid with **a line on every material
boundary**, reporting the metrics [`docs/exercises/solenoid.md`](exercises/solenoid.md) §1
listed, each with a verification residual. Three definitional choices go with it, and the
third changes what the exercise *is*:

1. Saturation is read from a **section average**, `b_section_max`, not from a peak.
2. Leakage is measured against the **whole flux bundle** — the surface bounded by the two
   points where *B<sub>y</sub>* changes sign — not against a chosen second surface.
3. The exercise's challenge is set in **core flux density at minimum ampere-turns**, not in a
   gap force. The contract's [§7](exercise-contract.md#7-the-five-exercises) row is revised.

**Why a second magnetostatics solver at all.** Upstream's `mock.magnetostatics2d` solves the
right equation and rasterises the material onto a uniform grid, so the iron/air interface is a
staircase. Measured on the page's own cross-section, a 20.000 mm core comes out **20.339,
20.168 and 20.084 mm** wide at 60, 120 and 240 cells across — never right, and wrong by a
different amount each time, so refining the mesh moves the geometry as well as the answer.
Its core flux drifts 2 % over that range and does not settle. At 480 it returns a flux 26 %
adrift, because it takes a fixed number of Jacobi sweeps, exhausts its own 40 000-iteration
ceiling, and reports **no residual that would say so**. That last one is the decisive
difference: a demonstration may stop early and still draw a useful picture, and a metric may
not.

Fitting the grid to the interfaces costs almost nothing — every region this page submits is an
axis-aligned rectangle, so the fit is exact by construction — and it buys a refinement path
that holds the geometry fixed. The core is 20.000 mm wide at every resolution, and the core
flux settles to four figures: **−2.5684, −2.5656, −2.5641, −2.5635 mWb/m**. A manufactured
solution with a thousandfold permeability jump through the middle of it confirms second-order
convergence (observed orders 1.80 then 1.96), which is what says the harmonic-mean interface
treatment is right rather than merely plausible.

**The peak flux density does not converge, and §1 expected it to.** The specification assumed
the unrestricted peak was an artefact of the mock's staircase and would settle once it was
restricted to the iron. It does not. On the interface-fitted grid the peak inside the core
reads **0.148, 0.185, 0.230, 0.290 T** over the four refinements, climbing by a steady factor
of about 1.25 each time — a corner singularity of the exact solution, which no mesh resolves
because there is nothing there to resolve. The restriction to the iron cannot help, and the
reason is worth stating because it is the opposite of what the specification guessed:
tangential **H** is continuous across the surface, so **B** just inside a corner is *μ*<sub>r</sub>
times **B** just outside it. **The peak is always in the iron.**

So the pointwise peak is withheld, named in the report's `withheld` list, and the saturation
warning is read from `b_section_max`: the flux density averaged across a section of the core,
maximised over every section along it. It is an integral of the field rather than a sample of
one, the singularity carries no weight in it, and it converges — **0.12852, 0.12831, 0.12821,
0.12818 T** over the same refinements. It is also what a magnetic circuit is actually sized
with: iron saturates when a whole section runs out of capacity, not when one corner does.

**The leakage surface is placed where the integrand vanishes.** §1 recorded that two reasonable
choices for the outer surface differ by about 10 % on the default geometry, and asked for one
to be fixed and drawn. Neither is used. Along the mid-plane, *A<sub>z</sub>* turns over exactly
where *B<sub>y</sub>* changes sign, so the flux between its maximum and its minimum is the whole
bundle crossing that plane in one direction — and because the surface ends where the integrand
is zero, moving it changes the answer at second order instead of first. The number earns its
place by being stable where the thing it is a share *of* is not: growing the window from 60 mm
to 240 mm moves the core flux by 25 % and the leakage ratio by 2 %.

**The window the page submits was too small to quote numbers from, and widening it turned out
to be a discretisation decision.** The 60 mm half-window put **7.6 %** of the stored energy in
its outermost twentieth, and returned a core flux **27 % below** the value the same magnet
reaches in a 480 mm window: the truncation was doing the confining. Every run now reports the
share of its energy against the wall and warns above 1 %, a threshold calibrated against that
series — at 0.7 % the flux is within 1.5 % of its value in a window twice as large — and the
page sizes its window at **eight times the magnet's half-extent** rather than at a constant,
because the criterion scales with the magnet.

Two things had to change in the solver before that was affordable, and the second was found by
the page failing its own verification in a browser test:

- **The cell count is set across the regions, not across the window.** Counting across the
  window couples the two, so widening one coarsens the other. At eight times the magnet, a
  resolution that had been ample gave two cells across the core and an energy balance out by
  **11 %** — a page whose default run failed its own headline check. The parameter is now
  `cells_across`, and `resolution` means what it means on the airfoil page: the sampling grid
  for the picture, affecting no reported number.
- **The cells grow geometrically out in the air.** The far field is smooth and mostly empty,
  and spending the iron's cell size on it would be spending ninety per cent of the grid where
  nothing happens. With a growth ratio of 1.2 the 240 mm window costs **14 859 cells** against
  **413 445** uniform — and 43 % more than the 60 mm window it replaces, not sixty-four times
  more. Grading is only free if it does not cost the order of accuracy, so the manufactured
  solution is solved on a graded grid too, and still converges at second order.

**Why the challenge is not a gap force.** The contract's §7 sets this exercise's target as
*"produce a required gap force at minimum current"*, and this cross-section cannot pose that
problem: a straight bar core between two opposed windings is symmetric, so the net force on it
is exactly zero and any number reported for it would be rounding error. A gap force needs a
C-core and an armature — a different cross-section — and, to be had by differencing the stored
energy, the study object upstream's
[#48](https://github.com/mandaloriat/fenix-spoon/issues/48) provides. Both are real work and
neither is hidden by choosing a different target. The challenge this cross-section *can* pose
is the one a transformer or an actuator designer actually solves first: reach a required flux
density in the core at the least ampere-turns, without saturating and without letting the
leakage take over. Every metric it needs is now computed and verified.

**Cost.** A second discretisation of the same physics to maintain. The magnetics page no longer
offers a choice of solver — an exercise needs metrics, and the two upstream adapters report
none — so what used to be a comparison between a preview and FEniCSx is now a single solver and
a note saying the others remain available through the API. That is a real loss of a didactic
device, taken because a page that offered a solver which cannot answer its own mission would be
worse.

The finite-volume solve is slower than the preview by roughly the cost of converging properly:
1.4 s for the default cross-section with the refinement study on, against a fraction of a
second for a fixed 3 000 Jacobi sweeps that have not converged. `estimate_cells` returns five
times the grid when the refinement study is on plus the field raster, so a cell count that fits
the server's budget without the study may be refused with it — the budget doing its job, stated
in the parameter's description rather than discovered. And the geometry now has a derived
quantity in it: the window is computed from the sliders rather than typed, which is one more
thing that changes when a slider moves and one less thing that can be set wrong.


---

## ADR-019 — The bridge carries its lattice in params, because the protocol has no network geometry

**Decision.** The fourth exercise is a planar pin-jointed truss, solved by `lab.truss2d` — the
lab's third own solver. Its three payloads are split like this, and the split is not where it
would be if the protocol had a third geometry kind:

| What | Travels as | Why there |
|---|---|---|
| the **site** — bounds, banks, the shipping channel that must stay clear, and a *name* for every place a condition can attach to | `regions2d` geometry, with protocol 1.8 `boundaries` | it is a region map, which is exactly what `regions2d` is for |
| the **lattice** — joints and bars | `params.nodes` and `params.members` | there is nowhere else it can go, and that is the finding |
| **what the bridge must carry** — supports, dropped loads, the deck load | protocol 1.9 `conditions` | the geometry says where, the load case says what |

**Why the lattice is not geometry, stated as a gap rather than as a convention.** `Geometry` is
`Domain2D | Regions2D`: one polygon cut out of a rectangle, or a rectangle filled with material
regions. **A bar network is neither**, and neither is a near miss:

- It cannot be regions. Bars *meet at joints*, so their outlines properly cross, and partially
  overlapping regions are refused — correctly, because for a material assignment they genuinely
  are ambiguous. The refusal is right and the geometry is still unexpressible.
- It cannot be a `domain2d` obstacle. A truss's voids are many holes; that geometry has one.

So the third geometry kind the protocol will eventually want is a **network**: nodes, edges,
and a property per edge. This exercise is the evidence for it, and the honest arrangement until
then is the one above — the geometry carries what it *can* say about the site, and the lattice
is params, where its revision is still hashed into the cache key and still recorded whole in a
run row. What it costs is real and worth writing down: the lattice gets no geometry validation
from the protocol (the params model repeats it), no `<fs-geometry-2d>` (the page brings its own
editor), and no `points` selector, so a boundary naming a joint is a small `box` around it
rather than an id that would follow the joint through an edit.

**Why a lab solver rather than upstream's elasticity.** `mock.elasticity2d` and
`dolfinx.elasticity2d` landed in the same pin bump and are not the same problem discretised
differently. They solve a **continuum**: a body filling a region, meshed, with a stress field
through it. A truss is a graph — an axial force in each bar and nothing in between them.
Meshing a lattice of 50 mm bars over a 24 m span as a continuum would need cells finer than the
bars across an area a thousand times larger; and the answer a designer wants is *the force in
member 14*, which a continuum solve does not have members to report. This is the same test the
first two lab solvers passed ([ADR-014](#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first),
[ADR-018](#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force)):
a solver of the lab's own only when the physics a metric needs is missing, never to demonstrate
the adapter contract.

**Three consequences worth stating, because each one shortened the page.**

*There is no numerical panel.* With the joints pinned, one element per bar **is** the structure
rather than an approximation of it, so there is no mesh size, no tolerance, no iteration count
and no convergence study — the first page in the lab where *Advanced* holds a display width and
an explanation of why it holds nothing else. The verification is about equilibrium instead:
four residuals, all at machine precision, and one of them (the method of joints) computed from
the member forces and the geometry alone, so it never touches the stiffness matrix it is
checking.

*Capacity in compression is not the yield stress.* A 5 m bar of 2200 mm² solid section buckles
at about 47 kN against a 550 kN squash load, so a utilisation measured against yield reports
nine per cent on a member that has already gone. The headline metric is therefore the ratio to
the **lesser** of yield and the Euler load — and the section shape is fixed at the conservative
solid-circular end rather than offered, so a compression member cannot be made safe by
asserting a better section.

*A mechanism is refused, not reported.* A lattice that folds has no equilibrium — the reduced
stiffness matrix is singular, and the honest answer is not a large deflection but no solution.
The refusal names how many independent ways it folds and which joints swing, and the preset
list deliberately includes one ("the deck alone"), because meeting that refusal is the fastest
way to learn what triangulation is for.

**Cost.** A page-owned editor — about 300 lines of SVG and pointer handling that
`<fs-geometry-2d>` would otherwise have covered — and a params model that repeats the lattice
validation the protocol would do if a network geometry existed. Both go away the day it does,
and neither is load-bearing anywhere else.

---

## ADR-020 — The site is bilingual; the repository is not

**Decision.** The pages read in English or Italian, chosen with a switch at the top right of
every page. The code, the comments, the tests, the commit messages and these records stay in
English, and so does everything the *server* writes.

[ADR-011](#adr-011--english-throughout-site-included) refused an Italian site over an English
repository and ended by naming the condition for revisiting it — "not due until a second
language is actually wanted, which is also when the seam should be designed for the languages
it will really carry". This is that seam. Every reason ADR-011 gave still holds; none of them
was an argument against a *reader* choosing, and each of them shaped where the translation
stops.

### The three pieces

| Piece | Where it lives | Why there |
|---|---|---|
| the wording | `frontend/shared/strings/{en,it}.js` — one nested object each, `t('runs.load')` | one file per language, so a sentence is changed once instead of in the markup, the script and the test that reads it |
| the markup | `data-i18n`, `data-i18n-html`, `data-i18n-attr` on the elements that carry prose | the English stays in the file, so the page is readable, crawlable and reviewable without running anything |
| the lesson | `content.json` beside `content.it.json` | the prose was already data ([ADR-013](#adr-013--the-pages-become-exercises-not-demonstrations)); a second file is the whole change |

`content.json` keeps its name for English rather than becoming `content.en.json`. It is the
*source*: the exercise is written in it and every other language is a translation of it, checked
against it section by section by `scripts/check-i18n.mjs`. Renaming it would have made the two
look like peers, which they are not.

**One catalogue is loaded, at the top level, before anything that uses it.** `shared/i18n.js`
imports English statically and the active language with a top-level `await import()`, so every
module that imports it — which is every module — is deferred until the wording is in hand. That
is the property the whole design rests on: `app.js` keeps its metric, parameter and field tables
as module-level constants, exactly as before, and by the time their initialisers run `t` already
answers. No build step, no framework, no reactive store. [ADR-009](#adr-009--no-front-end-framework-and-no-bundler)
stands, and this is the change that most looked like it would break it.

**Switching language is a navigation, not a listener.** The switch is two links to `?lang=en`
and `?lang=it`; following one reloads the page, which re-evaluates those constant tables. Making
it live would mean re-deriving every control, every overlay declaration and every table from a
signal — a component model, which is the thing ADR-009 declined to grow for a lab of four pages.
The links are also shareable and undoable with the back button, which a listener is not. The
cost is one page load and, with it, an unsaved result; the kept runs are in `localStorage` and
survive.

**The language is resolved once, in one order:** `?lang=`, then the stored choice, then the
browser's own `Accept-Language`, then English. Only an explicit choice is stored — a detected
language is re-detected every time, so changing the browser's setting changes the site rather
than losing to a stale copy of an old answer.

**The first paint is held back, and only when it would be wrong.** The pages ship English in the
markup, so an Italian reader would otherwise read a frame of English while the module graph
loads. A ten-line blocking snippet in each `<head>` applies the same resolution rule and, for a
non-English load only, sets `data-lang-pending` on `<html>`; the stylesheet hides the body while
it is there and `translateDom` removes it. The snippet clears the attribute itself after two
seconds, so a script that never runs cannot leave a blank page. Duplicating the rule in ten
lines of ES5 was the price of not shipping a flash of the wrong language; `shared/i18n.js`
re-resolves independently rather than trusting the snippet, so a page that lost it is wrong
about its paint and right about its text.

### What is not translated, and why that is not an omission

**Anything the server wrote.** The validity warnings in `report.json` are computed prose with
the crossed threshold interpolated into them — "Member 12 carries 291 MPa, past the 250 MPa
yield of the material" — and they are built in `physics_lab/solvers/*.py`. Translating them
means either teaching every solver a language, or replacing the sentences with codes and
arguments and rebuilding them in the browser. The second is the right design and it is a change
to the report contract and its tests, not to this seam; it is the obvious next step and it is
deliberately not bundled here. The same goes for each capability's `title` and `description`
from `GET /api/v1/solvers`, which are upstream's and reach the page unread.

**Anything that is a name.** `mock.laplace2d`, `NACA 2412`, `Φ′`, `C_p`, `Wb/m`, `Fenix Spoon`.
This is ADR-011's central observation and it did not stop being true: the vocabulary around
these identifiers is not national, and inventing Italian for a solver name would mean
maintaining a mapping that the API would contradict on its next release. Symbols and units are
the same in both languages because they are the same in both languages.

**Anything a program reads.** The CSV and JSON exports keep their raw keys and their English
summaries (`"3 values"`), because a column that changes wording with the browser's locale is an
export no script can read twice.

### How it is kept honest

`scripts/check-i18n.mjs`, run by CI beside the formatter, is the guard, because every way this
breaks is silent in a browser: a key Italian never got shows English inside Italian prose, a key
the pages ask for and neither catalogue has prints the key, a placeholder lost in translation
prints a brace, and an `content.it.json` that has drifted from its source quietly changes the
exercise. It checks all four, plus that the two files' `{placeholders}` agree. The Python suite
asserts that every page declares both versions and that the Italian lesson is not the English
one copied; Playwright is pinned to `en-GB` so the existing assertions test the code rather than
the runner's locale.

**Cost.** Two files to keep in step instead of one, and a translation to write for every
sentence added — which is the real cost and lands on whoever adds the fifth experiment. About
600 keys today. The check makes forgetting loud rather than invisible, which is the most that
can be automated; what cannot be is whether the Italian is any good.

---

## ADR-021 — An exercise page opens with a lesson, and the lesson can be skipped

**Decision.** An exercise page may open with a short **guided path**: a few chapters, one at a
time, above the mission and below the title. Every chapter carries the same control in the same
place — *Go to the simulator* — and taking it is remembered, so a returning visitor lands on the
bench. The nine sections of the exercise contract are unchanged and the bench underneath is
unchanged; what is added is a way in. Shared implementation: `frontend/shared/guide.js`, with
each exercise's chapters in its own `content.json` and its diagrams in its own `figures.js`.

**Why.** [ADR-017](#adr-017--an-experiment-page-is-a-bench-not-a-document) was right about the
failure it fixed — 7,664 pixels of page, twelve controls each with a paragraph under it, three
panels reading "Nothing computed yet", and the field at a ninth of the first screen. It arranged
the page as one path and made the instrument the subject. What it did not settle is how somebody
who has never met a wing section gets *in*. The bench answers "what do I do now?" for a reader
who already knows what the page is about, and answers nothing at all for anybody else: the first
thing the airfoil page said was *800 N/m of sectional lift, keeping |C_m,c/4| below 0.08*, which
is a precise, correct sentence and a wall.

That matters because of what this repository is for. The
[Fenix Spoon](https://github.com/mandaloriat/fenix-spoon) demo already shows what the toolkit
can do, and does it better, because that is its job. This repository is the **application**, and
the README says so — *"what this repository contains is the teaching experience on top"*. A
second showcase would be a duplicate; a lesson is the thing only this side can build.

**The chapters are a path, not a gate.** No modal, no overlay, no focus trap, no scroll lock.
The guide is a block *above* the instrument and the instrument is in the document the whole
time, so a visitor who ignores it scrolls past. The skip control sits in the same position on
every chapter, because one that moves is one that has to be found each time.

**What is in a chapter is prose, and prose is content.** The chapters live in `content.json`
and `content.it.json` beside the nine sections, so they are reviewed, corrected and translated
without touching JavaScript, and `scripts/check-i18n.mjs` compares them across languages the way
it already compares the sections. It gained two rules of its own there: a chapter's `figure`
names a drawing function and its `presets` carry the incidences the buttons run, so both are
behaviour rather than prose and a translation that changed either would change what the page
*does*. (The same commit put `heatsink` back in that script's list of exercises, where it had
been missing since the release that built it — the checker had been silent about two files
nobody had told it to look at.)

**The diagrams are generated, not drawn.** `frontend/experiments/airfoil/figures.js` builds its
sections from `naca.js`, the four-digit formulae the solver is about to be handed, extracted
from `app.js` for exactly this reason and proved point-for-point identical to what it replaced.
A hand-tuned curve would be a picture of what somebody believed the formula does. This is the
same argument that makes the homepage thumbnails real solves rather than illustrations, and it
caught a real error immediately: the first flow diagram ran its streamlines straight *through*
the section, which is the precise opposite of what the chapter beside it explains.

**A preset is a click, so it may solve.** The last chapter offers six incidences, and each one
sets the control and presses Run.
[ADR-010](#adr-010--public-demo-limits-and-what-they-do-not-cover) forbids solving on load and
on drag, at 100 jobs an hour shared by everyone; it does not forbid solving when a visitor asks,
and a preset button is a visitor asking. Two rules follow. The preset writes to the `<input>`
and lets the control's own handler carry the value into the parameter object, never writing to
that object directly — the second would leave the field showing one angle while the solver
received another, which is the failure `app.js` already carries a warning about. And while a
solve is running the ladder is **disabled with its reason in the tooltip** rather than removed,
which is ADR-017's rule for the workspace toolbar and is not a workspace rule but a lab rule.

**Three defaults changed with it**, because the page is now something a visitor plays with.
Streamlines are on from the first result — this page's question *is* how the air gets round the
section, and a C_p field answers it only for somebody who can already read one. It is asked for
per page rather than globally, because a solver that publishes no vector field cannot draw one
and a global default of `true` would be a claim only one page can keep; the wish and the
possibility stay separate flags, which is the distinction ADR-017 had to learn once already. And
the panel count went 240 → 320 with the sampling grid 192 → 256, chosen by measuring rather than
by taste: panels are nearly free (+0.19 s, no payload), while resolution is paid in **bytes**,
since every grid point ships a speed, a C_p and two velocity components as JSON. 320 × 320 would
have been 1.6 s and 3.9 MB per solve; 320 panels and 256 points is 1.0 s and 2.5 MB.

**The site's identity gained a second colour, and a rule for it.** `lab.css` used to say "one
accent colour" and was right while every page was an instrument. Now `--accent` is the
instrument and `--spark` is the voice that explains: chapters, their numbering, their progress.
A measured quantity is never violet and a chapter control is never blue, so the handover from
the story to the bench is visible before it is read. One display face — Fraunces, variable,
self-hosted because the Caddyfile's CSP says `font-src 'self'` — carries headings and card
titles and nothing that labels or measures.

**Cost, stated plainly.** A new visitor's first screen is no longer the instrument, which is
the thing ADR-017 fought for; it is accepted only because the way out is one click, always in
the same place, and remembered. The homepage cards fold their target and constraint behind a
disclosure, so the quantities are one click further away than they were. There are now two
places an exercise's prose lives — chapters and sections — and they overlap on purpose, for two
different readers; keeping them from drifting is editorial work no script can do. And the guided
path exists for one exercise out of four, so the other three currently open the way they always
did. That is honest rather than tidy: their chapters are physics prose to be written, not
scaffolding to be reused.


## ADR-022 — The lab is a set of challenges, and the explanation comes after the attempt

**Decision.** Every page is reorganised around one loop — **predict, try, improve, compare** —
and the material that used to precede it is moved rather than deleted. Concretely:

- Each exercise asks a **prediction** before the first solve. It gates nothing, changes no
  input, is never marked, and always offers *not sure yet*. `frontend/shared/journey.js`.
- The explanation of the phenomenon is **withheld until the first computation** and arrives as
  at most three short cards under *Why it happens*, which may quote the attempt that unlocked
  them. `content.json` gains an `explain` block.
- The headline row is **three results, never more**, and a tile reads *784 / 800 N per metre*
  with a bar and one sentence, not a bare number. Everything else moves to *All results*.
- *How far to trust it* becomes **two indicators** — is the computation settled, does the model
  apply — with the residuals and the validity warnings behind a closed disclosure.
- The mission is stated **twice**: `challenge.plain_statement` in words, which the page shows,
  and `challenge.statement` in the units an engineer would use, which stays in the model
  details and in the tooltip on each target.
- Each exercise carries a folded **teacher's card**: objective, useful prediction, common
  misconception, closing question, prerequisites, time.
- The homepage leads with three cards, each a question plus a mission a person can picture, and
  carries no formula in its open text. *How to play* is three steps. Methods, solver names and
  server capability are one closed block.
- The magnetic circuit **leaves the card grid** and keeps its URL on an advanced shelf, renamed
  to what it is.

**Why.** The lab had four real qualities — the answers are computed, the targets are
quantitative, the model declares its limits, and runs can be compared — and it led with none of
them. It led with an argument that the solver was real. A student arriving at the airfoil page
met *800 N/m of sectional lift, keeping |C_m,c/4| below 0.08* before they had a reason to care
about either quantity; [ADR-021](#adr-021--an-exercise-page-opens-with-a-lesson-and-the-lesson-can-be-skipped)
built a way past that wall for one exercise out of four, which was the right first move and not
the whole fix. The wall was the ordering, not the wording.

Two orderings in particular were doing damage. **Explanation before attempt**: the airfoil page
listed the lift at −2°, 0°, 2°, 4°, 6° and 8° and said which two buttons the answer lay between,
which turns a prediction that can be wrong into a search that cannot. And **rigour before
purpose**: three panels of residuals said, correctly and unreadably, the one genuinely important
thing this lab teaches — that a number can be computed well and describe reality badly. Two
indicators say it; a table of tolerances buries it.

**What this costs, stated plainly.** The tagline [ADR-016](#adr-016--the-product-is-called-spoon-physics)
fixed as non-negotiable is replaced. That decision was about *having* a fixed claim rather than
about those particular six words, and the old ones described the solver where the new ones
describe what a visitor does. The homepage cards no longer state their target in symbols at all,
not even folded — a step further than ADR-021 went, on the ground that a symbol on a card is a
gate in front of a choice, and the only choice there is which challenge to open. Six headline
tiles become three, so three quantities per page moved one disclosure down. And a returning
visitor now meets a question before the instrument, which is the thing ADR-017 fought against;
it is accepted because it is one radio group, answering is optional, and *not sure yet* is one
click.

**What is not built.** The editorial review that prompted this specifies a replacement for the
magnetic circuit — an electromagnet that has to pull a plate on a power budget, with a
non-linear B–H curve, a force from Maxwell stress verified a second way, and a mesh study in the
gap. Its own acceptance criteria forbid publishing it before that verification exists, so it is
not published and not half-built: the current page is on the shelf, honestly labelled, and the
grid shows three. Also unbuilt: the bridge's three stages, and the heat sink's fin-count sweep
as a first phase. Both are interaction work on top of this hierarchy rather than changes to it,
which is why the hierarchy went first.

---

## Deferred

Not built, on purpose. Each would have been a plausible use of the kickstart's time; none
would have made the one finished experiment better.

| Deferred | Why, and what would bring it back |
|---|---|
| **A network geometry kind** | [ADR-019](#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry) records why the bridge's lattice travels as params: `domain2d` and `regions2d` cannot express joints and bars, and the refusal that blocks the nearest attempt (partially overlapping regions) is correct rather than a bug to route around. Belongs upstream, as a third member of the `Geometry` union with the boundary selectors it would need. What would bring it back here is that kind existing; the lab would then delete a params model and an editor rather than build anything. |
| **The heat-sink experiment** | `mock.heat2d` exists upstream, takes `regions2d`, and carries its convective boundary condition as parameters (`h`, `t_ambient`) rather than needing anything of the geometry schema — so the machinery is ready and what is missing is the didactic half: a fin generator, and the lesson that makes "how many fins actually help" answerable. It would also ship with only the fast preview, since upstream has no FEniCSx heat adapter to pair with it. The homepage lists it as planned rather than pretending. (The solenoid was in this row until ADR-012.) |
| ~~**A lab-specific solver**~~ | *No longer deferred.* It was, on the grounds that nothing the airfoil needed was missing from Fenix Spoon — which stopped being true the moment the pages became exercises. `lab.airfoil_panel2d` landed with [ADR-014](#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first), `lab.magnetics2d` with [ADR-018](#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force) and `lab.truss2d` with [ADR-019](#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry). In all three the missing piece was physics a metric needed, not an adapter to demonstrate. |
| **Accounts, quotas per person, an admin dashboard** | Would need an identity provider, which would defeat "open the page and try it". Fenix Spoon supports API keys and per-principal quotas the day this changes. |
| **Per-IP rate limiting on by default** | Needs a custom Caddy build. Configured and commented in the Caddyfile; see ADR-010. |
| **Publishing the lab image to GHCR** | The server builds from the checkout, which keeps one source of truth while the project is one person and one machine. A published image matters when a second deployment does. |
| **A FEniCSx job in CI** | Would mean pulling a 3 GB image and running a real solve on every push, for a code path this repository does not own — the adapters are upstream's and are tested there in that exact image. CI builds and runs the slim image, which exercises everything the lab actually wrote. |
| **STEP upload, 3D, Navier–Stokes, automatic optimisation** | All need protocol capabilities that do not exist yet: `step3d` geometry, 3D result kinds. (Vector fields were in this list and are not any more — both lab solvers that have one publish it, and the workspace integrates streamlines from it.) Upstream's roadmap, not the lab's. |
| **MCP / local agent interface** | No longer unimplemented upstream — M2.5 landed whole in the pin the lab now runs, so `fenix-spoon rpc --stdio`, the MCP adapter and the CLI all exist. Still deferred here, and for a different reason than before: the lab is a *public web* application with anonymous quotas, and none of those transports is reachable through a browser. What would bring it back is a reason for a script to drive this deployment rather than its own. |
| **A continuous incidence control** | The panel method is exactly linear in α, so two solves determine the flow at *every* angle and a slider could redraw the field at 60 fps with no further jobs — which would fix both halves of what ADR-021 measured: three seconds and 2.5 MB per preset click, against a budget of 100 jobs an hour shared by everyone. It is a proposal rather than a commit because of §8 of the contract, not because of the arithmetic: the page would be showing numbers it computed itself from a basis the solver published, and in a lab that reports a residual on every run that is a different claim and needs its own verification, its own answer to what a kept run records, and a rule for when the basis goes stale. Written up in [docs/proposals/instant-incidence.md](proposals/instant-incidence.md). What would bring it back is a session willing to spend itself on the verification story rather than on the interpolation. |
| **Analytics** | None. A page that reports nothing needs no cookie banner and no privacy policy, and the lab collects no personal data at all. |
| **Translated validity warnings** | [ADR-020](#adr-020--the-site-is-bilingual-the-repository-is-not) translates everything the browser writes and nothing the server does. The warnings in `report.json` are prose built in the solvers with a threshold interpolated into it, so translating them means replacing each sentence with a code and its arguments and rebuilding it in the page — a change to the report contract, its tests and three solvers, and the right one. What would bring it back is upstream's issue #46 giving the envelope somewhere to put typed metrics and messages, at which point the codes have a home that is not `report.json`'s ad-hoc shape. |
