# LinkForge — Product Requirements Document

**Status:** Reflects what is implemented in this repository as of the initial release.
This PRD was written by extracting requirements from the built system, not the
other way around — it documents what LinkForge actually is, not an aspiration.

## 1. Problem statement

Long URLs are unwieldy to share, hard to read aloud, and impossible to track. A
URL shortener solves both problems: it gives a short, stable alias for a long
URL, and it lets the person who created the link see how many times it's been
used.

## 2. Goals

- Let a user turn any absolute `http(s)` URL into a short, unique code.
- Redirect visitors from the short code to the original URL with no
  noticeable added latency.
- Count clicks per link and make that count visible.
- Stay operable by one person: no feature here should require a dedicated
  on-call rotation to keep running.

## 3. Non-goals (explicitly out of scope)

These were deliberately not built. Listed here so absence reads as a decision,
not an oversight:

- **User accounts / authentication.** Every endpoint is open. Anyone who can
  reach the API can create links and read the full link list. There is no
  concept of "my links."
- **Custom aliases.** Codes are always system-generated (7-character,
  collision-checked). A user cannot request `linkforge.example/sale`.
- **Link expiration or deletion.** Links live forever once created; there is
  no TTL and no delete endpoint.
- **Custom domains.** Every link is served from whichever host the Ingress
  is configured for; there's no per-user domain mapping.
- **Analytics beyond a click count.** No referrer tracking, no geographic
  breakdown, no time-series click history — just a running total.
- **Rate limiting / abuse prevention.** Nothing stops one client from
  creating unlimited links or hammering the redirect endpoint.

Any of these would be a reasonable v2 — they're absent because the goal of
this build was a correct, well-operated core, not a feature-complete product.

## 4. Users and use cases

One user type: **link creator**, who is also implicitly a **link consumer**
(anyone who clicks the short link, unauthenticated).

Primary use case: paste a long URL into the form, get a short link back,
share it, watch the click count go up.

## 5. Functional requirements

Derived directly from what `backend/src/routes/links.js` implements:

| ID | Requirement | Implementation |
|---|---|---|
| FR-1 | System shall accept a URL and return a unique short code | `POST /api/links` |
| FR-2 | System shall reject input that is not an absolute `http(s)` URL | 400 response, regex-validated |
| FR-3 | System shall guarantee code uniqueness even under concurrent requests | retry-on-collision, up to 5 attempts |
| FR-4 | System shall redirect a valid short code to its original URL | `GET /:code` → 302 |
| FR-5 | System shall increment a click counter on every successful redirect | atomic `UPDATE ... SET clicks = clicks + 1` |
| FR-6 | System shall return 404 for an unknown code, on both redirect and stats lookup | verified by test |
| FR-7 | System shall list existing links, most recent first, capped at 100 | `GET /api/links?limit=` |
| FR-8 | System shall report per-link stats (code, destination, click count, created date) | `GET /api/links/:code/stats` |

## 6. Non-functional requirements

These map to concrete artifacts in the repo, not aspirations:

| ID | Requirement | How it's met |
|---|---|---|
| NFR-1 | The API tier shall scale horizontally under load | `HorizontalPodAutoscaler`, 2–8 replicas, 70% CPU target |
| NFR-2 | A single pod restart shall not cause an outage | `PodDisruptionBudget` (minAvailable: 1) + 2+ replicas |
| NFR-3 | The system shall expose enough telemetry to detect its own failure | `/metrics` (Prometheus format) + `PrometheusRule` alerts |
| NFR-4 | Containers shall run with least privilege | non-root, `seccompProfile: RuntimeDefault`, capabilities dropped, read-only rootfs where feasible |
| NFR-5 | Configuration shall not require rebuilding images per environment | runtime-injected `API_BASE_URL` (see ADR-003) |
| NFR-6 | Deployment shall be reproducible from git, not manual `kubectl` commands | Kustomize + ArgoCD (GitOps) |

## 7. Success metrics / SLOs

These aren't aspirational — they're the exact thresholds encoded in
`deploy/k8s/base/prometheusrule.yaml`, so the product and the alerting agree
by construction:

- **Error rate:** 5xx responses stay under 5% of total traffic over any 5-minute
  window (`LinkForgeHighErrorRate`).
- **Latency:** p99 request latency stays under 1 second over any 10-minute
  window (`LinkForgeHighLatency`).
- **Availability:** at least one backend target is scrapeable at all times
  (`LinkForgeBackendDown`).

There is no measured baseline yet — no traffic has been served — so these are
starting thresholds to tune once real usage data exists, not validated SLOs.

## 8. Constraints and assumptions

- Single-region, single-cluster deployment assumed; no multi-region or
  disaster-recovery requirement was designed for.
- Postgres is assumed to fit on one node (no requirement for a
  horizontally-sharded data tier).
- "Operable by one person" is a stated design constraint, not just a
  non-goal — it's why Kustomize was chosen over a templating system with a
  steeper learning curve, and why the data tier is a plain StatefulSet
  rather than requiring an operator to be installed first (see ADR-005).
