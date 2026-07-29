# Andolfatto Physics Lab

**An interactive laboratory for exploring physical phenomena by changing geometries,
materials and boundary conditions, with fast previews and FEniCSx computations.**

Live at **[lab.andolfatto.eu](https://lab.andolfatto.eu)**.

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
| **Airfoil potential flow** — *Wind tunnel* | Laplace equation for the streamfunction around an editable NACA profile | **Available** |
| **Solenoid magnetostatics** | Iron core, current-carrying coils, flux redistribution | Planned |
| **Heat sink conduction and convection** | Conduction in a finned body with convective surfaces | Planned |

The two planned experiments have solvers upstream already; what they need is the didactic
work. The homepage lists them as planned rather than pretending otherwise.

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
physics_lab/          the app: main.py, settings.py, solvers/ (registered, empty by design)
frontend/             static site — no build step for the lab's own code
  index.html            homepage
  experiments/airfoil/  the wind-tunnel experiment (index.html, app.js, content.json)
  shared/               lab.css, api.js, components.js
  vendor/               Fenix Spoon widgets, built from the pin (generated, gitignored)
tests/                pytest: the API seam, the served site
e2e/                  Playwright: the browser loop, run against a deployment
scripts/              fetch-widgets, check-pins, smoke-test, deploy
docs/                 architecture-decisions.md
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
  build --build-arg FENIX_SPOON_IMAGE=ghcr.io/mandaloriat/fenix-spoon:sha-7c89be3
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
| Fenix Spoon commit | `7c89be3d9641c382017931be407e5d6ba8ca9826` |
| FEniCSx base image | `ghcr.io/mandaloriat/fenix-spoon:sha-7c89be3` — digest `sha256:3557548223280037b90dd2f7a5e58300a8232b87d920d65b2ca31e7dd2636094` |
| Mock-only base image | `ghcr.io/mandaloriat/fenix-spoon:sha-7c89be3-slim` — digest `sha256:2bb120206b8e0ac2a1ca38443f71355f0f1eb59b6f16295ead55c5514dcdb11b` |
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
   `content.json` — the airfoil is the reference.
2. A card on the homepage.
3. If Fenix Spoon has no solver for it, an adapter in `physics_lab/solvers/`. That package
   is already imported before the app is built, so `@register` is the whole integration —
   in the API process and in every worker, because they run the same image. It must
   implement Fenix Spoon's public `Solver` contract; nothing about it is lab-specific.

---

## License

[MIT](LICENSE).

Built with [Fenix Spoon](https://github.com/mandaloriat/fenix-spoon) and
[FEniCSx](https://fenicsproject.org/). FEniCSx components (DOLFINx, UFL, FFCx, Basix) are
LGPL-3.0-or-later and are used as external dependencies inside the container images
published by the Fenix Spoon project; this repository does not redistribute them.

This project is not affiliated with, endorsed by, or connected to the FEniCS Project.
