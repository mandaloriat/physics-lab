# Spoon Physics

**Interactive problems. Computed fields. Checkable answers.**

An interactive laboratory for exploring physical phenomena by changing geometries, materials
and boundary conditions, with fast previews and FEniCSx computations.

Live at **[lab.andolfatto.eu](https://lab.andolfatto.eu)** — the hostname is infrastructure,
not the name of the thing
([ADR-016](docs/architecture-decisions.md#adr-016--the-product-is-called-spoon-physics)).

> The simulations are demonstrative and educational. They are not a substitute for
> professional engineering verification.

The lab is an **application** built on
[Fenix Spoon](https://github.com/mandaloriat/fenix-spoon), which is the **toolkit**: the
wire protocol, the simulation server, the job lifecycle, the solver-adapter contract, the
browser widgets and the SDK all live there and are consumed here as a pinned dependency.
Nothing from it is copied into this repository. What this repository contains is the
teaching experience on top — the experiments, the explanations, the visual identity, the
public deployment and the service limits.

Everything — pages, experiment content, code and documentation — is in English. See
[ADR-011](docs/architecture-decisions.md#adr-011--english-throughout-site-included).

---

## Current experiments

| Experiment | Physics | Status |
|---|---|---|
| **Airfoil design** | Ideal flow with a Kutta condition, by a panel method: hit a lift target under a pitching-moment constraint | **Available** — the first page built to the *exercise* contract |
| **The magnetic circuit** — *magnetostatics* | Vector potential for an out-of-plane current, on a grid fitted to the iron: carry a required flux on an ampere-turn budget without leaking it | **Available** — the second |
| **The bridge** — *statics* | A pin-jointed lattice by the direct stiffness method: build a truss across a gorge and carry the traffic on a steel budget, without buckling a member | **Available** — the third, and the one you draw |
| **Heat sink conduction and convection** | Conduction in a finned body with convective surfaces | Planned |

Each page also numbers *itself* — "Exercise 1", "Exercise 3", "Exercise 4" — and that number is its
row in [the contract's list of exercises](docs/exercise-contract.md#7-the-exercises), not the order
the pages were built in. The two differ because the list has rows nobody has built yet: the bridge
is Exercise 4 there and the third one built here.

The three experiments deliberately exercise different halves of the protocol. The airfoil
sends `domain2d` — one polygon cut out of a rectangle, edited by dragging control points.
The magnetic circuit sends `regions2d`, a filled domain whose *material* varies by region, so
there is no outline to drag and the controls are physical dimensions instead; see
[ADR-012](docs/architecture-decisions.md#adr-012--the-second-experiment-shares-a-page-shell-and-brings-its-own-geometry-controls).
That difference reaches all the way into the parameter panels: on the magnetics page the
physics travels in the geometry, so *every* solver parameter is numerical and the contract's
"physical inputs" group is the cross-section itself.

The bridge exercises the half neither of them touches — **named boundaries and load cases**
(protocol 1.8 and 1.9) — and finds the edge of the geometry schema doing it. A truss is a
*network*: joints and bars. That is neither of the two geometry kinds and not a near miss
either, so the site travels as `regions2d` with a name for every place a condition can attach
to, the lattice travels as a parameter, and what the bridge is asked to carry travels as a
load case. The gap is recorded as a finding rather than papered over:
[ADR-019](docs/architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry).

The remaining experiment has its preview solver upstream already; what it needs is the
didactic work. The homepage lists it as planned rather than pretending otherwise.

Three of the lab's solvers are its own, in `physics_lab/solvers/`, and in each case the reason
was physics a metric needed rather than a wish to demonstrate the adapter contract: upstream's
potential-flow adapters impose no Kutta condition, so their lift is exactly zero
([ADR-014](docs/architecture-decisions.md#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first));
upstream's magnetostatics adapter rasterises the iron/air interface onto a uniform grid, so
a 20.000 mm core comes out 20.339 mm wide at one resolution and 20.084 mm at another
([ADR-018](docs/architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force));
and upstream's elasticity adapters solve a *continuum*, which has no members to report a force
in — a truss is a graph, not a body meshed finely
([ADR-019](docs/architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)).

### Exercises, not demonstrations

A demonstration asks *what changes in the field?* — a question with no wrong answer, so nothing
can be compared and nothing improved. An **exercise** sets a quantitative target under
constraints, reports the engineering metrics that answer it, and says on every run how far those
numbers can be trusted. Every page has the same nine sections: problem, model, boundary
conditions, initial conditions *only* where the problem is transient, physical inputs, fields,
engineering metrics, verification, saved result.

- The contract every page implements: **[docs/exercise-contract.md](docs/exercise-contract.md)**
  ([ADR-013](docs/architecture-decisions.md#adr-013--the-pages-become-exercises-not-demonstrations)).
- The first one, specified and built: **[docs/exercises/airfoil.md](docs/exercises/airfoil.md)**.
  It began by fixing the physics — the old model imposed no Kutta condition, so its lift was
  exactly zero at every incidence
  ([ADR-014](docs/architecture-decisions.md#adr-014--the-airfoil-exercise-ships-ideal-flow-with-a-kutta-condition-first)).
- The second, built after a release spent deliberately refusing to build it:
  **[docs/exercises/solenoid.md](docs/exercises/solenoid.md)**. Every metric a magnetic design
  is judged on needs a definition in a two-dimensional slice, and none had been verified, so
  the page reported the field and nothing else. They now are — and two of the specification's
  own predictions did not survive being measured. There is no peak flux density on that page,
  because the core's corner is a singularity and the peak climbs with every refinement instead
  of converging; and there is no gap force, because a symmetric bar core feels exactly zero, so
  the challenge is set in flux instead
  ([ADR-018](docs/architecture-decisions.md#adr-018--the-magnetics-exercise-gets-its-own-solver-and-its-challenge-is-not-a-gap-force)).
- The third, and the first the visitor *draws*:
  **[docs/exercises/truss.md](docs/exercises/truss.md)**. Lay out joints and bars across a
  gorge, put the supports where the ground can take them, and find out which member gives way
  — almost never the one you expect, because a slender bar buckles at a fraction of the force
  that would yield it. It is also the exercise that found the edge of the geometry schema: a
  bar network is neither of the two kinds the protocol has
  ([ADR-019](docs/architecture-decisions.md#adr-019--the-bridge-carries-its-lattice-in-params-because-the-protocol-has-no-network-geometry)).

### A page is a bench

Containing the nine sections is not the same as showing them all at once, and the first version
of the airfoil page did the second: 7,664 pixels tall, a 310-pixel column of twelve controls each
with a paragraph under it, Run above most of the inputs that feed it, three panels reading
"Nothing computed yet", and the field itself about a ninth of the first screen.

Every experiment page is now arranged as one path — **mission → configure → run → explore →
check → keep and compare → understand the model** — with the computed field as the largest thing
on it and its own toolbar: pan, zoom, fit, reset, probe, vector glyphs, streamlines, annotation
layers and image export. A tool the current result cannot support is **disabled with its
reason** rather than absent. The explanations are not shortened; they are folded into
*Understand the model*. See
[ADR-017](docs/architecture-decisions.md#adr-017--an-experiment-page-is-a-bench-not-a-document)
and [the contract's §7a](docs/exercise-contract.md#7a-the-order-a-page-presents-them-in).

---

## Architecture

```
Browser
   │
   ▼
lab.andolfatto.eu
   │
   ▼
Caddy  ── HTTPS, HTTP/3, security headers, WebSocket upgrade
   │
   ▼
physics_lab  ── the Fenix Spoon app + the static site + /health, one origin
   │
   ▼
Redis  ── arq queue + progress pub/sub
   │
   ▼
worker (FEniCSx)  ── one solve per container, shared data volume with the API
```

The front-end and the API are the same origin by design, so CORS never enters the picture
and the pages contain no hostname at all
([ADR-003](docs/architecture-decisions.md#adr-003--the-front-end-and-the-api-share-one-origin)).
In development the API solves in its own process and there is no Redis and no worker.

### What this repository adds to Fenix Spoon

Three things, all additive — no route is wrapped, no response rewritten, no model
subclassed:

1. **`GET /health`** — Fenix Spoon has none, and a reverse proxy, a container health check
   and a smoke test all need one. It reports the pinned commit, the dolfinx version, the
   installed solvers and whether the lab is accepting jobs.
2. **The static site at `/`**, served by the same process as the API.
3. **A maintenance switch** (`PHYSICS_LAB_JOBS_ENABLED=false`) that refuses new
   submissions while leaving the site, the catalogue and every finished result online.

### Layout

```
physics_lab/          the app: main.py, settings.py
  solvers/              the airfoil panel method, the magnetics finite volumes and the truss
                        stiffness method — each as method, exercise and adapter
frontend/             static site — no build step for the lab's own code
  index.html            homepage
  assets/thumbnails/    one real solve per experiment, made by scripts/make-thumbnails.py
  experiments/airfoil/  the wind-tunnel exercise (index.html, app.js, content.json)
  experiments/solenoid/ the magnetics experiment, same three files
  experiments/truss/    the bridge exercise, same three files, plus its own lattice editor
  shared/               lab.css, api.js, components.js, experiment.js (the page shell),
                        workspace.js (the field and its tools), exercise.js, curve.js,
                        runs.js, atmosphere.js (the exercise contract)
  vendor/               Fenix Spoon widgets, built from the pin (generated, gitignored)
tests/                pytest: the API seam, the served site
e2e/                  Playwright: the browser loop, run against a deployment
scripts/              fetch-widgets, check-pins, make-thumbnails, smoke-test, deploy
docs/                 architecture-decisions.md, exercise-contract.md, exercises/*.md
Dockerfile            node stage (widgets) + runtime stage FROM the Fenix Spoon image
compose.yaml          base stack — no published ports
compose.override.yaml development conveniences, auto-loaded
compose.production.yaml  Caddy + API + Redis + workers
Caddyfile             the production site config (also runnable locally, see below)
```

---

## Quick start

### Without Docker

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"          # pulls Fenix Spoon from the pinned commit
./scripts/fetch-widgets.sh       # builds the browser widgets from that same commit
uvicorn physics_lab.main:app --reload
```

Then open <http://127.0.0.1:8000>. The mock solvers are always available, so the whole
loop — edit the profile, submit, stream progress, render the field, download the VTK —
works without FEniCSx installed.

### With Docker (mock solvers, ~100 MB base)

```bash
cp .env.example .env
docker compose up -d --build
./scripts/smoke-test.sh http://127.0.0.1:8000
```

`compose.override.yaml` is picked up automatically and publishes port 8000 on `127.0.0.1`
only.

### With FEniCSx

The FEniCSx solvers register only where dolfinx imports, which means the full image:

```bash
docker compose \
  --env-file .env \
  -f compose.yaml -f compose.override.yaml \
  build --build-arg FENIX_SPOON_IMAGE=ghcr.io/mandaloriat/fenix-spoon:sha-4e7c296
docker compose up -d
```

The base image is about 3 GB, so the first build is slow. Confirm it worked:

```bash
curl -s http://127.0.0.1:8000/health | python3 -m json.tool   # solvers should list dolfinx.*
```

The experiment page then offers both modes. Where it does not, it says so and stays fully
usable on the preview solver — nothing about the page assumes FEniCSx is present.

---

## Production

### 1. DNS

One record, pointing at the server:

| Type | Name | Value |
|---|---|---|
| `A` | `lab` (i.e. `lab.andolfatto.eu`) | the server's public IPv4 |
| `AAAA` | `lab` | the server's public IPv6, if it has one |

No CNAME, no wildcard, no separate `api.` name — the lab is one hostname
([ADR-003](docs/architecture-decisions.md#adr-003--the-front-end-and-the-api-share-one-origin)).

Verify before deploying, because Let's Encrypt rate-limits failures:

```bash
dig +short lab.andolfatto.eu A
```

### 2. Ports

Both must be reachable from the internet:

- **80/tcp** — the ACME HTTP-01 challenge, and the HTTP→HTTPS redirect. Leaving it closed
  is the single most common reason certificate issuance fails.
- **443/tcp and 443/udp** — the site, and HTTP/3.

Nothing else is published. The API, Redis and the workers are reachable only on the
compose network.

```bash
sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp
```

### 3. Deploy

```bash
git clone https://github.com/mandaloriat/physics-lab.git
cd physics-lab
cp .env.example .env          # set LAB_DOMAIN; everything else has a working default
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

Or `./scripts/deploy.sh`, which does the same and then runs the smoke test, telling you how
to roll back if it fails.

Scale the solving capacity independently of the API:

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --scale worker=3
```

### 4. Verify the certificate

```bash
curl -sI https://lab.andolfatto.eu | head -3
echo | openssl s_client -connect lab.andolfatto.eu:443 -servername lab.andolfatto.eu 2>/dev/null \
  | openssl x509 -noout -issuer -dates
```

Issuer should be Let's Encrypt and `notAfter` about 90 days out. Caddy renews at two
thirds of the lifetime with no cron job to configure.

### 5. Verify the WebSocket

The progress stream is a WebSocket; a proxy that does not upgrade it makes the UI look
hung while everything else appears fine. Check the handshake directly:

```bash
# The key is any 16 random bytes, base64-encoded — the handshake does not care which.
curl -sI -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' \
  https://lab.andolfatto.eu/api/v1/jobs/does-not-exist/events
```

`101` means the upgrade happened (the job id is then rejected by the application, which is
the point — the proxy did its part). Anything else, and Caddy is not upgrading.

The end-to-end proof is the browser suite, which uses only the WebSocket to wait for a
result:

```bash
npm install
npx playwright install chromium
BASE_URL=https://lab.andolfatto.eu npx playwright test
```

### 6. Roll back

```bash
./scripts/deploy.sh --rollback        # previous commit, rebuilt, smoke-tested
```

or by hand:

```bash
git checkout <previous-sha>
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

The data volume is untouched by either, so finished jobs survive a rollback. Rolling back
across a Fenix Spoon pin bump also reverts the base image, since the tag is a build
argument.

---

## Operating it

### Logs

```bash
docker compose -f compose.yaml -f compose.production.yaml logs -f api
docker compose -f compose.yaml -f compose.production.yaml logs -f worker
docker compose -f compose.yaml -f compose.production.yaml logs -f caddy
```

Rotation is configured in the compose files (`max-size: 10m`, `max-file: 5`), so a
long-lived container cannot fill the disk. To apply the same globally, set
`log-driver`/`log-opts` in `/etc/docker/daemon.json` and restart Docker.

### Turning simulations off without taking the site down

```bash
sed -i 's/^PHYSICS_LAB_JOBS_ENABLED=.*/PHYSICS_LAB_JOBS_ENABLED=false/' .env
docker compose -f compose.yaml -f compose.production.yaml up -d --no-deps api
```

New submissions get a `503` with a `Retry-After`; the pages, the catalogue, every finished
result and every artifact stay available, and the front-end shows a banner instead of a Run
button. Reverse it the same way.

### Backup

The data volume is the only durable state — job records, result payloads and artifacts all
live in one directory, which is Fenix Spoon's durability contract.

```bash
docker run --rm -v physics-lab_lab-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/lab-data-$(date +%F).tar.gz -C /data .
```

Restore into a stopped stack:

```bash
docker run --rm -v physics-lab_lab-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/lab-data-YYYY-MM-DD.tar.gz -C /data'
```

There is nothing personal in it: the lab has no accounts, no cookies, no analytics and no
uploads, so a backup contains geometries and fields and nothing else.

### Deleting all demo data

Records expire on their own after `FENIXSPOON_JOB_TTL` (24 hours by default), swept hourly
and at startup. To wipe everything now:

```bash
docker compose -f compose.yaml -f compose.production.yaml down
docker volume rm physics-lab_lab-data
docker compose -f compose.yaml -f compose.production.yaml up -d
```

That removes the job database, every result payload and every artifact. Nothing else in
the stack holds simulation data — Redis carries only the queue and live progress and is
started with persistence off.

### Updating Fenix Spoon

The pin is deliberate and lives in several files, all of which must agree. The full
procedure, including how to check that the images exist for a new commit, is
[ADR-007](docs/architecture-decisions.md#adr-007--the-dependency-is-pinned-to-a-commit-in-four-places-checked-by-a-script).
The short version:

```bash
# edit the SHA in pyproject.toml, Dockerfile, compose*.yaml, .env.example,
# scripts/fetch-widgets.sh, physics_lab/settings.py — and the image tags
./scripts/check-pins.sh                       # must pass first
FORCE=1 ./scripts/fetch-widgets.sh
pip install -e ".[dev]" --force-reinstall --no-deps
pytest && npx playwright test
```

---

## The pinned dependency

| What | Value |
|---|---|
| Fenix Spoon commit | `4e7c296a7d351575194e25a1d4ebc1c703a6e08f` |
| FEniCSx base image | `ghcr.io/mandaloriat/fenix-spoon:sha-4e7c296` — digest `sha256:08213ca65c5249d792837cbca82d5e0d6ba1fec2a036afec0192fddf2f7bedeb` |
| Mock-only base image | `ghcr.io/mandaloriat/fenix-spoon:sha-4e7c296-slim` — digest `sha256:8189808c5797c61596d79a89f01857128ed2fa2b7b5d3ab141acaf36a37d5208` |
| dolfinx | v0.11.0 |

Upstream has published **no release and no git tag**, so a commit SHA is the strongest pin
available. Note that `:latest` and `:latest-slim` **do not exist** in GHCR despite what the
Fenix Spoon README says — its publish workflow tags `latest` only on a `v*` git tag, and
none has been pushed. Do not "fix" a pull failure by switching to them.

`/health` reports the pin at runtime, so a deployed container can be asked what it is made
of rather than identified by a tag someone may have retagged.

---

## Security and the limits of a public demo

The lab is anonymous by design: no accounts, no API keys, no cookies, no analytics, no
uploads. What protects it:

| Control | Where |
|---|---|
| Cell budget refused at submit, in prose the page prints | `FENIXSPOON_MAX_CELLS=200000` |
| Wall-clock timeout | `FENIXSPOON_JOB_TIMEOUT=90` |
| Concurrent and hourly job caps | `FENIXSPOON_MAX_CONCURRENT_JOBS`, `FENIXSPOON_MAX_JOBS_PER_HOUR` |
| Hard per-job memory ceiling | `LAB_WORKER_MEMORY=2G`, enforceable because one solve is one process |
| One solve per worker container | `FENIXSPOON_WORKER_CONCURRENCY=1` |
| Short retention | `FENIXSPOON_JOB_TTL=86400` |
| Request body limit | `request_body max_size 1MB` in the Caddyfile |
| HSTS, CSP, nosniff, frame and referrer policy | Caddyfile `header` block |
| Redis unreachable from outside | no published port, no persistence |
| Unprivileged container user | `USER lab` (uid 10001) in the Dockerfile |
| No arbitrary execution | Fenix Spoon's protocol exposes *named solvers with typed parameters*. A client chooses **what** to solve from a server-defined menu, never **how**: no Python, no UFL, no shell. |
| No admin surface | there is none to expose |
| No secrets in the front-end | every request is same-origin and relative; a test enforces it |

**The gap, stated plainly.** In anonymous mode every visitor is Fenix Spoon's `anonymous`
principal, so the quotas are *server-wide*. They cap total load correctly and do nothing
against one abusive client: a single script can spend the whole hourly budget and lock
everyone else out without tripping a per-user limit. Per-IP limiting is the missing half
and belongs in the reverse proxy, which is the only layer that sees the client address. The
Caddyfile carries the configuration and the `xcaddy` build it needs, commented out, with a
note on when to turn it on. See
[ADR-010](docs/architecture-decisions.md#adr-010--public-demo-limits-and-what-they-do-not-cover).

Two front-end decisions follow from the same arithmetic: the experiment page never solves
automatically — not on load, not on drag — and it reads `jobs_enabled` from `/health` so a
maintenance window shows a banner rather than a button that 503s.

---

## Development

```bash
pytest                     # the API seam and the served site
ruff check .               # lint
mypy                       # type check
./scripts/check-pins.sh    # every Fenix Spoon reference agrees
./scripts/make-thumbnails.py   # regenerate the homepage cards from real solves

npm install && npx playwright install chromium
BASE_URL=http://127.0.0.1:8000 npx playwright test    # the browser loop
./scripts/smoke-test.sh                               # against a running deployment
```

Fenix Spoon's own suite already proves the protocol, the job lifecycle, the store and the
solvers — it is a dependency, and re-testing it here would be duplicated maintenance with
no extra coverage. These tests cover the seam and the lab's own additions.

### Testing the production proxy locally

The `Caddyfile` is the production config and can be put in front of a local server
unchanged, WebSocket and security headers included — which is how it gets tested at all,
given that a certificate needs a public name:

```bash
uvicorn physics_lab.main:app --port 8000 &
LAB_DOMAIN=:9080 LAB_UPSTREAM=127.0.0.1:8000 caddy run --config Caddyfile
BASE_URL=http://127.0.0.1:9080 npx playwright test
```

A bare `:port` site address turns automatic HTTPS off, so nothing else has to change.

### Adding an experiment

1. A directory under `frontend/experiments/`, with `index.html`, `app.js` and
   `content.json`. The two existing experiments are the references, and they differ on
   purpose: the airfoil edits its geometry with a widget, the solenoid builds it from
   physical sliders.
2. `app.js` supplies the physics and takes the rest from `shared/experiment.js` — the
   parameter form (generated from the solver's own `params_schema`, never hardcoded), the
   solver picker, the run loop, the result panel and the lesson renderer. What each
   experiment writes for itself is the geometry, a `FIELD_VIEW` table saying how to read
   each field, and any quantity worth deriving in the browser from what the solver returned
   (`Cp` for the airfoil, `H` for the solenoid).
3. A card on the homepage, and the experiment's name in `EXPERIMENTS` in
   `tests/test_frontend.py`, which then checks its assets, its import map and the shape of
   its `content.json` — including that it documents the limits of its own model.
4. If Fenix Spoon has no solver for it, an adapter in `physics_lab/solvers/`. That package
   is already imported before the app is built, and again by `physics_lab.worker` — the
   module the worker containers run — so `@register` is the whole integration. Sharing an
   image with the API is not what makes an adapter available in a worker; importing the
   package in the process arq runs is. It must implement Fenix Spoon's public `Solver`
   contract; nothing about it is lab-specific.

---

## License

[MIT](LICENSE).

Built with [Fenix Spoon](https://github.com/mandaloriat/fenix-spoon) and
[FEniCSx](https://fenicsproject.org/). FEniCSx components (DOLFINx, UFL, FFCx, Basix) are
LGPL-3.0-or-later and are used as external dependencies inside the container images
published by the Fenix Spoon project; this repository does not redistribute them.

This project is not affiliated with, endorsed by, or connected to the FEniCS Project.
