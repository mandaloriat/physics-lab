# Architecture decisions

Short records of the choices that would otherwise have to be re-derived from the code —
each one states what was decided, why, and what it costs. Written when the decision was
made, not reconstructed afterwards.

---

## ADR-001 — The lab is a separate repository from Fenix Spoon

**Decision.** `andolfatto-physics-lab` is its own repository. It is not a fork of
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

**Decision.** Fenix Spoon is pinned to commit `7c89be3d9641c382017931be407e5d6ba8ca9826`.
Never `main`, never `latest`.

**Why a commit and not a release.** There is no release and no tag to use: upstream's
`git ls-remote --tags` is empty. A commit SHA is the strongest pin available, and it is a
complete one — it fixes the server, the solvers, the protocol models and the widget source
together.

**Why the image tags are what they are.** GHCR carries `sha-7c89be3` (FEniCSx, dolfinx
v0.11.0, digest `sha256:35575482…`) and `sha-7c89be3-slim` (mock solvers only, digest
`sha256:2bb12020…`). `dolfinx-v0.11.0` is the same image today but is re-pointed on every
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

## Deferred

Not built, on purpose. Each would have been a plausible use of the kickstart's time; none
would have made the one finished experiment better.

| Deferred | Why, and what would bring it back |
|---|---|
| **Solenoid and heat-sink experiments** | Both solvers exist upstream (`mock.magnetostatics2d`, `mock.heat2d`, `dolfinx.magnetostatics2d`); what is missing is the didactic work. One finished experiment beats three half-written ones. The homepage lists them as planned rather than pretending. |
| **A lab-specific solver** | `physics_lab/solvers/` is the registered, wired-up place for one, and it is empty. Nothing the airfoil needs is missing from Fenix Spoon, so writing an adapter would have demonstrated the adapter contract rather than any physics. |
| **Accounts, quotas per person, an admin dashboard** | Would need an identity provider, which would defeat "open the page and try it". Fenix Spoon supports API keys and per-principal quotas the day this changes. |
| **Per-IP rate limiting on by default** | Needs a custom Caddy build. Configured and commented in the Caddyfile; see ADR-010. |
| **Publishing the lab image to GHCR** | The server builds from the checkout, which keeps one source of truth while the project is one person and one machine. A published image matters when a second deployment does. |
| **A FEniCSx job in CI** | Would mean pulling a 3 GB image and running a real solve on every push, for a code path this repository does not own — the adapters are upstream's and are tested there in that exact image. CI builds and runs the slim image, which exercises everything the lab actually wrote. |
| **STEP upload, 3D, Navier–Stokes, automatic optimisation** | All need protocol capabilities that do not exist yet: `step3d` geometry, 3D result kinds, vector fields. Upstream's roadmap, not the lab's. |
| **MCP / local agent interface** | Upstream design draft (M2.5), unimplemented there. An application cannot ship a transport its toolkit does not have. |
| **Analytics** | None. A page that reports nothing needs no cookie banner and no privacy policy, and the lab collects no personal data at all. |
