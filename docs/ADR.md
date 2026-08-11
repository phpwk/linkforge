# LinkForge — Architecture Decision Records

Single-file ADR log rather than one file per decision — appropriate at this
project's size (7 decisions, one team). Split into individual
`docs/adr/NNNN-title.md` files if this grows past ~15 entries or gains
multiple contributors who need to reference specific decisions independently.

Each entry: **Status**, **Context**, **Decision**, **Consequences**,
**Alternatives considered**.

---

## ADR-001: Three-tier architecture (React / Node-Express / PostgreSQL)

**Status:** Accepted

**Context:** The system needs a UI, business logic (URL validation, code
generation, click tracking), and persistent storage. These have different
scaling characteristics (the API needs more replicas under load; the
database needs none) and different release cadences in principle.

**Decision:** Separate into three independently-deployable tiers with a
strict dependency direction: presentation → application → data. The
frontend never queries Postgres directly; the backend is the only thing
with database credentials.

**Consequences:**
- (+) Each tier scales, deploys, and fails independently.
- (+) The API is directly reusable by a future non-browser client (CLI,
  mobile) since the frontend has no special access the API doesn't expose.
- (−) Two network hops per user action (browser → frontend, browser →
  backend) instead of one; added latency and two more things to keep
  healthy versus a monolith.

**Alternatives considered:** A monolith (server-rendered pages, one
deployable) — rejected because it was a worse vehicle for demonstrating
independent-tier scaling and deployment, which was an explicit goal of
this build.

---

## ADR-002: Host-based Ingress split, not path-based

**Status:** Accepted

**Context:** The backend's redirect route is `GET /:code` — it lives at the
application's *root*. If the frontend and backend shared one host with
path-based routing (`/api/*` → backend, `/*` → frontend), any short code
that happened to collide with a frontend asset path would be ambiguous, and
the redirect route couldn't live at `/` without a rewrite rule fighting the
SPA's own root route.

**Decision:** Two Ingress hosts — `linkforge.example` (frontend) and
`api.linkforge.example` (backend, serving both `/api/*` JSON and the
`/:code` redirects).

**Consequences:**
- (+) No path-rewrite rules; both apps keep simple, unambiguous root-level
  routing.
- (+) Matches how established shorteners actually split this (e.g., a
  dedicated redirect domain separate from the management UI).
- (−) Requires two DNS records and two TLS certs instead of one; slightly
  more Ingress config to maintain.

**Alternatives considered:** Path-based routing with `/s/:code` instead of
`/:code` — rejected because it makes every shared short link longer for no
operational benefit; the whole point of a shortener is the shortest
possible path.

---

## ADR-003: Runtime-injected frontend configuration, not build-time

**Status:** Accepted

**Context:** The frontend needs to know the backend's API origin, and that
origin differs by environment (dev vs. prod). Vite's default pattern bakes
`import.meta.env.VITE_*` values in at build time, which means a new
container image per environment.

**Decision:** The frontend image is built once, with no environment-specific
values inside it. `index.html` loads `/config.js` before the app bundle;
the container's entrypoint script (`docker-entrypoint.sh`) writes that file
from the `API_BASE_URL` environment variable at container *start*, not at
image build.

**Consequences:**
- (+) One image, promoted dev → staging → prod unchanged — what actually
  ran in dev is byte-identical to what runs in prod.
- (+) Config changes (e.g., API host) don't require a rebuild, just a pod
  restart.
- (−) One more moving part (the entrypoint script) and one more file
  (`config.js`) to reason about versus "it's just baked into the JS
  bundle."

**Alternatives considered:** Build-time env vars (Vite default) — rejected
for the reproducibility loss described above. Runtime config fetched via an
XHR to a `/api/config` backend endpoint — rejected as unnecessary
complexity (a network round-trip and a new backend endpoint) for a single
string value that a static file injected at container start already
solves.

---

## ADR-004: Kustomize + overlays, not Helm

**Status:** Accepted

**Context:** Dev and prod need different replica counts, image tags,
hostnames, and (prod only) pod anti-affinity, from a shared base of
Kubernetes resources.

**Decision:** Kustomize `base/` + `overlays/{dev,prod}/`, using strategic
and JSON6902 patches, rather than a Helm chart with `values-{env}.yaml`.

**Consequences:**
- (+) Every rendered manifest is still plain, readable YAML — `kustomize
  build overlays/prod` produces exactly what gets applied, with no
  templating-language indirection to debug.
- (+) No separate templating language to learn beyond YAML itself and
  JSON6902 patch syntax — lower barrier for anyone else touching this repo.
- (−) Logic that Helm would express directly (conditionals, loops) has to
  be expressed as patches instead, which is more verbose for genuinely
  complex parameterization. Not a problem at this project's current size
  (two environments, a handful of patched fields).

**Alternatives considered:** Helm — rejected for this project's scale; the
templating power it offers isn't needed for two environments and a dozen
resources, and it would have hidden the actual applied manifests behind
template rendering.

---

## ADR-005: Self-managed Postgres StatefulSet, not an operator or managed DB

**Status:** Accepted, explicitly bounded

**Context:** The data tier needs to run somewhere. Production-grade options
(a managed database like Cloud SQL/RDS, or a Kubernetes operator like
CloudNativePG) require either a cloud account tied to a specific provider
or an extra operator installed in the cluster first — both add setup steps
before this repo's manifests can be tried on an arbitrary cluster.

**Decision:** A plain `StatefulSet`, one replica, one `PersistentVolumeClaim`.
No operator, no cloud dependency.

**Consequences:**
- (+) `kustomize build | kubectl apply` works on any cluster with no
  prerequisite operator installation — kind, a homelab node, or a managed
  cluster, identically.
- (−) No automated failover, no point-in-time recovery, no automated
  backups. A node failure taking down the single Postgres pod is a real
  outage with no automatic recovery.
- This is flagged in three places (the manifest's own comment, README,
  HLD §6) specifically so it can't be mistaken for a production
  recommendation by someone skimming one of those files in isolation.

**Alternatives considered:** CloudNativePG operator — the better answer for
any real deployment; not the default here because it adds an operator
installation as a hard prerequisite for trying the rest of the repo.
Managed cloud database (Cloud SQL/RDS) — rejected for the same
reason, plus it would tie this repo to one cloud provider.

---

## ADR-006: Environment-differentiated GitOps sync policy

**Status:** Accepted

**Context:** ArgoCD's `Application` resource can auto-sync (apply changes
the moment git changes) or require manual sync. Dev and prod have different
tolerance for that.

**Decision:** Dev's `Application` has `syncPolicy.automated` with
`selfHeal: true` — every merge to `main` that passes CI reaches dev with no
human action. Prod's `Application` has no `automated` block at all — a
human (or a deliberate pipeline step) has to trigger `argocd app sync
linkforge-prod`.

**Consequences:**
- (+) Dev is always a true reflection of `main` — no drift, no "works on my
  machine" between what's merged and what's deployed.
- (+) Prod deploys are a deliberate, visible, auditable action, not a side
  effect of merging code.
- (−) Prod requires an extra manual (or pipeline-gated) step that dev
  doesn't — by design, but it is one more thing a release process has to
  remember to do.

**Alternatives considered:** Auto-sync everywhere — rejected because it
removes the last checkpoint before a change reaches real users. Manual sync
everywhere — rejected because it adds friction to dev iteration for no
safety benefit (dev isn't serving real traffic).

---

## ADR-007: `package-lock.json` excluded from version control

**Status:** Accepted

**Context:** Committing lock files is the normal, recommended practice for
reproducible installs. Both lock files here are ~280KB of machine-generated
JSON with no hand-reviewable content.

**Decision:** `.gitignore` both `package-lock.json` files; use `npm install`
rather than `npm ci` in CI and both Dockerfiles.

**Consequences:**
- (+) Every diff in the repo's history is human-authored and reviewable;
  no 280KB auto-generated diffs burying real changes.
- (−) Loses `npm ci`'s exact reproducibility guarantee — a dependency's
  patch-version update between two CI runs could in principle change what
  gets installed, where `npm ci` against a committed lock file would not.
  For a reference repo with a small, stable dependency set, that risk was
  judged acceptable.

**Alternatives considered:** Commit the lock files (the normal-practice
default) — the honest right answer for a real production service. Not done
here; explicitly called out as the thing to change first if this repo
graduates beyond a reference build (see README "Known limitations").
