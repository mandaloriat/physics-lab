# Spoon Physics.
#
# Two stages, one pin. The Node stage builds the Fenix Spoon browser widgets from source
# (they are not published to npm); the runtime stage starts from the Fenix Spoon server
# image, which already carries the `fenixspoon` package and — in the FEniCSx variant —
# dolfinx and Gmsh.
#
# Everything version-bearing is a build argument, and all three arguments describe the
# *same* Fenix Spoon commit. scripts/check-pins.sh fails the build if they drift apart.
#
#   # mock solvers only, ~100 MB base — what front-end work and CI need
#   docker build -t physics-lab:dev .
#
#   # full FEniCSx runtime, ~3 GB base
#   docker build -t physics-lab:fenics \
#       --build-arg FENIX_SPOON_IMAGE=ghcr.io/mandaloriat/fenix-spoon:sha-4e7c296 .

# The Fenix Spoon commit this lab is built and tested against. There is no release and no
# tag upstream (`git ls-remote --tags` is empty), so a SHA is the strongest pin available.
ARG FENIX_SPOON_COMMIT=4e7c296a7d351575194e25a1d4ebc1c703a6e08f

# The server image built from that same commit. `:sha-<short>-slim` is mock solvers only;
# `:sha-<short>` carries FEniCSx (dolfinx v0.11.0). Note that `:latest` and `:latest-slim`
# do *not* exist in GHCR despite what the upstream README says — the publish workflow only
# tags `latest` on a `v*` git tag, and none has been pushed.
ARG FENIX_SPOON_IMAGE=ghcr.io/mandaloriat/fenix-spoon:sha-4e7c296-slim


# ---------------------------------------------------------------- widget build stage
FROM node:22-alpine AS widgets
ARG FENIX_SPOON_COMMIT
RUN apk add --no-cache git
WORKDIR /src

# Fetch exactly the pinned commit rather than cloning a branch: the pin is a SHA, so
# there is no history worth downloading and no way for the result to move under us.
RUN git init -q . \
 && git remote add origin https://github.com/mandaloriat/fenix-spoon.git \
 && git fetch -q --depth 1 origin "${FENIX_SPOON_COMMIT}" \
 && git checkout -q FETCH_HEAD

# `npm ci` against the committed lockfile — a reproducible install, not a resolved one.
RUN npm --prefix client ci && npm --prefix client run build


# --------------------------------------------------------------------- runtime stage
FROM ${FENIX_SPOON_IMAGE} AS runtime
ARG FENIX_SPOON_COMMIT
ARG FENIX_SPOON_IMAGE

LABEL org.opencontainers.image.title="Spoon Physics" \
      org.opencontainers.image.source="https://github.com/mandaloriat/spoon-physics" \
      org.opencontainers.image.licenses="MIT" \
      eu.andolfatto.lab.fenix-spoon-commit="${FENIX_SPOON_COMMIT}" \
      eu.andolfatto.lab.fenix-spoon-image="${FENIX_SPOON_IMAGE}"

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY physics_lab/ /app/physics_lab/
COPY frontend/ /app/frontend/
COPY --from=widgets /src/client/packages/client/dist/ /app/frontend/vendor/fenix-spoon/client/
COPY --from=widgets /src/client/packages/geometry-2d/dist/ /app/frontend/vendor/fenix-spoon/geometry-2d/
COPY --from=widgets /src/client/packages/viewer/dist/ /app/frontend/vendor/fenix-spoon/viewer/
RUN printf '%s\n' "${FENIX_SPOON_COMMIT}" > /app/frontend/vendor/fenix-spoon/COMMIT

# `--no-deps` on purpose. The base image already installs `fenixspoon` from this exact
# commit; resolving the dependency again would re-download it and, worse, let pip decide
# it should upgrade numpy — which in the FEniCSx image would break dolfinx's ABI. The
# import check below is what makes the omission safe rather than merely fast.
RUN pip install --no-cache-dir --no-deps /app \
 && python -c "import fenixspoon, physics_lab.main; print('fenixspoon', fenixspoon.__version__)"

# Surfaced by /health, so a running container can be asked what it is made of instead of
# being identified by an image tag someone may have retagged.
ENV FENIX_SPOON_COMMIT=${FENIX_SPOON_COMMIT} \
    PYTHONUNBUFFERED=1 \
    FENIXSPOON_DATA_DIR=/data

# Run unprivileged. The only path the process writes to is the data directory, which is a
# volume in every compose file here.
RUN useradd --system --create-home --uid 10001 lab \
 && mkdir -p /data \
 && chown -R lab:lab /data
USER lab

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "physics_lab.main:app", "--host", "0.0.0.0", "--port", "8000"]
